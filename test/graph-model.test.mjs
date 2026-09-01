// The graph model, tested as arithmetic and nothing else.
//
// There is no door that returns the engine's own graph. The client rebuilds one from the export it
// has already fetched, by grouping facts on the surface string — which is sound, because entity
// identity in this system is exact surface match and that is a property a client can see. It is
// still a RECONSTRUCTION, and the whole design of this screen turns on two consequences of that:
//
//   * over-fragmenting is the safe direction. A drawn edge that does not exist invites a user to
//     merge two nodes, and the UI executes a merge as a rewrite across every memory that names
//     them, with no undo through any door. A missing edge costs a click. The asymmetry is total,
//     so the model draws nothing the export does not literally contain — no inferred edges, no
//     similarity edges, and no silent merging of surfaces that normalise to the same string;
//   * the near-miss detector is therefore a CANDIDATE GENERATOR into a list, never a transform on
//     the model. It is asserted here in both directions: it must find a planted pair, and running
//     it must leave the node set exactly as it was.
//
// The fixtures are built by hand, in this file, from invented surfaces. Nothing here is vault
// content and nothing here is a vocabulary read from the engine: a fixture kind is a made-up string
// because the assertions are about topology, and topology does not care what a kind is called.
//
// Everything under test is pure. No vault is opened, no process is spawned, and no clone is needed
// — which is itself the requirement (PRD 0005 R2): this screen issues no door call of its own, so
// driving every lens, filter and path query over it must be arithmetic over a payload already in
// the browser. A test that needed a vault to exercise the graph would be evidence that it is not.

import assert from 'node:assert/strict';
import test from 'node:test';

// ---------------------------------------------------------------------------------------------
// THE CONTRACT THIS FILE ASSERTS
// ---------------------------------------------------------------------------------------------
//
// One pure function builds one model from the exported records, and one pure function proposes
// near-miss pairs over it. The alternatives below exist so a reasonable spelling does not read as a
// missing feature; nothing else is guessed. If none of them is exported, this file fails naming
// every name it tried, because a graph screen with no model behind it must go red rather than quiet.
//
//   build(records)          → a model carrying, at minimum:
//                               • one ENTITY NODE per distinct surface appearing as a fact
//                                 subject or object — including surfaces no memory declares, and
//                                 including surfaces of degree 1, neither of which is ever filtered;
//                               • one CLAIM EDGE per fact, joining subject to object;
//                               • the connected components of that graph.
//   nearDuplicates(model)   → unordered pairs of surfaces that MIGHT be one thing. Candidates for a
//                             list. Never applied to the model.

const GRAPH_MODULES = [
	'../src/app/graph.mjs',
	'../src/app/graph-model.mjs',
	'../src/app/graphModel.mjs',
	'../src/app/graph/model.mjs',
	'../src/graph/model.mjs',
	'../src/graph/graph.mjs',
];

const BUILD_EXPORTS = ['buildGraph', 'buildGraphModel', 'graphModel', 'buildModel', 'toGraph', 'build'];
const COMPONENT_EXPORTS = ['connectedComponents', 'components', 'graphComponents', 'findComponents'];
const NEAR_DUPLICATE_EXPORTS = [
	'nearDuplicates',
	'nearDuplicateSurfaces',
	'nearMisses',
	'nearMissPairs',
	'nearMissSurfaces',
	'findNearDuplicates',
];

let cachedModule = null;

async function graphModule() {
	if (cachedModule) return cachedModule;

	const looked = [];
	for (const specifier of GRAPH_MODULES) {
		let module;
		try {
			module = await import(specifier);
		} catch (error) {
			// A module that exists and throws on import is a different problem from one that is not
			// there, and it must not be swallowed as "kept looking".
			if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
			looked.push(`  - ${specifier} (no such module)`);
			continue;
		}
		const build = BUILD_EXPORTS.find((name) => typeof module[name] === 'function');
		if (build) {
			cachedModule = { module, specifier, buildName: build };
			return cachedModule;
		}
		looked.push(
			`  - ${specifier} (found, exports none of: ${BUILD_EXPORTS.join(', ')}; it exports: ` +
				`${Object.keys(module).join(', ') || '(nothing)'})`,
		);
	}

	throw new Error(
		`No graph model to test. Looked for a module exporting one of ${BUILD_EXPORTS.join(', ')} in:\n` +
			`${looked.join('\n')}\n\n` +
			`This is not a skip. The rail is a list over the connected components of this model and it ` +
			`ships before the canvas does; every finding the screen can show is arithmetic over it. If ` +
			`the module lives somewhere else, add its specifier to GRAPH_MODULES rather than deleting ` +
			`the tests.`,
	);
}

