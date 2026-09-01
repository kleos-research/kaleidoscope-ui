// The cluster review, and the batch merge that finishes it.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS BESIDE merge.test.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `merge.test.mjs` proves ONE rename: the preview names exactly what changes, the run rewrites all
// of it, a stale version stops it, the boundary is readable and a resume finishes it without
// redoing. All of that still holds and none of it is repeated here.
//
// A cluster review is N renames from one gesture, and every property that makes a batch different
// from a loop is a property no single-rename test can see:
//
//   * a cluster of three spellings is TWO renames, and the second is planned against the first
//     one's result — a batch planned against the listing the page loaded would preview facts that
//     the first rename has already changed;
//   * a memory written by two steps is NAMED before the button, because after the first write its
//     version has moved and the second step's approved plan is stale;
//   * the run RE-READS THE VAULT between steps, and refuses to send a step whose rewrite no longer
//     matches what the reader approved. That guard is load-bearing rather than decorative, and the
//     last test in this file is the one that would fail if it were removed: without the re-read the
//     second step is refused by the engine on a conflict this app caused;
//   * the boundary is at TWO levels. Which renames finished, which stopped, which were never
//     started — and, inside the one that stopped, which memories were written and which were never
//     reached. A report with only the first would show a half-written rename as a whole one.
//
// Everything that writes runs against a clone, through the same helpers every other file uses.
// Every surface, kind and relation name below is INVENTED: this repository is public, the vault it
// was developed against is not, and an example lifted out of a vault is a disclosure no text
// scanner can catch because a scanner has no vault to compare a fixture with.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequestRaw } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { childFieldNames } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';
import { buildBacklog, dismissalKey } from '../src/app/backlog-model.mjs';
import {
	applyRename,
	buildClusters,
	describeBatchResume,
	FINGERPRINT,
	planClusterBatch,
	samePlanShape,
	stepRequest,
	summariseBatch,
} from '../src/app/cluster-model.mjs';
import { buildGraph } from '../src/app/graph-model.mjs';
import { planRename, renameRequest } from '../src/app/merge-model.mjs';
import { countExposureRecords, openScratchVault } from './helpers/vault.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE_TIMEOUT_MS = 120_000;

/** Everything this file writes into a vault carries it, so a stray fixture is recognisable. */
const MARK = 'ui-cluster-fixture';

// =============================================================================================
// PART 1 — the arithmetic, with no engine and no disk under it
// =============================================================================================

/**
 * A listing shaped exactly as the export door returns one. Written by hand rather than generated,
 * because every assertion below is about a specific planted collision.
 */
const record = (id, { title, entities, facts, version = `${id}-v1` }) => ({
	memory_id: id,
	version_id: version,
	semantic: { title, memory_type: `${MARK}-note`, entities, facts },
});

const declare = (name) => ({ n: name, kind: 'vandrel', is: `${name} | vandrel | invented by a test` });

/** Three spellings of one invented name, plus an unrelated one that must never join them. */
const FIXTURE = [
	record('m-1', {
		title: 'the first note',
		entities: [declare('quorix beacon'), declare('mirdel trellis')],
		facts: [{ subject: 'quorix beacon', predicate: 'thavs', object: 'mirdel trellis' }],
	}),
	record('m-2', {
		title: 'the second note',
		entities: [declare('the quorix beacon'), declare('ozar reading')],
		facts: [{ subject: 'the quorix beacon', predicate: 'thavs', object: 'ozar reading' }],
	}),
	record('m-3', {
		title: 'the third note',
		entities: [declare('Quorix-Beacon'), declare('faid window')],
		facts: [{ subject: 'Quorix-Beacon', predicate: 'thavs', object: 'faid window' }],
	}),
	// One memory that writes BOTH LOSING spellings, which is what makes a batch different from a
	// loop: the second step has to plan against this memory as the first step left it, and the run
	// has to re-read its version before writing it a second time.
	record('m-4', {
		title: 'the fourth note',
		entities: [declare('Quorix-Beacon'), declare('the quorix beacon'), declare('kesh index')],
		facts: [
			{ subject: 'Quorix-Beacon', predicate: 'gorms', object: 'kesh index' },
			{ subject: 'the quorix beacon', predicate: 'ilexes', object: 'kesh index' },
		],
	}),
	record('m-5', {
		title: 'an unrelated note',
		entities: [declare('brim lattice'), declare('lune shard')],
		facts: [{ subject: 'brim lattice', predicate: 'thavs', object: 'lune shard' }],
	}),
];

