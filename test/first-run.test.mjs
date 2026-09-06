// The first run, on a machine where the engine is not there.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS ABOUT, AND WHY IT IS NOT A COPY TEST
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// A missing engine used to be a terminal refusal: the launcher printed a good message and exited,
// and the browser never opened. The words were right and the CHANNEL was wrong. Somebody who typed
// `npx` is walking to a browser; a terminal cannot show them a copy button, and it cannot re-check
// without being typed again. So the absence became a screen, and the properties that make a screen
// possible are the ones asserted here:
//
//   * the server BINDS ANYWAY. A missing engine is a state the app displays. The only condition
//     that may still fail the launch is a socket that would not bind;
//   * `/api/engine` reports the absence WITH THE TRAIL — every place the search actually looked,
//     in order. A person told only "not found" cannot tell a search that never reached PATH from
//     one that read it and came back empty, and those two have opposite remedies;
//   * `/api/engine/recheck` RUNS THE SEARCH AGAIN IN THE PROCESS THAT IS ALREADY BOUND, and on
//     success the whole app is there on the same socket with the same token. This is the reason
//     the screen exists at all; without it the button is a reload with extra steps;
//   * a NAMED path that fails reports the stopped search rather than an empty one. Steps 1 and 2
//     of the resolver are authoritative and terminal, and a screen that offered to go hunting
//     after a named path failed would be describing a search this product does not perform;
//   * NONE OF IT TOUCHES THE VAULT. The screen says so in as many words, so it is measured rather
//     than asserted in prose: a fingerprint of every file in the clone, before and after.
//
// THE ABSENCE IS REAL, NOT MOCKED. Every `EngineNotFoundError` below comes out of `locateEngine`
// itself, driven with an environment that has no engine anywhere in it. If it ever comes back
// having FOUND one, this file fails loudly with a sentence saying so rather than skipping: a test
// that quietly stands down because it could not arrange the state it measures is a test that
// reports green for a feature nobody has run.
//
// ARRANGING THAT ABSENCE TAKES MORE THAN AN EMPTY PATH, and this is the thing to understand before
// changing `arrangeAbsence`. The resolver searches three package directories before it reads PATH
// at all, and on an ordinary developer machine at least two of them hold an engine:
//
//   * `<this package>/node_modules/.bin` — where npm puts the engine, which ships as an OPTIONAL
//     dependency of this package. That is not an accident to work around: it is the single reason
//     `npx @kleos-research/kaleidoscope-ui` works with nothing else installed;
//   * the directory the running Node is in — and `npm install -g` puts both programs in the same
//     prefix, so a globally installed engine sits beside the globally installed Node.
//
// Neither can be emptied from inside a test run, and neither should be: emptying the first would be
// this file uninstalling a dependency, and the second is somebody's `/usr/local/bin`. So the
// absence is arranged by moving the SEARCH rather than the machine — the real resolver is loaded
// from a package root that has no `node_modules`, with the two process facts it reads pointed at
// empty directories and PATH pointing at a third. Every place it looks is then a real directory it
// really read, and the refusal it produces is its own.
//
// Everything runs against a clone, because the successful re-check takes real readings.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { EngineNotFoundError, INSTALL_COMMAND, ENGINE_ENV_VAR } from '../src/engine/errors.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { startSidecar } from '../src/server/index.mjs';
import { countExposureRecords, fingerprintVault, openScratchVault } from './helpers/vault.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_LOCATE = resolve(HERE, '..', 'src', 'engine', 'locate.mjs');
const REAL_ERRORS = resolve(HERE, '..', 'src', 'engine', 'errors.mjs');

// ---------------------------------------------------------------------------------------------
// arranging a real absence
// ---------------------------------------------------------------------------------------------

/**
 * The real resolver, loaded from a package root with no engine under it.
 *
 * `locate.mjs` derives one of its three package directories from its OWN location — this package's
 * `node_modules/.bin`, which is where the optional dependency puts the engine. Loading the same
 * source from a throwaway root moves that one directory somewhere that has no `node_modules`, which
 * is the only way to arrange the absence without uninstalling anything.
 *
 * ONE LINE OF THE SOURCE IS REWRITTEN AND IT IS THE IMPORT OF `errors.mjs`, repointed at the real
 * file. That matters for a reason beyond tidiness: the server classifies the refusal it is handed
 * with `instanceof EngineNotFoundError`, so a second copy of the error module would produce an
 * error of a different class and the server would report `readings-failed` — the test would pass
 * on a screen the product never shows. Everything else is byte-for-byte the shipped resolver, read
 * off disk at run time, so it cannot drift from what ships.
 */
