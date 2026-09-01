// The three lenses, the two sets of counts, the four empty states, and the view in the URL.
//
// Everything here is arithmetic over hand-built fixtures. No vault is opened, no process is
// spawned and no clone is needed — which is itself the requirement (PRD 0005 R2): this screen
// issues no door call of its own, so every lens, filter and reduction has to be computable from a
// payload the browser already holds. A test that needed a vault to exercise a lens would be
// evidence that the screen is calling something.
//
// WHAT THESE TESTS ARE FOR, one line each, because a test whose reason is not written down is a
// test the next contributor deletes when it is in the way:
//
//   * a lens must draw the node and edge kinds it CLAIMS to draw. A "memories" lens with no memory
//     node on it is the exact defect the entity-only version of this screen shipped with, and it
//     was invisible to ninety-three passing tests because none of them asked what was drawn.
//   * the C lens must contain memory nodes and the E lens must not. That is not a preference: E
//     discards the memory, and every verb in this product is addressed by memory id, so E is the
//     lens with no verbs and it must not be the default.
//   * a memory node must carry the id needed to open it. A node you can click into nothing is
//     decoration.
//   * a lens switch must be a PROJECTION of one reconstruction, never three loads. Three models is
//     three things that can disagree about the vault, and the disagreement shows up as a node that
//     exists on one screen and not on another with nothing on screen explaining it.
//   * the view must round-trip through the URL WITHOUT carrying the launch token. The token lives
//     in the same fragment and is erased after one read; a codec that copied it would write a
//     credential with total read/write authority over the vault into browser history, where it
//     outlives the tab.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	DEFAULT_LENS,
	LENSES,
	buildGraph,
	decodeGraphView,
	defaultView,
	emptyState,
	encodeGraphView,
	fidelityReading,
	filterProjection,
	memoryNodeId,
	modelWarning,
	parseNodeId,
	projectLens,
	scopeSurfaces,
} from '../src/app/graph-model.mjs';

// ---------------------------------------------------------------------------------------------
// The fixture. Invented surfaces, invented predicates, invented kinds.
//
// Nothing here is vault content and nothing here is a vocabulary read from the engine: the
// assertions are about topology, and topology does not care what a kind is called. The shape is
// chosen so that exactly one surface is a CONNECTOR (two memories touch `beta`) and exactly one
// memory shares nothing with anybody — which is the whole distinction the C lens is built on.
// ---------------------------------------------------------------------------------------------

const record = (id, title, type, entities, facts) => ({
	memory_id: id,
	version_id: `${id}-v1`,
	semantic: { memory_id: id, title, memory_type: type, entities, facts, sequence: 1, scope: {} },
});

const FIXTURE = [
	record(
		'mem-a',
		'The first note',
		'observation',
		[
			{ n: 'alpha', kind: 'widget', is: 'the first widget' },
			{ n: 'beta', kind: 'widget', is: null },
		],
		[
			{ subject: 'alpha', predicate: 'uses', object: 'beta' },
			{ subject: 'beta', predicate: 'needs', object: 'gamma' },
		],
	),
	record(
		'mem-b',
		'The second note',
		'decision',
		[{ n: 'beta', kind: 'tool', is: null }],
		[{ subject: 'beta', predicate: 'notes', object: 'delta' }],
	),
	// Shares no surface with anything. In C and M it is relocated to the rail, never deleted.
	record(
		'mem-c',
		'The lonely note',
		'observation',
		[],
		[{ subject: 'zeta', predicate: 'mentions', object: 'eta' }],
	),
];

const everything = (graph) => scopeSurfaces(graph, { kind: 'all' });

test('the fixture is the shape these tests are about', () => {
	const graph = buildGraph(FIXTURE);
	assert.equal(graph.counts.memoryNodeCount, 3);
	assert.equal(graph.counts.nodeCount, 6, 'six distinct endpoint surfaces');
	assert.equal(graph.counts.edgeCount, 4, 'four facts, each with both endpoints');
	// One connector, and it is the only thing that can join two memories.
	assert.equal(graph.counts.connectorCount, 1);
	assert.equal(graph.counts.connectedMemoryCount, 2);
	assert.equal(graph.counts.unconnectedMemoryCount, 1);
	// One incidence per fact endpoint, including both ends of every fact.
	assert.equal(graph.counts.incidenceCount, 8);
});

