/**
 * Everything this app needs to know about the machine it is on, taken from the engine in one batch
 * of short-lived child processes.
 *
 * Every value here is a READING. Nothing in it is assumed, defaulted or remembered between runs, and
 * the vocabulary in particular is parsed out of what the binary printed a moment ago. Memory types,
 * relation names and entity kinds are open, growing registries: a value transcribed into a dropdown,
 * a filter or a test drifts from the engine without anyone noticing, and the records written through
 * it still look like data. So this module reads them, and this repository never writes them down.
 */

import { createHash } from 'node:crypto';

import { call, run } from './call.mjs';
import {
	EngineRefusedError,
	EngineUnlicensedError,
	PROGRAM,
	VaultNotFoundError,
} from './errors.mjs';
import { locateEngine } from './locate.mjs';

/**
 * Field names in the write contract are lowercase, or a bracketed placeholder for an open key.
 * Requiring that shape is what keeps the section headings and the worked example out of the parse
 * without this file having to name either of them.
 */
const FIELD_LINE = /^( *)([a-z_][a-z0-9_]*|<[^>]+>)\s*(?:\((required|optional)\))?\s*(?:—\s*(.*))?$/;

/** An inline closed list: the field accepts these values and no others. */
const INLINE_CLOSED = /\[one of:\s*([^\]]+)\]/;

/** A block closed list: the values follow on more deeply indented lines. */
const BLOCK_CLOSED = /^\s*closed\s*—\s*one of:\s*$/;

/** An open registry, naming what the vault already holds. New values are accepted. */
const KNOWN_HERE = /Known here:\s*([^.]+)\./;

/**
 * The one list a client may safely act on without asking first — and it is a DENIAL list. A stale
 * denial list fails safe, by refusing something that has since become permitted; a stale allow list
 * fails open. It is still parsed rather than transcribed, so drift is detected rather than assumed.
 */
const REFUSED_BY_ENGINE = /Refused, emitted by the fold:\s*([^.]+)\./;

const splitValues = (text) =>
	text
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);

/**
 * Parse the write contract into field paths and the value lists attached to them.
 *
 * @param {string} text  exactly what `schema remember` printed
 * @returns {{fields: Record<string, {required: boolean, gloss: string}>, closed: Record<string, string[]>, known: Record<string, string[]>, denied: Record<string, string[]>}}
 *
 * Paths are dotted and drop the array-ness of a repeated field, because a caller building a control
 * wants to know which field it is editing, not how many of them there are.
 */
export function parseWriteContract(text) {
	const fields = Object.create(null);
	const closed = Object.create(null);
	const known = Object.create(null);
	const denied = Object.create(null);

	const stack = [];
	let blockFor = null;
	let blockIndent = 0;

	for (const line of text.split('\n')) {
		if (blockFor !== null) {
			const indent = line.match(/^ */)[0].length;
			const value = line.trim().split(/\s{2,}/)[0];
			if (line.trim() && indent > blockIndent) {
				(closed[blockFor] ??= []).push(value);
				continue;
			}
			blockFor = null;
		}

		const match = line.match(FIELD_LINE);
		if (!match) continue;

		const [, indentText, name, requirement, gloss = ''] = match;

		if (BLOCK_CLOSED.test(line)) {
			blockFor = stack.map((frame) => frame.name).join('.');
			blockIndent = indentText.length;
			continue;
		}

		// A field line carries either its requirement or a gloss. Anything with neither is prose.
		if (!requirement && !gloss) continue;

		const indent = indentText.length;
		while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
		stack.push({ indent, name });

		const path = stack.map((frame) => frame.name).join('.');
		fields[path] = { required: requirement === 'required', gloss };

		const inline = gloss.match(INLINE_CLOSED);
		if (inline) closed[path] = splitValues(inline[1]);

		const open = gloss.match(KNOWN_HERE);
		if (open) known[path] = splitValues(open[1]);

		const refused = gloss.match(REFUSED_BY_ENGINE);
		if (refused) denied[path] = splitValues(refused[1]);
	}

	return { fields, closed, known, denied };
}

