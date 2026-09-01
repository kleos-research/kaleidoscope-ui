/**
 * The door map, as functions. Four doors, and the fifth one is missing on purpose.
 *
 * THERE IS NO RANKED SEARCH HERE, and there is no caller of one anywhere in this repository. A
 * ranked query records that it ran: the record is permanent, it stores the query text, and nothing
 * published reads it back or removes one. A client that listed by searching would write into the
 * store it is displaying, on every load and every refresh, forever — which is the single most
 * plausible way to turn a read-only browser into the largest writer the vault has. Listing goes
 * through the export door, filtering happens in the browser over a payload already fetched, and
 * `readMemory` addresses a memory by id, which records nothing.
 *
 * Zero callers is a much easier invariant to hold than one, and it is the strongest position from
 * which to add exactly one later, behind a screen that names the record before the button is pressed.
 */

import { projectOntoContract } from '../shared/contract.mjs';
import { call, run } from './call.mjs';
import { EnginePartialError } from './errors.mjs';
import { parseWriteContract } from './preflight.mjs';

/**
 * The large derived per-memory fields, dropped before the payload leaves this module.
 *
 * Nothing in this product reads them, and together they are a substantial fraction of the bytes —
 * shipping them across a loopback socket and into a browser heap costs on every load. Stripping one
 * is not enough; there is more than one field of comparable size. The names are here, but the list
 * this module REPORTS is computed from what it actually dropped, so a field that stops being
 * emitted stops being claimed.
 */
const DERIVED_FIELDS_TO_STRIP = ['embedding', 'normalized_tokens'];

async function contractFieldsFor(options) {
	if (options.contractFields) return options.contractFields;
	const contract = await run(['schema', 'remember'], options);
	return parseWriteContract(contract.stdout).fields;
}

const requireId = (memoryId) => {
	if (typeof memoryId !== 'string' || memoryId.trim().length === 0) {
		throw new TypeError('a memory id is required');
	}
	return memoryId;
};

/**
 * Every memory in the vault, in one read that writes nothing.
 *
 * The export door has no filter and no pagination — it returns the whole vault, every time — so the
 * caller's ceiling is what it can hold and index. That is right for the sizes this product is for
 * and stops being right well before a vault reaches six figures; this function is the seam where a
 * different strategy would land, which is why every screen goes through it rather than around it.
 *
 * @param {object} [options]
 * @param {string} options.enginePath
 * @param {string} [options.root]
 * @param {number} [options.timeoutMs]
 */
export async function listMemories({ enginePath, root, timeoutMs = 120_000 } = {}) {
	const envelope = await call('memory_lifecycle', { mode: 'export' }, { enginePath, root, timeoutMs });
	const payload = envelope.data?.payload ?? {};
	const memories = payload.memories ?? [];

	const stripped = new Set();
	for (const record of memories) {
		for (const field of DERIVED_FIELDS_TO_STRIP) {
			if (record.semantic && field in record.semantic) {
				delete record.semantic[field];
				stripped.add(field);
			}
		}
	}

	return {
		fetched_at: new Date().toISOString(),
		memory_count: memories.length,
		stripped_fields: [...stripped],
		memories,
		// What the export declined to include at all — the engine's own statement about the parts of
		// a vault this door does not carry. Reported so a caller never presents the export as the
		// whole of what is on disk.
		omissions: payload.omissions ?? null,
		ontology: payload.ontology ?? null,
		source: payload.source ?? null,
		// Describes the payload AS THE ENGINE PRODUCED IT, before the strip above. It will not match
		// a digest taken over what this function returns, and it is kept for exactly that reason: it
		// is the only way to check the payload against the engine rather than against ourselves.
		payload_sha256: envelope.data?.payload_sha256 ?? null,
		export_kind: envelope.data?.export_kind ?? null,
		schema_version: envelope.data?.schema_version ?? null,
		provenance: envelope.provenance,
		duration_ms: envelope.duration_ms,
	};
}

/**
 * One memory, as a portable export. THE SNAPSHOT DOOR. Writes nothing.
 *
 * The same door `listMemories` uses, addressed at one memory instead of the whole vault. It is a
 * separate function rather than an argument to that one because the two have opposite shapes:
 * `listMemories` returns a listing this app has reshaped and stripped, and this returns the
 * engine's envelope UNTOUCHED — the payload, its digest, its declared kind, its omissions, all of
 * it. A snapshot that had been reshaped on the way in is a copy of what this app understood rather
 * than of what the vault held.
 *
 * A removed memory is omitted from the payload entirely, so a caller that asked for one gets an
 * envelope with an empty `memories` array and exit 0. That is an answer, not a record, and every
 * caller here has to say so rather than filing it.
 *
 * **IT RETURNS THE BYTES AS WELL AS THE OBJECT, AND THE BYTES ARE THE ARTEFACT.**
 *
 * The envelope carries a digest over the payload AS THE ENGINE SERIALISED IT, and the import door
 * checks it. A JSON round trip through this runtime does not preserve that serialisation — a `0.0`
 * comes back as `0` — so an export this app parsed and re-emitted is refused with
 * `memory export payload digest does not match`. Measured, on the way to writing the snapshot
 * store; `test/restore.test.mjs` asserts it, because it is the reason the store keeps text rather
 * than an object and nothing about the code makes that obvious.
 *
 * @param {string} memoryId
 * @param {object} [options]
 * @returns {Promise<{envelope: object, text: string}>} the parsed envelope, and the engine's own
 *          bytes beside it. Keep the text; the object is for reading.
 */