test('each lens produces the node and edge kinds it claims, and only those', () => {
	const graph = buildGraph(FIXTURE);

	for (const lens of LENSES) {
		const projection = projectLens(graph, { lens: lens.id, surfaces: everything(graph) });
		assert.ok(projection.nodes.length > 0, `${lens.id} drew nothing at all`);

		const nodeKinds = new Set(projection.nodes.map((node) => node.kind));
		const edgeKinds = new Set(projection.edges.map((edge) => edge.kind));

		for (const kind of nodeKinds) {
			assert.ok(
				lens.nodeKinds.includes(kind),
				`lens ${lens.id} drew a "${kind}" node and its own description does not claim one`,
			);
		}
		for (const kind of edgeKinds) {
			assert.ok(
				lens.edgeKinds.includes(kind),
				`lens ${lens.id} drew a "${kind}" edge and its own description does not claim one`,
			);
		}
		// And the claim is not vacuous in the other direction: a lens that claims a kind and never
		// draws one is a description of a screen that does not exist.
		for (const kind of lens.edgeKinds) {
			assert.ok(edgeKinds.has(kind), `lens ${lens.id} claims a "${kind}" edge and drew none`);
		}
	}
});

test('the C lens contains memory nodes and the E lens does not', () => {
	const graph = buildGraph(FIXTURE);
	const surfaces = everything(graph);

	const connections = projectLens(graph, { lens: 'C', surfaces });
	const claims = projectLens(graph, { lens: 'E', surfaces });

	assert.ok(
		connections.nodes.some((node) => node.kind === 'memory'),
		'the default lens has no memory node on it, which is the defect the lens work exists to fix',
	);
	assert.equal(
		claims.nodes.filter((node) => node.kind === 'memory').length,
		0,
		'the claims lens is entities only; a memory node in it is a different lens',
	);
	// And C is the default, because the default is the whole argument.
	assert.equal(DEFAULT_LENS, 'C');
});

test('a memory node carries the id needed to open it', () => {
	const graph = buildGraph(FIXTURE);
	const projection = projectLens(graph, { lens: 'C', surfaces: everything(graph) });
	const drawn = projection.nodes.filter((node) => node.kind === 'memory');

	assert.deepEqual(
		drawn.map((node) => node.memory_id).sort(),
		['mem-a', 'mem-b'],
		'the two memories that share a name are the two that are drawn',
	);

	for (const node of drawn) {
		// The click path: the canvas hands back a node id, and that id has to resolve to the memory
		// id a route is built from. A node whose id cannot be turned back into a memory id is a node
		// that can be clicked into nothing.
		assert.equal(node.id, memoryNodeId(node.memory_id));
		assert.deepEqual(parseNodeId(node.id), { kind: 'memory', memory_id: node.memory_id });
		assert.ok(
			FIXTURE.some((entry) => entry.memory_id === node.memory_id),
			'a memory node addresses a memory that is not in the export',
		);
	}

	// The memory that shares nothing is RELOCATED, not deleted: it is not drawn, and it is returned
	// so the rail can list it and the header can count it.
	assert.deepEqual(
		projection.unconnected.map((memory) => memory.memory_id),
		['mem-c'],
	);
	assert.equal(
		projectLens(graph, { lens: 'C', surfaces: everything(graph), showUnconnectedMemories: true }).nodes.filter(
			(node) => node.kind === 'memory',
		).length,
		3,
		'the counter is a filter: asking for them draws them',
	);
});

test('a node id survives a surface containing the delimiter', () => {
	// A surface is vault content. An id space that splits naively on every colon addresses the
	// wrong node for any name that contains one — silently, with no count changing.
	const awkward = [
		record(
			'mem-x',
			'Colons',
			'observation',
			[],
			[{ subject: 'https://example.invalid/a', predicate: 'links', object: 'a:b:c' }],
		),
		record(
			'mem-y',
			'Colons again',
			'observation',
			[],
			[{ subject: 'a:b:c', predicate: 'appears', object: 'somewhere else' }],
		),
	];
	const graph = buildGraph(awkward);
	const projection = projectLens(graph, { lens: 'C', surfaces: everything(graph) });
	const entity = projection.nodes.find((node) => node.kind === 'entity');
	assert.equal(entity.surface, 'a:b:c');
	assert.deepEqual(parseNodeId(entity.id), { kind: 'entity', surface: 'a:b:c' });
});

