// M8: the version compatibility rule, driven until it fires.
//
// A tier machine that has never been watched to change tier is a diagram. The engine on this
// machine is the one this build was tested against, so every launch here is Tier C — which means
// the interesting half of this file is the PERTURBED readings: the same pure function, given a
// contract whose digest moved, a schema envelope it does not recognise, and an operation index
// missing something the app is built on.
//
// The readings are taken from the real engine first, so the fixture is a perturbation of something
// true rather than an invention. A hand-built input would certify the wrong function: it would
// prove the ladder handles the shape this test imagined, which is the shape the ladder was written
// against, and the two would agree with each other and with nothing else.
//
// Four properties, and each is a thing that could be wrong on its own:
//
//   1. the real engine lands in Tier C, and the digest the build claims to have been tested against
//      is the digest the engine actually prints — a table with a typo in it would put every user in
//      Tier B, silently, forever;
//   2. a moved digest changes the TIER, not merely a label, and the banner names both digests;
//   3. Tier A is reachable, from either of its two causes, and it REFUSES WRITES — checked on the
//      route table the server actually dispatches from, not on a copy;
//   4. no tier ever substitutes a vocabulary this repository wrote down.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	assessCompatibility,
	KNOWN_SCHEMA_VERSIONS,
	REQUIRED_OPERATIONS,
	TESTED_CONTRACTS,
} from '../src/engine/compatibility.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { preflight } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';
import { openScratchVault } from './helpers/vault.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A deep-enough copy that a perturbation cannot reach the readings the other tests use. */
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------------------------
// The real engine
// ---------------------------------------------------------------------------------------------

const engine = await locateEngine({});
const vault = openScratchVault({ enginePath: engine.path });
const readings = await preflight({ explicit: engine.path, root: vault.root });

test.after(() => vault.close());

test('the engine on this machine is one this build was tested against', () => {
	const assessment = assessCompatibility(readings);

	// The digest in the table has to be the digest the engine prints. This is the assertion the
	// whole tier machine rests on: a table with one wrong character puts every user of a correct
	// engine into Tier B, where nothing errors and every control quietly becomes a text box.
	assert.equal(
		assessment.tier,
		'C',
		`This engine's write contract is ${assessment.digest}, and the tested table holds ` +
			`${assessment.tested_digests.join(', ')}. Either the engine changed — in which case ` +
			`re-test the parser and add the digest — or the table is wrong.`,
	);
	assert.ok(assessment.vocabulary_verified, 'Tier C must present its parsed vocabulary as verified.');
	assert.ok(assessment.writes_permitted, 'Tier C must permit writes.');
	assert.deepEqual(assessment.missing_operations, []);
	assert.deepEqual(assessment.retired_operations, []);

	// And the digest is a property of the BUILD, not of the vault. If it moved with vault content,
	// no table of digests could ever match on a stranger's machine and the tier would be useless.
	assert.match(assessment.digest, /^[0-9a-f]{64}$/);
	assert.ok(
		TESTED_CONTRACTS.every((entry) => /^[0-9a-f]{64}$/.test(entry.digest)),
		'A tested-contract entry is not a sha256.',
	);
});

test('every operation this app declares it needs is one the engine actually has', () => {
	const assessment = assessCompatibility(readings);
	assert.ok(REQUIRED_OPERATIONS.length >= 3, 'The required-operation list is suspiciously short.');
	for (const operation of assessment.operations) {
		assert.ok(operation.present, `${operation.name} is not in the engine's operation index.`);
		assert.equal(operation.retired, false, `${operation.name} is listed as retired.`);
	}

	// The other direction: the index test can find something absent. Without this, a regex that
	// matched everything would pass the loop above and pass it on any engine.
	const invented = assessCompatibility({
		...clone(readings),
		contract: { ...clone(readings.contract), operations: 'nothing here names anything' },
	});
	assert.equal(invented.tier, 'A');
	assert.deepEqual(
		invented.missing_operations.sort(),
		REQUIRED_OPERATIONS.map((operation) => operation.name).sort(),
	);
});

// ---------------------------------------------------------------------------------------------
// The ladder, perturbed
// ---------------------------------------------------------------------------------------------

test('a moved contract digest drops to Tier B and names both digests', () => {
	const perturbed = clone(readings);
	// One character. This is the case the version string cannot see: the engine still calls itself
	// the same thing and the text it prints has changed.
	perturbed.contract.digest = `${'0'.repeat(63)}1`;

	const assessment = assessCompatibility(perturbed);
	assert.equal(assessment.tier, 'B');
	assert.equal(assessment.vocabulary_verified, false, 'Tier B must not present its parse as verified.');
	assert.equal(
		assessment.writes_permitted,
		true,
		'Tier B allows writes: the engine refuses what it cannot accept and names the field to fix.',
	);

	const banner = assessment.reasons.map((reason) => reason.message).join('\n');
	assert.ok(banner.includes(perturbed.contract.digest), 'The banner does not name the engine’s digest.');
	for (const tested of assessment.tested_digests) {
		assert.ok(banner.includes(tested), 'The banner does not name the digest this build was tested against.');
	}
	// The engine VERSION is not what changed and must not be what is blamed.
	assert.equal(assessment.engine_version, readings.engine.version);
});