/**
 * Build a model from a fixture.
 *
 * Two call shapes are tried because the builder may reasonably take the records or the whole
 * listing payload. Both are attempted and the one that yields entity nodes wins; if neither does,
 * this fails naming both, rather than reporting an empty graph as a passing one — an empty model
 * satisfies almost every assertion below vacuously.
 */
async function build(records) {
	const { module, specifier, buildName } = await graphModule();
	const attempts = [
		{ how: `${buildName}(records)`, input: records },
		{ how: `${buildName}({memories: records})`, input: { memories: records } },
	];

	const notes = [];
	for (const attempt of attempts) {
		let model;
		try {
			model = module[buildName](attempt.input);
		} catch (error) {
			notes.push(`  - ${attempt.how} threw ${error?.message ?? error}`);
			continue;
		}
		const nodes = readEntityNodes(model, { quiet: true });
		if (nodes !== null && nodes.size > 0) return { model, module, specifier, buildName };
		notes.push(`  - ${attempt.how} returned ${nodes === null ? 'no readable node list' : 'no nodes'}`);
	}

	assert.fail(
		`${specifier} → ${buildName}() produced no entity nodes from a fixture whose facts name ` +
			`several surfaces:\n${notes.join('\n')}\n\n` +
			`A node exists for every distinct surface appearing as a fact endpoint. The tempting ` +
			`filter — build the graph from the declared entity list — draws almost nothing on a vault ` +
			`where most endpoints are undeclared, and reports success while doing it.`,
	);
}

// ---------------------------------------------------------------------------------------------
// Reading a model without assuming how it spells itself
// ---------------------------------------------------------------------------------------------

const SURFACE_KEYS = ['surface', 'n', 'name', 'label'];

const surfaceOf = (node) => {
	if (typeof node === 'string') return node;
	const key = SURFACE_KEYS.find((candidate) => typeof node?.[candidate] === 'string');
	return key ? node[key] : null;
};

const isEntityNode = (node) => {
	if (typeof node === 'string') return true;
	const role = node?.role ?? node?.type ?? node?.kind ?? node?.element;
	// A model that mixes memory nodes and entity nodes in one list has to say which is which, or
	// nothing downstream can shape one differently from the other — shape carries role on this
	// screen precisely because it is a closed set of four values.
	if (typeof role === 'string' && /^(entity|surface|name)$/i.test(role)) return true;
	if (typeof role === 'string') return false;
	return surfaceOf(node) !== null;
};

/** Every entity surface the model holds a node for. */
function readEntityNodes(model, { quiet = false } = {}) {
	const lists = [model?.entities, model?.entityNodes, model?.surfaces, model?.nodes];
	for (const list of lists) {
		const items = list instanceof Map ? [...list.values()] : Array.isArray(list) ? list : null;
		if (items === null) continue;
		const surfaces = new Set();
		for (const item of items) {
			if (!isEntityNode(item)) continue;
			const surface = surfaceOf(item);
			if (surface !== null) surfaces.add(surface);
		}
		if (surfaces.size > 0 || items.length === 0) return surfaces;
	}
	if (quiet) return null;
	assert.fail(
		`The model publishes no readable list of entity nodes. Looked at: entities, entityNodes, ` +
			`surfaces, nodes — as an array or a Map, whose members are surface strings or objects ` +
			`carrying one of: ${SURFACE_KEYS.join(', ')}. The model has: ` +
			`${Object.keys(model ?? {}).join(', ') || '(nothing)'}.`,
	);
}

const EDGE_ENDPOINTS = [
	['subject', 'object'],
	['source', 'target'],
	['from', 'to'],
	['a', 'b'],
];

