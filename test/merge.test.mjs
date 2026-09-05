// Milestone 6: merge, and the transaction that is not underneath it.
//
// **The engine has no working merge.** Its address-maintenance operation reports that it applied,
// with a committed effect and conserved mass, and leaves both memories exactly as they were —
// present, readable through every other door, and served. A "Merge" button wired to it ships green:
// it passes its own tests, returns success, and changes nothing the user can see. So this app does
// not route it, in any mode, and the first test in this file asserts that the name does not appear
// anywhere in the shipped source.
//
// Everything a user calls a merge here is composed out of the two writes whose effects this app has
// observed: `remember` update and `remember` delete. That means this app owns the ordering, the
// intermediate states and the recovery, and every property below is one of those.
//
// Seven things this file checks, each because getting it wrong is invisible from a screen:
//
//   * a PREVIEW names exactly the memories that will change — not a count, and not a superset;
//   * a rename rewrites ALL of them, facts and declarations together, verified through the door
//     that carries the declarations rather than through the response that reported success;
//   * a STALE VERSION stops the run and the report draws the boundary: what landed, what refused
//     and in the engine's own words why, and what was never attempted;
//   * a RESUME finishes the run without rewriting anything that already landed — asserted on the
//     version ids, which is the only instrument that can tell a no-op from a fresh write;
//   * a SNAPSHOT precedes every write, and the proof is ORDER rather than existence: the copy holds
//     the old spelling, which is only possible if it was taken beforehand;
//   * the SURVIVOR IS WRITTEN BEFORE THE DUPLICATE IS REMOVED, and a refused first write leaves two
//     memories rather than none;
//   * the EXPOSURE COUNT does not move. There are zero callers of the ranked door in this
//     repository and this milestone does not add the first one.
//
// Everything that writes runs against a clone, through the same helpers every other file uses.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequestRaw } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { composeBody, splitLeadingHeading } from '../src/app/editor-model.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { childFieldNames } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';
import { CONTINUES } from '../src/server/merge.mjs';
import { factIdentity, mentionsSurface, renameInDelta, undeclaredEndpoints } from '../src/shared/rename.mjs';
import * as merge from '../src/app/merge-model.mjs';
import { countExposureRecords, openScratchVault } from './helpers/vault.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A curation write folds a graph. It is not a read, and its timeout is not a read's. */
const WRITE_TIMEOUT_MS = 120_000;

/** Everything this file writes into a vault carries it, so a stray fixture is recognisable. */
const MARK = 'ui-merge-fixture';

// =============================================================================================
// PART 1 — the arithmetic, with no engine and no disk under it
// =============================================================================================

test('the operation that reports a merge and moves nothing is not named in the shipped source', () => {
	// R1, and it is checked as a STRING rather than as a route table, because a route is not the
	// only way to reach an operation — a helper, a constant or a passthrough would do it too. The
	// name appearing anywhere under src/ is the thing to catch, and it appears nowhere.
	//
	// This test is also the reason the comments in this repository describe that operation without
	// spelling it: a check that had to allow the name in prose could not assert its absence.
	const files = [
		'src/server/merge.mjs',
		'src/server/index.mjs',
		'src/server/write.mjs',
		'src/server/removal.mjs',
		'src/engine/memory.mjs',
		'src/engine/call.mjs',
		'src/app/api.mjs',
		'src/app/merge-model.mjs',
		'src/app/MergeFlow.jsx',
	];
	for (const file of files) {
		const source = readFileSync(join(ROOT, file), 'utf8');
		assert.ok(
			!source.includes('address_' + 'maintenance'),
			`${file} names the operation whose merge reports success and changes nothing`,
		);
	}
});

test('the rewrite moves the facts and the declaration in ONE payload, or not at all', () => {
	// The hazard this whole milestone is shaped by. A write that moves the facts and forgets the
	// declaration COMMITS, with every fact naming the surface dropped from the stored record and
	// nothing in the response saying so. A rename is a loop, so one such bug does that across N
	// memories and reports N successes.
	const delta = {
		title: 'a memory',
		entities: [
			{ n: 'old spelling', kind: 'tool', is: 'old spelling | tool | a thing' },
			{ n: 'other', kind: 'tool', is: 'other | tool | another thing' },
		],
		facts: [
			{ subject: 'old spelling', predicate: 'uses', object: 'other' },
			{ subject: 'other', predicate: 'uses', object: 'old spelling' },
		],
	};

	const out = renameInDelta(delta, { from: 'old spelling', to: 'new spelling' });

	assert.equal(out.delta.entities[0].n, 'new spelling', 'the declaration was not rewritten');
	assert.equal(out.delta.facts[0].subject, 'new spelling');
	assert.equal(out.delta.facts[1].object, 'new spelling');
	assert.equal(mentionsSurface(out.delta, 'old spelling'), false, 'the old spelling survived the rewrite');

	// And the post-condition that would have caught the half-rewrite: every endpoint still declared.
	assert.deepEqual(undeclaredEndpoints(out.delta), { declares: 2, undeclared: [] });

	// The check has to be capable of failing, or it reads as enforced and is not. A hand-built
	// half-rewrite — facts moved, declaration left behind — is exactly the payload that commits and
	// drops facts, and the endpoint check is what sees it.
	const halfDone = {
		entities: [{ n: 'old spelling', kind: 'tool', is: 'x' }],
		facts: [{ subject: 'new spelling', predicate: 'uses', object: 'other' }],
	};
	assert.deepEqual(undeclaredEndpoints(halfDone).undeclared, ['new spelling', 'other']);
});

