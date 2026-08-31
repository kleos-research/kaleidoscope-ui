// Milestone 1, and the whole of it.
//
// M1 has no browser, no framework and no server. It exists to prove one seam,
// and it is the seam whose failure is silent: a memory can be loaded, edited and
// written back successfully — status applied, no refusal, no warning — while the
// write quietly deletes every named thing that memory declared. Nothing in the
// response says so and the next read looks fine.
//
// So this file does the round trip for real, against a real vault, and asserts
// the things a passing write cannot be trusted to have preserved:
//
//   the write committed
//   the declared entity NAME SET is unchanged — sets, not counts
//   the fact statements are unchanged — sets, not counts
//   the body carries the edit
//   the version identity moved
//   the vault's search-exposure count did not move by one record
//   the stale version is refused, and the refusal names the current one
//
// Two of those deserve their reason stated. Comparing name SETS rather than
// counts is not fastidiousness: a projection that rebuilds entities from the
// wrong door can preserve the count exactly while replacing every name in it,
// and a count assertion passes that. And the exposure count is asserted because
// M1 has zero ranked-search callers — which is a claim about this repository
// that is only worth anything if something measures it against the store.
//
// Everything runs against a clone. A ranked search writes, so even a read-shaped
// call is treated as a write for the purpose of deciding which vault it goes to.

import assert from 'node:assert/strict';
import test from 'node:test';

import { call, run } from '../src/engine/call.mjs';
import { EngineRefusedError } from '../src/engine/errors.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { listMemories, loadForEdit, writeMemory } from '../src/engine/memory.mjs';
import { parseWriteContract } from '../src/engine/preflight.mjs';
import { censusVault, countExposureRecords, openScratchVault } from './helpers/vault.mjs';

/** How many memories to open before giving up on finding one that declares entities. */
const CANDIDATE_LIMIT = 40;

/**
 * The property names an entity's own name might arrive under, most specific
 * first. This is a list of candidate KEYS, not of vocabulary values — no closed
 * list is transcribed here. If none of them is present the test fails loudly
 * naming the keys it did see, because an entity whose name cannot be read is an
 * entity whose disappearance cannot be detected, and that is the failure this
 * whole file exists to catch.
 *
 * `n` leads because it is the key the write contract publishes for an entity's
 * surface — read it back with `kscope schema remember`. The rest are the shapes
 * this list was originally written against and stay as fallbacks: a key that
 * stops being emitted should degrade to a different reading of the same name,
 * not to an unreadable declaration.
 */
const NAME_KEYS = ['n', 'name', 'surface', 'canonical_name', 'entity', 'label', 'id'];

/**
 * Read the declared entity names as a Set.
 *
 * Sorted and de-duplicated deliberately: the assertion is about which things the
 * memory declares, not about the order the engine happened to return them in,
 * and an ordering change is not data loss.
 */
function entityNames(delta) {
	const entities = delta?.entities ?? [];
	const names = new Set();
	for (const entity of entities) {
		if (typeof entity === 'string') {
			names.add(entity);
			continue;
		}
		const key = NAME_KEYS.find((candidate) => typeof entity?.[candidate] === 'string');
		assert.ok(
			key !== undefined,
			`An entity declaration carries no readable name. Its keys are: ` +
				`${Object.keys(entity ?? {}).join(', ') || '(none)'}. Without a name this test ` +
				`cannot tell a preserved declaration from a replaced one, which is the only thing ` +
				`it is here to do.`,
		);
		names.add(entity[key]);
	}
	return names;
}

const sorted = (set) => [...set].sort();

/**
 * Read the facts as a set of statements rather than as a number.
 *
 * The same argument the file already makes about entity names applies here and was not being made: a
 * count of two survives both facts being replaced by two different ones, and the projection that
 * would cause that — rebuilding facts from a door that returns them in another shape — preserves the
 * count exactly. `subject`, `predicate` and `object` are the three fields the write contract marks
 * required on a fact, so a statement is identified by them and by nothing derived.
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

/**
 * Choose a value from a closed list the ENGINE printed, rather than writing the
 * value down here.
 *
 * The write contract's closed vocabularies are generated; a value transcribed
 * into a test drifts from the engine in silence and the test keeps passing
 * against a mode that no longer means what it meant. Selecting by pattern from
 * the list read a moment ago fails loudly instead, and the failure names every
 * value that was actually on offer.
 */