function edgeEndpoints(edge) {
	const carrier = edge?.data && typeof edge.data === 'object' ? edge.data : edge;
	for (const [left, right] of EDGE_ENDPOINTS) {
		if (typeof carrier?.[left] === 'string' && typeof carrier?.[right] === 'string') {
			return [carrier[left], carrier[right]];
		}
	}
	return null;
}

/**
 * The claim edges: one per fact, subject to object.
 *
 * A model may also carry incidence edges joining a memory to a surface. Those are filtered out here
 * by requiring BOTH endpoints to be entity surfaces, so the count assertion is about claims and not
 * about whichever edge list happened to be longest.
 */
function readClaimEdges(model, surfaces) {
	const lists = [model?.claims, model?.claimEdges, model?.factEdges, model?.edges];
	for (const list of lists) {
		const items = list instanceof Map ? [...list.values()] : Array.isArray(list) ? list : null;
		if (items === null) continue;
		const edges = [];
		for (const item of items) {
			const ends = edgeEndpoints(item);
			if (ends === null) continue;
			if (!surfaces.has(ends[0]) || !surfaces.has(ends[1])) continue;
			edges.push({ ends, edge: item });
		}
		if (edges.length > 0) return edges;
	}
	assert.fail(
		`The model publishes no readable list of claim edges — one per fact, joining subject to ` +
			`object. Looked at: claims, claimEdges, factEdges, edges, whose members carry a pair of ` +
			`endpoint strings under one of ${EDGE_ENDPOINTS.map((p) => p.join('/')).join(', ')}. The ` +
			`model has: ${Object.keys(model ?? {}).join(', ') || '(nothing)'}.`,
	);
}

/**
 * The connected components, as a partition of the entity surfaces.
 *
 * Read from the model where it publishes them and from a named export otherwise. Anything in a
 * component that is not an entity surface — a memory node, in a bipartite model — is dropped, so
 * the partition compared below is the same partition whichever lens the components were computed
 * over. That is deliberate: the fixture is built so both readings agree, and a test that could only
 * accept one of them would fail on a correct implementation of the other.
 */
async function readComponents(model, surfaces) {
	const { module, specifier } = await graphModule();

	let raw = model?.components ?? model?.connectedComponents ?? null;
	if (raw === null) {
		const name = COMPONENT_EXPORTS.find((candidate) => typeof module[candidate] === 'function');
		assert.ok(
			name !== undefined,
			`Neither the model nor ${specifier} publishes the connected components. The model has: ` +
				`${Object.keys(model ?? {}).join(', ') || '(nothing)'}; the module exports none of ` +
				`${COMPONENT_EXPORTS.join(', ')}. The curation rail is a virtualized list over the ` +
				`components and it is where the value of this screen is — it can and should ship ` +
				`before the canvas does.`,
		);
		raw = module[name](model);
	}

	const items = raw instanceof Map ? [...raw.values()] : raw;
	assert.ok(Array.isArray(items), `the components came back as ${typeof items}, not a list`);

	const partition = [];
	for (const component of items) {
		const members = Array.isArray(component)
			? component
			: (component?.nodes ?? component?.members ?? component?.surfaces ?? []);
		const inside = new Set();
		for (const member of members) {
			const surface = surfaceOf(member);
			if (surface !== null && surfaces.has(surface)) inside.add(surface);
		}
		if (inside.size > 0) partition.push(inside);
	}
	return partition;
}

/** A partition, rendered so two of them can be compared without caring about order. */
const renderPartition = (partition) =>
	partition
		.map((component) => [...component].sort().join(' + '))
		.sort()
		.join('\n  ');

