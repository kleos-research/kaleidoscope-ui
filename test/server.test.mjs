// Milestone 2: the sidecar's HTTP surface, and the two things about it that go quiet.
//
// The security posture is the reason this file exists. Every control in PRD 0001 §3.6 is the kind
// that keeps working after it stops working: a Host check that runs after routing still passes a
// same-origin test suite; a token compared with `===` still accepts the right token; a CORS header
// that appears on one error path is invisible to every test that only looks at the happy one. None
// of those failures shows up in the app. They show up in someone else's browser tab.
//
// So the assertions here are deliberately negative and deliberately independent:
//
//   * NO token is rejected, and a WRONG token is rejected — including a wrong token of the right
//     length, which is the one a `===` on a truncated prefix would let through;
//   * a hostile Host is rejected WITH A CORRECT TOKEN, so the rebinding defence is measured on its
//     own rather than inheriting the token check's pass. This is the whole point of the test: a
//     remote page that rebinds a name to loopback talks to this server as same-origin, sends no
//     `Origin` at all, and — if it has the token — is otherwise indistinguishable from the app;
//   * a cross-origin non-GET is rejected;
//   * no CORS header appears on ANY response, asserted across routes and across outcome classes,
//     because absence is only worth asserting where it would be easiest to reintroduce;
//   * the listener is not reachable off loopback, tested as far as one machine can test it, with
//     what is missing named rather than implied;
//   * a traversal out of the static route does not escape the asset directory.
//
// The second quiet thing is the invariant. M1 asserted that the ENGINE CLIENT records no ranked
// search. This file asserts it for the whole HTTP surface, because that is where the next caller
// will be added: a filter box wired to the ranked door instead of to an already-fetched payload
// writes a permanent record per keystroke, into a store nothing published reads back or removes.
// Zero callers is the invariant, and the exposure count across every route is the instrument.
//
// Everything runs against a clone. A ranked search writes, so a read-shaped call is treated as a
// write for the purpose of deciding which vault it goes to.

import assert from 'node:assert/strict';
import { connect as tcpConnect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { renameSync } from 'node:fs';
import { request as httpRequestRaw } from 'node:http';
import test from 'node:test';

import { call } from '../src/engine/call.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import {
	countExposureRecords,
	fingerprintVault,
	openScratchVault,
	readVaultAddress,
} from './helpers/vault.mjs';

// ---------------------------------------------------------------------------------------------
// Finding the sidecar
// ---------------------------------------------------------------------------------------------

/**
 * The server module was written in parallel with this file, so the specifier is resolved rather
 * than assumed — and the resolution is TERMINAL and LOUD, in the same shape as the engine's own
 * locator: if nothing matches, the failure names every place looked. A test that silently skipped
 * because it could not find the thing it guards is a test that reports green for a milestone with
 * no server in it at all.
 */
const SERVER_MODULES = [
	'../src/server/sidecar.mjs',
	'../src/server/server.mjs',
	'../src/server/index.mjs',
	'../src/sidecar/sidecar.mjs',
	'../src/sidecar/server.mjs',
	'../src/sidecar.mjs',
	'../src/server.mjs',
];

/** The export that starts a listening server. First one found wins. */
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
			// A module that exists and throws on import is a different problem from one that is not
			// there, and it must not be swallowed as "kept looking".
			if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
			looked.push(`  - ${specifier} (no such module)`);
			continue;
		}
		const name = START_EXPORTS.find((candidate) => typeof module[candidate] === 'function');
		if (name) {
			cachedStarter = { start: module[name], specifier, exportName: name, module };
			return cachedStarter;
		}
		looked.push(
			`  - ${specifier} (found, but exports none of: ${START_EXPORTS.join(', ')}; ` +
				`it exports: ${Object.keys(module).join(', ') || '(nothing)'})`,
		);
	}

	throw new Error(
		`No sidecar to test. Looked for a module exporting one of ` +
			`${START_EXPORTS.join(', ')} in:\n${looked.join('\n')}\n\n` +
			`This is not a skip. M2 is the HTTP server plus the browse screens, and every ` +
			`assertion in this file is about the server. If the module lives somewhere else, add ` +
			`its specifier to SERVER_MODULES rather than deleting the tests.`,
	);
}

/**
 * Start a sidecar on an ephemeral port against a cloned vault, and normalise whatever handle it
 * hands back into the four things every test here needs: the port, the token, the bind address it
 * asked for, and a way to shut it down.
 */
async function startSidecarUnderTest({ enginePath, root, ...rest }) {
	const { start, specifier, exportName } = await resolveStarter();

	const handle = await start({
		enginePath,
		root,
		host: '127.0.0.1',
		port: 0,
		open: false,
		...rest,
	});

	assert.ok(
		handle && typeof handle === 'object',
		`${specifier} → ${exportName}() returned ${typeof handle}, not a handle this test can drive.`,
	);

	const address =
		typeof handle.server?.address === 'function'
			? handle.server.address()
			: typeof handle.address === 'function'
				? handle.address()
				: (handle.address ?? null);

	const port = handle.port ?? address?.port ?? null;
	assert.ok(
		Number.isInteger(port) && port > 0,
		`The sidecar did not report a listening port. It must, or nothing can be requested of it.`,
	);

	const token = handle.token ?? handle.bearer ?? handle.secret ?? null;
	assert.ok(
		typeof token === 'string' && token.length > 0,
		`The sidecar minted no bearer token, so every request below would be authorised by ` +
			`accident. PRD 0001 R25: 32 random bytes, per launch, never persisted.`,
	);

	const close = async () => {
		for (const name of ['close', 'stop', 'shutdown', 'dispose']) {
			if (typeof handle[name] === 'function') return await handle[name]();
		}
		if (typeof handle.server?.close === 'function') {
			return await new Promise((resolve) => handle.server.close(resolve));
		}
		throw new Error('The sidecar handle carries no way to shut it down.');
	};

	return {
		handle,
		port,
		token,
		// What the server SAYS it bound. Asserted separately from what it will actually accept.
		boundAddress: address?.address ?? handle.host ?? null,
		routes: handle.routes ?? null,
		close,
	};
}

// ---------------------------------------------------------------------------------------------
// A raw HTTP client
// ---------------------------------------------------------------------------------------------
//
// node:http rather than fetch, for three reasons that are all load-bearing here: fetch normalises
// the request path, so `..` never leaves the process and the traversal probes would assert nothing;
// fetch owns the `Host` header, so the rebinding probe cannot be sent at all; and fetch hides the
// raw header list, so "no CORS header appeared" would be asserted against a parsed view rather than
// against the bytes.

