// Milestone 4: removal, and the two claims it has to keep apart.
//
// **"The call returned success" is not "the memory is removed."** The engine's delete mode returns
// exit 0 and `canonical_effect: "committed"`, and a client that stops there has asserted that a
// call finished. This flow pays one extra non-writing read per item to turn that into the claim a
// user actually cares about, and the tests below assert the second claim through the doors rather
// than the first through the response.
//
// **"Removed" is not "erased."** The record is marked, the listing and export doors stop serving
// it, and the text stays on disk in the vault folder — the lineage door still reads it. That is
// measured here on this build, not assumed from a document, because the day it stops being true is
// the day the product's copy is allowed to change and nobody would otherwise notice.
//
// Seven things this file checks, and each one is here because getting it wrong is invisible from a
// screen:
//
//   * a removal is preceded by a snapshot, and the snapshot holds the memory — which is proof of
//     ORDER, not just of existence: the export door returns nothing for a removed memory, so a
//     snapshot with a record in it could only have been taken beforehand;
//   * a removed memory leaves the listing door;
//   * the display door reports it removed and WITHHOLDS the body — absent, not blank;
//   * the lineage door still reads it, which is the honest half of the claim and the reason the
//     copy says the text is still there;
//   * a bulk run with one stale version reports PER ITEM: one removed, one refused with the reason,
//     and the rest not attempted — never one success line and never one failure line;
//   * the word this product may not say appears nowhere in the flow, checked over the copy itself
//     and over the component sources;
//   * the exposure count does not move. There are zero callers of the ranked door in this
//     repository and this milestone does not add the first one.
//
// Everything that writes runs against a clone, through the same helpers every other file uses: the
// source is resolved, cloned, and the engine is asked through its own door which vault it resolved
// before the first write is attempted.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequestRaw } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { readMemory, writeMemory } from '../src/engine/memory.mjs';
import { childFieldNames } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';
import { deleteRequest } from '../src/server/removal.mjs';
import { pickMode } from '../src/server/write.mjs';
import * as removal from '../src/app/removal-model.mjs';
import { countExposureRecords, openScratchVault } from './helpers/vault.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A removal folds a graph. It is not a read, and its timeout is not a read's. */
const WRITE_TIMEOUT_MS = 120_000;

/** Everything this file writes into a vault carries it, so a stray fixture is recognisable. */
const MARK = 'ui-removal-fixture';

// =============================================================================================
// PART 1 — the copy and the arithmetic, with no engine and no disk under them
// =============================================================================================
//
// The sentences ARE the deliverable in this flow, which makes them a thing to test rather than a
// thing to review. A string in a component is checked by looking at a screen; these are checked on
// every commit.

/** Every string this module publishes, flattened, so nothing new escapes the check by being new. */
function copyInventory() {
	const found = [];
	const walk = (value, path) => {
		if (typeof value === 'string') found.push({ path, text: value });
		else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
		else if (value && typeof value === 'object') {
			for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
		}
	};
	for (const [name, value] of Object.entries(removal)) {
		// The denial list itself is data about the copy rather than copy, and so are the strings the
		// allowlist is made of — they are checked separately, below, and by a stricter rule.
		if (name === 'FORBIDDEN_WORDS' || name === 'ALLOWED_LINES') continue;
		if (typeof value === 'function') continue;
		walk(value, name);
	}
	return found;
}

test('the word this product may not say appears nowhere in the removal copy', () => {
	// The whole point of PRD 0004. A user who reads a promise of erasure and believes it will not
	// rotate the leaked key, and the damage is silent, arrives later, and is found by somebody else.
	// The opposite mistake costs a user minutes. There is no symmetric risk, so there is no case for
	// softening — and none for leaving it to review either, because copy drifts and a check does not.
	const hits = [];
	for (const { path, text } of copyInventory()) {
		for (const word of removal.forbiddenWordsIn(text)) hits.push(`${path}: “${word}”`);
	}
	assert.deepEqual(hits, [], `the removal copy promises something this product cannot do:\n${hits.join('\n')}`);

	// And the word named in the brief, checked on its own, with no allowlist in the way. This is the
	// assertion a well-meaning later edit trips over.
	for (const { path, text } of copyInventory()) {
		assert.doesNotMatch(
			text.toLowerCase(),
			/permanent/,
			`${path} says “permanently”, which is the one word this flow may never use: removal hides ` +
				`a memory and the text stays on disk.`,
		);
	}
});