/** Near-miss candidates, as unordered pairs. */
async function readNearDuplicates(model, surfaces) {
	const { module, specifier } = await graphModule();
	const name = NEAR_DUPLICATE_EXPORTS.find((candidate) => typeof module[candidate] === 'function');
	assert.ok(
		name !== undefined,
		`${specifier} exports none of ${NEAR_DUPLICATE_EXPORTS.join(', ')}. The near-miss card is ` +
			`the finding that justifies drawing a graph at all: it is the only surface in the product ` +
			`that can show a person that two spellings of one thing became two things.`,
	);

	const notes = [];
	for (const [how, input] of [
		[`${name}(model)`, model],
		[`${name}(surfaces)`, [...surfaces]],
	]) {
		let raw;
		try {
			raw = module[name](input);
		} catch (error) {
			notes.push(`  - ${how} threw ${error?.message ?? error}`);
			continue;
		}
		const items = raw instanceof Map ? [...raw.values()] : raw;
		if (!Array.isArray(items)) {
			notes.push(`  - ${how} returned ${typeof items}, not a list`);
			continue;
		}
		const pairs = new Set();
		for (const item of items) {
			// A GROUP is the general case and a pair is the degenerate one: three spellings of one
			// thing is a single row a person acts on once, not three. So a detector that nominates
			// groups is read here as every unordered pair inside each group, which is what the
			// assertions below are written against and what a two-spelling group reduces to exactly.
			for (const [left, right] of unorderedPairs(proposedSurfaces(item))) pairs.add(pair(left, right));
		}
		if (pairs.size > 0) return { pairs, how, name };

		notes.push(
			`  - ${how} returned ${items.length} item(s) carrying no readable pair of surfaces` +
				(items.length > 0
					? `; the first has: ${Object.keys(items[0] ?? {}).join(', ') || '(no keys)'}`
					: ''),
		);
	}

	// It never hands back an empty set. The negative assertion in this file — that unrelated
	// surfaces are NOT proposed — is satisfied vacuously by a detector this reader could not parse,
	// so it would pass hardest at the moment it stopped seeing anything. Every fixture that reaches
	// here has a pair planted in it.
	assert.fail(
		`${name}() proposed nothing this test could read as a pair of surfaces, on a fixture with a ` +
			`pair planted in it:\n${notes.join('\n')}\n\n` +
			`Read as a proposal: a two-element array, an object carrying a pair of endpoint strings, ` +
			`or a GROUP — an object whose spellings sit under one of ${GROUP_KEYS.join(', ')}, either ` +
			`as strings or as objects carrying one of ${SURFACE_KEYS.join(', ')}.`,
	);
}

/** Where a proposal of several spellings of one thing keeps them. */
const GROUP_KEYS = ['surfaces', 'members', 'nodes', 'group', 'candidates', 'spellings'];

/** The surfaces one proposal names, whether it is a pair, a group, or an edge-shaped object. */
function proposedSurfaces(item) {
	if (Array.isArray(item)) return item.map(surfaceOf).filter((surface) => surface !== null);
	for (const key of GROUP_KEYS) {
		const members = item?.[key];
		if (Array.isArray(members)) return members.map(surfaceOf).filter((surface) => surface !== null);
	}
	return edgeEndpoints(item) ?? [];
}

/** Every unordered pair of distinct members. A group of three is three pairs. */
function unorderedPairs(surfaces) {
	const distinct = [...new Set(surfaces)];
	const pairs = [];
	for (let left = 0; left < distinct.length; left += 1) {
		for (let right = left + 1; right < distinct.length; right += 1) {
			pairs.push([distinct[left], distinct[right]]);
		}
	}
	return pairs;
}

/**
 * One unordered pair, as a comparable key.
 *
 * The separator is NUL because it is the one character a surface will not contain, and because any
 * printable separator makes two different pairs collide — `"a b" + "c"` and `"a" + "b c"` are the
 * same string under a space. It is written as an escape: a raw NUL byte in a source file makes the
 * file binary to git and to grep, and a test nobody can grep is a test nobody reviews.
 */
const SEPARATOR = '\u0000';
const pair = (a, b) => [a, b].sort().join(SEPARATOR);

/** A pair key, rendered for a person to read. */
const showPair = (key) => key.split(SEPARATOR).join('" / "');

// ---------------------------------------------------------------------------------------------
// The fixtures — built by hand, from surfaces that exist nowhere but this file
// ---------------------------------------------------------------------------------------------
//
// The kinds and the memory type below are invented strings. They are not vocabulary read from the
// engine and nothing writes them anywhere: every assertion in this file is about topology, and
// topology does not care what a kind is called. The one place a real vocabulary would matter — a
// control offering values to a user — is not this file.

const FIXTURE_KIND = 'fixture-kind';
const FIXTURE_TYPE = 'fixture-memory-type';
const FIXTURE_PREDICATE = 'fixture-relates-to';

let nextMemory = 0;