function httpRequest({
	port,
	method = 'GET',
	path = '/',
	headers = {},
	body = null,
	timeoutMs = 20_000,
	headersOnly = false,
}) {
	return new Promise((resolve, reject) => {
		let request;
		try {
			request = httpRequestRaw({
				host: '127.0.0.1',
				port,
				method,
				// Sent verbatim. This is the property the traversal probes depend on.
				path,
				headers: { host: `127.0.0.1:${port}`, ...headers },
			});
		} catch (error) {
			// Node refused to put this on the wire. The probe never reached the server, so it proves
			// nothing about the server — recorded as such rather than counted as a pass.
			resolve({ clientRefused: true, reason: error.message, status: null, headers: {}, body: '' });
			return;
		}

		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`no response within ${timeoutMs} ms`));
		});
		request.on('error', reject);

		request.on('response', (response) => {
			const seen = {
				clientRefused: false,
				status: response.statusCode,
				headers: response.headers,
				// The raw alternating name/value list, so an assertion about absence is made against
				// what arrived rather than against a normalised object.
				rawHeaders: response.rawHeaders,
				body: '',
			};

			if (headersOnly) {
				// For a stream that never ends by design.
				response.destroy();
				request.destroy();
				resolve(seen);
				return;
			}

			response.setEncoding('utf8');
			response.on('data', (chunk) => {
				seen.body += chunk;
			});
			response.on('end', () => resolve(seen));
			response.on('error', reject);
		});

		if (body !== null) request.write(typeof body === 'string' ? body : JSON.stringify(body));
		request.end();
	});
}

/**
 * One request, written onto the socket by hand.
 *
 * `node:http` is a cooperative client: it repairs a request it considers malformed before it
 * reaches the wire, and the repair it makes is exactly the one that hides a missing Host check —
 * asked for an empty `Host`, it substitutes the real authority. A probe built on it therefore
 * measures the client's helpfulness and reports it as the server's correctness. This writes the
 * bytes, so what the server receives is what the test wrote.
 *
 * `Connection: close` is on every caller so the response is complete when the socket closes; there
 * is no content-length parsing here on purpose.
 */
function rawRequest({ port, text, timeoutMs = 10_000 }) {
	return new Promise((resolve, reject) => {
		const socket = tcpConnect({ host: '127.0.0.1', port });
		let raw = '';
		socket.setTimeout(timeoutMs, () => {
			socket.destroy();
			reject(new Error(`no response within ${timeoutMs} ms to a hand-written request`));
		});
		socket.on('connect', () => socket.write(text));
		socket.on('data', (chunk) => {
			raw += chunk;
		});
		socket.on('error', reject);
		socket.on('close', () => {
			const [head = '', body = ''] = raw.split('\r\n\r\n');
			const statusLine = head.split('\r\n')[0] ?? '';
			resolve({
				status: Number.parseInt(statusLine.split(' ')[1] ?? '', 10),
				statusLine,
				head,
				body,
				raw,
			});
		});
	});
}

/** The same request, authorised the way the app authorises one. */
const authorised = (sidecar, options) =>
	httpRequest({
		port: sidecar.port,
		...options,
		headers: { authorization: `Bearer ${sidecar.token}`, ...(options.headers ?? {}) },
	});

const json = (response) => {
	try {
		return JSON.parse(response.body);
	} catch (error) {
		assert.fail(
			`Expected JSON and got ${response.body.length} bytes that do not parse ` +
				`(${error.message}). The first 200 bytes are:\n${response.body.slice(0, 200)}`,
		);
	}
};

// ---------------------------------------------------------------------------------------------
// The headers that must never appear
// ---------------------------------------------------------------------------------------------

/**
 * Every header that grants a foreign origin something. Asserted as a SET rather than as
 * `access-control-allow-origin` alone: a permissive `Access-Control-Allow-Headers` or a
 * `Timing-Allow-Origin` is the same class of leak and would sail past a one-header check.
 */
const CORS_HEADERS = [
	'access-control-allow-origin',
	'access-control-allow-credentials',
	'access-control-allow-methods',
	'access-control-allow-headers',
	'access-control-expose-headers',
	'access-control-max-age',
	'timing-allow-origin',
];

function assertNoCorsHeader(response, where) {
	for (let index = 0; index < (response.rawHeaders ?? []).length; index += 2) {
		const name = response.rawHeaders[index].toLowerCase();
		assert.ok(
			!CORS_HEADERS.includes(name),
			`${where} responded with ${response.rawHeaders[index]}: ` +
				`${response.rawHeaders[index + 1]}. No CORS header is ever sent by this server ` +
				`(PRD 0001 R26) — a page on another origin must not be able to read a single byte ` +
				`of this vault, and one allow-header on one route is enough for it to read all of it.`,
		);
	}
}

