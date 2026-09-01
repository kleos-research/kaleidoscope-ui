/**
 * The removal path, and the two claims it exists to keep apart.
 *
 * **"The call returned success" and "the memory is actually removed" are different claims.** Only
 * the second one is what a user cares about, and it costs one extra non-writing read per item to
 * turn the first into the second. This module always pays it.
 *
 * **"Removed" and "erased" are different claims too.** The engine's own contract calls this mode a
 * *logical* delete: the record is marked, the listing and export doors stop serving it, and the
 * text stays on disk inside the vault folder. Nothing in this module can change that, so nothing in
 * the product may say otherwise — the sentences live in `src/app/removal-model.mjs` and are checked
 * by a test rather than by a reviewer.
 *
 * ---------------------------------------------------------------------------------------------
 * THERE IS NO BATCH DELETE, AND THAT SHAPES EVERYTHING BELOW
 * ---------------------------------------------------------------------------------------------
 *
 * `remember` batches CREATES only. Removing twelve memories is twelve separate calls, each
 * carrying its own `memory_id` and its own `expected_version_id`, against a vault that agents may
 * be writing to while the run is in flight — which is the normal case for this product, not the
 * edge case. So:
 *
 *   1. **each call re-reads its own version immediately beforehand**, through the exact-id read
 *      door. Never from the listing cache and never from the top of the run: on a vault under
 *      concurrent writes, a version read minutes ago is a version that may already be stale, and a
 *      refusal the user did not cause is a refusal they cannot act on;
 *   2. the request carries `mode`, `memory_id` and `expected_version_id` and **nothing else**. A
 *      naive implementation that echoes back the record it just loaded is refused by the contract
 *      — measured: `delete must omit content_md` — which is fortunate, because the failure mode of
 *      it being accepted would be worse;
 *   3. the branch is on the **exit code**, never on stderr. A resolved call writes to stderr on
 *      success, so a wrapper that treats stderr as failure fails on every successful call;
 *   4. **verify**, with one more exact-id read, that the body is absent;
 *   5. run **serially** and **stop at the first refusal**. Pushing past one to "get the rest done"
 *      is wrong on this vault specifically: a moved version usually means somebody else is working
 *      in here right now, and the remaining items are the ones most likely to be wrong.
 *
 * A partial run is therefore a normal outcome of the design rather than an incident, and the report
 * is the deliverable — one row per selected memory, in the order attempted. A single "Removed 12
 * memories" over a run where four were refused is a false statement about the user's own data, and
 * the user has no other instrument to catch it with.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SNAPSHOT, AND THE ONE PATH THAT MUST NOT TAKE ONE
 * ---------------------------------------------------------------------------------------------
 *
 * Every removal is preceded by a snapshot, on the same spine as every other write, and a snapshot
 * that fails stops the write.
 *
 * The exception is the escalation path — the removal a user starts from "What removal cannot do",
 * because a credential is in the memory. A snapshot there would be a fresh plaintext copy of
 * exactly the secret they are trying to be rid of, written outside the vault where vault deletion
 * will never find it. So `escalated` suppresses the CAPTURE and not the RECORD: the store still
 * writes a header saying the bytes were not kept and why. The spine never skips silently.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS MODULE NEVER CALLS
 * ---------------------------------------------------------------------------------------------
 *
 * A ranked search. There are zero callers of that door in this repository and this file does not
 * add the first one: `readMemory` addresses a memory by id and records nothing, and that is the
 * only read here. `test/removal.test.mjs` counts the vault's exposure records before and after a
 * whole removal run and asserts the number did not move.
 */

import { EngineCrashedError, EngineRefusedError, EngineUnlicensedError } from '../engine/errors.mjs';
import { readMemory, writeMemory } from '../engine/memory.mjs';
import { sendJson, sendSidecarError } from './respond.mjs';
import { SnapshotFailedError } from './snapshots.mjs';
import { classifyRefusal, pickMode, readJsonBody, snapshotReceipt } from './write.mjs';

