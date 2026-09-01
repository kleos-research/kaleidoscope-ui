// The snapshot spine: a local copy of what a memory was, taken before every write.
//
// The experiment in `docs/RESTORE-EXPERIMENT.md` (asserted in `test/restore.test.mjs`) says a
// snapshot cannot be put back, so this store's value is not undo — it is that the bytes exist at
// all, somewhere a person can read them and save them, after the vault has stopped serving them.
// That makes two properties load-bearing, and they are the two most of this file is about:
//
//   * **a write is preceded by a snapshot** — every write, not just a removal, and not sometimes;
//   * **a snapshot that fails STOPS the write** — because a spine that skipped quietly would leave
//     the screen still promising a safety net and the user still believing there was something to
//     go back to. A promise that fails silently is worse than no promise.
//
// The rest is the shape of the store: outside the vault (a snapshot written into the vault would
// appear in the user's own memory list and be retrieved by their agents), bounded (a retention rule
// that is stated and enforced), and costing the vault nothing (the exposure census, before and
// after, with the instrument shown to be capable of moving).
//
// Everything that writes runs against a clone, through the same helpers every other file uses: the
// source is resolved, cloned, and the engine is asked through its own door which vault it resolved
// before the first write.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequestRaw } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { childFieldNames } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';
import {
	applyRetention,
	createSnapshotStore,
	isSnapshotId,
	RETENTION,
	resolveStateDirectory,
	SnapshotFailedError,
	vaultKey,
} from '../src/server/snapshots.mjs';
import { countExposureRecords, fingerprintVault, openScratchVault } from './helpers/vault.mjs';

/** A write folds a graph; it is not a read. */
const WRITE_TIMEOUT_MS = 120_000;

const MARK = 'ui-snapshot-fixture';

// =============================================================================================
// PART 1 — the arithmetic, with no disk and no engine under it
// =============================================================================================
//
// Retention is the part of this module that DESTROYS things, so it is a pure function and it is
// asserted directly. A rule you can only check by filling a directory is a rule nobody checks
// twice, and the one time it matters is the time it deleted the copy somebody wanted.

test('retention keeps the newest per memory and the newest overall, and says which bound bit', () => {
	// Ids sort by time because they begin with the timestamp; these stand in for it.
	const header = (n, memory) => ({ snapshot_id: `2026090${n}T000000000Z-${'0'.repeat(12)}`, memory_id: memory });

	const bounds = { per_memory: 2, per_vault: 10 };
	const headers = [
		header(1, 'a'),
		header(2, 'a'),
		header(3, 'a'),
		header(4, 'b'),
	];

	const verdict = applyRetention(headers, bounds);
	assert.deepEqual(
		verdict.keep.sort(),
		[header(2, 'a').snapshot_id, header(3, 'a').snapshot_id, header(4, 'b').snapshot_id].sort(),
		'the two newest of memory a and the only one of memory b should survive',
	);
	assert.deepEqual(verdict.prune, [header(1, 'a').snapshot_id]);
	assert.equal(
		verdict.reasons[header(1, 'a').snapshot_id],
		'per_memory',
		'the reason a snapshot was pruned is reported, because "it vanished" is not something a ' +
			'user can act on and "the newest 2 of this memory are kept" is',
	);
});

test('the per-vault bound bites even when no memory is over its own bound', () => {
	// The bound that makes the store finite. Without it, a vault with a thousand memories has a
	// thousand times the per-memory ceiling and the rule is not a bound at all.
	const headers = Array.from({ length: 6 }, (_, index) => ({
		snapshot_id: `2026090${index + 1}T000000000Z-${'0'.repeat(12)}`,
		memory_id: `mem-${index}`,
	}));

	const verdict = applyRetention(headers, { per_memory: 20, per_vault: 4 });
	assert.equal(verdict.keep.length, 4);
	assert.equal(verdict.prune.length, 2);
	for (const id of verdict.prune) assert.equal(verdict.reasons[id], 'per_vault');
	assert.ok(
		verdict.keep.every((id) => id > verdict.prune.at(-1)),
		'the survivors are the newest, so the oldest are what a full store loses',
	);
});

test('a run of creates does not evict itself under a bound written about one memory', () => {
	// A create has no memory to key on. Grouping every create together would make the per-memory
	// bound apply to "all creates ever", so the twenty-first create would delete the first — which
	// is not what the published rule says.
	const headers = Array.from({ length: 5 }, (_, index) => ({
		snapshot_id: `2026090${index + 1}T000000000Z-${'0'.repeat(12)}`,
		memory_id: null,
	}));

	const verdict = applyRetention(headers, { per_memory: 1, per_vault: 100 });
	assert.equal(verdict.prune.length, 0, 'creates were pruned under a per-MEMORY bound');
});

