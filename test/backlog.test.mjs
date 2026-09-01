// The curation backlog, tested as arithmetic and one file on disk.
//
// Two halves, and the split is the design rather than a convenience:
//
//   * `src/app/backlog-model.mjs` is PURE. It takes the graph the browser already built from the
//     listing it already fetched, and returns findings, an order, and counts. It opens no vault,
//     spawns no process and issues no request — which is the requirement, not an accident: this
//     screen must be drivable end to end without touching the store it is reporting on, because
//     the one door that would make it convenient is a ranked query, and a ranked query writes a
//     permanent row into the vault it is inspecting.
//   * `src/server/dismissals.mjs` is the only part that touches a disk, and it touches THIS APP'S
//     state directory rather than the vault. It is tested against a temporary directory.
//
// The fixtures are built by hand from invented surfaces. Nothing here is vault content and nothing
// here is a vocabulary read from the engine — a fixture kind is a made-up string, because every
// assertion below is about topology, ordering and counting, and none of those care what a kind is
// called.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	FINDING_KINDS,
	RANKING,
	buildBacklog,
	compareFindings,
	compareGroups,
	dismissalKey,
	dismissalRecordFor,
	rankFindings,
} from '../src/app/backlog-model.mjs';
import { buildGraph } from '../src/app/graph-model.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { createDismissalStore, MAX_DISMISSALS } from '../src/server/dismissals.mjs';
import { startSidecar } from '../src/server/index.mjs';
import { countExposureRecords, fingerprintVault, openScratchVault } from './helpers/vault.mjs';

// ---------------------------------------------------------------------------------------------
// One fixture vault, carrying one planted instance of every kind of finding
// ---------------------------------------------------------------------------------------------
//
// The near-duplicate is the one that matters most and it is planted as the real thing this
// detector found on the development vault: two spellings of one measurement differing by a single
// hyphen, which therefore never merged, because identity in this system is character-exact.

const memory = (id, title, entities, facts) => ({
	memory_id: id,
	semantic: { title, memory_type: 'note', entities, facts },
});

const fact = (subject, predicate, object) => ({ subject, predicate, object });

const RECORDS = [
	memory(
		'mem-1',
		'Shortlist, first pass',
		[
			{ n: 'vandrel per quorix coefficient', kind: 'metric', is: 'a per-candidate weight' },
			{ n: 'the harness', kind: 'tool' },
		],
		[
			fact('vandrel per quorix coefficient', 'is computed by', 'the harness'),
			fact('the harness', 'runs on', 'control plane'),
		],
	),
	memory(
		'mem-2',
		'Shortlist, second pass',
		[{ n: 'vandrel per-quorix coefficient', kind: 'metric' }],
		[
			fact('vandrel per-quorix coefficient', 'was revised by', 'a second reviewer'),
			fact('a second reviewer', 'reports to', 'the panel'),
		],
	),
	memory(
		'mem-3',
		'Where deploys happen',
		[{ n: 'control plane', kind: 'tool', is: 'the deploy surface' }],
		[fact('control plane', 'runs on', 'the harness')],
	),
	memory(
		'mem-4',
		'What the invoice is for',
		[{ n: 'control plane', kind: 'service', is: 'a hosted API' }],
		[fact('control plane', 'is billed to', 'the harness')],
	),
	memory(
		'mem-5',
		'A note about a rock',
		[{ n: 'never mentioned', kind: 'idea', is: 'a name with no facts' }],
		[fact('moon rock', 'was sampled by', 'probe seven')],
	),
	// A SECOND island, and it is here to give the ordering test something to fail on. Two findings
	// with identical stake — one fact, one memory, two names — is the only shape that can expose a
	// sort whose tie-break is really the order the export arrived in, and with one island the
	// permutation test below passes whether the comparator is total or not.
	memory(
		'mem-6',
		'A note about a kettle',
		[],
		[fact('a kettle', 'boils', 'water')],
	),
];

