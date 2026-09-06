// The four pieces of the graph research's build list that shipped after the rebuild, tested as
// arithmetic: the direction dial, the pin, the count of what lies beyond a drawn name, and the
// kind × kind matrix.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE HOLDS TO
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//   1. **A statement has a direction, and the dial follows it.** "What does this name say" and
//      "what is said about it" are different questions; a drawing that answered only their union
//      could not tell a reader which of the spokes point in. So the walk is asserted in all three
//      positions, at two depths, and a position the model does not know is REFUSED rather than
//      drawn as "both ways" — a dial that did the same thing in two of its three positions would
//      look exactly like one that worked.
//
//   2. **Two names on one canvas is a comparison, not a path.** There is no path between two names
//      in this product, on evidence, and the pin is what a reader gets instead: both neighbourhoods
//      at once, and the names joined to both reported as a list. The union is asserted to draw
//      nothing the export does not contain and to suppress nothing between two names it draws.
//
//   3. **The count beyond a name is exact.** It is a promise — "opening this adds three" — and a
//      promise is worth having only if it is the real number, so it is checked against the walk
//      that would fulfil it, in every direction, and recomputed over the union when a pin is set.
//
//   4. **The matrix writes no kind down.** Its rows are the kinds the fixture declares and the
//      schema list it partitions against is handed in. Handed nothing, it says so rather than
//      guessing; handed a list, every row lands on the correct side of the rule, in volume order,
//      with the undeclared endpoints kept as their own row rather than dropped.
//
// EVERY SURFACE, KIND AND RELATION NAME BELOW IS INVENTED. This repository is public and the vault
// these screens were developed against is not; nothing here was read from a vault, and no kind here
// is one the engine names — the assertions are about topology and partition, and neither cares what
// a kind is called. `test/boundary-vault.test.mjs` is the check that holds this.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildGraph, kindPalette } from '../src/app/graph-model.mjs';
import { KIND_GROUPS, cellShade, kindMatrix, kindMatrixReading } from '../src/app/kind-matrix.mjs';
import {
	DEFAULT_DIRECTION,
	EGO_CAP,
	EGO_DIRECTIONS,
	egoElements,
	egoWithPin,
	nameRoute,
	pinnedFromRoute,
	surfaceFromRoute,
} from '../src/app/names-model.mjs';
import { layout } from '../src/app/ui/ego-layout.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'src', 'app');

// ------------------------------------------------------------------------------------------------
// fixtures — invented, and shaped for the property under test
// ------------------------------------------------------------------------------------------------

let minted = 0;

/** One exported memory, in the shape the listing serves. `declares` is [[surface, kind]]. */
const memory = ({ declares = [], facts = [] }) => {
	minted += 1;
	const id = `gf-${minted}`;
	return {
		memory_id: id,
		version_id: `v-${id}`,
		semantic: {
			memory_id: id,
			title: `An invented memory ${minted}`,
			memory_type: 'gf-type',
			created_on: '2026-06-01T09:00:00Z',
			entities: declares.map(([n, kind]) => ({ n, kind, is: `an invented thing called ${n}` })),
			facts: facts.map(([subject, predicate, object]) => ({ subject, predicate, object })),
		},
	};
};

/**
 * A directed chain through one name, with a branch on each side.
 *
 *   carrow moss ──feeds──▶ oskell drift ──feeds──▶ pellam ridge ──feeds──▶ tunley brook
 *   wystan quay ──holds──▶ oskell drift
 *   oskell drift ──holds──▶ sable rook
 *
 * From `oskell drift`: two names point IN (carrow moss, wystan quay), two point OUT (pellam ridge,
 * sable rook), and one is two steps out (tunley brook). Every assertion about the dial is a
 * statement about which of those five a walk reaches.
 */