const clustersOf = (records, { dismissed = [] } = {}) =>
	buildClusters(buildBacklog(buildGraph(records), { dismissed }));

/** The fixture's one cluster with a chosen survivor, the way the screen hands it to the planner. */
function pinned(survivor) {
	const backlog = buildBacklog(buildGraph(FIXTURE));
	const first = buildClusters(backlog).clusters[0];
	return buildClusters(backlog, { survivors: new Map([[first.key, survivor]]) });
}

test('the fingerprint proposes the planted spellings and nothing else', () => {
	const review = clustersOf(FIXTURE);

	assert.equal(review.counts.clusters, 1, 'the fingerprint proposed more than the one planted cluster');
	const [cluster] = review.clusters;
	assert.deepEqual(
		cluster.spellings.map((entry) => entry.surface).sort(),
		['Quorix-Beacon', 'quorix beacon', 'the quorix beacon'],
		'the three planted spellings are not the cluster',
	);

	// And the rule the screen prints is the rule that ran. A key described in JSX and computed in a
	// module drifts the first time either is touched, and a reader told the wrong rule cannot tell a
	// bad cluster from a bad explanation.
	assert.equal(FINGERPRINT.of('the Quorix-Beacon.'), FINGERPRINT.of('quorix beacon'));
	assert.notEqual(FINGERPRINT.of('brim lattice'), FINGERPRINT.of('quorix beacon'));

	// The check has to be capable of failing: a fingerprint that collapsed everything would satisfy
	// the equality above and say nothing.
	assert.notEqual(FINGERPRINT.of('lune shard'), FINGERPRINT.of('kesh index'));
});

test('the default survivor is the spelling with the most facts, and it is overridable', () => {
	const review = clustersOf(FIXTURE);
	const [cluster] = review.clusters;

	// `Quorix-Beacon` and `the quorix beacon` are written twice each and `quorix beacon` once, so
	// the reader's default is whichever the detector ranks first — and the rule is stated rather
	// than assumed, because keeping the busier spelling is the smaller rewrite: fewer memories
	// written, fewer copies taken, fewer chances for the run to stop partway.
	const busiest = [...cluster.spellings].sort((a, b) => b.facts - a.facts || a.surface.localeCompare(b.surface))[0];
	assert.equal(cluster.survivor, busiest.surface);
	assert.deepEqual(
		cluster.losing.sort(),
		cluster.spellings.map((entry) => entry.surface).filter((surface) => surface !== busiest.surface).sort(),
	);

	// The default is a default. A typo can out-number the name it is a typo of, so the choice is
	// always the reader's.
	const chosen = buildClusters(buildBacklog(buildGraph(FIXTURE)), {
		survivors: new Map([[cluster.key, 'quorix beacon']]),
	});
	assert.equal(chosen.clusters[0].survivor, 'quorix beacon');
	assert.deepEqual(chosen.clusters[0].losing.sort(), ['Quorix-Beacon', 'the quorix beacon']);

	// A survivor that is not in the cluster is ignored rather than obeyed: a stale choice left over
	// from a merge that already happened would otherwise plan a rename to a name nothing uses.
	const stale = buildClusters(buildBacklog(buildGraph(FIXTURE)), {
		survivors: new Map([[cluster.key, 'a name from another vault']]),
	});
	assert.equal(stale.clusters[0].survivor, busiest.surface);
});

test('a cluster carries the SAME key the dismissal store holds, so one answer answers both screens', () => {
	const review = clustersOf(FIXTURE);
	const [cluster] = review.clusters;

	// The key is the finding's key, derived from the finding's own content. If the review screen
	// minted its own, "these really are two different things" answered on one screen would leave
	// the other still asking.
	assert.equal(cluster.key, dismissalKey({ kind: 'near-duplicate', key_names: cluster.spellings.map((s) => s.surface) }));

	const after = clustersOf(FIXTURE, { dismissed: [cluster.key] });
	assert.equal(after.counts.clusters, 0, 'a dismissed cluster is still proposed');
	assert.equal(after.counts.dismissed, 1, 'a dismissed cluster is not reviewable');
});

