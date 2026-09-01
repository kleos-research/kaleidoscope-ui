// Milestone 3: the write path, driven through the door a browser actually goes through.
//
// M1 proved the seam in the ENGINE CLIENT: a memory loaded through the door that carries its entity
// declarations survives a load, an edit and a write back. That result does not transfer to this
// milestone by itself. The browser does not call the engine client — it calls an HTTP endpoint, and
// between the two there is a load route, a write route, a request body, a JSON round trip and a
// cache. Every one of those is a place the declarations can be dropped, and the drop is silent:
// the write commits, the exit code is 0, the response says committed, and the next read of the
// memory looks entirely normal because the screen that renders it reads from the same lossy shape.
//
// So this file asserts the property again, one layer up, against the bytes a browser sends.
//
// Six things it checks, and each one is here because getting it wrong is invisible:
//
//   * a body-only edit through the HTTP path preserves the declared NAME SET — sets, not counts,
//     because a projection that rebuilds the declarations from the wrong door preserves the count
//     exactly while replacing every name inside it. And the test proves it can go red: the same
//     memory is then written back the lossy way and the names are asserted GONE. A test for this
//     that has never been red is not evidence (PRD 0003 R1);
//   * a structural edit changes what it names and nothing else — one fact edited leaves the others
//     alone, one declaration added disturbs no other;
//   * a stale version is reported AS a conflict, carrying the version that is now current, so the
//     screen can offer a reload instead of discarding what the user typed. The probe PERTURBS the
//     payload, because an identical resend is replayed rather than refused — a conflict test built
//     by re-sending the same bytes exercises the replay path and asserts nothing about the guard.
//     The replay is asserted here too, as the control that shows the probe could tell them apart;
//   * a partial success reaches the caller AS a partial success. One fact naming an undeclared
//     thing is refused on its own while the rest of the memory commits. "Save failed" is a lie
//     about a write that landed, and "Saved" is a lie about the third of it that did not;
//   * the write routes refuse a missing token and a hostile Host — asserted, not inherited from the
//     read routes, and asserted together with the vault fingerprint, because a refusal that has
//     already spawned the engine is not a refusal;
//   * the whole flow records no ranked search. There are zero callers of the ranked door in this
//     repository. The exposure count across a complete create-load-edit-conflict-save session is
//     the measurement that keeps that enforceable rather than aspirational.
//
// Everything runs against a clone. This file writes, so it goes nowhere near a vault a person uses;
// the clone-first helpers make that mechanical rather than a promise, and they ask the engine —
// through its own door — which vault it resolved before the first write is attempted.

import assert from 'node:assert/strict';
import { request as httpRequestRaw } from 'node:http';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { childFieldNames } from '../src/engine/preflight.mjs';
import { countExposureRecords, fingerprintVault, openScratchVault } from './helpers/vault.mjs';

// ---------------------------------------------------------------------------------------------
// THE CONTRACT THIS FILE ASSERTS
// ---------------------------------------------------------------------------------------------
//
// The editor is three endpoints, and this file names them here rather than scattering the
// expectation through the assertions:
//
//   GET  /api/memories/:memory_id/edit      the record an update is assembled from. It must carry
//   (or) /api/memories/:memory_id/lineage   the entity declarations, the body, and the version the
//                                           write is allowed to replace — all three, because a
//                                           record missing any one of them cannot be written back.
//   PUT  /api/memories/:memory_id           {expected_version_id, content_md, semantic_delta}
//   (or) POST /api/memories/:memory_id
//   POST /api/memories                      {content_md, semantic_delta}
//
// The alternatives exist so a reasonable spelling does not fail as an absence. Nothing else is
// guessed: if none of them answers, this file fails naming every one it tried. It does not skip.
// A milestone whose write path is missing must go red, not quiet.

const EDIT_ROUTES = (id) => [
	`/api/memories/${encodeURIComponent(id)}/edit`,
	`/api/memories/${encodeURIComponent(id)}/lineage`,
];

const UPDATE_ROUTES = (id) => [
	{ method: 'PUT', path: `/api/memories/${encodeURIComponent(id)}` },
	{ method: 'POST', path: `/api/memories/${encodeURIComponent(id)}` },
];

const CREATE_ROUTES = [{ method: 'POST', path: '/api/memories' }];

/** A route that is not there answers one of these. Anything else means it exists. */
const ROUTE_ABSENT = new Set([404, 405]);

/** How many memories to open before giving up on finding one that declares something. */
const CANDIDATE_LIMIT = 40;

/** A write folds a graph; it is not a read. */
const WRITE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------------------------
// Finding the sidecar
// ---------------------------------------------------------------------------------------------
//
// Resolved rather than assumed, and TERMINAL: a test that silently skipped because it could not
// find the thing it guards reports green for a milestone with no write path in it at all.

const SERVER_MODULES = [
	'../src/server/sidecar.mjs',
	'../src/server/server.mjs',
	'../src/server/index.mjs',
	'../src/sidecar/sidecar.mjs',
	'../src/sidecar/server.mjs',
	'../src/sidecar.mjs',
	'../src/server.mjs',
];

const START_EXPORTS = ['startSidecar', 'startServer', 'createSidecar', 'createServer', 'start'];

let cachedStarter = null;

async function resolveStarter() {
	if (cachedStarter) return cachedStarter;

	const looked = [];
	for (const specifier of SERVER_MODULES) {
		let module;
		try {
			module = await import(specifier);
		} catch (error) {
			if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
			looked.push(`  - ${specifier} (no such module)`);
			continue;
		}
		const name = START_EXPORTS.find((candidate) => typeof module[candidate] === 'function');
		if (name) {
			cachedStarter = { start: module[name], specifier, exportName: name };
			return cachedStarter;
		}
		looked.push(`  - ${specifier} (found, exports none of: ${START_EXPORTS.join(', ')})`);
	}

	throw new Error(
		`No sidecar to test. Looked for a module exporting one of ${START_EXPORTS.join(', ')} in:\n` +
			`${looked.join('\n')}\n\nThis is not a skip.`,
	);
}

// ---------------------------------------------------------------------------------------------
// A raw HTTP client
// ---------------------------------------------------------------------------------------------
//
// node:http rather than fetch, for one reason that matters in this file: fetch owns the `Host`
// header, so the rebinding probe against a write route cannot be sent at all. A security assertion
// that cannot put its own bytes on the wire is measuring the client's helpfulness.

function httpRequest({
	port,
	method = 'GET',
	path = '/',
	headers = {},
	body = null,
	timeoutMs = 60_000,
}) {
	return new Promise((resolve, reject) => {
		const payload = body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
		const request = httpRequestRaw({
			host: '127.0.0.1',
			port,
			method,
			path,
			headers: {
				host: `127.0.0.1:${port}`,
				// EXACTLY what a browser puts on the wire, and the reason it is here rather than in
				// the write helpers: a browser omits `Origin` on a same-origin GET and SENDS it on
				// every request whose method is not GET or HEAD, same-origin or not. A test client
				// that omits it on a POST is not a stricter client, it is a different one — the
				// server refuses the anonymous state-changing request on purpose, and a suite that
				// tripped that check on every write would be measuring its own omission and would
				// go green again the day someone "fixed" it by dropping the control.
				//
				// It is set before `headers` is spread, so the security probes below override it
				// with a hostile value rather than sending two.
				...(method === 'GET' || method === 'HEAD' ? {} : { origin: `http://127.0.0.1:${port}` }),
				...(payload === null
					? {}
					: {
							'content-type': 'application/json',
							'content-length': Buffer.byteLength(payload),
						}),
				...headers,
			},
		});

		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`no response within ${timeoutMs} ms to ${method} ${path}`));
		});
		request.on('error', reject);
		request.on('response', (response) => {
			const seen = {
				status: response.statusCode,
				headers: response.headers,
				rawHeaders: response.rawHeaders,
				body: '',
			};
			response.setEncoding('utf8');
			response.on('data', (chunk) => {
				seen.body += chunk;
			});
			response.on('end', () => resolve(seen));
			response.on('error', reject);
		});

		if (payload !== null) request.write(payload);
		request.end();
	});
}