export async function exportMemory(memoryId, { enginePath, root, timeoutMs } = {}) {
	const result = await call(
		'memory_lifecycle',
		{ mode: 'export', memory_id: requireId(memoryId) },
		{ enginePath, root, timeoutMs, keepStdout: true },
	);
	return { envelope: result.data, text: result.stdout };
}

/**
 * One memory, addressed by id, for display. Writes nothing — no ranked query runs, so no record of
 * having read it is kept.
 *
 * This door does NOT return entity declarations. It is not sufficient to write an update from, and
 * `loadForEdit` is what an editor uses. See the comment there.
 *
 * @param {string} memoryId
 * @param {object} [options]
 */
export async function readMemory(memoryId, { enginePath, root, timeoutMs } = {}) {
	// The request is built here, from the id alone. Nothing the caller passes reaches the payload,
	// so there is no argument shape that turns this into a ranked query.
	const envelope = await call(
		'search',
		{ memory_id: requireId(memoryId) },
		{ enginePath, root, timeoutMs },
	);
	return envelope.data;
}

/**
 * One memory, loaded so it can be written back. THE EDITOR MUST USE THIS.
 *
 * The display door and the write door disagree about what a memory is. The display door returns the
 * body, the version and the facts, and it does NOT return the memory's entity declarations. The
 * write door requires them: an update carries the whole semantic structure, not a patch of it. So a
 * client that loads a memory through the display door, edits the prose and writes back what it was
 * given commits successfully — status applied, no refusal, no warning — and silently deletes every
 * named thing the memory declared, taking that memory's nodes out of the graph with it. Nothing in
 * the response says so, and the next read looks fine.
 *
 * The lineage door is the one that carries the declarations. It does not carry the body or the
 * version, so this composes the two doors and returns one record that can survive a round trip.
 *
 * @param {string} memoryId
 * @param {object} [options]
 * @param {object} [options.contractFields]  the parsed write contract, from the preflight
 */
export async function loadForEdit(memoryId, options = {}) {
	requireId(memoryId);

	const [lineage, display, fields] = await Promise.all([
		call('memory_lifecycle', { mode: 'lineage', memory_id: memoryId }, options),
		readMemory(memoryId, options),
		contractFieldsFor(options),
	]);

	const record = lineage.data?.memory ?? {};
	const dropped = new Set();
	const semantic_delta = projectOntoContract(record, 'semantic_delta', fields, dropped);

	return {
		memory_id: memoryId,
		// From the display door, because lineage carries neither. The version is what an update is
		// allowed to replace, and a write without it is the silent-overwrite hazard.
		version_id: display?.version_id ?? null,
		status: display?.status ?? lineage.data?.status ?? null,
		content_md: display?.content_md ?? null,
		semantic_delta,
		// The two counts M1 asserts are unchanged across a round trip. They are here rather than
		// left to the caller so that every caller counts the same thing.
		entity_count: semantic_delta.entities?.length ?? 0,
		fact_count: semantic_delta.facts?.length ?? 0,
		// What the projection removed, computed from what it actually removed. A field appearing
		// here that a caller expected to keep is the projection drifting from the contract.
		dropped_fields: [...dropped].sort(),
		lineage: {
			status: lineage.data?.status ?? null,
			contradicts: lineage.data?.contradicts ?? null,
			contradicted_by: lineage.data?.contradicted_by ?? null,
		},
		provenance: lineage.provenance,
	};
}

/**
 * Create, update or remove a memory, or create several in one call.
 *
 * `mode` is passed through untouched. Its accepted values are a closed list in the write contract,
 * read at runtime, and naming them here would be a transcription that drifts — the engine's own
 * refusal names the field and the values, which is a better error than one this module could invent.
 *
 * The guards below are about presence, not about values, and there is one that matters: a write
 * naming a memory must carry the version it expects to replace. Without it a write either overwrites
 * a concurrent change or cannot be told apart from one that did.
 *
 * A write is NEVER retried here. A retried write is a second write, and if the first landed the
 * second is refused for a stale version — which is the good case. The bad case is that it did not
 * land and nobody can tell which happened. Retry is a decision made in front of a message.
 *
 * @param {object} write
 * @param {string} write.mode
 * @param {string} [write.memory_id]
 * @param {string} [write.expected_version_id]
 * @param {string} [write.content_md]
 * @param {object} [write.semantic_delta]
 * @param {Array}  [write.items]
 * @param {string} [write.idempotency_key]
 * @param {object} [options]
 * @returns {Promise<object>} the call envelope, with the engine's response passed through whole
 * @throws {EnginePartialError} when a single-memory write reports a partial application
 */
export async function writeMemory(write, { enginePath, root, timeoutMs } = {}) {
	if (typeof write?.mode !== 'string' || write.mode.length === 0) {
		throw new TypeError('a write needs a mode');
	}
	if (write.memory_id && !write.expected_version_id) {
		throw new TypeError(
			'a write naming a memory must carry expected_version_id: without it the engine cannot ' +
				'refuse a write that would overwrite a change made since this memory was loaded',
		);
	}
	if (write.expected_version_id && !write.memory_id) {
		throw new TypeError('expected_version_id names no memory');
	}
	if (write.items && (write.content_md || write.semantic_delta || write.memory_id)) {
		throw new TypeError('a batch carries its content per item and names no single memory');
	}

	const envelope = await call('remember', write, { enginePath, root, timeoutMs });

	// A batch may legitimately apply in part, and its caller has to read the per-item results to
	// know what to resend. A single-memory write has one item, so a partial there means the engine
	// reported something this client's contract says cannot happen — and that must be loud.
	if (envelope.outcome === 'applied_in_part' && !write.items) {
		throw new EnginePartialError({
			results: envelope.results ?? [],
			data: envelope.data,
			operation: 'remember',
		});
	}

	return envelope;
}