/**
 * How many memories one run may carry.
 *
 * The design is serial and stop-on-refusal by choice, so a run of several hundred against a vault
 * under concurrent writes stops partway more often than not — a large cleanup is several runs, and
 * that is accepted. The cap is here so a request that asks for thousands is refused with a sentence
 * rather than held open for an hour, and it is a number this server publishes rather than a
 * surprise the user meets at item 101.
 */
export const MAX_ITEMS_PER_RUN = 100;

/** A removal writes and folds a graph. It is not a read, and its timeout is not a read's. */
const REMOVAL_TIMEOUT_MS = 120_000;

/**
 * The reason the escalation path gives the snapshot store for keeping no bytes.
 *
 * Written into the header, so a person reading the store later can tell a suppressed copy from a
 * missing one.
 */
export const ESCALATION_SUPPRESSION =
	'started from “What removal cannot do”, where a copy outside the vault would be a fresh ' +
	'plaintext copy of the thing being removed';

/**
 * Vault contention, told apart from every other refusal.
 *
 * A pattern that stops matching degrades to a plain refusal carrying the engine's own sentence,
 * which blocks nothing and misleads nobody — the report says "the engine declined" and quotes it.
 * That is the right failure for a classifier: guessing would offer a retry button beside something
 * retrying cannot fix.
 */
const VAULT_BUSY = /\b(lock|locked|busy|another process|in use|contended|would block)\b/i;

/**
 * THE DELETE REQUEST, AND IT IS A PURE FUNCTION SO ITS SHAPE CAN BE ASSERTED.
 *
 * Three keys. No `content_md`, no `semantic_delta`, nothing carried over from the record that was
 * read a moment ago. The engine refuses a delete that carries a body — `delete must omit
 * content_md` — so an implementation that echoed the loaded record back would fail loudly, but the
 * guarantee belongs here rather than in the engine's error message: this is the one function whose
 * output is the whole of what reaches the vault, and a test asserts its exact key set.
 *
 * @param {{mode: string, memory_id: string, expected_version_id: string}} what
 */
export function deleteRequest({ mode, memory_id, expected_version_id }) {
	if (typeof mode !== 'string' || mode.length === 0) throw new TypeError('a removal needs a mode');
	if (typeof memory_id !== 'string' || memory_id.length === 0) {
		throw new TypeError('a removal names one memory');
	}
	if (typeof expected_version_id !== 'string' || expected_version_id.length === 0) {
		throw new TypeError(
			'a removal must carry the version it expects to replace: without it the engine cannot ' +
				'refuse a write against a memory that has changed since it was read',
		);
	}
	return { mode, memory_id, expected_version_id };
}

/**
 * What one thrown engine error means for one item.
 *
 * The three classes PRD 0004 R8 requires are separated here, and the engine's own sentence travels
 * beside every one of them. None is reported as "removal failed": two of them are retryable and one
 * is about a key.
 */
function classifyThrown(error) {
	if (error instanceof EngineUnlicensedError) {
		// Exit 4, with stdout EMPTY by design. Reporting it as a crash or a parse error sends the
		// user looking for a broken install instead of running one command.
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
			observed: { code: error.code ?? null },
		};
	}

	if (error instanceof EngineCrashedError) {
		// Never folded onto the nearest known outcome. An engine speaking a protocol this client does
		// not know is a fault to report, not a refusal to render.
		return {
			state: 'engine_fault',
			exit_code: error.exitCode ?? null,
			message: error.message,
			next: null,
		};
	}

	return null;
}

/**
 * Build the removal handler.
 *
 * @param {object} deps
 * @param {object} deps.where       `{enginePath, root}` — the vault, resolved once at launch
 * @param {object} deps.cache       the listing cache, invalidated after every committed removal
 * @param {object} deps.vocabulary  the parsed write contract, for the mode value
 * @param {object} deps.snapshots   the snapshot store. REQUIRED, for the same reason the write path
 *        requires one: a removal path assembled without it would promise a copy it never took.
 * @param {number|null} [deps.requestBytes]
 */