test('a three-spelling cluster is two renames, and the second is planned against the first one’s result', () => {
	// The survivor is pinned rather than defaulted, so the expectations below are about the batch
	// rather than about which of three spellings happened to be busiest in this fixture.
	const review = pinned('quorix beacon');
	const batch = planClusterBatch(FIXTURE, review.clusters);

	assert.equal(batch.counts.steps, 2, 'a cluster of three spellings is not two renames');
	assert.deepEqual(
		batch.steps.map((step) => [step.from, step.to]),
		[
			['Quorix-Beacon', 'quorix beacon'],
			['the quorix beacon', 'quorix beacon'],
		],
		'the steps are not the losing spellings in a stable order',
	);

	// THE POINT OF THE SIMULATION. m-4 writes two of the three spellings. After step 1 it is
	// untouched, but after step 2 it holds two facts that are now about the same subject — and the
	// second step's preview says so, which it could only do if it were planned against the first
	// step's result rather than against the listing the page loaded.
	const second = batch.steps[1].plan.memories.find((memory) => memory.memory_id === 'm-4');
	assert.ok(second, 'the second step does not name the memory that writes both spellings');
	assert.ok(
		second.statements.some((statement) => statement.after.startsWith('quorix beacon')),
		'the second step did not rewrite the subject of m-4',
	);

	// A memory written by more than one step is NAMED. It is the reader's only warning that a later
	// step's preview describes a memory an earlier step will already have changed.
	assert.deepEqual(
		batch.crossed.map((entry) => entry.memory_id),
		['m-4'],
		'the memory written by both steps is not named in the preview',
	);

	// The preview names memories, never only a count — the whole failure it exists to prevent is
	// somebody authorising a rewrite of memories they have not seen.
	assert.deepEqual(batch.steps[0].plan.memories.map((memory) => memory.memory_id).sort(), ['m-3', 'm-4']);
	assert.deepEqual(
		batch.steps[1].plan.memories.map((memory) => memory.memory_id).sort(),
		['m-2', 'm-4'],
	);
});

test('planning a batch writes nothing, and the same tick set plans the same batch twice', () => {
	const review = pinned('quorix beacon');
	const before = JSON.stringify(FIXTURE);

	const once = planClusterBatch(FIXTURE, review.clusters);
	const twice = planClusterBatch(FIXTURE, review.clusters);

	assert.equal(JSON.stringify(FIXTURE), before, 'planning mutated the records it was given');
	assert.deepEqual(
		once.steps.map((step) => [step.from, step.to, step.plan.memories.map((m) => m.memory_id)]),
		twice.steps.map((step) => [step.from, step.to, step.plan.memories.map((m) => m.memory_id)]),
		'two plans over one vault are not the same plan',
	);

	// The simulation is a copy, and the copy is what the next step reads.
	const rewritten = applyRename(FIXTURE, { from: 'Quorix-Beacon', to: 'quorix beacon' });
	assert.equal(JSON.stringify(FIXTURE), before, 'applyRename mutated its input');
	// Asserted on the NAMES rather than on the whole document, because a rewrite deliberately leaves
	// the retired spelling wherever a person wrote it as a sentence — a gloss, a title, a qualifier.
	// Rewriting those is authoring, and authoring is not something a loop does to N memories.
	const named = (records) =>
		new Set(
			records.flatMap((entry) => [
				...entry.semantic.entities.map((one) => one.n),
				...entry.semantic.facts.flatMap((fact) => [fact.subject, fact.object]),
			]),
		);
	assert.ok(named(rewritten).has('quorix beacon'), 'the simulated rewrite did not land in the copy');
	assert.ok(!named(rewritten).has('Quorix-Beacon'), 'the simulated rewrite left the retired spelling named');
	assert.ok(named(FIXTURE).has('Quorix-Beacon'), 'the input lost the spelling the copy was supposed to rewrite');
});