/** The same request, authorised the way the app authorises one. */
const authorised = (sidecar, options) =>
	httpRequest({
		port: sidecar.port,
		...options,
		headers: { authorization: `Bearer ${sidecar.token}`, ...(options.headers ?? {}) },
	});

const json = (response, where = 'the response') => {
	try {
		return JSON.parse(response.body);
	} catch (error) {
		assert.fail(
			`${where} was expected to be JSON and is ${response.body.length} bytes that do not ` +
				`parse (${error.message}). Status was ${response.status}. The first 300 bytes are:\n` +
				`${response.body.slice(0, 300)}`,
		);
	}
};

async function startSidecarUnderTest({ enginePath, root }) {
	const { start, specifier, exportName } = await resolveStarter();
	const handle = await start({ enginePath, root, host: '127.0.0.1', port: 0, open: false });

	const address =
		typeof handle?.server?.address === 'function' ? handle.server.address() : (handle?.address ?? null);
	const port = handle?.port ?? address?.port ?? null;
	assert.ok(
		Number.isInteger(port) && port > 0,
		`${specifier} → ${exportName}() reported no listening port, so nothing can be requested of it.`,
	);

	const token = handle.token ?? handle.bearer ?? handle.secret ?? null;
	assert.ok(
		typeof token === 'string' && token.length > 0,
		`The sidecar minted no bearer token, so every write below would be authorised by accident.`,
	);

	const close = async () => {
		for (const name of ['close', 'stop', 'shutdown', 'dispose']) {
			if (typeof handle[name] === 'function') return await handle[name]();
		}
		if (typeof handle.server?.close === 'function') {
			return await new Promise((settle) => handle.server.close(settle));
		}
		throw new Error('The sidecar handle carries no way to shut it down.');
	};

	return { handle, port, token, routes: handle.routes ?? null, close };
}

async function openSidecarAndVault(t, label) {
	const engine = await locateEngine({});
	const scratch = openScratchVault({ enginePath: engine.path, label });
	t.after(() => scratch.close());

	const sidecar = await startSidecarUnderTest({ enginePath: engine.path, root: scratch.root });
	t.after(async () => {
		try {
			await sidecar.close();
		} catch {
			// A close that fails must not mask the assertion that failed before it.
		}
	});

	t.diagnostic(`engine ${engine.path} (found by ${engine.source})`);
	t.diagnostic(`clone ${scratch.root}`);
	t.diagnostic(`source vault, never written: ${scratch.source}`);

	return { engine, scratch, sidecar };
}

// ---------------------------------------------------------------------------------------------
// Reading a record without assuming its shape
// ---------------------------------------------------------------------------------------------

/**
 * The property names an entity's own name might arrive under, most specific first.
 *
 * A list of candidate KEYS, not of vocabulary values — no closed list is transcribed here. `n` leads
 * because it is the key the write contract publishes for an entity's surface. If none of them is
 * present this fails loudly naming the keys it did see: an entity whose name cannot be read is an
 * entity whose disappearance cannot be detected, which is the one thing this file exists to catch.
 */
const NAME_KEYS = ['n', 'name', 'surface', 'canonical_name', 'entity', 'label', 'id'];

function entityNames(delta) {
	const names = new Set();
	for (const entity of delta?.entities ?? []) {
		if (typeof entity === 'string') {
			names.add(entity);
			continue;
		}
		const key = NAME_KEYS.find((candidate) => typeof entity?.[candidate] === 'string');
		assert.ok(
			key !== undefined,
			`An entity declaration carries no readable name. Its keys are: ` +
				`${Object.keys(entity ?? {}).join(', ') || '(none)'}.`,
		);
		names.add(entity[key]);
	}
	return names;
}

/**
 * The facts as a set of STATEMENTS rather than as a number.
 *
 * The same argument that applies to names applies here: a count of five survives all five facts
 * being replaced by five different ones, and a projection rebuilt from the wrong shape does exactly
 * that while preserving the count.
 */
function factStatements(delta) {
	return new Set(
		(delta?.facts ?? []).map((fact) =>
			typeof fact === 'string'
				? fact
				: `${fact?.subject ?? '?'} | ${fact?.predicate ?? '?'} | ${fact?.object ?? '?'}`,
		),
	);
}

const sorted = (set) => [...set].sort();

/**
 * The semantic delta inside a payload, wherever the endpoint put it.
 *
 * Breadth-first, so the shallowest object carrying an array of facts wins. This exists so a
 * reasonable difference in envelope shape does not read as a missing feature — but it deliberately
 * keys on `facts` and NOT on `entities`, because a record whose entities are missing is the exact
 * failure under test and must reach the assertion rather than be rejected as unrecognised here.
 */
function findDelta(payload) {
	const queue = [{ node: payload, path: '$', depth: 0 }];
	while (queue.length > 0) {
		const { node, path, depth } = queue.shift();
		if (node === null || typeof node !== 'object' || Array.isArray(node)) continue;
		if (Array.isArray(node.facts)) return { delta: node, path };
		if (depth >= 4) continue;
		for (const [key, child] of Object.entries(node)) {
			queue.push({ node: child, path: `${path}.${key}`, depth: depth + 1 });
		}
	}
	return { delta: null, path: null };
}

/** The first non-empty string at `key`, anywhere in the payload. */
function findString(payload, key) {
	const queue = [{ node: payload, depth: 0 }];
	while (queue.length > 0) {
		const { node, depth } = queue.shift();
		if (node === null || typeof node !== 'object') continue;
		if (typeof node[key] === 'string' && node[key].length > 0) return node[key];
		if (depth >= 4) continue;
		for (const child of Object.values(node)) queue.push({ node: child, depth: depth + 1 });
	}
	return null;
}

// ---------------------------------------------------------------------------------------------
// The three doors, discovered once per sidecar
// ---------------------------------------------------------------------------------------------

/**
 * Load one memory the way the editor loads it.
 *
 * The record must carry three things or an editor built on it cannot write back: the declarations
 * (the write requires them and the display door does not return them), the body (there is no
 * body-only write — an update replaces body and structure together), and the version this write is
 * allowed to replace (without it a write either overwrites a concurrent change or cannot be told
 * apart from one that did). A route that carries two of the three is reported as a hole rather than
 * quietly patched here, because patching it in the test is how a browser gets shipped that cannot.
 */
