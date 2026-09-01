/**
 * The sidecar: one local HTTP server, on loopback, with no runtime dependency of any kind.
 *
 * A browser cannot open a vault and it should not learn how. This process stands between the two:
 * it owns the resolved engine path, the resolved vault address, the export cache, and the token
 * that says a request came from the app rather than from the last page the user visited. The
 * browser can ask for a NAMED operation. It can never name a command, an argument, a path or a
 * vault.
 *
 * Two properties of this file are worth stating before the code, because both look like something
 * to tidy up later and neither is:
 *
 * **The route table is an allowlist, and there is no generic passthrough.** `POST /api/call
 * {op, payload}` is the obvious design, takes twenty lines, and makes every rule in this file
 * advisory — any page that gets a token, and every future feature that finds the endpoint
 * convenient, reaches ranked search and every command this app deliberately does not route.
 * Adding an operation means adding a route, in a diff a reviewer can see.
 *
 * **The security checks run in a fixed order, before routing, and they are all here.** They were
 * written together rather than accumulated, because the failure mode of accumulating them is a
 * posture that looks complete and has a hole in the middle: checking `Origin` without checking
 * `Host` is precisely that shape, and it stops nothing.
 *
 * **M3 ADDS THE THREE WRITE ROUTES, AND THE METHOD ALLOWLIST IS STILL WHAT ENFORCES THE SHAPE.**
 * `POST` is accepted, `OPTIONS` is still answered 405, and everything else is still refused before
 * routing. The write routes are non-GET on purpose: `originAllowed` requires a matching `Origin`
 * header on any method that is not GET or HEAD, so a page on another origin cannot reach them even
 * with a token — the check was written in M2 for exactly the routes that did not exist yet.
 */

import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { call } from '../engine/call.mjs';
import { assessCompatibility } from '../engine/compatibility.mjs';
import { exportMemory, listMemories } from '../engine/memory.mjs';
import { launchBlockers, preflight } from '../engine/preflight.mjs';
import { createAskHandler } from './ask.mjs';
import { createAssetServer } from './assets.mjs';
import { createListingCache, selectMemories, SCOPE_UNSET, SORT_KEYS } from './cache.mjs';
import { createDismissalStore, DismissalStoreError, MAX_DISMISSALS } from './dismissals.mjs';
import { createCurationHandlers } from './merge.mjs';
import { createPendingMergeStore } from './pending.mjs';
import { createRemovalHandlers } from './removal.mjs';
import { envelope, guard, sendBare, sendJson, sendSidecarError } from './respond.mjs';
import { createSnapshotStore } from './snapshots.mjs';
import { createWriteHandlers, readJsonBody } from './write.mjs';
import {
	allowedHosts,
	bearerToken,
	hostAllowed,
	mintToken,
	originAllowed,
	RESERVED_PARAMETERS,
	tokenMatches,
} from './security.mjs';

/**
 * The only addresses this server will bind.
 *
 * There is no `--host` flag and this is the reason: the vault is the user's memory, there is no
 * authentication layer to put in front of it, and every value other than these two makes it
 * reachable from another machine. A caller that asks for one is refused at startup rather than
 * quietly corrected, so a launcher that grew a `--host` flag fails loudly instead of listening.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

/** A forgotten tab must not leave a vault-reading server running for a week. */
const DEFAULT_IDLE_MS = 30 * 60_000;

/**
 * The ONLY directory this server will ever read a file from, unless a caller names another.
 *
 * It is derived from this file's own location rather than from the working directory, so what is
 * served is this package's build output and not whatever happens to sit beside the terminal the
 * launcher was typed into.
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_ASSETS_DIR = join(PACKAGE_ROOT, 'dist');

/** The whole-vault export is not a single read; the rest of the calls here are. */
const LISTING_TIMEOUT_MS = 120_000;

/**
 * The health door.
 *
 * Named, with its payload built here from nothing the caller supplied, so there is no argument
 * shape that turns this route into a different operation. It writes nothing and its cost does not
 * grow with the vault, which is what makes it the thing an app may read on a timer where
 * re-exporting the vault would not be.
 *
 * THIS SERVER NEVER CALLS IT ON A TIMER. The browser polls it, at the user's window's expense, and
 * a moved commit position sets a badge that fetches nothing until the user asks. A background poll
 * in here would make the sidecar a writer's worth of load on a vault nobody is looking at.
 */
const readHealth = (where) => call('doctor', { mode: 'inspect' }, where);

/**
 * Start the sidecar.
 *
 * @param {object} options
 * @param {object} [options.readings]   what `preflight()` returned; taken here when not supplied
 * @param {string} [options.enginePath] used to take the readings when `readings` is not supplied
 * @param {string} [options.root]       the vault, pinned for every call; resolved once, at launch
 * @param {number} [options.port]       0 (the default) asks the OS for a free one
 * @param {string} [options.assetsDir]  the built page
 * @param {number} [options.ceiling]    the vault size above which the listing is refused
 * @param {number} [options.idleTimeoutMs]
 * @param {() => void} [options.onIdle]
 * @param {string} [options.snapshotsDir] where the snapshot store goes. Absent means the platform's
 *        state directory for this app — never inside the vault, under any value.
 *
 * The readings may be handed in or taken here, but the DECISION they lead to is not made here
 * either way. The preflight can find conditions that stop a launch — a shut licence gate, a build
 * with no embedding model — and this function reports them on the handle and on `/api/preflight`
 * and starts anyway. Refusing to start is the launcher's call, because the launcher owns the screen
 * that says why; a server that exited on a blocker would give the user a closed socket where a
 * sentence naming one command belongs.
 */