test('a step whose rewrite has moved is refused rather than sent', () => {
	const review = pinned('quorix beacon');
	const batch = planClusterBatch(FIXTURE, review.clusters);
	const step = batch.steps[1];

	// The same plan re-derived from the same records agrees with itself. That is the case the guard
	// must NOT fire on — a guard that refuses everything is not a guard.
	const same = planRename(applyRename(FIXTURE, { from: 'Quorix-Beacon', to: 'quorix beacon' }), {
		from: step.from,
		to: step.to,
	});
	assert.equal(samePlanShape(step.plan, same).same, true, 'the guard refuses a step that has not moved');

	// A memory that gained a fact naming the retired spelling since the preview is a memory whose
	// rewrite is no longer what the reader approved.
	const moved = FIXTURE.map((entry) =>
		entry.memory_id === 'm-2'
			? {
					...entry,
					semantic: {
						...entry.semantic,
						facts: [
							...entry.semantic.facts,
							{ subject: 'the quorix beacon', predicate: 'gorms', object: 'ozar reading' },
						],
					},
				}
			: entry,
	);
	const replanned = planRename(applyRename(moved, { from: 'Quorix-Beacon', to: 'quorix beacon' }), {
		from: step.from,
		to: step.to,
	});
	const verdict = samePlanShape(step.plan, replanned);
	assert.equal(verdict.same, false, 'a step whose facts moved is treated as the one that was approved');
	assert.match(verdict.why, /m-2/, 'the refusal does not name the memory that moved');
});

test('the boundary is drawn at both levels, and a resume names only what is left', () => {
	const review = pinned('quorix beacon');
	const batch = planClusterBatch(FIXTURE, review.clusters);

	// Step one finished. Step two stopped inside itself: one memory rewritten, one never reached.
	const results = [
		{
			state: 'done',
			report: {
				from: 'Quorix-Beacon',
				to: 'quorix beacon',
				stopped: false,
				items: [{ memory_id: 'm-3', title: 'the third note', state: 'rewritten', observed: { facts_rewritten: 1 } }],
				snapshots: [{ snapshot_id: 'copy-1', operation: 'update', memory_id: 'm-3', payload_bytes: 10 }],
			},
		},
		{
			state: 'stopped',
			report: {
				from: 'the quorix beacon',
				to: 'quorix beacon',
				stopped: true,
				items: [
					{ memory_id: 'm-2', title: 'the second note', state: 'rewritten', observed: { facts_rewritten: 1 } },
					{ memory_id: 'm-4', title: 'the fourth note', state: 'changed', message: 'it moved' },
				],
				snapshots: [{ snapshot_id: 'copy-2', operation: 'update', memory_id: 'm-2', payload_bytes: 10 }],
				resume: { from: 'the quorix beacon', to: 'quorix beacon', items: [{ memory_id: 'm-4', seen_version_id: null }] },
			},
		},
	];

	const summary = summariseBatch(batch.steps, results);

	assert.equal(summary.complete, false);
	assert.equal(summary.done.length, 1, 'the rename that finished is not counted as finished');
	assert.equal(summary.stopped_on.from, 'the quorix beacon', 'the boundary does not name the rename that stopped');

	// LEVEL TWO. Inside the stopped rename, one memory landed and one did not — and a report that
	// gave only the level above would show a half-written rename as a whole one.
	assert.deepEqual(summary.stopped_on.run.rewritten.map((item) => item.memory_id), ['m-2']);
	assert.equal(summary.stopped_on.run.stopped_on.memory_id, 'm-4');

	// Every copy the whole batch took, listed rather than counted.
	assert.deepEqual(summary.snapshots.map((entry) => entry.snapshot_id), ['copy-1', 'copy-2']);

	// The counts are the ones a reader can check against the rows.
	assert.equal(summary.counts.memories, 2);
	assert.equal(summary.counts.done, 1);

	const resume = describeBatchResume(summary);
	assert.equal(resume.from_index, 1, 'a resume does not start at the rename that stopped');
	assert.match(resume.sentence, /the quorix beacon/);
	assert.match(resume.sentence, /not run again/, 'a resume does not say what it will skip');

	// A complete run offers no resume at all, which is the negative half of the same rule.
	const finished = summariseBatch(batch.steps, [results[0], { state: 'done', report: { ...results[1].report, stopped: false, items: results[1].report.items.map((item) => ({ ...item, state: 'rewritten' })) } }]);
	assert.equal(finished.complete, true);
	assert.equal(describeBatchResume(finished), null);
});