/** Nothing a rejected request gets back may name the machine, the vault, or the token. */
function assertLeaksNothing(response, sidecar, scratch, where) {
	const body = response.body ?? '';
	for (const [what, secret] of [
		['the bearer token', sidecar.token],
		['the vault root', scratch.root],
	]) {
		assert.ok(
			secret && !body.includes(secret),
			`${where} handed ${what} back to a request it had just rejected.`,
		);
	}
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

async function openSidecarAndVault(t, { label = 'sidecar-under-test' } = {}) {
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

	return { engine, scratch, sidecar };
}

/** Every memory id in the listing, so no id is ever transcribed into this file. */
async function listedMemoryIds(sidecar) {
	const response = await authorised(sidecar, { path: '/api/memories' });
	assert.equal(response.status, 200, 'the listing must be readable before an id can be taken from it');
	const payload = json(response);
	return new Set(
		(payload.memories ?? []).map((record) => record.memory_id ?? record.id).filter(Boolean),
	);
}

/** One memory id from the listing. */
async function anyMemoryId(sidecar) {
	const response = await authorised(sidecar, { path: '/api/memories' });
	assert.equal(response.status, 200, 'the listing must be readable before an id can be taken from it');
	const payload = json(response);
	const memories = payload.memories ?? [];
	assert.ok(
		memories.length > 0,
		`The cloned vault holds no memories, so every per-memory assertion below would be ` +
			`vacuous. Point KALEIDOSCOPE_TEST_VAULT at a vault with at least one memory in it.`,
	);
	const id = memories[0].memory_id ?? memories[0].id;
	assert.ok(typeof id === 'string' && id.length > 0, 'a listed memory carries no readable id');
	return id;
}

/**
 * An id of exactly the right shape that no memory has.
 *
 * DERIVED from a real one rather than written down, for two reasons. A hand-typed id is a guess at
 * the mint's format, and the day the format changes the probe stops testing "unknown id" and starts
 * testing "malformed id", which is a different route with a different answer — while still passing.
 * And an id transcribed into this repository would be vault content in a public file.
 *
 * The mutation touches only the trailing characters, so the prefix, the length and the alphabet all
 * survive; then it is checked against every id the vault actually holds, because a probe that
 * accidentally names a real memory asserts the opposite of what it claims.
 */
function absentIdLike(realId, taken) {
	const tail = realId.slice(-8);
	const swapped = [...tail].map((character) => (character === 'z' ? 'y' : 'z')).join('');
	const candidate = realId.slice(0, -8) + swapped;
	assert.ok(
		candidate !== realId && !taken.has(candidate),
		'could not derive an id that no memory holds, so the unknown-id probe would name a real one',
	);
	return candidate;
}

// =============================================================================================
// THE SECURITY POSTURE
// =============================================================================================

test('the sidecar refuses everything it is supposed to refuse', async (t) => {
	const { scratch, sidecar } = await openSidecarAndVault(t);
	const loopbackHost = `127.0.0.1:${sidecar.port}`;

	await t.test('a request with no token is rejected', async () => {
		const response = await httpRequest({ port: sidecar.port, path: '/api/memories' });
		assert.equal(
			response.status,
			401,
			`An unauthenticated request to the listing got ${response.status}. On a shared machine ` +
				`every local user can reach loopback, which is why the token is the authentication ` +
				`layer and not a belt-and-braces one.`,
		);
		assert.equal(response.body.length, 0, 'a 401 carries no body (PRD 0001 §3.6)');
		assertNoCorsHeader(response, 'the 401 for a missing token');
		assertLeaksNothing(response, sidecar, scratch, 'the 401 for a missing token');
	});

	await t.test('a request with a wrong token is rejected', async () => {
		// Four shapes, and the second is the one that matters. A comparison that stops at the
		// shorter string accepts a prefix; a comparison on the first differing byte leaks length.
		// The same-length variant is the probe a `startsWith` or a truncating compare fails.
		const flipped =
			sidecar.token.slice(0, -1) + (sidecar.token.endsWith('a') ? 'b' : 'a');

		const wrong = [
			['an unrelated token', 'not-the-token'],
			['a token of the right length, one character different', flipped],
			['a prefix of the real token', sidecar.token.slice(0, -4)],
			['the real token with a suffix', `${sidecar.token}x`],
			['an empty bearer', ''],
		];

		for (const [what, value] of wrong) {
			const response = await httpRequest({
				port: sidecar.port,
				path: '/api/memories',
				headers: { authorization: `Bearer ${value}` },
			});
			assert.equal(response.status, 401, `${what} was not rejected`);
			assert.equal(response.body.length, 0, `${what}: a 401 carries no body`);
			assertNoCorsHeader(response, `the 401 for ${what}`);
			assertLeaksNothing(response, sidecar, scratch, `the 401 for ${what}`);
		}

		// A different scheme carrying the right secret is still not the contract.
		const basic = await httpRequest({
			port: sidecar.port,
			path: '/api/memories',
			headers: { authorization: `Basic ${sidecar.token}` },
		});
		assert.equal(basic.status, 401, 'a non-Bearer scheme carrying the token was accepted');
	});

	await t.test('the token is not accepted in a query string or a cookie', async () => {
		// Both channels leak: a query string reaches browser history, the `Referer` of any outbound
		// link, and every screenshot pasted into a bug report; a cookie is attached automatically,
		// which is exactly what reintroduces simple-request forgery that a header defeats.
		const inQuery = await httpRequest({
			port: sidecar.port,
			path: `/api/memories?token=${encodeURIComponent(sidecar.token)}`,
		});
		assert.equal(inQuery.status, 401, 'the token authenticated from the query string');

		const inCookie = await httpRequest({
			port: sidecar.port,
			path: '/api/memories',
			headers: { cookie: `token=${sidecar.token}` },
		});
		assert.equal(inCookie.status, 401, 'the token authenticated from a cookie');
	});

	await t.test('a hostile Host is rejected even when the token is correct', async () => {
		// THE REBINDING DEFENCE, and it is asserted independently of the token on purpose.
		//
		// A remote page that points a name it controls at 127.0.0.1 is same-origin with this server
		// as far as the browser is concerned: it sends no `Origin` header, so an Origin check sees
		// nothing to reject. The `Host` header still names the attacker, and it is the only thing
		// that does. Every request below carries a VALID token, so a 401 here would mean the Host
		// check is standing behind the token rather than in front of it — which is the same as not
		// having one, since the rebinding attack is only interesting once a token has leaked.
		const hostile = [
			'evil.example:80',
			`evil.example:${sidecar.port}`,
			// The shapes that look like loopback and are not.
			`127.0.0.1.evil.example:${sidecar.port}`,
			`localhost.evil.example:${sidecar.port}`,
			`evil-localhost:${sidecar.port}`,
			// A bound address that is not the one bound.
			`0.0.0.0:${sidecar.port}`,
			`[::]:${sidecar.port}`,
			// The right name on the wrong port: a second local server is a different origin.
			`127.0.0.1:${sidecar.port === 65535 ? 1024 : sidecar.port + 1}`,
		];
		//
		// AN EMPTY AND AN ABSENT HOST ARE NOT SENT THROUGH `node:http`, AND THAT IS A MEASUREMENT
		// RATHER THAN A PREFERENCE. Asked for `Host: ""`, the client library silently substitutes
		// the real authority — the server receives `Host: 127.0.0.1:<port>` and answers 200,
		// correctly, to a request that was never the probe. Written the obvious way this case
		// asserts nothing about the server and fails against a server that is right. Both shapes
		// are therefore put on the wire by hand, below.

		for (const host of hostile) {
			const response = await authorised(sidecar, {
				path: '/api/memories',
				headers: { host },
			});
			assert.equal(
				response.status,
				403,
				`Host: "${host}" with a VALID token got ${response.status}, not 403. ` +
					(response.status === 401
						? `A 401 means the token was checked first and the Host check never ran on ` +
							`its own — the rebinding defence is only worth something when the ` +
							`attacker already has the token.`
						: `The Host header is checked FIRST, before routing and before ` +
							`authentication (PRD 0001 R23).`),
			);
			assert.equal(response.body.length, 0, `Host: "${host}" — a 403 carries no body`);
			assertNoCorsHeader(response, `the 403 for Host: "${host}"`);
			assertLeaksNothing(response, sidecar, scratch, `the 403 for Host: "${host}"`);
		}

		// The two shapes `node:http` will not send, put on the wire byte by byte.
		//
		// They are asserted separately because they are refused at DIFFERENT LAYERS and only one of
		// them measures this server. An empty `Host:` reaches the dispatcher and its own check
		// answers 403 — that is the assertion with teeth. A request with no Host line at all never
		// reaches any handler: the HTTP runtime's own parser refuses it with 400, because HTTP/1.1
		// requires the header. Recorded as the runtime's refusal rather than claimed as this
		// server's, so a later change that removed the check would still show up in the first case.
		const emptyHost = await rawRequest({
			port: sidecar.port,
			text:
				`GET /api/memories HTTP/1.1\r\nHost: \r\n` +
				`Authorization: Bearer ${sidecar.token}\r\nConnection: close\r\n\r\n`,
		});
		assert.equal(
			emptyHost.status,
			403,
			`An empty Host with a VALID token got ${emptyHost.status}, not 403. Deny by default: ` +
				`a Host that is present and names nothing is not a Host this server answers to.`,
		);

		const noHost = await rawRequest({
			port: sidecar.port,
			text:
				`GET /api/memories HTTP/1.1\r\n` +
				`Authorization: Bearer ${sidecar.token}\r\nConnection: close\r\n\r\n`,
		});
		assert.ok(
			noHost.status >= 400 && noHost.status < 500,
			`A request with no Host header at all got ${noHost.status}. It must be refused.`,
		);
		t.diagnostic(
			`no Host header: refused with ${noHost.status}` +
				(noHost.status === 400
					? ' by the HTTP runtime before any handler ran, so it says nothing about the ' +
						'Host check itself — the empty-Host probe above is what measures that'
					: ' by this server'),
		);

		// And the loopback forms are accepted, so the check above is a check and not a closed door.
		for (const host of [loopbackHost, `localhost:${sidecar.port}`]) {
			const response = await authorised(sidecar, { path: '/api/memories', headers: { host } });
			assert.equal(
				response.status,
				200,
				`Host: "${host}" was rejected. Both loopback spellings are what the launch URL can ` +
					`carry, so refusing one is a server the app cannot talk to — and a Host check ` +
					`that refuses everything proves nothing about the one it must refuse.`,
			);
		}
	});

	await t.test('a cross-origin non-GET is rejected', async () => {
		const foreign = [
			{ origin: 'https://evil.example' },
			{ origin: 'http://127.0.0.1:1' },
			// `null` is what a sandboxed iframe and a data: document send. It is not "no origin".
			{ origin: 'null' },
			{ 'sec-fetch-site': 'cross-site' },
			{ 'sec-fetch-site': 'same-site' },
			// The image-tag and form-post shape: a request the browser will happily send across
			// origins because the page never intended to read the response.
			{ 'sec-fetch-mode': 'no-cors' },
		];

		for (const headers of foreign) {
			for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
				const response = await authorised(sidecar, {
					method,
					path: '/api/memories',
					headers: { 'content-type': 'application/json', ...headers },
					body: {},
				});
				const described = JSON.stringify(headers);
				assert.equal(
					response.status,
					403,
					`${method} /api/memories with ${described} got ${response.status}. ` +
						(response.status === 404 || response.status === 405
							? `A 404/405 means the origin check ran AFTER routing, so it protects ` +
								`only the routes that happen to exist today — and M3 adds the write ` +
								`routes. The check runs before routing (PRD 0001 §3.6).`
							: `An unmatched Origin, a null Origin, a cross-site Sec-Fetch-Site and ` +
								`Sec-Fetch-Mode: no-cors are all refused (PRD 0001 R24).`),
				);
				assertNoCorsHeader(response, `${method} with ${described}`);
			}
		}

		// OPTIONS is refused outright: there is no preflight to answer, because there is no
		// cross-origin request this server is willing to serve.
		const preflightProbe = await authorised(sidecar, {
			method: 'OPTIONS',
			path: '/api/memories',
			headers: { origin: 'https://evil.example' },
		});
		assert.ok(
			preflightProbe.status >= 400,
			`OPTIONS was answered with ${preflightProbe.status}. It is rejected (PRD 0001 R26).`,
		);
		assertNoCorsHeader(preflightProbe, 'the OPTIONS response');
	});

	await t.test('no CORS header appears on any response', async () => {
		// Asserted across ROUTES and across OUTCOME CLASSES. The happy path is the least likely
		// place for one of these to be added; a hand-written error responder is the most likely.
		const id = await anyMemoryId(sidecar);
		const absent = absentIdLike(id, await listedMemoryIds(sidecar));
		const probes = [
			['the SPA root', () => authorised(sidecar, { path: '/' })],
			['the session reading', () => authorised(sidecar, { path: '/api/session' })],
			['the listing', () => authorised(sidecar, { path: '/api/memories' })],
			['one memory', () => authorised(sidecar, { path: `/api/memories/${id}` })],
			['the health reading', () => authorised(sidecar, { path: '/api/health' })],
			['an unknown API route', () => authorised(sidecar, { path: '/api/no-such-route' })],
			['an unknown memory', () => authorised(sidecar, { path: `/api/memories/${absent}` })],
			['an unknown static path', () => authorised(sidecar, { path: '/no-such-asset.js' })],
			['a missing token', () => httpRequest({ port: sidecar.port, path: '/api/memories' })],
			[
				'a hostile Host',
				() => authorised(sidecar, { path: '/api/memories', headers: { host: 'evil.example' } }),
			],
			[
				'a foreign origin',
				() =>
					authorised(sidecar, {
						path: '/api/memories',
						headers: { origin: 'https://evil.example' },
					}),
			],
			[
				'a rejected method',
				() => authorised(sidecar, { method: 'OPTIONS', path: '/api/memories' }),
			],
		];

		for (const [where, send] of probes) {
			const response = await send();
			assertNoCorsHeader(response, where);
		}
	});

	await t.test('the response hygiene headers are present on every response', async () => {
		// The CSP is what ENFORCES the offline claim — no CDN, no remote font, no telemetry — and
		// it is also what stands between agent-authored memory text and script running inside the
		// origin that holds the token to the whole vault.
		for (const path of ['/', '/api/session', '/api/memories']) {
			const response = await authorised(sidecar, { path });
			assert.equal(response.status, 200, `${path} did not serve`);
			const csp = response.headers['content-security-policy'];
			assert.ok(csp, `${path} carries no Content-Security-Policy (PRD 0001 R27)`);
			assert.match(csp, /default-src\s+'none'/, `${path}: the CSP does not default to none`);
			assert.match(csp, /frame-ancestors\s+'none'/, `${path}: the CSP permits framing`);
			assert.equal(
				response.headers['x-content-type-options'],
				'nosniff',
				`${path} carries no nosniff`,
			);
			assert.equal(
				response.headers['referrer-policy'],
				'no-referrer',
				`${path} carries no Referrer-Policy: no-referrer`,
			);
			assert.equal(
				response.headers['set-cookie'],
				undefined,
				`${path} set a cookie. The token is header-only (PRD 0001 R25).`,
			);
		}
	});

	await t.test('the listener is not reachable off loopback', async () => {
		// What CAN be asserted portably, in three parts, and the part that cannot is named below
		// rather than left to look covered.
		//
		// 1. The address the server actually bound, read back from the socket.
		assert.equal(
			sidecar.boundAddress,
			'127.0.0.1',
			`The sidecar bound ${sidecar.boundAddress}. It binds 127.0.0.1 explicitly — never ` +
				`0.0.0.0, never :: (PRD 0001 R22). There is no --host flag, because there is no ` +
				`authentication layer to put in front of a user's memory.`,
		);

		// 2. A real TCP connect to every non-loopback address this machine actually has. This is
		//    the assertion with teeth: a server bound to 0.0.0.0 accepts these and a server bound
		//    to 127.0.0.1 refuses them, and no amount of reading configuration proves which.
		const external = Object.values(networkInterfaces())
			.flat()
			.filter((entry) => entry && !entry.internal && entry.family === 'IPv4')
			.map((entry) => entry.address);

		for (const address of external) {
			const reachable = await new Promise((resolve) => {
				const socket = tcpConnect({ host: address, port: sidecar.port });
				const settle = (value) => {
					socket.destroy();
					resolve(value);
				};
				socket.setTimeout(2_000, () => settle(false));
				socket.on('connect', () => settle(true));
				socket.on('error', () => settle(false));
			});
			assert.equal(
				reachable,
				false,
				`The sidecar accepted a TCP connection on ${address}:${sidecar.port}, which is a ` +
					`non-loopback address of this machine. Anything on this network can now read ` +
					`and write this vault, subject only to a token.`,
			);
		}

		// 3. What is NOT covered, stated rather than implied. If this machine has no non-loopback
		//    IPv4 address, part 2 asserted nothing at all, and that must be visible in the output
		//    rather than pass silently — a check with nowhere to look is loudest when it is broken.
		t.diagnostic(
			external.length === 0
				? 'no non-loopback IPv4 address on this machine: the connect probe had nowhere to ' +
						'aim and asserted nothing. Only the bound-address reading covered this run.'
				: `probed ${external.length} non-loopback address(es) on this machine`,
		);

		// Genuinely absent, and no assertion here should be read as covering it: a connection from
		// ANOTHER machine, and IPv6 reachability on a network this machine is not on. Both need a
		// second host, which a single-process test cannot conjure. The bound-address reading plus
		// the local connect probe are the strongest available from inside one machine.
	});

	await t.test('a path traversal in the static route does not escape the asset directory', async () => {
		// The plumbing proof first. If the static route serves nothing at all — an unbuilt SPA —
		// then every probe below 404s for the wrong reason and the whole subtest is vacuous.
		const served = await authorised(sidecar, { path: '/' });
		assert.equal(
			served.status,
			200,
			`The static route serves nothing, so the traversal probes below would all 404 whether ` +
				`or not the route is safe. Build the SPA before believing this assertion.`,
		);

		// Markers read from real files on disk, so a probe that succeeded would be caught by
		// content rather than by a guess about what a leak looks like.
		const outsideMarkers = ['publishConfig', 'devDependencies', 'Apache License', 'openScratchVault'];

		const probes = [
			'/assets/../package.json',
			'/assets/../../package.json',
			'/assets/../../../../../../etc/passwd',
			'/assets/..%2f..%2fpackage.json',
			'/assets/%2e%2e%2f%2e%2e%2fpackage.json',
			'/assets/%252e%252e%252fpackage.json',
			'/assets/....//package.json',
			'/assets/..\\..\\package.json',
			'/assets/./../../LICENSE',
			'/assets/../test/helpers/vault.mjs',
			'/../package.json',
			'/..%2fpackage.json',
			'//package.json',
			'/assets/%00../package.json',
		];

		let reached = 0;
		for (const path of probes) {
			const response = await authorised(sidecar, { path });
			if (response.clientRefused) {
				t.diagnostic(`probe not sendable by node:http, so it proves nothing: ${path}`);
				continue;
			}
			reached += 1;

			assert.ok(
				response.status !== 200,
				`${path} was served with 200. The static route reaches outside the packaged asset ` +
					`directory, which makes this an arbitrary local-file reader wearing a memory ` +
					`browser's clothes.`,
			);
			for (const marker of outsideMarkers) {
				assert.ok(
					!response.body.includes(marker),
					`${path} returned ${response.status} and the body contains "${marker}", which ` +
						`only appears in a file outside the asset directory. The status was a ` +
						`refusal and the content escaped anyway.`,
				);
			}
			assertNoCorsHeader(response, `the traversal probe ${path}`);
		}

		assert.ok(
			reached >= 8,
			`Only ${reached} of ${probes.length} traversal probes actually left this process. The ` +
				`rest were rejected by the HTTP client, so they measured nothing about the server.`,
		);
	});
});

