/**
 * The five ways a call to the engine ends badly.
 *
 * Each one exists because the alternative — one generic Error carrying a string — forces every
 * caller to re-derive the situation by reading a message, and the situations are genuinely
 * different: a refusal is data the UI renders, a licence stop is a screen with one command on it,
 * and a crash is the only one of the five that means "the app is broken".
 */

/** The program this client looks for. */
export const PROGRAM = 'kscope';

/**
 * One install command, because both programs come from the same package. A second one sends a user
 * who followed it to a package that does not carry the engine.
 */
export const INSTALL_COMMAND = 'npm install -g @kleos-research/kaleidoscope';

/** The environment variable that names an engine authoritatively. */
export const ENGINE_ENV_VAR = 'KALEIDOSCOPE_ENGINE';

/**
 * The one command that brings a vault into existence, and the only one this app ever shows for it.
 *
 * Shown, never run. The engine refuses to create a vault it was merely pointed at — addressing one
 * and creating one are different acts, and a resolver that quietly created would swallow the typo
 * that would have made you look. A button here that created one would undo that decision from the
 * outside, so this app prints the command and leaves the act with the person.
 */
export const INIT_COMMAND = `${PROGRAM} init`;

/** The environment variable that names the vault, read by the engine and never by this app. */
export const VAULT_ENV_VAR = 'KSCOPE_ROOT';

/** How many PATH directories the not-found message spells out before it starts counting. */
const PATH_ENTRIES_SHOWN = 4;

class EngineError extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = new.target.name;
	}
}

/**
 * Renders one entry of the search trail. The trail is the substance of the not-found message: a user
 * told only "not found" cannot tell a search that skipped PATH from one that read it and came back
 * empty, and those two have opposite remedies.
 *
 * Exported because the first-run screen shows the same trail in a browser. One renderer, so the
 * terminal and the screen cannot come to describe one search two ways.
 */
export function describePlace(place) {
	switch (place.kind) {
		case 'explicit':
			return `${place.path} (named with --${PROGRAM})`;
		case 'env':
			return place.value
				? `the ${place.name} setting, which names ${place.value}`
				: `the ${place.name} setting, which is not set`;
		case 'package':
			return `${place.dir} (${place.note})`;
		case 'path':
			return `${place.dir} (on PATH)`;
		default:
			return place.dir ?? place.path ?? String(place.kind);
	}
}

function renderTrail(looked) {
	const named = looked.filter((place) => place.kind !== 'path');
	const onPath = looked.filter((place) => place.kind === 'path');
	const shown = onPath.slice(0, PATH_ENTRIES_SHOWN);
	const hidden = onPath.length - shown.length;

	const lines = [...named, ...shown].map((place) => `  - ${describePlace(place)}`);
	if (hidden > 0) {
		lines.push(`  - … and ${hidden} more ${hidden === 1 ? 'directory' : 'directories'} on PATH`);
	}
	return lines.join('\n');
}

/**
 * No usable engine. Carries every place that was looked, in the order they were looked, so the
 * message can prove the search reached PATH rather than merely asserting it.
 *
 * Two shapes, distinguished by `kind`, because the remedies are opposite. `nothing-found` means
 * install it or say where it is. `named-unusable` means the caller already said where it is and was
 * wrong — and the search stopped there rather than running some other program.
 */
export class EngineNotFoundError extends EngineError {
	/**
	 * @param {object}   detail
	 * @param {'nothing-found'|'named-unusable'} detail.kind
	 * @param {Array<object>} detail.looked  every place looked, in order
	 * @param {string}  [detail.path]        the path that was named, for `named-unusable`
	 * @param {string}  [detail.namedBy]     what named it, for `named-unusable`
	 * @param {string}  [detail.reason]      why that path could not be used
	 */
	constructor({ kind = 'nothing-found', looked = [], path, namedBy, reason } = {}) {
		super(
			kind === 'named-unusable'
				? [
						`Kaleidoscope could not use the ${PROGRAM} program at ${path}.`,
						`It was named by ${namedBy}, so nothing else was tried.`,
						`That path must be an existing file you have permission to run.`,
						reason ? `The system reported: ${reason}` : null,
						`Your local vault data is intact and unchanged.`,
					]
						.filter(Boolean)
						.join('\n')
				: [
						`Kaleidoscope is not installed, or is installed somewhere this search did`,
						`not reach: the ${PROGRAM} program could not be found.`,
						``,
						`Install it with:`,
						``,
						`    ${INSTALL_COMMAND}`,
						``,
						`then check it with \`${PROGRAM} --version\`.`,
						``,
						`If it is already installed elsewhere, set ${ENGINE_ENV_VAR} to its`,
						`full path, or start this with --${PROGRAM} <path>.`,
						``,
						`Looked for ${PROGRAM} in:`,
						renderTrail(looked),
						``,
						`Nothing was read, written or changed. This tool only reads and edits an`,
						`existing vault; it never creates one.`,
					].join('\n'),
		);
		this.kind = kind;
		this.looked = looked;
		this.path = path ?? null;
		this.namedBy = namedBy ?? null;
		this.reason = reason ?? null;
		this.installCommand = INSTALL_COMMAND;
	}
}

