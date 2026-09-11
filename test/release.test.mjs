// M8: the release test — the tarball, installed somewhere else, running.
//
// Every other test in this suite runs the source tree. That is the wrong instrument for the one
// failure this milestone is about: a `files` allowlist that omits something the running program
// imports. The source tree has every file in it, so a suite of two hundred tests passes with a
// tarball that cannot start — and it is the commonest way a prebuilt package ships broken, because
// the defect is created by the manifest and can only be observed after the manifest is applied.
//
// So this test does the only thing that can see it: `npm pack`, install THE TARBALL into a scratch
// directory that is not this repository, run the installed bin from there, and make it serve real
// data. Nothing here imports from `src/` on the path under test — the import graph of the installed
// copy is exercised by running it, which is the point.
//
// Three properties are asserted that a source-tree test cannot reach at all:
//
//   * the tarball's file list is exactly the allowlist and carries no test, no PRD, no screenshot,
//     no browser source that is already compiled into `dist/`, and no executable image;
//   * `npm install <tarball> --offline` adds EXACTLY ONE package. This is the test that
//     `"dependencies": {}` is about; reading the field in this repository's own manifest asserts
//     what someone typed, and this asserts what a user's machine would do with it. `--offline`
//     makes it falsifiable: a declared runtime dependency fails the install rather than quietly
//     downloading, so a green run is evidence the install touched no network;
//   * the installed program starts, finds the engine, serves the page, and answers with the
//     memories that are actually in the vault it was pointed at.
//
// THE VAULT IS SYNTHETIC AND THIS REPOSITORY MADE IT. It is not a clone of the developer's, which
// is what the rest of the suite uses: this test asserts on the CONTENT it gets back — the titles
// have to be the titles that went in, or "it served the app" is satisfied by an empty list — and
// asserting on the content of a real vault would put real memories in a public test file.
//
// It is slow by construction: a build, a pack, an install and a process launch. That is what it
// costs to observe the packaged artefact rather than the tree it was made from.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { createSyntheticVault } from '../scripts/synthetic-vault.mjs';
import { countExposureRecords } from './helpers/vault.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The caps from PRD 0007 R6. They are here rather than in the manifest because a size limit that
 * lives beside the thing it limits is a limit that gets raised in the same commit that breaks it.
 */
const MAX_PACKED_BYTES = 700 * 1024;
const MAX_UNPACKED_BYTES = 2.5 * 1024 * 1024;

/** How long the installed launcher gets to print its URL before this test gives up on it. */
const LAUNCH_TIMEOUT_MS = 90_000;

/**
 * What may never be in the tarball, as tests on the path.
 *
 * Written as a DENIAL list for the same reason the vocabulary one is: a stale denial fails safe by
 * refusing something newly permitted, and a stale allow list fails open. The allowlist itself is in
 * `package.json`, and the first assertion below compares the packed set against it — so this table
 * is the second, independent instrument, and it is the one that still fires if someone widens the
 * allowlist to `["."]`.
 */
const MUST_NOT_SHIP = [
	{ name: 'a test', hit: (path) => /(^|\/)test(s)?\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path) },
	{ name: 'a PRD or any other doc', hit: (path) => path.startsWith('docs/') },
	{ name: 'a screenshot or any other image', hit: (path) => /\.(png|jpe?g|gif|webp|svg|mp4)$/i.test(path) },
	{
		name: 'browser source already compiled into dist/',
		// The exception is a licence text, and it is not a loophole. `dist/` REDISTRIBUTES five
		// OFL-licensed font binaries, and the OFL requires its text to travel with them — so the
		// one file under `src/app/` that must ship is the one that makes shipping the rest lawful.
		// NOTICE names this path, and a NOTICE pointing outside the tarball is worse than none.
		// Narrowed to a licence text so every .jsx, .mjs and .css under src/app/ still fails here.
		hit: (path) =>
			path.startsWith('src/app/') && !/^src\/app\/fonts\/LICENSE-[A-Z0-9-]+\.txt$/.test(path),
	},
	{ name: 'a build or tooling configuration', hit: (path) => /^(vite\.config|\.github|scripts|index\.html|package-lock\.json|\.gitignore)/.test(path) },
	{ name: 'an installed dependency tree', hit: (path) => path.includes('node_modules/') },
	{ name: 'a packed tarball', hit: (path) => path.endsWith('.tgz') },
	{ name: 'a vault', hit: (path) => path.includes('.kaleidoscope') || /(^|\/)vault(\/|$)/.test(path) },
];