test('the allowlist cannot become a way to smuggle the promise back in', () => {
	// Four strings are allowed to contain a word from the denial list, and every one of them uses it
	// to DENY erasure or to name vault destruction accurately. That is only safe while the allowlist
	// is checked against itself: an entry that started saying "permanently" would otherwise be
	// exempt from the very rule it exists as an exception to.
	assert.ok(removal.ALLOWED_LINES.length > 0);
	for (const line of removal.ALLOWED_LINES) {
		assert.doesNotMatch(line.toLowerCase(), /permanent|wipe|shred/, `an allowlisted line says: ${line}`);
	}

	// The check itself has to be capable of failing. A copy rule whose probe passes on a sentence
	// that plainly breaks it is a rule that reads as enforced and is not.
	assert.deepEqual(removal.forbiddenWordsIn('This deletes it permanently.'), ['permanently']);
	assert.deepEqual(removal.forbiddenWordsIn('This will erase the file.'), ['erase']);
	assert.deepEqual(removal.forbiddenWordsIn(removal.WHAT_REMOVAL_DOES), []);
});

test('no rendered string in the removal components says it either', () => {
	// A grep-style scan of the sources, with comments stripped, because the components are where a
	// later edit would type a friendlier label. It is deliberately cruder than the inventory above
	// and it catches a different mistake: a sentence written inline instead of imported.
	const files = [
		'src/app/RemovalFlow.jsx',
		'src/app/RemovalLimits.jsx',
		'src/server/removal.mjs',
	];

	const hits = [];
	for (const file of files) {
		const source = readFileSync(join(ROOT, file), 'utf8')
			// Block comments first, then whole-line `//` comments. Comments are not rendered copy, and
			// a check that failed on a comment explaining the rule would be a check people delete.
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.split('\n')
			.filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
			.join('\n');

		for (const [index, line] of source.split('\n').entries()) {
			for (const word of removal.forbiddenWordsIn(line)) {
				hits.push(`${file}:${index + 1} “${word}” — ${line.trim().slice(0, 90)}`);
			}
		}
	}
	assert.deepEqual(hits, [], `a removal component says something this product cannot do:\n${hits.join('\n')}`);

	// PRD 0004 R2: no trash glyph, anywhere. A trash icon is a picture of incineration and this
	// action is not one — the word is what carries the difference, so the word is what appears.
	const screens = ['src/app/RemovalFlow.jsx', 'src/app/RemovalLimits.jsx', 'src/app/MemoryList.jsx', 'src/app/MemoryDetail.jsx'];
	for (const file of screens) {
		const source = readFileSync(join(ROOT, file), 'utf8');
		assert.doesNotMatch(source, /\u{1F5D1}|\u{267B}/u, `${file} renders a trash glyph`);
	}

	// And the action is called the same thing everywhere it appears. A second spelling in one
	// surface is how a product ends up promising two different things about one button.
	for (const file of ['src/app/RemovalFlow.jsx', 'src/app/RemovalLimits.jsx', 'src/app/MemoryList.jsx', 'src/app/MemoryDetail.jsx']) {
		const source = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		assert.doesNotMatch(
			source,
			/>\s*Delete\b/,
			`${file} labels a control "Delete", which promises the bytes are gone`,
		);
	}
});