/**
 * One exported memory record, in the shape the listing serves.
 *
 * `declares` is separate from `facts` on purpose: a memory may assert a fact about a surface it
 * never declared, and that is the common case rather than an anomaly. The model is built from the
 * facts either way.
 */
function memory({ declares = [], facts = [], title } = {}) {
	nextMemory += 1;
	const id = `fixture-memory-${nextMemory}`;
	return {
		memory_id: id,
		version_id: `${id}-version`,
		content_md: `# ${title ?? id}\n\nA record this test built.`,
		semantic: {
			title: title ?? id,
			memory_type: FIXTURE_TYPE,
			scope: { project: null, branch: null, artifact: null },
			entities: declares.map((surface) => ({
				n: surface,
				kind: FIXTURE_KIND,
				is: `an invented thing named ${surface}`,
			})),
			facts: facts.map(([subject, object, predicate = FIXTURE_PREDICATE]) => ({
				subject,
				predicate,
				object,
				about: {},
				basis: null,
				mode: null,
				from: null,
				until: null,
				evidence: [],
			})),
		},
	};
}

// =============================================================================================

test('nodes and edges are derived from the facts, and the counts are self-consistent', async (t) => {
	// Three memories, one of which declares nothing at all — which is legitimate, common, and the
	// case a model built from the declared entity list draws as empty.
	const records = [
		memory({ declares: ['alpha', 'beta', 'gamma'], facts: [['alpha', 'beta'], ['beta', 'gamma']] }),
		memory({ declares: ['delta', 'epsilon'], facts: [['delta', 'epsilon']] }),
		memory({ declares: [], facts: [['zeta', 'eta']] }),
	];

	const expectedSurfaces = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']);
	const expectedFacts = 4;

	const { model, specifier, buildName } = await build(records);
	t.diagnostic(`model from ${specifier} → ${buildName}()`);

	const surfaces = readEntityNodes(model);
	const edges = readClaimEdges(model, surfaces);

	await t.test('one node per distinct endpoint surface', () => {
		assert.deepEqual(
			[...surfaces].sort(),
			[...expectedSurfaces].sort(),
			`The model's node set is not the fixture's endpoint set.\n` +
				`  missing: ${[...expectedSurfaces].filter((s) => !surfaces.has(s)).join(', ') || '(none)'}\n` +
				`  extra:   ${[...surfaces].filter((s) => !expectedSurfaces.has(s)).join(', ') || '(none)'}`,
		);
	});

	await t.test('a surface no memory declares still gets a node', () => {
		// The third memory declares nothing and its fact names two surfaces. Whether a surface was
		// declared is an ATTRIBUTE of the node, never an admission test — on a vault where most
		// endpoints are undeclared, the declared-only filter draws almost nothing and reports
		// success. Two independent implementations have reached for it.
		assert.ok(surfaces.has('zeta'), 'an undeclared fact subject has no node');
		assert.ok(surfaces.has('eta'), 'an undeclared fact object has no node');
	});

	await t.test('a degree-1 surface is not suppressed', () => {
		// Suppressing degree-1 nodes is the standard remedy for a scattered picture, and on a real
		// vault it deletes roughly three quarters of the nodes — every isolated fact, every
		// once-used relationship name, every undeclared endpoint. That is the entire curation
		// backlog, and the picture gets prettier as it gets emptier.
		for (const surface of ['gamma', 'delta', 'epsilon', 'zeta', 'eta']) {
			assert.ok(surfaces.has(surface), `the degree-1 surface "${surface}" was dropped`);
		}
	});

	await t.test('one claim edge per fact, and every endpoint has a node', () => {
		assert.equal(
			edges.length,
			expectedFacts,
			`${expectedFacts} facts produced ${edges.length} claim edges. An edge the export does ` +
				`not literally contain is the expensive error on this screen: the user reads it as ` +
				`the engine holding two names as one thing, and the merge they then ask for is an ` +
				`irreversible rewrite across every memory that names them.`,
		);
		for (const { ends } of edges) {
			assert.ok(surfaces.has(ends[0]), `edge endpoint "${ends[0]}" has no node`);
			assert.ok(surfaces.has(ends[1]), `edge endpoint "${ends[1]}" has no node`);
		}
	});

	await t.test('building twice from the same records gives the same graph', async () => {
		// The model is arithmetic over a payload already fetched. If a second build differs, then
		// something in it is reading state that is not the records — and a lens switch, which is a
		// filter over this model rather than a rebuild, would not be safe.
		const again = await build(records);
		const surfacesAgain = readEntityNodes(again.model);
		assert.deepEqual([...surfacesAgain].sort(), [...surfaces].sort());
		assert.equal(readClaimEdges(again.model, surfacesAgain).length, edges.length);
	});
});