const backlogOf = (records = RECORDS, dismissed = []) =>
	buildBacklog(buildGraph(records), { dismissed });

const findingsOfKind = (backlog, kind) => backlog.findings.filter((f) => f.kind === kind);

// ---------------------------------------------------------------------------------------------

test('a planted near-duplicate appears, with both spellings and every memory that writes either', () => {
	const backlog = backlogOf();
	const found = findingsOfKind(backlog, 'near-duplicate');

	assert.equal(
		found.length,
		1,
		`Expected exactly the planted pair and got ${found.length}: ` +
			`${found.map((f) => f.label).join(' | ')}.`,
	);

	const [finding] = found;
	assert.deepEqual(
		[...finding.names].sort(),
		['vandrel per quorix coefficient', 'vandrel per-quorix coefficient'],
		'The finding must carry both spellings. One of them is the whole point.',
	);

	// EVERY MEMORY, AND EVERY ONE OF THEM ADDRESSABLE. A finding that names a problem and cannot
	// name a memory to open is an observation, and this screen has no route out of an observation:
	// the editor is the only thing in this product that can change a vault.
	assert.deepEqual(
		finding.memories.map((entry) => entry.memory_id).sort(),
		['mem-1', 'mem-2'],
		'Both spellings are written by a different memory and both must be listed.',
	);
	for (const entry of finding.memories) {
		assert.ok(entry.memory_id, 'a listed memory with no id cannot be opened in the editor');
		assert.ok(entry.title, 'a listed memory with no title is a row a reader cannot choose between');
		assert.ok(
			entry.notes.length > 0,
			`${entry.memory_id} is listed with no note saying what it contributes. "Open one of ` +
				`these two" is a much harder decision when the row does not say which spelling is in it.`,
		);
	}

	// The rule that matched, and whether unifying would relabel or reconnect, are both on the
	// finding rather than re-derived in JSX. They are different acts and the screen says which.
	assert.equal(finding.detail.rule, 'punctuation-and-case');
	assert.equal(
		finding.detail.same_component,
		false,
		'These two spellings sit in separate groups in this fixture, so unifying them would join ' +
			'two parts of the vault that nothing currently connects.',
	);
});

test('every kind of finding is produced, and every finding ends in a memory', () => {
	const backlog = backlogOf();

	for (const kind of FINDING_KINDS) {
		assert.ok(
			findingsOfKind(backlog, kind.id).length > 0,
			`No finding of kind "${kind.id}" was produced from a fixture that plants one. A ` +
				`detector that silently returns nothing is indistinguishable from a clean vault.`,
		);
		// The sentence the decision is made on. A heading with no cost beside it sends the reader
		// to work out for themselves whether two nearly-identical strings matter.
		assert.ok(
			kind.costs.length > 40,
			`"${kind.id}" has no sentence saying what the problem costs the user.`,
		);
	}

	for (const finding of backlog.findings) {
		assert.ok(
			finding.memories.length > 0,
			`The finding "${finding.label}" (${finding.kind}) names no memory. Every route out of ` +
				`this screen is "open this memory in the editor", so a finding with none is a dead end.`,
		);
		for (const entry of finding.memories) {
			assert.ok(entry.memory_id, `${finding.key} lists a memory with no id`);
		}
	}
});