function pickClosedValue(closed, field, pattern) {
	const paths = Object.keys(closed).filter((path) => path.split('.').at(-1) === field);
	for (const path of paths) {
		const match = closed[path].find((value) => pattern.test(value));
		if (match !== undefined) return match;
	}
	const offered = paths.map((path) => `${path}: ${closed[path].join(', ')}`).join('\n  ');
	assert.fail(
		`No value matching ${pattern} on any closed list named '${field}' in the write contract.\n` +
			`  ${offered || '(no closed list with that name was parsed at all)'}`,
	);
}

/**
 * Change exactly one character, and prove it.
 *
 * Case-flipping one letter keeps the length identical, so "one character
 * changed" is checkable by comparison rather than by trust. The edit is placed
 * after the first line where possible: the first line of a memory carries a
 * heading the product has rules about, and an edit that lands there tests those
 * rules instead of the round trip.
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
	const flipped = character === character.toLowerCase()
		? character.toUpperCase()
		: character.toLowerCase();

	const edited = body.slice(0, index) + flipped + body.slice(index + 1);
	assert.equal(edited.length, body.length, 'the edit changed the length of the body');
	assert.equal(differingCharacters(body, edited), 1, 'the edit changed more than one character');
	return { edited, index, from: character, to: flipped };
}

function differingCharacters(a, b) {
	if (a.length !== b.length) return Math.abs(a.length - b.length) + Infinity;
	let differences = 0;
	for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) differences += 1;
	return differences;
}

/**
 * Every reading in the health payload whose key names the fold, wherever it sits.
 *
 * The path is walked rather than named because this repository does not get to
 * assume the shape of a payload it did not define. What matters is that a
 * reading was FOUND: a memory whose entities are not yet in the index binds
 * nothing, so it can survive a round trip for the wrong reason and pass. A test
 * that could not read the fold state at all is a test that cannot tell those
 * apart, so an unreadable fold is reported as a failure of the instrument rather
 * than absorbed into a green run.
 */
function foldReadings(payload) {
	const readings = [];
	const walk = (value, path) => {
		if (value === null || typeof value !== 'object') {
			if (/fold/i.test(path)) readings.push([path, value]);
			return;
		}
		if (Array.isArray(value)) {
			if (/fold/i.test(path)) readings.push([path, `[${value.length} entries]`]);
			value.forEach((item, index) => walk(item, `${path}[${index}]`));
			return;
		}
		for (const [key, child] of Object.entries(value)) {
			walk(child, path ? `${path}.${key}` : key);
		}
	};
	walk(payload, '');
	return readings;
}

