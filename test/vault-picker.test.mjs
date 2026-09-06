// THE VAULT PICKER, TESTED WHERE IT CAN BE WRONG.
//
// The picker's whole risk is that it disagrees with the engine about which vault is which. The
// engine resolves a root from where it was started, refuses a root that is not a vault, and holds a
// list of named profiles; a picker that computed any of that itself would be a second resolver, and
// the failure mode of two resolvers is not an error message — it is the user opening "the project
// vault" and reading somebody else's memories.
//
// So the four properties asserted below are the four ways that could happen:
//
//   1. the offered list is exactly what the engine reported, and nothing else is in it;
//   2. two vaults that shorten to the same word are told apart, because they are different
//      directories and the chip shows only the name;
//   3. switching targets the root that belongs to the key that was pressed;
//   4. NO PATH IN THE MODEL WAS CONSTRUCTED BY THIS APP — every root offered appears verbatim in
//      the bytes the engine printed. That one is mechanical rather than a reading of the source,
//      because "we do not build paths" stays true right up until someone adds one `join`.
//
// Every fixture here is INVENTED. Nothing in this file reads a vault, spawns an engine or touches
// the machine it runs on: the model is pure, and driving it with recorded engine output is what
// makes these assertions about the model rather than about this laptop.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	currentOffer,
	describeSource,
	distinctNames,
	offeredVaults,
	shortVaultName,
	vaultKey,
} from '../src/shared/vaults.mjs';

// ---------------------------------------------------------------------------------------------
// The recorded engine output. Invented, and shaped exactly as `kscope` prints it.
// ---------------------------------------------------------------------------------------------

/** `kscope where`, run in the directory the app was started in. */
const WHERE_STARTED = {
	root: '/Users/you/code/harbour-lights/.kaleidoscope',
	root_source: 'repository_default',
	workspace_id: 'wsp_invented-1',
	workspace_id_source: 'vault',
	principal_id: 'usr_invented-2',
	principal_id_source: 'vault',
	journal: 'journal:invented-3',
	journal_source: 'vault',
	repository: '/Users/you/code/harbour-lights',
};

/** `kscope where`, run outside any project — what this app offers as the global vault. */
const WHERE_GLOBAL = {
	root: '/Users/you/.kaleidoscope',
	root_source: 'working_directory_default',
	workspace_id: 'wsp_invented-a',
	workspace_id_source: 'vault',
	principal_id: 'usr_invented-b',
	principal_id_source: 'vault',
	journal: 'journal:invented-c',
	journal_source: 'vault',
	repository: null,
};

/** `kscope profile list`. Four names, one of which points at the vault the app already resolved. */
const PROFILE_LIST = {
	version: 1,
	stale: 0,
	profiles: ['default', 'lantern', 'tideline', 'archived-lantern'],
	entries: [
		{
			name: 'default',
			valid: true,
			profile: {
				name: 'default',
				root: '/Users/you/code/harbour-lights/.kaleidoscope',
				durability: 'process-local',
				workspace_id: 'wsp_invented-1',
				principal_id: 'usr_invented-2',
				journal: 'journal:invented-3',
				version: 1,
			},
		},
		{
			name: 'lantern',
			valid: true,
			profile: {
				name: 'lantern',
				root: '/Users/you/code/lantern/.kaleidoscope',
				durability: 'process-local',
				workspace_id: 'wsp_invented-11',
				principal_id: 'usr_invented-12',
				journal: 'journal:invented-13',
				version: 1,
			},
		},
		{
			name: 'tideline',
			valid: true,
			profile: {
				name: 'tideline',
				root: '/Volumes/scratch/tideline-vault',
				durability: 'durable-local',
				workspace_id: 'wsp_invented-21',
				principal_id: 'usr_invented-22',
				journal: 'journal:invented-23',
				version: 1,
			},
		},
		{
			// The same short name as `lantern`, and a different directory. This is the collision the
			// chip cannot survive without help: it shows a name and no path.
			name: 'archived-lantern',
			valid: true,
			profile: {
				name: 'archived-lantern',
				root: '/Users/you/archive/lantern/.kaleidoscope',
				durability: 'process-local',
				workspace_id: 'wsp_invented-31',
				principal_id: 'usr_invented-32',
				journal: 'journal:invented-33',
				version: 1,
			},
		},
	],
};