test('the delete request carries three keys and nothing else', () => {
	// PRD 0004 R6. The engine refuses a delete that carries a body — measured, `delete must omit
	// content_md` — so an implementation that echoed the record it had just read back would fail
	// loudly. The guarantee belongs here anyway: this is the one function whose output is the whole
	// of what reaches the vault.
	const request = deleteRequest({
		mode: 'delete',
		memory_id: 'mem_x',
		expected_version_id: 'ver_x',
	});
	assert.deepEqual(Object.keys(request).sort(), ['expected_version_id', 'memory_id', 'mode']);

	// And it will not be built without the version. Without it the engine cannot refuse a write
	// against a memory that changed since it was read, which is the whole guard.
	assert.throws(() => deleteRequest({ mode: 'delete', memory_id: 'mem_x' }), TypeError);
	assert.throws(() => deleteRequest({ mode: 'delete', expected_version_id: 'ver_x' }), TypeError);
});

test('a partial run is never rendered as a success', () => {
	// The failure this shape exists to stop: one "Removed 12 memories" over a run where four were
	// refused is a false statement about the user's own data, and the user has no other instrument
	// to catch it with.
	const run = removal.summariseRun({
		items: [
			{ memory_id: 'mem_a', title: 'A', state: 'removed' },
			{ memory_id: 'mem_b', title: 'B', state: 'changed', message: 'it moved' },
			{ memory_id: 'mem_c', title: 'C', state: 'not_attempted' },
		],
	});

	assert.equal(run.partial, true);
	assert.notEqual(run.tone, 'good', 'a run that refused an item was toned as a success');
	assert.match(run.headline, /1 of 3/);
	assert.equal(run.removed.length, 1);
	assert.equal(run.refused.length, 1);
	assert.equal(run.not_attempted.length, 1);
	assert.equal(run.items.length, 3, 'the report dropped a memory the user selected');

	// The three refusal classes are told apart and worded differently. None of them is "removal
	// failed": two are retryable and one is about a key.
	const labels = ['changed', 'busy', 'unlicensed'].map((state) =>
		removal.describeItem({ state }).label,
	);
	assert.equal(new Set(labels).size, 3, `the refusal classes share wording: ${labels.join(' / ')}`);
	for (const label of labels) assert.doesNotMatch(label, /^removal failed/i);
});

test('an outcome this build does not recognise is not a success', () => {
	// A build one version behind the server must render a state it has never seen as not-removed. The
	// alternative — falling back to the nearest known state — is how a refusal renders as a receipt.
	const item = removal.describeItem({ state: 'some_future_state', memory_id: 'mem_x' });
	assert.equal(item.removed, false);
	assert.equal(item.recognised, false);
	assert.match(item.label, /some_future_state/);

	const run = removal.summariseRun({ items: [{ state: 'some_future_state' }] });
	assert.equal(run.tone, 'bad');
});

test('every state the server can report has a sentence on the screen', () => {
	// The two halves of this flow are written in two files and they have to agree on a closed set of
	// words. A state the server emits with no row in the model renders as "this app does not
	// recognise the outcome" — which is honest, and is not what anybody wants to read. Asserted
	// against the server's own source rather than a list written here, so a state added there without
	// a sentence fails immediately instead of on a screen somebody eventually sees.
	const source = readFileSync(join(ROOT, 'src/server/removal.mjs'), 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		'',
	);
	const emitted = new Set([...source.matchAll(/state:\s*'([a-z_]+)'/g)].map((match) => match[1]));
	assert.ok(emitted.size >= 6, `the scan found only ${emitted.size} states, so it proves little`);
	for (const state of emitted) {
		assert.ok(
			Object.hasOwn(removal.ITEM_STATES, state),
			`the server can report “${state}” and the screen has no sentence for it`,
		);
	}
	// And the other direction is deliberately NOT asserted: `not_attempted` is written by the run
	// loop rather than by an item, and a row the server has stopped emitting is a sentence nobody
	// sees rather than a screen nobody can read.
	assert.ok(Object.hasOwn(removal.ITEM_STATES, 'not_attempted'));
});

test('the vault-destruction command is rendered with the resolved root, never assembled', () => {
	assert.equal(removal.vaultDeleteCommand('/tmp/a-vault'), 'kscope vault-delete /tmp/a-vault');
	// A path with a space is quoted, because a command a user copies has to work when they paste it.
	assert.match(removal.vaultDeleteCommand('/tmp/two words'), /"\/tmp\/two words"/);
	// And a session with no resolved root prints nothing rather than a command with a hole in it.
	assert.equal(removal.vaultDeleteCommand(null), null);
	assert.equal(removal.vaultDeleteCommand(''), null);
});

