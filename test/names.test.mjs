// The names screens: the table, the panel, the ego drawing and the whole-vault overview.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS FOR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Four properties, and each one is a thing that would otherwise be a comment claiming itself:
//
//   1. **The two renderings are one world.** The find box narrows the table and lights the same
//      names in the picture. A second search inside the canvas would agree with the first until
//      one of them was edited, and nobody would notice which.
//
//   2. **A cap that fires is a cap that refuses a whole ring.** The ego drawing's node cap is a
//      promise about what a reader is looking at. A drawing that stopped part-way through a ring
//      looks exactly like a complete one, so the test plants a hub whose ring crosses the cap and
//      asserts both halves: nothing from that ring is drawn, and the count that is reported is the
//      real number and not an estimate.
//
//   3. **The overview's layout is deterministic and bounded.** It is a diagnostic. A diagnostic you
//      open fortnightly is only useful if the difference between two runs is the vault, so the same
//      elements must place identically — and it has to be affordable at the size a real vault is,
//      which is measured here rather than asserted.
//
//   4. **There is no path between two names, anywhere in the shipped source.** It is the feature
//      this design deliberately does not have, and "we decided not to build it" is a sentence that
//      survives exactly until somebody builds it. The check is over the source, so it fails on the
//      code rather than on the intention.
//
// EVERY SURFACE, KIND AND RELATION NAME BELOW IS INVENTED. This repository is public and the vault
// these screens were developed against is not. The scaled fixture comes from the synthetic
// generator, which is nonsense syllables by construction; the hand-built ones below are invented
// for the shape they need to have, and none of them was read from a vault.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildGraph, kindPalette, nearDuplicates } from '../src/app/graph-model.mjs';
import {
	ALWAYS_LABELLED,
	DEFAULT_ORDER,
	EGO_CAP,
	NAME_ORDERS,
	OVERVIEW_CEILING,
	duplicateIndex,
	duplicateNameCount,
	egoElements,
	highlightSet,
	nameReading,
	nameRoute,
	nameRows,
	orderCounts,
	orderedRows,
	overviewElements,
	surfaceFromRoute,
	vaultShape,
} from '../src/app/names-model.mjs';
import { hitIndex, overviewLayout } from '../src/app/overview-layout.mjs';
import { workingVault } from './helpers/synthetic.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'src', 'app');

// ------------------------------------------------------------------------------------------------
// fixtures — invented, and shaped for the property under test
// ------------------------------------------------------------------------------------------------

const memory = ({ id, title, type = 'decision', created_on = '2026-05-04T09:00:00Z', declares = [], facts = [] }) => ({
	memory_id: id,
	version_id: `v-${id}`,
	semantic: {
		memory_id: id,
		title,
		memory_type: type,
		created_on,
		entities: declares.map(([n, kind, is]) => ({ n, kind, is })),
		facts: facts.map(([subject, predicate, object]) => ({ subject, predicate, object })),
	},
});

/**
 * A small vault with one junction, one island, and one name spelled two ways.
 *
 * `vandrel beacon` and `Vandrel-Beacon` differ only in punctuation and case, which is the STRICT
 * near-duplicate rule — the one that earns a chip in the table — and they sit in two different
 * components, which is the case where merging them would join two islands rather than relabel one.
 */
function plantedVault() {
	return [
		memory({
			id: 'm-1',
			title: 'The quorix reading is keyed on the mirdel span',
			created_on: '2026-05-04T09:00:00Z',
			declares: [
				['quorix reading', 'trellis', 'the reading the harness takes each pass'],
				['mirdel span', 'trellis'],
			],
			facts: [
				['quorix reading', 'is keyed on', 'mirdel span'],
				['quorix reading', 'stopped using', 'vandrel beacon'],
				['quorix reading', 'powers', 'drenlow tally'],
			],
		}),
		memory({
			id: 'm-2',
			title: 'The drenlow tally is measured at the pell gate',
			created_on: '2026-05-06T09:00:00Z',
			declares: [['drenlow tally', 'gauge']],
			facts: [['drenlow tally', 'measured at', 'pell gate']],
		}),
		memory({
			id: 'm-3',
			title: 'The Vandrel-Beacon feeds the sorrel index',
			created_on: '2026-05-09T09:00:00Z',
			declares: [['Vandrel-Beacon', 'trellis']],
			facts: [
				['Vandrel-Beacon', 'feeds', 'sorrel index'],
				['Vandrel-Beacon', 'blocked by', 'harrow freeze'],
			],
		}),
	];
}