// =============================================================================================
// THE API
// =============================================================================================

test('the API serves the list and one memory, and says no in a shape a screen can render', async (t) => {
	const { engine, scratch, sidecar } = await openSidecarAndVault(t);

	await t.test('the listing is served, and the large derived fields are absent from it', async () => {
		const response = await authorised(sidecar, { path: '/api/memories' });
		assert.equal(response.status, 200, 'the listing did not serve');
		assert.match(
			response.headers['content-type'] ?? '',
			/application\/json/,
			'the listing is application/json and never text/html',
		);

		const payload = json(response);
		assert.ok(Array.isArray(payload.memories), 'the listing carries no `memories` array');
		assert.equal(
			payload.memory_count,
			payload.memories.length,
			'`memory_count` disagrees with the array it counts',
		);
		assert.ok(Array.isArray(payload.stripped_fields), 'the listing declares no `stripped_fields`');

		// THE PLUMBING PROOF, and without it this assertion is the vacuous kind: "no stripped key
		// appears in the payload" is trivially true when nothing was stripped, and a strip that
		// silently stopped working would read exactly the same. So the raw export is read through
		// the engine's own door — the export door, which writes nothing — and the fields are shown
		// to be PRESENT upstream and ABSENT downstream.
		const raw = await call(
			'memory_lifecycle',
			{ mode: 'export' },
			{ enginePath: engine.path, root: scratch.root, timeoutMs: 120_000 },
		);
		const upstream = new Set();
		for (const record of raw.data?.payload?.memories ?? []) {
			for (const key of Object.keys(record?.semantic ?? {})) upstream.add(key);
		}

		for (const field of payload.stripped_fields) {
			assert.ok(
				upstream.has(field),
				`The listing claims it stripped "${field}", and the engine's own export does not ` +
					`carry that key at all. \`stripped_fields\` must be computed from what was ` +
					`actually dropped, not written down — a claimed strip of an absent field is a ` +
					`disclosure that describes a payload nobody produced.`,
			);
		}

		assert.ok(
			payload.stripped_fields.length > 0,
			`Nothing was stripped, so every assertion below is vacuous. The keys the export ` +
				`carries on a record are: ${[...upstream].sort().join(', ') || '(none)'}. Either ` +
				`this vault holds no record with a derived field on it — in which case point ` +
				`KALEIDOSCOPE_TEST_VAULT at one that does — or the strip stopped running.`,
		);

		// Absent ANYWHERE in the CARRIED DATA, not merely absent from the top level of each record:
		// a nested copy is the same bytes crossing the same socket into the same browser heap.
		//
		// Scanned over the data the response carries rather than over the whole response, and the
		// exception is not a loophole: `stripped_fields` is the DECLARATION of the strip and it has
		// to name the fields, so a scan of the raw body reports the disclosure as the leak. The
		// declaration is `payload.stripped_fields` and it is asserted above; everything else the
		// response carries is scanned here.
		const { stripped_fields: _declaration, ...carried } = payload;
		const carriedText = JSON.stringify(carried);
		for (const field of payload.stripped_fields) {
			assert.ok(
				!carriedText.includes(`"${field}"`),
				`The stripped key "${field}" still appears somewhere in what the listing carries.`,
			);
		}
	});

	await t.test('one memory is served by id', async () => {
		const id = await anyMemoryId(sidecar);
		const response = await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(id)}` });
		assert.equal(response.status, 200, `GET /api/memories/${id} did not serve`);
		assert.match(response.headers['content-type'] ?? '', /application\/json/);

		const body = json(response);
		const record = body.memory ?? body.data ?? body;
		assert.equal(
			record.memory_id ?? record.id,
			id,
			'the detail response is for a different memory than the one asked for',
		);

		// The detail view and the row read the same cached record, so they cannot disagree — and
		// the strip has to hold here too, or the bytes come back one memory at a time instead.
		const listing = json(await authorised(sidecar, { path: '/api/memories' }));
		// Same exception, same reason: this response declares the strip too, and a declaration is
		// not a leak. See the note on the listing above.
		const { stripped_fields: _declaration, ...carried } = body;
		const carriedText = JSON.stringify(carried);
		for (const field of listing.stripped_fields ?? []) {
			assert.ok(
				!carriedText.includes(`"${field}"`),
				`The detail response reintroduces the stripped key "${field}".`,
			);
		}
	});

	await t.test('an unknown id is a clean 404 with a useful message', async () => {
		// Two shapes, and both are ordinary: an id of exactly the right form that names nothing —
		// a stale link, a memory since removed — and a string that was never an id at all.
		const real = await anyMemoryId(sidecar);
		for (const id of [absentIdLike(real, await listedMemoryIds(sidecar)), 'not-an-id-at-all']) {
			const response = await authorised(sidecar, { path: `/api/memories/${id}` });
			assert.equal(response.status, 404, `an unknown id got ${response.status}, not 404`);
			assert.match(
				response.headers['content-type'] ?? '',
				/application\/json/,
				'a 404 on an API route is JSON, never text/html',
			);
			assert.ok(response.body.length > 0, 'the 404 has an empty body');

			const body = json(response);
			const message = body.message ?? body.error?.message ?? body.reason ?? '';
			assert.ok(
				typeof message === 'string' && message.length > 0,
				`the 404 carries no message. Its keys are: ${Object.keys(body).join(', ')}`,
			);
			assert.ok(
				message.includes(id),
				`the 404 message does not name the id that was not found, so a user with a stale ` +
					`link cannot tell which one it was: ${JSON.stringify(message)}`,
			);
			assert.ok(
				!message.includes(scratch.root),
				'the 404 message discloses the vault path on disk',
			);
		}
	});

	await t.test('an unknown route is a clean 404 and not a directory listing', async () => {
		const response = await authorised(sidecar, { path: '/api/call' });
		assert.equal(
			response.status,
			404,
			`POST-shaped or not, /api/call must not exist. A generic passthrough hands back every ` +
				`rule in the door map, including the ranked door (PRD 0001 R19).`,
		);
		assert.ok(!/<a href=/i.test(response.body), 'the 404 rendered a directory listing');
	});
});

test('an engine refusal reaches the browser as structured JSON, not as a 500', async (t) => {
	// PROVOKED against the real engine rather than stubbed, because the refusal that matters is the
	// one M1 measured and no document predicts: exit 2 with stdout EMPTY and the whole reason on
	// stderr. A client that requires a JSON envelope on stdout reports "unexpected end of JSON
	// input" here, and the user goes off to reinstall a healthy engine.
	//
	// The provocation is to move the cloned vault out from under a running sidecar and ask it to
	// re-export. That is also a real user event: a vault on a volume that unmounted.
	const { scratch, sidecar } = await openSidecarAndVault(t);

	// Warm the cache first, so the refusal below is definitely the re-export refusing and not a
	// cold start failing for a different reason.
	assert.equal((await authorised(sidecar, { path: '/api/memories' })).status, 200);

	const moved = `${scratch.root}-moved-by-the-test`;
	renameSync(scratch.root, moved);
	let response;
	try {
		response = await authorised(sidecar, { path: '/api/memories?refresh=1' });
	} finally {
		renameSync(moved, scratch.root);
	}

	assert.ok(
		response.status < 500,
		`A vault the engine cannot resolve came back as HTTP ${response.status}. The engine ` +
			`completed the call and declined it — that is data the app renders, not an outage. ` +
			`HTTP status describes the sidecar; the envelope describes the engine (PRD 0001 R21).`,
	);
	assert.ok(response.body.length > 0, 'the refusal came back with an empty body');
	assert.match(
		response.headers['content-type'] ?? '',
		/application\/json/,
		'the refusal came back as something other than JSON',
	);

	const body = json(response);
	const outcome = body.outcome ?? body.error?.outcome ?? null;
	assert.equal(
		outcome,
		'refused',
		`The refusal is not discriminated as one. The uniform envelope's \`outcome\` takes ` +
			`exactly applied / refused / applied_in_part / unlicensed, and every screen branches ` +
			`on it. This response's keys are: ${Object.keys(body).join(', ')}`,
	);

	// The engine's own sentence names the remedy. Anything written around it buries the sentence
	// that fixes the problem, and a refusal with no text is a dialog that says "Error".
	const said = [body.reason, body.refusal?.message, body.message, body.error?.message]
		.filter((value) => typeof value === 'string' && value.trim().length > 0)
		.join('\n');
	assert.ok(
		said.length > 0,
		`The refusal carries no human-readable reason, in \`reason\`, \`refusal.message\` or ` +
			`\`message\`. This is the measured exit-2-with-empty-stdout case: the whole of what ` +
			`the engine said arrives on stderr, and a client that only reads stdout renders ` +
			`nothing at all here.`,
	);

	assert.equal(
		body.data ?? null,
		null,
		'a refused call reported `data`, so a screen could render a stale payload as fresh',
	);
});

