/**
 * Everything this page is allowed to ask the sidecar for.
 *
 * THERE IS NO RANKED SEARCH HERE, AND THERE MUST NOT BE ONE. A ranked query records that it ran:
 * the record is permanent, it stores the query text, and nothing published reads it back or removes
 * one. The box at the top of the list is a filter over a payload this module already fetched — it
 * calls nothing in this file. If a later contributor is looking for the function that would make
 * that box "actually search", it is deliberately absent, and adding it here is the change that
 * turns a read-only browser into the largest writer the vault has.
 *
 * Every export below is a read. Four of them, all named for the door they open.
 */

/** How long the browser waits on the sidecar before it says so rather than spinning forever. */
const REQUEST_TIMEOUT_MS = 180_000;

/**
 * The per-launch bearer token, held in a module-scoped variable and nowhere else.
 *
 * Not `localStorage`, not `sessionStorage`, not a cookie, and never a query string: this token has
 * total read and write authority over the user's most sensitive local store, and a query string is
 * written to history, to any referrer, and to every log between here and the socket.
 *
 * ONE carrier: the URL fragment (`#token=…`), which the browser never puts on the wire, read once
 * at startup and erased from the address bar immediately. A second carrier — a meta tag the server
 * rewrites — was written and removed: the server hands the token over in the launch URL and never
 * touched the tag, so it was a mechanism that read as wired and was not.
 *
 * If the fragment carries none, requests go without an Authorization header. That is the right
 * behaviour for `vite dev` and for a sidecar that authenticates some other way; it is not a
 * fallback that grants access, because the decision to accept an unauthenticated request is the
 * server's, and it answers 401.
 */
let token = null;

export function captureToken() {
	const fragment = window.location.hash.replace(/^#/, '');
	const fromFragment = new URLSearchParams(fragment).get('token');
	if (fromFragment) {
		token = fromFragment;
		// Replace rather than push: the token must not be reachable by pressing Back.
		window.history.replaceState(null, '', `${window.location.pathname}#/`);
	}
}

/** A failure that came from the sidecar rather than from the engine behind it. */
export class SidecarError extends Error {
	constructor(message, { status = null, url = null, body = null } = {}) {
		super(message);
		this.name = 'SidecarError';
		this.status = status;
		this.url = url;
		this.body = body;
	}
}

async function get(path, { signal } = {}) {
	const headers = { Accept: 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;

	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	let response;
	try {
		response = await fetch(path, {
			method: 'GET',
			headers,
			credentials: 'same-origin',
			// `connect-src 'self'` already forbids a cross-origin request; this says so at the call
			// site too, so a same-origin assumption is not something a reader has to infer.
			mode: 'same-origin',
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
	} catch (cause) {
		throw new SidecarError(
			`The app could not reach its own local server at ${path}. It may have exited — this ` +
				`server stops on its own once no browser tab is talking to it.`,
			{ url: path, body: String(cause?.message ?? cause) },
		);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new SidecarError(sidecarMessageFor(response.status, path), {
			status: response.status,
			url: path,
			body,
		});
	}

	try {
		return await response.json();
	} catch (cause) {
		throw new SidecarError(`${path} answered with something that is not JSON.`, {
			status: response.status,
			url: path,
			body: String(cause?.message ?? cause),
		});
	}
}

/**
 * A status code describes the sidecar, never the engine: a refused engine call arrives as HTTP 200
 * with `outcome: "refused"` in the body. So every status handled here is a problem with this app or
 * with the connection between the page and it, and each one gets its own sentence — "request
 * failed" sends a user to look in the wrong place.
 */
function sidecarMessageFor(status, path) {
	if (status === 401 || status === 403) {
		return (
			'The local server refused this page. That usually means the tab was reopened from ' +
			'history after the server restarted, and the launch token in this tab is no longer the ' +
			'one it is holding. Relaunch the app to get a fresh one.'
		);
	}
	if (status === 404) return `This build of the app asked for ${path}, which its server does not serve.`;
	if (status === 413) return 'The server declined to load this vault because of its size.';
	if (status === 504) return 'The engine took longer to answer than the server was willing to wait.';
	return `The local server answered ${status} for ${path}.`;
}

/**
 * The readings: which engine, which vault, whether the gate is open, whether the model is bundled,
 * and the vocabulary parsed out of the engine's own printed contract a moment ago.
 *
 * NO VOCABULARY IS COMPILED INTO THIS APP. Memory types, entity kinds and relation names are open,
 * growing registries; a value transcribed into a dropdown here stops offering something that exists
 * the first time the engine adds one, silently. Every option list in this app is built from what
 * this call returns.
 *
 * Two paths because the route has been called both things during M2; the second is the name in the
 * route table. Neither is retried and neither is cached, and a 404 on the first is not an error.
 */
export async function fetchSession(options) {
	try {
		return await get('/api/preflight', options);
	} catch (error) {
		if (error instanceof SidecarError && error.status === 404) return get('/api/session', options);
		throw error;
	}
}

/**
 * Every memory in the vault, in one read that writes nothing.
 *
 * The door behind this has no filter and no pagination: it returns the whole vault every time. That
 * is why this is called on launch and on the user's word and never on a timer, and why filtering,
 * sorting and paging afterwards are pure functions over what it returned.
 */
export function fetchMemories({ refresh = false, signal } = {}) {
	return get(refresh ? '/api/memories?refresh=1' : '/api/memories', { signal });
}

/**
 * The cheap liveness read. Its cost does not grow with the vault, which is what makes it safe on a
 * timer where re-exporting the vault would not be. It fetches no memory and writes nothing.
 */
export function fetchHealth({ signal } = {}) {
	return get('/api/health', { signal });
}

/**
 * One memory's lineage — what the vault records as contradicting or correcting it from the other
 * side. Issued only when the reader expands that panel, never on load and never on a timer.
 */
export function fetchLineage(memoryId, { signal } = {}) {
	return get(`/api/memories/${encodeURIComponent(memoryId)}/lineage`, { signal });
}