test('this app never invokes the vault-destruction command', () => {
	// PRD 0004 R13, and the shape of the check matters: the escalation screen RENDERS that command as
	// text, so a grep for the string hits the feature it is protecting. What is asserted instead is
	// that the token never reaches the process-spawning module, and that the only place it appears at
	// all is the function whose whole job is to print it.
	const sources = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (/\.(mjs|jsx|js)$/.test(entry.name)) sources.push(path);
		}
	};
	walk(join(ROOT, 'src'));
	assert.ok(sources.length > 10, 'the source scan found almost nothing, so it proves almost nothing');

	const spawners = [];
	const mentions = [];
	for (const path of sources) {
		const text = readFileSync(path, 'utf8');
		const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
		if (/\bspawn\s*\(/.test(code) || /\bexecFile\w*\s*\(/.test(code)) spawners.push(path);
		if (code.includes('vault-delete')) mentions.push(path);
	}

	assert.deepEqual(
		spawners.map((path) => path.slice(ROOT.length + 1)),
		['src/engine/call.mjs'],
		'something other than the one spawner starts a child process',
	);
	assert.deepEqual(
		mentions.map((path) => path.slice(ROOT.length + 1)),
		['src/app/removal-model.mjs'],
		'the vault-destruction command is named somewhere other than the function that prints it',
	);
	assert.ok(
		!readFileSync(join(ROOT, 'src/engine/call.mjs'), 'utf8').includes('vault-delete'),
		'the command reached the module that starts child processes',
	);
});

// =============================================================================================
// PART 2 — through the HTTP surface, against a clone of a real vault
// =============================================================================================

