// The whole-vault overview at density: the island a name lives on, the hue a pair shares, and the
// field the one-fact islands make.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS FOR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The overview was kept by owner decision as an overview and a diagnostic, and at fourteen hundred
// names its failure was exact: a search lit three rings in a field of confetti, eighteen dashed
// lines in one colour crossed the canvas with no way to match their ends, and two hundred two-name
// islands drew at the same weight as the one region with a shape. Three properties fix that, and
// each one is arithmetic this file can hold to its claim:
//
//   1. A selection or a query resolves to ISLANDS — the components the names live on — and a query
//      that spans more islands than the picture lights at once says how many it chose.
//   2. Every duplicate group takes one hue, the dashed line and both its ends share it, and two
//      groups on one canvas do not share one while there are hues to go round.
//   3. A one-fact island is packed tighter than anything with a shape, so the field it makes is
//      calm, and the layout still places every name once and in the same spot twice.
//
// EVERY SURFACE, KIND AND RELATION NAME BELOW IS INVENTED.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGraph, kindPalette, nearDuplicates } from '../src/app/graph-model.mjs';
import {
	DUPLICATE_HUES,
	FOCUS_ISLANDS,
	highlightSet,
	nameRows,
	overviewElements,
	overviewFocus,
} from '../src/app/names-model.mjs';
import { overviewLayout } from '../src/app/overview-layout.mjs';
import { workingVault } from './helpers/synthetic.mjs';

// ------------------------------------------------------------------------------------------------
// fixtures
// ------------------------------------------------------------------------------------------------

const memory = ({ id, facts, declares = [] }) => ({
	memory_id: id,
	version_id: `v-${id}`,
	semantic: {
		memory_id: id,
		title: `memory ${id}`,
		memory_type: 'ledger_note',
		created_on: '2026-05-04T09:00:00Z',
		entities: declares.map(([n, kind]) => ({ n, kind, is: `a ${kind}` })),
		facts: facts.map(([subject, predicate, object]) => ({ subject, predicate, object })),
	},
});

/** Three islands of one fact each, one triangle, and three planted pairs of spellings. */
function plantedVault() {
	return [
		memory({ id: 'm1', facts: [['vandrel beacon', 'girds', 'pell gate']] }),
		memory({ id: 'm2', facts: [['Vandrel-Beacon', 'moors_at', 'harrow lantern']] }),
		memory({ id: 'm3', facts: [['quorix reading', 'annotates', 'mirdel trellis']] }),
		memory({ id: 'm4', facts: [['the quorix reading', 'kindles', 'orrery mast']] }),
		memory({ id: 'm5', facts: [['cistern ledger', 'shadows', 'cistern ledgers']] }),
		memory({
			id: 'm6',
			facts: [
				['ferry pylon', 'buttresses', 'anthem quarry'],
				['anthem quarry', 'threads_through', 'lantern cove'],
				['lantern cove', 'overtakes', 'ferry pylon'],
			],
		}),
	];
}

// ------------------------------------------------------------------------------------------------
// 1. the island, not the dot
// ------------------------------------------------------------------------------------------------

test('a selected name resolves to its island, and the selection wins over the query', () => {
	const graph = buildGraph(plantedVault());
	const elements = overviewElements(graph, { palette: kindPalette(graph) });
	const rows = nameRows(graph);

	const focus = overviewFocus(elements.nodes, { selected: 'anthem quarry', matches: highlightSet(rows, 'beacon') });
	assert.equal(focus.reason, 'selected');
	assert.equal(focus.islands, 1);
	assert.equal(focus.shown, 1);
	assert.deepEqual([...focus.marked], ['anthem quarry']);
	const triangle = elements.nodes.find((node) => node.id === 'anthem quarry').componentId;
	assert.deepEqual([...focus.components], [triangle]);
	// The island is the whole triangle: every name on it is in the lit component.
	for (const id of ['ferry pylon', 'anthem quarry', 'lantern cove']) {
		assert.equal(elements.nodes.find((node) => node.id === id).componentId, triangle);
	}
});

test('a query lights the islands its matches live on, and says how many there were', () => {
	const graph = buildGraph(plantedVault());
	const elements = overviewElements(graph, { palette: kindPalette(graph) });
	const rows = nameRows(graph);

	// "beacon" matches two spellings on two different islands.
	const two = overviewFocus(elements.nodes, { matches: highlightSet(rows, 'beacon') });
	assert.equal(two.reason, 'query');
	assert.equal(two.marked.size, 2);
	assert.equal(two.islands, 2);
	assert.equal(two.shown, 2);
	assert.equal(two.components.size, 2);

	// No query is no focus — the whole vault, undimmed — which is not the same as a query that
	// matched nothing, which is a focus on no islands at all.
	assert.equal(overviewFocus(elements.nodes, { matches: null }), null);
	const nothing = overviewFocus(elements.nodes, { matches: highlightSet(rows, 'zzqx') });
	assert.equal(nothing.marked.size, 0);
	assert.equal(nothing.islands, 0);
	assert.equal(nothing.components.size, 0);
});

