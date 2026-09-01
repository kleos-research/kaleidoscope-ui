/**
 * Curation: the merge the engine does not have, composed out of the two writes that do something.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CENTRAL FACT, AND IT IS MEASURED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------------------------
 *
 * The operator surface publishes an operation whose modes read like curation — merge, split,
 * rollback. Run against a real vault its merge reports `status: "applied"`, a committed effect and
 * conserved mass, and afterwards BOTH memories are still present, still readable through every
 * other door, and still served. Its rollback unwinds a transition whose effect nothing observed.
 *
 * **This module does not route it, in any mode.** Not behind a flag, not for inspection. A button
 * wired to it ships green — it passes its own tests, returns success, and changes nothing the user
 * can see — and the user watches the list not change and concludes this app is broken.
 *
 * So the two curation runs here are built from `remember` update and `remember` delete, which are
 * the only writes whose effects this app has observed, and this module owns the ordering, the
 * intermediate states and the recovery that a real transaction would have owned.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO RUNS, ONE SHAPE
 * ---------------------------------------------------------------------------------------------
 *
 * **Unify a spelling** (`POST /api/renames`) rewrites one name into another across every memory
 * that uses it: N updates, each with its own expected version, each preceded by a snapshot. The
 * rewrite touches `facts[].subject`, `facts[].object` and the declaration's name in ONE composed
 * payload — never two passes — because a write that moves the facts and forgets the declaration
 * commits with those facts dropped and reports success. See `shared/rename.mjs`.
 *
 * **Merge two memories** (`POST /api/merges`) writes the composed survivor FIRST and removes the
 * duplicate SECOND. The ordering is not a preference; the reasoning is in `handleMerge`.
 *
 * Both runs share the removal path's five rules, and for the same reasons: re-read the version
 * immediately before each call, branch on the exit code and never on stderr, snapshot before every
 * write, run serially, and STOP AT THE FIRST REFUSAL. A moved version usually means somebody else
 * is working in this vault right now, and the remaining items are the ones most likely to be wrong.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A HALTED RUN OWES THE USER
 * ---------------------------------------------------------------------------------------------
 *
 * A half-renamed vault is a worse state than an un-renamed one, and it is invisible: every memory
 * looks correct on its own page. So a stopped run reports THE BOUNDARY — which memories were
 * rewritten, which one was refused and in the engine's own words why, and which were never
 * attempted — and it hands back a `resume` naming exactly the work that is left. Resuming does not
 * redo what landed: a memory that no longer mentions the old spelling is reported as already
 * carrying the new one and is not written again.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS MODULE NEVER CALLS
 * ---------------------------------------------------------------------------------------------
 *
 * A ranked search. `readMemory` addresses a memory by id and records nothing; `loadForEdit` is that
 * door composed with the lineage door. There are zero callers of the ranked door in this repository
 * and this module does not add the first one — `test/merge.test.mjs` counts the vault's exposure
 * records across a whole curation session and asserts the number did not move.
 */

import { EngineCrashedError, EngineRefusedError, EngineUnlicensedError } from '../engine/errors.mjs';
import { loadForEdit, readMemory, writeMemory } from '../engine/memory.mjs';
import { projectOntoContract } from '../shared/contract.mjs';
import { mentionsSurface, renameInDelta, undeclaredEndpoints } from '../shared/rename.mjs';
import { PendingMergeError } from './pending.mjs';
import { sendJson, sendSidecarError } from './respond.mjs';
import { SnapshotFailedError } from './snapshots.mjs';
import { classifyRefusal, describeWrite, pickMode, readJsonBody, snapshotReceipt } from './write.mjs';

/**
 * How many memories one rename run may carry.
 *
 * The same number and the same reasoning as a removal run: the design is serial and stop-on-refusal
 * by choice, so a very long run against a vault under concurrent writes mostly stops partway. This
 * is published so a request that asks for thousands is refused with a sentence rather than held
 * open for an hour.
 */
export const MAX_ITEMS_PER_RUN = 100;

/** A curation write folds a graph. It is not a read, and its timeout is not a read's. */
const WRITE_TIMEOUT_MS = 120_000;

/** Vault contention, told apart from every other refusal. Same pattern the removal path uses. */
const VAULT_BUSY = /\b(lock|locked|busy|another process|in use|contended|would block)\b/i;