test('the order is by stake, and it is total — the same vault sorts the same way twice', () => {
	const backlog = backlogOf();

	// 1. The published order is the order the list is actually in.
	assert.deepEqual(
		backlog.findings.map((f) => f.key),
		rankFindings(backlog.findings).map((f) => f.key),
		'The findings are not in the order `rankFindings` produces.',
	);
	for (let index = 1; index < backlog.findings.length; index += 1) {
		assert.ok(
			compareFindings(backlog.findings[index - 1], backlog.findings[index]) <= 0,
			`Findings ${index - 1} and ${index} are out of stake order.`,
		);
	}

	// 2. It is BY STAKE, and the top of the list is the finding with the most facts behind it. The
	//    kind conflict on `control plane` touches three facts; the near-duplicate touches two.
	assert.equal(backlog.findings[0].kind, 'kind-conflict');
	assert.equal(backlog.findings[0].stake.facts, 3);
	assert.equal(backlog.findings[1].kind, 'near-duplicate');
	assert.equal(backlog.findings[1].stake.facts, 2);

	// 3. IT IS TOTAL, asserted on the comparator itself. This is the property, and a permutation
	//    test alone does not establish it: `Array.prototype.sort` is stable, so a comparator that
	//    returns 0 for two different findings still produces one fixed order for one fixed input,
	//    and the test goes green while the page reshuffles on the user's next write.
	const ties = [];
	for (let i = 0; i < backlog.findings.length; i += 1) {
		for (let j = i + 1; j < backlog.findings.length; j += 1) {
			if (compareFindings(backlog.findings[i], backlog.findings[j]) === 0) {
				ties.push(`${backlog.findings[i].label} / ${backlog.findings[j].label}`);
			}
		}
	}
	assert.deepEqual(
		ties,
		[],
		`Two distinct findings compare equal: ${ties.join(' | ')}. Their relative order is then ` +
			`whatever order the vault happened to be exported in, and it changes on every write.`,
	);

	// 4. And end to end: the same findings, generated from a permuted export, come out in the same
	//    order. The fixture carries two findings of identical stake for exactly this assertion —
	//    with one, this passes whether the comparator is total or not.
	const reversed = backlogOf([...RECORDS].reverse());
	assert.deepEqual(
		reversed.findings.map((f) => f.key),
		backlog.findings.map((f) => f.key),
		'Reversing the input records changed the ranking. The order is not total: it is only as ' +
			'stable as the order the vault happened to be exported in.',
	);

	// 5. The sentence on the screen and the sort are in one place, so they cannot drift apart.
	assert.ok(RANKING.sentence.includes('facts'), 'the printed ordering rule must name what it ranks by');
	assert.ok(RANKING.sentence.includes('memories'));
});

test('the groups are the same findings, in the same order, and are themselves ranked by stake', () => {
	const backlog = backlogOf();

	assert.equal(
		backlog.groups.reduce((total, group) => total + group.findings.length, 0),
		backlog.findings.length,
		'A finding is in the flat list and not in any group, or the other way round. Either way the ' +
			'screen renders a different set from the one the counts describe.',
	);

	for (const group of backlog.groups) {
		assert.deepEqual(
			group.findings.map((f) => f.key),
			rankFindings(group.findings).map((f) => f.key),
			`Group "${group.kind.id}" is not in stake order.`,
		);
		assert.equal(
			group.counts.facts,
			group.findings.reduce((total, f) => total + f.stake.facts, 0),
			`Group "${group.kind.id}" publishes a fact count that is not the sum of its findings'.`,
		);
	}

	// THE HEADINGS ARE IN STAKE ORDER TOO, and this assertion exists because the first rule was
	// wrong in a way no assertion about it could have caught. Ordering the headings by the SUM of
	// the stake under them is defensible arithmetic and it put "a relationship name used exactly
	// once" — two hundred and forty-nine findings worth one fact each — above the group holding the
	// nine-fact name conflict, on the real vault. True, and emphasising the wrong thing.
	for (let index = 1; index < backlog.groups.length; index += 1) {
		assert.ok(
			compareGroups(backlog.groups[index - 1], backlog.groups[index]) <= 0,
			`Group ${index} sorts above the group printed before it.`,
		);
	}

	// Said as the property rather than as the rule: the single most valuable finding on the page is
	// under the FIRST heading. That is what a reader working top-down is entitled to assume, and it
	// is the thing the sum broke.
	assert.equal(
		backlog.groups[0].findings[0].key,
		backlog.findings[0].key,
		`The highest-stake finding on the page is under heading ` +
			`"${backlog.groups.findIndex((g) => g.findings[0]?.key === backlog.findings[0].key) + 1}" ` +
			`rather than the first. A reader working top-down meets every trivial finding before it.`,
	);
});

