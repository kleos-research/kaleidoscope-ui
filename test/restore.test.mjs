// Can a snapshot bring a removed memory back?
//
// PRD 0004 §3.5 says plainly that this "has never been demonstrated" and refuses to promise it, and
// R9 says a regression test is the thing that authorises any copy change. This file is that test,
// and it is written in the direction R9 asks for: it asserts what was OBSERVED, refusal by refusal,
// so a build that starts permitting a restore turns this file red. A red test here is not a
// regression — it is the falsification arriving, and it is what licenses the product to say there
// is an undo. Until then the copy stands: there is no un-remove.
//
// The answer, so nobody has to run it to find out: NO. `docs/DECISIONS.md` has the finding and
// the control behind it; the assertions below are the mechanism.
//
// -------------------------------------------------------------------------------------------
// WHY THIS FILE CREATES VAULTS INSTEAD OF CLONING ONE
// -------------------------------------------------------------------------------------------
//
// Every other test file clones the vault named by KALEIDOSCOPE_TEST_VAULT, which is the ritual that
// keeps a write away from a vault a person uses. This file needs something a clone cannot give it:
// an EMPTY destination. The import door refuses any destination holding memories the package does
// not carry, so the one route that works can only be shown on a vault with nothing in it — and
// re-importing a three-hundred-memory clone to make a point about one memory would be a slow way to
// measure the same thing.
//
// So every vault here is created by `kscope init` inside a fresh mkdtemp directory, every command
// names its root explicitly rather than inheriting one from the environment, and the engine is
// asked — through its own door — which root it resolved before the first write. That is strictly
// safer than cloning rather than a relaxation of it: no vault that existed before this file ran is
// opened at all.
//
// -------------------------------------------------------------------------------------------
// WHY THIS FILE SPAWNS THE ENGINE ITSELF
// -------------------------------------------------------------------------------------------
//
// The shipped client composes a request by serialising an object, and the subject of this file is a
// door that will not accept that. The export envelope carries a digest over the payload AS THE
// ENGINE SERIALISED IT; a JSON round trip through this runtime turns `0.0` into `0` and the digest
// stops matching. So the import attempts below are assembled from the engine's own bytes, spliced
// into a request as text, which means writing to a child's stdin directly.
//
// That is the same exemption `test/helpers/vault.mjs` takes and for the same reason: the
// one-spawner rule governs shipped source, and a test whose subject is the wire cannot go through
// something that reshapes it.
//
// -------------------------------------------------------------------------------------------
// THE ONE RANKED SEARCH IN THIS REPOSITORY, AND WHY IT IS HERE
// -------------------------------------------------------------------------------------------
//
// The last assertion runs a ranked query ON PURPOSE, once, against a vault this file created and
// deletes. It is not a caller: no shipped module reaches the ranked door, the HTTP surface has no
// route to it, and `test/server.test.mjs` and `test/editor.test.mjs` both count exposure rows to
// keep that true.
//
// It is here because the assertion beside it — "the experiment wrote no exposure row" — compares
// zero against zero on a vault that has no exposure store at all, and a check like that passes
// hardest at the moment it is broken. Running one query on a throwaway vault and watching the
// census move is the known-positive that turns the other assertion from a hope into a measurement.
// Delete the positive control and the negative one stops meaning anything.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { preflight } from '../src/engine/preflight.mjs';
import { countExposureRecords } from './helpers/vault.mjs';

/** Invented surfaces, prefixed so nothing here could collide with a real name. */
const MARK = 'ui-restore-probe';

/** A body token that would be findable on disk, which is PRD 0004 §6's falsification probe. */
const BODY_TOKEN = 'RESTOREPROBE7Q2X';

let ENGINE = null;

// ---------------------------------------------------------------------------------------------
// The engine, addressed directly, one call at a time
// ---------------------------------------------------------------------------------------------

/**
 * One `kscope` invocation, with its root named through the environment and its request written to
 * stdin AS TEXT.
 *
 * Text is the point. Every assertion about the import door depends on the payload reaching it
 * byte-for-byte as the export door produced it.
 *
 * The exit code is returned rather than thrown on, and stderr is captured and never consulted for a
 * decision — a resolved call writes its provenance to stderr ON SUCCESS, so a wrapper that read it
 * as failure would fail on every healthy call.
 */