export async function startSidecar({
	readings: given,
	enginePath: namedEngine,
	root,
	port = 0,
	host = '127.0.0.1',
	assetsDir = DEFAULT_ASSETS_DIR,
	ceiling,
	idleTimeoutMs = DEFAULT_IDLE_MS,
	onIdle,
	appVersion = null,
	snapshotsDir,
} = {}) {
	if (!LOOPBACK.has(host)) {
		throw new TypeError(
			`startSidecar binds loopback only, and was asked for "${host}". The vault is the user's ` +
				`memory and there is no authentication layer to put in front of it.`,
		);
	}

	const readings = given ?? (await preflight({ explicit: namedEngine, root }));
	if (!readings?.engine?.path) {
		throw new TypeError('startSidecar needs either the preflight readings or an engine path.');
	}

	// Reported, never acted on. See the note above the signature.
	const blockers = launchBlockers(readings);

	/**
	 * Which engine this is, relative to the one this build was tested against.
	 *
	 * Computed ONCE, here, from the readings — it is a pure function of them, so it cannot disagree
	 * with what the footer displays or with what the write gate below enforces. Three consumers, one
	 * value: a screen that showed a tier the gate did not use would be the worst of the three
	 * failures this ladder exists to prevent.
	 */
	const compatibility = assessCompatibility(readings);

	const enginePath = readings.engine.path;
	const where = { enginePath, root };
	const startedAt = new Date().toISOString();

	// Minted here, per launch, and never written to a file. There is no file to leak and no way to
	// talk to yesterday's sidecar with yesterday's token.
	const token = mintToken();

	const assets = createAssetServer({ dir: assetsDir });

	const cache = createListingCache({
		load: () => listMemories({ enginePath, root, timeoutMs: LISTING_TIMEOUT_MS }),
		health: () => readHealth(where),
		ceiling,
	});

	/**
	 * The write path. THREE routes, and each one is here rather than behind a generic passthrough
	 * for the reason at the top of this file: adding an operation means adding a route, in a diff a
	 * reviewer can see.
	 *
	 * It is handed the cache so a committed write drops the snapshot the list is rendered from. A
	 * write that did not invalidate would leave every screen showing the row as it was before the
	 * edit, which is the same failure as a stale read and harder to notice because the user just
	 * changed it themselves.
	 */
	/**
	 * The snapshot spine, opened before the write handlers, because they refuse to be built
	 * without it.
	 *
	 * It lives OUTSIDE the vault, keyed by the vault identity this launch resolved, so two vaults
	 * never share a store and nothing this app keeps ever appears in the user's own memory list.
	 * The export door is injected rather than imported inside the store, which keeps the one-spawner
	 * rule intact — every child process this product starts still goes through `call.mjs` — and
	 * lets a test drive the failure path without breaking an engine.
	 */
	const snapshots = createSnapshotStore({
		vault: readings.vault ?? {},
		exportMemory: (memoryId) => exportMemory(memoryId, where),
		directory: snapshotsDir,
		engineVersion: readings.engine?.version ?? null,
	});

	/**
	 * The curation backlog's "these two really are different things", beside the snapshots.
	 *
	 * Same state directory, same vault key, same reason: it is this app's own opinion about the
	 * user's vault and it must not be written INTO the vault, where it would be exported, retrieved
	 * by their agents and counted in every number this product reports about their memory.
	 *
	 * It is opened here rather than lazily on first use so that a store this launch cannot key —
	 * no resolved vault identity — fails at startup, where the launcher can say so, rather than on
	 * the first click of a button that then appears to do nothing.
	 */
	const dismissals = createDismissalStore({
		vault: readings.vault ?? {},
		directory: snapshotsDir,
	});

	const writes = createWriteHandlers({
		where,
		cache,
		vocabulary: readings.vocabulary,
		requestBytes: readings.contract?.limits?.cli_request_bytes ?? null,
		snapshots,
	});

	/**
	 * The ranked door, behind one route and one explicit press. See the note at the top of
	 * `ask.mjs` for the rule it replaced and the three things that enforce the narrower one.
	 */
	const ask = createAskHandler({ where, bodyLimit: writes.bodyLimit });

	/**
	 * The removal path, built beside the write path and sharing its spine.
	 *
	 * It is a separate module rather than a fourth handler on `write.mjs` because the two answer
	 * different questions. A write asks what was stored; a removal asks whether the memory is
	 * actually gone from the doors that serve it, which costs a second non-writing read per item
	 * and is the whole point of the flow. It is handed the same cache, the same snapshot store and
	 * the same vocabulary, so neither path can drift from the other on the things they share.
	 */
	const removals = createRemovalHandlers({
		where,
		cache,
		vocabulary: readings.vocabulary,
		snapshots,
		requestBytes: readings.contract?.limits?.cli_request_bytes ?? null,
	});

	/**
	 * The half-finished-merge record, beside the snapshots and the dismissals.
	 *
	 * A merge is two writes with no transaction underneath, so the window between them is a state
	 * the vault can be left in — and it has to survive a crash rather than only an exception, or
	 * the recovery is a screen that exists only while the process that needed it is still running.
	 */
	const pendingMerges = createPendingMergeStore({
		vault: readings.vault ?? {},
		directory: snapshotsDir,
	});

	/**
	 * Curation: unify a spelling across N memories, and merge two memories into one.
	 *
	 * NEITHER IS AN ENGINE OPERATION. The published surface has no merge, no rename and no split —
	 * the operation whose modes read like curation reports that it applied and leaves both memories
	 * exactly as they were — so both runs here are composed out of `remember` update and `remember`
	 * delete, and this app owns the ordering and the recovery. No route in the table below reaches
	 * that operation in any mode, and a test asserts it.
	 */
	const curation = createCurationHandlers({
		where,
		cache,
		vocabulary: readings.vocabulary,
		snapshots,
		pending: pendingMerges,
		requestBytes: readings.contract?.limits?.cli_request_bytes ?? null,
	});

	// Concurrent health reads share one child process. This is single-flighting, not caching: the
	// answer is never reused after the call it came from has finished, so a poll always sees the
	// vault as it is now.
	let healthInFlight = null;
	const health = () => {
		healthInFlight ??= readHealth(where).finally(() => {
			healthInFlight = null;
		});
		return healthInFlight;
	};

	// ------------------------------------------------------------------ the routes

	/**
	 * Every reading this app took from the machine, served from memory.
	 *
	 * Spawns nothing: these were taken once, at launch, and they are displayed permanently in the
	 * app's footer. A number in this product carries the evidence that the thing it measures was
	 * switched on — which engine binary answered, from where, whether the licence gate permits the
	 * only door this product has, and whether the build carries its embedding model.
	 */
	function handlePreflight(req, res, url) {
		sendJson(res, 200, {
			engine: {
				path: readings.engine.path,
				found: readings.engine.found,
				version: readings.engine.version,
				resolved_by: readings.engine.source,
			},
			gate: readings.gate,
			model: readings.model,
			vault: readings.vault,
			contract: readings.contract,
			// Which engine this is, relative to the one this build was tested against, and what
			// that costs. Published rather than derived in the browser: the tier decides whether
			// the write routes below answer at all, and a browser that computed its own could
			// disagree with the server about what it is allowed to do.
			compatibility,
			// The open registries, as the engine printed them a moment ago. Every option list in
			// this product is built from this. Nothing is transcribed into a control, a filter or a
			// palette, because a value written down here drifts from the engine without anyone
			// noticing and the records written through it still look like data.
			vocabulary: readings.vocabulary,
			// What would stop a launch on this machine. Empty on a healthy one. Reported here as
			// well as to the launcher, because an alpha key can lapse while the app is open and the
			// screen that says so is the same screen either way.
			launch_blockers: blockers,
			cache: cache.status(),
			// Where this app keeps its copies, and the rule that bounds them. Published rather than
			// buried: a retention rule nobody can read is a rule a user discovers by loss, and a
			// directory nobody can find is a safety net nobody can check.
			snapshots: {
				directory: snapshots.directory,
				vault_key: snapshots.vault_key,
				retention: snapshots.retention,
				// The finding, on the readings themselves. See docs/RESTORE-EXPERIMENT.md.
				restore_available: false,
			},
			app: {
				version: appVersion,
				started_at: startedAt,
				assets_directory: assets.directory,
				// The full route set, from the table itself, so the app can see what exists and a
				// test can assert nothing was added quietly. Published as method-and-path rather
				// than as one string, because a caller that has to split a string to find the path
				// is a caller that will match the wrong thing.
				routes: ROUTES.map(({ method, path, alias_of = null, writes = false }) => ({
					method,
					path,
					alias_of,
					// Whether this route can change the VAULT. It is what the compatibility gate
					// reads, and it is published so a test can enumerate the set rather than
					// trusting that whoever added the last route remembered to mark it.
					writes,
				})),
				sort_keys: SORT_KEYS,
				// The cap on one removal run, published rather than transcribed into a control.
				// A limit the browser writes down is a limit that drifts from the server that
				// enforces it, and the user meets the difference at item 101.
				removal: { max_items: removals.max_items },
				scope_unset_value: SCOPE_UNSET,
			},
			checked_at: readings.checked_at,
		});
	}

	/** The vault's own health and fold state. Writes nothing; the browser is what polls it. */
	async function handleHealth(req, res) {
		const result = await health();
		sendJson(res, 200, envelope(result, { cache: cache.status() }));
	}

	/**
	 * The listing.
	 *
	 * Backed by the EXPORT door and never by ranked search. The ranked door records that it ran —
	 * permanently, storing the query text, with nothing published that reads those records back or
	 * removes one — so a UI that listed by searching would write into the store it is displaying,
	 * on every load and every refresh, forever. That is the single most plausible way to turn a
	 * read-only browser into the largest writer the vault has. This milestone contains zero callers
	 * of that door: not disabled, not behind a flag. Absent.
	 *
	 * Filtering, sorting and paging are answered from the index and spawn nothing.
	 */
	async function handleMemories(req, res, url) {
		const refresh = url.searchParams.get('refresh') === '1';

		let snapshot;
		try {
			snapshot = await cache.read({ refresh });
		} catch (error) {
			// The oversized-vault refusal is not an engine fault and must not be rendered as one:
			// the app knows the count, knows it did not try, and can say both.
			if (error?.kind === 'vault-too-large') {
				return sendJson(res, 200, {
					outcome: 'refused',
					error: {
						kind: 'vault-too-large',
						message: error.message,
						memory_count: error.memory_count,
						ceiling: error.ceiling,
					},
				});
			}
			throw error;
		}

		const { index, listing } = snapshot;
		const scope = {};
		for (const axis of index.axes) {
			const values = url.searchParams.getAll(`scope.${axis}`);
			if (values.length > 0) scope[axis] = values;
		}

		const { ids, sort } = selectMemories(index, {
			types: url.searchParams.getAll('type'),
			text: url.searchParams.get('q') ?? '',
			scope,
			sort: url.searchParams.get('sort') ?? undefined,
			order: url.searchParams.get('order') ?? undefined,
		});

		const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
		const rawLimit = url.searchParams.get('limit');
		const limit = rawLimit === null ? null : Math.max(0, Number.parseInt(rawLimit, 10) || 0);
		const page = limit === null ? ids.slice(offset) : ids.slice(offset, offset + limit);

		sendJson(res, 200, {
			fetched_at: snapshot.fetched_at,
			// What the vault holds, what the filters matched, and what this response carries. Three
			// numbers rather than one, because a screen that shows only the third tells the user
			// their vault is the size of a page.
			memory_count: listing.memory_count,
			matched: ids.length,
			offset,
			limit,
			sort,
			// Computed from what was ACTUALLY dropped, not from the list that asked for it, so a
			// field that stops being emitted stops being claimed.
			stripped_fields: listing.stripped_fields,
			// The engine's own statement about the parts of a vault this door does not carry.
			// Reported so nothing downstream presents the export as the whole of what is on disk.
			omissions: listing.omissions,
			export: {
				kind: listing.export_kind,
				schema_version: listing.schema_version,
				// Describes the payload AS THE ENGINE PRODUCED IT, before the strip above. It will
				// not match a digest over this response, and it is carried for exactly that reason:
				// it is the only way to check the payload against the engine rather than ourselves.
				payload_sha256: listing.payload_sha256,
			},
			facets: index.facets,
			scope_axes: index.axes,
			// Per-memory values this server computed, kept OUTSIDE the records. The engine's
			// response is passed through whole; anything derived travels beside it, so no screen
			// can mistake something this app worked out for something the vault holds.
			derived: Object.fromEntries(page.map((id) => [id, index.derived.get(id)])),
			memories: page.map((id) => index.byId.get(id)),
			cache: cache.status(),
			provenance: listing.provenance,
		});
	}

	/**
	 * One memory, for display, FROM THE CACHE.
	 *
	 * This does not call the engine, and that is the requirement rather than an optimisation. The
	 * row and the detail page must render the same record or they will disagree — quietly, and in a
	 * way no test catches, because each is correct about the payload it fetched.
	 *
	 * It also cannot use the exact-id read door, which is the door whose name makes it look
	 * correct. That door returns the body, the title and the facts, and it does NOT return the
	 * memory's named things, its evidence, its admission block or the qualifiers on each fact —
	 * all of which this page renders and the editor round-trips. A detail page built on it would
	 * disagree with the editor about what the memory declares.
	 */
	async function handleMemory(req, res, url, memoryId) {
		const snapshot = await cache.read();
		const record = snapshot.index.byId.get(memoryId);

		if (!record) {
			// Not a 404-shaped nothing: a memory can be absent because it was written since the
			// last export, or because it was removed, and the user can act on the first.
			return sendJson(res, 404, {
				outcome: 'refused',
				error: {
					kind: 'not-in-listing',
					// The id is IN the sentence, not only beside it: a user following a stale link has
					// the id and nothing else, and a message that does not repeat it cannot be
					// matched against what they clicked. The vault's path on disk is deliberately
					// not here — an error is not a place to disclose where the store lives.
					message:
						`No memory with id ${memoryId} is in the listing this app last loaded. It may ` +
						`have been written since, or removed from memory. Refresh the list to find out ` +
						`which.`,
					memory_id: memoryId,
					fetched_at: snapshot.fetched_at,
				},
			});
		}

		sendJson(res, 200, {
			fetched_at: snapshot.fetched_at,
			stripped_fields: snapshot.listing.stripped_fields,
			memory: record,
			derived: snapshot.index.derived.get(memoryId) ?? null,
			cache: cache.status(),
		});
	}

	/**
	 * What this memory declares it contradicts, and what contradicts it.
	 *
	 * Uncached and on demand: it is issued when the panel is expanded and not before, so a listing
	 * of three hundred rows does not cost three hundred calls. It writes nothing.
	 *
	 * The outbound half of this — what a memory declares — is already in the cached record and
	 * costs nothing. The INBOUND half has two sources and the panel wants both: inverting
	 * `contradicts` across the cache, which is free and exact because that field carries memory
	 * ids, and this call, which is the engine's own answer. `corrections` has no id-level inverse
	 * to compute — it names a handle and a sentence, not a memory — so none is invented.
	 */
	async function handleLineage(req, res, url, memoryId) {
		const result = await call('memory_lifecycle', { mode: 'lineage', memory_id: memoryId }, where);
		// Passed through WHOLE. This is the door an editor loads from, and the difference between
		// this record and the one the exact-id read returns is every named thing the memory
		// declares — a client that round-trips the wrong one commits successfully and deletes them.
		sendJson(res, 200, envelope(result));
	}

	/**
	 * A dismissal store failure, as a sentence rather than a stack.
	 *
	 * Split by CAUSE, not by convenience: a request this server will not accept is the caller's to
	 * fix and answers 400, and a store it cannot read or write is this machine's and answers 500.
	 * Collapsing them sends a user to check their disk over a typo, or the reverse.
	 */
	function sendDismissalError(res, error) {
		const bad = new Set(['missing-key', 'field-too-long', 'store-full']);
		return sendSidecarError(
			res,
			bad.has(error.kind) ? 400 : 500,
			error.kind ?? 'dismissal-store-failed',
			error.message,
			{ store: dismissals.file, limit: error.kind === 'store-full' ? MAX_DISMISSALS : null },
		);
	}

	/** What this vault's owner has already said is not a problem. Reads a file; spawns nothing. */
	async function handleDismissals(req, res) {
		try {
			const listing = await dismissals.list();
			sendJson(res, 200, { outcome: 'listed', ...listing, limit: MAX_DISMISSALS });
		} catch (error) {
			if (error instanceof DismissalStoreError) return sendDismissalError(res, error);
			throw error;
		}
	}

	/**
	 * Dismiss a finding, or put one back.
	 *
	 * A POST that writes NOTHING TO THE VAULT — it writes one file in this app's own state
	 * directory — and it is a POST rather than a GET for exactly that reason: it changes something,
	 * and this server's Origin check treats non-GET as state-changing. Both directions are on one
	 * route with an `action`, because they are one decision and its inverse over one file, and a
	 * user who can hide a finding must be able to unhide it through the same door.
	 */
	async function handleDismissalWrite(req, res) {
		let body;
		try {
			body = await readJsonBody(req, { limit: writes.bodyLimit });
		} catch (error) {
			return sendSidecarError(res, 400, error.kind ?? 'bad-request', error.message, {
				limit: error.limit ?? null,
			});
		}

		const action = typeof body?.action === 'string' ? body.action : 'dismiss';
		if (action !== 'dismiss' && action !== 'restore') {
			return sendSidecarError(
				res,
				400,
				'unknown-action',
				`This route takes "dismiss" or "restore" and was asked for "${action}". Nothing was ` +
					`changed.`,
			);
		}

		try {
			const result =
				action === 'restore' ? await dismissals.restore(body?.key) : await dismissals.dismiss(body);
			sendJson(res, 200, { ...result, store: dismissals.file, limit: MAX_DISMISSALS });
		} catch (error) {
			if (error instanceof DismissalStoreError) return sendDismissalError(res, error);
			throw error;
		}
	}

	/**
	 * THE ROUTE TABLE, AND IT IS THE ALLOWLIST.
	 *
	 * What is not here is the design. There is no generic passthrough, no route reaching address
	 * maintenance, the ontology write modes, the consolidation sweep or vault destruction — and no
	 * parameter naming a vault, a root, a profile or a path on any of them. A test enumerates this
	 * array and asserts the set, so a route added in a hurry shows up as a failing assertion rather
	 * than as a convenience.
	 *
	 * THERE IS EXACTLY ONE ROUTE TO RANKED SEARCH and it is the last entry below. It was previously
	 * absent altogether; the approved design adds it as one explicit press on one screen, and the
	 * rule that replaced "none, ever" is narrower rather than weaker — see the comment on the route
	 * and the note at the top of `ask.mjs`.
	 */
	const ROUTES = [
		{ method: 'GET', path: '/api/preflight', handler: handlePreflight },
		// ONE READING, TWO SPELLINGS, and this is the only alias in the table.
		//
		// PRD 0001 §3.7 named this endpoint `/api/session`; the app and this milestone's brief both
		// call it `/api/preflight`, which is the better name — what it returns is the preflight, and
		// this server has no notion of a session. Both are served because a name that is wrong in
		// one of three places is a 404 nobody expects, and one handler serves both so they cannot
		// answer differently. An alias is not a second operation: adding one of THOSE still means
		// adding a route, in a diff a reviewer can see.
		{ method: 'GET', path: '/api/session', alias_of: '/api/preflight', handler: handlePreflight },
		{ method: 'GET', path: '/api/health', handler: handleHealth },
		{ method: 'GET', path: '/api/memories', handler: handleMemories },
		{
			method: 'GET',
			path: '/api/memories/:memory_id',
			pattern: /^\/api\/memories\/([^/]+)$/,
			handler: handleMemory,
		},
		{
			method: 'GET',
			path: '/api/memories/:memory_id/lineage',
			pattern: /^\/api\/memories\/([^/]+)\/lineage$/,
			handler: handleLineage,
		},

		// ---- the editor's load door -------------------------------------------------------
		//
		// SEPARATE FROM `/api/memories/:memory_id` ON PURPOSE, and the difference is the whole
		// reason M1 exists. That route answers from the cache, for display. This one goes to the
		// engine, through the LINEAGE door, because the display door does not return a memory's
		// entity declarations and the write requires them: an editor that round-trips what the
		// display door returned commits successfully and deletes every named thing the memory
		// declared. Two routes, because they are two different records, and a screen that used the
		// wrong one would look right until the graph emptied.
		{
			method: 'GET',
			path: '/api/memories/:memory_id/edit',
			pattern: /^\/api\/memories\/([^/]+)\/edit$/,
			handler: writes.handleEditLoad,
		},

		// ---- the two writes ---------------------------------------------------------------
		{ method: 'POST', path: '/api/memories', handler: writes.handleCreate, writes: true },
		{
			method: 'POST',
			path: '/api/memories/:memory_id',
			pattern: /^\/api\/memories\/([^/]+)$/,
			handler: writes.handleUpdate,
			writes: true,
		},

		// ---- the removal run: ONE ROUTE FOR ONE MEMORY AND FOR MANY -------------------------
		//
		// There is no batch delete in the engine, so a run of twelve is twelve separate calls, each
		// carrying its own expected version. One route, because a single removal that took a
		// different path from a bulk one would be a second implementation of the version re-read,
		// the snapshot and the verification — and the two would drift.
		//
		// It is a POST at a collection rather than a DELETE at a memory, and that is deliberate: a
		// run is a thing with a report, not an idempotent statement about one resource, and half of
		// what it returns is what it did NOT do.
		{ method: 'POST', path: '/api/removals', handler: removals.handleRemovals, writes: true },

		// ---- the snapshot store: THREE READS AND NO WRITE ----------------------------------
		//
		// There is no restore route here and its absence is the finding, not an omission. A
		// snapshot cannot be imported back into the vault it came from — the import door refuses a
		// per-memory export outright, refuses a whole-workspace export over a vault that already
		// holds the record, and refuses any destination holding memories the package does not
		// carry. `docs/RESTORE-EXPERIMENT.md` has the run and the exact refusals, and
		// `test/restore.test.mjs` asserts them, so a build that starts permitting a restore turns
		// the suite red — which is what authorises the copy change, rather than the reverse.
		//
		// What these three do serve is the bytes, which is the honest and still useful half: a
		// person can see what a write was about to overwrite and save it to a file.
		{ method: 'GET', path: '/api/snapshots', handler: writes.handleSnapshots },
		{
			method: 'GET',
			path: '/api/snapshots/:snapshot_id',
			pattern: /^\/api\/snapshots\/([^/]+)$/,
			handler: writes.handleSnapshot,
		},
		{
			method: 'GET',
			path: '/api/memories/:memory_id/snapshots',
			pattern: /^\/api\/memories\/([^/]+)\/snapshots$/,
			handler: writes.handleSnapshots,
		},

		// ---- the curation backlog's dismissals: THIS APP'S STATE, NOT THE VAULT'S --------------
		//
		// The only POST in this table that reaches no engine at all. It writes one JSON file beside
		// the snapshot store, keyed by the same vault digest, and the screen that calls it says in
		// words that it only changes what this app shows you. There is no vault-side dismissal to
		// route it to — no published operation records "a person decided these two names are
		// different" — and inventing one here would be a mechanism reporting a state nothing holds.
		{ method: 'GET', path: '/api/dismissals', handler: handleDismissals },
		{ method: 'POST', path: '/api/dismissals', handler: handleDismissalWrite },

		// ---- curation: the merge the engine does not have --------------------------------------
		//
		// Four routes and not one of them reaches the operation that is NAMED as though it merged.
		// That operation reports `applied` with mass conserved and leaves both memories present,
		// readable and served — so a button wired to it ships green and changes nothing the user
		// can see. Both runs below are composed from `remember` update and `remember` delete, which
		// are the only writes whose effects this app has observed.
		//
		// A rename is a POST at a collection for the same reason a removal run is: it is a thing
		// with a report, it stops at the first refusal, and half of what it returns is what it did
		// NOT do.
		{ method: 'POST', path: '/api/renames', handler: curation.handleRenames, writes: true },
		{ method: 'POST', path: '/api/merges', handler: curation.handleMerge, writes: true },
		// The half-finished merge — the state between the two writes. Read at launch to raise the
		// banner, and posted to with `finish` or `undo`, which are the only two things a person can
		// do about it. There is no third action, because there is no engine operation to route one
		// to: `undo` is a third WRITE of a payload this app kept, not a rollback.
		{ method: 'GET', path: '/api/pending-merge', handler: curation.handlePending },
		{ method: 'POST', path: '/api/pending-merge', handler: curation.handlePendingAction, writes: true },

		// ---- the ranked door: ONE ROUTE, POST ONLY, AND NOTHING CALLS IT ON ITS OWN ------------
		//
		// "Ask the way your agent does." The one place in this product that reaches ranked search,
		// and the reason it is a POST rather than a GET is the whole design: a GET is what a page
		// load, a prefetch, a poll, a link and an address-bar paste can all perform, and every one
		// of those would write a permanent exposure row into the vault it is inspecting. A POST
		// needs a matching Origin, a JSON content type and a body, so nothing performs one by
		// arriving somewhere.
		//
		// `writes: true` because it does: the engine records an exposure row on every ranked query
		// and refuses `ledger: false` rather than silently upgrading it. That is also why it sits
		// behind the same compatibility gate as the other writes.
		//
		// The narrower rule this replaces — no ranked search anywhere on the HTTP surface — is
		// still enforced for every OTHER route by the sweep in `test/server.test.mjs`, which walks
		// the whole surface, asserts the count did not move, then presses this one and asserts it
		// moved by exactly one.
		{ method: 'POST', path: '/api/ask', handler: ask, writes: true },
	];

	// ------------------------------------------------------------------ the pipeline

	let hosts = new Set();
	let idleTimer = null;

	const touch = () => {
		if (!idleTimeoutMs) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			// The socket is closed rather than the process killed: whether an idle app should exit
			// is the launcher's decision, and it may have other work in hand.
			server.close();
			onIdle?.();
		}, idleTimeoutMs);
		idleTimer.unref?.();
	};

	function dispatch(req, res) {
		// The request TARGET, before anything else touches it.
		//
		// STOPS two path checks that look right and are not. A proxy-form target
		// (`GET http://elsewhere/x`) is legal HTTP and `new URL(target, base)` resolves it to
		// `elsewhere` — so a later `pathname.startsWith('/api')` test would be reasoning about a
		// URL that never pointed here. A protocol-relative target (`//elsewhere/x`) does the same
		// thing while still starting with a slash, which is exactly the check most code writes.
		const target = req.url ?? '';
		if (!target.startsWith('/') || target.startsWith('//')) return sendBare(res, 400);

		// 1. HOST — first, before routing and before authentication. The rebinding defence.
		if (!hostAllowed(req, hosts)) return sendBare(res, 403);

		touch();

		// 2. ORIGIN and fetch metadata — second. The cross-origin defence.
		if (!originAllowed(req, hosts)) return sendBare(res, 403);

		// 3. No CORS preflight is ever answered, because no cross-origin request is ever wanted.
		//    Answering OPTIONS at all is the first half of granting one.
		const method = (req.method ?? 'GET').toUpperCase();
		if (method === 'OPTIONS') return sendBare(res, 405);
		if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') return sendBare(res, 405);

		// 4. A body is read on exactly one method. GET and HEAD carrying one are either a client
		//    this app did not write or an attempt to smuggle a payload past a route that does not
		//    read it, and both are refused rather than ignored — a request whose body is silently
		//    dropped looks, to whoever adds the next route, like a request whose body was read.
		if (method !== 'POST') {
			if (Number.parseInt(req.headers['content-length'] ?? '0', 10) > 0) return sendBare(res, 400);
			req.resume();
		}

		const url = new URL(target, 'http://sidecar.invalid');

		if (!url.pathname.startsWith('/api/')) {
			// The static route serves files and reads no body. A POST at it is refused here rather
			// than answered with the page, so the only methods that reach the asset server are the
			// two it can answer.
			if (method === 'POST') return sendBare(res, 405);
			// The prebuilt page and its assets. Deliberately NOT token-gated: the browser cannot
			// send an Authorization header on the navigation that loads the page, which is the whole
			// reason the token travels in the URL fragment instead. These files are this
			// repository's own published build output — they carry no vault content, and a local
			// process that fetches them learns what `npm pack` would have told it.
			return guard(res, () => assets.serve(req, res, url.pathname));
		}

		// 5. The token, from the Authorization header and from nowhere else.
		//
		//    Checked before the route is looked up, so an unauthenticated request cannot learn
		//    which routes exist by comparing a 404 against a 401.
		if (url.searchParams.has('token') || url.searchParams.has('access_token')) {
			// Refused rather than accepted-and-ignored, and refused as UNAUTHENTICATED rather than
			// as malformed, because that is the true statement: the query string is not a way to
			// authenticate to this server. A token there leaks through three channels at once —
			// browser history, the `Referer` of any outbound link, and every screenshot pasted into
			// a bug report — and a server that tolerates one teaches the next client to send it
			// that way.
			return sendBare(res, 401);
		}
		if (!tokenMatches(bearerToken(req) ?? '', token)) return sendBare(res, 401);

		// 6. No endpoint may name a vault. This is the difference between a memory browser and an
		//    arbitrary local-file reader, and it is refused loudly rather than ignored quietly: an
		//    endpoint that silently drops `?root=` looks, to whoever adds the next one, like an
		//    endpoint that took it.
		for (const reserved of RESERVED_PARAMETERS) {
			if (url.searchParams.has(reserved)) {
				return sendSidecarError(
					res,
					400,
					'reserved-parameter',
					`No endpoint in this app accepts a "${reserved}" parameter. The vault is resolved ` +
						`once, at launch, and is not a parameter of anything.`,
				);
			}
		}

		// THE PATH IS MATCHED FIRST, THE METHOD SECOND, and they are two passes rather than one.
		//
		// One pass reads better and is wrong from the moment a path carries two methods, which it
		// does the instant a read route grows a write beside it: the first route with the right path
		// and the wrong method answers 405 and the correct handler is never reached. The failure is
		// a working GET beside a POST that is refused on every request, and it looks like a broken
		// write path rather than a broken router.
		const onPath = [];
		for (const route of ROUTES) {
			const match = route.pattern ? route.pattern.exec(url.pathname) : null;
			if (!match && route.path !== url.pathname) continue;
			onPath.push({ route, match });
		}

		if (onPath.length > 0) {
			const chosen =
				onPath.find(({ route }) => route.method === method) ??
				(method === 'HEAD' ? onPath.find(({ route }) => route.method === 'GET') : undefined);

			// The path exists and the method does not. That is a 405 and not a 404, which is the
			// true statement and the one a client can act on.
			if (!chosen) return sendBare(res, 405);

			// THE COMPATIBILITY GATE, and it is here rather than inside each handler.
			//
			// Tier A means something structural is wrong with this engine relative to this build —
			// an unrecognised contract envelope, or an operation this app is built on that the
			// engine does not have. Reads still work and every reading is still on the screen; what
			// is refused is anything that would change the vault, because a write composed against
			// a contract this app cannot read is a write whose losses nobody can predict.
			//
			// `/api/dismissals` is a POST and is deliberately NOT gated: it writes one file in this
			// app's own state directory and reaches no engine at all. The flag is on the route, so
			// which side of that line a route is on is a decision visible in the table above rather
			// than a condition buried in a handler.
			if (chosen.route.writes && !compatibility.writes_permitted) {
				return sendSidecarError(
					res,
					409,
					'engine-not-compatible',
					`${compatibility.headline}\n\n` +
						compatibility.reasons.map((reason) => reason.message).join('\n\n') +
						`\n\nYour vault is untouched. Reading it still works, and every reading this app ` +
						`took is on the screen.`,
					{
						tier: compatibility.tier,
						digest: compatibility.digest,
						tested_digests: compatibility.tested_digests,
						missing_operations: compatibility.missing_operations,
						retired_operations: compatibility.retired_operations,
					},
				);
			}

			let captured;
			if (chosen.match) {
				try {
					captured = decodeURIComponent(chosen.match[1]);
				} catch {
					return sendBare(res, 400);
				}
			}
			return guard(res, () => chosen.route.handler(req, res, url, captured));
		}

		sendSidecarError(res, 404, 'no-such-route', `No route for ${method} ${url.pathname}.`);
	}

	const server = createServer(dispatch);
	// A slow-header client should not hold a socket open indefinitely against a server whose whole
	// clientele is one page on this machine.
	server.headersTimeout = 20_000;
	server.requestTimeout = 60_000;
	server.keepAliveTimeout = 15_000;

	/**
	 * Bind loopback, and take a free port rather than failing on a busy one.
	 *
	 * `127.0.0.1` EXPLICITLY, never `0.0.0.0` and never `::`. STOPS: everyone else on the network.
	 * There is no authentication layer to put in front of the user's memory and there is no
	 * `--host` flag, because the only value it could take is one that makes the vault reachable
	 * from another machine.
	 *
	 * The port is the OS's choice by default. A pinned port that is busy falls back to an ephemeral
	 * one rather than refusing to start — the user asked to look at their memory, not to own a
	 * particular port — and the port ACTUALLY bound is what is reported, so nothing downstream
	 * assumes the number it asked for. The Host allowlist is computed from the same reading, which
	 * is the reason it cannot be written down.
	 */
	const bound = await new Promise((settle, fail) => {
		const attempt = (wanted, allowFallback) => {
			const onError = (error) => {
				server.removeListener('listening', onListening);
				if (error.code === 'EADDRINUSE' && allowFallback) return attempt(0, false);
				fail(error);
			};
			const onListening = () => {
				server.removeListener('error', onError);
				settle(server.address());
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen({ host, port: wanted, exclusive: true });
		};
		attempt(port, port !== 0);
	});

	hosts = allowedHosts({ address: bound.address, port: bound.port });
	touch();

	const origin = `http://${bound.address.includes(':') ? `[${bound.address}]` : bound.address}:${bound.port}`;

	return {
		port: bound.port,
		address: bound.address,
		origin,
		token,
		/**
		 * The URL a person opens, with the token in the FRAGMENT.
		 *
		 * A fragment is never sent to a server: it does not appear in this server's logs, it is not
		 * in the `Referer` of any link the page later follows, and it does not reach a proxy. The
		 * page reads it once, holds it in memory, and rewrites the URL to remove it — after which
		 * the token exists in exactly one place, which is the tab the user is looking at.
		 */
		launchUrl: `${origin}/#token=${token}`,
		routes: ROUTES.map(({ method, path, alias_of = null, writes = false }) => ({
			method,
			path,
			alias_of,
			writes,
		})),
		readings,
		launch_blockers: blockers,
		compatibility,
		cache,
		assets,
		// The store itself, on the handle, so a launcher can print where it is and a test can
		// assert against the same object the write path uses rather than a second one it built.
		snapshots,
		// The same reasoning for the half-finished-merge record: a test that built its own store
		// would be asserting against a second file, and the interesting question is what is in the
		// one the merge route actually wrote.
		pending_merges: pendingMerges,
		server,
		async close() {
			clearTimeout(idleTimer);
			await new Promise((settle) => server.close(settle));
		},
	};
}