// =============================================================================================
// THE INVARIANT
// =============================================================================================

test('the whole HTTP surface records no ranked search', async (t) => {
	// M1 asserted this for the four functions in the engine client. It is asserted here for the
	// SERVER, because the server is where the next caller gets added — a filter box wired to the
	// ranked door instead of to the payload already in the browser, or a background poll on
	// something that records that it ran. Both are one line, both look like a feature, and both
	// write a permanent record per keystroke into a store nothing published reads back or removes.
	//
	// Zero callers is the invariant. This is the instrument.
	const { scratch, sidecar } = await openSidecarAndVault(t);

	const before = countExposureRecords(scratch.root);
	assert.ok(
		before.stores > 0,
		`No search-exposure store was found in the clone, so the count below is zero compared ` +
			`against zero and passes hardest when it is broken. Nothing is asserted until the ` +
			`census has somewhere to look.`,
	);
	const fingerprintBefore = fingerprintVault(scratch.root);

	const id = await anyMemoryId(sidecar);
	const listed = await listedMemoryIds(sidecar);

	// Every route the server exposes, with a valid token and a loopback Host. The heartbeat is
	// last because accepting one starts the idle-shutdown clock.
	const surface = [
		['GET', '/'],
		['GET', '/index.html'],
		// Both spellings of the readings. The route table publishes one as an alias of the other,
		// and an alias is a second door: it has to be walked through, not assumed to be the same.
		['GET', '/api/preflight'],
		['GET', '/api/session'],
		['GET', '/api/memories'],
		// The refresh trigger, which is the one that actually spawns a child again.
		['GET', '/api/memories?refresh=1'],
		['GET', `/api/memories/${encodeURIComponent(id)}`],
		['GET', `/api/memories/${encodeURIComponent(id)}/lineage`],
		// The editor's load door, added in M3. It reads through the lineage door and is the most
		// likely place for a "what else is like this?" call to be added, because it is the one read
		// that happens while a person is typing.
		//
		// The WRITE routes are matched here by path alone — `POST /api/memories` collapses onto the
		// listing's path — so they are counted as swept by this test and are not measured by it.
		// The measurement that covers them is the same count taken across a whole create, edit,
		// conflict and partial-save session in `test/editor.test.mjs`, where a write is expected to
		// move the vault and this test's fingerprint assertion could not hold.
		['GET', `/api/memories/${encodeURIComponent(id)}/edit`],
		['GET', '/api/health'],
		['GET', '/api/vocabulary'],
		// The snapshot store's three read doors. They are here for the same reason as everything
		// else on this list — each is a place a "what else is like this?" call could be added — and
		// for one more: this sweep runs against a machine that has never taken a snapshot, so it is
		// also the assertion that LISTING an empty store neither creates it nor spawns anything.
		['GET', '/api/snapshots'],
		['GET', '/api/snapshots/20200101T000000000Z-abcdef012345'],
		['GET', `/api/memories/${encodeURIComponent(id)}/snapshots`],
		// The curation backlog's dismissal store, added in M5. It reads a file in this app's own
		// state directory and reaches no engine at all — which is exactly why it belongs on this
		// list: a screen that shows several hundred findings about a vault is the most tempting
		// place in the product to add "and here is what a real search would say about them", and
		// that call would write an exposure row per finding. The POST collapses onto this path and
		// is counted as swept; its own behaviour is asserted in `test/backlog.test.mjs`.
		['GET', '/api/dismissals'],
		// The removal run, walked with GET so it answers 405 rather than removing anything.
		//
		// That is a real exercise of the PATH, which is what this sweep is about: it proves the route
		// exists, that the method allowlist refuses everything but the one method it publishes, and —
		// the point of the whole list — that nothing reachable at that path spawns a ranked query. What
		// the route DOES is measured where a write is expected to move the vault and this test's
		// fingerprint assertion could not hold: `test/removal.test.mjs`, which counts the exposure
		// records across a whole run.
		['GET', '/api/removals'],
		// The two curation runs, added in M6, walked the same way and for a sharper version of the
		// same reason. Neither is an engine operation — the published surface has no merge and no
		// rename — so both are composed here out of N updates and a delete, and BOTH are one line
		// away from the tempting mistake this sweep exists to catch: a "find the memories that are
		// probably duplicates of this one" call, which is a ranked query per memory against the
		// vault it is about to rewrite. What the routes DO is measured in `test/merge.test.mjs`,
		// which counts exposure records across a whole preview, run, resume and merge.
		['GET', '/api/renames'],
		['GET', '/api/merges'],
		// The half-finished-merge record. It reads a file in this app's own state directory and
		// reaches no engine at all — and, like the dismissal store, that is exactly why it is here:
		// a banner about two memories is the obvious place to add "and here is what they have in
		// common". The POST collapses onto this path and is counted as swept.
		['GET', '/api/pending-merge'],
		// The routes a user reaches by mistake, which is where an ad-hoc "let me just look it up"
		// fallback would live.
		['GET', `/api/memories/${absentIdLike(id, listed)}`],
		['GET', '/api/no-such-route'],
		['GET', '/no-such-asset.js'],
	];

	const exercised = new Set();
	for (const [method, path] of surface) {
		const response = await authorised(sidecar, { method, path });
		exercised.add(path.split('?')[0]);
		assert.ok(
			response.status < 500,
			`${method} ${path} returned ${response.status}. A route that faults cannot be said to ` +
				`have been exercised, and this test's claim is that EVERY route was.`,
		);
	}

	// The heartbeat never ends by design, so only its headers are taken.
	const heartbeat = await authorised(sidecar, {
		path: '/api/heartbeat',
		headersOnly: true,
		timeoutMs: 5_000,
	});
	exercised.add('/api/heartbeat');
	assert.ok(heartbeat.status < 500, `the heartbeat stream returned ${heartbeat.status}`);

	// "Every route" is a claim that rots as the surface grows, so it is checked against the
	// server's own table where the server publishes one. Without that, the list above is a
	// transcription and the next route added is silently unmeasured.
	if (Array.isArray(sidecar.routes)) {
		const missed = sidecar.routes
			.map((route) => (typeof route === 'string' ? route : (route.path ?? route.pattern)))
			.filter(Boolean)
			.filter((pattern) => {
				// A published path is matched SEGMENT BY SEGMENT, with `:name` standing for exactly
				// one segment. The obvious version — strip the parameters and test a prefix — is
				// wrong for a route whose parameter is not last: `/api/memories/:memory_id/lineage`
				// collapses to `/api/memories//lineage`, which no exercised path starts with, so a
				// route this test really does walk through is reported as missed. And the same
				// arithmetic in the other direction is worse: `/api/memories/:memory_id` collapses
				// to a prefix of `/api/memories`, so a per-memory route would count as exercised by
				// the listing alone. Neither error is visible from the assertion's message.
				const source = String(pattern)
					.split('/')
					.map((segment) =>
						segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
					)
					.join('/');
				const re = new RegExp(`^${source}$`);
				return ![...exercised].some((path) => re.test(path));
			});
		assert.deepEqual(
			missed,
			[],
			`The sidecar publishes routes this test never exercised: ${missed.join(', ')}. Every ` +
				`one of them is a place a ranked-search caller could be added without this ` +
				`assertion noticing.`,
		);
	} else {
		t.diagnostic(
			'the sidecar publishes no route table, so "every route" is this file\'s list rather ' +
				'than a checked claim; a route added in M3 will not be exercised until it is added here',
		);
	}

	const after = countExposureRecords(scratch.root);
	assert.equal(
		after.records,
		before.records,
		`The HTTP surface wrote ${after.records - before.records} search-exposure record(s). ` +
			`M2 has zero callers of the ranked door and this is the measurement that keeps that ` +
			`true. A record here means some route reached ranked search: the record is permanent, ` +
			`it stores the query text verbatim, and nothing published reads it back or removes one.`,
	);

	// Strictly stronger than the count, and separate from it on purpose: a route that wrote
	// something OTHER than an exposure row — a cache file, a lock, a rebuilt index — moves this and
	// not the count above, and the two failures have different causes and different fixes.
	const fingerprintAfter = fingerprintVault(scratch.root);
	assert.equal(
		fingerprintAfter.digest,
		fingerprintBefore.digest,
		`Reading the whole HTTP surface changed ${fingerprintAfter.files - fingerprintBefore.files} ` +
			`file(s) in the vault (${fingerprintBefore.files} before, ${fingerprintAfter.files} ` +
			`after). The exposure count did not move, so this is not a ranked search — it is a read ` +
			`path that has quietly become a write path some other way.`,
	);
});

