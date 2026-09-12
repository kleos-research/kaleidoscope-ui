// The OTHER first run: the engine is here, and this directory holds no memories.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A SEPARATE STATE AND NOT A REFUSAL
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// It arrives as a refusal — the engine declines every vault-addressed call with exit 2 — and left
// as one it reached the user as:
//
//     The engine refused ontology and printed no refusal envelope.
//
// which is true, is about an operation they never asked for, and reads like this app is broken. It
// was the FIRST THING a stranger saw: `npx` in any directory that is not already a vault, which is
// most directories. So it is classified into its own state, and these are the properties that make
// that state worth having:
//
//   * it is recognised STRUCTURALLY. Every reading is either about the BUILD or about a VAULT;
//     when all of the first answer and all of the second refuse, the engine works and there is no
//     vault here. Nothing greps the refusal for English — a client that did would start reporting
//     a broken install the first time the engine rephrased a sentence, which is why the negative
//     case below drives a stand-in engine whose refusal says exactly the recognisable words;
//   * the path shown is the ENGINE'S, from `where --root-only`, the one command that answers in
//     both states. This app never joins a working directory to a vault name: that would be a
//     second resolver, naming a path on a machine where the engine resolves something else;
//   * the server BINDS ANYWAY and serves the setup screen, exactly as it does for a missing
//     engine, because the remedy is a command in a terminal the person has already walked away
//     from;
//   * the screen offers NO INSTALL COMMAND and NO PATH FIELD. Both answer "where is the engine",
//     and the engine is the one thing that was found;
//   * NOTHING IS CREATED. The engine refuses to create a vault it was merely pointed at, and this
//     app must not do it either — so the directory is listed before and after.
//
// THE ABSENCE IS REAL. Every assertion below runs the shipped `preflight` against a real engine in
// a real empty directory. If a vault ever turns out to be there, the test fails with a sentence
// saying so rather than skipping.

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { INIT_COMMAND, VaultNotFoundError } from '../src/engine/errors.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { preflight } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';

const engine = await locateEngine();

/** A directory that exists, is empty, and is not under any vault. */
function emptyDirectory(label) {
	return mkdtempSync(join(tmpdir(), `ui-no-vault-${label}-`));
}

/**
 * Run something with the process pointed at a directory, and with the environment that decides a
 * vault root cleared.
 *
 * `KSCOPE_ROOT` is cleared because a developer machine running this suite usually has one set, and
 * a test that inherited it would measure the wrong directory — it would find a vault and pass by
 * never entering the state it exists to measure.
 */
async function inDirectory(directory, body) {
	const realCwd = process.cwd();
	const realRoot = process.env.KSCOPE_ROOT;
	process.chdir(directory);
	delete process.env.KSCOPE_ROOT;
	try {
		return await body();
	} finally {
		process.chdir(realCwd);
		if (realRoot === undefined) delete process.env.KSCOPE_ROOT;
		else process.env.KSCOPE_ROOT = realRoot;
	}
}

/** What is on disk under a directory, as a sorted list of paths. */
function contents(directory) {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.map((entry) => join(entry.parentPath ?? entry.path, entry.name))
		.sort();
}

test('an empty directory is a named state, not a refusal about an operation nobody asked for', async () => {
	const here = emptyDirectory('plain');
	try {
		const error = await inDirectory(here, () =>
			preflight({ explicit: engine.path }).then(
				(readings) => readings,
				(failure) => failure,
			),
		);

		if (!(error instanceof Error)) {
			throw new Error(
				`This test needs a directory with no vault in it, and \`preflight\` opened one at ` +
					`${error?.vault?.root}. The state it measures could not be arranged, so it is ` +
					`failing rather than skipping.`,
			);
		}
		assert.ok(
			error instanceof VaultNotFoundError,
			`Classified as ${error.name}, not VaultNotFoundError. What it said:\n${error.message}`,
		);

		// The path is the engine's own answer, and it is under the directory we stood in. Through
		// `realpathSync` on both sides: on macOS the temporary directory is reached by a symlink and
		// the engine answers with the resolved form, so comparing the strings as given would fail on
		// a path that is the same place.
		assert.ok(error.root, 'The error names no resolved root.');
		assert.equal(
			realpathSync(error.root.replace(/\/[^/]+$/, '')),
			realpathSync(here),
			`The resolved root ${error.root} is not under ${here}.`,
		);
		assert.equal(typeof error.source, 'string');

		// The sentence a person reads. It names the one command that helps and none of the
		// developer language the unclassified refusal used to carry.
		assert.match(error.message, /no Kaleidoscope vault here yet/);
		assert.ok(error.message.includes(INIT_COMMAND), `The message never names \`${INIT_COMMAND}\`.`);
		assert.doesNotMatch(error.message, /refusal envelope/);
		assert.doesNotMatch(error.message, /ontology/);

		// AND IT CREATED NOTHING. The engine refuses to create a vault it was merely pointed at;
		// an app that created one on the way past would undo that decision from the outside.
		assert.deepEqual(contents(here), [], 'Taking the readings left something on disk.');
	} finally {
		rmSync(here, { recursive: true, force: true });
	}
});