async function loadForEdit(sidecar, memoryId) {
	const tried = [];
	for (const path of EDIT_ROUTES(memoryId)) {
		const response = await authorised(sidecar, { path });
		if (ROUTE_ABSENT.has(response.status)) {
			tried.push(`  - GET ${path} → ${response.status} (no such route)`);
			continue;
		}
		assert.equal(
			response.status,
			200,
			`GET ${path} answered ${response.status}. The editor's load path must answer, or there ` +
				`is no record to edit.\n${response.body.slice(0, 300)}`,
		);

		const payload = json(response, `GET ${path}`);
		const { delta, path: at } = findDelta(payload);
		// The version an update must carry, under either spelling. `expected_version_id` is read
		// FIRST and is the better name — it says what the value is FOR, and the record's own
		// `version_id`, if a route carries both, is a description of the past rather than the thing
		// the next write is guarded by. What matters to every assertion below is that one value
		// arrives; which of the two names it arrives under is not a property of the product.
		const versionId =
			findString(payload, 'expected_version_id') ?? findString(payload, 'version_id');
		const contentMd = findString(payload, 'content_md');

		if (delta === null || versionId === null || contentMd === null) {
			tried.push(
				`  - GET ${path} → 200, but it carries ` +
					`${delta === null ? 'no facts' : `a delta at ${at}`}, ` +
					`${versionId === null ? 'no version to write against' : 'a version'}, ` +
					`${contentMd === null ? 'no content_md' : 'a content_md'}`,
			);
			continue;
		}

		return {
			endpoint: path,
			memory_id: memoryId,
			version_id: versionId,
			content_md: contentMd,
			delta,
			delta_at: at,
			names: entityNames(delta),
			statements: factStatements(delta),
		};
	}

	assert.fail(
		`No endpoint returned a record an update could be assembled from. Tried:\n${tried.join('\n')}\n\n` +
			`The editor's load path must return the entity declarations, the body AND the version ` +
			`together. The door that DISPLAYS a memory does not return its declarations and the ` +
			`write requires them, so an editor that round-trips the display door's response ` +
			`commits successfully — exit 0, no refusal, nothing on screen — and deletes every named ` +
			`thing the memory declared. That is PRD 0003 R1 and it is why this fails rather than ` +
			`falling back to whatever answered.`,
	);
}

/**
 * Which spelling of the update route this server actually carries, decided ONCE and then used for
 * everything — including the requests that are supposed to be rejected.
 *
 * The probe body is empty, which cannot commit anything: the door requires a body beginning with a
 * heading and refuses without one. What it distinguishes is a route that is not there (the method
 * or the path is unrouted, and the answer is 404 or 405) from one that is (anything else, including
 * the refusal an empty payload earns). Deciding this once matters for the security assertions
 * below: a 401 collected from a route that does not exist is a 401 about nothing.
 */
async function resolveUpdateMethod(sidecar, memoryId) {
	if (sidecar.updateMethod) return sidecar.updateMethod;

	const tried = [];
	for (const route of UPDATE_ROUTES(memoryId)) {
		const response = await authorised(sidecar, {
			...route,
			body: {},
			timeoutMs: WRITE_TIMEOUT_MS,
		});
		if (ROUTE_ABSENT.has(response.status)) {
			tried.push(`  - ${route.method} ${route.path} → ${response.status} (no such route)`);
			continue;
		}
		sidecar.updateMethod = route.method;
		return route.method;
	}

	assert.fail(
		`No update route answered. Tried:\n${tried.join('\n')}\n\nThe editor has nothing to save ` +
			`through, so every assertion in this file about what a save preserves is unreachable.`,
	);
}

async function sendUpdate(sidecar, memoryId, body, { headers, token = true } = {}) {
	const method = await resolveUpdateMethod(sidecar, memoryId);
	const route = { method, path: `/api/memories/${encodeURIComponent(memoryId)}` };
	const options = { ...route, body, timeoutMs: WRITE_TIMEOUT_MS, headers };
	const response = token
		? await authorised(sidecar, options)
		: await httpRequest({ port: sidecar.port, ...options });
	return { ...response, route };
}

async function sendCreate(sidecar, body, { headers, token = true } = {}) {
	const route = CREATE_ROUTES[0];
	const options = { ...route, body, timeoutMs: WRITE_TIMEOUT_MS, headers };
	const response = token
		? await authorised(sidecar, options)
		: await httpRequest({ port: sidecar.port, ...options });
	if (token && ROUTE_ABSENT.has(response.status)) {
		assert.fail(
			`${route.method} ${route.path} answered ${response.status}, so there is no route that ` +
				`creates a memory and a person cannot write one by hand.`,
		);
	}
	return { ...response, route };
}

/**
 * What a write said about itself.
 *
 * `refused_facts` is read on EVERY write, and its absence is never a failure signal: the key is
 * omitted entirely when nothing was refused, so a caller that treats "present" as an error and
 * "absent" as success has the polarity right and a caller that checks only the exit code has told
 * the user their work landed when part of it did not.
 */
function readWrite(response, where) {
	const payload = json(response, where);
	const data = payload.data ?? payload;
	return {
		payload,
		data,
		outcome: payload.outcome ?? null,
		effect: data?.canonical_effect ?? null,
		memory_id: data?.memory_id ?? null,
		version_id: data?.version_id ?? null,
		refused_facts: data?.refused_facts ?? null,
		// The whole response as text, for assertions about what a message NAMES. A screen that has
		// to recover a value from a refusal can only do it if the value is in there somewhere.
		text: response.body,
	};
}

const assertCommitted = (write, where) => {
	assert.equal(
		write.outcome,
		'applied',
		`${where} did not apply. The envelope said outcome=${write.outcome}. Body:\n` +
			`${write.text.slice(0, 400)}`,
	);
	assert.ok(
		typeof write.version_id === 'string' && write.version_id.length > 0,
		`${where} applied and reported no version, so the next write cannot be guarded against a ` +
			`concurrent change.`,
	);
};

// ---------------------------------------------------------------------------------------------
// Building a payload without writing a vocabulary down
// ---------------------------------------------------------------------------------------------
//
// Memory types, entity kinds and relation names are OPEN registries that grow. A value transcribed
// into a test drifts from the engine in silence and the test keeps passing against a vocabulary
// that no longer means what it meant. Everything below is read from what the binary printed a
// moment ago — the write contract, through the sidecar's own readings endpoint — or lifted from a
// record the vault already holds, which is a value it has already accepted.

async function readVocabulary(sidecar) {
	const response = await authorised(sidecar, { path: '/api/preflight' });
	assert.equal(response.status, 200, 'the readings must be readable before a payload can be built');
	const vocabulary = json(response, 'GET /api/preflight').vocabulary;
	assert.ok(
		vocabulary?.fields && Object.keys(vocabulary.fields).length > 0,
		`The sidecar published no parsed write contract, so every value below would have to be ` +
			`written down here — which is the transcription that drifts.`,
	);
	return vocabulary;
}

/** A value from an OPEN registry the engine named, minus anything it says it refuses. */
function pickFromRegistry(vocabulary, path, index = 0) {
	const known = vocabulary.known?.[path] ?? vocabulary.closed?.[path] ?? [];
	const denied = new Set(vocabulary.denied?.[path] ?? []);
	const offered = known.filter((value) => !denied.has(value));
	assert.ok(
		offered.length > index,
		`The write contract named ${offered.length} usable value(s) at ${path} and this needs at ` +
			`least ${index + 1}. Known: ${known.join(', ') || '(none)'}. Refused: ` +
			`${[...denied].join(', ') || '(none)'}.`,
	);
	return offered[index % offered.length];
}

/** The keys under a contract path that are marked required. */
function requiredChildren(vocabulary, parent) {
	return childFieldNames(vocabulary.fields, parent).filter(
		(child) => vocabulary.fields[`${parent}.${child}`]?.required,
	);
}

/**
 * One entity declaration, built from the contract's own field list.
 *
 * Which key carries the name is discovered, not assumed; which keys carry vocabulary is discovered
 * from whether the contract published a value list for them. Nothing here names a kind.
 */
function makeEntity(vocabulary, surface, gloss) {
	const parent = 'semantic_delta.entities';
	const children = requiredChildren(vocabulary, parent);
	const nameKey = NAME_KEYS.find((candidate) => children.includes(candidate));
	assert.ok(
		nameKey !== undefined,
		`No required field under ${parent} looks like the entity's surface. Required: ` +
			`${children.join(', ') || '(none)'}.`,
	);

	const entity = {};
	for (const child of children) {
		if (child === nameKey) {
			entity[child] = surface;
			continue;
		}
		const path = `${parent}.${child}`;
		const hasVocabulary = (vocabulary.known?.[path] ?? vocabulary.closed?.[path] ?? []).length > 0;
		entity[child] = hasVocabulary ? pickFromRegistry(vocabulary, path) : gloss;
	}
	return entity;
}