let resolverInEmptyRoot = null;
async function loadResolverInEmptyRoot() {
	if (resolverInEmptyRoot) return resolverInEmptyRoot;
	const root = mkdtempSync(join(tmpdir(), 'ui-first-run-root-'));
	const dir = join(root, 'src', 'engine');
	mkdirSync(dir, { recursive: true });
	const source = readFileSync(REAL_LOCATE, 'utf8').replace(
		"from './errors.mjs'",
		`from ${JSON.stringify(pathToFileURL(REAL_ERRORS).href)}`,
	);
	assert.ok(
		source.includes(pathToFileURL(REAL_ERRORS).href),
		'The resolver no longer imports ./errors.mjs the way this rewrite expects.',
	);
	const file = join(dir, 'locate.mjs');
	writeFileSync(file, source);
	resolverInEmptyRoot = await import(pathToFileURL(file).href);
	// The module is loaded and held; the file it came from has no further job. Removed here rather
	// than in an `after` hook so nothing is left behind by a run that fails in the middle.
	rmSync(root, { recursive: true, force: true });
	return resolverInEmptyRoot;
}

/**
 * Run the real resolver against an environment that has no engine in it, and hand back the real
 * refusal.
 *
 * Three empty directories, one per place the resolver reads that this test can move: the one the
 * running script sits in, the one the running Node sits in, and PATH. Each is a directory that
 * EXISTS and is empty rather than a path that is absent, so the trail proves the search READ each
 * place and came back empty instead of proving it skipped one — the two states produce the same two
 * words and want opposite remedies, which is the whole reason the trail is published.
 *
 * `process.argv[1]` and `process.execPath` are moved for the duration of the call and put back in a
 * `finally`. Nothing else in this file, or in any file that runs beside it, reads either one.
 */
async function arrangeAbsence({ explicit } = {}) {
	const { locateEngine: locateInEmptyRoot } = await loadResolverInEmptyRoot();
	const holder = mkdtempSync(join(tmpdir(), 'ui-first-run-nowhere-'));
	const beside = { script: join(holder, 'script'), node: join(holder, 'node'), path: join(holder, 'path') };
	for (const place of Object.values(beside)) mkdirSync(place, { recursive: true });

	const realArgv1 = process.argv[1];
	const realExecPath = process.execPath;
	process.argv[1] = join(beside.script, 'kaleidoscope-ui.mjs');
	process.execPath = join(beside.node, 'node');

	try {
		const found = await locateInEmptyRoot({ explicit, env: { PATH: beside.path } }).then(
			(engine) => engine,
			(error) => {
				assert.ok(
					error instanceof EngineNotFoundError,
					`The resolver refused with ${error?.name}, not EngineNotFoundError.`,
				);
				return error;
			},
		);
		if (!(found instanceof EngineNotFoundError)) {
			throw new Error(
				`This test needs a search that finds no engine, and the resolver found one at ` +
					`${found.path} through ${found.source}. The absence it measures could not be ` +
					`arranged, so it is failing rather than skipping.`,
			);
		}
		return found;
	} finally {
		process.argv[1] = realArgv1;
		process.execPath = realExecPath;
		rmSync(holder, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------------------------
// one HTTP client, carrying the same posture the app does
// ---------------------------------------------------------------------------------------------

/**
 * A request with the app's own headers.
 *
 * The Host and Origin are spelled here rather than left to Node's defaults because they are
 * CONTROLS: the sidecar checks Host before routing and requires a matching Origin on every method
 * that is not GET or HEAD. A helper that omitted them would be testing a server that answers
 * requests the real app cannot make.
 */
function ask(sidecar, { method = 'GET', path, token, body = null, host, origin } = {}) {
	const authority = host ?? `127.0.0.1:${sidecar.port}`;
	const headers = { host: authority, accept: 'application/json' };
	if (token !== null && token !== undefined) headers.authorization = `Bearer ${token}`;
	let payload;
	if (body !== null) {
		payload = JSON.stringify(body);
		headers['content-type'] = 'application/json';
		headers['content-length'] = Buffer.byteLength(payload);
	}
	// Sent when the caller asks for one, and when a body makes this a state-changing request. It is
	// deliberately ABSENT otherwise: a page that has rebound a DNS name to loopback believes it is
	// same-origin and sends none at all, which is the case the Host check exists for, and a helper
	// that always sent one could not pose it.
	if (origin !== undefined || payload !== undefined) {
		headers.origin = origin ?? `http://127.0.0.1:${sidecar.port}`;
	}

	return new Promise((settle, fail) => {
		const req = httpRequest(
			{ host: '127.0.0.1', port: sidecar.port, method, path, headers },
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					text += chunk;
				});
				res.on('end', () => {
					let json = null;
					try {
						json = JSON.parse(text);
					} catch {
						json = null;
					}
					settle({ status: res.statusCode, headers: res.headers, text, json });
				});
			},
		);
		req.on('error', fail);
		if (payload !== undefined) req.write(payload);
		req.end();
	});
}