test('lens switching is a projection of one reconstruction, not three loads', () => {
	const graph = buildGraph(FIXTURE);
	const surfaces = everything(graph);

	// A snapshot of the model, taken before any projection runs.
	const before = {
		counts: { ...graph.counts },
		nodes: [...graph.nodes.keys()],
		edges: graph.edges.map((edge) => edge.id),
		memories: [...graph.memories.keys()],
		incidences: graph.incidences.length,
	};

	const projections = LENSES.map((lens) => projectLens(graph, { lens: lens.id, surfaces }));

	assert.deepEqual(
		{
			counts: { ...graph.counts },
			nodes: [...graph.nodes.keys()],
			edges: graph.edges.map((edge) => edge.id),
			memories: [...graph.memories.keys()],
			incidences: graph.incidences.length,
		},
		before,
		'a projection changed the model it projected — a lens is a filter, never a transform',
	);

	// The decisive one: the SAME node object appears in two lenses. Two lenses holding two objects
	// for one name is two models, and the day one of them is updated the other is silently stale.
	const inC = projections[0].nodes.find((node) => node.kind === 'entity' && node.surface === 'beta');
	const inE = projections[2].nodes.find((node) => node.surface === 'beta');
	assert.ok(inC && inE);
	assert.equal(inC.node, inE.node, 'the two lenses hold different objects for the same name');
	assert.equal(inC.node, graph.nodes.get('beta'), 'and neither is the model’s own node');

	// Building twice from the same records is the control for the assertion above: if projecting
	// mutated anything, this second build is the only thing that would still agree with `before`.
	assert.deepEqual({ ...buildGraph(FIXTURE).counts }, before.counts);
});

test('no lens draws an edge the export does not literally contain', () => {
	// The rule the whole model is governed by, checked in the two lenses that derive their edges.
	// A drawn edge that does not exist invites a user to merge two things that were never one, and
	// this app executes a merge as a rewrite across every memory that names them, with no undo.
	const graph = buildGraph(FIXTURE);
	const surfaces = everything(graph);

	for (const edge of projectLens(graph, { lens: 'C', surfaces }).edges) {
		const memory = parseNodeId(edge.source);
		const entity = parseNodeId(edge.target);
		assert.equal(memory.kind, 'memory');
		assert.equal(entity.kind, 'entity');
		for (const incidence of edge.incidences) {
			assert.equal(incidence.memory_id, memory.memory_id);
			assert.equal(incidence.surface, entity.surface);
			assert.ok(
				graph.memories.get(memory.memory_id).surfaces.includes(entity.surface),
				'an incidence names a surface its own memory never touched',
			);
		}
	}

	for (const edge of projectLens(graph, { lens: 'M', surfaces }).edges) {
		const a = parseNodeId(edge.source).memory_id;
		const b = parseNodeId(edge.target).memory_id;
		assert.ok(edge.surfaces.length > 0, 'a join with no shared name behind it');
		for (const surface of edge.surfaces) {
			const touching = graph.nodes.get(surface).memories.map((memory) => memory.memory_id);
			assert.ok(touching.includes(a) && touching.includes(b), 'a join whose name one side never touched');
		}
	}
});

test('the scope ladder survives a lens change, and says so where it stops meaning anything', () => {
	const graph = buildGraph(FIXTURE);

	// A scope is a statement about NAMES, so the same scope object is legal in every lens.
	const scope = { kind: 'ego', seed: 'beta', depth: 1 };
	const surfaces = scopeSurfaces(graph, scope);
	for (const lens of LENSES) {
		assert.doesNotThrow(() => projectLens(graph, { lens: lens.id, surfaces }));
	}

	// Where it stops meaning something: a scope holding no connector draws in E and cannot draw in
	// C or M, and the projection reports WHY rather than handing back an empty canvas.
	const lonely = scopeSurfaces(graph, { kind: 'ego', seed: 'zeta', depth: 1 });
	assert.ok(projectLens(graph, { lens: 'E', surfaces: lonely }).elementCount > 0);
	assert.equal(projectLens(graph, { lens: 'C', surfaces: lonely }).emptyReason, 'no-connectors');
	assert.equal(projectLens(graph, { lens: 'M', surfaces: lonely }).emptyReason, 'no-connectors');
});