test('no endpoint accepts a parameter naming a vault, a root, a profile or a path', async (t) => {
	// A `root` parameter is the difference between a memory browser and an arbitrary local-file
	// reader, and it is the single easiest thing to add "just for the tests".
	const { engine, scratch, sidecar } = await openSidecarAndVault(t);

	const clean = await authorised(sidecar, { path: '/api/memories' });
	assert.equal(clean.status, 200);

	const elsewhere = encodeURIComponent('/');
	for (const name of ['root', 'vault', 'path', 'profile', 'dir', 'cwd', 'workspace', 'kscope', 'engine']) {
		const response = await authorised(sidecar, {
			path: `/api/memories?${name}=${elsewhere}`,
		});
		// Two acceptable answers and one unacceptable one. Refusing the request outright is the
		// stronger behaviour — it tells the caller the parameter is not a thing — and ignoring it
		// is the sufficient one. Serving a DIFFERENT payload is the failure: it means the parameter
		// reached something, and a parameter that names a root is the difference between a memory
		// browser and an arbitrary local-file reader.
		const ignored = response.status === 200 && response.body === clean.body;
		const refused = response.status >= 400 && response.status < 500;
		assert.ok(
			ignored || refused,
			`GET /api/memories?${name}=… came back ${response.status} with a payload that differs ` +
				`from the unparameterised request. The vault is fixed at launch and is not a ` +
				`parameter of any endpoint (PRD 0001 R20).`,
		);
	}

	// And the engine still resolves the vault this test created, from the environment this test
	// set — the fuzzing above must not have moved it, and asking the engine is the only way to
	// know that rather than to assume it.
	const reading = readVaultAddress({ enginePath: engine.path, root: scratch.root });
	assert.equal(reading.root, scratch.root, 'the resolved vault moved under the fuzzing above');
});
