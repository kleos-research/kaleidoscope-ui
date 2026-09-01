/**
 * The write path, and the three things it exists to stop.
 *
 * M2 was read-only and said so in its method allowlist. This module is the whole of what makes the
 * sidecar able to change a vault, and every function in it is shaped by one asymmetry: **an edit
 * made to improve a memory can leave it worse, and the door reports success either way.**
 *
 * Three concrete ways, all measured against the shipped engine:
 *
 * 1. **The door that DISPLAYS a memory does not return its entity declarations, and the write
 *    requires them.** An update assembled from the display door's response commits — exit 0, no
 *    refusal, no warning — having deleted every named thing the memory declared. So the edit load
 *    goes through the lineage door, via `loadForEdit`, and there is no other route in this file to
 *    a record an update is built from.
 *
 * 2. **A write can commit having stored fewer facts than it was sent.** When a memory declares at
 *    least one named thing, a fact naming something it does not declare is refused ON ITS OWN and
 *    the rest of the write commits. The response lists what it refused in a key that is **absent
 *    entirely when it refused nothing** — so absence is never a failure signal, presence is never
 *    an error, and a client that branches on the exit code renders "Saved" over a third of the
 *    user's work having been dropped. `describeWrite` reads that key on every write and reports a
 *    partial as a partial.
 *
 * 3. **A shortfall is checked independently of that key.** A guard that can only fire when a
 *    particular key is present is a guard that fails open. So the count of stored claims the
 *    response reports is compared against the number of facts submitted, on every committed write,
 *    whether or not a refusal list arrived.
 *
 * Nothing here interprets a refusal on the user's behalf. A refusal is CLASSIFIED — so the browser
 * can render the right control beside the right field — and the engine's own sentence travels
 * beside the classification, whole, because the engine's text names the repair and a paraphrase of
 * it does not.
 *
 * **EVERY WRITE IS PRECEDED BY A SNAPSHOT, AND A SNAPSHOT THAT FAILS STOPS THE WRITE.**
 *
 * `perform` is the one funnel every route goes through, and it takes the snapshot itself rather
 * than trusting each route to remember. Not just removal, not just a merge — a create too, where
 * the snapshot records that there was nothing there, because a rule with an exception is a rule
 * somebody will apply the exception to next year on a route that needed the copy.
 *
 * The stop is the part that matters. A spine that skipped when the disk was full would leave the
 * screen still saying a copy was kept and the user still believing there was something to go back
 * to, and the first time either mattered would be the first time anyone found out. So a failed
 * snapshot is a sidecar error, the engine is never called, and the message says the vault was not
 * changed.
 *
 * A snapshot is NOT an undo, and no route here offers to restore one — see `snapshots.mjs` and
 * `docs/RESTORE-EXPERIMENT.md`, which is the measurement that decided it.
 */

import { projectOntoContract } from '../shared/contract.mjs';
import { EngineRefusedError } from '../engine/errors.mjs';
import { loadForEdit, writeMemory } from '../engine/memory.mjs';
import { envelope, sendJson, sendSidecarError } from './respond.mjs';
import { SnapshotFailedError } from './snapshots.mjs';

/**
 * The sidecar's own body ceiling, used only when the engine published none.
 *
 * The real limit is the engine's, read from `public-contract` at launch and passed in. This number
 * is a floor under a missing reading, not a second opinion about the engine: a server with no
 * ceiling at all will buffer whatever a local process sends it.
 */
const FALLBACK_BODY_BYTES = 4 * 1024 * 1024;

/** The only content type a write route accepts. See the note in `readJsonBody`. */
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

/**
 * Read a request body, with a ceiling, and refuse anything that is not JSON.
 *
 * The content-type check is a security control and not a nicety. A cross-origin page can make a
 * browser send a form post without asking permission first, and a form post can only carry one of
 * three content types — none of which is `application/json`. Requiring it means a forged submission
 * is refused before it is parsed, on top of the Origin check and the token, rather than instead of
 * either.
 *
 * The ceiling is enforced as bytes ARRIVE, not from the declared length: a client that lies in
 * `content-length` is exactly the client a limit is for.
 */