/**
 * One fact. `subject`, `predicate` and `object` are FIELD NAMES rather than vocabulary values, so
 * naming them is structure and not the transcription the rule forbids — but they are checked
 * against the contract anyway, so a renamed field fails loudly instead of writing a fact the engine
 * silently ignores.
 */
function makeFact(vocabulary, subject, predicateIndex, object) {
	const children = childFieldNames(vocabulary.fields, 'semantic_delta.facts');
	for (const field of ['subject', 'predicate', 'object']) {
		assert.ok(
			children.includes(field),
			`The write contract's fact object has no '${field}'. It has: ${children.join(', ')}.`,
		);
	}
	return {
		subject,
		predicate: pickFromRegistry(vocabulary, 'semantic_delta.facts.predicate', predicateIndex),
		object,
	};
}

function makeDelta(vocabulary, { title, memoryType, entities, facts }) {
	const children = childFieldNames(vocabulary.fields, 'semantic_delta');
	for (const field of ['title', 'memory_type', 'entities', 'facts']) {
		assert.ok(
			children.includes(field),
			`The write contract's semantic delta has no '${field}'. It has: ${children.join(', ')}.`,
		);
	}
	return { title, memory_type: memoryType, entities, facts };
}

/** The body an editor composes. The leading heading is guaranteed here, never asked of a human. */
const composeBody = (title, prose) => `# ${title}\n\n${prose}\n`;

// ---------------------------------------------------------------------------------------------
// A one-character edit, and the proof that it is one character
// ---------------------------------------------------------------------------------------------

function differingCharacters(a, b) {
	if (a.length !== b.length) return Infinity;
	let differences = 0;
	for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) differences += 1;
	return differences;
}

/**
 * Case-flip one letter, after the first line where possible.
 *
 * Keeping the length identical makes "exactly one character changed" checkable by comparison rather
 * than by trust, and staying off the first line keeps the edit away from the heading, which the
 * product has separate rules about.
 */
function flipOneCharacter(body) {
	assert.equal(typeof body, 'string', 'the memory has no body to edit');
	const floor = body.indexOf('\n') + 1;
	const pick = (from) => {
		for (let index = body.length - 1; index >= from; index -= 1) {
			if (/[A-Za-z]/.test(body[index])) return index;
		}
		return -1;
	};
	const index = pick(floor) !== -1 ? pick(floor) : pick(0);
	assert.notEqual(index, -1, 'the memory body carries no letter to flip');

	const character = body[index];
	const flipped =
		character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase();
	const edited = body.slice(0, index) + flipped + body.slice(index + 1);
	assert.equal(differingCharacters(body, edited), 1, 'the edit changed more than one character');
	return { edited, index, from: character, to: flipped };
}

// ---------------------------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------------------------

async function listing(sidecar, query = '') {
	const response = await authorised(sidecar, {
		path: `/api/memories${query}`,
		timeoutMs: WRITE_TIMEOUT_MS,
	});
	assert.equal(response.status, 200, `GET /api/memories${query} answered ${response.status}`);
	const payload = json(response, `GET /api/memories${query}`);
	assert.ok(
		(payload.memories ?? []).length > 0,
		`The cloned vault holds no memories, so every assertion below would be vacuous. Point ` +
			`KALEIDOSCOPE_TEST_VAULT at a vault with memories in it.`,
	);
	return payload;
}

/** A memory type this vault has already accepted, taken from a record rather than written down. */
function anyMemoryType(payload) {
	for (const record of payload.memories ?? []) {
		const type = record?.semantic?.memory_type;
		if (typeof type === 'string' && type.length > 0) return type;
	}
	assert.fail('No listed memory carries a memory type, so a create cannot name one this vault takes.');
}

// ---------------------------------------------------------------------------------------------
// A fixture memory, created through the create door
// ---------------------------------------------------------------------------------------------
//
// Created rather than borrowed. The structural assertions below need to know exactly what a memory
// declares and asserts before they can say what an edit disturbed, and a memory an agent wrote is
// not a controlled input. Its surfaces are invented and prefixed so nothing collides with anything
// the vault already holds — which is checked, not hoped for.

const MARK = 'ui-editor-fixture';
const SURFACES = {
	widget: `${MARK} widget`,
	harness: `${MARK} harness`,
	ledger: `${MARK} ledger`,
	// Deliberately NOT declared by the fixture. It is the endpoint the partial-success test names.
	stranger: `${MARK} stranger`,
};

async function createFixture(sidecar, vocabulary, memoryType, label) {
	const title = `${MARK} ${label}`;
	const entities = [
		makeEntity(vocabulary, SURFACES.widget, 'an invented thing this test declares'),
		makeEntity(vocabulary, SURFACES.harness, 'a second invented thing this test declares'),
		makeEntity(vocabulary, SURFACES.ledger, 'a third invented thing this test declares'),
	];
	const facts = [
		makeFact(vocabulary, SURFACES.widget, 0, SURFACES.harness),
		makeFact(vocabulary, SURFACES.widget, 1, SURFACES.ledger),
		makeFact(vocabulary, SURFACES.harness, 2, SURFACES.ledger),
	];

	const body = composeBody(title, `A memory this test created so it knows exactly what it holds.`);
	const response = await sendCreate(sidecar, {
		content_md: body,
		semantic_delta: makeDelta(vocabulary, { title, memoryType, entities, facts }),
	});
	const write = readWrite(response, `${response.route.method} ${response.route.path}`);
	assert.equal(response.status, 200, `the create answered ${response.status}:\n${write.text.slice(0, 400)}`);
	assertCommitted(write, 'the fixture create');
	assert.ok(
		typeof write.memory_id === 'string' && write.memory_id.length > 0,
		`The create applied and named no memory, so nothing downstream can address what it wrote.`,
	);

	return { memory_id: write.memory_id, title, body, entities, facts, write };
}

// =============================================================================================
// 1. THE ONE THAT MATTERS
// =============================================================================================