test('the counts agree with the model, and the shares have a denominator that contains them', () => {
	const graph = buildGraph(RECORDS);
	const backlog = buildBacklog(graph, { dismissed: [] });
	const { counts } = backlog;

	assert.equal(counts.findings, backlog.findings.length);
	assert.equal(counts.dismissed, backlog.dismissed.length);
	assert.equal(
		counts.total,
		counts.findings + counts.dismissed,
		'The total is not the outstanding plus the dismissed, so one of the three is describing a ' +
			'different set from the other two.',
	);

	// The touched counts are recomputed here from the findings themselves rather than trusted.
	const memories = new Set();
	const names = new Set();
	const facts = new Set();
	for (const finding of backlog.findings) {
		for (const entry of finding.memories) memories.add(entry.memory_id);
		for (const name of finding.names) names.add(name);
		for (const edge of finding.edges) facts.add(edge.id);
	}
	assert.equal(counts.memories_touched, memories.size);
	assert.equal(counts.names_touched, names.size);
	assert.equal(counts.facts_touched, facts.size);

	// EVERY SHARE'S NUMERATOR IS INSIDE ITS DENOMINATOR. This is the check that caught a real
	// defect: `declared-never-used` is a finding about a name that appears in NO fact, so it has no
	// graph node — and the obvious denominator, the node count, does not contain it. A share of
	// 6-of-8 where one of the six is not among the eight is wrong by a little and cannot be caught
	// by looking at it.
	assert.ok(counts.memories_touched <= counts.memory_count, 'more memories touched than exist');
	assert.ok(counts.names_touched <= counts.name_count, 'more names touched than exist');
	assert.ok(counts.facts_touched <= counts.fact_count, 'more facts touched than exist');
	assert.equal(counts.memory_count, RECORDS.length);
	assert.equal(counts.fact_count, graph.counts.edgeCount);
	assert.equal(
		counts.name_count,
		graph.counts.nodeCount + graph.declaredNeverAsserted.length,
		'The name denominator must count names that appear only in a declaration, because one whole ' +
			'kind of finding on this screen is about exactly those.',
	);
	assert.ok(
		names.has('never mentioned'),
		'the fixture plants a declared-but-unused name, and it must be among the names touched',
	);
});

test('a dismissal key is derived from the finding, not from where it sat in the list', () => {
	const backlog = backlogOf();
	const reversed = backlogOf([...RECORDS].reverse());

	// A key built from an index, a position or a component id would be re-minted by the next write
	// — components are numbered in the order the export arrives — and every dismissal a person made
	// would come back as a fresh finding, with nothing on screen to say why.
	assert.deepEqual(
		backlog.findings.map((f) => f.key).sort(),
		reversed.findings.map((f) => f.key).sort(),
		'The keys changed when the input order changed. Dismissals cannot survive the next write.',
	);

	// The names are sorted inside the key, so the same pair spelled in the other order is one key.
	assert.equal(
		dismissalKey({ kind: 'near-duplicate', names: ['b', 'a'] }),
		dismissalKey({ kind: 'near-duplicate', names: ['a', 'b'] }),
	);
	// And the kind is IN the key: one surface can be the subject of two different findings, and
	// dismissing one of them must not silently hide the other.
	assert.notEqual(
		dismissalKey({ kind: 'near-duplicate', names: ['control plane'] }),
		dismissalKey({ kind: 'kind-conflict', names: ['control plane'] }),
	);
});