test('the cluster model reaches nothing: no fetch, no React, no engine', async () => {
	const source = readFileSync(join(ROOT, 'src/app/cluster-model.mjs'), 'utf8');
	for (const forbidden of ['fetch(', 'react', 'XMLHttpRequest', 'node:', 'window.', 'document.']) {
		assert.ok(!source.includes(forbidden), `cluster-model.mjs reaches for ${forbidden}`);
	}
	// It composes the graph, the backlog's findings and the rename plan, and nothing else — so the
	// clustering a test drives is the clustering the screen renders.
	const imports = [...source.matchAll(/^import .*? from '(.+?)';$/gm)].map((match) => match[1]).sort();
	assert.deepEqual(imports, ['../shared/rename.mjs', './graph-model.mjs', './merge-model.mjs']);
});

// =============================================================================================
// PART 2 — a two-step batch through the HTTP surface, against a clone of a real vault
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

	const holder = mkdtempSync(join(tmpdir(), 'ui-cluster-state-'));
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
	return { engine, scratch, sidecar };
}

/** Vocabulary read from the engine a moment ago. NOTHING here is transcribed. */
async function vocabularyOf(sidecar) {
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
	return { memoryType, kind: pick('semantic_delta.entities.kind'), predicate: pick('semantic_delta.facts.predicate') };
}