/**
 * The engine is here and working, and the directory it resolved holds no vault.
 *
 * SEPARATE FROM A REFUSAL ON PURPOSE. It arrives as one — the engine declines every vault-addressed
 * call with exit 2 — but a refusal is a request to fix, and there is no request to fix here. The
 * person typed one word in a directory, and the remedy is a different directory or one command.
 * Folded into `EngineRefusedError` it reaches the user as "the engine refused ontology and printed
 * no refusal envelope", which reads like this app broke.
 *
 * Everything it carries is the engine's own answer to `where --root-only`, which is the one command
 * that answers whether or not a vault is there. This app never assembles a vault path from a working
 * directory: that would be a second resolver, and it would name a path on a machine where the engine
 * resolves something else.
 */
export class VaultNotFoundError extends EngineError {
	/**
	 * @param {object} detail
	 * @param {string} detail.root        the root the engine resolved
	 * @param {string} [detail.source]    how the engine arrived at it, in its own words
	 * @param {string} [detail.project]   the directory that root belongs to
	 * @param {string} [detail.enginePath]
	 *
	 * There is deliberately no `reason`. The engine's refusal text is the thing this class exists to
	 * NOT show: it is about a call the person never made, and printing it is what made the old
	 * message read like a fault. Everything here comes from `where --root-only` instead. A field
	 * documented as carrying the engine's words and never populated is worse than its absence — the
	 * next reader plumbs it through and puts the sentence back on the screen.
	 */
	constructor({ root, source, project, enginePath } = {}) {
		super(
			[
				`There is no Kaleidoscope vault here yet.`,
				``,
				`${PROGRAM} is installed${enginePath ? ` at ${enginePath}` : ''} and answering. It`,
				`resolved this directory to:`,
				``,
				`    ${root}`,
				``,
				`and nothing is there. A vault is where your agent's memories are kept, and`,
				`it is made once, in the project you want remembered:`,
				``,
				`    ${INIT_COMMAND}`,
				``,
				`If you already have one somewhere else, start this app from that project's`,
				`directory instead — or set ${VAULT_ENV_VAR} to its path.`,
				``,
				`Nothing was read, written or changed. This app only reads and edits a vault`,
				`that already exists; it never creates one.`,
			].join('\n'),
		);
		this.outcome = 'no-vault';
		this.root = root ?? null;
		this.source = source ?? null;
		this.project = project ?? null;
		this.enginePath = enginePath ?? null;
		this.initCommand = INIT_COMMAND;
	}
}

/**
 * Exit 2. The engine completed the call and declined it. This is data, not an outage.
 *
 * Usually the refusal arrives on stdout as JSON, the envelope names what to fix and usually says so
 * in as many words, and a caller that renders `refusal.message` and `refusal.next` has told the user
 * everything the engine knows.
 *
 * Not always. Two exit-2 refusals were measured with stdout EMPTY and the whole reason on stderr —
 * a request that could not be deserialized, and a vault address that could not be resolved. Both are
 * ordinary, both are correctable by the user, and neither is a broken engine. So `refusal` is
 * nullable and `reason` carries the text when it is null. **A caller that reads `refusal.message`
 * without checking `refusal` renders nothing on the two most common first-run failures there are.**
 */
export class EngineRefusedError extends EngineError {
	/**
	 * @param {object} detail
	 * @param {object} [detail.refusal]  the parsed refusal envelope from stdout, when there was one
	 * @param {string} [detail.reason]   stderr, verbatim, when there was not
	 * @param {string} [detail.operation]
	 * @param {string} [detail.provenance] stderr, verbatim, for diagnostics only
	 */
	constructor({ refusal, reason = '', operation, provenance } = {}) {
		const what = operation ?? 'the call';
		const code = refusal?.code ? ` (${refusal.code})` : '';
		super(
			refusal
				? [
						`The engine refused ${what}${code}: ${refusal.message ?? 'no message'}`,
						refusal.next ?? null,
					]
						.filter(Boolean)
						.join('\n')
				: // Not summarised and not prefixed with a guess at the cause. The engine's own text
					// names the remedy; anything written around it buries the sentence that fixes it.
					[
						`The engine refused ${what} and printed no refusal envelope.`,
						`The whole of what it said is:`,
						``,
						reason.trim() || '(nothing)',
					].join('\n'),
		);
		this.exitCode = 2;
		this.outcome = 'refused';
		this.refusal = refusal ?? null;
		this.reason = reason;
		this.code = refusal?.code ?? null;
		this.operation = operation ?? null;
		this.provenance = provenance ?? null;
	}
}