function directedVault() {
	return [
		memory({
			declares: [['oskell drift', 'brindle']],
			facts: [
				['carrow moss', 'feeds', 'oskell drift'],
				['oskell drift', 'feeds', 'pellam ridge'],
				['pellam ridge', 'feeds', 'tunley brook'],
			],
		}),
		memory({
			facts: [
				['wystan quay', 'holds', 'oskell drift'],
				['oskell drift', 'holds', 'sable rook'],
			],
		}),
	];
}

/** Two names in two components, each with its own neighbours — the common case for a pin. */
function twoIslandsVault() {
	return [
		memory({ facts: [['fennick tide', 'feeds', 'oskell drift'], ['oskell drift', 'holds', 'sable rook']] }),
		memory({ facts: [['pellam ridge', 'feeds', 'tunley brook'], ['pellam ridge', 'holds', 'wystan quay']] }),
	];
}

/** Two names that share a neighbour without being joined to each other. */
function sharedNeighbourVault() {
	return [
		memory({ facts: [['oskell drift', 'feeds', 'carrow moss'], ['oskell drift', 'holds', 'sable rook']] }),
		memory({ facts: [['pellam ridge', 'feeds', 'carrow moss'], ['pellam ridge', 'holds', 'tunley brook']] }),
	];
}

/** A hub with `spokes` neighbours, so the cap has something to fire on. */
function starVault(spokes, { inward = false } = {}) {
	const facts = [];
	for (let index = 0; index < spokes; index += 1) {
		facts.push(
			inward
				? [`fennick lane ${index}`, 'feeds', 'oskell drift']
				: ['oskell drift', 'feeds', `fennick lane ${index}`],
		);
	}
	return [memory({ facts })];
}

/**
 * Four kinds, deliberately unequal in volume, plus endpoints nobody declared.
 *
 * `moss` is on four fact ends, `brindle` on three, `quartz` on two, `slate` on one, and two names
 * are declared as nothing. The schema list handed in below names `moss`, `brindle` and `stone` —
 * so `quartz` and `slate` are a writer's, and `stone` is named and unused.
 */
function kindedVault() {
	return [
		memory({
			declares: [
				['oskell drift', 'moss'],
				['pellam ridge', 'brindle'],
				['carrow moss', 'quartz'],
				['sable rook', 'slate'],
			],
			facts: [
				['oskell drift', 'feeds', 'pellam ridge'], // moss → brindle
				['oskell drift', 'feeds', 'carrow moss'], // moss → quartz
				['pellam ridge', 'holds', 'oskell drift'], // brindle → moss
				['sable rook', 'holds', 'oskell drift'], // slate → moss
				['pellam ridge', 'feeds', 'tunley brook'], // brindle → (undeclared)
				['wystan quay', 'feeds', 'carrow moss'], // (undeclared) → quartz
				['wystan quay', 'holds', 'tunley brook'], // (undeclared) → (undeclared)
			],
		}),
	];
}

const SCHEMA = ['moss', 'brindle', 'stone'];

const ids = (elements) => elements.nodes.map((node) => node.id).sort();

// ------------------------------------------------------------------------------------------------
// the direction dial
// ------------------------------------------------------------------------------------------------

test('the dial offers exactly the directions the walk knows, and the default is both ways', () => {
	assert.deepEqual(
		EGO_DIRECTIONS.map((entry) => entry.id).sort(),
		['all', 'in', 'out'],
		'the three positions of the dial',
	);
	assert.equal(DEFAULT_DIRECTION, 'all');
	// Every id has a label a person can read, and no two share one.
	assert.equal(new Set(EGO_DIRECTIONS.map((entry) => entry.label)).size, EGO_DIRECTIONS.length);
	for (const entry of EGO_DIRECTIONS) assert.ok(entry.label.length > 0);
});

