/**
 * The only place in this repository that starts a child process.
 *
 * Everything about this file is downstream of one fact: the engine's exit code is the protocol, and
 * its stderr is not. A working call routinely writes to stderr — every command that resolved the
 * vault address rather than being told it prints that resolution, unprompted, ON SUCCESS. The
 * convenience wrappers in most runtimes reject when stderr is non-empty, so wired that way the app
 * fails on its first call, on a healthy machine, with a healthy vault, and the failure looks like a
 * broken binary. stderr is captured, attached for display, and consulted for exactly one decision:
 * nothing.
 */

import { spawn } from 'node:child_process';

import {
	EngineCrashedError,
	EngineRefusedError,
	EngineUnlicensedError,
} from './errors.mjs';

/** A call is a handful of milliseconds of work; 30 s is a hang, not a slow vault. */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** The readings — version, address, contract — are single reads with no vault work behind them. */
const DEFAULT_RUN_TIMEOUT_MS = 10_000;

/** How long a killed child gets to exit before it is killed harder. */
const KILL_GRACE_MS = 2_000;

/** The trailer the engine appends to a licensing refusal, so the reason can be classified. */
const LICENCE_TRAILER = /^[a-z-]*entitlement-refusal:\s*(\S+)\s*$/im;

/**
 * Spawn once, collect everything, decide nothing.
 *
 * @returns {Promise<{exitCode: number|null, signal: string|null, stdout: string, stdoutBytes: Buffer, stderr: string, durationMs: number, timedOut: boolean}>}
 */
function spawnEngine(enginePath, args, { root, stdin, timeoutMs }) {
	if (typeof enginePath !== 'string' || enginePath.length === 0) {
		throw new TypeError('enginePath is required: locate the engine before calling it.');
	}

	return new Promise((settle, fail) => {
		const startedAt = performance.now();

		// The vault is named through the environment, never through argv, so the argument vector is
		// the same shape on every call and no caller can smuggle a second vault into one.
		const env = root ? { ...process.env, KSCOPE_ROOT: root } : process.env;

		const child = spawn(enginePath, args, {
			env,
			shell: false, // no user-controlled text ever reaches a shell
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const out = [];
		const err = [];
		let timedOut = false;
		let hardKill;

		const softKill = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			hardKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
		}, timeoutMs);

		child.stdout.on('data', (chunk) => out.push(chunk));
		child.stderr.on('data', (chunk) => err.push(chunk));

		// A licensing refusal exits before it reads stdin, so writing the payload races the child's
		// death. EPIPE here is the child's answer, not a failure of ours — the exit code carries it.
		child.stdin.on('error', () => {});
		child.stdin.end(stdin ?? '');

		child.on('error', (cause) => {
			clearTimeout(softKill);
			clearTimeout(hardKill);
			fail(
				new EngineCrashedError({
					kind: 'spawn',
					operation: args.join(' '),
					stderr: Buffer.concat(err).toString('utf8'),
					cause,
				}),
			);
		});

		child.on('close', (exitCode, signal) => {
			clearTimeout(softKill);
			clearTimeout(hardKill);
			const stdoutBytes = Buffer.concat(out);
			settle({
				exitCode,
				signal,
				stdout: stdoutBytes.toString('utf8'),
				stdoutBytes,
				stderr: Buffer.concat(err).toString('utf8'),
				durationMs: Math.round(performance.now() - startedAt),
				timedOut,
			});
		});
	});
}

function parseOrCrash(raw, { operation, kind = 'unparseable' }) {
	try {
		return JSON.parse(raw.stdout);
	} catch (cause) {
		throw new EngineCrashedError({
			kind,
			exitCode: raw.exitCode,
			stdout: raw.stdout,
			stderr: raw.stderr,
			operation,
			cause,
		});
	}
}

/**
 * Run one operation through the engine's data door.
 *
 * @param {string} operation
 * @param {object} request              written to the child's stdin as JSON
 * @param {object} [options]
 * @param {string} options.enginePath   the canonical path from `locateEngine`
 * @param {string} [options.root]       pins the vault for this call
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.keepStdout] also return the engine's stdout VERBATIM. Only a caller
 *        that must preserve the engine's own bytes needs it; see the note where it is attached.
 * @returns {Promise<{outcome: string, exit_code: number, data: object|null, results: Array|null, refusal: null, reason: null, provenance: string|null, duration_ms: number}>}
 *
 * Exit 0 and exit 3 return. Exit 2 and exit 4 throw, because neither one produced a result the
 * caller could work with. Exit 3 deliberately does NOT throw: the per-item results are the thing the
 * caller has to act on, and an exception carrying them is still an exception someone can swallow
 * into "Saved".
 *
 * @throws {EngineRefusedError}    exit 2
 * @throws {EngineUnlicensedError} exit 4
 * @throws {EngineCrashedError}    any other exit code, a timeout, or a spawn failure
 */