test('the retention rule is published as prose beside the numbers it describes', () => {
	// A bound nobody can read is a bound a user discovers by loss. The prose has to name both
	// numbers, so a rule changed in one place and not the other is visible rather than silent.
	assert.match(RETENTION.rule, new RegExp(String(RETENTION.per_memory)));
	assert.match(RETENTION.rule, new RegExp(String(RETENTION.per_vault)));
});

test('a snapshot id is the only shape that reaches a path', () => {
	// The id arrives from a URL. Every one of these is a path this store must never resolve.
	for (const hostile of [
		'../../../../etc/passwd',
		'20260901T000000000Z-000000000000/../../x',
		'..',
		'',
		'20260901T000000000Z',
		'20260901T000000000Z-ZZZZZZZZZZZZ',
	]) {
		assert.equal(isSnapshotId(hostile), false, `${JSON.stringify(hostile)} was accepted as an id`);
	}
	assert.equal(isSnapshotId('20260901T142233123Z-abcdef012345'), true);
});

test('two vaults never share a store, and a vault with no identity gets no store at all', () => {
	const a = vaultKey({ root: '/one', workspace_id: 'w1' });
	const b = vaultKey({ root: '/two', workspace_id: 'w1' });
	const c = vaultKey({ root: '/one', workspace_id: 'w2' });
	assert.notEqual(a, b, 'two roots keyed to the same store');
	assert.notEqual(a, c, 'two workspaces in one root keyed to the same store');

	assert.doesNotMatch(a, /one/, 'the key spells the vault path, which is where somebody keeps memory');

	assert.throws(
		() => vaultKey({}),
		SnapshotFailedError,
		'a store with no vault identity would mix two vaults in one directory',
	);
});

test('the state directory is honoured from the environment and is not a cache directory', () => {
	const named = resolveStateDirectory({ KALEIDOSCOPE_UI_STATE_DIR: '/tmp/named-state' }, 'linux');
	assert.equal(named, '/tmp/named-state');

	// State, not cache. A cache directory is one the operating system may empty without asking, and
	// the one thing this store must not do is vanish between the write it guarded and the moment
	// somebody goes looking for it.
	const linux = resolveStateDirectory({ XDG_STATE_HOME: '/home/user/.local/state' }, 'linux');
	assert.match(linux, /state/);
	assert.doesNotMatch(resolveStateDirectory({ HOME: '/home/user' }, 'darwin'), /Caches/);
});

// =============================================================================================
// PART 2 — the store on disk, with the export door faked
// =============================================================================================
//
// The engine is not involved in these: the export door is injected, so the failure paths can be
// driven without breaking a binary, and the assertions are about what this module writes.

function fakeExport(memoryId) {
	// Shaped like the envelope the engine returns, because the store reads two things out of it.
	const envelope = {
		export_kind: 'test.export',
		schema_version: 1,
		payload_sha256: 'not-checked-by-this-module',
		payload: { memories: [{ memory_id: memoryId, semantic: { title: `${memoryId} title` } }] },
	};
	// The engine's own bytes. The store keeps THESE, not a re-serialisation of the object; see
	// test/restore.test.mjs, which measures what happens to an export that was re-emitted.
	return { envelope, text: JSON.stringify(envelope) };
}

function openStore(t, options = {}) {
	const holder = mkdtempSync(join(tmpdir(), 'ui-snapshot-store-'));
	t.after(() => rmSync(holder, { recursive: true, force: true }));
	return {
		holder,
		store: createSnapshotStore({
			vault: { root: '/nowhere/vault', workspace_id: 'wsp-test' },
			exportMemory: async (id) => fakeExport(id),
			directory: holder,
			...options,
		}),
	};
}

test('a snapshot is written before it is reported, and it keeps the export door’s own bytes', async (t) => {
	const { store } = openStore(t);

	const taken = await store.take({ memory_id: 'mem-1', version_id: 'ver-1', operation: 'update' });
	assert.ok(isSnapshotId(taken.snapshot_id));
	assert.equal(taken.operation, 'update');
	assert.equal(taken.prior, 'captured');
	assert.equal(taken.restorable, false, 'a snapshot that calls itself restorable is the lie');

	const read = await store.read(taken.snapshot_id);
	assert.equal(
		read.export_json,
		fakeExport('mem-1').text,
		'the stored payload is not byte-identical to what the export door produced',
	);
	// Served as TEXT. A parsed object would have to be re-serialised to reach a file, and the
	// engine refuses a re-serialised export on its digest — see test/restore.test.mjs.
	assert.equal(typeof read.export_json, 'string');
});