test('the endpoint check does not run when a memory declares nothing', () => {
	// Two regimes, and the regime is decided by a count. A memory declaring nothing has every
	// endpoint resolved another way and commits all of its facts; running the check on it would
	// refuse, in the client, a write the engine accepts.
	const declaresNothing = { facts: [{ subject: 'a', predicate: 'uses', object: 'b' }] };
	assert.deepEqual(undeclaredEndpoints(declaresNothing), { declares: 0, undeclared: [] });
});

test('a rewrite that makes two facts identical says which fact disappears', () => {
	// The one place a rename removes a claim. It is named in the preview rather than discovered
	// afterwards in a count that went down.
	const out = renameInDelta(
		{
			facts: [
				{ subject: 'a', predicate: 'uses', object: 'x' },
				{ subject: 'a-alias', predicate: 'uses', object: 'x' },
			],
		},
		{ from: 'a-alias', to: 'a' },
	);
	assert.equal(out.delta.facts.length, 1);
	assert.equal(out.collapsed_facts.length, 1);
	assert.equal(out.collapsed_facts[0].statement, 'a uses x');

	// And two facts that differ only in a QUALIFIER are not one fact. Collapsing on the triple alone
	// would delete a claim the user never asked to delete.
	const kept = renameInDelta(
		{
			facts: [
				{ subject: 'a', predicate: 'uses', object: 'x', mode: 'fact' },
				{ subject: 'a-alias', predicate: 'uses', object: 'x', mode: 'decision' },
			],
		},
		{ from: 'a-alias', to: 'a' },
	);
	assert.equal(kept.delta.facts.length, 2, 'two claims with different qualifiers were collapsed into one');
	assert.notEqual(
		factIdentity({ subject: 'a', predicate: 'uses', object: 'x', mode: 'fact' }),
		factIdentity({ subject: 'a', predicate: 'uses', object: 'x', mode: 'decision' }),
	);
});

test('the rewrite leaves prose alone and reports where it did', () => {
	// A gloss is a sentence a person wrote, and a qualifier value may be a literal rather than a
	// mention. Rewriting either is authoring, and authoring is not something a loop does to N
	// memories — so those are reported and left.
	const out = renameInDelta(
		{
			title: 'about old spelling',
			entities: [{ n: 'old spelling', kind: 'tool', is: 'old spelling | tool | the thing' }],
			facts: [{ subject: 'old spelling', predicate: 'uses', object: 'x', about: { source: 'old spelling docs' } }],
		},
		{ from: 'old spelling', to: 'new spelling' },
	);
	const where = out.untouched.map((mention) => mention.where);
	assert.deepEqual(where, ['title', 'entities[0].is', 'facts[0].about.source']);
	assert.equal(out.delta.entities[0].is, 'old spelling | tool | the thing', 'the gloss was rewritten');
});

test('a preview names the memories, and it names exactly the ones that will change', () => {
	// R3, over a fixture, so the property is checked without an engine as well as with one.
	const records = [
		{ memory_id: 'one', version_id: 'v1', semantic: { title: 'B', facts: [{ subject: 'old', predicate: 'uses', object: 'x' }] } },
		{ memory_id: 'two', version_id: 'v2', semantic: { title: 'A', facts: [{ subject: 'y', predicate: 'uses', object: 'old' }] } },
		{ memory_id: 'three', version_id: 'v3', semantic: { title: 'C', facts: [{ subject: 'y', predicate: 'uses', object: 'z' }] } },
	];
	const plan = merge.planRename(records, { from: 'old', to: 'new' });

	assert.deepEqual(
		plan.memories.map((memory) => memory.memory_id),
		['two', 'one'],
		'the plan is not the memories that change, in write order',
	);
	assert.equal(plan.counts.memories, 2);
	assert.equal(plan.counts.facts, 2);
	// The order is TOTAL and it is by title, so the same vault previews the same way twice whatever
	// order the export arrived in. "The run stopped after the third one" means nothing otherwise.
	assert.deepEqual(plan.memories.map((memory) => memory.title), ['A', 'B']);

	// Every row carries the version the preview was built from — which is what the run uses to
	// refuse a memory written to between the preview and the confirm.
	assert.deepEqual(plan.memories.map((memory) => memory.seen_version_id), ['v2', 'v1']);

	// And the request posted is built FROM the plan the user looked at, rather than recomputed.
	assert.deepEqual(merge.renameRequest(plan), {
		from: 'old',
		to: 'new',
		items: [
			{ memory_id: 'two', seen_version_id: 'v2' },
			{ memory_id: 'one', seen_version_id: 'v1' },
		],
	});
});