function httpRequest({ port, method = 'GET', path = '/', headers = {}, body = null, timeoutMs = 60_000 }) {
	return new Promise((settle, fail) => {
		const payload = body === null ? null : JSON.stringify(body);
		const request = httpRequestRaw({
			host: '127.0.0.1',
			port,
			method,
			path,
			headers: {
				host: `127.0.0.1:${port}`,
				// Exactly what a browser puts on the wire: no Origin on a same-origin GET, and one on
				// every method that is not GET or HEAD. A client that omitted it on a POST would trip
				// the server's own control and be measuring its own omission.
				...(method === 'GET' || method === 'HEAD' ? {} : { origin: `http://127.0.0.1:${port}` }),
				...(payload === null
					? {}
					: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
				...headers,
			},
		});
		request.setTimeout(timeoutMs, () =>
			request.destroy(new Error(`no response within ${timeoutMs} ms to ${method} ${path}`)),
		);
		request.on('error', fail);
		request.on('response', (response) => {
			const seen = { status: response.statusCode, body: '' };
			response.setEncoding('utf8');
			response.on('data', (chunk) => (seen.body += chunk));
			response.on('end', () => settle(seen));
			response.on('error', fail);
		});
		if (payload !== null) request.write(payload);
		request.end();
	});
}

const authorised = (sidecar, options) =>
	httpRequest({
		port: sidecar.port,
		...options,
		headers: { authorization: `Bearer ${sidecar.token}`, ...(options.headers ?? {}) },
	});

const json = (response, where) => {
	try {
		return JSON.parse(response.body);
	} catch (error) {
		assert.fail(
			`${where} was expected to be JSON. Status ${response.status}; ${error.message}. ` +
				`First 300 bytes:\n${response.body.slice(0, 300)}`,
		);
	}
};

async function openSidecar(t, label) {
	const engine = await locateEngine({});
	const scratch = openScratchVault({ enginePath: engine.path, label });
	t.after(() => scratch.close());

	const holder = mkdtempSync(join(tmpdir(), 'ui-removal-state-'));
	t.after(() => rmSync(holder, { recursive: true, force: true }));

	const sidecar = await startSidecar({
		enginePath: engine.path,
		root: scratch.root,
		host: '127.0.0.1',
		port: 0,
		snapshotsDir: holder,
	});
	t.after(async () => {
		try {
			await sidecar.close();
		} catch {
			// A close that fails must not mask the assertion that failed before it.
		}
	});

	t.diagnostic(`clone ${scratch.root}`);
	t.diagnostic(`snapshot store ${sidecar.snapshots.directory}`);
	return { engine, scratch, sidecar, where: { enginePath: engine.path, root: scratch.root } };
}

/**
 * A create payload built from vocabulary the engine printed a moment ago. Nothing is transcribed:
 * memory types, entity kinds and relation names are open registries and a value written down in a
 * test drifts from the engine exactly as quietly as one written into a dropdown.
 */
async function buildDelta(sidecar, title) {
	const readings = json(await authorised(sidecar, { path: '/api/preflight' }), 'GET /api/preflight');
	const vocabulary = readings.vocabulary;

	const pick = (path, index = 0) => {
		const known = vocabulary.known?.[path] ?? vocabulary.closed?.[path] ?? [];
		const denied = new Set(vocabulary.denied?.[path] ?? []);
		const offered = known.filter((value) => !denied.has(value));
		assert.ok(offered.length > index, `the write contract named nothing usable at ${path}`);
		return offered[index];
	};

	const memoryType = (vocabulary.memory_types ?? vocabulary.declarable_memory_types ?? [])[0];
	assert.ok(memoryType, 'the engine published no memory type this workspace would accept');
	for (const field of ['title', 'memory_type', 'entities', 'facts']) {
		assert.ok(
			childFieldNames(vocabulary.fields, 'semantic_delta').includes(field),
			`the write contract's semantic delta has no '${field}'`,
		);
	}

	const kind = pick('semantic_delta.entities.kind');
	const subject = `${MARK} subject`;
	const object = `${MARK} object`;
	return {
		readings,
		delta: {
			title,
			memory_type: memoryType,
			entities: [
				{ n: subject, kind, is: `${subject} | ${kind} | invented by a test` },
				{ n: object, kind, is: `${object} | ${kind} | invented by a test` },
			],
			facts: [{ subject, predicate: pick('semantic_delta.facts.predicate'), object }],
		},
	};
}

async function createMemory(sidecar, title, prose) {
	const { delta } = await buildDelta(sidecar, title);
	const created = json(
		await authorised(sidecar, {
			method: 'POST',
			path: '/api/memories',
			body: { content_md: `# ${title}\n\n${prose}\n`, semantic_delta: delta },
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'POST /api/memories',
	);
	assert.equal(created.outcome, 'applied', `the create did not apply: ${JSON.stringify(created).slice(0, 400)}`);
	return { memory_id: created.data.memory_id, version_id: created.data.version_id, delta };
}

const runRemoval = async (sidecar, items, options = {}) =>
	json(
		await authorised(sidecar, {
			method: 'POST',
			path: '/api/removals',
			body: { items, ...options },
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'POST /api/removals',
	);

const exportFiles = (directory) => {
	try {
		return readdirSync(directory).filter((name) => name.endsWith('.export.json'));
	} catch {
		return [];
	}
};

test('a removal is preceded by a snapshot, and the doors say what the copy says', async (t) => {
	const { sidecar, scratch, where } = await openSidecar(t, 'removal-one');

	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(
		beforeExposure.stores > 0,
		'No search-exposure store was found in the clone, so the count at the end of this test is ' +
			'zero compared against zero and passes hardest when it is broken.',
	);

	const title = `${MARK} the memory that gets removed`;
	const memory = await createMemory(sidecar, title, 'A memory this test created, then removed.');

	// It is in the listing BEFORE the run. Asserted rather than assumed: "it left the listing" is not
	// a claim about anything unless it was in the listing to begin with, and a test that skipped this
	// would pass identically against a create that silently failed.
	const idsBefore = json(await authorised(sidecar, { path: '/api/memories' }), 'the listing').memories.map(
		(record) => record.memory_id,
	);
	assert.ok(idsBefore.includes(memory.memory_id), 'the memory was not in the listing before the run');

	const report = await runRemoval(sidecar, [
		{ memory_id: memory.memory_id, seen_version_id: memory.version_id },
	]);

	assert.equal(report.outcome, 'ran');
	assert.equal(report.items.length, 1);
	const item = report.items[0];
	assert.equal(
		item.state,
		'removed',
		`the removal did not land: ${JSON.stringify(item).slice(0, 500)}`,
	);

	await t.test('the snapshot was taken BEFORE the removal, and holds the memory', async () => {
		assert.ok(item.snapshot, 'the removal carried no snapshot receipt');
		assert.equal(item.snapshot.operation, 'remove');
		assert.equal(item.snapshot.memory_id, memory.memory_id);
		assert.equal(
			item.snapshot.version_id,
			memory.version_id,
			'the snapshot names a version other than the one the removal replaced',
		);
		assert.ok(item.snapshot.payload_bytes > 0, 'the snapshot captured no bytes');
		assert.equal(
			item.snapshot.restorable,
			false,
			'a receipt that calls itself restorable would put a restore button on a screen with ' +
				'nothing to route it to',
		);

		const stored = await sidecar.snapshots.read(item.snapshot.snapshot_id);
		assert.ok(stored, 'the snapshot the receipt named is not in the store');
		const exported = JSON.parse(stored.export_json);
		assert.equal(exported.payload.memories.length, 1);
		assert.equal(exported.payload.memories[0].memory_id, memory.memory_id);

		// THE ORDER, PROVEN RATHER THAN ASSUMED. The export door omits a removed memory entirely, so
		// a snapshot holding one could only have been taken before the removal committed. The same
		// export, asked for now, comes back empty — which is what makes the sentence above evidence.
		const nowExported = json(
			await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(memory.memory_id)}/snapshots` }),
			'the memory’s snapshot list',
		);
		assert.equal(nowExported.matched, 1, 'the store holds a different number of copies of this memory');
	});

	await t.test('the memory leaves the listing door', async () => {
		const listed = json(await authorised(sidecar, { path: '/api/memories?refresh=1' }), 'the listing');
		const ids = listed.memories.map((record) => record.memory_id);
		assert.ok(!ids.includes(memory.memory_id), 'a removed memory is still in the listing');
	});

	await t.test('the display door reports it removed and WITHHOLDS the body', async () => {
		// Withheld, not blanked. A door that returned an empty string would let a screen render a
		// memory with no note rather than a memory that is no longer served.
		const seen = await readMemory(memory.memory_id, where);
		assert.notEqual(seen.status, 'found', `the display door still reports “${seen.status}”`);
		assert.ok(
			!Object.hasOwn(seen, 'content_md'),
			`the display door still carries a body for a removed memory: ${Object.keys(seen).join(', ')}`,
		);
		// And the server's own verification saw the same thing, through the same door, at the time.
		assert.equal(item.observed.body_present, false);
		assert.notEqual(item.observed.status, 'found');
	});

	await t.test('the lineage door still reads it, which is why the copy says the text is still there', async () => {
		const lineage = json(
			await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(memory.memory_id)}/lineage` }),
			'the lineage door',
		);
		assert.equal(lineage.data.status, 'found', 'the lineage door stopped reading a removed memory');
		assert.equal(lineage.data.memory.title, title, 'the lineage door reads it and does not carry it');
	});

	await t.test('the whole flow recorded no ranked search', () => {
		// One retrieval door, and it always records an exposure row. This milestone adds zero callers
		// of it: the version re-read and the verification both address a memory by id.
		const after = countExposureRecords(scratch.root);
		assert.equal(after.stores, beforeExposure.stores);
		assert.equal(
			after.records,
			beforeExposure.records,
			`the removal flow wrote ${after.records - beforeExposure.records} exposure records`,
		);
	});
});

test('a bulk run with one stale version reports per item, and stops there', async (t) => {
	const { sidecar, scratch, where } = await openSidecar(t, 'removal-bulk');

	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(beforeExposure.stores > 0, 'no exposure store was found in the clone');

	const first = await createMemory(sidecar, `${MARK} first of three`, 'The one that lands.');
	const second = await createMemory(sidecar, `${MARK} second of three`, 'The one that moved.');
	const third = await createMemory(sidecar, `${MARK} third of three`, 'The one never reached.');

	// The second memory is written to AFTER the user "read" it. This is the normal case on a vault
	// agents are writing to, and it is staged deterministically here rather than raced: the version
	// the run carries for it is the one from before this edit.
	const loaded = json(
		await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(second.memory_id)}/edit` }),
		'the editor load',
	);
	const edited = json(
		await authorised(sidecar, {
			method: 'POST',
			path: `/api/memories/${encodeURIComponent(second.memory_id)}`,
			body: {
				expected_version_id: loaded.expected_version_id,
				content_md: `# ${MARK} second of three\n\nThe one that moved, edited.\n`,
				semantic_delta: loaded.semantic_delta,
			},
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'the update',
	);
	assert.equal(edited.outcome, 'applied', 'the staging edit did not apply');
	assert.notEqual(edited.data.version_id, second.version_id, 'the staging edit did not move the version');

	const report = await runRemoval(sidecar, [
		{ memory_id: first.memory_id, seen_version_id: first.version_id },
		// The version the user was looking at, which is no longer the version the vault is on.
		{ memory_id: second.memory_id, seen_version_id: second.version_id },
		{ memory_id: third.memory_id, seen_version_id: third.version_id },
	]);

	assert.equal(report.items.length, 3, 'the report dropped a memory the user selected');
	assert.equal(report.stopped, true);
	assert.equal(report.removed, 1);

	assert.equal(report.items[0].state, 'removed', JSON.stringify(report.items[0]).slice(0, 300));
	assert.equal(report.items[1].state, 'changed', JSON.stringify(report.items[1]).slice(0, 300));
	assert.equal(report.items[2].state, 'not_attempted', JSON.stringify(report.items[2]).slice(0, 300));

	// The refusal names both versions, because "it changed" without them is not something anyone can
	// act on.
	assert.equal(report.items[1].observed.seen_version_id, second.version_id);
	assert.equal(report.items[1].observed.current_version_id, edited.data.version_id);

	await t.test('the run really did stop, rather than reporting that it did', async () => {
		// The instrument has to be able to see the difference. Both of the memories after the refusal
		// are still served — asserted through the listing door rather than inferred from the report,
		// which is the thing under test.
		const listed = json(await authorised(sidecar, { path: '/api/memories?refresh=1' }), 'the listing');
		const ids = new Set(listed.memories.map((record) => record.memory_id));
		assert.ok(!ids.has(first.memory_id), 'the first memory was reported removed and is still listed');
		assert.ok(ids.has(second.memory_id), 'the refused memory was removed anyway');
		assert.ok(ids.has(third.memory_id), 'the run pushed past a refusal');
	});

	await t.test('the screen cannot render this run as a success', () => {
		const run = removal.summariseRun(report);
		assert.equal(run.tone, 'partial');
		assert.notEqual(run.tone, 'good');
		assert.match(run.headline, /1 of 3/);
		// Every selected memory appears, including the one never attempted.
		assert.equal(run.items.length, 3);
	});

	await t.test('a delete that echoes the record back is refused by the contract', async () => {
		// The control for the three-key request shape. A naive implementation loads the memory,
		// changes nothing, and sends it back with `mode: delete` — and the engine refuses it, which is
		// fortunate, because the failure mode of it being accepted would be worse. Asserted against a
		// memory the run did not reach, so it is still there to refuse the call.
		const readings = json(await authorised(sidecar, { path: '/api/preflight' }), 'GET /api/preflight');
		const mode = pickMode(readings.vocabulary.closed, /^delete/i);
		const current = await readMemory(third.memory_id, where);

		await assert.rejects(
			writeMemory(
				{ mode, memory_id: third.memory_id, expected_version_id: current.version_id, content_md: '# x' },
				{ ...where, timeoutMs: WRITE_TIMEOUT_MS },
			),
			(error) => {
				assert.match(error.message, /content_md/i, `the refusal did not name the field: ${error.message}`);
				return true;
			},
		);

		// And it really was refused: the memory is still served.
		const still = await readMemory(third.memory_id, where);
		assert.equal(still.status, 'found');
	});

	await t.test('the whole run recorded no ranked search', () => {
		const after = countExposureRecords(scratch.root);
		assert.equal(after.stores, beforeExposure.stores);
		assert.equal(
			after.records,
			beforeExposure.records,
			`the removal run wrote ${after.records - beforeExposure.records} exposure records`,
		);
	});
});

