/**
 * How this server answers, and the one rule that shapes every function in it:
 *
 *   **HTTP status describes the sidecar. The envelope describes the engine.**
 *
 * A refused call is a COMPLETED call. The engine ran, read the request, decided against it and
 * said why in a sentence written for a person. That is data the app renders, not an outage — so it
 * is HTTP 200 with `outcome: "refused"`, and the refusal travels intact. Non-200 is reserved for
 * this server's own failures: a bad token, an unknown route, a child that would not start, a call
 * that ran past its timeout.
 *
 * The alternative — mapping a refusal onto 400 or 500 — forces every screen to distinguish "the
 * engine said no" from "the app is broken" by reading a status code that has just conflated them,
 * and the app then tells a user to reinstall over a mistyped filter.
 */

import {
	EngineCrashedError,
	EngineNotFoundError,
	EnginePartialError,
	EngineRefusedError,
	EngineUnlicensedError,
} from '../engine/errors.mjs';
import { securityHeaders } from './security.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';

/** Written once so no handler can forget the security headers by writing its own response. */
export function sendJson(res, status, body, extraHeaders = {}) {
	const text = JSON.stringify(body);
	const headers = { ...securityHeaders(JSON_TYPE), ...extraHeaders };
	headers['content-length'] = Buffer.byteLength(text);
	res.writeHead(status, headers);
	res.end(res.req?.method === 'HEAD' ? undefined : text);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
	const headers = securityHeaders(contentType);
	headers['content-length'] = Buffer.byteLength(text);
	res.writeHead(status, headers);
	res.end(res.req?.method === 'HEAD' ? undefined : text);
}

/**
 * A refusal with NO BODY at all.
 *
 * Used for the two checks that run before routing. This is deliberate and it is not laziness: a
 * body is an oracle. "Bad token" versus "bad host" versus "no such route" tells someone probing
 * this server from another page exactly which control they tripped and therefore which one to work
 * around next. They get a status code and a closed socket, and the app's own diagnostics — which
 * are on this side of the boundary — carry the reason.
 */
export function sendBare(res, status) {
	res.writeHead(status, {
		...securityHeaders('text/plain; charset=utf-8'),
		'content-length': 0,
		connection: 'close',
	});
	res.end();
}

/** The sidecar's own failure. Never used for anything the engine decided. */
export function sendSidecarError(res, status, kind, message, extra = {}) {
	sendJson(res, status, {
		outcome: 'sidecar_error',
		error: { kind, message, ...extra },
	});
}

/**
 * The engine's response, in the one shape every screen branches on.
 *
 * `data` is passed through WHOLE — no key filtered, renamed or reshaped. The listing endpoint's
 * declared strip of the large derived fields is the single exception, and it happens before the
 * payload reaches here, where it is reported by name rather than done quietly. The reason for the
 * rule is concrete: a write can report that it applied and still name work it declined to store,
 * in a key that is omitted entirely when it declined nothing. A server that reshapes the response
 * cannot see what it dropped, and neither can the screen downstream of it.
 */
export function envelope(engineResult, extra = {}) {
	return {
		outcome: engineResult.outcome,
		exit_code: engineResult.exit_code,
		data: engineResult.data ?? null,
		results: engineResult.results ?? null,
		refusal: null,
		reason: null,
		provenance: engineResult.provenance ?? null,
		duration_ms: engineResult.duration_ms ?? null,
		...extra,
	};
}

/**
 * Turn anything thrown on the way to the engine into something a screen can render.
 *
 * The five error types are five different situations and this is where that stops being an
 * implementation detail and becomes a rendering decision:
 *
 *   - a REFUSAL is a message with a remedy in it, and the app shows it in place;
 *   - a LICENSING stop is a screen with one command on it;
 *   - a PARTIAL is per-item results the user must see item by item;
 *   - a CRASH is the only one of the five that means this app is broken;
 *   - a MISSING ENGINE is an install instruction.
 *
 * Collapsing them into one 500 with a string forces every screen to re-derive the situation by
 * pattern-matching a message, and a message is not a contract.
 */