test('the default view is lens C over the whole vault, and the ladder is lens-dependent', () => {
	const graph = buildGraph(FIXTURE);

	const c = defaultView(graph, { lens: 'C' });
	assert.equal(c.rule, 'whole-vault');
	assert.deepEqual(c.scope, { kind: 'all' });

	// E starts one rung lower, because at the entity level the whole vault is the confetti field
	// this screen exists to avoid.
	const e = defaultView(graph, { lens: 'E' });
	assert.equal(e.rule, 'largest-component');
	assert.equal(e.scope.kind, 'component');

	// And the ladder is a ladder: a cap small enough forces the next rung, and the rung names itself.
	const forced = defaultView(graph, { lens: 'C', cap: 2 });
	assert.notEqual(forced.rule, 'whole-vault');
	assert.ok(forced.reason.length > 0);
});

test('the filters apply to a projection in every lens, and never leave floating nodes', () => {
	const graph = buildGraph(FIXTURE);
	const projection = projectLens(graph, { lens: 'C', surfaces: everything(graph) });

	const filtered = filterProjection(projection, { typeFilter: ['decision'] });
	assert.deepEqual(
		filtered.nodes.filter((node) => node.kind === 'memory').map((node) => node.memory_id),
		['mem-b'],
	);
	// `beta` survives because `mem-b` still touches it; nothing survives with no edge.
	for (const node of filtered.nodes) {
		assert.ok(
			filtered.edges.some((edge) => edge.source === node.id || edge.target === node.id),
			`${node.id} is drawn with no edge and was not the selection`,
		);
	}
	assert.equal(filtered.elementCount, filtered.nodes.length + filtered.edges.length);

	// The selection is the one exception, and it is explicit.
	const kept = filterProjection(projection, { typeFilter: ['decision'], keep: memoryNodeId('mem-a') });
	assert.ok(kept.nodes.every((node) => node.id !== memoryNodeId('mem-a')), 'a filtered-out node is not kept by name alone');
});

// ---------------------------------------------------------------------------------------------
// The four empty states
// ---------------------------------------------------------------------------------------------

test('four conditions produce four different sentences', () => {
	const empty = emptyState(buildGraph([]), { lens: 'C' });
	assert.equal(empty.kind, 'no-memories');
	assert.equal(empty.drawCanvas, false);

	const noFacts = emptyState(buildGraph([record('mem-1', 'A note', 'observation', [], [])]), { lens: 'C' });
	assert.equal(noFacts.kind, 'no-facts');

	// THE ONE THAT WAS FOLDED INTO THE ONE ABOVE. There are facts, they draw perfectly well as
	// claims, and no two memories share a name — so at the memory level nothing connects. Drawing an
	// empty canvas here reads as a broken screen; the rail goes full width because in this state the
	// rail is the entire product.
	const lonely = buildGraph([
		record('mem-1', 'A note', 'observation', [], [{ subject: 'one', predicate: 'relates', object: 'two' }]),
		record('mem-2', 'Another', 'observation', [], [{ subject: 'three', predicate: 'relates', object: 'four' }]),
	]);
	const noConnectors = emptyState(lonely, { lens: 'C' });
	assert.equal(noConnectors.kind, 'no-connectors');
	assert.equal(noConnectors.railFullWidth, true);
	assert.notEqual(noConnectors.heading, noFacts.heading, 'two conditions, one sentence');
	assert.notEqual(noConnectors.body, noFacts.body);

	// Same vault, entity lens: there IS something to draw, so there is no empty state at all. The
	// state is a property of the lens, not only of the vault.
	assert.equal(emptyState(lonely, { lens: 'E' }), null);

	// The fourth is an engine warning rather than a graph state, and it belongs on the same strip.
	assert.equal(modelWarning({ status: 'bundled' }), null);
	const warning = modelWarning({ status: 'absent' });
	assert.ok(warning.text.includes('absent'), 'the status is reported as the engine spelled it');
	assert.ok(modelWarning(null).text.length > 0, 'no reading at all is its own sentence, not silence');
});

// ---------------------------------------------------------------------------------------------
// The fidelity strip: two sets of counts, and the honest absence of one
// ---------------------------------------------------------------------------------------------