async function createMemory(sidecar, vocabulary, { title, names, facts }) {
	const created = json(
		await authorised(sidecar, {
			method: 'POST',
			path: '/api/memories',
			body: {
				content_md: `# ${title}\n\nA memory this test created, marked ${MARK}.\n`,
				semantic_delta: {
					title,
					memory_type: vocabulary.memoryType,
					entities: names.map((name) => ({
						n: name,
						kind: vocabulary.kind,
						is: `${name} | ${vocabulary.kind} | invented by a test`,
					})),
					facts: facts.map(([subject, object]) => ({
						subject,
						predicate: vocabulary.predicate,
						object,
					})),
				},
			},
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'POST /api/memories',
	);
	assert.equal(created.outcome, 'applied', `the create did not apply: ${JSON.stringify(created).slice(0, 400)}`);
	return created.data.memory_id;
}

const listing = async (sidecar) => {
	const body = json(await authorised(sidecar, { path: '/api/memories?refresh=1' }), 'GET /api/memories');
	return body.memories ?? [];
};

const rename = async (sidecar, request) =>
	json(
		await authorised(sidecar, {
			method: 'POST',
			path: '/api/renames',
			body: request,
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'POST /api/renames',
	);

/**
 * The whole batch, run the way the screen runs it: re-read and re-plan before every step after a
 * write, and refuse to send a step whose rewrite has moved.
 */
async function runBatch(sidecar, batch, { reread = true } = {}) {
	const results = [];
	let wrote = false;
	for (const step of batch.steps) {
		if (step.writes === 0) {
			results.push({ state: 'nothing_to_write' });
			continue;
		}
		let request = stepRequest(step);
		if (wrote && reread) {
			const fresh = await listing(sidecar);
			const replanned = planRename(fresh, { from: step.from, to: step.to });
			const agreement = samePlanShape(step.plan, replanned);
			if (!agreement.same) {
				results.push({ state: 'moved', why: agreement.why });
				break;
			}
			request = renameRequest(replanned);
		}
		const report = await rename(sidecar, request);
		wrote = true;
		results.push({ state: report.stopped ? 'stopped' : 'done', report });
		if (report.stopped) break;
	}
	return summariseBatch(batch.steps, results);
}

test('a three-spelling cluster merges in two renames, each with a copy first', async (t) => {
	const { sidecar, scratch } = await openSidecar(t, 'cluster-batch');

	// The instrument, checked before it is believed. A census that found nowhere to look reports
	// zero records, and zero compared against zero passes hardest when it is broken.
	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(beforeExposure.stores > 0, 'no search-exposure store was found in the clone');

	const vocabulary = await vocabularyOf(sidecar);
	const survivor = `${MARK} quorix beacon`;
	const withArticle = `the ${MARK} quorix beacon`;
	// LOWERCASE ON PURPOSE. The engine normalises an entity surface's case on the way in, so a
	// spelling planted with capitals comes back lowercased and the assertion below would be about a
	// string this vault never held. The spellings here therefore differ by PUNCTUATION and a joining
	// word, which are the differences that actually survive a write.
	const hyphenated = `${MARK}-quorix-beacon`;

	const ids = {
		first: await createMemory(sidecar, vocabulary, {
			title: `${MARK} first`,
			names: [survivor, `${MARK} mirdel trellis`],
			facts: [[survivor, `${MARK} mirdel trellis`]],
		}),
		second: await createMemory(sidecar, vocabulary, {
			title: `${MARK} second`,
			names: [withArticle, `${MARK} ozar reading`],
			facts: [[withArticle, `${MARK} ozar reading`]],
		}),
		third: await createMemory(sidecar, vocabulary, {
			title: `${MARK} third`,
			names: [hyphenated, `${MARK} faid window`],
			facts: [[hyphenated, `${MARK} faid window`]],
		}),
		// The memory that writes BOTH LOSING spellings, so the second rename must carry a version
		// the FIRST rename produced.
		fourth: await createMemory(sidecar, vocabulary, {
			title: `${MARK} fourth`,
			names: [withArticle, hyphenated, `${MARK} kesh index`],
			facts: [
				[withArticle, `${MARK} kesh index`],
				[hyphenated, `${MARK} kesh index`],
			],
		}),
	};

	const records = await listing(sidecar);
	const backlog = buildBacklog(buildGraph(records));
	const proposed = buildClusters(backlog).clusters.filter((cluster) =>
		cluster.spellings.every((entry) => entry.surface.includes(MARK)),
	);
	assert.equal(proposed.length, 1, 'the planted spellings were not proposed as one cluster');
	assert.deepEqual(
		proposed[0].spellings.map((entry) => entry.surface).sort(),
		[hyphenated, survivor, withArticle].sort(),
		'the cluster is not the three planted spellings',
	);

	// The survivor is CHOSEN rather than defaulted, because this test is about the batch and not
	// about which of three spellings this fixture happened to make busiest.
	const planted = buildClusters(backlog, {
		survivors: new Map([[proposed[0].key, survivor]]),
	}).clusters.filter((cluster) => cluster.spellings.every((entry) => entry.surface.includes(MARK)));

	const batch = planClusterBatch(records, planted);
	assert.equal(batch.counts.steps, 2, 'three spellings did not plan as two renames');
	assert.deepEqual(
		batch.crossed.map((entry) => entry.memory_id),
		[ids.fourth],
		'the memory written by both renames is not named in the preview',
	);

	const summary = await runBatch(sidecar, batch);

	assert.equal(summary.complete, true, `the batch stopped: ${JSON.stringify(summary.stopped_on).slice(0, 400)}`);
	assert.equal(summary.counts.done, 2, 'both renames did not finish');

	// A COPY BEFORE EVERY WRITE. Counted per WRITE rather than per memory, because the memory that
	// holds both losing spellings is written twice and must be copied twice — a store that kept one
	// copy per memory would satisfy "copies exist" and would have lost that memory's middle state.
	const writes = summary.rows.reduce((total, row) => total + (row.run?.rewritten.length ?? 0), 0);
	assert.equal(writes, 4, 'the batch did not write the memory that holds both losing spellings twice');
	assert.equal(summary.counts.memories, 3, 'the batch wrote a memory it did not need to');
	assert.equal(summary.snapshots.length, writes, 'the run wrote more times than it kept copies');

	// VERIFIED THROUGH THE VAULT, not through the responses that reported success. Every planted
	// spelling is gone and the survivor holds all four facts.
	const after = await listing(sidecar);
	const surfaces = new Set(
		after.flatMap((entry) => [
			...(entry.semantic?.entities ?? []).map((one) => one.n),
			...(entry.semantic?.facts ?? []).flatMap((fact) => [fact.subject, fact.object]),
		]),
	);
	assert.ok(surfaces.has(survivor), 'the surviving spelling is not in the vault');
	assert.ok(!surfaces.has(withArticle), 'the spelling with the article survived the merge');
	assert.ok(!surfaces.has(hyphenated), 'the hyphenated spelling survived the merge');

	// AND THE CLUSTER IS GONE — which is what re-clustering after a run is for. A review screen
	// that kept proposing this would invite the same merge twice, and the second one would write
	// every memory again to change nothing.
	const recomputed = clustersOf(after).clusters.filter((cluster) =>
		cluster.spellings.every((entry) => entry.surface.includes(MARK)),
	);
	assert.deepEqual(recomputed, [], 'the merged cluster is still proposed after the merge');

	// The whole batch recorded no ranked search. There are zero callers of the ranked door on this
	// path and a curation run does not add the first one.
	const afterExposure = countExposureRecords(scratch.root);
	assert.equal(
		afterExposure.records,
		beforeExposure.records,
		'a curation run recorded a ranked search',
	);
});

test('WITHOUT the re-read between steps the second rename is refused — the guard is load-bearing', async (t) => {
	// The negative control for the test above. The re-read is not a tidiness: after the first
	// rename, the memory that writes both spellings carries a new version, and a second step sent
	// with the version the preview was built from is refused for a conflict this app caused. If
	// this test ever passes as "completed", the re-read has stopped mattering and the one above is
	// no longer evidence of anything.
	const { sidecar } = await openSidecar(t, 'cluster-noreread');
	const vocabulary = await vocabularyOf(sidecar);

	const survivor = `${MARK} thav lattice`;
	const hyphenated = `${MARK}-thav-lattice`;

	await createMemory(sidecar, vocabulary, {
		title: `${MARK} both spellings`,
		names: [survivor, hyphenated, `${MARK} nub anchor`],
		facts: [
			[survivor, `${MARK} nub anchor`],
			[hyphenated, `${MARK} nub anchor`],
		],
	});
	await createMemory(sidecar, vocabulary, {
		title: `${MARK} one more`,
		names: [hyphenated, `${MARK} wex column`],
		facts: [[hyphenated, `${MARK} wex column`]],
	});
	// A third spelling, so the cluster plans as two steps that BOTH write the first memory.
	await createMemory(sidecar, vocabulary, {
		title: `${MARK} the third spelling`,
		names: [`the ${MARK} thav lattice`, `${MARK} radu gate`],
		facts: [[`the ${MARK} thav lattice`, `${MARK} radu gate`]],
	});
	await createMemory(sidecar, vocabulary, {
		title: `${MARK} the third spelling again`,
		names: [`the ${MARK} thav lattice`, `${MARK} pex ridge`],
		facts: [[`the ${MARK} thav lattice`, `${MARK} pex ridge`]],
	});

	const records = await listing(sidecar);
	const planted = clustersOf(records).clusters.filter((cluster) =>
		cluster.spellings.every((entry) => entry.surface.includes(MARK)),
	);
	assert.equal(planted.length, 1, 'the planted spellings were not proposed as one cluster');

	const batch = planClusterBatch(records, planted);
	assert.equal(batch.counts.steps, 2);
	assert.ok(batch.crossed.length > 0, 'no memory is written by both steps, so this test proves nothing');

	const summary = await runBatch(sidecar, batch, { reread: false });

	assert.equal(summary.complete, false, 'a batch run with stale versions completed, so the re-read guards nothing');
	// And the boundary is readable: the first rename finished, the second stopped, and the report
	// says which memories inside it were never reached.
	assert.equal(summary.done.length, 1, 'the first rename did not finish');
	assert.ok(summary.stopped_on, 'the report does not name where the batch stopped');
	assert.ok(
		summary.stopped_on.run.stopped_on,
		'the stopped rename does not name the memory it stopped on',
	);
});