// ---------------------------------------------------------------------------------------------
// the tests
// ---------------------------------------------------------------------------------------------

test('the first-run screen: an absent engine is served, not thrown', async (t) => {
	const absence = await arrangeAbsence();

	// The clone ritual needs the engine — it makes the engine say, through its own door, which vault
	// it resolved. That is not a contradiction of the absence being measured: what is absent is the
	// SERVER'S view of the engine, arranged with the resolver's own refusal, and the vault this test
	// then proves untouched has to be a clone like every other one in this suite.
	const engine = await locateEngine();
	const scratch = openScratchVault({ enginePath: engine.path, label: 'first-run' });
	t.after(() => scratch.close());

	// NO `readings` AND NO `enginePath`. This is the launcher's setup path exactly: the refusal it
	// caught, handed over, and nothing else.
	const sidecar = await startSidecar({
		engineError: absence,
		root: scratch.root,
		port: 0,
		appVersion: '0.0.0-test',
	});
	t.after(async () => {
		try {
			await sidecar.close();
		} catch {
			// A close that fails must not mask the assertion that failed before it.
		}
	});

	const before = fingerprintVault(scratch.root);
	const exposureBefore = countExposureRecords(scratch.root);

	await t.test('it bound, and it published a launch URL with a token in the fragment', () => {
		assert.ok(sidecar.port > 0, 'The server did not bind a port.');
		assert.equal(sidecar.address, '127.0.0.1', 'The server bound somewhere other than loopback.');
		assert.match(
			sidecar.launchUrl,
			/^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]+$/,
			'The launch URL is not the loopback URL with a token in the fragment.',
		);
		// The readings are the thing that is absent. Anything derived from them is null rather than
		// a made-up value, because a launcher that printed a snapshot directory on a session with no
		// engine would be naming a store nothing opened.
		assert.equal(sidecar.readings, null, 'A session with no engine reported readings.');
		assert.equal(sidecar.snapshots, null, 'A session with no engine opened a snapshot store.');
		assert.equal(sidecar.compatibility, null, 'A session with no engine assessed compatibility.');
	});

	await t.test('it serves the page', async () => {
		const page = await ask(sidecar, { path: '/', token: null });
		// 200 with the built page, or 404 with the sentence naming the directory and the command —
		// which is what a source checkout with no `npm run build` gets. Both are the server SERVING.
		// What may not happen is a refusal, an empty body, or a crash.
		assert.ok([200, 404].includes(page.status), `The page route answered ${page.status}.`);
		assert.ok(page.text.length > 0, 'The page route answered with an empty body.');
		assert.equal(
			page.headers['access-control-allow-origin'],
			undefined,
			'A CORS header appeared on the setup screen.',
		);
	});

	await t.test('the status route reports it missing, with the trail', async () => {
		const status = await ask(sidecar, { path: '/api/engine', token: sidecar.token });
		assert.equal(status.status, 200, `/api/engine answered ${status.status}.`);

		const engine = status.json;
		assert.equal(engine.present, false, '/api/engine says an engine is present.');
		assert.equal(engine.kind, 'nothing-found', `/api/engine reported kind ${engine.kind}.`);
		assert.equal(engine.install_command, INSTALL_COMMAND, 'The install command is not the one.');
		assert.equal(engine.environment_variable, ENGINE_ENV_VAR, 'The variable named is not the one.');
		assert.equal(engine.can_set_path, true, 'The screen was told it may not name a path.');

		// THE TRAIL IS THE EVIDENCE. It has to reach PATH, and every row has to say where.
		assert.ok(engine.looked.length > 0, '/api/engine published an empty search trail.');
		for (const place of engine.looked) {
			assert.equal(typeof place.where, 'string', 'A trail row carries no description.');
			assert.ok(place.where.length > 0, 'A trail row describes nowhere.');
		}
		assert.ok(
			engine.looked.some((place) => place.kind === 'path'),
			'The trail never reached PATH, so it cannot tell a read PATH from a skipped one.',
		);
		assert.ok(
			engine.looked.some((place) => place.kind === 'package'),
			'The trail names no package directory, which is where the optional install lands.',
		);

		// The engine client's own copy, carried whole rather than re-written on this side.
		assert.ok(
			engine.message.includes(INSTALL_COMMAND),
			'The message does not name the install command.',
		);
	});

	await t.test('every engine-backed route answers 503 with the same description', async () => {
		for (const path of ['/api/preflight', '/api/memories', '/api/health', '/api/dismissals']) {
			const answer = await ask(sidecar, { path, token: sidecar.token });
			assert.equal(answer.status, 503, `${path} answered ${answer.status}, not 503.`);
			assert.equal(
				answer.json?.error?.kind,
				'engine-not-found',
				`${path} did not name the missing engine as the reason.`,
			);
			// The page opens the setup screen off this payload, so the trail has to be on it.
			assert.ok(
				(answer.json?.error?.engine?.looked ?? []).length > 0,
				`${path} refused without saying where the search looked.`,
			);
		}
	});

	await t.test('the setup routes carry the same security posture as every other route', async () => {
		const noToken = await ask(sidecar, { path: '/api/engine', token: null });
		assert.equal(noToken.status, 401, 'The status route answered an unauthenticated request.');

		const wrongToken = await ask(sidecar, {
			path: '/api/engine',
			token: 'x'.repeat(sidecar.token.length),
		});
		assert.equal(wrongToken.status, 401, 'The status route accepted a wrong token.');

		// The rebinding defence, measured WITH a correct token so it does not inherit the token
		// check's pass. A page that rebinds a name to loopback sends no Origin at all.
		const hostileHost = await ask(sidecar, {
			path: '/api/engine',
			token: sidecar.token,
			host: 'evil.example',
		});
		assert.equal(hostileHost.status, 403, 'The status route answered a request for another Host.');

		const crossOrigin = await ask(sidecar, {
			method: 'POST',
			path: '/api/engine/recheck',
			token: sidecar.token,
			body: {},
			origin: 'http://evil.example',
		});
		assert.equal(crossOrigin.status, 403, 'The re-check route answered a cross-origin POST.');

		// A CORS preflight, posed the way a browser poses one — from a matching origin, so it gets
		// past the Origin check and reaches the method allowlist. Answering OPTIONS at all is the
		// first half of granting a cross-origin request.
		const preflight = await ask(sidecar, {
			method: 'OPTIONS',
			path: '/api/engine',
			token: sidecar.token,
			origin: sidecar.origin,
		});
		assert.equal(preflight.status, 405, 'The server answered a CORS preflight.');
		assert.equal(
			preflight.headers['access-control-allow-origin'],
			undefined,
			'A CORS header appeared on the setup routes.',
		);
	});

	await t.test('a named path that fails reports the stopped search, not an empty one', async () => {
		const broken = join(scratch.state_dir, 'not-an-engine');
		const answer = await ask(sidecar, {
			method: 'POST',
			path: '/api/engine/recheck',
			token: sidecar.token,
			body: { engine_path: broken },
		});
		assert.equal(answer.status, 200, `A failed re-check answered ${answer.status}, not 200.`);

		const engine = answer.json;
		assert.equal(engine.present, false, 'A path that does not exist was reported as an engine.');
		assert.equal(engine.kind, 'named-unusable', `The re-check reported kind ${engine.kind}.`);
		assert.equal(engine.named?.path, broken, 'The refusal names a different path.');
		// THE SENTENCE THAT MAKES IT THE OTHER CASE. A named path is authoritative and terminal, so
		// the search stopped there rather than running some other program — and the screen must not
		// offer to go hunting after it.
		assert.match(
			engine.message,
			/nothing else was tried/,
			'The refusal does not say the search stopped at the named path.',
		);
		assert.equal(engine.looked.length, 1, 'A stopped search published more than one place.');
	});

	await t.test('none of that read, wrote or changed anything in the vault', () => {
		const after = fingerprintVault(scratch.root);
		assert.equal(after.files, before.files, 'The setup screen changed the number of files.');
		assert.equal(
			after.digest,
			before.digest,
			'The setup screen changed the vault. It says in as many words that it does not.',
		);
		const exposureAfter = countExposureRecords(scratch.root);
		assert.equal(
			exposureAfter.records,
			exposureBefore.records,
			'The setup screen recorded a search exposure.',
		);
	});
});