test('the preview cannot write, structurally', () => {
	// R2 as a property of the module graph rather than of a click. The preview is arithmetic over a
	// payload already in the browser; if it could reach the HTTP client, some future edit would
	// eventually make an "open the preview" gesture issue a call. It imports one thing.
	const source = readFileSync(join(ROOT, 'src/app/merge-model.mjs'), 'utf8');
	const imports = [...source.matchAll(/^import .*? from '(.+?)';$/gm)].map((match) => match[1]);
	assert.deepEqual(imports, ['../shared/rename.mjs']);
});

test('every state that stops a run is a state the copy calls a stop', () => {
	// A report that argues with itself is worse than a terse one: a state the run stopped on,
	// described in the copy as harmless, teaches the user to ignore the next one.
	for (const [state, described] of Object.entries(merge.RENAME_STATES)) {
		if (state === 'not_attempted') continue;
		assert.equal(
			described.continues,
			CONTINUES.includes(state),
			`the copy and the run disagree about whether "${state}" lets the run keep going`,
		);
	}
});

test('reversibility is stated per action, and no two rows say the same thing', () => {
	// R12. A single "this cannot be undone" repeated everywhere is dismissed everywhere, and then
	// the one dialog that needed reading is not read.
	const sentences = merge.REVERSIBILITY.map((row) => row.confirmation);
	assert.equal(new Set(sentences).size, sentences.length, 'two actions share a confirmation sentence');
	for (const row of merge.REVERSIBILITY) {
		assert.equal(row.reversible, false, `${row.id} claims the engine can undo it`);
		assert.ok(row.recovers.length > 0, `${row.id} names nothing that recovers it`);
	}
	// The row for the rollback the engine DOES publish is deliberately absent from the table and
	// present in the sentence under it: it reverses an operation whose effect was never observed.
	assert.match(merge.ROLLBACK_IS_NOT_OFFERED, /rollback/i);
	assert.ok(!merge.REVERSIBILITY.some((row) => /rollback/i.test(row.operation)));
});

test('no affordance implies a rank the store does not have', () => {
	// R13. There is no priority field, no importance and no pin, and a control labelled with one
	// would have the user arranging their vault around a lever connected to nothing.
	const hits = [];
	const walk = (value, path) => {
		if (typeof value === 'string') {
			for (const word of merge.rankWordsIn(value)) hits.push(`${path}: “${word}”`);
		} else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
		else if (value && typeof value === 'object') {
			for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
		}
	};
	for (const [name, value] of Object.entries(merge)) {
		if (name === 'RANK_WORDS' || name === 'RANK_ALLOWED') continue;
		if (typeof value === 'function') continue;
		walk(value, name);
	}
	assert.deepEqual(hits, [], `a curation string implies a ranking the store does not have:\n${hits.join('\n')}`);

	// THE ALLOWLIST IS DERIVED, and that is the property that keeps it from becoming a way to
	// smuggle the promise back in. Every exemption is a row of the menu marked as not real — which
	// the screen renders struck through, with its denial directly beneath — plus the sentence that
	// denies the whole class. Adding an exemption by hand is impossible; adding one means adding a
	// row the user is shown as absent.
	const absent = merge.PROMOTE_INTENTS.filter((intent) => !intent.real);
	assert.deepEqual(
		[...merge.RANK_ALLOWED],
		[merge.NO_RANKING_FIELD, ...absent.flatMap((intent) => [intent.label, intent.what])],
		'the allowlist holds a line that is not a denial and not a row shown as absent',
	);
	// And every one of those rows actually denies, in its own words, rather than merely existing.
	for (const intent of absent) {
		assert.match(intent.what, /no |not |cannot|does not/i, `${intent.id} names no denial: ${intent.what}`);
	}

	// And the check has to be capable of failing.
	assert.deepEqual(merge.rankWordsIn('Pin this memory to the top'), ['pin']);
	assert.deepEqual(merge.rankWordsIn('Raise its priority'), ['priority']);
	assert.deepEqual(merge.rankWordsIn(merge.NO_RANKING_FIELD), []);
});