/**
 * Re-exported, not defined here.
 *
 * The projection this belongs to has to run on BOTH sides of the wire — the browser composes a
 * payload, the sidecar projects it again on the way out — so it lives in `shared/`, which imports
 * nothing and can be bundled into a page. It is re-exported from here because this is the module
 * that produces the `fields` map it reads, and a caller that has one should not have to know where
 * the other half went.
 */
export { childFieldNames } from '../shared/contract.mjs';

/**
 * A reading that did not arrive is a failure, not a null. Both of the next two functions exist to
 * say so.
 *
 * The tempting version returns null on a non-zero exit or an unparseable body, and every caller
 * downstream renders "not recorded". But the loudest case — the resolved directory is not a vault —
 * exits non-zero and prints a message that says exactly what to do, and swallowing it turns a
 * fixable machine into an app that looks like it works and knows nothing. A refusal must not be
 * spelled as an answer.
 */
function mustSucceed(reading, command) {
	if (reading.exitCode === 0 && reading.stdout.trim().length > 0) return reading;
	throw new Error(
		`\`${PROGRAM} ${command}\` exited ${reading.exitCode} and this app cannot start without ` +
			`what it prints. The engine said:\n\n${(reading.stderr || reading.stdout).trim()}`,
	);
}

function mustJson(reading, command) {
	if (reading.exitCode !== 0) {
		throw new Error(
			`\`${PROGRAM} ${command}\` exited ${reading.exitCode}. The engine said:\n\n` +
				`${(reading.stderr || reading.stdout).trim()}`,
		);
	}
	try {
		return JSON.parse(reading.stdout);
	} catch (cause) {
		throw new Error(
			`\`${PROGRAM} ${command}\` exited 0 and printed something that is not the JSON this ` +
				`client reads it as. It printed:\n\n${reading.stdout.trim().slice(0, 400)}`,
			{ cause },
		);
	}
}

/**
 * Did the readings that address a vault fail because there is no vault at the resolved root?
 *
 * ASKED STRUCTURALLY, NEVER BY READING ENGLISH OUT OF A MESSAGE. Every reading in the batch below is
 * one of two kinds: those that describe the BUILD — `--version`, `model`, `gate`,
 * `public-contract`, `schema` — and those that address a VAULT — `where`, `call ontology`. A
 * machine whose build readings all answer and whose vault readings all refuse has a working engine
 * pointed at a directory that is not a vault. That shape is the evidence; the wording of the
 * refusal is not, and a client that grepped it for "is not a vault" would start reporting a broken
 * install the first time the engine rephrased a sentence.
 *
 * `where --root-only` is the confirming reading and it is the reason this can be answered at all:
 * it is the one command that answers in BOTH states, reporting the root the engine resolved and how
 * it arrived there without requiring anything to be at that root. Its answer is what the screen
 * shows — so the path the user is told about is the engine's own, and this app never becomes a
 * second resolver that names a path on a machine where the engine resolves something else.
 *
 * @returns {Promise<VaultNotFoundError|null>} null when the evidence does not fit, so the caller
 *   raises the failure it already had rather than a friendlier one that might be wrong.
 */
async function vaultAbsence({ engine, where, build }) {
	if (build.some((reading) => reading.exitCode !== 0)) return null;

	const address = await run(['where', '--root-only'], where).catch(() => null);
	if (!address || address.exitCode !== 0) return null;

	let resolved;
	try {
		resolved = JSON.parse(address.stdout);
	} catch {
		return null;
	}
	if (!resolved?.root) return null;

	return new VaultNotFoundError({
		root: resolved.root,
		source: resolved.source ?? null,
		project: resolved.project ?? null,
		enginePath: engine.path,
	});
}