test('M1: a memory survives a load, a one-character edit and a write back', async (t) => {
	const engine = await locateEngine();

	// Nothing below this line touches the vault the engine would have resolved on
	// its own. If the clone cannot be made, this throws and the test run stops —
	// there is no path from here that reaches the source vault.
	const scratch = openScratchVault({ enginePath: engine.path, label: 'kscope-ui-m1' });
	const where = { enginePath: engine.path, root: scratch.root };

	t.diagnostic(`engine ${engine.path} (found by ${engine.source})`);
	t.diagnostic(`clone ${scratch.root}`);
	t.diagnostic(`source vault, never written: ${scratch.source}`);

	try {
		// ── step 2: what the exposure store holds before anything runs ──────────
		const exposureBefore = countExposureRecords(scratch.root);
		const censusBefore = censusVault(scratch.root);
		t.diagnostic(
			`exposure before: ${exposureBefore.records} records in ${exposureBefore.stores} stores`,
		);

		assert.ok(
			exposureBefore.stores > 0,
			`No search-exposure store was found in the clone, so the count is zero because the ` +
				`census found nowhere to look — and zero compared against zero passes. This check ` +
				`is loudest exactly when it is broken, so it fails here rather than reporting a ` +
				`vacuous pass. Fix what the census looks for, not the assertion.`,
		);

		// ── step 3 and 4: load one memory through the door that carries the
		//    entity declarations, and record what it declared ────────────────────
		const listing = await listMemories(where);
		assert.ok(listing.memory_count > 0, 'the cloned vault holds no memories to round-trip');
		t.diagnostic(`listing: ${listing.memory_count} memories, ${listing.duration_ms} ms`);

		let loaded = null;
		for (const record of listing.memories.slice(0, CANDIDATE_LIMIT)) {
			const candidate = await loadForEdit(record.memory_id, where);
			if (candidate.entity_count > 0 && candidate.content_md) {
				loaded = candidate;
				break;
			}
		}
		assert.ok(
			loaded !== null,
			`None of the first ${CANDIDATE_LIMIT} memories declares an entity and carries a body, ` +
				`so the round trip has nothing to lose and this test could only pass vacuously.`,
		);

		const namesBefore = entityNames(loaded.semantic_delta);
		const factsBefore = loaded.fact_count;
		const statementsBefore = factStatements(loaded.semantic_delta);
		const versionBefore = loaded.version_id;

		t.diagnostic(
			`memory ${loaded.memory_id}: ${namesBefore.size} declared names, ` +
				`${factsBefore} facts, version ${versionBefore}`,
		);
		if (loaded.dropped_fields.length > 0) {
			t.diagnostic(`projection dropped: ${loaded.dropped_fields.join(', ')}`);
		}

		assert.ok(namesBefore.size > 0, 'the chosen memory declares no names to preserve');
		assert.ok(
			typeof versionBefore === 'string' && versionBefore.length > 0,
			'the memory carries no version, so no write can be told apart from an overwrite',
		);

		// ── step 9, first half: the fold state this result is standing on ───────
		const healthBefore = await call('doctor', { mode: 'inspect' }, where);
		const foldBefore = foldReadings(healthBefore.data);
		for (const [path, value] of foldBefore) t.diagnostic(`fold before — ${path}: ${value}`);
		assert.ok(
			foldBefore.length > 0,
			`The health door returned no reading naming the fold, so this test cannot say whether ` +
				`a pass is real or is a memory whose entities were never in the index. Report the ` +
				`fold state or fail; do not pass quietly.`,
		);

		// ── step 5 and 6: change exactly one character, write it back with the
		//    version the load returned ───────────────────────────────────────────
		const contract = parseWriteContract((await run(['schema', 'remember'], where)).stdout);
		const updateMode = pickClosedValue(contract.closed, 'mode', /^update/i);

		const edit = flipOneCharacter(loaded.content_md);
		t.diagnostic(`edit: '${edit.from}' -> '${edit.to}' at offset ${edit.index}`);

		const written = await writeMemory(
			{
				mode: updateMode,
				memory_id: loaded.memory_id,
				expected_version_id: versionBefore,
				content_md: edit.edited,
				// The whole semantic structure, from the door that carries it. An update is not a
				// patch: what is absent here is deleted, which is the silent failure this test is
				// built around.
				semantic_delta: loaded.semantic_delta,
			},
			where,
		);

		// ── step 7: the write committed, and cost nothing it did not say ────────
		t.diagnostic(`write effect: ${written.data?.canonical_effect ?? 'not reported'}`);

		await t.test('the write committed', () => {
			assert.equal(written.outcome, 'applied');
			assert.equal(written.exit_code, 0);
		});

		const after = await loadForEdit(loaded.memory_id, where);

		await t.test('the declared entity name set is unchanged', () => {
			const namesAfter = entityNames(after.semantic_delta);
			// Sets, not counts. A count survives a wholesale replacement of the names inside it,
			// and a replacement is exactly what the wrong load door produces.
			assert.deepEqual(
				sorted(namesAfter),
				sorted(namesBefore),
				`The write changed which things this memory declares. Names lost: ` +
					`${sorted(namesBefore).filter((name) => !namesAfter.has(name)).join(', ') || '(none)'}. ` +
					`Names gained: ` +
					`${sorted(namesAfter).filter((name) => !namesBefore.has(name)).join(', ') || '(none)'}.`,
			);
			assert.equal(namesAfter.size, namesBefore.size);
		});

		await t.test('the facts are unchanged, as statements and not as a count', () => {
			const statementsAfter = factStatements(after.semantic_delta);
			assert.deepEqual(
				sorted(statementsAfter),
				sorted(statementsBefore),
				`The write changed what this memory asserts. Statements lost: ` +
					`${sorted(statementsBefore).filter((f) => !statementsAfter.has(f)).join(' / ') || '(none)'}. ` +
					`Statements gained: ` +
					`${sorted(statementsAfter).filter((f) => !statementsBefore.has(f)).join(' / ') || '(none)'}.`,
			);
			assert.equal(after.fact_count, factsBefore);
		});

		await t.test('the body carries the edit', () => {
			assert.equal(after.content_md, edit.edited);
			assert.equal(differingCharacters(loaded.content_md, after.content_md), 1);
		});

		await t.test('the version identity changed', () => {
			assert.notEqual(after.version_id, versionBefore);
			assert.ok(
				typeof after.version_id === 'string' && after.version_id.length > 0,
				'the memory came back with no version, so the next write cannot be guarded',
			);
		});

		// ── step 10a: resending the SAME write is replayed, not re-executed ─────
		//
		// This is here because it is the reason step 10b is shaped the way it is. Resubmitting a
		// byte-identical write returns exit 0 with the original result and a different effect: the
		// engine recognises the retry identity and does not run the write again. So a stale-version
		// probe built by resending the same bytes cannot be refused, and a test written that way
		// asserts nothing while looking like the sharpest check in the file.
		const replayed = await writeMemory(
			{
				mode: updateMode,
				memory_id: loaded.memory_id,
				expected_version_id: versionBefore,
				content_md: edit.edited,
				semantic_delta: loaded.semantic_delta,
			},
			where,
		);
		t.diagnostic(`resend effect: ${replayed.data?.canonical_effect ?? 'not reported'}`);

		await t.test('an identical resend is replayed rather than refused', () => {
			assert.equal(replayed.outcome, 'applied');
			assert.notEqual(
				replayed.data?.canonical_effect,
				written.data?.canonical_effect,
				`The engine reported the same effect for a write and for a byte-identical resend of ` +
					`it. Either the resend really ran — in which case the stale-version guard below is ` +
					`the only thing standing between two editors — or this reading no longer ` +
					`distinguishes the two, and the probe below has stopped being able to fire.`,
			);
		});

		// ── step 10b: a DIFFERENT write, carrying the version that is now stale ─
		//
		// Different by construction: the character flipped in step 5 is flipped back, so the body is
		// one the vault has never been asked to store against this version. That is what makes the
		// call reach the version check instead of the replay path above.
		//
		// Caught in the open rather than through a matcher, because the assertion is not only that
		// it was refused — it is what the refusal SAYS. A caller that cannot read the current
		// version out of the refusal has to guess, and guessing here is how one editor overwrites
		// another while both believe they saved.
		const reverted = flipOneCharacter(edit.edited);
		assert.notEqual(
			reverted.edited,
			edit.edited,
			'the stale probe resends the bytes that were already written, so it cannot be refused',
		);

		let refused = null;
		try {
			await writeMemory(
				{
					mode: updateMode,
					memory_id: loaded.memory_id,
					expected_version_id: versionBefore,
					content_md: reverted.edited,
					semantic_delta: loaded.semantic_delta,
				},
				where,
			);
		} catch (error) {
			refused = error;
		}

		await t.test('the refusal is data, and it names the version that is now current', () => {
			assert.ok(
				refused instanceof EngineRefusedError,
				`A write carrying a version the vault has moved past was not refused. It ` +
					`${refused === null ? 'was applied' : `failed as ${refused?.constructor?.name}`}. ` +
					`Nothing else in this product stops one editor overwriting another.`,
			);
			assert.equal(refused.exitCode, 2);
			assert.equal(refused.outcome, 'refused');
			assert.ok(refused.refusal !== null, 'the refusal envelope did not arrive on stdout');

			const spelled = JSON.stringify(refused.refusal);
			assert.ok(
				spelled.includes(after.version_id),
				`The refusal does not name the version that is now current (${after.version_id}), ` +
					`so a caller cannot recover from it without guessing. It said: ${spelled}`,
			);
		});

		// ── step 8: the exposure store did not move ─────────────────────────────
		await t.test('the vault recorded no ranked search', () => {
			const exposureAfter = countExposureRecords(scratch.root);
			t.diagnostic(
				`exposure after: ${exposureAfter.records} records in ${exposureAfter.stores} stores`,
			);
			assert.equal(exposureAfter.stores, exposureBefore.stores);
			assert.equal(
				exposureAfter.records,
				exposureBefore.records,
				`A whole browse, load, edit and refused write left ${exposureAfter.records - exposureBefore.records} ` +
					`new search-exposure records. Some door on this path runs a ranked query. M1 has ` +
					`zero ranked-search callers, and this is the measurement that makes that ` +
					`enforceable rather than aspirational.`,
			);
		});

		// ── step 9, second half: the fold state beside the result ───────────────
		const healthAfter = await call('doctor', { mode: 'inspect' }, where);
		for (const [path, value] of foldReadings(healthAfter.data)) {
			t.diagnostic(`fold after — ${path}: ${value}`);
		}

		const censusAfter = censusVault(scratch.root);
		t.diagnostic(
			`clone census: ${censusBefore.files} -> ${censusAfter.files} files, ` +
				`${censusBefore.bytes} -> ${censusAfter.bytes} bytes`,
		);
	} finally {
		scratch.close();
	}
});