test('“Promote” is never a control, and the two things it cannot mean are still on the screen', () => {
	// R14. The word maps to no field, so it is a menu of named intents over one call — and a user
	// who came looking for "pin this" is told it does not exist at the moment they look for it,
	// rather than meeting a menu that silently lacks the row.
	const sources = ['src/app/MergeFlow.jsx', 'src/app/MemoryDetail.jsx'];
	for (const file of sources) {
		const rendered = readFileSync(join(ROOT, file), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.split('\n')
			.filter((line) => !line.trim().startsWith('//'))
			.join('\n');
		assert.ok(!/>\s*Promote\s*</.test(rendered), `${file} renders the bare word Promote as a control`);
	}
	for (const intent of merge.PROMOTE_INTENTS) {
		if (intent.real) assert.ok(intent.field, `${intent.id} claims to be real and names no field`);
		else assert.equal(intent.field, null, `${intent.id} is not real and names a field anyway`);
	}
	assert.ok(merge.PROMOTE_INTENTS.some((intent) => !intent.real), 'nothing is named as impossible');
});

test('composing two memories unions the declarations WITH the facts', () => {
	// The most likely way to lose data in this product. Fold in the other memory's facts and forget
	// its declarations and the write commits with those facts absent from the stored record.
	const plan = merge.planMemoryMerge(
		{
			memory_id: 'survivor',
			content_md: '# S\n\nleft.\n',
			semantic_delta: {
				title: 'S',
				entities: [{ n: 'a', kind: 'tool', is: 'a | tool | one' }],
				facts: [{ subject: 'a', predicate: 'uses', object: 'a' }],
			},
		},
		{
			memory_id: 'duplicate',
			content_md: '# D\n\nright.\n',
			semantic_delta: {
				title: 'D',
				entities: [{ n: 'b', kind: 'tool', is: 'b | tool | two' }],
				facts: [{ subject: 'b', predicate: 'uses', object: 'b' }],
			},
		},
	);

	assert.deepEqual(plan.semantic_delta.entities.map((entity) => entity.n), ['a', 'b']);
	assert.equal(plan.semantic_delta.facts.length, 2);
	// The composed payload passes the check that the write would otherwise fail silently.
	assert.deepEqual(plan.endpoints, { declares: 2, undeclared: [] });
	// The composed body carries both, and only one leading heading — a second would refuse on a
	// rule about the document's first line.
	assert.equal((plan.content_md.match(/^# /gm) ?? []).length, 1);

	// The two writes, in the order they must happen, on the plan rather than only in the code.
	assert.deepEqual(merge.MERGE_STEPS.map((step) => step.step), ['update-survivor', 'remove-duplicate']);
});

test('a memory that declared nothing gaining its first declaration is a decision, not a side effect', () => {
	// R9. The regime changes for every fact in it: today they are all stored, and afterwards a fact
	// naming anything undeclared is dropped with the write still reporting success.
	const plan = merge.planMemoryMerge(
		{ memory_id: 's', semantic_delta: { facts: [{ subject: 'a', predicate: 'uses', object: 'b' }] } },
		{
			memory_id: 'd',
			semantic_delta: {
				entities: [{ n: 'c', kind: 'tool', is: 'c | tool | three' }],
				facts: [{ subject: 'c', predicate: 'uses', object: 'c' }],
			},
		},
	);
	assert.ok(plan.declaration_regime_change, 'the regime change was not raised');
	// And it is REAL: the composed memory now declares one name and writes facts about two others.
	assert.deepEqual(plan.endpoints.undeclared, ['a', 'b']);
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

	const holder = mkdtempSync(join(tmpdir(), 'ui-merge-state-'));
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
	return { engine, scratch, sidecar, where: { enginePath: engine.path, root: scratch.root } };
}

/**
 * Vocabulary read from the engine a moment ago. NOTHING IS TRANSCRIBED: memory types, entity kinds
 * and relation names are open registries, and a value written into a test drifts from the engine
 * exactly as quietly as one written into a dropdown.
 */
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

/** One memory naming two surfaces, both declared, so a rename has a declaration to move as well. */
async function createMemory(sidecar, vocabulary, { title, subject, object, prose = 'A memory this test created.' }) {
	const created = json(
		await authorised(sidecar, {
			method: 'POST',
			path: '/api/memories',
			body: {
				content_md: `# ${title}\n\n${prose}\n`,
				semantic_delta: {
					title,
					memory_type: vocabulary.memoryType,
					entities: [
						{ n: subject, kind: vocabulary.kind, is: `${subject} | ${vocabulary.kind} | invented by a test` },
						{ n: object, kind: vocabulary.kind, is: `${object} | ${vocabulary.kind} | invented by a test` },
					],
					facts: [{ subject, predicate: vocabulary.predicate, object }],
				},
			},
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'POST /api/memories',
	);
	assert.equal(created.outcome, 'applied', `the create did not apply: ${JSON.stringify(created).slice(0, 400)}`);
	return { memory_id: created.data.memory_id, version_id: created.data.version_id, title };
}

const editRecord = async (sidecar, memoryId) =>
	json(
		await authorised(sidecar, { path: `/api/memories/${encodeURIComponent(memoryId)}/edit` }),
		`GET /api/memories/${memoryId}/edit`,
	);

const listing = async (sidecar) =>
	json(await authorised(sidecar, { path: '/api/memories?refresh=1' }), 'GET /api/memories');

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

test('a rename previews exactly what it will write, writes all of it, and keeps a copy first', async (t) => {
	const { sidecar, scratch } = await openSidecar(t, 'merge-rename');

	// The instrument, checked before it is believed. A census that found nowhere to look reports
	// zero records, and zero compared against zero passes hardest when it is broken.
	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(beforeExposure.stores > 0, 'no search-exposure store was found in the clone');

	const vocabulary = await vocabularyOf(sidecar);
	const losing = `${MARK} the old spelling`;
	const surviving = `${MARK} the new spelling`;
	const other = `${MARK} something else`;

	const written = [];
	for (const index of [1, 2, 3]) {
		written.push(
			await createMemory(sidecar, vocabulary, {
				title: `${MARK} memory ${index}`,
				subject: losing,
				object: `${other} ${index}`,
			}),
		);
	}
	// A memory that does NOT use the losing spelling, so the preview has something to leave out. A
	// preview asserted only against memories that all match cannot fail on a superset.
	const untouched = await createMemory(sidecar, vocabulary, {
		title: `${MARK} memory that is not about it`,
		subject: surviving,
		object: `${other} 4`,
	});

	const records = (await listing(sidecar)).memories;
	const plan = merge.planRename(records, { from: losing, to: surviving });

	await t.test('the preview names exactly the memories that will change', () => {
		assert.deepEqual(
			plan.memories.map((memory) => memory.memory_id).sort(),
			written.map((memory) => memory.memory_id).sort(),
			'the preview is not the set of memories that use the old spelling',
		);
		assert.ok(
			!plan.memories.some((memory) => memory.memory_id === untouched.memory_id),
			'the preview includes a memory that does not use the old spelling',
		);
		// Named, not counted. Every row carries the title a person would recognise it by.
		for (const memory of plan.memories) assert.ok(memory.title, 'a preview row names no memory');
		// And it says what each fact becomes, rather than that a fact changes.
		assert.equal(plan.counts.facts, plan.memories.length * 2, 'the fact and the declaration are not both counted');
		for (const memory of plan.memories) {
			assert.ok(memory.statements.length > 0);
			assert.match(memory.statements[0].before, new RegExp(losing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
			assert.match(memory.statements[0].after, new RegExp(surviving.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		}
	});

	const report = await rename(sidecar, merge.renameRequest(plan));

	await t.test('the run rewrote all of them, checked through the door that carries declarations', async () => {
		assert.equal(report.outcome, 'ran');
		assert.equal(report.stopped, false, `the run stopped: ${JSON.stringify(report.items).slice(0, 600)}`);
		assert.equal(report.rewritten, written.length);

		for (const memory of written) {
			// NOT the response, and not the display door: the lineage door is the only one that
			// carries the declarations, and a rename that dropped them would be invisible anywhere
			// else. This is the assertion the whole milestone turns on.
			const record = await editRecord(sidecar, memory.memory_id);
			assert.equal(
				mentionsSurface(record.semantic_delta, losing),
				false,
				`${memory.memory_id} still names the old spelling`,
			);
			assert.equal(
				mentionsSurface(record.semantic_delta, surviving),
				true,
				`${memory.memory_id} does not name the new spelling`,
			);
			// The declaration count did not fall. A write that moved the facts and dropped the
			// declarations would still satisfy the two assertions above.
			assert.equal(record.entity_count, 2, `${memory.memory_id} lost a declaration in the rewrite`);
			assert.equal(record.fact_count, 1, `${memory.memory_id} lost a fact in the rewrite`);
			assert.deepEqual(undeclaredEndpoints(record.semantic_delta).undeclared, []);
		}
	});

	await t.test('a snapshot precedes every write, and the copy proves the ORDER', async () => {
		// R18, and existence is not the property — order is. A copy that holds the OLD spelling can
		// only have been taken before the write that removed it, so this is proof rather than a
		// receipt that a copy exists somewhere.
		assert.equal(report.snapshots.length, report.rewritten, 'a write happened without a copy beside it');

		for (const item of report.items.filter((row) => row.state === 'rewritten')) {
			assert.ok(item.snapshot, `${item.memory_id} was rewritten with no copy`);
			assert.equal(item.snapshot.memory_id, item.memory_id);
			assert.equal(
				item.snapshot.version_id,
				item.observed.replaced_version_id,
				'the copy names a version other than the one the write replaced',
			);
			assert.ok(item.snapshot.payload_bytes > 0, 'the copy captured no bytes');
			assert.equal(item.snapshot.restorable, false, 'a receipt that calls itself restorable');

			const stored = json(
				await authorised(sidecar, { path: item.snapshot.href }),
				`GET ${item.snapshot.href}`,
			);
			assert.equal(stored.restore_available, false);
			assert.ok(
				stored.snapshot.export_json.includes(losing),
				'the copy does not hold the old spelling, so it was not taken before the write',
			);
			assert.ok(
				!stored.snapshot.export_json.includes(surviving),
				'the copy already holds the new spelling, so it was taken after the write',
			);
		}
	});

	await t.test('re-running the same rename writes nothing at all', async () => {
		// The idempotence that makes a resume safe, asserted on its own. A memory that already
		// carries the surviving spelling is reported and NOT written — without this, a user who
		// pressed the button twice would mint a fresh version of every memory in the run.
		const versions = new Map();
		for (const memory of written) versions.set(memory.memory_id, (await editRecord(sidecar, memory.memory_id)).expected_version_id);

		const again = await rename(sidecar, {
			from: losing,
			to: surviving,
			items: written.map((memory) => ({ memory_id: memory.memory_id })),
		});
		assert.equal(again.rewritten, 0);
		assert.deepEqual([...new Set(again.items.map((item) => item.state))], ['already_named']);
		for (const memory of written) {
			assert.equal(
				(await editRecord(sidecar, memory.memory_id)).expected_version_id,
				versions.get(memory.memory_id),
				`${memory.memory_id} was written again by a run that had nothing to do`,
			);
		}
	});

	await t.test('the whole run recorded no ranked search', () => {
		const after = countExposureRecords(scratch.root);
		assert.equal(after.stores, beforeExposure.stores);
		assert.equal(
			after.records,
			beforeExposure.records,
			'a curation run wrote an exposure record, which means something in it ran a ranked query',
		);
	});
});

test('a stale version stops the run, reports the boundary, and resumes without redoing', async (t) => {
	const { sidecar, scratch, where } = await openSidecar(t, 'merge-stale');

	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(beforeExposure.stores > 0, 'no search-exposure store was found in the clone');

	const vocabulary = await vocabularyOf(sidecar);
	const losing = `${MARK} contended spelling`;
	const surviving = `${MARK} settled spelling`;

	// Three memories, and the preview's order is by title, so the letters fix which one is second.
	const first = await createMemory(sidecar, vocabulary, { title: `${MARK} A first`, subject: losing, object: `${MARK} x1` });
	const second = await createMemory(sidecar, vocabulary, { title: `${MARK} B second`, subject: losing, object: `${MARK} x2` });
	const third = await createMemory(sidecar, vocabulary, { title: `${MARK} C third`, subject: losing, object: `${MARK} x3` });

	const plan = merge.planRename((await listing(sidecar)).memories, { from: losing, to: surviving });
	const request = merge.renameRequest(plan);
	assert.deepEqual(
		request.items.map((item) => item.memory_id),
		[first.memory_id, second.memory_id, third.memory_id],
		'the write order is not what this test assumes',
	);

	// ---- an agent writes to the second memory while the user is deciding -----------------------
	//
	// Through the ENGINE, not through this app, because that is what actually happens: the vault is
	// under concurrent writes and this app is one of several things holding it.
	const middle = await editRecord(sidecar, second.memory_id);
	const moved = json(
		await authorised(sidecar, {
			method: 'POST',
			path: `/api/memories/${encodeURIComponent(second.memory_id)}`,
			body: {
				expected_version_id: middle.expected_version_id,
				content_md: `${middle.content_md.trimEnd()}\n\nAn agent added this line while the user was deciding.\n`,
				semantic_delta: middle.semantic_delta,
			},
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
		'the out-of-band write',
	);
	assert.equal(moved.outcome, 'applied', 'the out-of-band write did not land, so nothing is stale');

	const report = await rename(sidecar, request);

	await t.test('the run stopped, and the report draws the boundary', async () => {
		assert.equal(report.stopped, true, 'the run did not stop on a memory that had moved');
		assert.equal(report.rewritten, 1);

		const states = report.items.map((item) => item.state);
		assert.deepEqual(states, ['rewritten', 'changed', 'not_attempted'], `states were ${states.join(', ')}`);

		// NAMED, not counted. The third row exists and says it was never attempted; a report that
		// dropped it would leave the user unable to see where the run stopped.
		assert.equal(report.items[2].memory_id, third.memory_id);

		// The engine's own sentence travels with the refusal. A paraphrase loses the repair.
		assert.ok(report.items[1].message, 'the refusal carries no sentence');

		// And the memory below the refusal was not touched.
		const untouched = await editRecord(sidecar, third.memory_id);
		assert.equal(mentionsSurface(untouched.semantic_delta, losing), true, 'a memory below the stop was written');

		const summary = merge.summariseRenameRun(report);
		assert.equal(summary.complete, false);
		assert.equal(summary.rewritten.length, 1);
		assert.equal(summary.not_attempted.length, 1);
		assert.equal(summary.stopped_on.memory_id, second.memory_id);
		assert.equal(summary.stopped_on.tone, 'stop');
	});

	await t.test('the resume names only what is left', () => {
		assert.ok(report.resume, 'a stopped run offered no way to finish');
		assert.deepEqual(
			report.resume.items.map((item) => item.memory_id),
			[second.memory_id, third.memory_id],
			'the resume redoes work that already landed, or forgets work that did not',
		);
		// The stale version is NOT carried forward. The memory has moved — that is why the run
		// stopped — and re-sending the version the user first saw would refuse for the same reason
		// twice.
		assert.deepEqual([...new Set(report.resume.items.map((item) => item.seen_version_id))], [null]);
	});

	await t.test('resuming completes the run without rewriting what already landed', async () => {
		const alreadyDone = (await editRecord(sidecar, first.memory_id)).expected_version_id;

		// The conflict is resolved by looking at the memory again — which is what the screen asks the
		// user to do — and the resume then carries the whole remainder.
		const finished = await rename(sidecar, report.resume);

		assert.equal(finished.stopped, false, `the resume stopped too: ${JSON.stringify(finished.items).slice(0, 500)}`);
		assert.equal(finished.rewritten, 2);
		assert.equal(finished.resume, null);

		for (const memory of [first, second, third]) {
			const record = await editRecord(sidecar, memory.memory_id);
			assert.equal(mentionsSurface(record.semantic_delta, losing), false, `${memory.title} still names the old spelling`);
			assert.equal(record.entity_count, 2, `${memory.title} lost a declaration`);
		}

		// THE PROPERTY THIS TEST IS FOR. The memory that landed in the first run was not written
		// again — asserted on its version id, which is the only instrument that can tell a no-op
		// from a fresh write of identical content.
		assert.equal(
			(await editRecord(sidecar, first.memory_id)).expected_version_id,
			alreadyDone,
			'the resume rewrote a memory the first run had already finished',
		);

		// The out-of-band edit survived the rename. A run that recovered by re-sending what the
		// preview held would have overwritten it.
		const recovered = await editRecord(sidecar, second.memory_id);
		assert.match(recovered.content_md, /An agent added this line/);
	});

	await t.test('the stopped run and its resume recorded no ranked search', () => {
		const after = countExposureRecords(scratch.root);
		assert.equal(after.records, beforeExposure.records);
	});

	void where;
});

test('a merge writes the survivor first, and a refused first write leaves two memories', async (t) => {
	const { sidecar, scratch } = await openSidecar(t, 'merge-order');

	const beforeExposure = countExposureRecords(scratch.root);
	assert.ok(beforeExposure.stores > 0, 'no search-exposure store was found in the clone');

	const vocabulary = await vocabularyOf(sidecar);
	const survivor = await createMemory(sidecar, vocabulary, {
		title: `${MARK} the memory that survives`,
		subject: `${MARK} left`,
		object: `${MARK} shared`,
	});
	const duplicate = await createMemory(sidecar, vocabulary, {
		title: `${MARK} the memory that is removed`,
		subject: `${MARK} right`,
		object: `${MARK} shared`,
	});

	const [survivorRecord, duplicateRecord] = await Promise.all([
		editRecord(sidecar, survivor.memory_id),
		editRecord(sidecar, duplicate.memory_id),
	]);
	const composed = merge.planMemoryMerge(survivorRecord, duplicateRecord);

	await t.test('a refused survivor write removes nothing', async () => {
		// The failure this ordering exists for, forced deterministically: a composition the engine
		// refuses outright. Delete-first would have removed the duplicate by now and the content
		// would be gone, with no operation that returns it.
		const refused = json(
			await authorised(sidecar, {
				method: 'POST',
				path: '/api/merges',
				body: {
					survivor: {
						memory_id: survivor.memory_id,
						seen_version_id: survivorRecord.expected_version_id,
						content_md: composed.content_md,
						// A memory must carry at least one fact. This one carries none, so the write is
						// refused before anything is stored.
						semantic_delta: { ...composed.semantic_delta, facts: [] },
					},
					duplicate: { memory_id: duplicate.memory_id, seen_version_id: duplicateRecord.expected_version_id },
				},
				timeoutMs: WRITE_TIMEOUT_MS,
			}),
			'POST /api/merges (refused)',
		);

		assert.equal(refused.complete, false);
		assert.equal(refused.both_memories_intact, true);
		assert.equal(refused.steps.length, 1, 'the removal was attempted after a failed survivor write');
		assert.equal(refused.steps[0].step, 'update-survivor');

		// Both still readable, through the door that carries the declarations.
		for (const memory of [survivor, duplicate]) {
			const record = await editRecord(sidecar, memory.memory_id);
			assert.equal(record.fact_count, 1, `${memory.title} was changed by a merge that was refused`);
		}

		// And no half-finished record was left behind, because nothing is half-finished.
		assert.equal(await sidecar.pending_merges.read(), null, 'a refused merge left a half-finished record');
	});

	let report;
	await t.test('the survivor is written before the duplicate is removed', async () => {
		report = json(
			await authorised(sidecar, {
				method: 'POST',
				path: '/api/merges',
				body: {
					survivor: {
						memory_id: survivor.memory_id,
						content_md: composed.content_md,
						semantic_delta: composed.semantic_delta,
					},
					duplicate: { memory_id: duplicate.memory_id },
				},
				timeoutMs: WRITE_TIMEOUT_MS,
			}),
			'POST /api/merges',
		);

		assert.equal(report.complete, true, `the merge did not finish: ${JSON.stringify(report.steps).slice(0, 600)}`);
		assert.deepEqual(
			report.steps.map((step) => step.step),
			['update-survivor', 'remove-duplicate'],
			'the order in the report is not survivor-first',
		);
		assert.equal(report.steps[0].state, 'written');
		assert.equal(report.steps[1].state, 'removed');

		// The ORDER, observed rather than reported: the copy taken before the removal is newer than
		// the copy taken before the survivor's write. Snapshot ids carry the time they were minted.
		const [firstCopy, secondCopy] = report.snapshots;
		assert.ok(firstCopy && secondCopy, 'a write happened without a copy beside it');
		assert.equal(firstCopy.memory_id, survivor.memory_id);
		assert.equal(secondCopy.memory_id, duplicate.memory_id);
		assert.ok(
			Date.parse(secondCopy.taken_at) >= Date.parse(firstCopy.taken_at),
			'the duplicate was copied before the survivor was written',
		);

		// The survivor holds both memories' facts, and both memories' declarations.
		const after = await editRecord(sidecar, survivor.memory_id);
		assert.equal(after.fact_count, composed.semantic_delta.facts.length);
		assert.equal(after.entity_count, composed.semantic_delta.entities.length);
		assert.deepEqual(undeclaredEndpoints(after.semantic_delta).undeclared, []);

		// And the duplicate has left the listing.
		const ids = (await listing(sidecar)).memories.map((record) => record.memory_id);
		assert.ok(!ids.includes(duplicate.memory_id), 'the duplicate is still in the listing');
		assert.ok(ids.includes(survivor.memory_id), 'the survivor left the listing');

		// The record is cleared only after the second write returned a committed effect.
		assert.equal(await sidecar.pending_merges.read(), null, 'a finished merge left a half-finished record');
	});

	await t.test('a half-finished merge raises a banner with exactly two actions', async () => {
		// R5 and R6. The record is what makes the window between the two writes survivable across a
		// crash rather than only across an exception — so it is seeded here, as a crash would leave
		// it, and read back through the door the banner is built from.
		const stranded = await createMemory(sidecar, vocabulary, {
			title: `${MARK} the stranded duplicate`,
			subject: `${MARK} stranded`,
			object: `${MARK} shared`,
		});
		await sidecar.pending_merges.begin({
			survivor_id: survivor.memory_id,
			survivor_version: (await editRecord(sidecar, survivor.memory_id)).expected_version_id,
			survivor_payload_before: { content_md: survivorRecord.content_md, semantic_delta: survivorRecord.semantic_delta },
			survivor_payload_after: { content_md: composed.content_md, semantic_delta: composed.semantic_delta },
			duplicate_id: stranded.memory_id,
			duplicate_version: stranded.version_id,
			survivor_title: survivor.title,
			duplicate_title: stranded.title,
		});
		await sidecar.pending_merges.advance('survivor_written');

		const seen = json(await authorised(sidecar, { path: '/api/pending-merge' }), 'GET /api/pending-merge');
		assert.equal(seen.pending.state, 'survivor_written');
		assert.deepEqual(seen.actions, ['finish', 'undo'], 'the banner is offered something other than two actions');

		const finished = json(
			await authorised(sidecar, {
				method: 'POST',
				path: '/api/pending-merge',
				body: { action: 'finish' },
				timeoutMs: WRITE_TIMEOUT_MS,
			}),
			'POST /api/pending-merge',
		);
		assert.equal(finished.state, 'removed');
		assert.ok(finished.snapshot, 'the removal that finished the merge kept no copy');
		assert.equal(await sidecar.pending_merges.read(), null);

		const ids = (await listing(sidecar)).memories.map((record) => record.memory_id);
		assert.ok(!ids.includes(stranded.memory_id), 'finishing the merge did not remove the duplicate');
	});

	await t.test('the whole merge session recorded no ranked search', () => {
		const after = countExposureRecords(scratch.root);
		assert.equal(after.stores, beforeExposure.stores);
		assert.equal(after.records, beforeExposure.records, 'a merge wrote an exposure record');
	});
});

test('the composition keeps the heading out of the words pane and writes it back byte for byte', () => {
	// The composed body opens with the survivor's `# ` line and the screen draws that title as its
	// H1, so the pane holds everything after the heading — the same rule the editor keeps — and the
	// write puts the heading back exactly as it came. A composition nobody edited must not write a
	// version whose only change is one the user did not make.
	const plan = merge.planMemoryMerge(
		{
			memory_id: 'survivor',
			content_md: '# S\n\nleft.\n',
			semantic_delta: { title: 'S', entities: [], facts: [] },
		},
		{
			memory_id: 'duplicate',
			content_md: '# D\n\nright.\n',
			semantic_delta: { title: 'D', entities: [], facts: [] },
		},
	);
	const split = splitLeadingHeading(plan.content_md, plan.semantic_delta.title);
	assert.ok(split.heading, 'the composed body does not open with a heading to split off');
	assert.doesNotMatch(split.body, /^#/, 'the heading reached the words pane');
	assert.match(split.body, /^left\./, 'the words pane does not open with the survivor’s first paragraph');
	assert.equal(
		composeBody({ body: split.body, title: plan.semantic_delta.title, heading: split.heading }),
		plan.content_md,
		'putting the heading back did not reproduce the composed body byte for byte',
	);

	// And the screen goes through that composition. The words the pane holds are never sent raw,
	// because a body without its heading is one the engine refuses on its first line.
	const screen = readFileSync(join(ROOT, 'src', 'app', 'MergeFlow.jsx'), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
	assert.match(screen, /content_md: composeBody\(\{ body, title: survivorTitle, heading \}\)/);
	assert.doesNotMatch(screen, /content_md: body[,\s]/, 'the merge screen sends the pane’s words without their heading');
});