test('a surface used by two memories is one node', async (t) => {
	const records = [
		memory({ declares: ['shared surface'], facts: [['shared surface', 'left neighbour']] }),
		memory({ declares: ['shared surface'], facts: [['shared surface', 'right neighbour']] }),
	];

	const { model } = await build(records);
	const surfaces = readEntityNodes(model);
	const edges = readClaimEdges(model, surfaces);

	assert.deepEqual(
		[...surfaces].sort(),
		['left neighbour', 'right neighbour', 'shared surface'],
		`Two memories naming one surface produced ${surfaces.size} nodes. A surface is one node ` +
			`however many memories touch it — that is the whole reason the drawing can show anything ` +
			`about connection at all.`,
	);
	assert.equal(edges.length, 2, 'two facts did not produce two claim edges');

	// And the join is real: the shared surface is what connects the two memories, so the whole
	// fixture is one component rather than two.
	const partition = await readComponents(model, surfaces);
	assert.equal(
		partition.length,
		1,
		`The shared surface did not join the two memories: the model reports ${partition.length} ` +
			`components where there is one. Components are:\n  ${renderPartition(partition)}`,
	);
	t.diagnostic(`one component: ${renderPartition(partition)}`);
});

test('two surfaces differing only in case are two nodes', async (t) => {
	// Identity in this system is exact surface match. A model that lowercases, trims or otherwise
	// normalises before grouping is drawing an edge the export does not contain — and it does it
	// invisibly, because the merged node looks exactly like a node that was always one thing.
	//
	// The similarity belongs in the rail, as a candidate a person confirms. It is asserted there,
	// below, so this is not a test that merely forbids something: it says where the finding goes.
	const records = [
		memory({ declares: ['Ledger Service'], facts: [['Ledger Service', 'the audit log']] }),
		memory({ declares: ['ledger service'], facts: [['ledger service', 'the audit log']] }),
	];

	const { model } = await build(records);
	const surfaces = readEntityNodes(model);

	assert.ok(
		surfaces.has('Ledger Service') && surfaces.has('ledger service'),
		`Two surfaces differing only in case came back as ${[...surfaces].sort().join(', ')}. The ` +
			`reconstruction is faithful to exact-match identity or it is not a reconstruction: ` +
			`merging them here is helpfulness that costs an irreversible multi-memory rewrite, ` +
			`because the user sees one node and concludes the engine holds them as one thing.`,
	);
	assert.equal(
		surfaces.size,
		3,
		`Expected three nodes and got ${surfaces.size}: ${[...surfaces].sort().join(', ')}.`,
	);

	const { pairs, name } = await readNearDuplicates(model, surfaces);
	assert.ok(
		pairs.has(pair('Ledger Service', 'ledger service')),
		`${name}() did not propose the two spellings as a candidate pair. Refusing to merge them ` +
			`in the model is only half the design — the other half is that the difference is ` +
			`REPORTED, as a row a person can act on. Without it the model is merely fragmented.`,
	);
});