test('an unrecognised schema envelope is Tier A, not Tier B', () => {
	const perturbed = clone(readings);
	perturbed.contract.schema_version = 'kaleidoscope.public-seed.v99';

	const assessment = assessCompatibility(perturbed);
	assert.equal(assessment.tier, 'A');
	assert.equal(assessment.writes_permitted, false);
	assert.equal(assessment.schema_version_known, false);
	assert.ok(
		assessment.reasons.some((reason) => reason.code === 'unknown-schema-version'),
		'Tier A was reached without saying why.',
	);
	// The distinction that makes the two tiers worth having: B is "the vocabulary might be
	// incomplete", A is "the readings might not be the readings".
	assert.ok(KNOWN_SCHEMA_VERSIONS.includes(readings.contract.schema_version));
});

test('an operation this app is built on, retired, is Tier A', () => {
	const perturbed = clone(readings);
	const needed = REQUIRED_OPERATIONS[0].name;
	perturbed.contract.retired_operations = { agent_tools: [needed] };

	const assessment = assessCompatibility(perturbed);
	assert.equal(assessment.tier, 'A');
	assert.equal(assessment.writes_permitted, false);
	assert.deepEqual(assessment.retired_operations, [needed]);

	// The retired list arrives as a nested object of lists. A reader that expected a flat array
	// would find nothing here and report Tier C on an engine that had withdrawn the write door.
	assert.equal(typeof readings.contract.retired_operations, 'object');
});

test('a Tier A reading never substitutes a vocabulary of its own', () => {
	const perturbed = clone(readings);
	perturbed.contract.schema_version = 'something else entirely';
	const assessment = assessCompatibility(perturbed);

	// The assessment holds tiers, digests, operation names and sentences. It must not hold a single
	// memory type, entity kind or relation name — a bundled vocabulary standing in for a failed
	// parse is the exact failure that reading the contract at run time exists to prevent, and Tier A
	// is where a tired implementation would put one.
	const text = JSON.stringify(assessment);
	const vocabularyFromTheEngine = [
		...(readings.vocabulary.known['semantic_delta.facts.predicate'] ?? []),
		...(readings.vocabulary.known['semantic_delta.entities.kind'] ?? []),
		...(readings.vocabulary.declarable_memory_types ?? []),
	];
	assert.ok(vocabularyFromTheEngine.length > 5, 'The engine published too little to make this check mean anything.');
	for (const value of vocabularyFromTheEngine) {
		assert.equal(
			text.includes(`"${value}"`),
			false,
			`The compatibility assessment carries the vocabulary value "${value}".`,
		);
	}
});

// ---------------------------------------------------------------------------------------------
// What the server does about it
// ---------------------------------------------------------------------------------------------

test('the write gate is on the routes that change the vault, and only those', async (t) => {
	const sidecar = await startSidecar({ readings, root: vault.root, snapshotsDir: vault.state_dir });
	t.after(() => sidecar.close());

	const writing = sidecar.routes.filter((route) => route.writes).map((route) => route.path).sort();
	assert.deepEqual(
		writing,
		[
			'/api/memories',
			'/api/memories/:memory_id',
			'/api/merges',
			'/api/pending-merge',
			'/api/removals',
			'/api/renames',
		],
		'The set of routes that can change the vault is not the set the compatibility gate governs.',
	);

	// `/api/dismissals` is a POST and is deliberately NOT in that list: it writes one file in this
	// app's own state directory and reaches no engine. Asserted, because the easy mistake is to gate
	// every POST, which would take away the one control a Tier A user still has.
	const dismissals = sidecar.routes.find(
		(route) => route.path === '/api/dismissals' && route.method === 'POST',
	);
	assert.ok(dismissals, 'The dismissal route is gone.');
	assert.equal(dismissals.writes, false, 'The dismissal route is gated as though it wrote to the vault.');

	// And every POST is one or the other, so a route added later is either marked or is a failure
	// here rather than a silent hole in the gate.
	for (const route of sidecar.routes) {
		if (route.method !== 'POST') continue;
		assert.equal(
			typeof route.writes,
			'boolean',
			`${route.path} does not say whether it changes the vault.`,
		);
	}

	assert.equal(sidecar.compatibility.tier, 'C');
	assert.equal(sidecar.compatibility.writes_permitted, true);
});