// ---------------------------------------------------------------------------------------------
// Running things
// ---------------------------------------------------------------------------------------------

function run(command, args, options = {}) {
	const child = spawnSync(command, args, {
		encoding: 'utf8',
		shell: false,
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
	if (child.error) throw child.error;
	// Branch on the exit code, never on stderr. `npm` writes progress to stderr on a clean install
	// and this engine writes the vault it resolved to stderr on a successful call, so a check that
	// reads a non-empty stderr as failure fails on success.
	return { code: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

/** Every file under a directory, as paths relative to it. */
function walk(root, prefix = '') {
	const found = [];
	for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...walk(root, path));
		else found.push(path);
	}
	return found;
}

/** One request against the installed server, with the token the launcher printed. */
function get(origin, path, token) {
	return new Promise((settle, fail) => {
		const url = new URL(path, origin);
		const req = httpRequest(
			{
				host: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method: 'GET',
				headers: token ? { Authorization: `Bearer ${token}`, Origin: origin } : {},
			},
			(res) => {
				const chunks = [];
				res.on('data', (chunk) => chunks.push(chunk));
				res.on('end', () =>
					settle({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
				);
			},
		);
		req.on('error', fail);
		req.end();
	});
}

// ---------------------------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------------------------

test('the packed tarball installs somewhere else and runs there', async (t) => {
	// The engine is located first and the failure is LOUD. A release test that skipped because it
	// could not find an engine would report green for a tarball nobody ran — which is the exact
	// shape of failure this file exists to catch, arriving through the test instead of the package.
	const engine = await locateEngine({});

	// A build is a precondition rather than a step: `dist/` is what the tarball is mostly made of,
	// and packing without it would produce a tarball that is small, tidy and unable to serve a page.
	if (!existsSync(join(REPO, 'dist', 'index.html'))) {
		const built = run('npm', ['run', 'build'], { cwd: REPO });
		assert.equal(built.code, 0, `\`npm run build\` exited ${built.code}:\n${built.stderr}`);
	}

	const holder = mkdtempSync(join(tmpdir(), 'release-test-'));
	const packDir = join(holder, 'pack');
	const scratch = join(holder, 'scratch');
	const vaultDir = join(holder, 'vault');
	const stateDir = join(holder, 'state');
	let server = null;

	t.after(() => {
		if (server && server.exitCode === null) server.kill('SIGTERM');
		rmSync(holder, { recursive: true, force: true });
	});

	for (const directory of [packDir, scratch, stateDir]) mkdirSync(directory, { recursive: true });

	// ---- 1. pack ------------------------------------------------------------------------------

	const packed = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: REPO });
	assert.equal(packed.code, 0, `\`npm pack\` exited ${packed.code}:\n${packed.stderr}`);

	const report = JSON.parse(packed.stdout)[0];
	const tarball = join(packDir, report.filename);
	assert.ok(existsSync(tarball), `npm pack reported ${report.filename} and it is not on disk.`);

	const shipped = report.files.map((file) => file.path).sort();

	await t.test('the tarball is exactly the files allowlist', () => {
		const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
		const allowlist = manifest.files;
		assert.ok(Array.isArray(allowlist) && allowlist.length > 0, 'package.json declares no files array.');

		// npm always adds these three regardless of the allowlist.
		const alwaysIncluded = new Set(['package.json', 'README.md', 'LICENSE']);

		for (const path of shipped) {
			if (alwaysIncluded.has(path)) continue;
			const covered = allowlist.some((entry) => path === entry || path.startsWith(`${entry}/`));
			assert.ok(covered, `${path} is in the tarball and no entry of "files" allows it.`);
		}

		// And the other direction: an allowlist entry that matches nothing is an entry someone
		// renamed the directory out from under. It ships nothing and it reads as though it does.
		for (const entry of allowlist) {
			const matched = shipped.some((path) => path === entry || path.startsWith(`${entry}/`));
			assert.ok(matched, `"files" names ${entry} and nothing in the tarball came from it.`);
		}
	});

	await t.test('nothing on the denial list is in the tarball', () => {
		for (const rule of MUST_NOT_SHIP) {
			const hits = shipped.filter(rule.hit);
			assert.deepEqual(hits, [], `The tarball contains ${rule.name}: ${hits.join(', ')}`);
		}
	});

	await t.test('the tarball is inside the size caps', () => {
		assert.ok(
			report.size <= MAX_PACKED_BYTES,
			`Packed size is ${report.size} bytes, over the ${MAX_PACKED_BYTES}-byte cap.`,
		);
		assert.ok(
			report.unpackedSize <= MAX_UNPACKED_BYTES,
			`Unpacked size is ${report.unpackedSize} bytes, over the ${MAX_UNPACKED_BYTES}-byte cap.`,
		);
	});

	// ---- 2. install into a scratch directory, NOT into this repository -------------------------

	// A manifest of its own, so npm installs INTO this directory rather than walking up and
	// finding this repository's. Without it the tarball would be installed into the tree under
	// test, which is both the wrong place and the one that would make the whole test pass falsely.
	writeFileSync(
		join(scratch, 'package.json'),
		`${JSON.stringify({ name: 'release-scratch', private: true, version: '0.0.0' }, null, 2)}\n`,
	);

	const installed = run(
		'npm',
		[
			'install',
			'--no-audit',
			'--no-fund',
			'--no-save',
			// No lifecycle script may run, and this is how that is checked from the outside: with
			// scripts disabled, an install that still works is an install that needed none.
			'--ignore-scripts',
			// R3's condition: optional dependencies omitted. Installing the UI without them must
			// work completely, because the optional one is a speed-up and never how the engine is
			// obtained.
			'--omit=optional',
			// The whole claim, made falsifiable. A declared runtime dependency fails here instead
			// of being fetched quietly, so a pass is evidence the install touched no network.
			'--offline',
			tarball,
		],
		{ cwd: scratch },
	);
	assert.equal(installed.code, 0, `Installing the tarball exited ${installed.code}:\n${installed.stderr}`);

	const modules = join(scratch, 'node_modules');
	const installedRoot = join(modules, '@kleos-research', 'kaleidoscope-ui');

	await t.test('the install added exactly one package and it installs nothing at run time', () => {
		// Everything under node_modules that is a package: scoped names count once, and npm's own
		// bookkeeping entries (.bin, .package-lock.json) are not packages.
		const packages = [];
		for (const entry of readdirSync(modules, { withFileTypes: true })) {
			if (entry.name.startsWith('.')) continue;
			if (entry.name.startsWith('@')) {
				for (const inner of readdirSync(join(modules, entry.name), { withFileTypes: true })) {
					if (inner.isDirectory()) packages.push(`${entry.name}/${inner.name}`);
				}
				continue;
			}
			if (entry.isDirectory()) packages.push(entry.name);
		}
		assert.deepEqual(
			packages,
			['@kleos-research/kaleidoscope-ui'],
			'Installing this package brought other packages with it. `dependencies` must stay {}.',
		);

		const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
		assert.deepEqual(
			manifest.dependencies ?? {},
			{},
			'The PUBLISHED manifest declares runtime dependencies.',
		);
		for (const hook of ['preinstall', 'install', 'postinstall']) {
			assert.equal(
				manifest.scripts?.[hook],
				undefined,
				`The published manifest carries a ${hook} script. A package that installs a locator ` +
					`for a proprietary engine has to be auditable at a glance.`,
			);
		}
	});

	await t.test('the installed tree contains no test, no PRD and no screenshot', () => {
		// Asserted on the tree that landed rather than on the tarball listing, because these are
		// two different artefacts and only one of them is what a user has on disk.
		const onDisk = walk(installedRoot);
		for (const rule of MUST_NOT_SHIP) {
			const hits = onDisk.filter(rule.hit);
			assert.deepEqual(hits, [], `The installed tree contains ${rule.name}: ${hits.join(', ')}`);
		}
		// Belt and braces on the one class a path pattern can miss: an executable image. The engine
		// is never shipped through this channel and nothing else here is a binary.
		for (const path of onDisk) {
			const bytes = readFileSync(join(installedRoot, path)).subarray(0, 4);
			const magic = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
			assert.ok(
				!['cffaedfe', 'cefaedfe', 'feedfacf', '7f454c46', 'cafebabe'].includes(magic),
				`${path} in the installed tree is an executable image.`,
			);
		}
	});

	// ---- 3. a vault this repository generated --------------------------------------------------

	const vault = await createSyntheticVault({ directory: vaultDir, enginePath: engine.path });
	assert.ok(vault.memories > 0, 'The synthetic vault generator wrote no memories.');

	// THE INSTRUMENT'S OWN CONTROL, run before the app is.
	//
	// A brand-new vault has no exposure store at all — the store is created by the first ranked
	// search — so "zero records after the app ran" would be a pass a broken census produces for
	// free, and it would be loudest exactly when it was most broken. So one ranked search is run
	// HERE, by this test and never through the app, to make the store exist and prove the census
	// can see a record in it. The number the app is then measured against is a non-zero baseline.
	const control = run(engine.path, ['call', 'search'], {
		cwd: scratch,
		env: { ...process.env, KSCOPE_ROOT: vault.root },
		input: JSON.stringify({ query: 'the winter timetable' }),
	});
	assert.equal(control.code, 0, `The control search exited ${control.code}:\n${control.stderr}`);

	const exposureBefore = countExposureRecords(vault.root);
	assert.ok(exposureBefore.stores > 0, 'A ranked search ran and the census found no store: the instrument is broken, not the app.');
	assert.ok(exposureBefore.records > 0, 'A ranked search ran and the census counted no record: the instrument cannot see what it claims to.');

	// ---- 4. run the installed bin from the scratch directory ------------------------------------

	const bin = join(modules, '.bin', 'kaleidoscope-ui');
	assert.ok(existsSync(bin), 'The install produced no kaleidoscope-ui bin entry.');

	const childEnv = {
		...process.env,
		KSCOPE_ROOT: vault.root,
		// The snapshot spine writes outside the vault, under the platform's state directory for
		// this app. Left to itself, this test would file copies into the developer's home.
		KALEIDOSCOPE_UI_STATE_DIR: stateDir,
	};

	await t.test('the installed bin answers --version and --preflight', () => {
		const version = run(bin, ['--version'], { cwd: scratch, env: childEnv });
		assert.equal(version.code, 0, `--version exited ${version.code}:\n${version.stderr}`);
		assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/, '--version printed no version.');

		const preflight = run(bin, ['--preflight'], { cwd: scratch, env: childEnv });
		assert.equal(preflight.code, 0, `--preflight exited ${preflight.code}:\n${preflight.stderr}`);
		// It found THE ENGINE and THIS VAULT — both named in the output, because "it started" is
		// satisfied by a program that resolved something else entirely.
		assert.ok(preflight.stdout.includes(engine.path), '--preflight named a different engine.');
		assert.ok(preflight.stdout.includes(vault.root), '--preflight named a different vault.');
	});

	const launch = await new Promise((settle, fail) => {
		let output = '';
		const timer = setTimeout(() => {
			fail(new Error(`The installed launcher printed no URL in ${LAUNCH_TIMEOUT_MS}ms:\n${output}`));
		}, LAUNCH_TIMEOUT_MS);

		server = spawn(bin, ['--port', '0'], { cwd: scratch, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
		const read = (chunk) => {
			output += chunk;
			const match = output.match(/(http:\/\/127\.0\.0\.1:\d+)\/#token=([A-Za-z0-9_-]+)/);
			if (!match) return;
			clearTimeout(timer);
			settle({ origin: match[1], token: match[2], output });
		};
		server.stdout.setEncoding('utf8');
		server.stderr.setEncoding('utf8');
		server.stdout.on('data', read);
		server.stderr.on('data', read);
		server.on('exit', (code) => {
			clearTimeout(timer);
			fail(new Error(`The installed launcher exited ${code} before serving anything:\n${output}`));
		});
	});

	await t.test('the installed server serves the prebuilt page', async () => {
		const page = await get(launch.origin, '/', null);
		assert.equal(page.status, 200, 'The installed server did not serve its page.');
		assert.match(page.body, /<div id="root">|<script/, 'What it served is not the built page.');
		// The page is served from the tarball's own dist/, not from a directory beside the
		// terminal: an installed copy that fell back to the working directory would look identical
		// here and be broken everywhere else.
		assert.ok(
			launch.output.includes(installedRoot) || existsSync(join(installedRoot, 'dist', 'index.html')),
			'The installed tree carries no dist/index.html.',
		);
	});

	await t.test('the installed server returns real data from the vault', async () => {
		const preflight = await get(launch.origin, '/api/preflight', launch.token);
		assert.equal(preflight.status, 200, '/api/preflight refused the installed launcher’s own token.');
		const readings = JSON.parse(preflight.body);
		assert.equal(readings.vault.root, vault.root, 'The server resolved a different vault.');
		assert.equal(readings.model.status, 'bundled', 'The engine it found carries no model.');

		const listing = await get(launch.origin, '/api/memories', launch.token);
		assert.equal(listing.status, 200, '/api/memories did not answer.');
		const payload = JSON.parse(listing.body);

		// The COUNT and the CONTENT. A count alone passes against an empty vault and a broken
		// listing route that returns zero of zero.
		assert.equal(
			payload.memory_count,
			vault.memories,
			`The vault was written with ${vault.memories} memories and the server listed ${payload.memory_count}.`,
		);
		const titles = payload.memories.map((memory) => memory.semantic?.title ?? memory.title);
		assert.ok(
			titles.some((title) => typeof title === 'string' && title.length > 0),
			'Every memory came back without a title, so nothing was actually read.',
		);
	});

	await t.test('serving the app wrote no ranked search into the vault', () => {
		// The invariant this whole product is built around, checked on the PACKAGED build. A
		// listing backed by the ranked door would write one permanent record per load, into a store
		// nothing published reads back or removes.
		const after = countExposureRecords(vault.root);
		assert.equal(after.stores, exposureBefore.stores, 'The exposure store moved under this run.');
		assert.equal(
			after.records,
			exposureBefore.records,
			'Running the packaged app recorded a ranked search.',
		);
	});

	// ---- 5. and it stops when asked -------------------------------------------------------------

	await t.test('it shuts down on SIGTERM', async () => {
		const stopped = new Promise((settle) => server.on('exit', settle));
		server.kill('SIGTERM');
		await stopped;
		assert.equal(server.exitCode === null ? 0 : server.exitCode, 0, 'The launcher did not stop cleanly.');
	});

	// Cleanup is asserted rather than assumed: this test creates a vault and a scratch install, and
	// leaving either behind on a developer's machine is a slow leak of disk and of confusion.
	rmSync(holder, { recursive: true, force: true });
	assert.equal(existsSync(holder), false, 'The release test left its scratch directory behind.');
	assert.ok(statSync(REPO).isDirectory(), 'The repository is still where it was.');
});