export function readJsonBody(req, { limit = FALLBACK_BODY_BYTES } = {}) {
	return new Promise((settle, fail) => {
		const type = req.headers['content-type'] ?? '';
		if (!JSON_CONTENT_TYPE.test(type)) {
			req.resume();
			const error = new Error(
				`This endpoint reads a JSON body. The request declared ${type || 'no content type'}.`,
			);
			error.kind = 'unsupported-content-type';
			return fail(error);
		}

		const declared = Number.parseInt(req.headers['content-length'] ?? '', 10);
		if (Number.isFinite(declared) && declared > limit) {
			req.resume();
			const error = new Error(
				`This request is ${declared.toLocaleString('en')} bytes and the limit is ` +
					`${limit.toLocaleString('en')}. Nothing was read, written or changed.`,
			);
			error.kind = 'body-too-large';
			error.limit = limit;
			error.size = declared;
			return fail(error);
		}

		const chunks = [];
		let size = 0;

		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				const error = new Error(
					`This request exceeded ${limit.toLocaleString('en')} bytes while it was being ` +
						`read. Nothing was read, written or changed.`,
				);
				error.kind = 'body-too-large';
				error.limit = limit;
				req.destroy();
				return fail(error);
			}
			chunks.push(chunk);
		});
		req.on('error', fail);
		req.on('end', () => {
			const text = Buffer.concat(chunks).toString('utf8');
			try {
				settle(text.length === 0 ? {} : JSON.parse(text));
			} catch (cause) {
				const error = new Error('This request body is not JSON this server could parse.');
				error.kind = 'unparseable-body';
				error.cause = cause;
				fail(error);
			}
		});
	});
}

/**
 * Choose the write mode from the list the ENGINE printed, by pattern.
 *
 * The accepted values are a closed list in the write contract, read at runtime. Writing one down
 * here would be exactly the transcription that drifts: a value spelled into a constant keeps
 * looking correct after the engine stops accepting it, and the records written through it still
 * look like data. If the pattern matches nothing the caller gets a loud failure naming every value
 * that WAS on offer, which is a better error than any this module could invent.
 */
export function pickMode(closed, pattern) {
	const paths = Object.keys(closed ?? {}).filter((path) => path.split('.').at(-1) === 'mode');
	for (const path of paths) {
		const match = (closed[path] ?? []).find((value) => pattern.test(value));
		if (match !== undefined) return match;
	}
	const offered = paths.map((path) => `${path}: ${(closed[path] ?? []).join(', ')}`).join('; ');
	throw new Error(
		`No write mode matching ${pattern} appears on any closed list named 'mode' in the write ` +
			`contract this engine printed. It offered: ${offered || '(no such list was parsed)'}. ` +
			`Nothing was written.`,
	);
}

// ---------------------------------------------------------------------------------------------
// Refusals, classified
// ---------------------------------------------------------------------------------------------
//
// Every pattern below is matched against the engine's OWN published refusal text, and the text
// travels beside the classification untouched. The classification exists so the browser can put a
// message next to the control that caused it; it is never a substitute for what the engine said.
//
// A pattern that stops matching degrades to `other`, which renders the engine's sentence verbatim
// and blocks nothing. That is the right failure: a classifier that guessed would put a repair
// button beside the wrong field.

const STALE_VERSION = /expected_version_id\s+(\S+?)\s+is stale;\s*active version is\s+(\S+?)[\s.]*$/i;
const AT_MOST = /accepts at most\s+(.+?)\s*$/i;
const EVERY_UNDECLARED = /every fact names a surface no entity declared:\s*([^.]+)/i;
const NEEDS_FACT = /at least one fact/i;
const NEEDS_TITLE = /requires\s+semantic_delta\.title/i;
const NEEDS_HEADING = /content_md must start with/i;

/** `32 facts, 32 evidence items, and 16 contradictions` → `{facts: 32, "evidence items": 32, …}` */
function parseCaps(text) {
	const caps = {};
	for (const [, count, what] of text.matchAll(/(\d+)\s+([a-z]+(?:\s+[a-z]+)*)/gi)) {
		caps[what.trim()] = Number.parseInt(count, 10);
	}
	return caps;
}