test('a create is snapshotted too, and its record says there was nothing there', async (t) => {
	// "Every write is preceded by a snapshot" with no exception is a rule a reader can hold. One
	// with an exception is a rule somebody applies to the next route, which will be a route that
	// needed the copy.
	const { store } = openStore(t);
	const taken = await store.take({ memory_id: null, operation: 'create' });
	assert.equal(taken.prior, 'absent');
	assert.equal(taken.payload_file, null);
	assert.equal((await store.list()).stored, 1, 'the create left no record in the store');
});

test('a suppressed snapshot is recorded as suppressed, never skipped', async (t) => {
	// PRD 0004 §3.3: the escalation path must not write a fresh plaintext copy of the secret the
	// user is removing. The answer is a record that says the bytes were not captured and why —
	// not an absent record, which is indistinguishable from a spine that failed.
	const { store } = openStore(t);
	const taken = await store.take({
		memory_id: 'mem-secret',
		version_id: 'ver-1',
		operation: 'remove',
		suppressed: 'this memory contains a secret',
	});
	assert.equal(taken.prior, 'not-captured');
	assert.equal(taken.payload_file, null);
	assert.equal(taken.suppressed_reason, 'this memory contains a secret');
	assert.equal((await store.list()).stored, 1, 'a suppressed snapshot left no trace of itself');
});

test('an export door that answers with nothing is a failure, not a snapshot', async (t) => {
	// A refusal spelled as an answer. Filing an empty envelope under a memory's name would produce
	// a store full of files that look like copies and are not.
	const { store } = openStore(t, {
		exportMemory: async () => ({ envelope: { payload: { memories: [] } }, text: '{}' }),
	});
	await assert.rejects(
		store.take({ memory_id: 'mem-gone', version_id: 'ver-1', operation: 'update' }),
		SnapshotFailedError,
	);
	assert.equal((await store.list()).stored, 0, 'a failed snapshot left a record behind');
});

test('an export door that answers without the engine’s bytes is a failure', async (t) => {
	// The only copy the store could keep would be one this app re-serialised, and the import door
	// refuses those on their digest. Better to stop the write than to file a copy that is refused
	// at the moment somebody finally needs it.
	const { store } = openStore(t, {
		exportMemory: async (id) => ({ envelope: fakeExport(id).envelope, text: '' }),
	});
	await assert.rejects(
		store.take({ memory_id: 'mem-1', version_id: 'ver-1', operation: 'update' }),
		SnapshotFailedError,
	);
});

test('retention is enforced on the disk, not only in the arithmetic', async (t) => {
	const { store } = openStore(t, { retention: { per_memory: 2, per_vault: 10 } });

	const taken = [];
	for (let index = 0; index < 4; index += 1) {
		taken.push(await store.take({ memory_id: 'mem-1', version_id: `ver-${index}`, operation: 'update' }));
	}

	const listing = await store.list();
	assert.equal(listing.stored, 2, `the store holds ${listing.stored} snapshots against a bound of 2`);
	assert.deepEqual(
		listing.snapshots.map((one) => one.snapshot_id),
		[taken[3].snapshot_id, taken[2].snapshot_id],
		'the survivors are the two newest, newest first',
	);

	// The files went with them. A retention rule that empties an index and leaves the payloads is a
	// store that grows without limit while reporting that it does not.
	const files = readdirSync(store.directory);
	assert.equal(files.length, 4, `the directory holds ${files.length} files for 2 snapshots: ${files}`);

	// And the pruned ones are gone from the read door too, with the rule named in the refusal.
	assert.equal(await store.read(taken[0].snapshot_id), null);
});

test('a snapshot whose bytes were tampered with is refused rather than served', async (t) => {
	// Serving bytes that do not match the header would be this module telling the user it kept
	// something it did not keep.
	const { store } = openStore(t);
	const taken = await store.take({ memory_id: 'mem-1', version_id: 'ver-1', operation: 'update' });
	writeFileSync(join(store.directory, taken.payload_file), '{"tampered":true}');
	await assert.rejects(store.read(taken.snapshot_id), SnapshotFailedError);
});