test('at one step, "from it" reaches the objects, "to it" the subjects, and "both ways" all four', () => {
	const graph = buildGraph(directedVault());

	const out = egoElements(graph, 'oskell drift', { depth: 1, direction: 'out' });
	assert.deepEqual(ids(out), ['oskell drift', 'pellam ridge', 'sable rook']);

	const inward = egoElements(graph, 'oskell drift', { depth: 1, direction: 'in' });
	assert.deepEqual(ids(inward), ['carrow moss', 'oskell drift', 'wystan quay']);

	const all = egoElements(graph, 'oskell drift', { depth: 1, direction: 'all' });
	assert.deepEqual(ids(all), ['carrow moss', 'oskell drift', 'pellam ridge', 'sable rook', 'wystan quay']);

	// The default is both ways, and it is what the dial-less call always drew.
	assert.deepEqual(ids(egoElements(graph, 'oskell drift', { depth: 1 })), ids(all));
	assert.equal(all.direction, 'all');
	assert.equal(out.direction, 'out');
});

test('the dial is followed at every step, not only the first', () => {
	const graph = buildGraph(directedVault());

	// Out: oskell drift → pellam ridge → tunley brook. Two steps out reaches the far end and
	// never turns round to collect carrow moss, which points in.
	const out = egoElements(graph, 'oskell drift', { depth: 2, direction: 'out' });
	assert.deepEqual(ids(out), ['oskell drift', 'pellam ridge', 'sable rook', 'tunley brook']);
	assert.equal(out.reachedDepth, 2);

	// In: nothing points at carrow moss or wystan quay, so two steps in is the same as one.
	const inward = egoElements(graph, 'oskell drift', { depth: 2, direction: 'in' });
	assert.deepEqual(ids(inward), ['carrow moss', 'oskell drift', 'wystan quay']);
	assert.equal(inward.reachedDepth, 1, 'the second ring was empty, so the depth reached is one');
});

test('the dial decides what is REACHED; between two drawn names every statement is drawn', () => {
	// A pair of names joined in both directions. Following "from it" reaches the other name
	// through one statement — and the statement pointing back must still be drawn, because a
	// canvas showing two names with a line missing says "not connected", which the export denies.
	const graph = buildGraph([
		memory({ facts: [['oskell drift', 'feeds', 'pellam ridge'], ['pellam ridge', 'holds', 'oskell drift']] }),
	]);
	const out = egoElements(graph, 'oskell drift', { depth: 1, direction: 'out' });
	assert.deepEqual(ids(out), ['oskell drift', 'pellam ridge']);
	assert.equal(out.edges.length, 2, 'both statements between the two drawn names are drawn');

	// And never one the export does not contain, in any direction.
	const real = new Set(graph.edges.map((edge) => `${edge.source}\u0000${edge.target}`));
	for (const direction of EGO_DIRECTIONS.map((entry) => entry.id)) {
		const ego = egoElements(buildGraph(directedVault()), 'oskell drift', { depth: 3, direction });
		for (const edge of ego.edges) {
			assert.ok(
				buildGraph(directedVault()).edges.some((known) => known.source === edge.source && known.target === edge.target) ||
					real.has(`${edge.source}\u0000${edge.target}`),
				`the drawing invented ${edge.source} → ${edge.target} following ${direction}`,
			);
		}
	}
});

test('a direction the walk does not know is refused, not drawn as both ways', () => {
	const graph = buildGraph(directedVault());
	assert.throws(
		() => egoElements(graph, 'oskell drift', { depth: 1, direction: 'sideways' }),
		/sideways/,
		'an unknown position must go red: a dial that silently draws "both ways" in an unknown position looks exactly like one that works',
	);
});

test('the cap refuses a ring counted along the dial', () => {
	const spokes = EGO_CAP + 5;

	// Every spoke points AT the hub. Following "from it" there is nothing to draw and nothing to
	// refuse; following "to it" the whole ring crosses the cap and is refused entire.
	const graph = buildGraph(starVault(spokes, { inward: true }));
	const out = egoElements(graph, 'oskell drift', { depth: 1, direction: 'out' });
	assert.equal(out.capped, false);
	assert.equal(out.nodes.length, 1);
	assert.equal(out.hidden, 0);

	const inward = egoElements(graph, 'oskell drift', { depth: 1, direction: 'in' });
	assert.equal(inward.capped, true);
	assert.equal(inward.hidden, spokes, 'the refused ring is reported at its real size');
	assert.equal(inward.nodes.length, 1);
});

