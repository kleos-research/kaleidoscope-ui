/**
 * THE RANKED DOOR, AND THE ONLY PLACE IN THIS PRODUCT THAT REACHES IT.
 *
 * Until this milestone the rule was "no route reaches ranked search, ever", and the reason was
 * good: there is one retrieval door, it ALWAYS records an exposure row, that row is permanent, it
 * stores the query text verbatim, and nothing published reads it back or removes one. A filter box
 * wired to it turns browsing into a keystroke log inside the user's own memory.
 *
 * The approved design adds it back, deliberately, as one explicit action on one screen — "Ask the
 * way your agent does" — because it answers a question nothing else in the product can: what would
 * my agent actually have been given for this? A user who can see the ranked result is a user who can
 * find the wrong memory in it, which is the fastest route to a memory worth fixing.
 *
 * SO THE RULE IS NARROWER, NOT GONE:
 *
 *   A ranked search happens ONLY on an explicit user action on the search screen. Never on load,
 *   never on a poll, never on a keystroke, never on a refresh, never from any other screen.
 *
 * Three things enforce it and none of them is a convention:
 *
 *   1. THIS IS THE ONLY MODULE THAT NAMES THE OPERATION. One route, one handler, no passthrough.
 *   2. IT IS A POST. A GET is what a page load, a prefetch, a poll and a link can all perform; a
 *      POST needs a matching `Origin`, a JSON content type and a body, so nothing performs one by
 *      arriving somewhere.
 *   3. `test/server.test.mjs` walks every route and every screen load, asserts the exposure count
 *      did not move, then calls this route once and asserts it moved by exactly one.
 *
 * The engine refuses `ledger: false` rather than silently upgrading it, so a caller cannot ask for
 * a read-only ranked search and quietly get a write. This handler does not send the field at all:
 * there is no value it could carry that would change the outcome, and a parameter that cannot
 * matter reads to the next person as one that can.
 */

import { call } from '../engine/call.mjs';
import { describeEngineError, envelope, sendJson, sendSidecarError } from './respond.mjs';
import { readJsonBody } from './write.mjs';

/**
 * The fields a caller may set, and nothing else.
 *
 * An allowlist rather than a pass-through of the body. The published operation takes a dozen
 * controls — channel selection, candidate pools, validity instants — and every one of them changes
 * what a measurement means. This product asks the question a user's agent would ask, which means
 * the defaults, so the only things a caller may move are the three a person can see the effect of:
 * what they asked, how many memories come back, and which project it is asked within.
 */
const ALLOWED = new Set(['query', 'top_k', 'scope']);

/** The scope axes, as field names in the published contract. Values are never listed here. */
const SCOPE_AXES = new Set(['project', 'branch', 'artifact']);

export function createAskHandler({ where, bodyLimit, timeoutMs = 60_000 }) {
	/**
	 * One ranked search, on one explicit press.
	 *
	 * What comes back is the envelope every other route returns, plus nothing this module invented.
	 * The screen's whole claim is that it is showing exactly what the agent would have received, so
	 * a field added here — a re-ranking, a highlight, a filtered-out row — would make that claim
	 * false while looking like an improvement.
	 */
	return async function handleAsk(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit: bodyLimit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		const unknown = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
		if (unknown.length > 0) {
			return sendSidecarError(
				res,
				400,
				'unknown-field',
				`This route takes ${[...ALLOWED].join(', ')} and was given ${unknown.join(', ')}. ` +
					`Nothing was read, asked or recorded.`,
			);
		}

		const query = typeof body?.query === 'string' ? body.query.trim() : '';
		if (query === '') {
			// REFUSED RATHER THAN SENT. An empty ranked query still writes an exposure row, so a
			// screen that posted one on mount — a cleared box, a first render — would record a read
			// nobody performed, permanently, in the store it is inspecting.
			return sendSidecarError(
				res,
				400,
				'empty-query',
				'A ranked search needs something to ask. Nothing was asked and nothing was recorded.',
			);
		}

		const request = { query };

		if (body.top_k !== undefined) {
			if (!Number.isInteger(body.top_k) || body.top_k < 1) {
				return sendSidecarError(
					res,
					400,
					'bad-top-k',
					'top_k is a whole number of memories, at least one. Nothing was asked.',
				);
			}
			// The engine publishes a ceiling and refuses above it, naming the ceiling. That refusal
			// is a better answer than a limit written down here, which would drift from it silently.
			request.top_k = body.top_k;
		}

		if (body.scope !== undefined && body.scope !== null) {
			const axes = Object.keys(body.scope);
			const strange = axes.filter((axis) => !SCOPE_AXES.has(axis));
			if (strange.length > 0) {
				return sendSidecarError(
					res,
					400,
					'unknown-scope-axis',
					`Scope takes ${[...SCOPE_AXES].join(', ')} and was given ${strange.join(', ')}. ` +
						'Nothing was asked.',
				);
			}
			// An axis set to null is an axis that was not set. Sending it would narrow to memories
			// whose value is literally null rather than matching every memory, which is the exact
			// inversion this product says out loud everywhere else.
			const scope = {};
			for (const axis of axes) {
				if (typeof body.scope[axis] === 'string' && body.scope[axis] !== '') {
					scope[axis] = body.scope[axis];
				}
			}
			if (Object.keys(scope).length > 0) request.scope = scope;
		}

		try {
			const result = await call('search', request, { ...where, timeoutMs });
			sendJson(res, 200, envelope(result, { asked: query, recorded: true }));
		} catch (error) {
			const described = describeEngineError(error);
			sendJson(res, described.status, described.body);
		}
	};
}