/**
 * Take every reading, in one batch.
 *
 * @param {object} [options]
 * @param {string} [options.explicit]  a path passed by the caller, e.g. from `--kscope`
 * @param {string} [options.root]      pins the vault these readings are about
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} one object describing what was found
 *
 * Eight short child processes, run concurrently, because each is a single read and the whole batch
 * should cost about as much as the slowest one.
 *
 * A shut licence gate is REPORTED, not thrown: the launcher owns the decision to stop, and it needs
 * the rest of the readings to render the screen that says why. Every other failure propagates.
 */
export async function preflight({ explicit, root, timeoutMs } = {}) {
	const engine = await locateEngine({ explicit });
	const where = { enginePath: engine.path, root, timeoutMs };

	const [version, address, gate, model, contract, index, writeContract, vocabulary] =
		await Promise.all([
			run(['--version'], where),
			run(['where'], where),
			run(['gate'], where),
			run(['model'], where),
			run(['public-contract'], where),
			run(['schema'], where),
			run(['schema', 'remember'], where),
			// The only gated call in the batch, and therefore the only one that can answer whether
			// this machine may use the door the whole product is built on. `gate` reports what the
			// BUILD carries and where a key would be read from; it reads no key and returns no
			// verdict, so a client that trusts it has confirmed the lock exists, not that it opens.
			call('ontology', { mode: 'read' }, where).catch((error) => {
				// Two of the ways this can end are conditions on the machine rather than faults, and
				// both are classified below, where the rest of the readings are in hand: a shut
				// licence gate, and a resolved root that is not a vault. Everything else propagates.
				if (error instanceof EngineUnlicensedError || error instanceof EngineRefusedError) {
					return error;
				}
				throw error;
			}),
		]);

	/**
	 * THE VAULT-ADDRESSED READINGS, CLASSIFIED BEFORE ANYTHING ELSE IS RAISED.
	 *
	 * First, because the messages below are written for someone whose vault opened. On a directory
	 * that holds no vault it is `where` that fails, and `mustJson` would report it as a command that
	 * exited 2 — true, developer-facing, and the wrong sentence for the commonest thing that happens
	 * to a person who has just installed this and typed one word.
	 */
	const unlicensed = vocabulary instanceof EngineUnlicensedError;
	const vaultRefused = !unlicensed && vocabulary instanceof EngineRefusedError;
	if (vaultRefused || address.exitCode !== 0) {
		const absent = await vaultAbsence({
			engine,
			where,
			build: [version, gate, model, contract, index, writeContract],
		});
		if (absent) throw absent;
		// The evidence did not fit, so the original failure stands rather than a kinder guess.
		if (vaultRefused) throw vocabulary;
	}

	// The three readings that are prose rather than JSON still have to have arrived. `--version`
	// failing silently leaves an empty version string in the header; `schema remember` failing
	// silently leaves a parse of nothing, which is a vocabulary with no values in it — and a control
	// with no values is filled in by a user coining names that already existed.
	for (const [reading, command] of [
		[version, '--version'],
		[index, 'schema'],
		[writeContract, 'schema remember'],
	]) {
		mustSucceed(reading, command);
	}

	const parsed = parseWriteContract(writeContract.stdout);
	const seed = mustJson(contract, 'public-contract');
	const digest = createHash('sha256').update(writeContract.stdoutBytes).digest('hex');

	return {
		checked_at: new Date().toISOString(),

		engine: {
			path: engine.path,
			found: engine.found,
			source: engine.source,
			directory: engine.directory,
			// Displayed permanently and never used as a compatibility gate: two builds one patch
			// apart can render the write contract differently while the version string stands still.
			version: version.stdout.trim(),
		},

		gate: {
			call_permitted: !unlicensed,
			reason: unlicensed ? vocabulary.reason.trim() : null,
			code: unlicensed ? vocabulary.code : null,
			build: mustJson(gate, 'gate'),
		},

		model: mustJson(model, 'model'),

		// The vault this app is about, resolved once. It is a reading, not a setting: nothing
		// downstream may name a different one, because a parameter that names a vault root is the
		// difference between a memory browser and an arbitrary local-file reader.
		vault: mustJson(address, 'where'),

		contract: {
			// Compatibility keys on this, never on the version string. The write contract is where
			// the closed vocabularies live, so a parser that silently degrades against a changed
			// layout yields FEWER values — a control missing entries, which the user helpfully fills
			// in by coining vocabulary that already existed.
			digest,
			bytes: writeContract.stdoutBytes.length,
			schema_version: seed?.schema_version ?? null,
			limits: seed?.limits ?? null,
			retired_operations: seed?.retired_operations ?? null,
			capabilities: seed?.capabilities ?? null,
			error_codes: seed?.errors?.codes ?? null,
			// The operation index, verbatim. A caller deciding a compatibility tier has to ask
			// whether the operations it needs are present and not retired, and only it knows which
			// those are.
			operations: index.stdout,
		},

		vocabulary: {
			// Keyed by the digest so an engine upgrade invalidates any cache of this automatically
			// and staleness is not a state the app can be in.
			digest,
			fields: parsed.fields,
			closed: parsed.closed,
			known: parsed.known,
			denied: parsed.denied,
			// Workspace-scoped and mutable, so it comes from the vault rather than the build.
			memory_types: unlicensed ? null : (vocabulary.data?.ontology?.types ?? null),
			declarable_memory_types: unlicensed
				? null
				: (vocabulary.data?.declarable?.memory_types ?? null),
		},
	};
}