/** The engine's own refusal, verbatim, for a resolved root that is not a vault. */
const NOT_A_VAULT =
	'kscope: /Users/you/notes/.kaleidoscope is not a vault (no manifest.json).\n' +
	'  That path came from the project marker, not from an argument, so nothing here was typed ' +
	'wrong on this command line -- check KSCOPE_ROOT or the directory you are in.\n' +
	'  REFUSING rather than creating one: addressing a vault and creating one are different acts.';

const reported = (overrides = {}) => ({
	started: { where: WHERE_STARTED, refusal: null },
	profiles: { list: PROFILE_LIST, refusal: null },
	global: { where: WHERE_GLOBAL, refusal: null },
	current: WHERE_STARTED.root,
	...overrides,
});

// ---------------------------------------------------------------------------------------------
// 1. Exactly what the engine reported, plus nothing
// ---------------------------------------------------------------------------------------------

test('the offered list is exactly the roots the engine reported, each of them once', () => {
	const { offers } = offeredVaults(reported());

	const offered = offers.map((offer) => offer.root).sort();
	const engineSaid = [
		WHERE_STARTED.root,
		...PROFILE_LIST.entries.map((entry) => entry.profile.root),
		WHERE_GLOBAL.root,
	];

	assert.deepEqual(
		offered,
		[...new Set(engineSaid)].sort(),
		'The offered set is not the set of roots the engine named.',
	);

	// One root is one offer. The `default` profile points at the vault the app already resolved, and
	// listing it twice would ask the reader to choose between a thing and itself.
	assert.equal(offers.length, new Set(offered).size, 'A root is offered more than once.');
	const started = offers.find((offer) => offer.kind === 'started');
	assert.deepEqual(
		started.aliases,
		['default'],
		'The profile name for the already-resolved root was dropped instead of being recorded on it.',
	);

	// The order is the argument the picker is built on: the default the user already has, then the
	// engine's own names, then the one that belongs to no project.
	assert.deepEqual(
		offers.map((offer) => offer.kind),
		['started', 'profile', 'profile', 'profile', 'global'],
		'The offer order is not default · profiles · global.',
	);

	// And the current one is marked from the app's OWN reading of what it has open, not guessed.
	assert.equal(currentOffer(offers).root, WHERE_STARTED.root);
});

test('nothing is offered that the engine did not report', () => {
	// The empty machine: an engine that resolved nothing, holds no profiles, and has no vault
	// outside a project. The honest answer is an empty list — not a home directory, not a guess.
	const { offers, refusals } = offeredVaults({
		started: { where: null, refusal: NOT_A_VAULT },
		profiles: { list: { version: 1, entries: [], profiles: [], stale: 0 }, refusal: null },
		global: { where: null, refusal: 'kscope: /Users/you/.kaleidoscope is not a vault.' },
	});

	assert.deepEqual(offers, [], 'A vault was offered that the engine never named.');

	// THE ENGINE'S REFUSAL, VERBATIM. The resolved directory not being a vault is the engine's
	// answer and it names the remedy in its own words; a sentence written by this app in its place
	// would be a guess about a machine it did not read.
	const started = refusals.find((refusal) => refusal.of === 'started');
	assert.equal(started.message, NOT_A_VAULT, 'The engine’s refusal was rewritten.');

	// The absent global vault is NOT reported as a problem. "There is no vault outside a project" is
	// the ordinary state of a machine, and a notice about it would be this app complaining that the
	// user has not made one.
	assert.equal(
		refusals.some((refusal) => refusal.of === 'global'),
		false,
		'An absent global vault was reported as something wrong.',
	);
});

test('a wedged profile store is carried as the engine said it, and costs only the profiles', () => {
	// One stale profile makes the whole listing refuse — the store revalidates every entry on read
	// and propagates the first failure. The vault the app is already reading is unaffected, so the
	// picker keeps offering it and says why the names are missing.
	const refusal = 'kscope: unsafe vault root path: Missing';
	const { offers, refusals } = offeredVaults(
		reported({ profiles: { list: null, refusal }, global: { where: null, refusal: null } }),
	);

	assert.deepEqual(offers.map((offer) => offer.root), [WHERE_STARTED.root]);
	assert.deepEqual(refusals, [{ of: 'profiles', message: refusal }]);
});