/**
 * Exit 3. Some items were written and at least one was not.
 *
 * `call` never throws this — the caller has to see the per-item outcomes to decide what to resend,
 * and an exception that carries them is still an exception a caller can swallow into "Saved". It is
 * thrown by callers for whom a partial application is not a state they can be in: a single-memory
 * write reporting a partial has contradicted the contract, and that must be loud.
 */
export class EnginePartialError extends EngineError {
	/**
	 * @param {object} detail
	 * @param {Array<object>} detail.results  one entry per submitted item, in submission order
	 * @param {object} [detail.data]          the whole engine response
	 * @param {string} [detail.operation]
	 */
	constructor({ results = [], data, operation } = {}) {
		const written = results.filter((item) => item && item.status && item.status !== 'refused');
		super(
			[
				`The engine applied ${operation ?? 'the call'} in part: ` +
					`${written.length} of ${results.length} submitted items were written.`,
				...results
					.filter((item) => item && item.status === 'refused')
					.map(
						(item) =>
							`  item ${item.item_index}: ${item.status} — ${item.reason ?? 'no reason given'}`,
					),
				`Resend only the items that were not written; resending the batch resubmits what the vault already holds.`,
			].join('\n'),
		);
		this.exitCode = 3;
		this.outcome = 'applied_in_part';
		this.results = results;
		this.data = data ?? null;
		this.operation = operation ?? null;
	}
}

/**
 * Exit 4. The licence gate is shut.
 *
 * stdout is EMPTY by design, so the reason is taken from stderr and stdout is never parsed. A client
 * that parses stdout here reports "unexpected end of JSON input" and the user goes looking for a
 * broken install instead of running one command.
 *
 * The body is the engine's own text rather than a copy of it: the engine already writes a good
 * message naming the remedy, and a transcription here would drift from it in silence.
 */
export class EngineUnlicensedError extends EngineError {
	/**
	 * @param {object} detail
	 * @param {string} detail.reason      stderr, verbatim
	 * @param {string} [detail.code]      the machine-readable refusal trailer
	 * @param {string} [detail.enginePath]
	 * @param {string} [detail.operation]
	 */
	constructor({ reason = '', code, enginePath, operation } = {}) {
		super(
			[
				`${PROGRAM}${enginePath ? ` at ${enginePath}` : ''} refused ` +
					`${operation ?? 'the call'} for licensing${code ? ` (${code})` : ''}.`,
				``,
				reason.trim(),
			]
				.join('\n')
				.trim(),
		);
		this.exitCode = 4;
		this.outcome = 'unlicensed';
		this.reason = reason;
		this.code = code ?? null;
		this.enginePath = enginePath ?? null;
		this.operation = operation ?? null;
	}
}

/**
 * Everything else, and it is deliberately not mapped onto one of the four.
 *
 * An exit code outside {0, 2, 3, 4}, a child that could not be spawned, a call that ran past its
 * timeout, or a response that did not parse where the contract says it must. Folding any of these
 * into "refused" would turn a broken engine into a message telling the user to fix their request.
 */
export class EngineCrashedError extends EngineError {
	/**
	 * @param {object} detail
	 * @param {'exit-code'|'spawn'|'timeout'|'unparseable'} detail.kind
	 * @param {number|null} [detail.exitCode]
	 * @param {string|null} [detail.signal]
	 * @param {string} [detail.stdout]
	 * @param {string} [detail.stderr]
	 * @param {string} [detail.operation]
	 * @param {number} [detail.timeoutMs]
	 * @param {Error}  [detail.cause]
	 */
	constructor({
		kind = 'exit-code',
		exitCode = null,
		signal = null,
		stdout = '',
		stderr = '',
		operation,
		timeoutMs,
		cause,
	} = {}) {
		const what = operation ? `${PROGRAM} ${operation}` : PROGRAM;
		const headline = {
			'exit-code': `${what} exited ${exitCode}, which is not one of the four outcomes this client understands.`,
			spawn: `${what} could not be started.`,
			timeout: `${what} did not finish within ${timeoutMs} ms and was killed.`,
			unparseable: `${what} exited ${exitCode} but its output was not the JSON the contract requires.`,
		}[kind];

		super(
			[headline, stderr.trim() ? `The engine said:\n${stderr.trim()}` : null]
				.filter(Boolean)
				.join('\n\n'),
			cause ? { cause } : undefined,
		);
		this.kind = kind;
		this.outcome = 'engine_fault';
		this.exitCode = exitCode;
		this.signal = signal;
		this.stdout = stdout;
		this.stderr = stderr;
		this.operation = operation ?? null;
	}
}