/**
 * The same vault, plus a pair only the LOOSER rule finds.
 *
 * `harrow freeze` and `the harrow freeze` differ by an article, which the strict rule (punctuation
 * and case) does not fold and the loose rule (articles, word order, a trailing plural) does. Having
 * one of each in one fixture is what makes the card-and-tab test a real check: with only strict
 * pairs both numbers agree by accident.
 */
function mixedVault() {
	return [
		...plantedVault(),
		memory({
			id: 'm-4',
			title: 'The harrow freeze holds the ombric wharf',
			created_on: '2026-05-11T09:00:00Z',
			declares: [['the harrow freeze', 'gauge']],
			facts: [['the harrow freeze', 'part of', 'ombric wharf']],
		}),
	];
}

/**
 * A vault the size and shape a real one of this kind is: about twelve hundred names over about a
 * thousand statements, in a few hundred components of which one is far larger than the rest, with
 * roughly three names in four appearing in exactly one statement.
 *
 * WHY IT IS BUILT HERE RATHER THAN TAKEN FROM THE SHARED GENERATOR. That generator draws from a
 * fixed pool of a few hundred surfaces, which is the right shape for the properties it was written
 * for and the wrong SIZE for this one — and the whole point of the measurement below is that it is
 * taken at the size the picture actually has to survive. The syllables are nonsense on purpose.
 *
 * Deterministic: one seeded generator, no `Math.random`, no clock. A fixture whose shape moved
 * between runs would turn the layout budget into a flake, and a flaky budget teaches a reader to
 * re-run rather than to look.
 */
function scaledVault() {
	// mulberry32. Eight lines, no state to reason about, same numbers on every machine forever.
	let state = 0x51ed270b;
	const random = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const HEADS = ['vandrel', 'quorix', 'mirdel', 'drenlow', 'pellin', 'sorrel', 'harrow', 'brannoch', 'thessel', 'ombric'];
	const TAILS = ['beacon', 'span', 'tally', 'gate', 'index', 'freeze', 'relay', 'lane', 'wharf', 'ledger'];
	const KINDS = ['trellis', 'gauge', 'wharfage', 'beaconry', 'sundry'];
	const LINKS = ['is keyed on', 'stopped using', 'powers', 'measured at', 'part of', 'blocked by', 'avoids'];

	let minted = 0;
	const mint = () => {
		const at = minted++;
		return `${HEADS[at % HEADS.length]} ${TAILS[Math.floor(at / HEADS.length) % TAILS.length]} ${at}`;
	};

	// The component size profile of a measured vault: one large region, a long tail of pairs.
	const sizes = [199, 39, 16, 16, 12, 12, 11, 10, 10];
	for (let i = 0; i < 25; i += 1) sizes.push(4 + (i % 5));
	for (let i = 0; i < 61; i += 1) sizes.push(3);
	for (let i = 0; i < 286; i += 1) sizes.push(2);

	const facts = [];
	for (const size of sizes) {
		const members = Array.from({ length: size }, mint);
		// A random tree: every node after the first attaches to one already placed, which is what
		// makes the component a tree — and a measured vault's components are trees to within a
		// handful of edges in the whole store.
		for (let index = 1; index < members.length; index += 1) {
			const parent = members[Math.floor(random() * index)];
			facts.push([parent, LINKS[Math.floor(random() * LINKS.length)], members[index]]);
		}
		// A few extra links inside the largest region only, because that is where the measured vault
		// has its cycles.
		if (size > 100) {
			for (let extra = 0; extra < 28; extra += 1) {
				const a = members[Math.floor(random() * members.length)];
				const b = members[Math.floor(random() * members.length)];
				if (a !== b) facts.push([a, LINKS[Math.floor(random() * LINKS.length)], b]);
			}
		}
	}

	const records = [];
	const perMemory = 3;
	for (let at = 0; at < facts.length; at += perMemory) {
		const slice = facts.slice(at, at + perMemory);
		const surfaces = [...new Set(slice.flatMap(([subject, , object]) => [subject, object]))];
		records.push(
			memory({
				id: `sc-${records.length}`,
				title: `A statement about ${surfaces[0]}`,
				created_on: new Date(Date.UTC(2026, 0, 1 + (records.length % 240))).toISOString(),
				declares: surfaces.map((surface) => [surface, KINDS[surface.length % KINDS.length]]),
				facts: slice,
			}),
		);
	}
	return records;
}