test('a body-only edit through the HTTP path keeps every declared name', async (t) => {
	const { scratch, sidecar } = await openSidecarAndVault(t, 'kscope-ui-editor-r1');

	// A memory an agent actually wrote, not one this file built. The hazard is a property of the
	// load route, and a fixture created a moment ago through a route that works would not exercise
	// a record shaped by anything but this test.
	const payload = await listing(sidecar);
	let loaded = null;
	for (const record of (payload.memories ?? []).slice(0, CANDIDATE_LIMIT)) {
		const id = record.memory_id ?? record.id;
		if (!id) continue;
		const candidate = await loadForEdit(sidecar, id);
		if (candidate.names.size > 0 && candidate.content_md) {
			loaded = candidate;
			break;
		}
	}
	assert.ok(
		loaded !== null,
		`None of the first ${CANDIDATE_LIMIT} memories declares a named thing and carries a body, ` +
			`so this test could only pass vacuously — there would be nothing for a lossy write to lose.`,
	);

	t.diagnostic(`loaded through ${loaded.endpoint}, delta at ${loaded.delta_at}`);
	t.diagnostic(`${loaded.names.size} declared names, ${loaded.statements.size} statements`);

	const namesBefore = new Set(loaded.names);
	const statementsBefore = new Set(loaded.statements);
	const versionBefore = loaded.version_id;

	const edit = flipOneCharacter(loaded.content_md);

	// EXACTLY what the load route returned, re-sent unchanged beside the new body. There is no
	// body-only write: an update replaces the body AND the structure together, so a prose edit is
	// the same call with the loaded structure carried through. Nothing is projected here on
	// purpose — if the record the load route hands a browser cannot be sent back as it stands, the
	// browser cannot save, and that is the defect rather than something for a test to paper over.
	const response = await sendUpdate(sidecar, loaded.memory_id, {
		expected_version_id: versionBefore,
		content_md: edit.edited,
		semantic_delta: loaded.delta,
	});
	const write = readWrite(response, `${response.route.method} ${response.route.path}`);
	t.diagnostic(`saved through ${response.route.method} ${response.route.path}, effect ${write.effect}`);

	await t.test('the write applied', () => {
		assert.equal(
			response.status,
			200,
			`The save answered HTTP ${response.status}. A refused engine call is 200 with an ` +
				`outcome; non-200 is reserved for the sidecar's own failures. Body:\n` +
				`${write.text.slice(0, 500)}`,
		);
		assertCommitted(write, 'the body-only save');
	});

	const after = await loadForEdit(sidecar, loaded.memory_id);

	await t.test('every name the memory declared is still declared', () => {
		const lost = sorted(namesBefore).filter((name) => !after.names.has(name));
		const gained = sorted(after.names).filter((name) => !namesBefore.has(name));
		assert.deepEqual(
			sorted(after.names),
			sorted(namesBefore),
			`Editing the prose changed which things this memory declares.\n` +
				`  lost:   ${lost.join(', ') || '(none)'}\n` +
				`  gained: ${gained.join(', ') || '(none)'}\n\n` +
				`Compared as SETS, not counts, because the failure this guards against preserves the ` +
				`count exactly: a record loaded from the door that displays a memory carries no ` +
				`declarations at all, and a write assembled from it commits — exit 0, no refusal — ` +
				`having deleted every one of them. The number of declarations also decides how the ` +
				`rest of the memory is read, so the loss moves this memory across a behavioural ` +
				`switch on an edit the user believed was a typo fix.`,
		);
	});

	await t.test('the facts are unchanged, as statements and not as a count', () => {
		assert.deepEqual(
			sorted(after.statements),
			sorted(statementsBefore),
			`The prose edit changed what this memory asserts. Lost: ` +
				`${sorted(statementsBefore).filter((s) => !after.statements.has(s)).join(' / ') || '(none)'}. ` +
				`Gained: ` +
				`${sorted(after.statements).filter((s) => !statementsBefore.has(s)).join(' / ') || '(none)'}.`,
		);
	});

	await t.test('nothing was refused, and everything submitted was stored', () => {
		// The key is omitted entirely when nothing was refused, so absent and empty are both the
		// good case and neither is read as a failure.
		const refused = write.refused_facts ?? [];
		assert.equal(
			refused.length,
			0,
			`The save reported facts it declined to store: ${JSON.stringify(refused)}. A prose edit ` +
				`re-sends the structure it loaded, so nothing in it should be new enough to refuse.`,
		);
		// Independent of that key, so the guard still fires if the key is ever absent. A guard that
		// can only fire when a particular key is present is a guard that fails open.
		assert.equal(
			after.statements.size,
			statementsBefore.size,
			`${statementsBefore.size} facts were submitted and ${after.statements.size} came back. ` +
				`A write can commit having stored fewer facts than it was sent, and the response ` +
				`reports success either way.`,
		);
	});

	await t.test('the body carries the edit and the version moved', () => {
		assert.equal(after.content_md, edit.edited);
		assert.equal(differingCharacters(loaded.content_md, after.content_md), 1);
		assert.notEqual(
			after.version_id,
			versionBefore,
			`The memory came back on the version the edit was written against, so either the write ` +
				`did not land or the version is not what guards the next one.`,
		);
	});

	// -----------------------------------------------------------------------------------------
	// The instrument, checked against a failure it is supposed to see.
	// -----------------------------------------------------------------------------------------
	//
	// Everything above is a green tick that means nothing unless the assertion can go red. This
	// writes the SAME memory back the lossy way — the delta with its declarations removed, which is
	// exactly the shape a record loaded from the display door has — and asserts the names are gone.
	// If they are not, then the load route was never the thing keeping them and the assertion above
	// is measuring something other than what it claims.
	//
	// It runs last, and on a clone. The memory it damages is thrown away with the vault.
	await t.test('the assertion above can see the loss it claims to detect', async () => {
		const lossy = { ...after.delta };
		delete lossy.entities;
		assert.equal(entityNames(lossy).size, 0, 'the lossy payload still carries declarations');

		const second = flipOneCharacter(after.content_md);
		const response2 = await sendUpdate(sidecar, loaded.memory_id, {
			expected_version_id: after.version_id,
			content_md: second.edited,
			semantic_delta: lossy,
		});
		const lossyWrite = readWrite(response2, 'the lossy save');

		assert.equal(
			lossyWrite.outcome,
			'applied',
			`The lossy write did not commit, so this control proves nothing: it has to be the case ` +
				`that dropping the declarations is ACCEPTED and silent. It answered ` +
				`${lossyWrite.outcome} — ${lossyWrite.text.slice(0, 300)}`,
		);

		const damaged = await loadForEdit(sidecar, loaded.memory_id);
		assert.notDeepEqual(
			sorted(damaged.names),
			sorted(namesBefore),
			`A write that carried NO declarations left the declarations intact. That is the good ` +
				`outcome and it is a broken instrument: it means the assertion above would pass ` +
				`against a build wired to the door that returns no declarations, so it is not ` +
				`evidence that the load path is the one that carries them.`,
		);
		t.diagnostic(
			`control: a delta with no declarations committed and left ${damaged.names.size} names ` +
				`where there were ${namesBefore.size}`,
		);
	});
});

// =============================================================================================
// 2. STRUCTURAL EDITS CHANGE WHAT THEY NAME AND NOTHING ELSE
// =============================================================================================