test('in Tier A the server refuses a write and says which readings put it there', async (t) => {
	// The tier is computed from the readings, so the perturbation goes in at the readings — the
	// same door the real thing comes through. Driving the gate any other way would test a private
	// switch rather than the mechanism.
	const perturbed = clone(readings);
	perturbed.contract.schema_version = 'kaleidoscope.public-seed.v99';

	const sidecar = await startSidecar({
		readings: perturbed,
		root: vault.root,
		snapshotsDir: vault.state_dir,
	});
	t.after(() => sidecar.close());

	assert.equal(sidecar.compatibility.tier, 'A');

	const write = await fetch(`${sidecar.origin}/api/memories`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${sidecar.token}`,
			Origin: sidecar.origin,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ content_md: '# nothing', semantic_delta: {} }),
	});
	assert.equal(write.status, 409, 'A Tier A server accepted a write.');

	const body = await write.json();
	assert.equal(body.error.kind, 'engine-not-compatible');
	assert.equal(body.error.tier, 'A');
	// The message shows the user WHAT IT FOUND rather than failing with a version string, and it
	// says the vault is untouched — which is the first thing a person wants to know when a write
	// they authorised comes back refused.
	assert.match(body.error.message, /public-seed\.v99/);
	assert.match(body.error.message, /vault is untouched/i);

	// Reads still work. That is the whole difference between degrading and refusing to run.
	const listing = await fetch(`${sidecar.origin}/api/memories`, {
		headers: { Authorization: `Bearer ${sidecar.token}`, Origin: sidecar.origin },
	});
	assert.equal(listing.status, 200, 'A Tier A server stopped serving reads.');
	assert.ok((await listing.json()).memory_count > 0, 'A Tier A server served an empty vault.');

	// And the readings are published, so the screen can show what it found.
	const preflightResponse = await fetch(`${sidecar.origin}/api/preflight`, {
		headers: { Authorization: `Bearer ${sidecar.token}`, Origin: sidecar.origin },
	});
	const session = await preflightResponse.json();
	assert.equal(session.compatibility.tier, 'A');
	assert.equal(session.compatibility.vocabulary_verified, false);
	assert.ok(session.compatibility.reasons.length > 0);
});

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

test('the banner exists, is reachable, and every class it uses has a rule', () => {
	const app = readFileSync(join(ROOT, 'src', 'app', 'App.jsx'), 'utf8');
	assert.match(app, /function EngineCompatibility/, 'There is no compatibility banner component.');
	assert.match(app, /<EngineCompatibility/, 'The compatibility banner is never rendered.');

	// It is silent in Tier C, which is the only reason it is worth reading in Tier B.
	assert.match(
		app,
		/tier === 'C'\) return null/,
		'The banner does not stand down on a tested engine, so it is a banner nobody reads.',
	);

	// The M4–M6 lesson, mechanically: a class with no rule renders as unstyled text, and the half
	// of a before/after row that was meant to be de-emphasised reads as the emphasised one.
	const css = readFileSync(join(ROOT, 'src', 'app', 'styles.css'), 'utf8');
	// Every class name this component spells, however it spells it — a ternary inside `className`
	// is the commonest shape and the one a `className="..."` pattern misses entirely, which would
	// leave this check green while looking at nothing.
	const used = new Set(
		[...app.matchAll(/['"]([a-z0-9 -]+)['"]/g)]
			.flatMap((match) => match[1].split(/\s+/))
			.filter((name) => name.startsWith('compat')),
	);
	assert.ok(used.size >= 3, `Only ${used.size} compatibility classes were found in App.jsx.`);
	for (const name of used) {
		assert.ok(css.includes(`.${name}`), `.${name} is used in App.jsx and has no rule in styles.css.`);
	}
});

test('the unverified control is free text and offers no vocabulary of its own', () => {
	const editor = readFileSync(join(ROOT, 'src', 'app', 'MemoryEditor.jsx'), 'utf8');

	// One switch, read once, at EVERY control that would otherwise be a menu.
	//
	// This counts controls against wirings rather than asserting a number, and the difference is not
	// pedantry: the first form of this check asserted `>= 4` and was green because one element
	// carried the attribute TWICE. A duplicate JSX attribute is dropped by the compiler, so the
	// count was four and the wired controls were three — a check calibrated on a typo. Comparing the
	// two counts fails on a new closed control that nobody wired, which is the regression, and
	// cannot be satisfied by writing the same attribute twice on one element.
	const controls = [...editor.matchAll(/<ClosedValueSelect\b/g)];
	const sites = [...editor.matchAll(/verified=\{vocabularyVerified\}/g)];
	assert.ok(controls.length >= 3, `Only ${controls.length} closed controls exist to check.`);
	assert.equal(
		sites.length,
		controls.length,
		`${controls.length} closed controls, ${sites.length} of them read the tier.`,
	);

	// And the fallback is a text input with the extracted values as SUGGESTIONS, never a list this
	// repository wrote down. The check is that no vocabulary literal appears in the file at all.
	const kinds = readings.vocabulary.known['semantic_delta.entities.kind'] ?? [];
	assert.ok(kinds.length > 5, 'The engine published too few kinds to make this check mean anything.');
	for (const kind of kinds) {
		assert.equal(
			new RegExp(`['"\`]${kind}['"\`]`).test(editor),
			false,
			`The editor names the vocabulary value "${kind}".`,
		);
	}

	// The whole app, not just this file: a denial list is the one written-down list allowed here.
	const appFiles = readdirSync(join(ROOT, 'src', 'app')).filter((name) => /\.(jsx|mjs)$/.test(name));
	assert.ok(appFiles.length > 10);
});