/** A hub with `spokes` neighbours, so the ego cap has something to fire on. */
function starVault(spokes) {
	const facts = [];
	const declares = [['brannoch relay', 'trellis']];
	for (let index = 0; index < spokes; index += 1) {
		facts.push(['brannoch relay', 'carries', `pellinor lane ${index}`]);
	}
	return [memory({ id: 'm-star', title: 'The brannoch relay carries a great many lanes', declares, facts })];
}

// ------------------------------------------------------------------------------------------------
// the four numbers, and the four orders
// ------------------------------------------------------------------------------------------------

test('the summary above the table is the graph’s own arithmetic and nothing else', () => {
	const graph = buildGraph(plantedVault());
	const shape = vaultShape(graph, nearDuplicates(graph));

	assert.equal(shape.nameCount, graph.nodes.size);
	assert.equal(shape.statementCount, graph.edges.length);
	assert.equal(shape.componentCount, graph.components.length);
	assert.equal(shape.largestComponent, graph.components[0].size);
	assert.equal(
		shape.namedOnce,
		[...graph.nodes.values()].filter((node) => node.degree === 1).length,
		'"named once and never again" must be the count of degree-1 names, not an approximation of it',
	);

	// The claim the fourth card makes rests on this: names join on exact spelling only, so a vault
	// with a strict near-duplicate in it IS more connected than the picture shows.
	assert.ok(shape.duplicateGroups >= 1, 'the fixture plants a near-duplicate and it must be found');
});

test('two of the four tabs are filters and their counts are computed before the find box', () => {
	const graph = buildGraph(plantedVault());
	const duplicates = nearDuplicates(graph);
	const rows = nameRows(graph, duplicates);
	const counts = orderCounts(rows);

	assert.equal(counts.connected, rows.length);
	assert.equal(counts.recent, rows.length);
	assert.equal(counts.once, rows.filter((row) => row.degree === 1).length);
	assert.equal(counts.duplicates, rows.filter((row) => row.alsoSpelled.length > 0).length);

	// A tab count that moved with the find box would tell the reader their vault had changed when
	// all that changed was what they typed.
	const narrowed = orderedRows(rows, { query: 'quorix', order: DEFAULT_ORDER });
	assert.ok(narrowed.length < rows.length, 'the query must actually narrow the fixture');
	assert.deepEqual(orderCounts(rows), counts);
});

test('every order is total, so the same vault lists the same way twice', () => {
	const graph = buildGraph(workingVault({ seed: 11, memories: 60 }).records);
	const rows = nameRows(graph, nearDuplicates(graph));

	for (const order of NAME_ORDERS) {
		const first = orderedRows([...rows], { order: order.id }).map((row) => row.surface);
		const second = orderedRows([...rows].reverse(), { order: order.id }).map((row) => row.surface);
		assert.deepEqual(
			second,
			first,
			`the ${order.id} order depends on the order the rows arrived in, so two loads of one vault ` +
				`would disagree about which name is first`,
		);
	}
});

test('the find box matches a spelling and the same words spelled differently', () => {
	const graph = buildGraph(plantedVault());
	const rows = nameRows(graph, nearDuplicates(graph));

	const literal = orderedRows(rows, { query: 'vandrel beacon' }).map((row) => row.surface);
	assert.ok(literal.includes('vandrel beacon'));
	assert.ok(
		literal.includes('Vandrel-Beacon'),
		'a reader who types one spelling must be shown the other, because the whole subject of this ' +
			'screen is that the two did not join',
	);

	// And it does not match a kind or a gloss. A box that quietly searched three fields returns rows
	// whose reason for being there is invisible.
	assert.deepEqual(orderedRows(rows, { query: 'trellis' }), []);
});