test('a create round-trips, and a structural edit disturbs only what it names', async (t) => {
	const { sidecar } = await openSidecarAndVault(t, 'kscope-ui-editor-structure');

	const vocabulary = await readVocabulary(sidecar);
	const before = await listing(sidecar);
	const memoryType = anyMemoryType(before);
	t.diagnostic(`memory type taken from the vault: ${memoryType}`);

	// No surface this test invents may already exist, or "one node" and "unchanged" would be
	// statements about someone else's data.
	const existing = new Set();
	for (const record of before.memories ?? []) {
		for (const fact of record?.semantic?.facts ?? []) {
			existing.add(fact?.subject);
			existing.add(fact?.object);
		}
	}
	for (const surface of Object.values(SURFACES)) {
		assert.ok(!existing.has(surface), `the invented surface "${surface}" is already in this vault`);
	}

	const fixture = await createFixture(sidecar, vocabulary, memoryType, 'structure');
	t.diagnostic(`fixture created: ${fixture.memory_id}`);

	await t.test('the create round-trips: what was sent is what comes back', async () => {
		const loaded = await loadForEdit(sidecar, fixture.memory_id);
		assert.deepEqual(
			sorted(loaded.names),
			sorted(entityNames({ entities: fixture.entities })),
			`The created memory declares something other than what the create sent.`,
		);
		assert.deepEqual(
			sorted(loaded.statements),
			sorted(factStatements({ facts: fixture.facts })),
			`The created memory asserts something other than what the create sent.`,
		);
		assert.equal(loaded.content_md, fixture.body, 'the body did not survive the create');
		assert.ok(
			typeof loaded.version_id === 'string' && loaded.version_id.length > 0,
			'the created memory carries no version, so it cannot be edited safely',
		);
	});

	await t.test('the listing reflects the new memory without being asked to refresh', async () => {
		// Not `?refresh=1`. The point is that a write invalidates the cache the listing serves from:
		// a screen that saves and then shows the user the row as it was is a screen that reports a
		// write it cannot see, and the user's next action is to save again.
		const after = await listing(sidecar);
		const ids = new Set((after.memories ?? []).map((record) => record.memory_id ?? record.id));
		assert.ok(
			ids.has(fixture.memory_id),
			`A memory created a moment ago is not in the listing. The listing is served from a ` +
				`cached export and a write must invalidate it; without that the app shows a stale ` +
				`vault until someone presses refresh, and nothing on screen says so.`,
		);
		assert.ok(
			after.memory_count > before.memory_count,
			`The listing reports ${after.memory_count} memories, the same as before the create ` +
				`(${before.memory_count}).`,
		);
	});

	await t.test('editing one fact changes that fact and leaves the others alone', async () => {
		const loaded = await loadForEdit(sidecar, fixture.memory_id);
		const facts = loaded.delta.facts;
		assert.ok(facts.length >= 3, `the fixture came back with ${facts.length} facts, not three`);

		// The middle one, so an off-by-one in either direction is visible.
		//
		// WHICH fact is in the middle is not the order this test sent them in: a memory's facts come
		// back in the store's order, not the payload's. So the new object is CHOSEN against the fact
		// that is actually there rather than written down — a constant picked in advance is a
		// constant that is sometimes the object the fact already has, and an edit that changes
		// nothing passes every assertion below.
		const statementOf = (fact) => `${fact.subject} | ${fact.predicate} | ${fact.object}`;
		const target = facts[1];
		const wasStatement = statementOf(target);

		const untouched = new Set(facts.filter((_, index) => index !== 1).map(statementOf));

		// Declared by the fixture, so the edited fact is stored rather than refused for naming
		// something undeclared — and distinct from every other statement in the memory, so
		// "the edited one landed" and "the others are untouched" cannot be satisfied by each other.
		const replacement = [SURFACES.harness, SURFACES.ledger, SURFACES.widget].find(
			(surface) =>
				surface !== target.object &&
				!untouched.has(statementOf({ ...target, object: surface })),
		);
		assert.ok(
			replacement !== undefined,
			`No declared surface would change this fact into one the memory does not already ` +
				`assert. It asserts:\n  ${[...untouched, wasStatement].sort().join('\n  ')}`,
		);

		const edited = facts.map((fact, index) => (index === 1 ? { ...fact, object: replacement } : fact));
		const nowStatement = statementOf({ ...target, object: replacement });
		assert.notEqual(wasStatement, nowStatement, 'the fact edit changed nothing, so it tests nothing');

		const response = await sendUpdate(sidecar, fixture.memory_id, {
			expected_version_id: loaded.version_id,
			content_md: loaded.content_md,
			semantic_delta: { ...loaded.delta, facts: edited },
		});
		const write = readWrite(response, 'the fact edit');
		assertCommitted(write, 'the fact edit');
		assert.equal((write.refused_facts ?? []).length, 0, `the fact edit refused: ${write.text.slice(0, 300)}`);

		const after = await loadForEdit(sidecar, fixture.memory_id);
		for (const statement of untouched) {
			assert.ok(
				after.statements.has(statement),
				`Editing one fact removed another: "${statement}" is gone. The memory now asserts:\n` +
					`  ${sorted(after.statements).join('\n  ')}`,
			);
		}
		assert.ok(after.statements.has(nowStatement), `the edited fact did not land: ${nowStatement}`);
		assert.ok(
			!after.statements.has(wasStatement),
			`the fact that was edited is still there as well as its replacement: "${wasStatement}"`,
		);
		assert.deepEqual(
			sorted(after.names),
			sorted(loaded.names),
			'editing a fact changed which things the memory declares',
		);
	});

	await t.test('adding a named thing adds exactly one and disturbs nothing else', async () => {
		const loaded = await loadForEdit(sidecar, fixture.memory_id);
		const surface = `${MARK} newcomer`;
		assert.ok(!loaded.names.has(surface), 'the newcomer is already declared');

		const added = makeEntity(vocabulary, surface, 'a thing this test declares as a fourth');
		const response = await sendUpdate(sidecar, fixture.memory_id, {
			expected_version_id: loaded.version_id,
			content_md: loaded.content_md,
			semantic_delta: { ...loaded.delta, entities: [...loaded.delta.entities, added] },
		});
		const write = readWrite(response, 'the declaration add');
		assertCommitted(write, 'the declaration add');

		const after = await loadForEdit(sidecar, fixture.memory_id);
		assert.deepEqual(
			sorted(after.names),
			sorted(new Set([...loaded.names, surface])),
			`Adding one declaration did not leave the others exactly as they were. Before:\n` +
				`  ${sorted(loaded.names).join(', ')}\nAfter:\n  ${sorted(after.names).join(', ')}`,
		);
		assert.equal(
			after.names.size,
			loaded.names.size + 1,
			`Adding one declaration moved the count by ${after.names.size - loaded.names.size}.`,
		);
		assert.deepEqual(
			sorted(after.statements),
			sorted(loaded.statements),
			'adding a declaration changed what the memory asserts',
		);
	});
});

// =============================================================================================
// 3. THE TWO OUTCOMES A SAVE MUST NOT MISREPORT
// =============================================================================================

test('a stale version is a conflict that names the current version, and a resend is not', async (t) => {
	const { sidecar } = await openSidecarAndVault(t, 'kscope-ui-editor-conflict');

	const vocabulary = await readVocabulary(sidecar);
	const memoryType = anyMemoryType(await listing(sidecar));
	const fixture = await createFixture(sidecar, vocabulary, memoryType, 'conflict');

	const loaded = await loadForEdit(sidecar, fixture.memory_id);
	const staleVersion = loaded.version_id;

	// Someone else's write, while the tab is open. This is the normal case in this product, not the
	// edge case: the vault is written by agents while a person is reading it.
	const first = flipOneCharacter(loaded.content_md);
	const firstResponse = await sendUpdate(sidecar, fixture.memory_id, {
		expected_version_id: staleVersion,
		content_md: first.edited,
		semantic_delta: loaded.delta,
	});
	const firstWrite = readWrite(firstResponse, 'the first save');
	assertCommitted(firstWrite, 'the first save');
	const currentVersion = firstWrite.version_id;
	assert.notEqual(currentVersion, staleVersion, 'the first save did not move the version');

	// -----------------------------------------------------------------------------------------
	// The control, and it is the reason the probe below is shaped the way it is.
	// -----------------------------------------------------------------------------------------
	await t.test('an identical resend against the stale version is REPLAYED, not refused', async () => {
		const replay = readWrite(
			await sendUpdate(sidecar, fixture.memory_id, {
				expected_version_id: staleVersion,
				content_md: first.edited,
				semantic_delta: loaded.delta,
			}),
			'the identical resend',
		);
		assert.notEqual(
			replay.outcome,
			'refused',
			`A byte-identical resend was refused. That is not the measured behaviour, and it matters ` +
				`here for one reason: if the same bytes can be refused for a stale version, then a ` +
				`conflict probe built by resending them would pass while testing nothing about the ` +
				`guard. The perturbation below exists precisely because this is replayed.`,
		);
		t.diagnostic(`replay outcome ${replay.outcome}, effect ${replay.effect}`);
	});

	await t.test('a DIFFERENT write on the stale version is reported as a conflict', async () => {
		// Perturbed by construction: the character flipped above is flipped back, so these are bytes
		// the vault has never been asked to store against this version. Without this the call takes
		// the replay path above and the assertion below cannot fire.
		const perturbed = flipOneCharacter(first.edited);
		assert.notEqual(
			perturbed.edited,
			first.edited,
			`The conflict probe is about to resend the bytes that were already written, so it cannot ` +
				`be refused and asserts nothing.`,
		);

		const response = await sendUpdate(sidecar, fixture.memory_id, {
			expected_version_id: staleVersion,
			content_md: perturbed.edited,
			semantic_delta: loaded.delta,
		});
		const write = readWrite(response, 'the stale save');

		assert.equal(
			response.status,
			200,
			`The conflict came back as HTTP ${response.status}. A refused call is a COMPLETED call: ` +
				`the engine ran, read the request and decided against it, and that is data the screen ` +
				`renders. Non-200 is reserved for the sidecar's own failures, and mapping this onto ` +
				`one makes a recoverable conflict look like a broken app.`,
		);
		assert.equal(
			write.outcome,
			'refused',
			`A write carrying a version the vault has moved past was reported as ${write.outcome}. ` +
				`Nothing else in this product stops one editor silently overwriting another.`,
		);

		// The screen has to offer a reload, and it cannot name what to reload to unless the refusal
		// carries it. Asserted against the response text rather than against one key, because the
		// recovery only has to be POSSIBLE — a client that has to guess a version id here is how one
		// editor overwrites another while both believe they saved.
		assert.ok(
			write.text.includes(currentVersion),
			`The conflict does not name the version that is now current, so the UI cannot offer to ` +
				`reload to it and cannot show the user which two versions differ. It said:\n` +
				`${write.text.slice(0, 500)}`,
		);
		assert.equal(
			write.version_id,
			null,
			`The refusal came back carrying a version as though something had been written. A ` +
				`conflict is a call that completed and declined; it produces no version of its own, ` +
				`and a screen that reads one from here shows the user a save that did not happen.`,
		);
	});

	await t.test('the refused write left the memory on the version it was already on', async () => {
		const after = await loadForEdit(sidecar, fixture.memory_id);
		assert.equal(
			after.version_id,
			currentVersion,
			`The refused write moved the memory anyway. A conflict must be a no-op or the refusal is ` +
				`a description of something that happened.`,
		);
	});
});