test('the strip renders the engine’s counts beside this app’s, and names what it cannot compare', () => {
	const graph = buildGraph(FIXTURE);

	// Shaped as `/api/health` serves it: the engine's own reading, under `data`.
	const health = {
		data: {
			graph: {
				status: 'gapped',
				behind: 12,
				density: { nodes: 4 },
				gap_classification: { status: 'classified', missing_folds: 0 },
			},
			embedding: { status: 'bundled' },
		},
	};

	const reading = fidelityReading(graph, health);
	assert.equal(reading.available, true);

	const nodes = reading.rows.find((row) => row.key === 'nodes');
	assert.equal(nodes.client, graph.counts.nodeCount);
	assert.equal(nodes.engine, 4);
	assert.equal(nodes.comparable, true);
	assert.equal(nodes.difference, graph.counts.nodeCount - 4);
	assert.ok(nodes.meaning.length > 0, 'a difference with no explanation is two numbers, not a message');

	// THE ROW THAT MUST NOT INVENT A COMPARISON. The engine publishes no count of the links this
	// drawing draws; the one edge-like number it does publish counts a different class of link. A
	// borrowed number here would be checkable and wrong, which is worse than an absent one.
	const edges = reading.rows.find((row) => row.key === 'edges');
	assert.equal(edges.engine, null);
	assert.equal(edges.comparable, false);
	assert.ok(edges.meaning.length > 0);

	// R15: no bare status word and no bare "behind" number. Both are rendered with what they mean.
	const status = reading.notes.find((note) => note.key === 'status');
	assert.ok(status, 'a non-ready engine graph is reported');
	assert.ok(status.text.includes('gapped') && status.text.includes('12'));
	assert.ok(status.text.length > 40, 'a status word with no sentence around it is a bare status word');

	// And with no engine reading at all, the strip says so rather than showing one column as if it
	// were the comparison.
	const alone = fidelityReading(graph, null);
	assert.equal(alone.available, false);
	assert.ok(alone.notes.some((note) => note.key === 'unavailable'));
	assert.equal(alone.rows.find((row) => row.key === 'nodes').comparable, false);
});

// ---------------------------------------------------------------------------------------------
// The view in the URL
// ---------------------------------------------------------------------------------------------