// ------------------------------------------------------------------------------------------------
// what lies beyond a drawn name
// ------------------------------------------------------------------------------------------------

test('every drawn name carries the exact count of what one more step through it would add', () => {
	const graph = buildGraph(directedVault());
	const one = egoElements(graph, 'oskell drift', { depth: 1 });
	const beyond = new Map(one.nodes.map((node) => [node.id, node.beyond]));

	// pellam ridge has tunley brook past it; nothing else on the ring has anything past it, and
	// the centre's whole ring is drawn.
	assert.equal(beyond.get('pellam ridge'), 1);
	assert.equal(beyond.get('carrow moss'), 0);
	assert.equal(beyond.get('wystan quay'), 0);
	assert.equal(beyond.get('sable rook'), 0);
	assert.equal(beyond.get('oskell drift'), 0);

	// THE PROMISE IS CHECKED AGAINST THE WALK THAT WOULD KEEP IT. For every name on the outer
	// ring, one more step through it adds exactly `beyond` names — which is what the number on
	// the node tells a reader they would get by opening it.
	for (const node of one.nodes.filter((entry) => entry.depth === 1)) {
		const through = egoElements(graph, node.id, { depth: 1 });
		const added = through.nodes.filter((entry) => !one.nodes.some((drawn) => drawn.id === entry.id));
		assert.equal(added.length, node.beyond, `the count on ${node.id} is not what opening it adds`);
	}

	// And at two steps the far end is drawn, so nothing is beyond pellam ridge any more.
	const two = egoElements(graph, 'oskell drift', { depth: 2 });
	assert.equal(two.nodes.find((node) => node.id === 'pellam ridge').beyond, 0);
	assert.equal(two.nodes.find((node) => node.id === 'tunley brook').beyond, 0);
});

test('the count beyond a name follows the dial', () => {
	const graph = buildGraph(directedVault());

	// Following "to it" from oskell drift, carrow moss is on the ring; nothing points at it, so
	// nothing lies beyond it in that direction. Following "both ways" from carrow moss's own
	// position there is still nothing past it — it is a leaf either way. pellam ridge is the one
	// that differs: following "from it" it has tunley brook beyond; following "to it" it is not
	// reached at all.
	const out = egoElements(graph, 'oskell drift', { depth: 1, direction: 'out' });
	assert.equal(out.nodes.find((node) => node.id === 'pellam ridge').beyond, 1);

	const inward = egoElements(graph, 'oskell drift', { depth: 1, direction: 'in' });
	assert.equal(inward.nodes.some((node) => node.id === 'pellam ridge'), false);
	assert.equal(inward.nodes.find((node) => node.id === 'carrow moss').beyond, 0);

	// When the cap refuses the ring, the centre's own count is the refused ring: the same number
	// the note under the drawing quotes, on the node itself.
	const star = buildGraph(starVault(EGO_CAP + 5));
	const refused = egoElements(star, 'oskell drift', { depth: 1, direction: 'out' });
	assert.equal(refused.capped, true);
	assert.equal(refused.nodes[0].beyond, refused.hidden);
});

// ------------------------------------------------------------------------------------------------
// the pin
// ------------------------------------------------------------------------------------------------