// ------------------------------------------------------------------------------------------------
// the duplicate chip, and what it promises
// ------------------------------------------------------------------------------------------------

test('the chip carries the other spelling and the degree a merge would add', () => {
	const graph = buildGraph(plantedVault());
	const duplicates = nearDuplicates(graph);
	const index = duplicateIndex(duplicates);

	const beacon = index.get('vandrel beacon');
	assert.ok(beacon, 'the strict rule must nominate the planted pair');
	assert.deepEqual(beacon.others, ['Vandrel-Beacon']);
	assert.equal(
		beacon.provisional,
		graph.nodes.get('Vandrel-Beacon').degree,
		'the provisional ticks must be the OTHER spelling’s real degree — the number the bar promises ' +
			'the reader they would gain — and not a placeholder',
	);
	assert.equal(beacon.sameComponent, false, 'the two spellings are in different components here');

	// Every entry has somebody to be a duplicate OF. An entry with an empty `others` would draw a
	// chip that says "also" and names nothing.
	for (const entry of index.values()) {
		assert.ok(entry.others.length > 0);
		assert.ok(entry.rules.length > 0);
	}

	// And nothing merged. The detector nominates; the graph is untouched.
	assert.equal(graph.nodes.size, buildGraph(plantedVault()).nodes.size);
});

test('the summary card and the duplicates tab count the same population', () => {
	/*
	  THE DEFECT THIS EXISTS FOR. The card counts GROUPS and the tab counts NAMES; both are honest and
	  they are different numbers. What is NOT honest is drawing them from two different populations —
	  an earlier version admitted only the strict rule into the table while the card counted every
	  proposal, and the screen said twelve above a tab that said two. One label, one word, two
	  answers, and no way for a reader to tell which one was their vault.
	*/
	const graph = buildGraph(mixedVault());
	const duplicates = nearDuplicates(graph);
	const rows = nameRows(graph, duplicates);
	const shape = vaultShape(graph, duplicates);
	const counts = orderCounts(rows);

	assert.equal(
		new Set(duplicates.map((group) => group.rule)).size,
		2,
		'the fixture must carry one proposal from each rule, or the two counts agree by accident',
	);
	assert.equal(shape.duplicateGroups, 2);
	assert.equal(counts.duplicates, 4, 'four names, in two groups');
	assert.equal(
		counts.duplicates,
		duplicateNameCount(duplicates),
		'the tab must hold every name any rule proposed against another, and nothing else',
	);
	assert.ok(
		counts.duplicates >= shape.duplicateGroups,
		`${counts.duplicates} names in ${shape.duplicateGroups} groups: a group holds at least two ` +
			`spellings, so the name count can never be the smaller of the two`,
	);

	// Every surface named in any group is in the tab, and every row in the tab is in some group.
	const proposed = new Set(duplicates.flatMap((group) => group.surfaces.map((entry) => entry.surface)));
	const tabbed = new Set(rows.filter((row) => row.alsoSpelled.length > 0).map((row) => row.surface));
	assert.deepEqual([...tabbed].sort(), [...proposed].sort());
});

// ------------------------------------------------------------------------------------------------
// the selection panel
// ------------------------------------------------------------------------------------------------

test('the panel’s lists are complete, because degree is what bounds them', () => {
	const graph = buildGraph(plantedVault());
	const reading = nameReading(graph, 'quorix reading', nearDuplicates(graph));

	assert.equal(reading.degree, 3);
	assert.equal(
		reading.statements.length,
		reading.degree,
		'one statement per incident fact. A panel that showed fewer would be truncating the answer to ' +
			'"what do we know about this" with nothing on screen saying so',
	);
	assert.equal(reading.memoryCount, graph.nodes.get('quorix reading').memories.length);
	assert.equal(reading.kind, 'trellis');
	assert.equal(reading.gloss, 'the reading the harness takes each pass');
	assert.equal(reading.relationCount, 3);

	// Every statement names the other end, and the direction is carried rather than lost.
	const outgoing = reading.statements.filter((statement) => statement.outgoing);
	assert.equal(outgoing.length, 3);
	assert.ok(reading.statements.every((statement) => statement.other !== 'quorix reading'));

	// Every memory in the panel is addressable, because every operation this app performs is
	// addressed by memory id and a name that reaches none is a name you can only look at.
	assert.ok(reading.memories.every((entry) => typeof entry.memory_id === 'string'));

	assert.equal(nameReading(graph, 'a name no memory uses', []), null);
});