/**
 * THE STATES ONE ITEM CAN END IN, and which of them let the run keep going.
 *
 * Only two states continue: the memory was rewritten, or it already carried the surviving spelling
 * and needed no write. Everything else stops the run — including the states that are nobody's
 * fault. "Get the rest done anyway" is the instinct this table exists to refuse.
 */
export const CONTINUES = Object.freeze(['rewritten', 'already_named']);

/** What one thrown engine error means for one item. The engine's own sentence travels with it. */
function classifyThrown(error) {
	if (error instanceof EngineUnlicensedError) {
		return { state: 'unlicensed', exit_code: 4, message: error.message, next: null };
	}

	if (error instanceof EngineRefusedError) {
		const classified = classifyRefusal(error.refusal, error.reason);
		const said = error.refusal?.message ?? error.reason ?? error.message;

		if (classified.kind === 'stale_version') {
			return {
				state: 'changed',
				exit_code: 2,
				message: said,
				next: error.refusal?.next ?? null,
				observed: {
					expected_version_id: classified.expected_version_id,
					current_version_id: classified.current_version_id,
				},
			};
		}
		if (VAULT_BUSY.test(said)) {
			return { state: 'busy', exit_code: 2, message: said, next: error.refusal?.next ?? null };
		}
		return {
			state: 'refused',
			exit_code: 2,
			message: said,
			next: error.refusal?.next ?? null,
			observed: { code: error.code ?? null, classification: classified.kind },
		};
	}

	if (error instanceof EngineCrashedError) {
		// Never folded onto the nearest known outcome: an engine speaking a protocol this client
		// does not know is a fault to report, not a refusal to render.
		return { state: 'engine_fault', exit_code: error.exitCode ?? null, message: error.message, next: null };
	}

	return null;
}

const factsOf = (delta) => (Array.isArray(delta?.facts) ? delta.facts : []);

/**
 * Build the curation handlers.
 *
 * @param {object} deps
 * @param {object} deps.where       `{enginePath, root}` — the vault, resolved once at launch
 * @param {object} deps.cache       the listing cache, invalidated after every committed write
 * @param {object} deps.vocabulary  the parsed write contract, for the mode values and the fields
 * @param {object} deps.snapshots   the snapshot store. REQUIRED: a curation run is the one place a
 *        snapshot is load-bearing, and a build wired without one would promise a copy it never took
 * @param {object} deps.pending     the half-finished-merge store. REQUIRED for the same reason: the
 *        record is what makes "undo the merge" a button rather than a file the user has to find
 * @param {number|null} [deps.requestBytes]
 */