test('a partial success reaches the caller as a partial success', async (t) => {
	const { sidecar } = await openSidecarAndVault(t, 'kscope-ui-editor-partial');

	const vocabulary = await readVocabulary(sidecar);
	const memoryType = anyMemoryType(await listing(sidecar));
	const fixture = await createFixture(sidecar, vocabulary, memoryType, 'partial');

	const loaded = await loadForEdit(sidecar, fixture.memory_id);
	assert.ok(
		loaded.names.size > 0,
		`The fixture declares nothing, so no fact can be refused for naming something undeclared — ` +
			`the check runs only when a memory declares at least one thing, and this test would ` +
			`assert a refusal that cannot happen.`,
	);

	// One good fact, and one naming something the memory does not declare. The second is refused ON
	// ITS OWN and the rest of the memory still commits.
	const good = makeFact(vocabulary, SURFACES.widget, 0, SURFACES.harness);
	const doomed = makeFact(vocabulary, SURFACES.widget, 1, SURFACES.stranger);
	assert.ok(!loaded.names.has(SURFACES.stranger), 'the stranger is declared, so it will not be refused');

	const submitted = [good, doomed];
	const response = await sendUpdate(sidecar, fixture.memory_id, {
		expected_version_id: loaded.version_id,
		content_md: loaded.content_md,
		semantic_delta: { ...loaded.delta, facts: submitted },
	});
	const write = readWrite(response, 'the partial save');
	t.diagnostic(`partial: outcome ${write.outcome}, effect ${write.effect}`);

	await t.test('it is NOT reported as a failure', () => {
		assert.equal(
			response.status,
			200,
			`The partial save answered HTTP ${response.status}. The memory committed; a status that ` +
				`reads as an error tells the user their work was lost when most of it landed.`,
		);
		assert.notEqual(
			write.outcome,
			'refused',
			`A write that committed the memory was reported as refused. "Save failed" is a lie about ` +
				`a partially successful write, and the user's next action is to type it all again.`,
		);
		assert.equal(
			write.payload.error ?? null,
			null,
			`The partial save carried a sidecar error object: ${JSON.stringify(write.payload.error)}.`,
		);
	});

	await t.test('it reports the memory as committed, with a new version', () => {
		assertCommitted(write, 'the partial save');
		assert.notEqual(write.version_id, loaded.version_id, 'the partial save did not move the version');
	});

	await t.test('it names the fact it refused, and the surface that caused it', () => {
		const refused = write.refused_facts ?? [];
		assert.ok(
			refused.length > 0,
			`The response named nothing it declined to store, but one of the two facts submitted ` +
				`names something this memory does not declare. A save that reports success having ` +
				`stored fewer facts than it was sent is the failure this assertion exists for; the ` +
				`response said:\n${write.text.slice(0, 500)}`,
		);
		assert.ok(
			write.text.includes(SURFACES.stranger),
			`The response reports a refusal and does not name "${SURFACES.stranger}", the undeclared ` +
				`surface that caused it. The banner has to show the user WHICH fact was dropped and ` +
				`WHY, and it matches rows by surface string — the index a refusal carries does not ` +
				`correspond to the position of the fact in the payload that was sent, so an editor ` +
				`that highlights by index points confidently at an innocent row.`,
		);
	});

	await t.test('the good fact landed and the refused one did not', async () => {
		const after = await loadForEdit(sidecar, fixture.memory_id);
		const goodStatement = `${good.subject} | ${good.predicate} | ${good.object}`;
		const doomedStatement = `${doomed.subject} | ${doomed.predicate} | ${doomed.object}`;
		assert.ok(after.statements.has(goodStatement), `the good fact did not commit: ${goodStatement}`);
		assert.ok(
			!after.statements.has(doomedStatement),
			`the fact naming an undeclared thing was stored after all: ${doomedStatement}`,
		);
		assert.deepEqual(
			sorted(after.names),
			sorted(loaded.names),
			'the partial write changed which things the memory declares',
		);
	});

	await t.test('the shortfall is detectable without reading the refusal key at all', async () => {
		// Independent of `refused_facts`, and deliberately so: that key is omitted entirely when
		// nothing was refused, so a guard built on it can only fire when it is present. A guard that
		// fails open is worse than no guard, because it reports a clean result at the moment it has
		// stopped working.
		const after = await loadForEdit(sidecar, fixture.memory_id);
		assert.ok(
			after.statements.size < submitted.length,
			`${submitted.length} facts were submitted and ${after.statements.size} are stored, so ` +
				`this test is not looking at a partial write at all and every assertion above passed ` +
				`for the wrong reason.`,
		);
	});
});

// =============================================================================================
// 4. THE WRITE ROUTES ARE NOT EXEMPT FROM THE SECURITY POSTURE
// =============================================================================================