test('a pinned name in another component is drawn beside this one, each around its own centre', () => {
	const graph = buildGraph(twoIslandsVault());
	const palette = kindPalette(graph);
	const ego = egoWithPin(graph, 'oskell drift', 'pellam ridge', { depth: 1, palette });

	assert.deepEqual(ego.centres, ['oskell drift', 'pellam ridge']);
	assert.deepEqual(ids(ego), ['fennick tide', 'oskell drift', 'pellam ridge', 'sable rook', 'tunley brook', 'wystan quay']);
	assert.deepEqual(ego.pinned, { surface: 'pellam ridge', found: true, reachedDepth: 1, capped: false, hidden: 0 });
	assert.deepEqual(ego.shared, [], 'two islands share nothing');

	// The union is exactly the two neighbourhoods and nothing between them was invented.
	const alone = egoElements(graph, 'oskell drift', { depth: 1, palette });
	const other = egoElements(graph, 'pellam ridge', { depth: 1, palette });
	assert.deepEqual(ids(ego), [...new Set([...ids(alone), ...ids(other)])].sort());
	assert.equal(ego.edges.length, alone.edges.length + other.edges.length);

	// And the layout puts BOTH at the centre of a component — depth 0 each — which is what makes
	// the picture two neighbourhoods side by side rather than one neighbourhood and a stray.
	const placed = layout(ego.nodes, ego.edges, ego.centres);
	assert.equal(placed.get('oskell drift').depth, 0);
	assert.equal(placed.get('pellam ridge').depth, 0);
	assert.notEqual(placed.get('oskell drift').x, placed.get('pellam ridge').x, 'the two centres are apart');
	for (const node of ego.nodes) {
		if (ego.centres.includes(node.id)) continue;
		assert.ok(placed.get(node.id).depth > 0, `${node.id} is not a centre and must sit on a ring`);
	}
});

test('the names joined to both are reported, most connected first, and ringed in the drawing', () => {
	const graph = buildGraph(sharedNeighbourVault());
	const ego = egoWithPin(graph, 'oskell drift', 'pellam ridge', { depth: 1 });

	assert.deepEqual(
		ego.shared.map((entry) => entry.id),
		['carrow moss'],
		'the one name both are joined to, and neither centre among them',
	);
	assert.equal(ego.shared[0].degree, graph.nodes.get('carrow moss').degree);

	// A shared neighbour joins the two neighbourhoods into one drawn component. The layout centres
	// it on the FOCUS and the pin sits on a ring — the drawing marks it as the pin regardless.
	const placed = layout(ego.nodes, ego.edges, ego.centres);
	assert.equal(placed.get('oskell drift').depth, 0);
	assert.ok(placed.get('pellam ridge').depth > 0);

	// "What lies beyond" is recomputed over the union: from oskell drift alone, carrow moss has
	// pellam ridge beyond it; with pellam ridge pinned, it does not.
	const alone = egoElements(graph, 'oskell drift', { depth: 1 });
	assert.equal(alone.nodes.find((node) => node.id === 'carrow moss').beyond, 1);
	assert.equal(ego.nodes.find((node) => node.id === 'carrow moss').beyond, 0);
});

test('pinning this name, or a name the vault does not hold, draws nothing extra and says which', () => {
	const graph = buildGraph(twoIslandsVault());
	const alone = egoElements(graph, 'oskell drift', { depth: 1 });

	const self = egoWithPin(graph, 'oskell drift', 'oskell drift', { depth: 1 });
	assert.equal(self.pinned, null, 'pinning the name on screen adds nothing to the canvas');
	assert.deepEqual(ids(self), ids(alone));
	assert.deepEqual(self.centres, ['oskell drift']);

	const none = egoWithPin(graph, 'oskell drift', null, { depth: 1 });
	assert.equal(none.pinned, null);
	assert.deepEqual(ids(none), ids(alone));

	// A pin that no longer resolves is REPORTED, not silently dropped: the chip in the bar still
	// names it, and the canvas says why only one name is drawn.
	const gone = egoWithPin(graph, 'oskell drift', 'a name nobody uses', { depth: 1 });
	assert.equal(gone.pinned.found, false);
	assert.equal(gone.pinned.surface, 'a name nobody uses');
	assert.deepEqual(ids(gone), ids(alone));
	assert.deepEqual(gone.shared, []);
});