test('a profile the engine calls invalid is shown and not offered', () => {
	// Hiding it would make a profile the user knows they created look deleted.
	const list = {
		...PROFILE_LIST,
		entries: [{ ...PROFILE_LIST.entries[1], valid: false }],
	};
	const { offers } = offeredVaults(
		reported({ profiles: { list, refusal: null }, global: { where: null, refusal: null } }),
	);

	const lantern = offers.find((offer) => offer.profile === 'lantern');
	assert.ok(lantern, 'An invalid profile was hidden rather than shown as unusable.');
	assert.equal(lantern.usable, false);
	assert.ok(lantern.unusable_because, 'Nothing says why it cannot be opened.');
});

// ---------------------------------------------------------------------------------------------
// 2. Two vaults, one short name
// ---------------------------------------------------------------------------------------------

test('two vaults with the same short name are told apart', () => {
	const { offers } = offeredVaults(reported());
	const names = offers.map((offer) => offer.name);

	assert.equal(new Set(names).size, names.length, `Two offers share a name: ${names.join(', ')}`);

	// And the disambiguation is by DIRECTORY, which is the thing that actually differs.
	const byRoot = new Map(offers.map((offer) => [offer.root, offer.name]));
	assert.equal(byRoot.get('/Users/you/code/lantern/.kaleidoscope'), 'code/lantern');
	assert.equal(byRoot.get('/Users/you/archive/lantern/.kaleidoscope'), 'archive/lantern');

	// A name that never collided keeps its one word: only the colliding entries grow.
	assert.equal(byRoot.get('/Volumes/scratch/tideline-vault'), 'tideline-vault');
	assert.equal(byRoot.get(WHERE_STARTED.root), 'harbour-lights');
});

test('a name grows only as far as it must, and falls back to the whole path when it cannot', () => {
	// Three "notes" at three depths: one segment is not enough, two is.
	const three = distinctNames([
		'/a/one/notes/.kaleidoscope',
		'/a/two/notes/.kaleidoscope',
		'/a/three/notes/.kaleidoscope',
	]);
	assert.deepEqual([...three.values()].sort(), ['one/notes', 'three/notes', 'two/notes']);

	// The dot-directory is never the name and never the qualifier: `.kaleidoscope` names every vault
	// on this machine and therefore names none of them.
	assert.equal(shortVaultName('/a/one/notes/.kaleidoscope'), 'notes');
	assert.equal(shortVaultName('/a/one/notes'), 'notes');

	// A name stops growing the moment it is distinct: `/notes` has nothing to its left, so the one
	// that CAN grow is the one that does.
	const uneven = distinctNames(['/notes', '/x/notes']);
	assert.deepEqual([...uneven.values()].sort(), ['notes', 'x/notes']);

	// Two roots this rule cannot separate get the whole path, which is ugly and correct: a reader
	// who cannot tell two entries apart cannot choose between them. A trailing slash is the case
	// that actually occurs — one profile stored `/srv/vaults/one/` and another `/srv/vaults/one`,
	// and they are the same directory addressed two ways.
	const unsplittable = distinctNames(['/srv/vaults/one', '/srv/vaults/one/']);
	assert.deepEqual(
		[...unsplittable.values()].sort(),
		['/srv/vaults/one', '/srv/vaults/one/'],
		'Two roots the name rule cannot separate were left wearing the same label.',
	);
});

// ---------------------------------------------------------------------------------------------
// 3. Switching targets the right root
// ---------------------------------------------------------------------------------------------

test('a key resolves to the root it was minted from, and to no other', () => {
	const { offers } = offeredVaults(reported());

	// This is what the switch does: the page sends a key, the process that read the engine looks it
	// up. The page never names a path — every endpoint refuses a `root`, `vault`, `path` or
	// `profile` parameter — so the lookup below is the whole of the switch's correctness.
	for (const offer of offers) {
		const found = offers.filter((candidate) => candidate.key === offer.key);
		assert.equal(found.length, 1, `The key ${offer.key} matches ${found.length} offers.`);
		assert.equal(found[0].root, offer.root, 'A key resolved to a different vault than it names.');
	}

	// Keys are a function of the root alone, so a menu rendered before a re-read still points at the
	// same directory afterwards — an index would silently retarget when the list changed.
	const again = offeredVaults(reported({ current: WHERE_GLOBAL.root }));
	for (const offer of offers) {
		const same = again.offers.find((candidate) => candidate.root === offer.root);
		assert.equal(same.key, offer.key, 'A key moved when the list was read a second time.');
	}

	// The key is not the path, and does not carry it: this is what keeps the switch inside the
	// reserved-parameter rule rather than beside it.
	for (const offer of offers) {
		assert.equal(offer.key.includes('/'), false, `The key ${offer.key} is a path.`);
		assert.notEqual(offer.key, offer.root);
	}

	// Two different roots never share a key.
	const keys = offers.map((offer) => offer.key);
	assert.equal(new Set(keys).size, keys.length);
	assert.notEqual(vaultKey('/a/one'), vaultKey('/a/two'));
});