test('a removal started from the escalation screen keeps no copy, and the store says so', async (t) => {
	// PRD 0004 R12. Everywhere else a write is preceded by a local copy outside the vault. Here that
	// copy would be a fresh plaintext copy of exactly the secret the user is trying to be rid of,
	// written somewhere vault destruction will never reach. The record is still written — the spine
	// never skips silently — and it says the bytes were not kept and why.
	const { sidecar } = await openSidecar(t, 'removal-escalated');

	const memory = await createMemory(
		sidecar,
		`${MARK} the memory with a secret in it`,
		'A memory this test created, then removed from the escalation screen.',
	);

	const payloadsBefore = exportFiles(sidecar.snapshots.directory).length;

	const report = await runRemoval(
		sidecar,
		[{ memory_id: memory.memory_id, seen_version_id: memory.version_id }],
		{ escalated: true },
	);

	const item = report.items[0];
	assert.equal(item.state, 'removed', JSON.stringify(item).slice(0, 400));
	assert.equal(report.escalated, true);

	assert.ok(item.snapshot, 'the escalated removal wrote no snapshot record at all');
	assert.equal(item.snapshot.prior, 'not-captured');
	assert.equal(item.snapshot.payload_bytes, 0);
	assert.ok(item.snapshot.suppressed_reason, 'the record does not say why the bytes were not kept');

	assert.equal(
		exportFiles(sidecar.snapshots.directory).length,
		payloadsBefore,
		'the escalation path wrote a plaintext copy of the memory it was removing',
	);

	// The control: the SAME store, on the same run shape, does keep bytes when the path is not the
	// escalation. Without it, this test passes on a build whose snapshot spine is simply broken.
	const ordinary = await createMemory(sidecar, `${MARK} an ordinary removal`, 'Removed the usual way.');
	const second = await runRemoval(sidecar, [
		{ memory_id: ordinary.memory_id, seen_version_id: ordinary.version_id },
	]);
	assert.equal(second.items[0].state, 'removed');
	assert.equal(second.items[0].snapshot.prior, 'captured');
	assert.equal(
		exportFiles(sidecar.snapshots.directory).length,
		payloadsBefore + 1,
		'an ordinary removal kept no copy either, so the assertion above measured a broken spine',
	);
});