test('reading the store never creates it', async (t) => {
	// The sweep in test/server.test.mjs walks every route on a machine that has never written a
	// snapshot. A listing that created a directory would make a read a write.
	const { store } = openStore(t);
	assert.equal(await store.exists(), false);
	const listing = await store.list();
	assert.equal(listing.stored, 0);
	assert.equal(listing.restore_available, false);
	assert.equal(await store.exists(), false, 'listing an empty store created it');
});

// =============================================================================================
// PART 3 — the spine, through the HTTP surface, against a real vault
// =============================================================================================

function httpRequest({ port, method = 'GET', path = '/', headers = {}, body = null, timeoutMs = 60_000 }) {
	return new Promise((resolve, reject) => {
		const payload = body === null ? null : JSON.stringify(body);
		const request = httpRequestRaw({
			host: '127.0.0.1',
			port,
			method,
			path,
			headers: {
				host: `127.0.0.1:${port}`,
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
		request.on('error', reject);
		request.on('response', (response) => {
			const seen = { status: response.statusCode, body: '' };
			response.setEncoding('utf8');
			response.on('data', (chunk) => (seen.body += chunk));
			response.on('end', () => resolve(seen));
			response.on('error', reject);
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

/**
 * A sidecar over a cloned vault, with its snapshot store pointed at a directory this test made.
 *
 * The redirect is what keeps a test run from writing into the developer's own state directory —
 * and the assertion below that the store is outside the vault is made against the DEFAULT
 * placement as well, so the redirect cannot hide a store that would otherwise land inside.
 */
async function openSidecar(t, label) {
	const engine = await locateEngine({});
	const scratch = openScratchVault({ enginePath: engine.path, label });
	t.after(() => scratch.close());

	const holder = mkdtempSync(join(tmpdir(), 'ui-snapshot-state-'));
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
	return { engine, scratch, sidecar, stateDir: holder };
}

test('the clone ritual redirects this app’s state, not only the vault', async (t) => {
	// The suite's other write tests start a sidecar with default options, so without this the
	// snapshot spine would file the contents of a cloned vault into the developer's own home on
	// every run and prune it against a retention rule nobody asked for. That is the same class of
	// mistake as writing to the source vault, one directory over — so it is asserted here rather
	// than left to whoever adds the next test file.
	const engine = await locateEngine({});
	const scratch = openScratchVault({ enginePath: engine.path, label: 'snapshot-state-redirect' });
	try {
		assert.ok(
			scratch.state_dir && process.env.KALEIDOSCOPE_UI_STATE_DIR === scratch.state_dir,
			`openScratchVault left this app's state directory pointing at the platform default ` +
				`(${process.env.KALEIDOSCOPE_UI_STATE_DIR ?? 'unset'}), so a default-options sidecar ` +
				`in any test file would write snapshots into the developer's home.`,
		);
		assert.equal(
			resolveStateDirectory(),
			scratch.state_dir,
			'the store resolves somewhere other than where the clone ritual pointed it',
		);
	} finally {
		scratch.close();
	}
	assert.notEqual(
		process.env.KALEIDOSCOPE_UI_STATE_DIR,
		scratch.state_dir,
		'closing the scratch vault left the redirect in place, so it leaks into the next test file',
	);
});

/** A payload built from vocabulary the engine printed a moment ago. Nothing is transcribed. */
async function buildDelta(sidecar, title) {
	const readings = json(
		await authorised(sidecar, { path: '/api/preflight' }),
		'GET /api/preflight',
	);
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

const composeBody = (title, prose) => `# ${title}\n\n${prose}\n`;

test('every write through the HTTP surface is preceded by a snapshot', async (t) => {
	const { sidecar, scratch } = await openSidecar(t, 'snapshot-spine');

	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(
		beforeExposure.stores > 0,
		`No search-exposure store was found in the clone, so the count at the end of this file is ` +
			`zero compared against zero and passes hardest when it is broken.`,
	);

	const { delta } = await buildDelta(sidecar, `${MARK} the memory the spine copies`);

	// ---- the create ----------------------------------------------------------------------------

	const created = json(
		await authorised(sidecar, {
			method: 'POST',
			path: '/api/memories',
			body: { content_md: composeBody(delta.title, 'A memory this test created.'), semantic_delta: delta },
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'POST /api/memories',
	);
	assert.equal(created.outcome, 'applied', `the create did not apply: ${JSON.stringify(created).slice(0, 400)}`);

	const memoryId = created.data.memory_id;

	await t.test('the create carried a snapshot receipt, and it says there was nothing there', () => {
		assert.ok(created.snapshot, 'the create response carried no snapshot receipt');
		assert.equal(created.snapshot.operation, 'create');
		assert.equal(created.snapshot.prior, 'absent');
		assert.equal(
			created.snapshot.restorable,
			false,
			'a receipt that calls itself restorable would put a restore button on a screen that has ' +
				'nothing to route it to',
		);
	});

	// ---- the update ----------------------------------------------------------------------------

	const loaded = json(
		await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(memoryId)}/edit` }),
		'the editor load',
	);

	const edited = json(
		await authorised(sidecar, {
			method: 'POST',
			path: `/api/memories/${encodeURIComponent(memoryId)}`,
			body: {
				expected_version_id: loaded.expected_version_id,
				content_md: composeBody(delta.title, 'A memory this test created, then edited.'),
				semantic_delta: loaded.semantic_delta,
			},
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'the update',
	);
	assert.equal(edited.outcome, 'applied', `the update did not apply: ${JSON.stringify(edited).slice(0, 400)}`);

	await t.test('the update was preceded by a snapshot of the version it replaced', async () => {
		assert.ok(edited.snapshot, 'the update response carried no snapshot receipt');
		assert.equal(edited.snapshot.operation, 'update');
		assert.equal(edited.snapshot.memory_id, memoryId);
		assert.equal(
			edited.snapshot.version_id,
			loaded.expected_version_id,
			'the snapshot names a different version from the one the write replaced, so it is not a ' +
				'copy of what the user was editing',
		);
		assert.ok(edited.snapshot.payload_bytes > 0, 'the snapshot captured no bytes');

		// It is on disk, it is readable, and it is the memory it says it is.
		const record = await sidecar.snapshots.read(edited.snapshot.snapshot_id);
		assert.ok(record, 'the snapshot the receipt named is not in the store');
		const exported = JSON.parse(record.export_json);
		assert.equal(exported.payload.memories.length, 1);
		assert.equal(exported.payload.memories[0].memory_id, memoryId);
		assert.equal(
			exported.payload.memories[0].version_id,
			loaded.expected_version_id,
			'the copy is of a different version from the one the write was about to replace',
		);
	});

	await t.test('the snapshot is served whole through its own route, as bytes', async () => {
		const response = await authorised(sidecar, { path: edited.snapshot.href });
		assert.equal(response.status, 200, `GET ${edited.snapshot.href} answered ${response.status}`);
		const payload = json(response, `GET ${edited.snapshot.href}`);
		assert.equal(payload.restore_available, false, 'the read door offers a restore');
		assert.equal(
			typeof payload.snapshot.export_json,
			'string',
			'the export reaches the browser as a parsed object, so the file a user saves would be a ' +
				're-serialisation — which the import door refuses on its digest',
		);
		// This is what a person saves. It has to parse, and it has to be the memory.
		const exported = JSON.parse(payload.snapshot.export_json);
		assert.equal(exported.payload.memories[0].memory_id, memoryId);
	});

	await t.test('both writes are listed for this memory and for the vault', async () => {
		const forMemory = json(
			await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(memoryId)}/snapshots` }),
			'the per-memory listing',
		);
		assert.equal(forMemory.matched, 1, 'the memory has a number of snapshots this test did not take');
		assert.equal(forMemory.snapshots[0].snapshot_id, edited.snapshot.snapshot_id);

		const all = json(await authorised(sidecar, { path: '/api/snapshots' }), 'the store listing');
		assert.equal(all.stored, 2, `the store holds ${all.stored} snapshots for two writes`);
		assert.equal(
			all.matched,
			2,
			'the unfiltered listing matched fewer than it stored, so a screen would report a store ' +
				'smaller than it is',
		);
		// The rule is published beside the count, so a user near the ceiling can see it.
		assert.equal(all.retention.per_memory, RETENTION.per_memory);
		assert.equal(all.retention.per_vault, RETENTION.per_vault);
		assert.ok(all.retention.rule.length > 0);
		assert.equal(all.restore_available, false);
	});

	await t.test('a snapshot that is not in the store is a 404 that names the retention rule', async () => {
		const response = await authorised(sidecar, {
			path: '/api/snapshots/20200101T000000000Z-abcdef012345',
		});
		assert.equal(response.status, 404);
		const payload = json(response, 'the missing-snapshot response');
		assert.match(payload.error.message, new RegExp(String(RETENTION.per_memory)));
	});

	await t.test('a hostile snapshot id reads nothing outside the store', async () => {
		for (const hostile of ['..', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '.%2E']) {
			const response = await authorised(sidecar, { path: `/api/snapshots/${hostile}` });
			assert.ok(
				response.status === 404 || response.status === 400,
				`GET /api/snapshots/${hostile} answered ${response.status}`,
			);
		}
	});

	await t.test('THE STORE IS OUTSIDE THE VAULT', async () => {
		assert.equal(
			await sidecar.snapshots.insideVault(scratch.root),
			false,
			`The snapshot store is at ${sidecar.snapshots.directory}, inside the vault at ` +
				`${scratch.root}. Snapshots written into the vault appear in the user's own memory ` +
				`list, are carried by the export door, and are retrieved by their agents.`,
		);

		// Asserted for the PLATFORM DEFAULT too, not only the placement this test redirected — and
		// with the redirect lifted, because a check that only ever saw the override would pass with
		// the real default landing inside the vault.
		const override = process.env.KALEIDOSCOPE_UI_STATE_DIR;
		delete process.env.KALEIDOSCOPE_UI_STATE_DIR;
		try {
			const defaulted = createSnapshotStore({
				vault: { root: scratch.root, workspace_id: 'wsp-test' },
				exportMemory: async () => ({ envelope: null, text: '' }),
			});
			assert.equal(
				await defaulted.insideVault(scratch.root),
				false,
				`With no directory named, the store resolves to ${defaulted.directory}, which is ` +
					`inside the vault.`,
			);
			assert.equal(
				await defaulted.exists(),
				false,
				'constructing a store created a directory in the developer\'s own state area',
			);
		} finally {
			if (override === undefined) delete process.env.KALEIDOSCOPE_UI_STATE_DIR;
			else process.env.KALEIDOSCOPE_UI_STATE_DIR = override;
		}

		// And nothing of this app's is inside the vault under any name.
		assert.equal(
			existsSync(join(scratch.root, 'snapshots')),
			false,
			'a snapshots directory appeared inside the vault',
		);
	});

	await t.test('none of it recorded a ranked search', () => {
		const after = countExposureRecords(scratch.root);
		assert.equal(
			after.records,
			beforeExposure.records,
			`The snapshot spine wrote ${after.records - beforeExposure.records} search-exposure ` +
				`record(s). A snapshot is an export addressed by id; it must cost the vault nothing ` +
				`but a read.`,
		);
	});
});

test('a snapshot that cannot be written stops the write, and the vault is untouched', async (t) => {
	// The property the whole spine rests on. A store that skipped when the disk was full would
	// leave the screen still saying a copy was kept — a safety net that is not there is worse than
	// no safety net, because the user stops keeping their own copies.
	const { sidecar, scratch } = await openSidecar(t, 'snapshot-blocks');

	const { delta } = await buildDelta(sidecar, `${MARK} the memory that must not be written`);

	// Break the store the way a real machine breaks it: the directory it must write into cannot be
	// created, because a FILE is sitting where it belongs. Nothing about the engine is touched.
	const broken = join(sidecar.snapshots.state_directory, 'snapshots');
	rmSync(broken, { recursive: true, force: true });
	writeFileSync(broken, 'a file where the store needs a directory');

	const fingerprintBefore = fingerprintVault(scratch.root);

	const response = await authorised(sidecar, {
		method: 'POST',
		path: '/api/memories',
		body: { content_md: composeBody(delta.title, 'This must never reach the vault.'), semantic_delta: delta },
		timeoutMs: WRITE_TIMEOUT_MS,
	});

	assert.notEqual(
		response.status,
		200,
		`The write answered 200 with the snapshot store broken. Body:\n${response.body.slice(0, 400)}`,
	);
	const payload = json(response, 'the blocked write');
	assert.equal(payload.outcome, 'sidecar_error', 'a failed snapshot was reported as something else');
	assert.equal(payload.error.kind, 'snapshot-failed');
	assert.equal(
		payload.error.vault_changed,
		false,
		'the refusal does not say the vault was left alone, which is the one thing the user needs ' +
			'to know at that moment',
	);
	assert.ok(
		payload.error.directory && payload.error.directory.length > 0,
		'the refusal names no directory, so a full disk and a permissions problem are the same ' +
			'message and neither is actionable',
	);

	assert.deepEqual(
		fingerprintVault(scratch.root),
		fingerprintBefore,
		'The write was refused for a failed snapshot and the vault moved anyway. A refusal that has ' +
			'already written is not a refusal.',
	);
});