// ------------------------------------------------------------------------------------------------
// the ego drawing and its cap
// ------------------------------------------------------------------------------------------------

test('the ego drawing refuses a whole ring rather than drawing part of one', () => {
	const spokes = EGO_CAP + 20;
	const graph = buildGraph(starVault(spokes));
	const ego = egoElements(graph, 'brannoch relay', { depth: 1 });

	assert.equal(ego.capped, true);
	assert.equal(
		ego.nodes.length,
		1,
		'the ring crossed the cap, so NONE of it is drawn. A drawing that kept the first sixty is ' +
			'indistinguishable from a complete one, which is a refusal spelled as an answer',
	);
	assert.equal(
		ego.hidden,
		spokes,
		'the count reported is the real number in the refused ring, not an estimate and not the ' +
			'overflow past the cap',
	);
	assert.equal(ego.reachedDepth, 0);
	assert.ok(ego.nodes.length <= EGO_CAP);
});

test('a neighbourhood grows with depth and draws no edge the export does not contain', () => {
	const graph = buildGraph(plantedVault());
	const palette = kindPalette(graph);

	const one = egoElements(graph, 'mirdel span', { depth: 1, palette });
	const two = egoElements(graph, 'mirdel span', { depth: 2, palette });
	const three = egoElements(graph, 'mirdel span', { depth: 3, palette });

	assert.equal(one.nodes.length, 2);
	assert.ok(two.nodes.length > one.nodes.length);
	assert.ok(three.nodes.length >= two.nodes.length);
	assert.equal(three.capped, false);

	const real = new Set(graph.edges.map((edge) => `${edge.source} ${edge.target}`));
	for (const edge of three.edges) {
		assert.ok(
			real.has(`${edge.source} ${edge.target}`),
			`the drawing invented the link ${edge.source} → ${edge.target}. The cost of a drawn edge ` +
				`that does not exist is somebody merging two things that were never one`,
		);
	}

	// The palette assigns a slot from the kinds THIS vault uses; a kind past the last slot takes -1
	// and is still named on the node.
	assert.ok(three.nodes.every((node) => typeof node.slot === 'number'));
});

// ------------------------------------------------------------------------------------------------
// the whole-vault overview
// ------------------------------------------------------------------------------------------------