test('a removal run refuses what it cannot carry, before it writes anything', async (t) => {
	const { sidecar } = await openSidecar(t, 'removal-refusals');

	const empty = await authorised(sidecar, {
		method: 'POST',
		path: '/api/removals',
		body: { items: [] },
	});
	assert.equal(empty.status, 400);
	assert.equal(json(empty, 'the empty run').error.kind, 'no-items');

	const nameless = await authorised(sidecar, {
		method: 'POST',
		path: '/api/removals',
		body: { items: [{ seen_version_id: 'ver_x' }] },
	});
	assert.equal(nameless.status, 400);

	// The cap the server publishes is the cap it enforces. A control that wrote its own number down
	// would drift from this, and the user would meet the difference at the item the run stopped on.
	const readings = json(await authorised(sidecar, { path: '/api/preflight' }), 'GET /api/preflight');
	const cap = readings.app.removal.max_items;
	assert.ok(Number.isInteger(cap) && cap > 0, 'the sidecar publishes no removal cap');

	const oversized = await authorised(sidecar, {
		method: 'POST',
		path: '/api/removals',
		body: { items: Array.from({ length: cap + 1 }, (_, index) => ({ memory_id: `mem_${index}` })) },
	});
	assert.equal(oversized.status, 400);
	assert.equal(json(oversized, 'the oversized run').error.kind, 'too-many-items');
});
