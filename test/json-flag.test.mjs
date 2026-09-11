// Whether the engine is asked for JSON, and only where it can answer.
//
// Newer engines print a text receipt from `call search` and `call remember` unless `--json` is on
// the line; older engines read `--json` as the durability argument and exit 2. This app must send
// the flag to the first and never to the second — and a mistake in either direction does not
// surface here. It surfaces three layers away as "Unexpected token 'C', "Created | "… is not valid
// JSON" inside some unrelated test, which is exactly how it was found.
//
// So the property is pinned directly, against two stand-in engines that differ only in whether
// their help documents the flag. Each stand-in records the argv it was given, which is the only
// thing under test: what this app put on the command line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { call } from '../src/engine/call.mjs';

/**
 * A stand-in engine. `--help` either documents `--json` or does not; every `call` appends its argv
 * to a log and answers with a JSON object, so the call itself always succeeds and the assertion is
 * about the argv alone.
 */
function standIn({ documentsJsonFlag }) {
	const dir = mkdtempSync(join(tmpdir(), 'kscope-ui-jsonflag-'));
	const log = join(dir, 'argv.log');
	const engine = join(dir, 'kscope');
	writeFileSync(
		engine,
		`#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--help') {
	process.stdout.write(${JSON.stringify(
		documentsJsonFlag
			? 'Output. Add `--json` anywhere on the line for the full response object.\n'
			: 'kscope call <OPERATION> [process-local|durable-local]\n',
	)});
	process.exit(0);
}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
process.stdout.write(JSON.stringify({ outcome: 'applied' }));
process.exit(0);
`,
	);
	chmodSync(engine, 0o755);
	return {
		engine,
		argvs: () =>
			readFileSync(log, 'utf8')
				.trim()
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line)),
		remove: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test('an engine that documents --json is asked for it, before the verb, on the two receipt verbs', async () => {
	const fake = standIn({ documentsJsonFlag: true });
	try {
		await call('remember', { mode: 'create' }, { enginePath: fake.engine });
		await call('search', { memory_id: 'x' }, { enginePath: fake.engine });
		assert.deepEqual(fake.argvs(), [
			['call', '--json', 'remember'],
			['call', '--json', 'search'],
		]);
	} finally {
		fake.remove();
	}
});

test('an engine that does not document --json is never sent it — an older one reads it as durability', async () => {
	const fake = standIn({ documentsJsonFlag: false });
	try {
		await call('remember', { mode: 'create' }, { enginePath: fake.engine });
		await call('search', { memory_id: 'x' }, { enginePath: fake.engine });
		assert.deepEqual(fake.argvs(), [
			['call', 'remember'],
			['call', 'search'],
		]);
	} finally {
		fake.remove();
	}
});

test('an operation that still prints JSON is never given the flag, whatever the engine supports', async () => {
	const fake = standIn({ documentsJsonFlag: true });
	try {
		await call('memory_lifecycle', { mode: 'export' }, { enginePath: fake.engine });
		await call('doctor', { mode: 'inspect' }, { enginePath: fake.engine });
		assert.deepEqual(fake.argvs(), [
			['call', 'memory_lifecycle'],
			['call', 'doctor'],
		]);
	} finally {
		fake.remove();
	}
});