test('the overview places every name, and places it in the same spot twice', (t) => {
	const graph = buildGraph(scaledVault());
	const duplicates = nearDuplicates(graph);
	const elements = overviewElements(graph, { palette: kindPalette(graph), duplicates });

	t.diagnostic(
		`overview fixture: ${elements.nodes.length} names, ${elements.edges.length} statements, ` +
			`${graph.counts.componentCount} components, largest ${graph.counts.largestComponent}`,
	);
	assert.ok(
		elements.nodes.length > 1100,
		'the fixture must be the size the picture actually has to survive, or the measurement below is ' +
			'a measurement of something smaller',
	);
	assert.equal(elements.elementCount <= OVERVIEW_CEILING, elements.overCeiling === false);

	const first = overviewLayout(elements.nodes, elements.edges);
	const second = overviewLayout(elements.nodes, elements.edges);
	t.diagnostic(`overview layout: ${first.elapsedMs} ms and ${second.elapsedMs} ms for the same input`);

	assert.equal(first.positions.size, elements.nodes.length, 'every name must have a position');
	for (const node of elements.nodes) {
		const point = first.positions.get(node.id);
		assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${node.id} landed off the plane`);
		const other = second.positions.get(node.id);
		assert.equal(other.x, point.x, `${node.id} moved between two layouts of one vault`);
		assert.equal(other.y, point.y, `${node.id} moved between two layouts of one vault`);
	}

	assert.ok(first.bounds.width > 0 && first.bounds.height > 0);
	assert.equal(first.components.length, graph.counts.componentCount);

	/*
	  THE BUDGET. Not a performance test dressed up as a correctness one — this number is what makes
	  the overview a thing a reader opens rather than a thing they wait for, and it is generous
	  enough by a wide margin that a machine under load does not turn it into a flake. What it
	  catches is the class of change that makes it quadratic in the WHOLE vault rather than in each
	  component: run over all twelve hundred names at once the same relaxation is a million pair
	  comparisons per iteration and this assertion is the thing that notices.
	*/
	assert.ok(
		first.elapsedMs < 2000,
		`the whole-vault layout took ${first.elapsedMs} ms for ${elements.nodes.length} names. A ` +
			`relaxation run over the whole vault instead of over each component looks exactly like this`,
	);
});

test('the picture and the table are one world', () => {
	const graph = buildGraph(plantedVault());
	const rows = nameRows(graph, nearDuplicates(graph));

	assert.equal(highlightSet(rows, ''), null, 'no query means no highlight, which is not an empty set');
	assert.equal(highlightSet(rows, '   '), null);

	for (const query of ['vandrel', 'quorix reading', 'pell']) {
		const lit = highlightSet(rows, query);
		const listed = new Set(orderedRows(rows, { query, order: DEFAULT_ORDER }).map((row) => row.surface));
		assert.deepEqual(
			[...lit].sort(),
			[...listed].sort(),
			`the canvas and the table disagree about "${query}". They are two renderings of one answer ` +
				`and a second search inside the picture would agree with the first only until one moved`,
		);
	}

	// A query that matches nothing dims the whole canvas rather than lighting all of it.
	const nothing = highlightSet(rows, 'a spelling this vault does not use');
	assert.notEqual(nothing, null);
	assert.equal(nothing.size, 0);
});

test('the largest few names are labelled, and the label set is small on purpose', () => {
	const graph = buildGraph(workingVault({ seed: 5, memories: 200 }).records);
	const elements = overviewElements(graph, { palette: kindPalette(graph), duplicates: nearDuplicates(graph) });

	assert.equal(elements.alwaysLabelled.size, Math.min(ALWAYS_LABELLED, elements.nodes.length));

	// They are the biggest. A readable label is about 120 x 20 px and a vault's worth of them wants
	// roughly twice the ink of the whole canvas, so the resident set has to be the few a reader can
	// orient by — and it has to be the few that are actually large, not the first few in some order.
	const cutoff = [...elements.nodes]
		.sort((a, b) => b.degree - a.degree)
		.slice(0, ALWAYS_LABELLED)
		.map((node) => node.degree)
		.pop();
	for (const id of elements.alwaysLabelled) {
		assert.ok(elements.nodes.find((node) => node.id === id).degree >= cutoff);
	}
});

test('a duplicate pair is drawn as its own kind of link, one per pair', () => {
	const graph = buildGraph(plantedVault());
	const duplicates = nearDuplicates(graph);
	const elements = overviewElements(graph, { palette: kindPalette(graph), duplicates });

	assert.equal(elements.duplicateLinks.length, 1);
	const link = elements.duplicateLinks[0];
	assert.deepEqual([link.source, link.target].sort(), ['Vandrel-Beacon', 'vandrel beacon'].sort());

	// It is NOT in the edge list. The edges are what the export literally contains; this is a
	// question the app is asking, and drawing it as an edge would make the two indistinguishable.
	assert.ok(!elements.edges.some((edge) => edge.source === 'vandrel beacon' && edge.target === 'Vandrel-Beacon'));
	assert.ok(elements.nodes.find((node) => node.id === 'vandrel beacon').duplicate);
	assert.ok(!elements.nodes.find((node) => node.id === 'pell gate').duplicate);
});

test('the pointer finds what is under it without walking every name', () => {
	const graph = buildGraph(workingVault({ seed: 3, memories: 120 }).records);
	const elements = overviewElements(graph, { palette: kindPalette(graph) });
	const placed = overviewLayout(elements.nodes, elements.edges);
	const index = hitIndex(placed.positions);

	for (const node of elements.nodes.slice(0, 40)) {
		const point = placed.positions.get(node.id);
		assert.equal(index.at(point.x, point.y, 6), node.id, `the grid missed ${node.id} at its own position`);
	}

	// Far outside the drawing there is nothing, and nothing is `null` rather than the nearest thing.
	assert.equal(index.at(placed.bounds.x - 10_000, placed.bounds.y - 10_000, 6), null);
});

// ------------------------------------------------------------------------------------------------
// the route
// ------------------------------------------------------------------------------------------------

test('the route carries a surface verbatim, including the characters that would break it', () => {
	const awkward = [
		'quorix reading',
		'src/harness/pell.mjs',
		'the mirdel span?',
		'brannoch#relay',
		'a 100% vandrel',
		'Vandrel-Beacon',
		'vandrel beacon',
	];
	for (const surface of awkward) {
		assert.equal(surfaceFromRoute(nameRoute(surface)), surface, surface);
	}

	// Two spellings that a near-duplicate rule would fold together must NOT fold in the route: the
	// entire subject of these screens is that they are two things, and a shared key would open one
	// name's panel from the other's row.
	assert.notEqual(nameRoute('Vandrel-Beacon'), nameRoute('vandrel beacon'));

	assert.equal(surfaceFromRoute('#/names'), null);
	assert.equal(surfaceFromRoute('#/'), null);
	assert.equal(surfaceFromRoute('#/names/'), null);
	// A truncated percent escape is not a name, and it is not a crash either.
	assert.equal(surfaceFromRoute('#/names/%E0%A4%A'), null);
});

// ------------------------------------------------------------------------------------------------
// what is deliberately absent
// ------------------------------------------------------------------------------------------------

test('nothing in this app computes a path between two names', () => {
	// Two names drawn from a vault of this shape share a component about 2% of the time, so the
	// feature answers "no path" in ~97 uses out of 100 — and where a path does exist the component is
	// very nearly a tree, so the answer is a unique linear chain best drawn as a breadcrumb. It is a
	// beautiful demo with a near-total failure rate, and it is a decision that survives exactly as
	// long as nobody re-adds it. So the check is over the source rather than over the intention.
	const offenders = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!/\.(mjs|jsx)$/.test(entry.name)) continue;
			const source = readFileSync(path, 'utf8');
			// The names a path finder is built under. Prose about why it is absent is allowed and is
			// what the comments above do; a function that computes one is not.
			for (const [match] of source.matchAll(
				/\b(?:function|const)\s+\w*(?:shortestPath|pathBetween|findPath|dijkstra|bfsPath)\w*/gi,
			)) {
				offenders.push(`${path.slice(ROOT.length + 1)}: ${match}`);
			}
		}
	};
	walk(APP);

	assert.deepEqual(
		offenders,
		[],
		`these compute a path between two names:\n${offenders.join('\n')}\n\nIt returns "no path" for ` +
			`about 97 of every 100 pairs in a vault of this shape, and when it succeeds the answer is a ` +
			`breadcrumb rather than a drawing.`,
	);

	// The check has to be capable of failing.
	const planted = 'function shortestPathBetween(a, b) {}';
	assert.equal(
		[...planted.matchAll(/\b(?:function|const)\s+\w*(?:shortestPath|pathBetween|findPath|dijkstra|bfsPath)\w*/gi)]
			.length,
		1,
	);
});

test('the names screens reach nothing: no request, and no import of the door', () => {
	// Everything on these screens is arithmetic over the listing the browser already holds. The one
	// door that would make them convenient is a ranked query, and a ranked query writes a permanent
	// exposure row into the vault it is inspecting.
	for (const file of ['NamesView.jsx', 'NameFocus.jsx', 'names-model.mjs', 'overview-layout.mjs']) {
		const source = readFileSync(join(APP, file), 'utf8');
		assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} issues a request`);
		assert.doesNotMatch(source, /from '\.\/api\.mjs'/, `${file} imports the door to the sidecar`);
		assert.doesNotMatch(source, /askRanked/, `${file} names the ranked door`);
	}

	// And the two model files are pure: no React, no DOM, no clock beyond the elapsed measurement.
	for (const file of ['names-model.mjs', 'overview-layout.mjs']) {
		const source = readFileSync(join(APP, file), 'utf8');
		assert.doesNotMatch(source, /from 'react'/, `${file} imports React`);
		assert.doesNotMatch(source, /\bdocument\.|\bwindow\./, `${file} reaches the DOM`);
	}
});