export function createCurationHandlers({ where, cache, vocabulary, snapshots, pending, requestBytes }) {
	if (typeof snapshots?.take !== 'function') {
		throw new TypeError(
			'the curation path needs a snapshot store: a curation run is the one place a snapshot is ' +
				'load-bearing, and a build wired without one would promise a copy it did not keep',
		);
	}
	if (typeof pending?.begin !== 'function') {
		throw new TypeError(
			'the curation path needs the half-finished-merge store: without it a merge whose second ' +
				'write fails has no record, and there is nothing to write the survivor back from',
		);
	}

	const fields = vocabulary?.fields ?? {};
	const closed = vocabulary?.closed ?? {};
	const limit = typeof requestBytes === 'number' && requestBytes > 0 ? requestBytes : 4 * 1024 * 1024;

	const load = (memoryId) =>
		loadForEdit(memoryId, { ...where, contractFields: fields, timeoutMs: WRITE_TIMEOUT_MS });

	/**
	 * One update, with the copy taken first and the effect checked afterwards.
	 *
	 * Shared by the rename loop and the merge's survivor write so the two cannot diverge on the
	 * snapshot, the version, the shortfall check or the verification — four things that are
	 * individually easy and collectively the whole of what makes a write trustworthy.
	 */
	async function writeOne({ memory_id, version_id, content_md, semantic_delta, operation }) {
		let kept;
		try {
			kept = await snapshots.take({ operation, memory_id, version_id });
		} catch (error) {
			if (!(error instanceof SnapshotFailedError)) throw error;
			// The write is NOT attempted. A spine that skipped when the disk was full would leave
			// every screen still saying a copy was kept.
			return {
				state: 'no_copy',
				message: error.message,
				observed: { directory: error.directory ?? null, vault_changed: false },
			};
		}

		const snapshot = snapshotReceipt(kept);

		// Projected again on the way out. `loadForEdit` already projected what it returned, and this
		// is what stops a field introduced by the rewrite from costing the whole call before
		// anything is written.
		const dropped = new Set();
		const projected = projectOntoContract(semantic_delta, 'semantic_delta', fields, dropped);
		const submitted = factsOf(projected).length;

		let result;
		try {
			result = await writeMemory(
				{
					mode: pickMode(closed, /^update/i),
					memory_id,
					expected_version_id: version_id,
					content_md,
					semantic_delta: projected,
				},
				{ ...where, timeoutMs: WRITE_TIMEOUT_MS },
			);
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			// The receipt travels on a refusal too: the copy was taken and the write did not happen,
			// so the store holds one more copy than the vault has versions.
			return { ...classified, snapshot, dropped_fields: [...dropped].sort() };
		}

		const outcome = describeWrite(result, { submitted_fact_count: submitted });
		if (outcome.verdict === 'committed') cache.invalidate();

		if (outcome.verdict !== 'committed') {
			return {
				state: 'refused',
				message:
					`The call finished without committing, so this memory is unchanged. The engine ` +
					`reported an effect of “${outcome.effect ?? 'nothing at all'}”.`,
				snapshot,
				write: outcome,
			};
		}

		// A committed write that stored fewer claims than it was sent is not a success, and the
		// shortfall is checked independently of the refusal list being present — a guard that can
		// only fire when a particular key arrives is a guard that fails open.
		if (outcome.partial || outcome.shortfall) {
			return {
				state: 'partial',
				message:
					'This memory was written and the store kept fewer facts than were sent. The run ' +
					'stopped here rather than carrying the same loss across the memories after it.',
				snapshot,
				write: outcome,
			};
		}

		return { state: 'written', snapshot, write: outcome, dropped_fields: [...dropped].sort() };
	}

	// -------------------------------------------------------------------------------------------
	// Unify a spelling — N updates, serially, stopping at the first refusal
	// -------------------------------------------------------------------------------------------

	/** One memory, rewritten and then checked. Returns a row of the report rather than throwing. */
	async function renameOne({ memory_id, seen_version_id = null }, { from, to }) {
		const row = { memory_id, title: null, state: 'refused', message: null, changes: [] };

		// ---- 1. THE RECORD, THROUGH THE LINEAGE DOOR, EVERY TIME ------------------------------
		//
		// Never from the listing and never from what the preview held. The display door does not
		// carry entity declarations and a payload rebuilt from it drops every one of them, silently,
		// with the write reporting success. This is also where the version comes from, read one call
		// before it is used.
		let record;
		try {
			record = await load(memory_id);
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			return { ...row, ...classified };
		}

		row.title = record.semantic_delta?.title ?? null;

		if (!record.version_id) {
			return {
				...row,
				state: 'already_gone',
				message: 'This memory could not be addressed, so there is nothing here to rewrite.',
				observed: { status: record.status ?? null },
			};
		}

		// ---- 2. WHAT THE USER AUTHORISED ------------------------------------------------------
		//
		// A different question from the version the write carries. The user approved a preview built
		// from what they were looking at; if the memory has moved since, the facts about to be
		// rewritten are not the facts they read. Refused here rather than sent.
		if (seen_version_id !== null && seen_version_id !== record.version_id) {
			return {
				...row,
				state: 'changed',
				message:
					'This memory was written to after the preview was built, so what would be rewritten ' +
					'is not what you approved.',
				observed: { seen_version_id, current_version_id: record.version_id },
			};
		}

		// ---- 3. THE REWRITE, IN ONE COMPOSED PAYLOAD -------------------------------------------
		//
		// The SAME function the preview ran. Facts and declarations move together or not at all.
		const rewritten = renameInDelta(record.semantic_delta ?? {}, { from, to });

		if (!rewritten.touched) {
			// The idempotence that makes resuming safe. A memory that already carries the surviving
			// spelling is reported and NOT written: a resume that re-sent the whole list would
			// otherwise mint a fresh version of every memory that already landed.
			return {
				...row,
				state: 'already_named',
				message: `This memory does not use “${from}”, so nothing was written to it.`,
				observed: { version_id: record.version_id },
			};
		}

		// ---- 4. THE POST-CONDITION, BEFORE THE CALL ---------------------------------------------
		//
		// When a memory declares at least one name, a fact naming something it does not declare is
		// refused on its own and the rest of the write commits. A rename cannot introduce one — both
		// ends of the rewrite move in the same payload — so this firing means the rewrite itself is
		// wrong, and the right thing to do with a wrong rewrite is not to send it.
		const before = undeclaredEndpoints(record.semantic_delta ?? {});
		const after = undeclaredEndpoints(rewritten.delta);
		const introduced = after.undeclared.filter((surface) => !before.undeclared.includes(surface));
		if (introduced.length > 0) {
			return {
				...row,
				state: 'endpoint_check_failed',
				message:
					`Rewriting “${from}” to “${to}” here would leave ${introduced.join(', ')} named by a ` +
					`fact and declared by nothing, and this memory declares ${after.declares}. The store ` +
					`drops such facts and reports the write as successful, so nothing was sent.`,
				observed: { introduced, declares: after.declares },
			};
		}

		// ---- 5. THE COPY, THEN THE CALL, THEN THE CHECK -----------------------------------------
		const result = await writeOne({
			memory_id,
			version_id: record.version_id,
			content_md: record.content_md,
			semantic_delta: rewritten.delta,
			operation: 'update',
		});

		const common = {
			...row,
			changes: rewritten.changes,
			statements: rewritten.statements,
			collapsed_facts: rewritten.collapsed_facts,
			merged_declarations: rewritten.merged_declarations,
			untouched_mentions: rewritten.untouched,
			snapshot: result.snapshot ?? null,
		};

		if (result.state !== 'written') {
			return { ...common, ...result, state: result.state };
		}

		// ---- 6. VERIFY --------------------------------------------------------------------------
		//
		// One more exact-id read, which records nothing. This is what turns "the call returned
		// success" into "the vault is on the version this write produced" — the same claim the
		// removal path pays a read for, and for the same reason.
		let after_read = null;
		try {
			after_read = await readMemory(memory_id, { ...where, timeoutMs: WRITE_TIMEOUT_MS });
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			return {
				...common,
				state: 'unverified',
				message: `The rewrite committed and the check afterwards could not be read: ${classified.message}`,
				write: result.write,
			};
		}

		const landed = after_read?.version_id ?? null;
		if (landed !== (result.write?.version_id ?? null)) {
			return {
				...common,
				state: 'unverified',
				message:
					'The rewrite reported a committed effect and reading the memory back returns a ' +
					'different version from the one it produced.',
				write: result.write,
				observed: { produced_version_id: result.write?.version_id ?? null, reads_as: landed },
			};
		}

		return {
			...common,
			state: 'rewritten',
			message: null,
			write: result.write,
			observed: {
				replaced_version_id: record.version_id,
				new_version_id: landed,
				facts_rewritten: rewritten.changes.length,
			},
		};
	}

	/** `POST /api/renames` — one run, serial, stopping at the first refusal. */
	async function handleRenames(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		const from = typeof body?.from === 'string' ? body.from : '';
		const to = typeof body?.to === 'string' ? body.to : '';
		if (from.length === 0 || to.length === 0) {
			return sendSidecarError(
				res,
				400,
				'no-names',
				'A rename names the spelling being retired and the one that survives. Nothing was written.',
			);
		}
		if (from === to) {
			return sendSidecarError(
				res,
				400,
				'same-name',
				`“${from}” and the surviving spelling are the same string, so this run would write every ` +
					'named memory and change nothing. Nothing was written.',
			);
		}

		const requested = Array.isArray(body?.items) ? body.items : null;
		if (requested === null || requested.length === 0) {
			return sendSidecarError(
				res,
				400,
				'no-items',
				'A rename run names the memories it will write. Nothing was read, written or changed.',
			);
		}
		if (requested.length > MAX_ITEMS_PER_RUN) {
			return sendSidecarError(
				res,
				400,
				'too-many-items',
				`This run names ${requested.length} memories and one run carries at most ` +
					`${MAX_ITEMS_PER_RUN}. Each rewrite is a separate call, so a very long run mostly ` +
					`stops partway; several shorter runs are the same work with a report you can read. ` +
					`Nothing was written.`,
				{ limit: MAX_ITEMS_PER_RUN },
			);
		}
		for (const item of requested) {
			if (typeof item?.memory_id !== 'string' || item.memory_id.length === 0) {
				return sendSidecarError(
					res,
					400,
					'item-names-no-memory',
					'Every item in a rename run names one memory. Nothing was written.',
				);
			}
		}

		const items = [];
		let stopped = false;

		for (const item of requested) {
			if (stopped) {
				// Named and listed rather than dropped. "The run stopped above this one" is a state
				// the user can act on; a missing row is not.
				items.push({
					memory_id: item.memory_id,
					seen_version_id: item.seen_version_id ?? null,
					title: null,
					state: 'not_attempted',
					message: null,
					changes: [],
				});
				continue;
			}
			const outcome = await renameOne(item, { from, to });
			items.push({ ...outcome, seen_version_id: item.seen_version_id ?? null });
			if (!CONTINUES.includes(outcome.state)) stopped = true;
		}

		const rewritten = items.filter((item) => item.state === 'rewritten').length;

		// WHAT IS LEFT, ready to be re-posted once the conflict is resolved. It carries the item the
		// run stopped on and everything after it, and nothing that landed — so a resume never
		// rewrites a memory that already carries the surviving spelling. The `already_named` guard in
		// `renameOne` makes that safe even against a caller that re-sends the whole list.
		const unfinished = items.filter((item) => !CONTINUES.includes(item.state));
		const resume =
			unfinished.length === 0
				? null
				: {
						from,
						to,
						items: unfinished.map((item) => ({
							memory_id: item.memory_id,
							// The version the user was looking at is deliberately DROPPED from a resume
							// item: the memory has moved since — that is usually why the run stopped —
							// and carrying the stale one forward would refuse the resume for the same
							// reason twice. The user re-approves a preview built from the new state.
							seen_version_id: null,
						})),
					};

		sendJson(res, 200, {
			outcome: 'ran',
			operation: 'unify-spelling',
			from,
			to,
			requested: requested.length,
			rewritten,
			stopped,
			// Never one success line and never one failure line. The rows are the report, and the
			// boundary between what landed and what was never attempted is readable from them.
			items,
			// Every copy this run took, in the order taken, so the user can see what was captured
			// before each write rather than being told that copies exist.
			snapshots: items.map((item) => item.snapshot).filter(Boolean),
			resume,
			restore_available: false,
			cache: cache.status(),
		});
	}

	// -------------------------------------------------------------------------------------------
	// Merge two memories — the survivor is written FIRST
	// -------------------------------------------------------------------------------------------

	/**
	 * `POST /api/merges` — update the survivor, then remove the duplicate.
	 *
	 * ORDERING IS NOT A PREFERENCE, AND THIS IS THE WHOLE ARGUMENT.
	 *
	 * Update-then-delete, on a failure of the second write, leaves TWO memories where the user asked
	 * for one: the survivor holds both memories' content and the duplicate is still there. That is
	 * redundant, visible on any screen that lists memories, and repaired by retrying one call.
	 *
	 * Delete-then-update, on a failure of the second write, leaves content that is no longer served
	 * and never reached the survivor. There is no un-delete operation on the published surface, so
	 * that content is recoverable only from a copy this app took — a file the user has to find and
	 * hand to an import door that refuses it. Lost, invisible, and expensive.
	 *
	 * The failure states are asymmetric and the safe one costs a retry, so the order is fixed here
	 * and there is no argument that reaches this function.
	 */
	async function handleMerge(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		const survivorId = typeof body?.survivor?.memory_id === 'string' ? body.survivor.memory_id : '';
		const duplicateId = typeof body?.duplicate?.memory_id === 'string' ? body.duplicate.memory_id : '';
		if (survivorId.length === 0 || duplicateId.length === 0) {
			return sendSidecarError(
				res,
				400,
				'merge-names-two-memories',
				'A merge names the memory that survives and the memory that is removed. Nothing was written.',
			);
		}
		if (survivorId === duplicateId) {
			return sendSidecarError(
				res,
				400,
				'merge-names-one-memory',
				'A merge names two different memories. Nothing was written.',
			);
		}
		if (!body?.survivor?.semantic_delta) {
			return sendSidecarError(
				res,
				400,
				'merge-carries-no-composition',
				'A merge carries the composed survivor — the body and the structure a person approved ' +
					'in the preview. This server does not compose one on the user’s behalf. Nothing was ' +
					'written.',
			);
		}

		// ---- the composition's own check, before anything is written ---------------------------
		//
		// A merge is the one action that combines two fact sets AND two declaration lists. Fold in
		// the other memory's facts and forget its declarations and the write commits with those
		// facts absent from the stored record. This is the most likely way to lose data in this
		// product, so the check runs here as well as in the browser.
		const endpoints = undeclaredEndpoints(body.survivor.semantic_delta);
		if (endpoints.declares > 0 && endpoints.undeclared.length > 0) {
			return sendSidecarError(
				res,
				400,
				'composed-endpoints-undeclared',
				`The composed survivor declares ${endpoints.declares} named things and writes facts ` +
					`about ${endpoints.undeclared.join(', ')}, which it declares none of. The store drops ` +
					`those facts and reports the write as successful, so nothing was sent.`,
				{ undeclared: endpoints.undeclared, declares: endpoints.declares },
			);
		}

		// ---- both records, read one call before they are used ----------------------------------
		let survivor;
		let duplicate;
		try {
			[survivor, duplicate] = await Promise.all([load(survivorId), load(duplicateId)]);
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			return sendJson(res, 200, {
				outcome: 'ran',
				operation: 'merge',
				survivor_id: survivorId,
				duplicate_id: duplicateId,
				steps: [{ step: 'read', ...classified }],
				complete: false,
				pending: null,
			});
		}

		for (const [what, record] of [
			['survivor', survivor],
			['duplicate', duplicate],
		]) {
			if (!record.version_id) {
				return sendSidecarError(
					res,
					400,
					'merge-target-unaddressable',
					`The ${what} could not be addressed, so this merge was not started. Nothing was written.`,
				);
			}
		}

		const seenSurvivor = body.survivor.seen_version_id ?? null;
		const seenDuplicate = body.duplicate.seen_version_id ?? null;
		for (const [what, seen, current] of [
			['survivor', seenSurvivor, survivor.version_id],
			['duplicate', seenDuplicate, duplicate.version_id],
		]) {
			if (seen !== null && seen !== current) {
				return sendJson(res, 200, {
					outcome: 'ran',
					operation: 'merge',
					survivor_id: survivorId,
					duplicate_id: duplicateId,
					steps: [
						{
							step: 'read',
							state: 'changed',
							message:
								`The ${what} was written to while this merge was being composed, so the ` +
								'composition is not of what is in the vault now. Nothing was written.',
							observed: { seen_version_id: seen, current_version_id: current },
						},
					],
					complete: false,
					pending: null,
				});
			}
		}

		// ---- the record, BEFORE the first call --------------------------------------------------
		//
		// It carries the survivor's payload from before the write, which is the only thing that can
		// put the survivor back: no published door returns a prior version.
		let record;
		try {
			record = await pending.begin({
				survivor_id: survivorId,
				survivor_version: survivor.version_id,
				survivor_payload_before: {
					content_md: survivor.content_md,
					semantic_delta: survivor.semantic_delta,
				},
				survivor_payload_after: {
					content_md: body.survivor.content_md ?? survivor.content_md,
					semantic_delta: body.survivor.semantic_delta,
				},
				duplicate_id: duplicateId,
				duplicate_version: duplicate.version_id,
				duplicate_title: duplicate.semantic_delta?.title ?? null,
				survivor_title: survivor.semantic_delta?.title ?? null,
			});
		} catch (error) {
			if (!(error instanceof PendingMergeError)) throw error;
			return sendSidecarError(res, 409, error.kind, error.message);
		}

		const steps = [];

		// ---- WRITE 1 — the survivor ------------------------------------------------------------
		const written = await writeOne({
			memory_id: survivorId,
			version_id: survivor.version_id,
			content_md: body.survivor.content_md ?? survivor.content_md,
			semantic_delta: body.survivor.semantic_delta,
			operation: 'update',
		});
		steps.push({ step: 'update-survivor', memory_id: survivorId, ...written });

		if (written.state !== 'written') {
			// Nothing landed, so there is nothing half-finished. The record is cleared rather than
			// left to raise a banner about a merge that never started.
			await pending.clear();
			return sendJson(res, 200, {
				outcome: 'ran',
				operation: 'merge',
				survivor_id: survivorId,
				duplicate_id: duplicateId,
				steps,
				complete: false,
				// Said explicitly, and ONLY when it is true. A refused write left both memories
				// exactly as they were, which is the good failure and the reason the survivor is
				// written first. A PARTIAL write did not: the survivor committed and the store kept
				// fewer facts than were sent, so claiming both memories are intact there would be
				// this server reassuring the user about a state it had just caused.
				both_memories_intact: written.state !== 'partial',
				pending: null,
				restore_available: false,
				cache: cache.status(),
			});
		}

		record = await pending.advance('survivor_written', {
			survivor_new_version: written.write?.version_id ?? null,
		});

		// ---- WRITE 2 — the duplicate -----------------------------------------------------------
		//
		// Its version is re-read here rather than carried from the top: the survivor's write took
		// time, and on a vault an agent is writing to, the version read a moment ago is a version
		// that may already have moved.
		let removed;
		try {
			const fresh = await readMemory(duplicateId, { ...where, timeoutMs: WRITE_TIMEOUT_MS });
			const version = fresh?.version_id ?? null;
			if (fresh?.status !== 'found' || !version) {
				removed = {
					state: 'already_gone',
					message: `The read door reports the duplicate as “${fresh?.status ?? 'nothing at all'}”.`,
				};
			} else {
				let kept;
				try {
					kept = await snapshots.take({ operation: 'remove', memory_id: duplicateId, version_id: version });
				} catch (error) {
					if (!(error instanceof SnapshotFailedError)) throw error;
					removed = { state: 'no_copy', message: error.message };
				}
				if (!removed) {
					const result = await writeMemory(
						{ mode: pickMode(closed, /^delete/i), memory_id: duplicateId, expected_version_id: version },
						{ ...where, timeoutMs: WRITE_TIMEOUT_MS },
					);
					const effect = result?.data?.canonical_effect ?? null;
					removed =
						result?.exit_code === 0 && effect === 'committed'
							? { state: 'removed', snapshot: snapshotReceipt(kept), observed: { replaced_version_id: version } }
							: {
									state: 'refused',
									message:
										'The call finished without committing a removal, so the duplicate is still ' +
										'being served.',
									snapshot: snapshotReceipt(kept),
									observed: { exit_code: result?.exit_code ?? null, canonical_effect: effect },
								};
					if (removed.state === 'removed') cache.invalidate();
				}
			}
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			removed = classified;
		}

		steps.push({ step: 'remove-duplicate', memory_id: duplicateId, ...removed });

		const complete = removed.state === 'removed' || removed.state === 'already_gone';
		if (complete) await pending.clear();

		sendJson(res, 200, {
			outcome: 'ran',
			operation: 'merge',
			survivor_id: survivorId,
			duplicate_id: duplicateId,
			// The order is in the report, not only in the code. A reader of this response can see
			// which write went first without reading this file.
			steps,
			complete,
			// The state this design exists to make survivable, named for the user rather than left to
			// be inferred from two step rows.
			half_finished: complete
				? null
				: {
						state: 'survivor_written',
						heading: 'Half-finished merge',
						sentence:
							`“${record.survivor_title ?? survivorId}” now holds both memories’ content, and ` +
							`“${record.duplicate_title ?? duplicateId}” is still here.`,
					},
			pending: complete ? null : { state: record.state, survivor_id: survivorId, duplicate_id: duplicateId },
			snapshots: steps.map((step) => step.snapshot).filter(Boolean),
			restore_available: false,
			cache: cache.status(),
		});
	}

	// -------------------------------------------------------------------------------------------
	// The half-finished merge: read it, finish it, or undo it
	// -------------------------------------------------------------------------------------------

	/** `GET /api/pending-merge` — what the banner at launch is built from. Writes nothing. */
	async function handlePending(req, res) {
		const held = await pending.read();
		sendJson(res, 200, {
			outcome: 'read',
			pending: held,
			// The two actions, named on the door, so the banner does not invent a third.
			actions: held ? ['finish', 'undo'] : [],
			file: pending.file,
		});
	}

	/** `POST /api/pending-merge` — `{action: "finish"}` or `{action: "undo"}`. */
	async function handlePendingAction(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		const action = body?.action;
		if (action !== 'finish' && action !== 'undo') {
			return sendSidecarError(
				res,
				400,
				'unknown-action',
				`A half-finished merge is finished or undone. This route was asked for “${action}”. ` +
					'Nothing was written.',
			);
		}

		const held = await pending.read();
		if (!held) {
			return sendSidecarError(
				res,
				404,
				'no-pending-merge',
				'There is no half-finished merge in this vault’s record. Nothing was written.',
			);
		}

		if (action === 'finish') {
			// Re-read the duplicate's version and retry the removal. The ordinary case: the removal
			// was refused for a stale version or a busy vault, and both are correctable.
			const fresh = await readMemory(held.duplicate_id, { ...where, timeoutMs: WRITE_TIMEOUT_MS });
			const version = fresh?.version_id ?? null;
			if (fresh?.status !== 'found' || !version) {
				await pending.clear();
				return sendJson(res, 200, {
					outcome: 'ran',
					action,
					state: 'already_gone',
					message: 'The duplicate is no longer being served, so this merge is finished.',
				});
			}

			let kept;
			try {
				kept = await snapshots.take({ operation: 'remove', memory_id: held.duplicate_id, version_id: version });
			} catch (error) {
				if (!(error instanceof SnapshotFailedError)) throw error;
				return sendSidecarError(res, 500, error.kind, error.message, { vault_changed: false });
			}

			let result;
			try {
				result = await writeMemory(
					{ mode: pickMode(closed, /^delete/i), memory_id: held.duplicate_id, expected_version_id: version },
					{ ...where, timeoutMs: WRITE_TIMEOUT_MS },
				);
			} catch (error) {
				const classified = classifyThrown(error);
				if (!classified) throw error;
				return sendJson(res, 200, {
					outcome: 'ran',
					action,
					...classified,
					snapshot: snapshotReceipt(kept),
					pending: held,
				});
			}

			const effect = result?.data?.canonical_effect ?? null;
			if (result?.exit_code !== 0 || effect !== 'committed') {
				return sendJson(res, 200, {
					outcome: 'ran',
					action,
					state: 'refused',
					message: 'The call finished without committing, so the duplicate is still being served.',
					snapshot: snapshotReceipt(kept),
					pending: held,
				});
			}

			cache.invalidate();
			await pending.clear();
			return sendJson(res, 200, {
				outcome: 'ran',
				action,
				state: 'removed',
				snapshot: snapshotReceipt(kept),
				pending: null,
				cache: cache.status(),
			});
		}

		// ---- undo: write the survivor's payload from before the merge back ----------------------
		//
		// Possible only because the record stored it. This is not an engine undo and the response
		// says so: it is a third write, it produces a NEW version, and the merged version stays in
		// the memory's history.
		const fresh = await load(held.survivor_id);
		const written = await writeOne({
			memory_id: held.survivor_id,
			version_id: fresh.version_id,
			content_md: held.survivor_payload_before?.content_md,
			semantic_delta: held.survivor_payload_before?.semantic_delta,
			operation: 'update',
		});

		if (written.state !== 'written') {
			return sendJson(res, 200, {
				outcome: 'ran',
				action,
				...written,
				pending: held,
				message:
					written.message ??
					'The survivor could not be written back, so this merge is still half-finished.',
			});
		}

		await pending.clear();
		sendJson(res, 200, {
			outcome: 'ran',
			action,
			state: 'undone',
			// Said plainly rather than implied by the word "undo": this is a new version carrying the
			// old content, and both memories are now being served again.
			message:
				'The survivor was written back to the content it had before the merge. That is a new ' +
				'version carrying the old content, not a removal of the merged one.',
			snapshot: written.snapshot,
			write: written.write,
			pending: null,
			cache: cache.status(),
		});
	}

	return {
		handleRenames,
		handleMerge,
		handlePending,
		handlePendingAction,
		renameOne,
		max_items: MAX_ITEMS_PER_RUN,
	};
}