/**
 * The readings that stop a launch rather than degrade it.
 *
 * Two of them are here, and the third is not. A shut licence gate and a missing embedding model are
 * both full stops: `call` is the only door this product has, so a shut gate means nothing can be
 * listed or edited, and without the model the app would run while a quarter of what makes retrieval
 * work sits at zero and reports nothing. A partly-working memory tool is worse than one that says
 * what is wrong.
 *
 * The third stop — an unrecognised write contract — is a read-only mode rather than a refusal to
 * start, and it needs a table of known digests this milestone has no way to fill. It is named here
 * as absent so a later caller adds a rung to this ladder rather than inventing a second one.
 *
 * @param {object} readings  what `preflight` returned
 * @returns {Array<{code: string, message: string}>}  empty when nothing stops the launch
 */
export function launchBlockers(readings) {
	const blockers = [];
	const enginePath = readings.engine?.path ?? PROGRAM;

	if (readings.gate?.call_permitted === false) {
		blockers.push({
			code: 'unlicensed',
			message: [
				`${readings.engine?.version || PROGRAM} is installed at ${enginePath}, but this build`,
				`requires an alpha key and none was found.`,
				``,
				`    ${PROGRAM} activate <KEY>`,
				``,
				`\`${PROGRAM} call\` is the only door this tool has, so nothing can be listed or`,
				`edited until that succeeds. Ask the alpha owner for a key if you do not`,
				`have one. Your vault is untouched.`,
				readings.gate.code ? `` : null,
				readings.gate.code ? `The engine classified the refusal as ${readings.gate.code}.` : null,
			]
				.filter((line) => line !== null)
				.join('\n'),
		});
	}

	// Read from the engine, never assumed: a build without the model answers this command and says
	// so, which is the only check that distinguishes the two builds. Binary size does not.
	if (readings.model?.status !== 'bundled') {
		blockers.push({
			code: 'model-not-bundled',
			message: [
				`The ${PROGRAM} at ${enginePath} reports its embedding model as`,
				`"${readings.model?.status ?? 'nothing at all'}" rather than bundled.`,
				``,
				`Reinstall the engine from a release build, which carries the model inside the`,
				`executable. A build without it still answers, so this would otherwise be a`,
				`difference you could only find by noticing worse results months later.`,
				``,
				`Nothing was read, written or changed.`,
			].join('\n'),
		});
	}

	return blockers;
}