test('components are computed correctly on a hand-built fixture', async (t) => {
	// Three groups, deliberately shaped so the answer is the same whether components are computed
	// over the entity claim graph or over the bipartite memory-and-surface graph: each group's
	// facts live in one memory, so no memory bridges two groups.
	const records = [
		memory({
			title: 'the chain',
			declares: ['a1', 'a2', 'a3'],
			facts: [['a1', 'a2'], ['a2', 'a3']],
		}),
		memory({ title: 'a dyad', declares: ['b1', 'b2'], facts: [['b1', 'b2']] }),
		// A single fact, connected to nothing else — the shape roughly half the components of a
		// working vault have. It is a component, not noise, and it must be counted as one.
		memory({ title: 'a lone island', declares: [], facts: [['c1', 'c2']] }),
	];

	const { model } = await build(records);
	const surfaces = readEntityNodes(model);
	const partition = await readComponents(model, surfaces);

	const expected = [new Set(['a1', 'a2', 'a3']), new Set(['b1', 'b2']), new Set(['c1', 'c2'])];

	assert.equal(
		partition.length,
		expected.length,
		`Expected ${expected.length} components and got ${partition.length}:\n  ` +
			`${renderPartition(partition)}`,
	);
	assert.equal(
		renderPartition(partition),
		renderPartition(expected),
		`The components are not the fixture's groups.\nexpected:\n  ${renderPartition(expected)}\n` +
			`  got:\n  ${renderPartition(partition)}`,
	);

	assert.deepEqual(
		[...surfaces].sort(),
		['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2'],
		'the component fixture lost or gained a surface before the components were computed',
	);
	t.diagnostic(`components:\n  ${renderPartition(partition)}`);
});

test('the near-duplicate detector finds a planted pair and leaves the model alone', async (t) => {
	// The planted pair differs by one hyphen — the cheapest possible near-miss, and the one a real
	// vault accumulates most of. Everything else in this fixture is unrelated to it and to each
	// other, so a detector that fires on everything is caught here rather than by a user who stops
	// trusting the rail after the third false pair.
	const records = [
		memory({ declares: ['payments client'], facts: [['payments client', 'exponential backoff']] }),
		memory({ declares: ['payments-client'], facts: [['payments-client', 'the retry budget']] }),
		memory({ declares: [], facts: [['quarterly revenue report', 'the finance folder']] }),
		memory({ declares: [], facts: [['a weekly standup', 'thursday mornings']] }),
	];

	const { model } = await build(records);
	const surfacesBefore = readEntityNodes(model);
	const edgesBefore = readClaimEdges(model, surfacesBefore).length;

	const { pairs, name, how } = await readNearDuplicates(model, surfacesBefore);
	t.diagnostic(`${name} via ${how} proposed ${pairs.size} pair(s)`);

	await t.test('the planted pair is proposed', () => {
		assert.ok(
			pairs.has(pair('payments client', 'payments-client')),
			`${name}() did not propose "payments client" / "payments-client", which differ by one ` +
				`hyphen. It proposed: ${[...pairs].map((p) => `"${showPair(p)}"`).join('; ') || '(nothing)'}.`,
		);
	});

	await t.test('it does not fire on unrelated surfaces', () => {
		// Named individually rather than asserted as a total count: "it proposed exactly one pair"
		// is satisfied by a detector that proposes one WRONG pair, and the message it fails with
		// would not say so.
		const unrelated = [
			pair('payments client', 'quarterly revenue report'),
			pair('payments client', 'a weekly standup'),
			pair('quarterly revenue report', 'a weekly standup'),
			pair('exponential backoff', 'the retry budget'),
			pair('quarterly revenue report', 'the finance folder'),
		];
		for (const candidate of unrelated) {
			assert.ok(
				!pairs.has(candidate),
				`${name}() proposed "${showPair(candidate)}" as possibly one ` +
					`thing. Every card in the rail ends in an action that rewrites N memories with no ` +
					`undo, so a detector that fires on unrelated surfaces does not cost a scroll — it ` +
					`costs the user's trust in every row beside it.`,
			);
		}
	});

	await t.test('running the detector changed nothing about the model', () => {
		// It is a candidate generator into a list, never a transform on the model. If running it
		// merges anything, then the drawing has silently acquired an edge the export does not
		// contain, and the caveat printed under the canvas becomes false.
		const surfacesAfter = readEntityNodes(model);
		assert.deepEqual(
			[...surfacesAfter].sort(),
			[...surfacesBefore].sort(),
			`The node set moved while the near-miss detector ran. Over-fragmenting is the safe ` +
				`direction and is preferred deliberately; a merge performed by the model is the one ` +
				`error whose cost is an irreversible rewrite.`,
		);
		assert.equal(readClaimEdges(model, surfacesAfter).length, edgesBefore);
		assert.ok(
			surfacesAfter.has('payments client') && surfacesAfter.has('payments-client'),
			'the proposed pair was merged into one node by the act of proposing it',
		);
	});
});