test('a query across more islands than the picture lights at once keeps the busiest, and counts the rest', () => {
	const graph = buildGraph(workingVault({ seed: 11, memories: 200 }).records);
	const elements = overviewElements(graph, { palette: kindPalette(graph) });
	const rows = nameRows(graph);

	// A single letter matches names on many islands.
	const matches = highlightSet(rows, 'a');
	const focus = overviewFocus(elements.nodes, { matches });
	assert.ok(focus.islands > FOCUS_ISLANDS, `the fixture must put matches on more than ${FOCUS_ISLANDS} islands`);
	assert.equal(focus.shown, FOCUS_ISLANDS);
	assert.equal(focus.components.size, FOCUS_ISLANDS);
	assert.equal(focus.marked.size, matches.size, 'every match stays marked, lit island or not');

	// The lit islands are those of the most connected matches, so the picture opens on the part
	// of the vault the query most plausibly meant.
	const byId = new Map(elements.nodes.map((node) => [node.id, node]));
	const ordered = [...matches].map((id) => byId.get(id)).sort((a, b) => b.degree - a.degree);
	assert.ok(focus.components.has(ordered[0].componentId));
});

test('islands that together span most of the picture are dropped, least connected first, until the view can go somewhere', () => {
	const graph = buildGraph(plantedVault());
	const elements = overviewElements(graph, { palette: kindPalette(graph) });
	const rows = nameRows(graph);
	const matches = highlightSet(rows, 'beacon');
	const byId = new Map(elements.nodes.map((node) => [node.id, node]));
	const [first, second] = [...matches].map((id) => byId.get(id)).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));

	// Two islands at opposite corners of a wide picture: lighting both is lighting the whole canvas.
	const apart = {
		bounds: { x: 0, y: 0, width: 1000, height: 400 },
		components: [
			{ id: first.componentId, x: 50, y: 50, radius: 30 },
			{ id: second.componentId, x: 950, y: 350, radius: 30 },
		],
	};
	const narrowed = overviewFocus(elements.nodes, { matches, placement: apart });
	assert.equal(narrowed.islands, 2, 'both islands are still counted');
	assert.equal(narrowed.shown, 1, 'only one is lit');
	assert.deepEqual([...narrowed.components], [first.componentId], 'the one kept is the most connected match’s');
	assert.equal(narrowed.marked.size, 2, 'the match on the dropped island stays marked');

	// The same two islands side by side: both fit in one view, so both are lit.
	const together = {
		bounds: { x: 0, y: 0, width: 1000, height: 400 },
		components: [
			{ id: first.componentId, x: 50, y: 50, radius: 30 },
			{ id: second.componentId, x: 150, y: 50, radius: 30 },
		],
	};
	const both = overviewFocus(elements.nodes, { matches, placement: together });
	assert.equal(both.shown, 2);
});

// ------------------------------------------------------------------------------------------------
// 2. one hue per pair
// ------------------------------------------------------------------------------------------------

test('a duplicate group takes one hue, its dashed line and both ends share it, and groups differ', () => {
	const graph = buildGraph(plantedVault());
	const duplicates = nearDuplicates(graph);
	const elements = overviewElements(graph, { palette: kindPalette(graph), duplicates });

	assert.ok(elements.duplicateLinks.length >= 3, 'three pairs were planted');
	const byId = new Map(elements.nodes.map((node) => [node.id, node]));
	for (const link of elements.duplicateLinks) {
		assert.ok(Number.isInteger(link.hue) && link.hue >= 0 && link.hue < DUPLICATE_HUES, `link ${link.id} has no hue`);
		assert.equal(byId.get(link.source).duplicateHue, link.hue, `${link.source} does not wear its pair's hue`);
		assert.equal(byId.get(link.target).duplicateHue, link.hue, `${link.target} does not wear its pair's hue`);
	}
	const hues = new Set(elements.duplicateLinks.map((link) => link.hue));
	assert.equal(hues.size, elements.duplicateLinks.length, 'with hues to spare, no two pairs share one');

	// A name in no group wears none.
	assert.equal(byId.get('ferry pylon').duplicateHue, null);
	assert.equal(byId.get('ferry pylon').duplicate, false);
});

// ------------------------------------------------------------------------------------------------
// 3. the field the islands make
// ------------------------------------------------------------------------------------------------

test('a one-fact island is packed tighter than anything with a shape, and every name is still placed', () => {
	const graph = buildGraph(plantedVault());
	const elements = overviewElements(graph, { palette: kindPalette(graph) });
	const placed = overviewLayout(elements.nodes, elements.edges);
	assert.equal(placed.positions.size, elements.nodes.length);

	const distance = (a, b) => {
		const p = placed.positions.get(a);
		const q = placed.positions.get(b);
		return Math.hypot(p.x - q.x, p.y - q.y);
	};
	const island = distance('vandrel beacon', 'pell gate');
	const shaped = distance('ferry pylon', 'anthem quarry');
	assert.ok(island < shaped, `an island's one statement (${island.toFixed(1)}) should be shorter than a triangle's (${shaped.toFixed(1)})`);

	// And the islands sit closer to each other than the shaped components do, which is what makes
	// two hundred of them a field rather than a scatter.
	const boxes = new Map(placed.components.map((box) => [box.id, box]));
	const boxOf = (id) => boxes.get(elements.nodes.find((node) => node.id === id).componentId);
	const islandBox = boxOf('vandrel beacon');
	const triangleBox = boxOf('ferry pylon');
	assert.ok(islandBox.radius < triangleBox.radius);

	// Twice, identically: the picture is a diagnostic, and a diagnostic that moves is noise.
	const again = overviewLayout(elements.nodes, elements.edges);
	for (const node of elements.nodes) assert.deepEqual(again.positions.get(node.id), placed.positions.get(node.id));
});