test('a dismissal filters the finding out, and survives an unrelated write to the vault', () => {
	const before = backlogOf();
	const target = findingsOfKind(before, 'near-duplicate')[0];

	// THE CONTROL, in the same run. A filter test whose subject was never present passes for the
	// wrong reason and stays green after the detector stops finding anything at all.
	assert.ok(target, 'the near-duplicate must be present BEFORE it is dismissed');

	const record = { ...dismissalRecordFor(target, { reason: 'two different runs' }), dismissed_at: '2026-09-01T00:00:00.000Z' };
	const after = backlogOf(RECORDS, [record]);

	assert.equal(
		findingsOfKind(after, 'near-duplicate').length,
		0,
		'The dismissed finding is still outstanding.',
	);
	assert.equal(after.counts.findings, before.counts.findings - 1);
	assert.equal(after.counts.dismissed, 1);
	assert.equal(after.counts.total, before.counts.total, 'dismissing must not change what exists');
	assert.equal(after.dismissed[0].key, target.key);
	assert.equal(
		after.dismissed[0].dismissal.reason,
		'two different runs',
		'The words the user typed must survive to the review screen. A store of opaque keys is a ' +
			'store nobody can audit.',
	);

	// The vault moves — an agent writes an unrelated memory — and the dismissal must still hold.
	// This is the second visit, which is the visit the whole feature exists for.
	const moved = backlogOf(
		[
			...RECORDS,
			memory(
				'mem-7',
				'Something else entirely',
				[{ n: 'the tide', kind: 'process' }],
				[fact('the tide', 'turns at', 'the harbour')],
			),
		],
		[record],
	);
	assert.equal(
		findingsOfKind(moved, 'near-duplicate').length,
		0,
		'A memory unrelated to the dismissed pair brought it back. The key is not stable across a write.',
	);

	// A dismissal whose finding is no longer in the vault is REPORTED, not dropped — the commonest
	// reason a key stops matching is that the user fixed the thing.
	const fixed = backlogOf(RECORDS.filter((r) => r.memory_id !== 'mem-2'), [record]);
	assert.equal(fixed.counts.resolved, 1);
	assert.equal(fixed.resolved[0].key, target.key);
});

// ---------------------------------------------------------------------------------------------
// The store: one file, beside the snapshots, keyed by vault
// ---------------------------------------------------------------------------------------------