test('the write routes refuse a missing token and a hostile Host, and refuse without writing', async (t) => {
	const { scratch, sidecar } = await openSidecarAndVault(t, 'kscope-ui-editor-security');

	const vocabulary = await readVocabulary(sidecar);
	const memoryType = anyMemoryType(await listing(sidecar));
	const fixture = await createFixture(sidecar, vocabulary, memoryType, 'security');
	const loaded = await loadForEdit(sidecar, fixture.memory_id);

	// A payload that WOULD commit. Probing with something malformed proves nothing: the request
	// would be refused for being wrong rather than for being unauthorised, and the two are
	// indistinguishable from the status code.
	const wouldCommit = {
		expected_version_id: loaded.version_id,
		content_md: flipOneCharacter(loaded.content_md).edited,
		semantic_delta: loaded.delta,
	};
	const wouldCreate = {
		content_md: composeBody(`${MARK} intruder`, 'A memory no rejected request may create.'),
		semantic_delta: makeDelta(vocabulary, {
			title: `${MARK} intruder`,
			memoryType,
			entities: [makeEntity(vocabulary, `${MARK} intruder thing`, 'a thing no rejected request may declare')],
			facts: [makeFact(vocabulary, `${MARK} intruder thing`, 0, `${MARK} intruder thing`)],
		}),
	};

	// Every assertion below is paired with this. A 401 that has already spawned the engine is not a
	// refusal, it is a slow success with a rude answer — and only the vault can say which happened.
	const fingerprintBefore = fingerprintVault(scratch.root);
	assert.ok(fingerprintBefore.files > 0, 'the fingerprint found no files, so it can prove nothing');

	const attempts = [
		{
			what: 'no token at all',
			expect: 401,
			send: () => sendUpdate(sidecar, fixture.memory_id, wouldCommit, { token: false }),
		},
		{
			what: 'no token at all, on the create route',
			expect: 401,
			send: () => sendCreate(sidecar, wouldCreate, { token: false }),
		},
		{
			what: 'a wrong token of the right length',
			expect: 401,
			send: () =>
				sendUpdate(sidecar, fixture.memory_id, wouldCommit, {
					token: false,
					// Same length, differing in one character. A comparison on a truncated prefix, or
					// one that compares lengths first, lets this through.
					headers: {
						authorization: `Bearer ${sidecar.token.slice(0, -1)}${sidecar.token.at(-1) === 'A' ? 'B' : 'A'}`,
					},
				}),
		},
		{
			what: 'a hostile Host WITH the correct token',
			expect: 403,
			send: () =>
				sendUpdate(sidecar, fixture.memory_id, wouldCommit, {
					headers: { host: 'memory.example.invalid' },
				}),
		},
		{
			what: 'a hostile Host WITH the correct token, on the create route',
			expect: 403,
			send: () => sendCreate(sidecar, wouldCreate, { headers: { host: 'memory.example.invalid' } }),
		},
		{
			what: 'a foreign Origin WITH the correct token',
			expect: 403,
			send: () =>
				sendUpdate(sidecar, fixture.memory_id, wouldCommit, {
					headers: { origin: 'https://memory.example.invalid' },
				}),
		},
	];

	for (const attempt of attempts) {
		await t.test(`a write with ${attempt.what} is refused`, async () => {
			const response = await attempt.send();
			assert.equal(
				response.status,
				attempt.expect,
				`A write with ${attempt.what} answered ${response.status} rather than ` +
					`${attempt.expect}. The read routes check this before routing and before ` +
					`authentication; the write routes do not inherit that by sitting in the same file, ` +
					`and the consequence of a hole here is not a disclosure but a REWRITE of the ` +
					`user's memory by a page they merely visited.`,
			);
			for (let index = 0; index < (response.rawHeaders ?? []).length; index += 2) {
				assert.ok(
					!response.rawHeaders[index].toLowerCase().startsWith('access-control-'),
					`A rejected write answered with ${response.rawHeaders[index]}. No CORS header is ` +
						`ever sent by this server; one on one route is enough for a page on another ` +
						`origin to read the reply to a write it forged.`,
				);
			}
			assert.ok(
				!response.body.includes(sidecar.token) && !response.body.includes(scratch.root),
				`A rejected write handed back the token or the vault path.`,
			);
		});
	}

	await t.test('not one of those refusals wrote a byte', () => {
		const fingerprintAfter = fingerprintVault(scratch.root);
		assert.equal(
			fingerprintAfter.digest,
			fingerprintBefore.digest,
			`Six rejected writes changed the vault: ${fingerprintBefore.files} files before, ` +
				`${fingerprintAfter.files} after. A request refused AFTER the engine ran is not ` +
				`refused — it is a write with an unhelpful reply, and the status code says the ` +
				`opposite of what happened.`,
		);
	});

	await t.test('the same payload with the app\'s own credentials still commits', async () => {
		// Without this the six assertions above are satisfied by a write path that refuses
		// everything, including the app. A refusal is only a control if something else gets through.
		const response = await sendUpdate(sidecar, fixture.memory_id, wouldCommit);
		const write = readWrite(response, 'the authorised save');
		assertCommitted(write, 'the authorised save');
	});
});

// =============================================================================================
// 5. THE INVARIANT
// =============================================================================================

test('the whole editor flow records no ranked search', async (t) => {
	// M1 asserted this for the engine client and M2 for the read surface. The editor is where the
	// next caller gets added: a name-suggestion list wired to the ranked door instead of to the
	// listing already in the browser, a duplicate check before a save, a "find related" on a fact
	// endpoint. Each is one line, each looks like a feature, and each writes a permanent record —
	// storing the query text — into a store nothing published reads back or removes.
	const { scratch, sidecar } = await openSidecarAndVault(t, 'kscope-ui-editor-exposure');

	const before = countExposureRecords(scratch.root);
	assert.ok(
		before.stores > 0,
		`No search-exposure store was found in the clone, so the count below is zero compared ` +
			`against zero and passes hardest when it is broken. Nothing is asserted until the census ` +
			`has somewhere to look.`,
	);
	t.diagnostic(`exposure before: ${before.records} records in ${before.stores} stores`);

	const vocabulary = await readVocabulary(sidecar);
	const payload = await listing(sidecar);
	const memoryType = anyMemoryType(payload);

	// A complete session: browse, create, load, save a prose edit, save a structural edit, collide
	// with a stale version, take a partial success, and read the list back.
	const fixture = await createFixture(sidecar, vocabulary, memoryType, 'exposure');

	const opened = await loadForEdit(sidecar, fixture.memory_id);
	const prose = flipOneCharacter(opened.content_md);
	const saved = readWrite(
		await sendUpdate(sidecar, fixture.memory_id, {
			expected_version_id: opened.version_id,
			content_md: prose.edited,
			semantic_delta: opened.delta,
		}),
		'the prose save',
	);
	assertCommitted(saved, 'the prose save');

	const reopened = await loadForEdit(sidecar, fixture.memory_id);
	const structural = readWrite(
		await sendUpdate(sidecar, fixture.memory_id, {
			expected_version_id: reopened.version_id,
			content_md: reopened.content_md,
			semantic_delta: {
				...reopened.delta,
				entities: [
					...reopened.delta.entities,
					makeEntity(vocabulary, `${MARK} late arrival`, 'a thing declared during the flow'),
				],
			},
		}),
		'the structural save',
	);
	assertCommitted(structural, 'the structural save');

	// A conflict, perturbed so it is a conflict and not a replay.
	await sendUpdate(sidecar, fixture.memory_id, {
		expected_version_id: opened.version_id,
		content_md: flipOneCharacter(prose.edited).edited,
		semantic_delta: opened.delta,
	});

	// A partial success.
	const current = await loadForEdit(sidecar, fixture.memory_id);
	await sendUpdate(sidecar, fixture.memory_id, {
		expected_version_id: current.version_id,
		content_md: current.content_md,
		semantic_delta: {
			...current.delta,
			facts: [
				makeFact(vocabulary, SURFACES.widget, 0, SURFACES.harness),
				makeFact(vocabulary, SURFACES.widget, 1, SURFACES.stranger),
			],
		},
	});

	await listing(sidecar);
	await loadForEdit(sidecar, fixture.memory_id);

	const after = countExposureRecords(scratch.root);
	t.diagnostic(`exposure after: ${after.records} records in ${after.stores} stores`);
	assert.equal(after.stores, before.stores, 'the census lost sight of a store mid-test');
	assert.equal(
		after.records,
		before.records,
		`A complete create, load, edit, conflict and partial-save session left ` +
			`${after.records - before.records} new search-exposure record(s). Some door on the write ` +
			`path runs a ranked query. The record is permanent, it stores the query text verbatim, ` +
			`and nothing published reads it back or removes one — so a suggestion list wired to that ` +
			`door writes into the store it is inspecting on every keystroke, forever.`,
	);
});