test('marking the current vault is a comparison against the readings, not a position in the list', () => {
	const { offers } = offeredVaults(reported({ current: '/Volumes/scratch/tideline-vault' }));
	assert.equal(currentOffer(offers).profile, 'tideline');
	assert.equal(offers.filter((offer) => offer.current).length, 1);

	// A vault open by some route the engine no longer lists is still open and still readable. The
	// honest answer is "none of these is current", not the first row wearing a tick.
	const elsewhere = offeredVaults(reported({ current: '/somewhere/else/.kaleidoscope' }));
	assert.equal(currentOffer(elsewhere.offers), null);
});

// ---------------------------------------------------------------------------------------------
// 4. No path in the model was constructed by this app
// ---------------------------------------------------------------------------------------------

test('every offered root appears verbatim in what the engine printed', () => {
	// The mechanical version of the rule at the top of `src/shared/vaults.mjs`. A path this app
	// composed — a home directory joined to `.kaleidoscope`, a parent walked up to, a profile root
	// "corrected" to the conventional directory name — would not be a substring of the engine's own
	// output, and this is the assertion that would fail on the day someone adds one.
	const printed = JSON.stringify({
		where: WHERE_STARTED,
		profiles: PROFILE_LIST,
		global: WHERE_GLOBAL,
	});

	const { offers } = offeredVaults(reported());
	assert.ok(offers.length > 0, 'The check is vacuous if nothing was offered.');

	for (const offer of offers) {
		assert.ok(
			printed.includes(offer.root),
			`${offer.root} is not in anything the engine printed, so this app built it.`,
		);
		// And every offer says which reading it came out of, so the claim is checkable on one row
		// rather than only over the set.
		assert.ok(
			['kscope where', 'kscope profile list'].includes(offer.from),
			`${offer.root} does not name the engine reading it came from.`,
		);
	}
});

test('the model reads roots and never repairs them', () => {
	// A root the engine reported with a trailing slash, a relative-looking root, and a root that is
	// not under any home directory. All three are passed through EXACTLY: a picker that tidied a
	// path would be offering a directory the engine never named, and the engine is the only thing
	// that decides what a vault is.
	const odd = {
		version: 1,
		entries: [
			{ name: 'trailing', valid: true, profile: { name: 'trailing', root: '/srv/vaults/one/' } },
			{ name: 'bare', valid: true, profile: { name: 'bare', root: '/two' } },
			{ name: 'deep', valid: true, profile: { name: 'deep', root: '/mnt/a/b/c/d/.kaleidoscope' } },
		],
	};
	const { offers } = offeredVaults({
		started: { where: null, refusal: null },
		profiles: { list: odd, refusal: null },
		global: { where: null, refusal: null },
	});

	assert.deepEqual(
		offers.map((offer) => offer.root),
		['/srv/vaults/one/', '/two', '/mnt/a/b/c/d/.kaleidoscope'],
	);
	// The label may be derived; the address may not. A trailing slash changes the name and not the
	// root, which is the difference this test is about.
	assert.equal(offers[0].name, 'one');
	assert.equal(offers[1].name, 'two');
});

// ---------------------------------------------------------------------------------------------
// What the row says about where a vault came from
// ---------------------------------------------------------------------------------------------

test('the started vault says where the engine got it from, in the engine’s own word', () => {
	const { offers } = offeredVaults(reported());
	const started = offers.find((offer) => offer.kind === 'started');

	assert.equal(started.source, 'repository_default');
	// Passed through rather than translated: the engine prints the same word on stderr beside every
	// call, and a picker that renamed it would make the app and the terminal disagree about one fact.
	assert.equal(describeSource(started.source), 'repository default');
	assert.equal(describeSource(null), 'the engine');
});