test('the pin walks under the same dial and the same cap as the focus', () => {
	const graph = buildGraph([...directedVault(), ...starVault(EGO_CAP + 5).map((record) => record)]);
	// starVault reuses `oskell drift` as its hub, so the star and the chain are one vault around
	// one name — pin a name from the chain's far end and follow "to it".
	const ego = egoWithPin(graph, 'tunley brook', 'oskell drift', { depth: 1, direction: 'in' });
	assert.equal(ego.direction, 'in');
	// tunley brook's inward ring is pellam ridge alone.
	assert.ok(ego.nodes.some((node) => node.id === 'pellam ridge'));
	// oskell drift's inward ring is carrow moss and wystan quay — the star points OUT, so it is
	// not reached and not refused.
	assert.equal(ego.pinned.capped, false);
	assert.ok(ego.nodes.some((node) => node.id === 'carrow moss'));
	assert.equal(ego.nodes.some((node) => node.id === 'fennick lane 0'), false);

	// The other way, the pin's ring is the star and is refused entire.
	const out = egoWithPin(graph, 'tunley brook', 'oskell drift', { depth: 1, direction: 'out' });
	assert.equal(out.pinned.capped, true);
	assert.equal(out.pinned.hidden, EGO_CAP + 5 + 2, 'the refused ring is the star plus the two chain objects');
	assert.equal(out.nodes.some((node) => node.id === 'fennick lane 0'), false);
});

test('the layout centres a component on the first centre it holds and falls back to degree', () => {
	const graph = buildGraph(twoIslandsVault());
	const ego = egoWithPin(graph, 'oskell drift', 'pellam ridge', { depth: 1 });

	// With no centre named at all, each island is centred on its busiest name — which here IS the
	// name the walk started from, because the leaves have degree one.
	const unnamed = layout(ego.nodes, ego.edges, null);
	assert.equal(unnamed.get('oskell drift').depth, 0);
	assert.equal(unnamed.get('pellam ridge').depth, 0);

	// The old one-centre call shape still works: a string is one centre.
	const one = layout(ego.nodes, ego.edges, 'oskell drift');
	assert.equal(one.get('oskell drift').depth, 0);

	// Deterministic: the same elements place identically twice.
	const again = layout(ego.nodes, ego.edges, ego.centres);
	const first = layout(ego.nodes, ego.edges, ego.centres);
	for (const [id, point] of first) {
		assert.equal(again.get(id).x, point.x, `${id} moved between two layouts of one drawing`);
		assert.equal(again.get(id).y, point.y);
	}
});

// ------------------------------------------------------------------------------------------------
// the route carries the pin
// ------------------------------------------------------------------------------------------------

test('the pin rides in the route verbatim, and a plain route has none', () => {
	const awkward = [
		'oskell drift',
		'the pellam ridge?',
		'carrow&moss',
		'a 100% sable',
		'tunley+brook',
		'wystan#quay',
		'src/harness/fennick.mjs',
	];
	for (const surface of awkward) {
		for (const pinned of awkward) {
			const route = nameRoute(surface, { pinned });
			assert.equal(surfaceFromRoute(route), surface, `surface through ${route}`);
			assert.equal(pinnedFromRoute(route), pinned, `pin through ${route}`);
		}
		// No pin: the route is exactly what it was before the pin existed.
		assert.equal(nameRoute(surface), `#/names/${encodeURIComponent(surface)}`);
		assert.equal(pinnedFromRoute(nameRoute(surface)), null);
		assert.equal(surfaceFromRoute(nameRoute(surface)), surface);
	}

	// Pinning the name on screen is still written down — it has to survive the next navigation.
	assert.equal(pinnedFromRoute(nameRoute('oskell drift', { pinned: 'oskell drift' })), 'oskell drift');
	// And nothing else in the query is mistaken for a pin.
	assert.equal(pinnedFromRoute('#/names/oskell%20drift?other=1'), null);
	assert.equal(pinnedFromRoute('#/names'), null);
	assert.equal(pinnedFromRoute('#/'), null);
});