function scratchState() {
	const dir = mkdtempSync(join(tmpdir(), 'ui-dismissals-'));
	return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

const VAULT_A = { root: '/tmp/vault-a', workspace_id: 'wsp-a' };
const VAULT_B = { root: '/tmp/vault-b', workspace_id: 'wsp-b' };

test('a dismissal persists: a new store over the same directory sees it', async (t) => {
	const state = scratchState();
	t.after(state.remove);

	const first = createDismissalStore({ vault: VAULT_A, directory: state.dir });
	assert.deepEqual((await first.list()).dismissals, [], 'a store never written to is empty, not broken');

	await first.dismiss({
		key: 'near-duplicateab',
		kind: 'near-duplicate',
		label: 'a · b',
		names: ['a', 'b'],
		reason: 'genuinely two things',
	});

	// A SECOND STORE OBJECT, which is what the next launch of the app is. Asserting through the
	// same instance would test a variable, not a file.
	const second = createDismissalStore({ vault: VAULT_A, directory: state.dir });
	const listed = await second.list();
	assert.equal(listed.dismissals.length, 1);
	assert.equal(listed.dismissals[0].key, 'near-duplicateab');
	assert.equal(listed.dismissals[0].reason, 'genuinely two things');
	assert.ok(listed.dismissals[0].dismissed_at, 'a dismissal with no date cannot be reviewed');

	// And it filters, through the model, exactly as a hand-built key does.
	const model = backlogOf(RECORDS, listed.dismissals);
	assert.equal(model.counts.dismissed, 0, 'this key matches no finding in this fixture');
	assert.equal(model.counts.resolved, 1, 'and it is therefore reported as no longer found');
});

test('the store is keyed by vault: one vault cannot see another vault’s decisions', async (t) => {
	const state = scratchState();
	t.after(state.remove);

	const a = createDismissalStore({ vault: VAULT_A, directory: state.dir });
	const b = createDismissalStore({ vault: VAULT_B, directory: state.dir });
	await a.dismiss({ key: 'k', kind: 'island', names: ['x'] });

	assert.equal((await a.list()).dismissals.length, 1);
	assert.deepEqual(
		(await b.list()).dismissals,
		[],
		'Two vaults share one dismissal file. A decision about one person’s vault is hiding ' +
			'findings in another.',
	);
	assert.notEqual(a.vault_key, b.vault_key);
});

test('dismissing twice replaces, restoring puts it back, and restoring what is not there says so', async (t) => {
	const state = scratchState();
	t.after(state.remove);
	const store = createDismissalStore({ vault: VAULT_A, directory: state.dir });

	await store.dismiss({ key: 'k', kind: 'island', names: ['x'], reason: 'first' });
	await store.dismiss({ key: 'k', kind: 'island', names: ['x'], reason: 'second' });
	const listed = await store.list();
	assert.equal(listed.dismissals.length, 1, 'clicking the same button twice grew the file');
	assert.equal(listed.dismissals[0].reason, 'second');

	const restored = await store.restore('k');
	assert.equal(restored.outcome, 'restored');
	assert.deepEqual((await store.list()).dismissals, []);

	// Reported rather than silently succeeding: "restored" over a key that was not there means the
	// screen and the store disagree about what is dismissed, and the screen wins forever.
	assert.equal((await store.restore('k')).outcome, 'not-dismissed');
});

test('the store refuses what it cannot key, and refuses a corrupt file rather than reading it as empty', async (t) => {
	const state = scratchState();
	t.after(state.remove);

	const store = createDismissalStore({ vault: VAULT_A, directory: state.dir });
	await assert.rejects(() => store.dismiss({ kind: 'island' }), /key/i);

	mkdirSync(join(state.dir, 'dismissals'), { recursive: true });
	writeFileSync(join(state.dir, 'dismissals', `${store.vault_key}.json`), '{not json', 'utf8');

	// THE IMPORTANT HALF. Answering "you have dismissed nothing" over a file that holds a hundred
	// decisions puts every one of them back on the screen with nothing to say anything went wrong,
	// and the user re-answers questions they already answered.
	await assert.rejects(() => store.list(), /JSON/i);

	assert.ok(MAX_DISMISSALS > 1000, 'the ceiling must be far above any real curation session');
});

test('the backlog model reaches nothing: it imports the graph and nothing else', async () => {
	const source = await import('node:fs/promises').then((fs) =>
		fs.readFile(new URL('../src/app/backlog-model.mjs', import.meta.url), 'utf8'),
	);
	const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
	assert.deepEqual(
		imports,
		['./graph-model.mjs'],
		`The backlog model imports ${imports.join(', ')}. It must be pure arithmetic over a payload ` +
			`the browser already has: the one door that would make this screen convenient is a ranked ` +
			`query, and a ranked query writes a permanent row into the vault it is inspecting.`,
	);
	assert.ok(!/fetch\s*\(/.test(source), 'the backlog model must issue no request');
});

// ---------------------------------------------------------------------------------------------
// The two routes, driven through the real sidecar
// ---------------------------------------------------------------------------------------------
//
// WHY THIS IS HERE AND NOT LEFT TO THE PURE TESTS ABOVE. Everything above proves the model filters
// on a dismissal and the store keeps one. Neither of them proves that the button on the screen
// reaches the store — the route could be absent, unwired, or reading a different directory from the
// one the write handlers were given, and every assertion above would still be green. That is the
// standing failure this repository keeps meeting: a mechanism that is built, documented, tested and
// never called, whose counter reads zero because nothing invokes it.
//
// It also asserts the other half, which is the one the whole screen's copy rests on: **a dismissal
// writes nothing to the vault.** The screen says so in words at the point of the click, and this is
// what makes that sentence a measurement instead of a promise.


test('the dismissal routes reach the store, and writing one does not touch the vault', async (t) => {
	const engine = await locateEngine();
	if (!engine.found) {
		// Loud, not silent. A skip that reads like a pass is how an unwired route ships.
		throw new Error(
			`No engine on this machine, so the sidecar cannot be started and these routes cannot be ` +
				`exercised. ${engine.message ?? ''}`,
		);
	}

	const scratch = openScratchVault({ enginePath: engine.path, label: 'backlog-routes' });
	t.after(() => scratch.close());

	const sidecar = await startSidecar({
		enginePath: engine.path,
		root: scratch.root,
		host: '127.0.0.1',
		port: 0,
		snapshotsDir: scratch.state_dir,
	});
	t.after(() => sidecar.close());

	const base = `http://127.0.0.1:${sidecar.port}`;
	const ask = (path, init = {}) =>
		fetch(`${base}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${sidecar.token}`,
				// A state-changing request with no Origin is refused, by design. Sending the app's
				// own is what the app does, and it is what makes this a test of the route rather
				// than of the Origin check.
				origin: base,
				...(init.body ? { 'content-type': 'application/json' } : {}),
				...(init.headers ?? {}),
			},
		});

	const before = fingerprintVault(scratch.root);
	const exposuresBefore = countExposureRecords(scratch.root);
	assert.ok(exposuresBefore.stores > 0, 'no exposure store was found, so the count below is blind');

	const empty = await (await ask('/api/dismissals')).json();
	assert.equal(empty.outcome, 'listed');
	assert.deepEqual(empty.dismissals, [], 'a vault nobody has curated has dismissed nothing');
	assert.ok(
		!empty.directory.startsWith(scratch.root),
		`The dismissal store is inside the vault at ${empty.directory}. This app's own opinions ` +
			`would then be exported, retrieved by the user's agents, and counted in every number ` +
			`this product reports about their memory.`,
	);

	const key = dismissalKey({ kind: 'near-duplicate', names: ['mirdel beacon', 'the mirdel beacon'] });
	const written = await (
		await ask('/api/dismissals', {
			method: 'POST',
			body: JSON.stringify({
				action: 'dismiss',
				key,
				kind: 'near-duplicate',
				label: 'mirdel beacon · the mirdel beacon',
				names: ['mirdel beacon', 'the mirdel beacon'],
				reason: 'one is the file, one is the value in it',
			}),
		})
	).json();
	assert.equal(written.outcome, 'dismissed');

	const listed = await (await ask('/api/dismissals')).json();
	assert.equal(listed.dismissals.length, 1, 'the POST returned success and the GET cannot see it');
	assert.equal(listed.dismissals[0].key, key);
	assert.equal(listed.dismissals[0].reason, 'one is the file, one is the value in it');

	// The inverse, through the same door. A one-way hide is how a backlog quietly stops reporting.
	const restored = await (
		await ask('/api/dismissals', { method: 'POST', body: JSON.stringify({ action: 'restore', key }) })
	).json();
	assert.equal(restored.outcome, 'restored');
	assert.deepEqual((await (await ask('/api/dismissals')).json()).dismissals, []);

	// An action this route does not have is refused rather than treated as a dismissal.
	const bad = await ask('/api/dismissals', {
		method: 'POST',
		body: JSON.stringify({ action: 'delete-everything', key }),
	});
	assert.equal(bad.status, 400);

	// THE VAULT, BYTE FOR BYTE. Four requests, two of them writes, and not one file moved.
	const after = fingerprintVault(scratch.root);
	assert.deepEqual(
		after,
		before,
		'A dismissal changed the vault. The screen tells the user in words that it only changes ' +
			'what this app shows them, and that sentence has to be true.',
	);
	assert.deepEqual(
		countExposureRecords(scratch.root),
		exposuresBefore,
		'The curation surface recorded a ranked search.',
	);
});