test('the classifier is structural: an engine that fails its own build readings is not reported as a missing vault', async () => {
	// A stand-in that refuses EVERYTHING, including the readings that describe the build. That is
	// a broken or unusable engine, not a machine without a vault, and the two have nothing in
	// common to do about them. Its refusal deliberately contains the words a text-matching
	// classifier would key on, so a future rewrite that reached for `includes('is not a vault')`
	// fails here rather than in front of a user.
	const dir = mkdtempSync(join(tmpdir(), 'ui-no-vault-broken-'));
	const standIn = join(dir, 'kscope');
	writeFileSync(
		standIn,
		`#!/usr/bin/env node
process.stderr.write('kscope: that is not a vault (no manifest.json). Try \`kscope init\`.\\n');
process.exit(2);
`,
	);
	chmodSync(standIn, 0o755);

	const here = emptyDirectory('broken');
	try {
		const error = await inDirectory(here, () =>
			preflight({ explicit: standIn }).then(
				() => null,
				(failure) => failure,
			),
		);
		assert.ok(error, 'An engine that refuses every reading somehow produced readings.');
		assert.ok(
			!(error instanceof VaultNotFoundError),
			'An engine that cannot answer what it IS was reported as a machine with no vault. ' +
				'The classifier is reading the words of a refusal instead of the shape of the batch.',
		);
	} finally {
		rmSync(here, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the server binds anyway and describes the state without asking where the engine is', async () => {
	const here = emptyDirectory('served');
	let sidecar = null;
	try {
		const error = await inDirectory(here, () =>
			preflight({ explicit: engine.path }).then(
				() => null,
				(failure) => failure,
			),
		);
		assert.ok(error instanceof VaultNotFoundError, 'Could not arrange the state to serve.');

		sidecar = await startSidecar({ engineError: error, port: 0, appVersion: 'test' });

		const status = await new Promise((resolve, reject) => {
			const req = httpRequest(
				{
					host: '127.0.0.1',
					port: sidecar.port,
					path: '/api/engine',
					headers: { authorization: `Bearer ${sidecar.token}` },
				},
				(res) => {
					let body = '';
					res.on('data', (chunk) => (body += chunk));
					res.on('end', () => resolve({ statusCode: res.statusCode, body }));
				},
			);
			req.on('error', reject);
			req.end();
		});

		assert.equal(status.statusCode, 200, 'An absent vault is a state the app displays, not a 500.');
		const engineStatus = JSON.parse(status.body);

		assert.equal(engineStatus.present, false);
		assert.equal(engineStatus.kind, 'no-vault');
		assert.equal(engineStatus.init_command, INIT_COMMAND);
		// The two controls that ask "where is the engine". Both are wrong here, and both being
		// withheld by the SERVER is what stops the page having to decide it a second way.
		assert.equal(engineStatus.install_command, null, 'Told to re-install an engine that answered.');
		assert.equal(engineStatus.can_set_path, false, 'Offered a path field for a program it found.');
		// The engine's own resolution, carried whole.
		assert.equal(engineStatus.vault?.root, error.root);
		assert.equal(engineStatus.vault?.source, error.source);

		assert.deepEqual(contents(here), [], 'Serving the screen left something on disk.');
	} finally {
		await sidecar?.close().catch(() => {});
		rmSync(here, { recursive: true, force: true });
	}
});