function kscope(args, { root, stdin = '' } = {}) {
	const child = spawnSync(ENGINE, args, {
		encoding: 'utf8',
		shell: false,
		input: stdin,
		maxBuffer: 256 * 1024 * 1024,
		env: root ? { ...process.env, KSCOPE_ROOT: root } : process.env,
	});
	if (child.error) throw child.error;
	return { code: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

/** A call that must succeed. Returns the parsed response and the engine's own bytes beside it. */
function ok(root, operation, requestText, where) {
	const result = kscope(['call', operation], { root, stdin: requestText });
	assert.equal(
		result.code,
		0,
		`${where} exited ${result.code} and was expected to apply.\n` +
			`stdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
	);
	return { data: JSON.parse(result.stdout), text: result.stdout };
}

/**
 * A call that must be REFUSED, returning the refusal so an assertion can quote it.
 *
 * Failing when the call SUCCEEDS is the whole point: "it worked" is the outcome this file exists to
 * detect, and the message says what to do about it rather than treating it as breakage.
 */
function refused(root, operation, requestText, where) {
	const result = kscope(['call', operation], { root, stdin: requestText });
	if (result.code === 0) {
		assert.fail(
			`${where} was expected to be REFUSED and it applied.\n\n` +
				`That is the falsification PRD 0004 R9 asks for, and it is welcome — but it is a copy ` +
				`change, not a test to relax. Re-run every door in docs/DECISIONS.md against a ` +
				`throwaway vault, ` +
				`and if a removed memory really can be returned to service then the removal flow may ` +
				`say so, this assertion becomes the assertion that it can, and src/server/snapshots.mjs ` +
				`grows the restore route it deliberately does not have.\n\n` +
				`The call returned: ${result.stdout.slice(0, 600)}`,
		);
	}
	assert.equal(
		result.code,
		2,
		`${where} exited ${result.code}. A refusal is exit 2 with an envelope on stdout; anything ` +
			`else is a different situation and must not be read as "it said no".\n` +
			`stdout: ${result.stdout.slice(0, 300)}\nstderr: ${result.stderr.slice(0, 300)}`,
	);
	assert.ok(result.stdout.trim().length > 0, `${where} refused with an empty stdout`);
	return JSON.parse(result.stdout);
}

/**
 * A brand-new vault in a fresh temporary directory.
 *
 * The engine is asked, through `where`, which root it resolves for this path, and the answer has to
 * BE this path before anything is written. Same gate the clone helper applies, same reason: a test
 * that silently ran against a different vault is the failure nobody can debug from the outside.
 */
function makeVault(t, label) {
	const holder = mkdtempSync(join(tmpdir(), `${MARK}-${label}-`));
	const root = join(holder, 'vault');
	t.after(() => rmSync(holder, { recursive: true, force: true }));

	// A fixed created_at keeps the vault's identity a function of this call rather than of the
	// clock, which is one fewer thing that differs between two runs of the same assertion.
	const init = kscope(['init', root, '2026-09-01T00:00:00Z', 'process-local']);
	assert.equal(
		init.code,
		0,
		`kscope init would not create a vault at ${root}. It exited ${init.code} and said:\n` +
			`${(init.stdout + init.stderr).trim()}\n\nThis is not a skip.`,
	);

	const where = kscope(['where'], { root });
	assert.equal(where.code, 0, `the engine would not resolve the vault this test just created`);
	const address = JSON.parse(where.stdout);
	assert.equal(
		address.root,
		root,
		`The engine resolved ${address.root} for a root this test created at ${root}. Refusing to ` +
			`continue: a write from here would land somewhere this file did not make.`,
	);
	assert.equal(
		address.root_source,
		'environment',
		`The engine resolved the right path from the wrong place (${address.root_source}).`,
	);

	return { root, workspace_id: address.workspace_id };
}

// ---------------------------------------------------------------------------------------------
// A memory built from vocabulary the engine printed a moment ago
// ---------------------------------------------------------------------------------------------

function pickKnown(vocabulary, path, index = 0) {
	const known = vocabulary.known?.[path] ?? vocabulary.closed?.[path] ?? [];
	const denied = new Set(vocabulary.denied?.[path] ?? []);
	const offered = known.filter((value) => !denied.has(value));
	assert.ok(
		offered.length > index,
		`The write contract named ${offered.length} usable value(s) at ${path}; this needs ` +
			`${index + 1}. Nothing here may be written down instead.`,
	);
	return offered[index];
}

/**
 * The delta for the probe memory. Every vocabulary value comes from a runtime reading — the
 * predicate and the entity kind from the write contract the engine printed, the memory type from
 * the workspace's own declarable list. None of it is transcribed.
 */
function probeDelta(readings, title) {
	const vocabulary = readings.vocabulary;
	const memoryType = (vocabulary.memory_types ?? vocabulary.declarable_memory_types ?? [])[0];
	assert.ok(
		typeof memoryType === 'string' && memoryType.length > 0,
		`The engine published no memory type this workspace declares or would accept, so a create ` +
			`here could only name one written down in this file.`,
	);

	const kind = pickKnown(vocabulary, 'semantic_delta.entities.kind');
	const subject = `${MARK} subject`;
	const object = `${MARK} object`;

	return {
		title,
		memory_type: memoryType,
		entities: [
			{ n: subject, kind, is: `${subject} | ${kind} | invented by a test, declared by it` },
			{ n: object, kind, is: `${object} | ${kind} | invented by a test, declared by it` },
		],
		facts: [
			{ subject, predicate: pickKnown(vocabulary, 'semantic_delta.facts.predicate'), object },
		],
	};
}

const probeBody = (delta) =>
	`# ${delta.title}\n\nUnique token ${BODY_TOKEN} so the bytes can be found on disk.\n`;

const statementsOf = (facts) =>
	facts.map((fact) => `${fact.subject}|${fact.predicate}|${fact.object}`).sort();

/**
 * An import request built from the export door's OWN BYTES, spliced in as text.
 *
 * Nothing here parses and re-emits the envelope. That is not tidiness — the sub-test below measures
 * what happens when something does.
 */
const importRequest = (exportText, key) =>
	`{"export":${exportText},"idempotency_key":${JSON.stringify(key)}}`;

// =============================================================================================
// THE EXPERIMENT
// =============================================================================================

test('a snapshot cannot return a removed memory to service, and every door says so differently', async (t) => {
	const engine = await locateEngine({});
	ENGINE = engine.path;
	t.diagnostic(`engine ${engine.path} (found by ${engine.source})`);

	const vault = makeVault(t, 'vault');
	t.diagnostic(`vault created by this file and deleted after it: ${vault.root}`);

	const readings = await preflight({ explicit: engine.path, root: vault.root });
	assert.ok(
		readings.gate?.call_permitted,
		`The licence gate refuses the only door this experiment has: ${readings.gate?.reason}. ` +
			`Nothing below could run, so this fails rather than skipping.`,
	);
	t.diagnostic(`engine version ${readings.engine.version}`);

	// ---- 1. a memory, and the two export shapes taken BEFORE it is removed ---------------------

	const delta = probeDelta(readings, `${MARK} the memory this experiment removes`);
	const created = ok(
		vault.root,
		'remember',
		JSON.stringify({ mode: 'create', content_md: probeBody(delta), semantic_delta: delta }),
		'the probe create',
	).data;
	assert.equal(created.canonical_effect, 'committed', 'the probe memory was not created');

	const memoryId = created.memory_id;
	const liveVersion = created.version_id;
	assert.ok(memoryId && liveVersion, 'the create named no memory or no version');

	// The two shapes an export can take. Which one a snapshot IS turns out to decide everything.
	const singleBefore = ok(
		vault.root,
		'memory_lifecycle',
		JSON.stringify({ mode: 'export', memory_id: memoryId }),
		'the single-memory export before removal',
	);
	const wholeBefore = ok(
		vault.root,
		'memory_lifecycle',
		JSON.stringify({ mode: 'export' }),
		'the whole-workspace export before removal',
	);

	assert.equal(
		singleBefore.data.payload.memories.length,
		1,
		'the single-memory export carried no record, so there is no snapshot to try to restore',
	);
	assert.ok(
		wholeBefore.data.payload.memories.some((record) => record.memory_id === memoryId),
		'the whole-workspace export did not carry the memory it was taken to carry',
	);

	// ---- 2. remove it ---------------------------------------------------------------------------

	const removed = ok(
		vault.root,
		'remember',
		JSON.stringify({
			mode: 'delete',
			memory_id: memoryId,
			expected_version_id: liveVersion,
		}),
		'the removal',
	).data;
	assert.equal(removed.canonical_effect, 'committed', 'the removal did not commit');
	const deadVersion = removed.version_id;

	// ---- 3. what the doors say now ---------------------------------------------------------------

	await t.test('the display door reports it removed and withholds the body', () => {
		const read = ok(
			vault.root,
			'search',
			JSON.stringify({ memory_id: memoryId }),
			'the display door after removal',
		).data;
		assert.notEqual(
			read.status,
			'found',
			`The display door still reports the removed memory as "${read.status}". Removal is ` +
				`supposed to stop this door serving it.`,
		);
		assert.equal(
			read.content_md ?? null,
			null,
			'The display door returned the body of a removed memory. It is supposed to withhold it, ' +
				'and the removal copy is written on the assumption that it does.',
		);
		assert.equal(read.memory_id, memoryId, 'the removed record is no longer addressable by id');
	});

	await t.test('the listing door omits it, and no export taken afterwards can carry it', () => {
		const whole = ok(
			vault.root,
			'memory_lifecycle',
			JSON.stringify({ mode: 'export' }),
			'the whole-workspace export after removal',
		).data;
		assert.equal(
			whole.payload.memories.filter((record) => record.memory_id === memoryId).length,
			0,
			'the whole-workspace export still carries a removed memory',
		);

		const single = ok(
			vault.root,
			'memory_lifecycle',
			JSON.stringify({ mode: 'export', memory_id: memoryId }),
			'the single-memory export after removal',
		).data;
		assert.equal(
			single.payload.memories.length,
			0,
			`The export door still returns a removed memory. That would change the finding: an ` +
				`export taken AFTER a removal would be an artefact a restore could be attempted from, ` +
				`and the snapshot spine would not have to run before the write to be useful.`,
		);
		// It still names what it was asked for, which is how a caller tells "removed" from "you
		// asked for nothing".
		assert.equal(single.payload.selection?.memory_id, memoryId);
	});

	await t.test('the lineage door still reads it, entities and facts intact', () => {
		const lineage = ok(
			vault.root,
			'memory_lifecycle',
			JSON.stringify({ mode: 'lineage', memory_id: memoryId }),
			'the lineage door after removal',
		).data;
		assert.equal(lineage.status, 'found', 'the lineage door stopped reading a removed memory');
		assert.equal(lineage.memory.entities.length, delta.entities.length);
		assert.equal(lineage.memory.facts.length, delta.facts.length);
	});

	// ---- 4. THE CLOSED DOORS ----------------------------------------------------------------------

	await t.test('a per-memory export cannot be imported AT ALL — and that is what a snapshot is', () => {
		// The finding that decides the product. A snapshot is a per-memory export, and the import
		// door will not take one in any state: not the export of the removed memory, and not the
		// export taken while it was alive. Both earn the same sentence.
		const singleAfter = ok(
			vault.root,
			'memory_lifecycle',
			JSON.stringify({ mode: 'export', memory_id: memoryId }),
			'the single-memory export after removal',
		);

		for (const [what, exported] of [
			['the export taken BEFORE removal', singleBefore],
			['the export taken AFTER removal', singleAfter],
		]) {
			const refusal = refused(
				vault.root,
				'memory_import',
				importRequest(exported.text, `${MARK}-single-${what.length}`),
				`importing ${what}`,
			);
			assert.match(
				refusal.message,
				/complete workspace export/i,
				`Importing ${what} was refused for a reason this file did not observe. The refusal ` +
					`measured on 2026-09-01 was, verbatim:\n  "recovery import requires a complete ` +
					`workspace export, not a single-memory selection"\nand the engine said:\n  ` +
					`"${refusal.message}"`,
			);
		}
	});

	await t.test('a whole-workspace export cannot be imported back over the vault it came from', () => {
		const refusal = refused(
			vault.root,
			'memory_import',
			importRequest(wholeBefore.text, `${MARK}-whole-same-vault`),
			'importing the pre-removal whole-workspace export back into the same vault',
		);
		assert.match(
			refusal.message,
			/record already exists/i,
			`Measured on 2026-09-01 the refusal was:\n  "commit_record conflicted: record already ` +
				`exists"\nand the engine said:\n  "${refusal.message}"`,
		);
	});

	await t.test('the write door refuses an update against the removed record', () => {
		const refusal = refused(
			vault.root,
			'remember',
			JSON.stringify({
				mode: 'update',
				memory_id: memoryId,
				expected_version_id: deadVersion,
				content_md: probeBody(delta),
				semantic_delta: delta,
			}),
			'updating the removed memory back into existence',
		);
		assert.match(
			refusal.message,
			/tombstoned/i,
			`Measured on 2026-09-01 the refusal named the tombstone and the version it sits at. The ` +
				`engine said:\n  "${refusal.message}"`,
		);
	});

	await t.test('an export this app re-serialised is refused on its digest', () => {
		// This is why `src/server/snapshots.mjs` keeps TEXT and `exportMemory` returns the engine's
		// own bytes, and it is not a style preference. The envelope is signed over the bytes the
		// engine wrote; a JSON round trip through this runtime turns `0.0` into `0`, the digest
		// stops matching, and the artefact is refused at the moment somebody finally needs it.
		//
		// Asserted here so that a change making the store keep an object instead goes red with a
		// message that says why, rather than producing files that look fine for a year.
		const reserialised = JSON.stringify(JSON.parse(wholeBefore.text));
		assert.notEqual(
			reserialised,
			wholeBefore.text,
			'a JSON round trip preserved the engine\'s bytes exactly on this build, so this ' +
				'assertion is no longer measuring the hazard it was written for — check whether the ' +
				'store may now keep an object, rather than assuming it may not',
		);

		const refusal = refused(
			vault.root,
			'memory_import',
			importRequest(reserialised, `${MARK}-reserialised`),
			'importing an export this runtime parsed and re-emitted',
		);
		assert.match(
			refusal.message,
			/digest does not match/i,
			`Measured on 2026-09-01 the refusal was:\n  "memory export payload digest does not ` +
				`match"\nand the engine said:\n  "${refusal.message}"`,
		);
	});

	// ---- 5. THE ONE ROUTE THAT WORKS, AND WHY IT IS NOT AN UNDO -------------------------------

	const fresh = makeVault(t, 'fresh');

	await t.test('importing into a FRESH, EMPTY vault does restore the memory', () => {
		const imported = ok(
			fresh.root,
			'memory_import',
			importRequest(wholeBefore.text, `${MARK}-whole-fresh`),
			'importing the pre-removal package into an empty vault',
		).data;
		assert.equal(imported.canonical_effect, 'committed', 'the import into an empty vault did not commit');
		assert.equal(imported.memories, 1, 'the import reported a different number of memories');

		const read = ok(
			fresh.root,
			'search',
			JSON.stringify({ memory_id: memoryId }),
			'the display door in the fresh vault',
		).data;
		assert.equal(read.status, 'found', 'the restored memory is not served by the display door');
		assert.equal(read.content_md, probeBody(delta), 'the restored body is not the body exported');

		// SAME IDENTITY, NEW VERSION. Both halves are the finding: the memory keeps its id, so it is
		// the same memory rather than a copy — and it is on a version the original vault never had,
		// so nothing downstream may assume version continuity across a recovery.
		assert.equal(read.memory_id, memoryId, 'the restored memory came back under a different id');
		assert.notEqual(
			read.version_id,
			liveVersion,
			'the restored memory came back on the version it was exported at; a new one was minted ' +
				'when this was measured, and which of the two is true changes what a client can ' +
				'assume about a recovered memory',
		);

		const whole = ok(
			fresh.root,
			'memory_lifecycle',
			JSON.stringify({ mode: 'export' }),
			'the listing door in the fresh vault',
		).data;
		const record = whole.payload.memories.find((one) => one.memory_id === memoryId);
		assert.ok(record, 'the restored memory is not in the listing door');
		assert.deepEqual(
			record.semantic.entities.map((entity) => entity.n).sort(),
			delta.entities.map((entity) => entity.n).sort(),
			'the restored memory declares a different set of names',
		);
		assert.deepEqual(
			statementsOf(record.semantic.facts),
			statementsOf(delta.facts),
			'the restored memory carries different facts',
		);
	});

	await t.test('THE CONTROL: the conflict is not about removal, so nothing can route around it', () => {
		// The assertion that keeps the finding from resting on a guess about what "already exists"
		// means. The same package, imported into the vault where the memory is now present and
		// HEALTHY, under a fresh idempotency key, earns the same sentence.
		//
		// Without this control a reader could reasonably believe the tombstone is what conflicts,
		// and that some future engine would let a removed record be overwritten. It is not the
		// tombstone: the import door refuses to write any record the destination already holds, and
		// a removed record is still a record it holds.
		const refusal = refused(
			fresh.root,
			'memory_import',
			importRequest(wholeBefore.text, `${MARK}-whole-fresh-again`),
			'importing the same package again, under a new key, where the memory is alive',
		);
		assert.match(
			refusal.message,
			/record already exists/i,
			`The control refusal differs from the one measured against the removed record, which ` +
				`would mean the conflict IS about removal after all. The engine said:\n  ` +
				`"${refusal.message}"`,
		);
	});

	await t.test('the same package under the SAME key is replayed, not merged', () => {
		const replay = ok(
			fresh.root,
			'memory_import',
			importRequest(wholeBefore.text, `${MARK}-whole-fresh`),
			'repeating the import under the key that already committed',
		).data;
		assert.equal(
			replay.canonical_effect,
			'replayed',
			'a repeated import under the same key was not replayed, so it is not the idempotent ' +
				'repeat of one recovery',
		);
		assert.equal(replay.committed_records, 0, 'a replayed import committed records');
	});

	const occupied = makeVault(t, 'occupied');

	await t.test('a destination holding any memory of its own is refused outright', () => {
		const other = probeDelta(readings, `${MARK} an unrelated memory`);
		const seeded = ok(
			occupied.root,
			'remember',
			JSON.stringify({ mode: 'create', content_md: probeBody(other), semantic_delta: other }),
			'seeding the occupied vault',
		).data;
		assert.equal(seeded.canonical_effect, 'committed', 'the unrelated memory was not created');

		const refusal = refused(
			occupied.root,
			'memory_import',
			importRequest(wholeBefore.text, `${MARK}-whole-occupied`),
			'importing into a vault that already holds a memory of its own',
		);
		assert.match(
			refusal.message,
			/outside this recovery package/i,
			`Measured on 2026-09-01 the refusal was:\n  "destination contains user memories outside ` +
				`this recovery package"\nand the engine said:\n  "${refusal.message}"`,
		);
	});

	// ---- 6. the exposure census, and the positive control that makes it mean something ----------

	await t.test('the whole experiment recorded no ranked search', () => {
		const experiment = countExposureRecords(vault.root);
		assert.equal(
			experiment.records,
			0,
			`The experiment wrote ${experiment.records} search-exposure record(s) into the vault it ` +
				`was measuring. Every read above is addressed by id or is an export; none of them ` +
				`should record that it ran.`,
		);

		// THE POSITIVE CONTROL. Zero against zero on a vault with no exposure store is a check that
		// passes hardest when it is broken, so the census is shown to be capable of moving — on a
		// vault this file created for the purpose and deletes on the way out.
		const before = countExposureRecords(occupied.root);
		const query = kscope(['call', 'search'], {
			root: occupied.root,
			stdin: JSON.stringify({ query: `${MARK} does the census move` }),
		});
		assert.equal(query.code, 0, `the control query exited ${query.code}: ${query.stderr.slice(0, 300)}`);
		const after = countExposureRecords(occupied.root);

		assert.ok(
			after.stores > before.stores || after.records > before.records,
			`One ranked query moved neither the store count (${before.stores} → ${after.stores}) ` +
				`nor the record count (${before.records} → ${after.records}). The census cannot see ` +
				`what it claims to count, so the assertion above is measuring nothing and every ` +
				`exposure count in this repository needs re-checking.`,
		);
		t.diagnostic(
			`census control: one ranked query moved stores/records ${before.stores}/${before.records} ` +
				`to ${after.stores}/${after.records}`,
		);
	});

	// ---- 7. PRD 0004 §6's falsification probe: do the bytes survive? ---------------------------

	await t.test('the removed memory’s text is still on disk, so the honest copy is still correct', () => {
		// If this ever comes back empty, removal IS erasure, the copy is over-cautious, and PRD 0004
		// should be rewritten around a plainer word. Run on every engine release, not once — the day
		// it starts passing is the day nobody would otherwise notice.
		const found = spawnSync('grep', ['-rl', BODY_TOKEN, vault.root], { encoding: 'utf8' });
		const hits = (found.stdout ?? '').split('\n').filter(Boolean);
		assert.ok(
			hits.length > 0,
			`The removed memory's body token was not found anywhere in the vault folder. If that is ` +
				`real, removal erases after all and the removal copy may be plainer — but check the ` +
				`probe first: a grep that cannot read the vault reports the same thing.`,
		);
		t.diagnostic(`${hits.length} file(s) in the vault still carry the removed memory's text`);
	});
});