// ------------------------------------------------------------------------------------------------
// the kind × kind matrix
// ------------------------------------------------------------------------------------------------

test('the matrix counts statements between kinds, keeps the undeclared as a row, and orders by volume', () => {
	const graph = buildGraph(kindedVault());
	const matrix = kindMatrix(graph, { schemaKinds: SCHEMA });

	assert.equal(matrix.factCount, 7);
	assert.deepEqual(KIND_GROUPS, ['schema', 'beyond', 'undeclared']);

	// Schema kinds first by volume, then a writer's by volume, then the undeclared bucket.
	assert.deepEqual(
		matrix.kinds.map((entry) => [entry.kind, entry.group, entry.total]),
		[
			['moss', 'schema', 4],
			['brindle', 'schema', 3],
			['quartz', 'beyond', 2],
			['slate', 'beyond', 1],
			[null, 'undeclared', 4],
		],
	);
	assert.deepEqual(matrix.groups, { schema: 2, beyond: 2, undeclared: 1 });
	assert.equal(matrix.schemaKnown, true);
	assert.deepEqual(matrix.schemaUnused, ['stone'], 'a schema kind nothing here uses is reported, not drawn');
	assert.equal(matrix.undeclaredEndpoints, 4);

	const at = (from, to) => {
		const row = matrix.kinds.findIndex((entry) => entry.kind === from);
		const column = matrix.kinds.findIndex((entry) => entry.kind === to);
		return matrix.counts[row][column];
	};
	assert.equal(at('moss', 'brindle'), 1);
	assert.equal(at('brindle', 'moss'), 1, 'direction matters: subject down, object across');
	assert.equal(at('moss', 'quartz'), 1);
	assert.equal(at('slate', 'moss'), 1);
	assert.equal(at('brindle', null), 1);
	assert.equal(at(null, 'quartz'), 1);
	assert.equal(at(null, null), 1);
	assert.equal(at('moss', 'moss'), 0);
	assert.equal(at('quartz', 'moss'), 0);

	// Every statement lands in exactly one cell.
	const summed = matrix.counts.flat().reduce((total, count) => total + count, 0);
	assert.equal(summed, matrix.factCount);
	assert.equal(matrix.max, 1);

	// Rows and columns are the same list in the same order, so the picture is square.
	assert.equal(matrix.counts.length, matrix.kinds.length);
	for (const row of matrix.counts) assert.equal(row.length, matrix.kinds.length);
});

test('without the schema list, nothing is marked as in or beyond it — and the reading says so', () => {
	const graph = buildGraph(kindedVault());
	const matrix = kindMatrix(graph, { schemaKinds: null });

	assert.equal(matrix.schemaKnown, false);
	assert.equal(matrix.groups.schema, 0, 'no kind may be claimed as the schema’s from a list this repository did not read');
	assert.equal(matrix.groups.beyond, 4);
	assert.deepEqual(matrix.schemaUnused, []);
	// Still ordered by volume inside the one group.
	assert.deepEqual(
		matrix.kinds.map((entry) => entry.kind),
		['moss', 'brindle', 'quartz', 'slate', null],
	);
	assert.match(kindMatrixReading(matrix), /contract was not read/);
	assert.doesNotMatch(kindMatrixReading(matrix), /schema names/);
});

test('the reading under the matrix quotes the numbers the matrix holds', () => {
	const graph = buildGraph(kindedVault());
	const reading = kindMatrixReading(kindMatrix(graph, { schemaKinds: SCHEMA }));

	assert.match(reading, /4 kinds are in use across 7 statements/);
	assert.match(reading, /schema names 2 of them/);
	assert.match(reading, /other 2 kinds were introduced/);
	assert.match(reading, /1 kind the schema names is not used here/);
	assert.match(reading, /4 fact ends name something no memory declared/);

	// And it is built from the matrix, so a different partition is a different sentence.
	const everything = kindMatrixReading(kindMatrix(graph, { schemaKinds: ['moss', 'brindle', 'quartz', 'slate'] }));
	assert.match(everything, /schema names 4 of them/);
	assert.doesNotMatch(everything, /introduced/);
});