export function describeEngineError(error) {
	if (error instanceof EngineRefusedError) {
		return {
			status: 200,
			body: {
				outcome: 'refused',
				exit_code: 2,
				data: null,
				results: null,
				// NULLABLE, and a caller that reads `refusal.message` without checking `refusal`
				// renders nothing on the two most common first-run failures there are: a request the
				// engine could not deserialize, and a vault address it could not resolve. Both exit
				// 2 with stdout empty and the whole reason on stderr, which is what `reason` carries.
				refusal: error.refusal,
				reason: error.refusal ? null : error.reason,
				provenance: error.provenance ?? null,
				error: {
					kind: 'refused',
					code: error.code,
					message: error.message,
					next: error.refusal?.next ?? null,
					operation: error.operation,
				},
			},
		};
	}

	if (error instanceof EngineUnlicensedError) {
		// Still 200: the engine completed the call and declined it for a reason the user can fix
		// with one command. It is the same refusal whether it is caught in the launch handshake or
		// halfway through a session — an alpha key can lapse while the app is open — and giving it
		// two different HTTP shapes would make one situation look like two problems.
		return {
			status: 200,
			body: {
				outcome: 'unlicensed',
				exit_code: 4,
				data: null,
				results: null,
				refusal: null,
				reason: error.reason,
				provenance: null,
				error: {
					kind: 'unlicensed',
					code: error.code,
					message: error.message,
					next: null,
					operation: error.operation,
				},
			},
		};
	}

	if (error instanceof EnginePartialError) {
		return {
			status: 200,
			body: {
				outcome: 'applied_in_part',
				exit_code: 3,
				data: error.data,
				// Surfaced per item, always. A server that collapses a partial batch into one word
				// tells the user their work landed when some of it did not.
				results: error.results,
				refusal: null,
				reason: null,
				provenance: null,
				error: { kind: 'applied_in_part', message: error.message, operation: error.operation },
			},
		};
	}

	if (error instanceof EngineCrashedError) {
		// The only branch that is a non-200, because it is the only one that means this app is
		// broken rather than the request being wrong. A timeout gets its own status: the request
		// may yet have had an effect on the vault, and 504 is the code that says "no answer",
		// which is the true statement.
		const status = error.kind === 'timeout' ? 504 : 502;
		return {
			status,
			body: {
				outcome: 'engine_fault',
				exit_code: error.exitCode,
				data: null,
				results: null,
				refusal: null,
				reason: null,
				provenance: null,
				error: {
					kind: error.kind,
					message: error.message,
					operation: error.operation,
					// stderr, verbatim, for the app's own diagnostics panel. It is never read to
					// decide anything — a working call routinely writes to stderr.
					stderr: error.stderr || null,
				},
			},
		};
	}

	if (error instanceof EngineNotFoundError) {
		return {
			status: 502,
			body: {
				outcome: 'engine_fault',
				exit_code: null,
				data: null,
				results: null,
				refusal: null,
				reason: null,
				provenance: null,
				error: {
					kind: 'engine-not-found',
					// The engine's own text, whole. It names what was looked for, everywhere it
					// looked, one install command and what happened to the user's data. Anything
					// written around it buries the sentence that fixes the machine.
					message: error.message,
					install_command: error.installCommand,
				},
			},
		};
	}

	// Anything else is this server's own bug. It is reported as one rather than dressed up as
	// something the user did, and the stack stays on this side of the wire.
	return {
		status: 500,
		body: {
			outcome: 'sidecar_error',
			error: { kind: 'unhandled', message: error?.message ?? String(error) },
		},
	};
}

/** Run a handler, and turn whatever it throws into the structured shape above. */
export async function guard(res, handler) {
	try {
		await handler();
	} catch (error) {
		if (res.headersSent) {
			res.destroy();
			return;
		}
		const { status, body } = describeEngineError(error);
		sendJson(res, status, body);
	}
}
