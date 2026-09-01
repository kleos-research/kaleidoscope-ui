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
 * Four of the exports below are reads. Three are the write path M3 adds, and they are the only
 * functions in this repository that can change a vault: one that loads a memory THROUGH THE DOOR
 * THAT CARRIES ITS ENTITY DECLARATIONS, and two that post. None of them ranks anything.
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
		// THE COMMONEST CAUSE IS A RELOAD, and it is named first for that reason. The launch token
		// arrives in the fragment, is read once and erased, so a reloaded tab has no credential —
		// which the graph screen made an ordinary thing to do, because its view is in that same
		// fragment and a reload is how a person returns to a drawing. Naming a restarted server
		// first sent the reader to look at the terminal for a process that is running perfectly.
		return (
			'The local server refused this page. The launch token is read once from the URL and then ' +
			'erased, so a reloaded or reopened tab holds no credential — the view came back, the ' +
			'session did not. (A restarted server looks the same from here: the token this tab held ' +
			'is no longer the one it is holding.) Relaunch the app to get a fresh one.'
		);
	}
	if (status === 404) return `This build of the app asked for ${path}, which its server does not serve.`;
	if (status === 413) return 'The server declined to load this vault because of its size.';
	if (status === 504) return 'The engine took longer to answer than the server was willing to wait.';
	return `The local server answered ${status} for ${path}.`;
}

/**
 * A write, or the load that one is built from.
 *
 * Separate from `get` rather than a flag on it, because the two are not the same request and the
 * differences are all load-bearing: this one carries a body, declares `application/json` — which a
 * cross-origin form post cannot send, so the declaration is a control and not a formality — and is
 * a method the sidecar's Origin check treats as state-changing. It is also NEVER retried. A retried
 * write is a second write, and if the first landed the second is refused for a stale version, which
 * is the good case; the bad case is that it did not land and nobody can tell which happened.
 */