export function createRemovalHandlers({ where, cache, vocabulary, snapshots, requestBytes }) {
	if (typeof snapshots?.take !== 'function') {
		throw new TypeError(
			'the removal path needs a snapshot store: every removal is preceded by a snapshot, and a ' +
				'build wired without one would promise a copy it did not keep',
		);
	}

	const closed = vocabulary?.closed ?? {};
	const limit = typeof requestBytes === 'number' && requestBytes > 0 ? requestBytes : 4 * 1024 * 1024;

	/**
	 * One memory, removed and then checked.
	 *
	 * Returns a row of the report rather than throwing, because every outcome here is something the
	 * user has to see per item. The one thing it does not do is decide whether the run continues —
	 * that is the loop's decision, made on `state`.
	 */
	async function removeOne({ memory_id, seen_version_id = null }, { escalated }) {
		const row = { memory_id, title: null, state: 'refused', message: null, next: null };

		// ---- 1. THE VERSION, READ HERE AND NOWHERE ELSE -----------------------------------------
		//
		// Through the exact-id read door, immediately before the call, on every item. This is the
		// door that records nothing — no ranked query runs, so no exposure row is written.
		let before;
		try {
			before = await readMemory(memory_id, { ...where, timeoutMs: REMOVAL_TIMEOUT_MS });
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			return { ...row, ...classified };
		}

		const status = before?.status ?? null;
		const version_id = before?.version_id ?? null;
		row.title = before?.title ?? null;

		if (status !== 'found' || !version_id) {
			// A memory that has already left is not a failure of this run and not a success of it
			// either. Reported as its own state, with what the door actually said.
			return {
				...row,
				state: 'already_gone',
				message: `The read door reports this memory as “${status ?? 'nothing at all'}”.`,
				observed: { status, version_id },
			};
		}

		// ---- 2. WHAT THE USER AUTHORISED --------------------------------------------------------
		//
		// The version above is what the write will carry. This is a different question: the user
		// selected a memory they were looking at, and if it has moved since, they are authorising the
		// removal of something they have not read. That is refused here rather than sent, and it is
		// the one refusal in this file the engine never sees.
		if (seen_version_id !== null && seen_version_id !== version_id) {
			return {
				...row,
				state: 'changed',
				message:
					'This memory was written to after you selected it, so what would be removed is not ' +
					'what you read.',
				observed: { seen_version_id, current_version_id: version_id },
			};
		}

		// ---- 3. THE COPY, BEFORE THE VAULT MOVES ------------------------------------------------
		//
		// It has to happen before the removal and not after: the export door omits a removed memory
		// entirely, so a snapshot attempted afterwards would find nothing to copy.
		let kept;
		try {
			kept = await snapshots.take({
				memory_id,
				version_id,
				operation: 'remove',
				suppressed: escalated ? ESCALATION_SUPPRESSION : null,
			});
		} catch (error) {
			if (!(error instanceof SnapshotFailedError)) throw error;
			return {
				...row,
				state: 'no_copy',
				message: error.message,
				observed: { directory: error.directory ?? null, vault_changed: false },
			};
		}
		row.snapshot = snapshotReceipt(kept);

		// ---- 4. THE CALL ------------------------------------------------------------------------
		let result;
		try {
			result = await writeMemory(
				deleteRequest({
					mode: pickMode(closed, /^delete/i),
					memory_id,
					expected_version_id: version_id,
				}),
				{ ...where, timeoutMs: REMOVAL_TIMEOUT_MS },
			);
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			// The snapshot receipt travels on a refusal too. The copy was taken and the write did not
			// happen, so the store holds one more copy than the vault has versions, and a report that
			// mentioned snapshots only on success would leave that unexplained.
			return { ...row, ...classified };
		}

		// ---- 5. THE EXIT CODE AND THE EFFECT, NEVER STDERR --------------------------------------
		const effect = result?.data?.canonical_effect ?? null;
		if (result?.exit_code !== 0 || effect !== 'committed') {
			return {
				...row,
				state: 'refused',
				message:
					'The call finished without committing a removal, so this memory is still being ' +
					'served. Nothing about it changed.',
				observed: { exit_code: result?.exit_code ?? null, canonical_effect: effect },
			};
		}

		// The vault moved, so the listing this server holds is stale — whatever the verification
		// below concludes. Invalidating only on a verified removal would leave a committed write
		// invisible to every screen.
		cache.invalidate();

		// ---- 6. VERIFY ---------------------------------------------------------------------------
		//
		// One more exact-id read. This is the step that converts "the call returned success" into
		// "the memory is actually removed", and it is the difference this whole flow exists to
		// insist on. The body must be ABSENT — withheld, not blanked — and the record must say it is
		// no longer being served.
		let after;
		try {
			after = await readMemory(memory_id, { ...where, timeoutMs: REMOVAL_TIMEOUT_MS });
		} catch (error) {
			const classified = classifyThrown(error);
			if (!classified) throw error;
			return {
				...row,
				state: 'unverified',
				message:
					`The removal committed and the check afterwards could not be read: ${classified.message}`,
				observed: { removed_version_id: result.data?.version_id ?? null },
			};
		}

		const bodyPresent = typeof after?.content_md === 'string';
		if (bodyPresent || after?.status === 'found') {
			return {
				...row,
				state: 'unverified',
				message:
					'The call reported that the removal committed, and reading this memory back still ' +
					'returns it.',
				observed: {
					status: after?.status ?? null,
					body_present: bodyPresent,
					removed_version_id: result.data?.version_id ?? null,
				},
			};
		}

		return {
			...row,
			state: 'removed',
			message: null,
			// Both versions: the one the removal replaced, and the one the removal produced. The
			// second is the handle the record now sits at, and it is the only thing that still
			// reaches it.
			observed: {
				replaced_version_id: version_id,
				removed_version_id: result.data?.version_id ?? null,
				// The two doors, as this server observed them a moment ago rather than as it assumes
				// them. A number carries the evidence that the thing it claims was actually checked.
				status: after?.status ?? null,
				body_present: false,
			},
		};
	}

	/**
	 * `POST /api/removals` — one run, serial, stopping at the first refusal.
	 *
	 * ONE ROUTE FOR ONE MEMORY AND FOR MANY, which is not a shortcut: a single removal that took a
	 * different path from a bulk one would be a second implementation of the version re-read, the
	 * snapshot and the verification, and the two would drift. The report shape is the same either
	 * way; the screen renders one item as a receipt and several as a run report.
	 */
	async function handleRemovals(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		const requested = Array.isArray(body?.items) ? body.items : null;
		if (requested === null || requested.length === 0) {
			return sendSidecarError(
				res,
				400,
				'no-items',
				'A removal run names the memories it is about. Nothing was read, written or changed.',
			);
		}

		if (requested.length > MAX_ITEMS_PER_RUN) {
			return sendSidecarError(
				res,
				400,
				'too-many-items',
				`This run names ${requested.length} memories and one run carries at most ` +
					`${MAX_ITEMS_PER_RUN}. Each removal is a separate call, so a very long run mostly ` +
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
					'Every item in a removal run names one memory. Nothing was written.',
				);
			}
		}

		const escalated = body?.escalated === true;

		const items = [];
		let stopped = false;

		for (const item of requested) {
			if (stopped) {
				// Named and listed rather than dropped. The user selected it, and "the run stopped
				// above this" is a state they can act on; silence is not.
				items.push({
					memory_id: item.memory_id,
					title: null,
					state: 'not_attempted',
					message: null,
				});
				continue;
			}

			const outcome = await removeOne(item, { escalated });
			items.push(outcome);
			// STOP ON THE FIRST REFUSAL. See the note at the top of this file: the remaining items are
			// the ones most likely to be wrong.
			if (outcome.state !== 'removed') stopped = true;
		}

		const removed = items.filter((item) => item.state === 'removed').length;

		sendJson(res, 200, {
			outcome: 'ran',
			// On the response as well as in the request, so a report rendered later still says whether
			// this run was the one that deliberately kept no copies.
			escalated,
			requested: requested.length,
			removed,
			stopped,
			// Never one success line and never one failure line. The rows are the report.
			items,
			// Said on the door as well as in the copy: no published operation returns a removed memory
			// to service in the vault it left. See docs/RESTORE-EXPERIMENT.md.
			restore_available: false,
			cache: cache.status(),
		});
	}

	return { handleRemovals, removeOne, max_items: MAX_ITEMS_PER_RUN };
}