test('the view round-trips through the URL', () => {
	const cases = [
		{ lens: 'C', scope: null, kindFilter: [], typeFilter: [], selected: null, showUnconnectedMemories: false },
		{
			lens: 'M',
			scope: { kind: 'component', componentId: 'c3' },
			kindFilter: ['widget'],
			typeFilter: [],
			selected: 'm:mem-a',
			showUnconnectedMemories: true,
		},
		{
			lens: 'E',
			scope: { kind: 'ego', seed: 'a name with spaces & an ampersand', depth: 3 },
			kindFilter: [],
			typeFilter: ['observation', 'decision'],
			selected: 'e:beta',
			showUnconnectedMemories: false,
		},
		{
			lens: 'C',
			scope: { kind: 'degree', minDegree: 5 },
			kindFilter: ['(not declared)'],
			typeFilter: [],
			selected: null,
			showUnconnectedMemories: false,
		},
		{
			lens: 'C',
			scope: { kind: 'memory_type', memoryType: 'observation' },
			kindFilter: [],
			typeFilter: [],
			selected: null,
			showUnconnectedMemories: false,
		},
		// PRD 0005 R18/R25: THE REDUCTIONS TRAVEL WITH THE LINK. A collapse and an absorb are the
		// only view state that takes elements away, so a URL that carried the lens and the scope but
		// not these would show a recipient a different picture from the sender's, with nothing on
		// either screen able to say so. The surfaces here carry a bar and an ampersand on purpose:
		// `expand` packs a count and an id into one value, and the split has to be on the first bar.
		{
			lens: 'E',
			scope: { kind: 'ego', seed: 'the busiest name', depth: 2 },
			kindFilter: [],
			typeFilter: [],
			selected: null,
			showUnconnectedMemories: false,
			collapsed: ['e:the busiest name'],
			absorbed: ['e:a|name&with punctuation'],
			expanded: [['e:the busiest name', 150]],
		},
	];

	for (const state of cases) {
		// Defaults are filled in on the expected side rather than omitted from the decode, because
		// "the parameter was absent" and "the reduction is empty" are the same view and the screen
		// should not have to tell them apart.
		const expected = { collapsed: [], absorbed: [], expanded: [], ...state };
		assert.deepEqual(decodeGraphView(encodeGraphView(state)), expected, JSON.stringify(state));
	}

	// A malformed expansion is dropped, never defaulted: the chip beside an expansion renders
	// `showing k of N`, and inventing a k here would put a number on screen that came from a broken
	// link rather than from anything the user did.
	for (const bad of ['expand=|e:x', 'expand=0|e:x', 'expand=notanumber|e:x', 'expand=5|', 'expand=5']) {
		assert.deepEqual(decodeGraphView(bad).expanded, [], bad);
	}

	// The default is the empty string, so a link a user copies says only what they changed.
	assert.equal(encodeGraphView(cases[0]), '');
	// And a fragment that has been through the codec is still readable by the router: the route and
	// the view share one fragment, split on the first `?`.
	assert.match(`#/graph?${encodeGraphView(cases[1])}`, /^#\/graph\?/);
});

test('the URL codec never carries the launch token, in either direction', () => {
	// THE HAZARD. The token arrives in this same fragment (`#token=…`), is read once and erased.
	// The obvious implementation of "put the view in the URL" — read the fragment, set a parameter,
	// write it back — copies whatever else is in there into a new history entry, and browser history
	// outlives the tab. So the codec composes from state and reads nothing.
	const hostile = 'token=this-would-be-a-credential&lens=M&scope=all&sel=e:beta';
	const decoded = decodeGraphView(hostile);

	assert.equal(decoded.lens, 'M', 'the view is still decoded');
	assert.ok(!('token' in decoded), 'the token became part of the view state');
	assert.equal(
		JSON.stringify(decoded).includes('this-would-be-a-credential'),
		false,
		'the token survived into the view state, from where the next write puts it back in the URL',
	);

	const re = encodeGraphView(decoded);
	assert.equal(re.includes('token'), false, 'the codec re-emitted a token parameter');
	assert.equal(re.includes('this-would-be-a-credential'), false, 'the codec re-emitted the token value');

	// The inverse: nothing the codec is handed can smuggle a parameter through it. Every parameter
	// it emits is one it owns, so a value it does not understand cannot ride along.
	const smuggled = encodeGraphView({
		lens: 'C',
		scope: { kind: 'all' },
		token: 'still-a-credential',
		extra: 'anything',
	});
	assert.equal(smuggled.includes('still-a-credential'), false);
	assert.equal(smuggled.includes('extra'), false);
	assert.equal(smuggled, 'scope=all');
});

test('the codec is the only thing that composes this screen’s fragment', () => {
	// A static property of the source, because the defect it prevents is a line of code rather than
	// a value: `window.location.hash = …` built by hand, or a `URLSearchParams(location.hash)` that
	// is then written back, is how the token gets copied. The one write is a `replaceState` in
	// `GraphView.jsx`, and it is fed by `encodeGraphView`.
	const source = readFileSync(new URL('../src/app/GraphView.jsx', import.meta.url), 'utf8');

	assert.match(source, /window\.history\.replaceState/, 'the view is not written to the URL at all');
	assert.ok(
		!/window\.location\.hash\s*=/.test(source),
		'this screen assigns to location.hash, which pushes a history entry per filter tick',
	);
	assert.ok(
		!/URLSearchParams\(\s*window\.location/.test(source),
		'this screen reads the live fragment to compose the next one, which is how the token is copied',
	);
	assert.match(source, /encodeGraphView\(/, 'the write does not go through the codec');
});

test('the empty state that hides the canvas still renders its own sentence', () => {
	// A STATIC PROPERTY OF THE SOURCE, because the defect is a join and not a value.
	//
	// Three of the four empty states render inside the stage. The fourth — facts exist, and no two
	// memories share a name — does not render the stage AT ALL: the rail goes full width, because in
	// that state the rail is the entire product. The obvious implementation of that layout drops the
	// heading and body with the stage, and what is left is a bare list under a header, which reads as
	// a canvas that failed to load. That is the one reading this state exists to prevent.
	//
	// `emptyState` returning the right words is not evidence that anything renders them, so this
	// asserts the words reach the screen on BOTH paths. It went red against the shipped component,
	// naming this line.
	const source = readFileSync(new URL('../src/app/GraphView.jsx', import.meta.url), 'utf8');

	assert.match(source, /railFullWidth/, 'the rail-full-width layout is gone; this test is stale');
	assert.ok(
		source.split('vacant.heading').length - 1 >= 2,
		'the rail-full-width state renders no heading of its own — the only `vacant.heading` in this ' +
			'file is inside the branch that state does not take, so its sentence never reaches the screen',
	);
	assert.ok(
		source.split('vacant.body').length - 1 >= 2,
		'the rail-full-width state renders no body of its own',
	);
});