/**
 * What kind of refusal this is, so a screen can render it beside the thing that caused it.
 *
 * @param {object|null} refusal  the parsed refusal envelope, when there was one
 * @param {string} reason        stderr, verbatim, when there was not
 */
export function classifyRefusal(refusal, reason = '') {
	const message = refusal?.message ?? reason ?? '';
	const code = refusal?.code ?? null;

	const stale = message.match(STALE_VERSION);
	if (stale) {
		return {
			kind: 'stale_version',
			// The version the vault is on NOW. Recovered here so the browser never has to guess, and
			// a browser that cannot read it falls back to re-reading the memory — never to
			// discarding what the user typed.
			current_version_id: stale[2],
			expected_version_id: stale[1],
		};
	}

	// Committed, and its graph entry failed. This is the one outcome that is neither a refusal the
	// user can retry nor a success: no published operation repairs it, and the memory is in the
	// vault with no nodes and no claims.
	if (code === 'graph_fold') return { kind: 'fold_failed' };

	const caps = message.match(AT_MOST);
	if (caps) return { kind: 'over_cap', caps: parseCaps(caps[1]) };

	const undeclared = message.match(EVERY_UNDECLARED);
	if (undeclared) {
		return {
			kind: 'all_endpoints_undeclared',
			surfaces: undeclared[1]
				.split(',')
				.map((surface) => surface.trim())
				.filter(Boolean),
		};
	}

	if (NEEDS_FACT.test(message)) return { kind: 'needs_a_fact' };
	if (NEEDS_TITLE.test(message)) return { kind: 'needs_a_title' };
	if (NEEDS_HEADING.test(message)) return { kind: 'needs_a_heading' };

	// The whole call failed to deserialize, which happens before anything is written. It is a
	// build-time property of this client rather than something a user did, so it is named as such.
	if (code === 'invalid_schema') return { kind: 'unknown_field' };

	return { kind: 'other' };
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

const factsOf = (delta) => (Array.isArray(delta?.facts) ? delta.facts : []);

/**
 * Read a write response as three separate questions, none of which is "did it fail".
 *
 *   1. WHAT HAPPENED — the response's own effect value, branched on exhaustively by the caller. A
 *      value this build does not know is reported as unknown and never rendered as success.
 *   2. WHAT WAS STORED — the count of claims the fold reports, against the number of facts sent.
 *      Checked independently of the refusal list, so the guard cannot fail open by that key being
 *      absent.
 *   3. WHAT WAS DROPPED — the refusal list, read on every write. Each entry carries the surfaces it
 *      could not resolve; the INDEX it also carries does not correspond to the position of the fact
 *      in the payload that was sent, so it is passed through for display and nothing keys on it.
 *
 * The fold block is absent from a response that did not run the fold — a replay of an identical
 * write returns the original result and stores nothing new. `stored_claim_count` is therefore null
 * rather than zero in that case, and the shortfall check does not run: null is "not reported", and
 * treating it as zero would report every no-op as catastrophic data loss.
 */
export function describeWrite(result, { submitted_fact_count }) {
	const data = result?.data ?? {};
	const fold = data.graph_fold ?? null;

	const effect = data.canonical_effect ?? null;
	const verdict =
		effect === 'committed' ? 'committed' : effect === 'replayed' ? 'no_change' : 'unrecognised';

	// ABSENT means nothing was refused. It is never a failure signal by its absence and never an
	// error by its presence.
	const refusedFacts = Array.isArray(data.refused_facts) ? data.refused_facts : null;
	const storedClaimCount = typeof fold?.claims === 'number' ? fold.claims : null;

	// The independent post-condition. It runs whether or not the refusal list arrived, and it names
	// both numbers, because "some facts were lost" without them is not something anyone can act on.
	let shortfall = null;
	if (verdict === 'committed' && storedClaimCount !== null) {
		const accountedFor = storedClaimCount + (refusedFacts?.length ?? 0);
		if (accountedFor !== submitted_fact_count) {
			shortfall = {
				submitted: submitted_fact_count,
				stored: storedClaimCount,
				refused: refusedFacts?.length ?? 0,
			};
		}
	}

	return {
		effect,
		verdict,
		memory_id: data.memory_id ?? null,
		version_id: data.version_id ?? null,
		status: data.status ?? null,
		submitted_fact_count,
		stored_claim_count: storedClaimCount,
		refused_facts: refusedFacts,
		partial: refusedFacts !== null && refusedFacts.length > 0,
		shortfall,
		// The created-versus-matched split, which is the instrument that makes a graph regression
		// visible on the first save rather than months later on a graph screen: editing a memory
		// whose named things already exist elsewhere should MATCH rather than create.
		named_things: fold
			? {
					declared: fold.probes?.entities_declared ?? null,
					created: fold.minted_nodes ?? null,
					matched: fold.bound_nodes ?? null,
				}
			: null,
		// The second counter, against a different limit and with a different consequence: the caps
		// above are refusals, this is a budget the response REPORTS against. They must never share a
		// number on screen.
		budget: fold?.mint_budget ?? null,
		over_budget: data.minted_over_budget ?? fold?.mint_budget?.minted_over_budget ?? null,
	};
}

/**
 * What a write response says about the copy it took. A PURE FUNCTION over the store's header.
 *
 * The export payload is deliberately NOT in it. A save response would otherwise carry the whole
 * memory back to the browser a second time, and the one route that serves a snapshot's bytes is the
 * snapshot's own — so there is exactly one door to it and one place to reason about its size.
 *
 * `restorable` is here, always false, and it is not decoration: a screen reading this receipt has
 * the answer in front of it rather than inheriting an assumption from whoever wrote the copy.
 */
export function snapshotReceipt(header) {
	if (!header) return null;
	return {
		snapshot_id: header.snapshot_id,
		taken_at: header.taken_at,
		operation: header.operation,
		memory_id: header.memory_id,
		version_id: header.version_id,
		prior: header.prior,
		suppressed_reason: header.suppressed_reason ?? null,
		payload_bytes: header.payload_bytes,
		payload_sha256: header.payload_sha256,
		restorable: false,
		// Named so a caller does not have to build it, and so a change to the route shape is one
		// edit rather than a hunt through screens.
		href: `/api/snapshots/${header.snapshot_id}`,
		pruned: header.pruning?.pruned ?? [],
		pruning_error: header.pruning?.error ?? null,
	};
}

// ---------------------------------------------------------------------------------------------
// The handlers
// ---------------------------------------------------------------------------------------------

/**
 * Build the three write-path handlers.
 *
 * @param {object} deps
 * @param {object} deps.where            `{enginePath, root}` — the vault, resolved once at launch
 * @param {object} deps.cache            the listing cache, invalidated after a committed write
 * @param {object} deps.vocabulary       the parsed write contract, from the launch readings
 * @param {number|null} deps.requestBytes the engine's published request ceiling
 * @param {object} deps.snapshots        the snapshot store. REQUIRED: a write path assembled
 *        without one would have no safety net and no way to say so, and every screen downstream
 *        would keep the sentence that promises one.
 */
export function createWriteHandlers({ where, cache, vocabulary, requestBytes, snapshots }) {
	if (typeof snapshots?.take !== 'function') {
		throw new TypeError(
			'the write path needs a snapshot store: every write is preceded by a snapshot, and a ' +
				'build wired without one would promise a safety net it does not have',
		);
	}
	const fields = vocabulary?.fields ?? {};
	const closed = vocabulary?.closed ?? {};
	const limit = typeof requestBytes === 'number' && requestBytes > 0 ? requestBytes : FALLBACK_BODY_BYTES;

	/**
	 * The record an update is built from. THE LINEAGE DOOR, EVERY TIME.
	 *
	 * Not the cache, not the display door, and not conditionally — on every open, including when a
	 * perfectly good cached record exists. Two independent reasons: it is the only door that carries
	 * the entity declarations the write requires, and the version an update expects to replace has
	 * to be current at the moment the form opens or the user meets a conflict they did not cause.
	 */
	async function handleEditLoad(req, res, url, memoryId) {
		const record = await loadForEdit(memoryId, { ...where, contractFields: fields });

		sendJson(res, 200, {
			outcome: 'loaded',
			memory_id: record.memory_id,
			// What an update must carry. Absent here means the memory could not be addressed, and
			// the browser must not offer to save something it cannot guard.
			expected_version_id: record.version_id,
			content_md: record.content_md,
			// Already projected onto the write contract by `loadForEdit`. What comes back is what a
			// write may carry and nothing else, so the form is built from a shape that round-trips.
			semantic_delta: record.semantic_delta,
			entity_count: record.entity_count,
			fact_count: record.fact_count,
			// Computed from what the projection ACTUALLY removed, so a field that stops being
			// emitted stops being claimed.
			dropped_fields: record.dropped_fields,
			lineage: record.lineage,
			status: record.status,
			// The contract these fields were projected against. A save that arrives after an engine
			// upgrade can be told apart from one that did not.
			contract_digest: vocabulary?.digest ?? null,
			provenance: record.provenance,
		});
	}

	/**
	 * One write, however it ends. Shared by create and update so they cannot diverge — including
	 * the snapshot, which is taken here rather than in each route for exactly that reason.
	 */
	async function perform(res, write, { submitted_fact_count, droppedFields, snapshot }) {
		// THE SPINE. Before the engine is called, and a failure here means the engine is not called.
		let kept;
		try {
			kept = await snapshots.take(snapshot);
		} catch (error) {
			if (!(error instanceof SnapshotFailedError)) throw error;
			// This server's own failure, so it is a non-200 by the rule in respond.mjs — the engine
			// never ran and has said nothing. The directory is named because it is the actionable
			// part: a full disk and a permissions problem look identical from the browser and are
			// fixed in the same place.
			return sendSidecarError(res, 500, error.kind, error.message, {
				directory: error.directory,
				vault_changed: false,
			});
		}

		let result;
		try {
			result = await writeMemory(write, where);
		} catch (error) {
			if (!(error instanceof EngineRefusedError)) throw error;
			// A refusal is a COMPLETED call the engine declined, so it is HTTP 200 with the refusal
			// intact. Mapping it onto a 4xx or a 500 forces every screen to tell "the engine said
			// no" from "the app is broken" by reading a status code that has just conflated them.
			return sendJson(res, 200, {
				outcome: 'refused',
				exit_code: 2,
				data: null,
				results: null,
				refusal: error.refusal,
				reason: error.refusal ? null : error.reason,
				provenance: error.provenance ?? null,
				// Reported on a REFUSAL too. The snapshot was taken and the write did not happen, so
				// the store holds one copy more than the vault has versions — and a screen that
				// only mentioned snapshots on success would leave that unexplained.
				snapshot: snapshotReceipt(kept),
				// The classification, beside the engine's own words rather than instead of them.
				write_refusal: classifyRefusal(error.refusal, error.reason),
				error: {
					kind: 'refused',
					code: error.code,
					message: error.message,
					next: error.refusal?.next ?? null,
					operation: 'remember',
				},
			});
		}

		const outcome = describeWrite(result, { submitted_fact_count });

		// Only a write that actually happened moves the vault, and only a moved vault makes the
		// listing stale. Invalidating on a replay would make every no-op cost a whole-vault export.
		if (outcome.verdict === 'committed') cache.invalidate();

		sendJson(
			res,
			200,
			envelope(result, {
				write: outcome,
				// What this server removed from the payload the browser sent, by name and from what
				// it actually removed. A field the browser meant to keep appears here rather than in
				// a deserialization failure that costs the whole call and names nothing.
				dropped_fields: droppedFields,
				// The receipt for the copy taken before this write. It carries no export payload —
				// the snapshot's own route serves that — so a save response does not double in size
				// because a safety net exists.
				snapshot: snapshotReceipt(kept),
				cache: cache.status(),
			}),
		);
	}

	/**
	 * The update. Body carries the content, the structure and the version it expects to replace.
	 *
	 * The structure is projected again here. The browser projects too — that is where the guarantee
	 * belongs, because the browser is what composes it — but a payload that reaches this route with
	 * a field the contract does not name costs the whole call before anything is written, and the
	 * engine's message for that names a JSON column rather than a control on a screen.
	 */
	async function handleUpdate(req, res, url, memoryId) {
		let body;
		try {
			body = await readJsonBody(req, { limit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		if (typeof body?.expected_version_id !== 'string' || body.expected_version_id.length === 0) {
			return sendSidecarError(
				res,
				400,
				'missing-expected-version',
				`An update must carry the version it expects to replace. Without it the engine cannot ` +
					`refuse a write that would overwrite a change made since this memory was loaded, ` +
					`and one editor silently overwrites another. Nothing was written.`,
			);
		}

		const dropped = new Set();
		const semantic_delta = projectOntoContract(
			body.semantic_delta ?? {},
			'semantic_delta',
			fields,
			dropped,
		);

		await perform(
			res,
			{
				mode: pickMode(closed, /^update/i),
				memory_id: memoryId,
				expected_version_id: body.expected_version_id,
				content_md: body.content_md,
				semantic_delta,
			},
			{
				submitted_fact_count: factsOf(semantic_delta).length,
				droppedFields: [...dropped].sort(),
				// The version the copy is OF, which is the version this write expects to replace.
				// Taking it from the body rather than re-reading is deliberate: if the body's
				// version is stale, the snapshot is of the state the user was editing, which is the
				// state they would want back — and the engine refuses the write anyway.
				snapshot: {
					operation: 'update',
					memory_id: memoryId,
					version_id: body.expected_version_id,
				},
			},
		);
	}

	/** The create. The same form with an empty starting state, and no version to expect. */
	async function handleCreate(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		if (body?.memory_id || body?.expected_version_id) {
			return sendSidecarError(
				res,
				400,
				'create-names-a-memory',
				`A create names no memory and carries no expected version: the engine derives the id ` +
					`from the write itself. Post to the memory's own address to update it. Nothing ` +
					`was written.`,
			);
		}

		const dropped = new Set();
		const semantic_delta = projectOntoContract(
			body?.semantic_delta ?? {},
			'semantic_delta',
			fields,
			dropped,
		);

		await perform(
			res,
			{
				mode: pickMode(closed, /^create/i),
				content_md: body?.content_md,
				semantic_delta,
			},
			{
				submitted_fact_count: factsOf(semantic_delta).length,
				droppedFields: [...dropped].sort(),
				// A create has no prior state, and the record says so — `prior: "absent"` — rather
				// than being skipped. "Every write is preceded by a snapshot" with no exception is a
				// rule a reader can hold; one with an exception is a rule somebody applies to the
				// next route, which will be a route that needed the copy.
				snapshot: { operation: 'create', memory_id: null, version_id: null },
			},
		);
	}

	// ---- the snapshot store's own read routes ---------------------------------------------
	//
	// THREE READS AND NO WRITE. There is no restore route and there is no delete route: restore
	// because no published door can return a memory to service in the vault it left (see
	// docs/RESTORE-EXPERIMENT.md), and delete because retention is the only thing that removes a
	// snapshot — a store the user can empty by hand is a safety net with a hole in it exactly where
	// somebody was in a hurry.

	/** The whole store for this vault, or one memory's slice of it. */
	async function handleSnapshots(req, res, url, memoryId) {
		const listing = await snapshots.list({ memory_id: memoryId ?? null });
		sendJson(res, 200, { outcome: 'listed', ...listing });
	}

	/** One snapshot, whole, including the export payload. This is the bytes a person can save. */
	async function handleSnapshot(req, res, url, snapshotId) {
		const record = await snapshots.read(snapshotId);
		if (!record) {
			return sendJson(res, 404, {
				outcome: 'refused',
				error: {
					kind: 'no-such-snapshot',
					// The id is IN the sentence: a user following a stale link has the id and nothing
					// else, and a message that does not repeat it cannot be matched against what
					// they clicked.
					message:
						`No snapshot ${snapshotId} is in this vault's store. Retention keeps the newest ` +
						`${snapshots.retention.per_memory} of each memory and the newest ` +
						`${snapshots.retention.per_vault} in the store, so an older one may have been ` +
						`pruned.`,
					snapshot_id: snapshotId,
					retention: snapshots.retention,
				},
			});
		}
		sendJson(res, 200, {
			outcome: 'read',
			// Said on the door as well as inside the file, because this is the response a screen
			// renders a button beside.
			restore_available: false,
			snapshot: record,
		});
	}

	return {
		handleEditLoad,
		handleUpdate,
		handleCreate,
		handleSnapshots,
		handleSnapshot,
		bodyLimit: limit,
	};
}