test('a cell’s shade is a single hue from empty to fullest, monotone in the count', () => {
	assert.equal(cellShade(0, 10), 0);
	assert.equal(cellShade(10, 10), 1);
	assert.equal(cellShade(3, 0), 0, 'an empty matrix has no fullest cell to be a fraction of');
	let last = 0;
	for (let count = 1; count <= 200; count += 1) {
		const shade = cellShade(count, 200);
		assert.ok(shade > 0 && shade <= 1, `shade ${shade} for ${count} is off the scale`);
		assert.ok(shade > last, `the shade must rise with the count; ${count} did not`);
		last = shade;
	}
	// Logarithmic on purpose: three against two hundred is still visibly not one.
	assert.ok(cellShade(3, 200) - cellShade(1, 200) > 0.1);
});

test('the matrix is a function of the graph: two builds give one picture', () => {
	const first = kindMatrix(buildGraph(kindedVault()), { schemaKinds: SCHEMA });
	const second = kindMatrix(buildGraph(kindedVault()), { schemaKinds: [...SCHEMA].reverse() });
	assert.deepEqual(first.kinds, second.kinds, 'the order of the schema list must not change the picture');
	assert.deepEqual(first.counts, second.counts);
});

// ------------------------------------------------------------------------------------------------
// the source
// ------------------------------------------------------------------------------------------------

test('the new models are pure, and the new screens reach nothing', () => {
	// Arithmetic over the payload already in the browser. No React, no DOM, no request, no door.
	for (const file of ['kind-matrix.mjs', 'names-model.mjs', join('ui', 'ego-layout.mjs')]) {
		const source = readFileSync(join(APP, file), 'utf8');
		assert.doesNotMatch(source, /from 'react'/, `${file} imports React`);
		assert.doesNotMatch(source, /\bdocument\.|\bwindow\./, `${file} reaches the DOM`);
		assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} issues a request`);
	}
	for (const file of ['KindMatrix.jsx', 'NameFocus.jsx', 'NamesView.jsx', join('ui', 'ego-graph.jsx')]) {
		const source = readFileSync(join(APP, file), 'utf8');
		assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} issues a request`);
		assert.doesNotMatch(source, /from '\.\/api\.mjs'|from '\.\.\/api\.mjs'/, `${file} imports the door to the sidecar`);
		assert.doesNotMatch(source, /askRanked/, `${file} names the ranked door`);
	}

	// The matrix partitions against a list it is HANDED, never one it holds. A literal array of
	// short lowercase words in the model would be the transcription this repository forbids. The
	// one such array the model does hold is its own three group names — schema, beyond, undeclared
	// — which are this app's words for the sides of the rule and not anything read from an engine;
	// that line is set aside so the check reads everything else.
	const model = readFileSync(join(APP, 'kind-matrix.mjs'), 'utf8').replace(/export const KIND_GROUPS[^\n]*\n/, '');
	assert.doesNotMatch(
		model,
		/\[\s*'[a-z]+'\s*(?:,\s*'[a-z]+'\s*){2,}\]/,
		'kind-matrix.mjs carries a written-down list of kind-shaped words',
	);
	assert.match(
		readFileSync(join(APP, 'kind-matrix.mjs'), 'utf8'),
		/export const KIND_GROUPS/,
		'the line set aside above no longer exists, so the check is reading nothing it meant to skip',
	);
	const view = readFileSync(join(APP, 'KindMatrix.jsx'), 'utf8');
	assert.doesNotMatch(view, /#[0-9a-f]{6}\b/i, 'the matrix names a colour instead of mixing two tokens');
});