async function post(path, payload, { signal } = {}) {
	const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;

	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	let response;
	try {
		response = await fetch(path, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			credentials: 'same-origin',
			mode: 'same-origin',
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
	} catch (cause) {
		// The most dangerous message this file can produce, so it is the most carefully worded: a
		// request that never got an answer is not a request that did nothing. The save may have
		// reached the vault. Telling the user it failed would invite them to press it again.
		throw new SidecarError(
			`The app did not get an answer from its own local server for ${path}. This is not the ` +
				`same as the save failing: the write may or may not have reached the vault. Reload ` +
				`this memory before changing anything else, and check whether the edit is there.`,
			{ url: path, body: String(cause?.message ?? cause) },
		);
	}

	const text = await response.text();
	let body = null;
	try {
		body = text.length > 0 ? JSON.parse(text) : null;
	} catch {
		body = null;
	}

	if (!response.ok) {
		// The sidecar's own refusals carry a structured error; the engine's arrive with HTTP 200 and
		// are the caller's to branch on. Both are handed back rather than flattened into a string.
		throw new SidecarError(
			body?.error?.message ?? sidecarMessageFor(response.status, path),
			{ status: response.status, url: path, body },
		);
	}
	if (body === null) {
		throw new SidecarError(`${path} answered with something that is not JSON.`, {
			status: response.status,
			url: path,
			body: text.slice(0, 400),
		});
	}
	return body;
}

/**
 * The record the editor is built from. THE ONLY DOOR AN EDIT MAY LOAD THROUGH.
 *
 * Not `/api/memories/:id`, not the listing already in this browser's memory, and not conditionally.
 * The route that displays a memory answers from the cached export and does NOT carry the memory's
 * entity declarations; the write requires them. An editor built on the display record produces a
 * write that commits — exit 0, no refusal, no warning — with every named thing the memory declared
 * deleted, and the next read looks fine because it reads the same lossy record.
 *
 * It is also where the version an update expects to replace comes from, taken fresh on every open,
 * because a cached version id is a conflict the user did not cause.
 */
export function fetchEditRecord(memoryId, { signal } = {}) {
	return get(`/api/memories/${encodeURIComponent(memoryId)}/edit`, { signal });
}

/**
 * Replace a memory's body AND its structure. There is no body-only write.
 *
 * `remember` in update mode replaces both together, so a prose-only edit is not a smaller call — it
 * is the same call with the loaded structure re-sent unchanged beside the new body. A caller that
 * sent only the prose would delete every fact and every named thing on the memory.
 */
export function saveMemory(memoryId, { content_md, semantic_delta, expected_version_id }, options) {
	return post(
		`/api/memories/${encodeURIComponent(memoryId)}`,
		{ content_md, semantic_delta, expected_version_id },
		options,
	);
}

/** A new memory. Carries no version, because there is nothing yet for it to expect to replace. */
export function createMemory({ content_md, semantic_delta }, options) {
	return post('/api/memories', { content_md, semantic_delta }, options);
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

/**
 * The curation findings this vault's owner has already said are not problems.
 *
 * THIS DOES NOT TOUCH THE VAULT, in either direction. It reads one JSON file this app keeps beside
 * its snapshot store, keyed by the vault it resolved at launch. The backlog screen is built from
 * the listing it already has plus this; nothing on it asks the engine anything, which is why the
 * whole screen can be driven as arithmetic in a test.
 */
export function fetchDismissals({ signal } = {}) {
	return get('/api/dismissals', { signal });
}

/**
 * Hide a finding, or put it back.
 *
 * A POST that changes only what this app shows. It is deliberately the same door in both
 * directions: a person who can hide something they were shown must be able to unhide it, and a
 * one-way hide is how a backlog quietly stops reporting the thing it exists to report.
 */
export function setDismissal({ action = 'dismiss', ...record }, options) {
	return post('/api/dismissals', { action, ...record }, options);
}

/**
 * One copy this app kept before a write, WITH the engine's own bytes.
 *
 * It goes through `get`, and that is the whole reason this function exists. The receipt a write
 * returns carries an `href` at `/api/snapshots/<id>`, and every route under `/api/` is token-gated —
 * so an `<a href>` pointing at one is a navigation the browser sends with no Authorization header,
 * and the user who followed the app's own offer to "go and look at a copy" gets a bare 401. The link
 * read as wired and was not.
 *
 * `export_json` comes back as a STRING and must stay one all the way to the file. The engine signs
 * its own serialisation of the payload and the import door checks that digest; a JSON round trip
 * through this runtime does not preserve those bytes, so anything that parsed and re-emitted this
 * would hand the user a file refused at exactly the moment it mattered. A JSON string survives
 * `stringify`/`parse` unchanged, which is why the sidecar carries it as text and this returns it
 * untouched.
 */
export function fetchSnapshot(snapshotId, { signal } = {}) {
	return get(`/api/snapshots/${encodeURIComponent(snapshotId)}`, { signal });
}

/**
 * Remove one memory, or several, in one run.
 *
 * ONE FUNCTION FOR BOTH, because there is one route and one server-side path: a single removal that
 * went a different way from a bulk one would be a second implementation of the version re-read, the
 * snapshot and the verification, and the two would drift.
 *
 * **This is not a delete of a resource and it is not idempotent.** It starts a run, the run is
 * serial and stops at the first refusal, and what comes back is a report with one row per memory
 * the caller named — including the rows the run never reached. A caller that reads only a status
 * code from this has learned nothing about what happened to the user's data.
 *
 * `escalated` says the run was started from "What removal cannot do", where a memory holds a
 * secret. It suppresses the CAPTURE of the local copy and not the record of it: the snapshot store
 * still writes a header saying the bytes were not kept and why.
 *
 * `seen_version_id` on an item is the version the user was looking at when they selected it. It is
 * NOT what the write carries — the server re-reads that immediately before each call — it is how
 * the run refuses to remove something that changed after the user read it.
 */
export function removeMemories(items, { escalated = false, signal } = {}) {
	return post('/api/removals', { items, escalated }, { signal });
}

/**
 * Unify a spelling: rewrite one name into another across every memory that uses it.
 *
 * **This is not an engine operation.** The published surface has no rename, so this starts a run of
 * N separate updates, each carrying its own expected version and each preceded by a copy. What
 * comes back is a report with one row per memory named — including the rows the run never reached,
 * because it stops at the first refusal — and a `resume` naming exactly the work that is left.
 *
 * A caller that reads only a status code from this has learned nothing about what happened to the
 * user's data.
 *
 * `seen_version_id` on an item is the version the preview was built from. It is NOT what the write
 * carries — the server re-reads that immediately before each call — it is how the run refuses to
 * rewrite a memory that changed after the user approved the preview.
 */
export function runRename({ from, to, items }, { signal } = {}) {
	return post('/api/renames', { from, to, items }, { signal });
}

/**
 * Merge two memories: write the composed survivor, then remove the duplicate.
 *
 * The composition is carried in the request because a person made it. This app does not compose one
 * on the user's behalf and the server refuses a request that omits it — a merge is the only action
 * that combines two fact sets and two declaration lists, and it is the most likely place in this
 * product to lose data.
 *
 * The order is fixed by the route and stated in the report it returns. If the second write fails,
 * two memories are left rather than none.
 */
export function runMerge({ survivor, duplicate }, { signal } = {}) {
	return post('/api/merges', { survivor, duplicate }, { signal });
}

/**
 * Is a merge half-finished in this vault? Read at launch, and it touches no vault in either
 * direction — it reads one JSON file this app keeps beside its snapshot store.
 */
export function fetchPendingMerge({ signal } = {}) {
	return get('/api/pending-merge', { signal });
}

/**
 * Finish a half-finished merge, or undo it.
 *
 * `undo` is a third WRITE of a payload this app kept before the merge, not a rollback: no published
 * door returns a prior version. The response says so in words, and the screen repeats it.
 */
export function resolvePendingMerge(action, { signal } = {}) {
	return post('/api/pending-merge', { action }, { signal });
}