export async function call(operation, request, { enginePath, root, timeoutMs, keepStdout } = {}) {
	if (typeof operation !== 'string' || operation.length === 0) {
		throw new TypeError('call() needs a named operation.');
	}

	const raw = await spawnEngine(enginePath, ['call', operation], {
		root,
		stdin: JSON.stringify(request ?? {}),
		timeoutMs: timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
	});

	if (raw.timedOut) {
		throw new EngineCrashedError({
			kind: 'timeout',
			operation,
			stdout: raw.stdout,
			stderr: raw.stderr,
			timeoutMs: timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
		});
	}

	// stderr, verbatim, for the app's own diagnostics. Never read to decide anything.
	const provenance = raw.stderr.trim() || null;

	switch (raw.exitCode) {
		case 0:
		case 3: {
			const data = parseOrCrash(raw, { operation });
			return {
				outcome: raw.exitCode === 0 ? 'applied' : 'applied_in_part',
				exit_code: raw.exitCode,
				// Passed through WHOLE. A write can report that it applied and still name work it
				// declined to store, in a key that is omitted entirely when it declined nothing, so a
				// client that reshapes this response cannot see what it lost.
				data,
				// Surfaced on 0 as well as 3: a batch that fully applied still carries one entry per
				// item, and a caller reading `results` only on 3 has two code paths for one shape.
				results: Array.isArray(data?.results) ? data.results : null,
				refusal: null,
				reason: null,
				provenance,
				duration_ms: raw.durationMs,
				// OFF BY DEFAULT, and the one caller that asks for it has a measured reason.
				//
				// The export door signs its payload: the envelope carries a digest over the bytes
				// the ENGINE serialised, and the import door checks it. A JSON round trip through
				// this runtime does not preserve those bytes — `0.0` comes back as `0`, and the
				// digest stops matching. The refusal is
				// `memory export payload digest does not match`, and it is what a snapshot handed
				// back to the engine earns if this app ever re-serialised it.
				//
				// So a client that intends to KEEP an export has to keep the bytes, not the object.
				// Every other caller gets `data` and this stays undefined, because carrying a second
				// copy of every response is a cost with no reader.
				stdout: keepStdout ? raw.stdout : undefined,
			};
		}

		case 2: {
			// A refusal is data, and it is USUALLY on stdout as JSON. Two measured refusals are not:
			// a request the engine could not deserialize, and a vault address it could not resolve,
			// both of which exit 2 with stdout empty and the whole reason on stderr. Treating an
			// empty stdout as a broken contract sends a user with a mistyped vault path off to
			// reinstall the engine, past the sentence that names their actual mistake.
			//
			// A NON-empty stdout that does not parse is still a crash: the engine started to speak
			// the protocol and did not finish, which is not something a user can correct.
			if (raw.stdout.trim().length === 0) {
				throw new EngineRefusedError({ reason: raw.stderr, operation, provenance });
			}
			const refusal = parseOrCrash(raw, { operation });
			throw new EngineRefusedError({ refusal, operation, provenance });
		}

		case 4: {
			// stdout is EMPTY by design. Parsing it reports "unexpected end of JSON input" and sends
			// the user looking for a broken install instead of running one command.
			throw new EngineUnlicensedError({
				reason: raw.stderr,
				code: raw.stderr.match(LICENCE_TRAILER)?.[1] ?? null,
				enginePath,
				operation,
			});
		}

		default:
			// Never mapped onto the nearest known outcome. An engine speaking a protocol this client
			// does not know is a fault to report, not a refusal to render.
			throw new EngineCrashedError({
				kind: 'exit-code',
				exitCode: raw.exitCode,
				signal: raw.signal,
				stdout: raw.stdout,
				stderr: raw.stderr,
				operation,
			});
	}
}

/**
 * Run a command that is not `call` — the readings the preflight takes.
 *
 * Thin on purpose: several of these print prose rather than JSON, so nothing is parsed here and the
 * caller branches on `exitCode`. The two codes it does handle are the two a caller cannot handle
 * safely on its own — a licensing refusal, whose empty stdout reads as a crash, and a child that
 * never ran.
 *
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} options.enginePath
 * @param {string} [options.root]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{exitCode: number, stdout: string, stdoutBytes: Buffer, stderr: string, durationMs: number}>}
 */
export async function run(args, { enginePath, root, timeoutMs } = {}) {
	const limit = timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
	const raw = await spawnEngine(enginePath, args, { root, timeoutMs: limit });
	const operation = args.join(' ');

	if (raw.timedOut) {
		throw new EngineCrashedError({
			kind: 'timeout',
			operation,
			stdout: raw.stdout,
			stderr: raw.stderr,
			timeoutMs: limit,
		});
	}

	if (raw.exitCode === 4) {
		throw new EngineUnlicensedError({
			reason: raw.stderr,
			code: raw.stderr.match(LICENCE_TRAILER)?.[1] ?? null,
			enginePath,
			operation,
		});
	}

	return {
		exitCode: raw.exitCode,
		stdout: raw.stdout,
		stdoutBytes: raw.stdoutBytes,
		stderr: raw.stderr,
		durationMs: raw.durationMs,
	};
}