test('the first-run screen: Check again finds the engine and the app is there', async (t) => {
	const absence = await arrangeAbsence();

	// The engine this machine actually has — resolved through the real door, so what the re-check
	// is handed is a path a user could have typed and not one this test invented.
	const engine = await locateEngine();

	const scratch = openScratchVault({ enginePath: engine.path, label: 'first-run-recheck' });
	t.after(() => scratch.close());

	const sidecar = await startSidecar({
		engineError: absence,
		root: scratch.root,
		port: 0,
		appVersion: '0.0.0-test',
	});
	t.after(async () => {
		try {
			await sidecar.close();
		} catch {
			// A close that fails must not mask the assertion that failed before it.
		}
	});

	const token = sidecar.token;
	const origin = sidecar.origin;
	const exposureBefore = countExposureRecords(scratch.root);

	await t.test('the app is not there before the re-check', async () => {
		const before = await ask(sidecar, { path: '/api/preflight', token });
		assert.equal(before.status, 503, 'The readings answered before an engine was found.');
	});

	let found;
	await t.test('the re-check finds it, in the process that is already bound', async () => {
		const answer = await ask(sidecar, {
			method: 'POST',
			path: '/api/engine/recheck',
			token,
			body: { engine_path: engine.path },
		});
		assert.equal(answer.status, 200, `The re-check answered ${answer.status}.`);
		found = answer.json;
		assert.equal(found.present, true, 'The re-check did not find the engine it was handed.');
		assert.equal(found.rechecked, true, 'The re-check did not report that it ran.');
		assert.equal(found.engine.path, engine.path, 'The re-check resolved a different program.');
		assert.deepEqual(found.launch_blockers, [], 'This machine cannot use its own engine.');
		// NOTHING MOVED. The whole point of re-checking in place is that the tab keeps the
		// credential it read from the fragment at startup — a new port or a new token would send
		// the person back to a terminal they have already left.
		assert.equal(sidecar.port > 0, true, 'The server lost its port.');
		assert.equal(sidecar.origin, origin, 'The re-check moved the server to another origin.');
		assert.equal(sidecar.token, token, 'The re-check minted a new token.');
	});

	await t.test('and the whole app is there, on the same socket, with the same token', async () => {
		const readings = await ask(sidecar, { path: '/api/preflight', token });
		assert.equal(readings.status, 200, `/api/preflight answered ${readings.status} after the find.`);
		assert.equal(
			readings.json.vault.root,
			scratch.root,
			'The equipped app resolved a different vault.',
		);
		assert.ok(readings.json.vocabulary?.fields, 'The equipped app carries no vocabulary.');

		const listing = await ask(sidecar, { path: '/api/memories', token });
		assert.equal(listing.status, 200, `/api/memories answered ${listing.status} after the find.`);

		// The routes the setup screen could not reach are now in the table, and the two setup routes
		// are still in it — a page that is already open must be able to ask what happened.
		const paths = sidecar.routes.map((route) => route.path);
		assert.ok(paths.includes('/api/memories'), 'The app routes did not arrive.');
		assert.ok(paths.includes('/api/engine'), 'The setup routes left the table.');

		// The stores the app is assembled from are open, and they are the same objects the write
		// path uses rather than second copies built for the occasion.
		assert.ok(sidecar.snapshots?.directory, 'The snapshot spine did not open.');
		assert.ok(sidecar.compatibility?.tier, 'Compatibility was never assessed.');
	});

	await t.test('once an engine is in hand, the page can no longer name a program', async () => {
		const again = await ask(sidecar, {
			method: 'POST',
			path: '/api/engine/recheck',
			token,
			body: { engine_path: '/definitely/not/here/kscope' },
		});
		assert.equal(again.status, 200, `A settled re-check answered ${again.status}.`);
		assert.equal(again.json.rechecked, false, 'A settled session ran the search again.');
		assert.equal(again.json.present, true, 'A settled session forgot the engine it had.');
		assert.equal(again.json.can_set_path, false, 'A settled session still offers to be re-pointed.');
		assert.equal(again.json.engine.path, engine.path, 'A settled session changed its engine.');
	});

	await t.test('nothing along that path recorded a ranked search', () => {
		const exposureAfter = countExposureRecords(scratch.root);
		assert.equal(
			exposureAfter.records,
			exposureBefore.records,
			'Finding the engine and loading the app recorded a search exposure.',
		);
	});
});
