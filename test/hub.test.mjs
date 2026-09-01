// The hub programme, tested against fixtures built for it.
//
// M3 recorded the gap plainly: no regime detection, no collapse threshold, no compound meta-node,
// no "absorb into context", and no fixture carrying a node with a hundred thousand edges. On the
// vault this app was developed against the maximum degree is single digits, so none of it would
// ever fire there — **four features that have never run are four features that do not exist**, and
// a guard whose null result is indistinguishable from success is not evidence of anything.
//
// So the fixtures come first. `test/helpers/synthetic.mjs` generates three graphs, one per regime,
// deterministically and from invented content only, and every assertion below runs against them:
//
//   working    a fragmented vault of a few hundred names — the NEGATIVE case. A threshold that
//              fired here would be the exact defect the percentile-relative formula prevents.
//   over-cap   one connected group of several thousand elements and no outlier — the case where
//              the reduction LADDER has to fire, which on a working vault it never does.
//   hub        one name with 100,000 edges and a realistic tail — PRD 0005 R19.
//
// Everything under test is pure. No vault is opened, no process is spawned and no clone is made,
// which is itself the requirement (R2): this screen issues no door call of its own, so every
// reduction it offers has to be arithmetic over a payload the browser already holds. A test that
// needed a vault to exercise a collapse would be evidence that it is not.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildGraph, neighbourhood, subgraph } from '../src/app/graph-model.mjs';
import {
	COLLAPSE_FLOOR,
	COLLAPSE_MULTIPLE,
	DRAW_CAP,
	applyUndo,
	collapseThreshold,
	degreeStats,
	detectRegime,
	findHubs,
	hubIndex,
	hubNodeId,
	hubScope,
	hubWindow,
	planView,
	reductionOptions,
	regimeLine,
} from '../src/app/hub-model.mjs';
import { OVERVIEW_CEILING, overviewElements } from '../src/app/names-model.mjs';
import { hubVault, overCapVault, workingVault } from './helpers/synthetic.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The hub fixture is the expensive one — a hundred thousand facts through `buildGraph` — so it is
// built once for the whole file. It is never mutated by anything below; every reduction returns a
// new plan and none of them writes to the model.
const HUB = (() => {
	const vault = hubVault();
	return { vault, graph: buildGraph(vault.records) };
})();
const WORKING = (() => {
	const vault = workingVault();
	return { vault, graph: buildGraph(vault.records) };
})();
const OVER_CAP = (() => {
	const vault = overCapVault();
	return { vault, graph: buildGraph(vault.records) };
})();

/**
 * The projection a hub regime seeds on.
 *
 * THE LENS ARGUMENT IS GONE BECAUSE THE LENSES ARE. The rebuild replaced three projections of one
 * graph with one — names joined by the facts that name them — so `projectLens` is `subgraph` and
 * `scopeSurfaces` for an ego scope is `neighbourhood`. `hubScope` still decides the depth, and it is
 * still called here rather than inlined, so the rule the collapse seeds on stays under test.
 */
function hubProjection(graph, hub) {
	const scope = hubScope(hub);
	return subgraph(graph, neighbourhood(graph, scope.seed, scope.depth));
}

/** The state of having asked for nothing, which is the state the overview opens in. */
const nothingReduced = () => ({ collapsed: new Set(), absorbed: new Set(), expanded: new Map() });

// ================================================================================================
// THE FIXTURES
// ================================================================================================

test('the fixtures are the three shapes they claim to be', () => {
	// The requirement is a literal one and it is asserted literally: one node, a hundred thousand
	// edges. A fixture that carried 99,412 would still exercise every code path and would quietly
	// stop being the thing PRD 0005 R19 asked for.
	const hubDegree = HUB.graph.nodes.get(HUB.vault.hub).degree;
	assert.equal(hubDegree, 100_000, 'the hub fixture must carry one node with exactly 100,000 edges');
	assert.ok(HUB.graph.counts.edgeCount > 100_000, 'and a tail around it, so the collapse has something to keep');

	// The over-cap fixture has to be genuinely over the cap as it is drawn, or the ladder above
	// it is being tested against a graph that fits — which is the state M3 was already in.
	const largest = OVER_CAP.graph.components[0];
	assert.ok(
		largest.size + largest.edgeCount > DRAW_CAP,
		`the over-cap fixture draws ${largest.size + largest.edgeCount} against a cap of ${DRAW_CAP}`,
	);

	// And the working fixture has to be under both, or it separates nothing.
	assert.ok(WORKING.graph.counts.maxDegree < 20, 'the working fixture must have no outlier');
	assert.ok(
		WORKING.graph.components[0].size + WORKING.graph.components[0].edgeCount < DRAW_CAP,
		'the working fixture must fit under the cap',
	);
	// A working vault is fragmented. If this fixture came back as one connected lump it would be
	// testing the wrong shape even while passing every count above.
	assert.ok(WORKING.graph.counts.componentCount > 3, 'the working fixture must be fragmented');
});

test('the generator is deterministic, and the seed is what moves it', () => {
	// A fixture whose shape moves between runs turns every threshold assertion into a flake, and a
	// flaky threshold is worse than no threshold: it teaches the reader to re-run rather than look.
	assert.deepEqual(workingVault({ seed: 7 }).records, workingVault({ seed: 7 }).records);
	assert.deepEqual(overCapVault({ seed: 7 }).records, overCapVault({ seed: 7 }).records);
	assert.notDeepEqual(workingVault({ seed: 7 }).records, workingVault({ seed: 8 }).records);

	// The hub fixture is compared by shape rather than by deep equality: a hundred thousand facts is
	// a comparison expensive enough that it would be the slowest thing in this file.
	const a = hubVault({ seed: 5, hubDegree: 500, tail: 40 });
	const b = hubVault({ seed: 5, hubDegree: 500, tail: 40 });
	assert.equal(a.records.length, b.records.length);
	assert.deepEqual(a.records[0], b.records[0]);
	assert.deepEqual(a.records.at(-1), b.records.at(-1));
});

test('nothing in the app recognises a fixture surface, because nothing may recognise any surface', () => {
	// PRD 0005 R17: no hardcoded surface string in any suppression, stop-list or absorption path. The
	// hub in these fixtures is found by DEGREE or it is not found at all — so the app source must not
	// contain the hub's name, or any other name the generator mints. A stop list keyed to a literal
	// is a transcribed vocabulary, and it fails in the direction that hides things: it stops matching
	// the day a writer spells the name differently, and nothing on screen says so.
	const appDir = join(ROOT, 'src', 'app');
	const sources = readdirSync(appDir)
		.filter((name) => name.endsWith('.mjs') || name.endsWith('.jsx'))
		.map((name) => [name, readFileSync(join(appDir, name), 'utf8')]);

	const planted = [HUB.vault.hub, ...[...WORKING.graph.nodes.keys()].slice(0, 40)];
	assert.ok(planted.length > 10, 'the check needs enough names to be capable of finding something');

	const hits = [];
	for (const [file, source] of sources) {
		for (const surface of planted) {
			if (source.includes(surface)) hits.push(`${file}: ${surface}`);
		}
	}
	assert.deepEqual(hits, [], `a surface string appears in the shipped source:\n${hits.join('\n')}`);
});

// ================================================================================================
// REGIME DETECTION
// ================================================================================================

test('regime detection separates the three fixtures, and names a different treatment for each', () => {
	const working = detectRegime(WORKING.graph);
	const overCap = detectRegime(OVER_CAP.graph);
	const hub = detectRegime(HUB.graph);

	assert.equal(working.regime, 'working');
	assert.equal(overCap.regime, 'over-cap');
	assert.equal(hub.regime, 'hub');

	// Three regimes that all pick the same treatment would be a classifier nobody needs.
	assert.deepEqual(
		[working.treatment, overCap.treatment, hub.treatment],
		['draw', 'reduce', 'collapse'],
		'the regime has to choose the treatment, or it is a label rather than a decision',
	);

	// `forced` is a statement about the drawing, not about the graph: it separates "there is a hub"
	// from "the canvas cannot proceed without doing something about it".
	assert.equal(working.forced, false);
	assert.equal(overCap.forced, true);
	assert.equal(hub.forced, true);

	// A hub regime is decided by the OUTLIER, not by the size. The over-cap fixture has more edges
	// per node than the hub fixture does, and it is correctly not a hub regime.
	assert.equal(overCap.hubs.length, 0);
	assert.equal(hub.hubs.length, 1);
	assert.equal(hub.hubs[0].surface, HUB.vault.hub);
	assert.equal(hub.hubs[0].degree, 100_000);
});

test('the collapse threshold is computed from the distribution and is not a constant', () => {
	// Recomputed here from the degree list, independently of the module, so this is a cross-check
	// rather than a restatement. `max(20, p99 × 4)` — PRD 0005 R17.
	const independently = (graph) => {
		const degrees = [...graph.nodes.values()].map((node) => node.degree).sort((a, b) => a - b);
		const p99 = degrees[Math.floor(0.99 * (degrees.length - 1))];
		return Math.max(COLLAPSE_FLOOR, p99 * COLLAPSE_MULTIPLE);
	};

	for (const { graph } of [WORKING, OVER_CAP, HUB]) {
		assert.equal(collapseThreshold(degreeStats(graph)), independently(graph));
	}

	// **The threshold has to MOVE with the data, or "computed from the distribution" is a sentence in
	// a comment.** Three fixtures with three distributions give three different thresholds; a
	// hardcoded value would give one.
	const thresholds = [WORKING, OVER_CAP, HUB].map(({ graph }) => collapseThreshold(degreeStats(graph)));
	assert.equal(new Set(thresholds).size, 3, `the threshold did not move with the data: ${thresholds}`);

	// And it moves in the right direction: a graph whose busiest one per cent gets busier has a
	// higher bar for what counts as an outlier. This is the perturbation a hardcoded constant cannot
	// respond to, so it is what tells a live formula from an inert one — the same two things a flat
	// sweep cannot distinguish.
	const denser = buildGraph(overCapVault({ communitySize: 400, intraDegree: 20, communities: 3 }).records);
	assert.ok(
		collapseThreshold(degreeStats(denser)) > collapseThreshold(degreeStats(OVER_CAP.graph)),
		'a denser distribution must raise the bar for what counts as an outlier',
	);

	// The floor governs where four times the 99th percentile is small. On the hub fixture the
	// distribution is almost all degree-1 leaves, so p99 is 2 and 4 × 2 is 8 — without the floor,
	// eight would make a hub of any name in a triangle.
	const hubStats = degreeStats(HUB.graph);
	assert.ok(hubStats.p99 * COLLAPSE_MULTIPLE < COLLAPSE_FLOOR);
	assert.equal(collapseThreshold(hubStats), COLLAPSE_FLOOR);
});

test('the threshold does not fire on a working vault, and that is the correct answer', () => {
	// The negative case, stated as one. A collapse that fired here would delete the topology of a
	// graph that was perfectly legible, which is the failure mode of a fixed low cap.
	const stats = degreeStats(WORKING.graph);
	assert.deepEqual(findHubs(WORKING.graph, collapseThreshold(stats)), []);
	assert.ok(stats.max < collapseThreshold(stats));
	// And it does not fire on a graph that is merely large, which is the other half of the same
	// claim: quantity is not an outlier.
	assert.deepEqual(findHubs(OVER_CAP.graph, collapseThreshold(degreeStats(OVER_CAP.graph))), []);
});

// ================================================================================================
// THE COLLAPSE
// ================================================================================================

test('a hub above the threshold collapses, and the drawing fits', () => {
	const regime = detectRegime(HUB.graph);
	const hub = regime.hubs[0];

	const projection = hubProjection(HUB.graph, hub);
	const plain = planView(projection, {});
	const collapsed = planView(projection, { collapsed: new Set([hubNodeId(hub)]) });

	assert.ok(plain.elementCount > DRAW_CAP, 'the unreduced view has to be over the cap');
	assert.ok(
		collapsed.elementCount <= DRAW_CAP,
		`the collapse drew ${collapsed.elementCount} against a cap of ${DRAW_CAP}`,
	);

	// The hub becomes a COLLAPSED ELEMENT rather than a deleted one: the meta-node has its own id,
	// the hub is its first child, and it is still on the canvas to be clicked. That is what keeps
	// selection, layout and the click-into-a-name path working through a collapse.
	assert.equal(collapsed.metaNodes.length, 1);
	const meta = collapsed.metaNodes[0];
	assert.equal(meta.childId, hubNodeId(hub));
	const drawnHub = collapsed.nodes.find((node) => node.id === hubNodeId(hub));
	assert.ok(drawnHub, 'the hub itself is still drawn — a collapse is not a deletion');
	assert.equal(drawnHub.parent, meta.id, 'and it sits inside its own box');

	// The neighbours that carry topology stayed. A collapse that absorbed everything would be a
	// picture of one box, which is legible and says nothing.
	assert.ok(meta.keptNeighbours > 0, 'the collapse kept nothing, so it kept no topology');

	// The number ON the box is the number the list has to keep, and it is the FACT degree rather
	// than the drawn one — a box saying 1,700 over a list of 100,000 is the collapse lying about
	// how much it is holding.
	assert.equal(meta.listTotal, hub.degree);
});

test('the collapse is reversible and the count of what was hidden is exact', () => {
	const hub = detectRegime(HUB.graph).hubs[0];
	const projection = hubProjection(HUB.graph, hub);
	const plain = planView(projection, {});
	const collapsed = planView(projection, { collapsed: new Set([hubNodeId(hub)]) });

	// EXACT, cross-checked against a computation that knows nothing about the reduction. The
	// meta-node is the one element the reduction adds, so the identity is: what you would have drawn
	// = what you drew, minus the box, plus everything the ledger says is inside it.
	assert.equal(
		plain.elementCount,
		collapsed.elementCount - collapsed.metaNodes.length + collapsed.hidden.nodes + collapsed.hidden.edges,
		'the hidden counts do not reconcile with the view that hid nothing',
	);
	// Node for node and edge for edge, not merely in total — a pair of errors that cancelled would
	// pass the sum above.
	assert.equal(plain.nodes.length, collapsed.nodes.length + collapsed.hidden.nodes);
	assert.equal(plain.edges.length, collapsed.edges.length + collapsed.hidden.edges);

	// Every element that left is accounted for by a ledger row that names it, counts it, and carries
	// the action that puts it back. Nothing narrows silently.
	assert.equal(collapsed.ledger.length, 1);
	const [entry] = collapsed.ledger;
	assert.equal(entry.kind, 'collapsed');
	assert.ok(entry.hiddenNodes > 0 && entry.hiddenEdges > 0);
	assert.match(entry.sentence, new RegExp(entry.hiddenNodes.toLocaleString()));
	assert.equal(entry.undo.action, 'uncollapse');
	// The undo states its own consequence before it is taken. Offering "show everything" without
	// saying it is a hundred times the cap is how a canvas blacks out on a click.
	assert.ok(entry.undo.elementsAfter > DRAW_CAP);
	assert.equal(entry.undo.elementsAfter, plain.elementCount);

	// REVERSIBLE, driven through the same state transition the screen uses rather than by rebuilding
	// the arguments by hand. A hand-built "restored" state would certify the wrong thing.
	let state = { collapsed: new Set([hubNodeId(hub)]), absorbed: new Set(), expanded: new Map() };
	for (const row of collapsed.ledger) state = applyUndo(state, row);
	const restored = planView(projection, state);
	assert.equal(restored.elementCount, plain.elementCount);
	assert.deepEqual(restored.ledger, []);
	assert.deepEqual(
		restored.nodes.map((node) => node.id).sort(),
		plain.nodes.map((node) => node.id).sort(),
		'the undo returned a different set of nodes, not the original one',
	);
});

test('with nothing asked for, nothing is reduced — on all three fixtures', () => {
	// The property that makes "no silent narrowing" checkable rather than promised, and the same
	// assertion doubles as the proof that there is no built-in stop list: if any surface were
	// suppressed by a rule of this module's own, one of these would come back short.
	//
	// It runs on the projection the OVERVIEW builds, not on one assembled here, because that is the
	// projection the screen hands to `planView` on every draw. The hub fixture is also checked on
	// the ego projection a collapse seeds on, so both doors into the plan are covered.
	for (const [name, projection] of [
		['working/whole-vault', overviewElements(WORKING.graph)],
		['over-cap/whole-vault', overviewElements(OVER_CAP.graph)],
		['hub/around the hub', hubProjection(HUB.graph, { surface: HUB.vault.hub })],
	]) {
		const plan = planView(projection, { ...nothingReduced(), cap: OVERVIEW_CEILING });
		assert.equal(plan.nodes.length, projection.nodes.length, `${name} lost nodes`);
		assert.equal(plan.edges.length, projection.edges.length, `${name} lost edges`);
		assert.deepEqual(plan.ledger, [], `${name} reduced something nobody asked for`);
		assert.deepEqual(plan.hidden, { nodes: 0, edges: 0 });
		assert.equal(plan.metaNodes.length, 0, `${name} drew a box around something nobody collapsed`);
	}
});

test('expanding a collapsed hub reveals the top k in a stated order and re-checks the cap first', () => {
	const hub = detectRegime(HUB.graph).hubs[0];
	const projection = hubProjection(HUB.graph, hub);
	const collapsedSet = new Set([hubNodeId(hub)]);

	const some = planView(projection, { collapsed: collapsedSet, expanded: new Map([[hubNodeId(hub), 150]]) });
	assert.equal(some.metaNodes[0].shownChildren, 150);
	assert.equal(some.capReached, false);
	assert.ok(some.elementCount <= DRAW_CAP);
	// A revealed child is inside the box. That is what a compound node is for, and it is what makes
	// "150 of 100,000" a statement about a place on screen rather than a caption.
	const revealed = some.nodes.filter((node) => node.parent === some.metaNodes[0].id && node.id !== hubNodeId(hub));
	assert.equal(revealed.length, 150);

	// The order is stated, so k and k+1 agree about the first k. An order that moved between calls
	// would make the `showing k of N` chip a lie about WHICH k.
	const more = planView(projection, { collapsed: collapsedSet, expanded: new Map([[hubNodeId(hub), 200]]) });
	const first = (plan) =>
		plan.nodes.filter((node) => node.parent === plan.metaNodes[0].id && node.id !== hubNodeId(hub)).map((node) => node.id);
	assert.deepEqual(first(more).slice(0, 150).sort(), first(some).sort());

	// Asked for everything, it stops at the cap and SAYS SO. Drawing 100,000 elements and then
	// apologising would have already produced the black disc.
	const everything = planView(projection, {
		collapsed: collapsedSet,
		expanded: new Map([[hubNodeId(hub), Number.MAX_SAFE_INTEGER]]),
	});
	assert.equal(everything.capReached, true);
	assert.ok(everything.elementCount <= DRAW_CAP, `expansion drew ${everything.elementCount}`);
	assert.ok(everything.metaNodes[0].hiddenNodes > 0, 'and it still reports what it is still holding');
	// The reveal is still exact: what is inside plus what is drawn is what there was.
	const plain = planView(projection, {});
	assert.equal(plain.nodes.length, everything.nodes.length + everything.hidden.nodes);
});

test('absorb into context takes a node off the canvas and hangs it on its neighbours', () => {
	const hub = detectRegime(HUB.graph).hubs[0];
	const projection = hubProjection(HUB.graph, hub);
	const plain = planView(projection, {});
	const absorbed = planView(projection, { absorbed: new Set([hubNodeId(hub)]) });

	assert.ok(absorbed.elementCount <= DRAW_CAP);
	assert.equal(absorbed.nodes.find((node) => node.id === hubNodeId(hub)), undefined, 'the absorbed node is off the canvas');

	// NOT DELETED — converted. Every neighbour that is still drawn carries a badge naming the
	// relationship and its direction, so the information the edge carried is on the node instead.
	assert.ok(absorbed.badges.size > 0);
	for (const [, list] of absorbed.badges) {
		for (const badge of list) {
			assert.equal(badge.id, hubNodeId(hub));
			assert.ok(badge.direction === 'from' || badge.direction === 'to');
		}
	}
	for (const node of absorbed.nodes) {
		if (absorbed.badges.has(node.id)) assert.ok(node.badges.length > 0, 'a badge that is not on its node is not an encoding');
	}

	// The ledger separates the choice from its consequence: the node you absorbed, and the names
	// that had nothing else and left the canvas with it. One number for both would conflate them.
	const [entry] = absorbed.ledger;
	assert.equal(entry.kind, 'absorbed');
	assert.ok(entry.orphanedNodes > 0);
	assert.equal(entry.hiddenNodes, 1 + entry.orphanedNodes);
	assert.match(entry.sentence, /still in the list/);

	// Exact, and reversible, by the same two checks the collapse gets.
	assert.equal(
		plain.elementCount,
		absorbed.elementCount - absorbed.metaNodes.length + absorbed.hidden.nodes + absorbed.hidden.edges,
	);
	let state = { collapsed: new Set(), absorbed: new Set([hubNodeId(hub)]), expanded: new Map() };
	for (const row of absorbed.ledger) state = applyUndo(state, row);
	assert.equal(planView(projection, state).elementCount, plain.elementCount);
});

// ================================================================================================
// THE LIST — the honest encoding for the mass
// ================================================================================================

test('the collapsed hub opens a list that holds every one of its 100,000 claims', () => {
	const index = hubIndex(HUB.graph, HUB.vault.hub);

	// The list is the promise the number on the box makes. If it held fewer than the box says, the
	// collapse would be a truncation wearing a caption.
	assert.equal(index.total, 100_000);
	assert.equal(
		index.byPredicate.reduce((total, group) => total + group.count, 0),
		index.total,
		'the grouping lost rows',
	);
	// Grouped by relationship name, commonest first, and each group knows where it starts.
	for (let i = 1; i < index.byPredicate.length; i += 1) {
		assert.ok(index.byPredicate[i - 1].count >= index.byPredicate[i].count);
		assert.equal(index.byPredicate[i].offset, index.byPredicate[i - 1].offset + index.byPredicate[i - 1].count);
	}

	// VIRTUALIZED: a window, not the whole list. Forty rows out of a hundred thousand, from anywhere,
	// including past the end — a fast scroll asks for an offset that does not exist and the correct
	// answer to that is the last page rather than an exception.
	const head = hubWindow(index, 0, 40);
	assert.equal(head.rows.length, 40);
	assert.equal(head.total, 100_000);
	const tail = hubWindow(index, 99_980, 40);
	assert.equal(tail.rows.length, 20);
	assert.deepEqual(hubWindow(index, 500_000, 40).rows, []);

	// Every row terminates in a verb: the memory that asserts it. A row that could not be opened
	// would make the list a place a hundred thousand facts go to be unreachable.
	for (const row of head.rows) {
		assert.ok(row.edge.memory_id, 'a row with no memory behind it is a dead end');
		assert.ok(row.other && row.other !== HUB.vault.hub);
		assert.ok(row.direction === 'from' || row.direction === 'to');
	}

	// The windows tile the list: no gap, no overlap, no row rendered twice.
	const sample = [0, 1, 2, 900, 1500].flatMap((page) => hubWindow(index, page * 40, 40).rows.map((row) => row.position));
	assert.equal(new Set(sample).size, sample.length);
});

// ================================================================================================
// THE REDUCTION LADDER — the part that had never fired
// ================================================================================================

test('the reduction ladder still descends, and the rung that helps is not the same one at both densities', () => {
	// `defaultView` — the automatic ladder this test used to drive — belonged to the lens screen the
	// rebuild replaced, and it is gone. `reductionOptions` is the same rungs as a pure function and
	// it is what survived, so the ladder is checked through it.
	//
	// The property that matters is that the rungs are ORDERED BY HOW MUCH THEY GIVE UP and that a
	// denser graph has to descend further. A ladder whose first rung is always enough is a single
	// step, and from the outside those two look identical.
	const ego = (options, depth) => options.find((option) => option.key === `ego-${depth}`);

	const sparse = reductionOptions(OVER_CAP.graph, {});
	assert.ok(ego(sparse, 2).elements <= DRAW_CAP, 'the depth-2 rung should fit on this fixture');
	assert.ok(
		ego(sparse, 2).elements > ego(sparse, 1).elements,
		'two steps out has to draw more than one, or the rungs are not a ladder',
	);

	// A fixture dense enough that the rung above no longer fits — which is what puts the one below
	// it in play. Without this the depth-1 rung is arithmetic nobody has ever seen a result from.
	const dense = buildGraph(overCapVault({ communitySize: 400, intraDegree: 20, communities: 3 }).records);
	const deep = reductionOptions(dense, {});
	assert.equal(ego(deep, 2).fits, false, 'the depth-2 rung was still enough, so the rung below it never runs');
	assert.equal(ego(deep, 1).fits, true, 'and the rung below it has to be the one that fits');
});

test('every rung of the reduction panel carries its own element count, including the ones that do not help', () => {
	const memoryTypes = [...new Set(OVER_CAP.graph.edges.map((edge) => edge.memory_type))]
		.filter(Boolean)
		.map((value) => ({ value }));
	const options = reductionOptions(OVER_CAP.graph, { memoryTypes });

	assert.ok(options.length >= 4);
	for (const option of options) {
		assert.equal(typeof option.elements, 'number');
		assert.ok(option.elements > 0);
		assert.equal(option.fits, option.elements <= DRAW_CAP);
	}
	// A rung that is still over the cap is REPORTED, not dropped. "This reduction is not enough
	// either" is something the reader needs, and an absent button cannot say it.
	assert.ok(
		options.some((option) => !option.fits),
		'this fixture should have a rung that does not fit, or the fits flag has never been false',
	);
	assert.ok(options.some((option) => option.fits), 'and one that does, or the panel offers no way out');

	// In a hub regime the panel gains the one rung that helps: every other rung returns the star.
	const hubs = detectRegime(HUB.graph).hubs;
	const hubOptions = reductionOptions(HUB.graph, { hubs });
	const collapseRung = hubOptions.find((option) => option.collapse);
	assert.ok(collapseRung, 'the hub regime offers no collapse rung');
	assert.ok(collapseRung.fits, 'and the collapse rung has to be the one that fits');
	assert.equal(collapseRung.collapse, hubNodeId(hubs[0]));
});

// ================================================================================================
// THE BUDGET
// ================================================================================================

test('the whole hub path runs on the 100,000-edge fixture inside its stated budget', () => {
	// THE BUDGET, STATED. Measured on the machine this was developed on the pipeline below runs in
	// roughly 0.6 s end to end, of which the reconstruction is about 230 ms and the projection about
	// 300 ms. The bound here is eight seconds, which is more than ten times that: it is a bound on
	// USABILITY, not a benchmark, and its job is to fail when something turns linear work quadratic
	// rather than to police a hundred milliseconds on a slower machine. The measured figures are in
	// docs/M7-HUB-STATUS.md, where a regression can be read against them.
	const BUDGET_MS = 8_000;
	const INTERACTIVE_BUDGET_MS = 2_000;

	const started = performance.now();
	const vault = hubVault();
	const graph = buildGraph(vault.records);
	const regime = detectRegime(graph);
	const hub = regime.hubs[0];
	const projection = hubProjection(graph, hub);
	const plan = planView(projection, { collapsed: new Set([hubNodeId(hub)]) });
	const index = hubIndex(graph, hub.surface);
	const elapsed = performance.now() - started;

	assert.equal(regime.regime, 'hub');
	assert.ok(plan.elementCount <= DRAW_CAP);
	assert.equal(index.total, 100_000);
	assert.ok(elapsed < BUDGET_MS, `the hub path took ${Math.round(elapsed)} ms against a budget of ${BUDGET_MS} ms`);

	// The interactive half separately, because it is the one a click waits on. Everything above the
	// projection happens once at load; a collapse, an expansion and a scroll happen on every click,
	// and a budget that averaged them with the load would hide a slow one behind a fast one.
	const interactive = performance.now();
	planView(projection, { collapsed: new Set([hubNodeId(hub)]), expanded: new Map([[hubNodeId(hub), 150]]) });
	hubWindow(index, 99_000, 60);
	const clickElapsed = performance.now() - interactive;
	assert.ok(
		clickElapsed < INTERACTIVE_BUDGET_MS,
		`a collapse-and-scroll took ${Math.round(clickElapsed)} ms against ${INTERACTIVE_BUDGET_MS} ms`,
	);
});


// ================================================================================================
// THE RENDERER THE PLAN IS ACTUALLY HANDED TO
// ================================================================================================

test('the plan a collapse produces is one the overview layout can place, whole', async () => {
	// Every other assertion in this file is over the plan, and the plan can be perfectly
	// self-consistent and still not draw. This canvas places nodes by id and then draws each edge
	// between two looked-up positions, skipping any endpoint it cannot find — no error, no warning,
	// a plausible picture with lines silently missing from it. That failure is invisible to
	// arithmetic, so it is checked here by running the real layout over a real collapsed plan.
	const { overviewLayout } = await import('../src/app/overview-layout.mjs');

	const small = buildGraph(hubVault({ hubDegree: 400, connectors: 30, tail: 200 }).records);
	const hub = detectRegime(small).hubs[0];
	const overview = overviewElements(small);
	const plan = planView(overview, {
		...nothingReduced(),
		collapsed: new Set([hubNodeId(hub)]),
		cap: OVERVIEW_CEILING,
	});

	assert.ok(plan.ledger.length === 1 && plan.hidden.nodes > 0, 'this fixture has to actually collapse');

	// No dangling edge. A collapse that hid a node and kept an edge to it would draw a line to
	// nowhere, which the canvas renders as no line at all.
	const drawn = new Set(plan.nodes.map((node) => node.id));
	const dangling = plan.edges.filter((edge) => !drawn.has(edge.source) || !drawn.has(edge.target));
	assert.deepEqual(dangling, [], `${dangling.length} edges point at a node the collapse hid`);

	// And every node the plan kept gets a position, so nothing the ledger did NOT account for
	// disappears between the plan and the picture.
	const placed = overviewLayout(plan.nodes, plan.edges).positions;
	assert.equal(placed.size, plan.nodes.length);
	assert.ok(placed.has(hubNodeId(hub)), 'the collapsed hub itself has to be on the canvas');
});

test('the overview draws the plan, not the projection the plan reduced', () => {
	// THE JOIN DEFECT, pinned where it now lives.
	//
	// It is a defect in the wiring between two files that are individually correct. The overview
	// half computes `overview` — every name and every fact — and the hub half computes `plan`, which
	// is `overview` after the reductions. Wired the wrong way round, a collapse produces two numbers
	// about one picture: the ledger says "this picture draws N of M" while the canvas is still
	// holding M. The wrong one is the LARGER, which is the exact reading this programme exists to
	// prevent — a reduced view that reads as a complete one.
	//
	// No test over `planView` can see it: every number involved is correct in the function that
	// produced it. It is a join, so it is checked as one, on the source.
	const source = readFileSync(join(ROOT, 'src', 'app', 'NamesView.jsx'), 'utf8');

	const at = source.indexOf('<VaultCanvas');
	assert.ok(at > 0, 'the overview no longer renders VaultCanvas; this check is stale.');
	const props = source.slice(at, source.indexOf('/>', at));
	for (const fed of ['nodes={plan.nodes}', 'edges={plan.edges}']) {
		assert.ok(
			props.includes(fed),
			`the canvas is handed the unreduced projection, so it will draw elements a collapse has ` +
				`already taken off it — expected ${fed}`,
		);
	}
	// And the layout with it: a layout built from the projection would place the hidden nodes too,
	// and the canvas would then find a position for everything and draw the whole star anyway.
	assert.match(
		source,
		/overviewLayout\(plan\.nodes, plan\.edges\)/,
		'the layout is built from the projection rather than from the plan',
	);

	// The arithmetic behind the sentence the receipt renders: on an unreduced view the plan and the
	// projection agree exactly, so the clause naming a reduction cannot appear when there is none.
	const hub = detectRegime(HUB.graph).hubs[0];
	const projection = hubProjection(HUB.graph, hub);
	const quiet = planView(projection, {});
	assert.equal(quiet.elementCount, quiet.unreduced.elementCount);
	assert.equal(quiet.hidden.nodes + quiet.hidden.edges, 0);

	const reduced = planView(projection, { collapsed: new Set([hubNodeId(hub)]) });
	assert.ok(reduced.elementCount < reduced.unreduced.elementCount);
	assert.ok(reduced.hidden.nodes + reduced.hidden.edges > 0);
});

// ================================================================================================
// THE SILENCE — the assertion the old suite did not have
// ================================================================================================

test('on a real-shaped vault the regime reads no hub, nothing collapses, and the line says so', () => {
	// THIS IS THE ASSERTION THE WHOLE PROGRAMME RESTS ON, and until now it was the one thing the
	// suite did not check: that on a vault of the shape a person actually has — a few hundred names
	// and a busiest one in single digits — the collapse correctly does not fire, and does not fire
	// BECAUSE A NUMBER SAID SO.
	//
	// The distinction is the whole argument for keeping this code. "Nothing was collapsed" is also
	// what a broken detector produces, what an unwired detector produces, and what no detector at
	// all produces; all four look identical from the outside. So the test asserts the reading and
	// not merely the outcome — the bar, where the bar came from, and the busiest name it was
	// measured against — and then shows the same code path saying the opposite the moment a vault
	// has a real hub, because a probe that cannot succeed has a null that means nothing.
	const graph = WORKING.graph;
	const stats = degreeStats(graph);

	assert.ok(stats.max <= 12, `this fixture is meant to be real-shaped; its busiest name has ${stats.max}`);

	// Driven through the door the overview uses, with the budget the overview enforces — not the
	// module's own default. A reading taken under a cap nobody draws under is a number about a
	// mechanism that did not run.
	const overview = overviewElements(graph);
	const regime = detectRegime(graph, { cap: OVERVIEW_CEILING });

	assert.equal(regime.regime, 'working', 'a real-shaped vault must read as no hub');
	assert.deepEqual(regime.hubs, [], 'and nothing in it may qualify as one');
	assert.equal(regime.treatment, 'draw');
	assert.equal(regime.forced, false);

	// COMPUTED, not defaulted. If the threshold here were the floor, "nothing qualified" would be
	// true of a constant rather than of this vault, and the sentence about deriving it from the
	// distribution would be decoration.
	assert.ok(
		regime.threshold > COLLAPSE_FLOOR,
		`the threshold fell back to the floor (${regime.threshold}), so it is not this vault's own`,
	);
	assert.equal(regime.threshold, stats.p99 * COLLAPSE_MULTIPLE);
	assert.ok(stats.max < regime.threshold, 'the busiest name has to be under the bar, or it is a hub');

	// NOTHING IS COLLAPSED, through the same call the screen makes on every draw.
	const plan = planView(overview, { ...nothingReduced(), cap: OVERVIEW_CEILING });
	assert.equal(plan.nodes.length, overview.nodes.length);
	assert.equal(plan.edges.length, overview.edges.length);
	assert.deepEqual(plan.ledger, []);
	assert.equal(plan.metaNodes.length, 0);
	assert.deepEqual(plan.hidden, { nodes: 0, edges: 0 });

	// AND THE READER CAN SEE THAT. This is the exact line the overview's caption renders, and it has
	// to carry all three of the things that make the silence checkable rather than absent: which
	// name is the busiest, what the bar is, and the verdict that follows from the two.
	const line = regimeLine(regime);
	assert.ok(line.includes(stats.busiest), `the line does not name the busiest name: ${line}`);
	assert.ok(line.includes(String(stats.max)), `the line does not carry its degree: ${line}`);
	assert.ok(line.includes(regime.threshold.toLocaleString()), `the line does not carry the bar: ${line}`);
	assert.match(line, /nothing here is big enough to need hiding/);

	// THE INSTRUMENT IS CAPABLE OF THE OTHER ANSWER. Everything above is a null result, and a null
	// from a probe that cannot succeed is not evidence. So the same three calls run again on a vault
	// that does have a hub, and all three have to come back different.
	const starred = buildGraph(hubVault({ hubDegree: 400, connectors: 30, tail: 200 }).records);
	const starredRegime = detectRegime(starred, { cap: OVERVIEW_CEILING });
	assert.equal(starredRegime.regime, 'hub');
	assert.equal(starredRegime.hubs.length, 1);
	assert.doesNotMatch(regimeLine(starredRegime), /nothing here is big enough to need hiding/);

	const collapsed = planView(overviewElements(starred), {
		...nothingReduced(),
		collapsed: new Set([hubNodeId(starredRegime.hubs[0])]),
		cap: OVERVIEW_CEILING,
	});
	assert.equal(collapsed.ledger.length, 1);
	assert.ok(collapsed.hidden.nodes > 0, 'the collapse hid nothing, so this control proves nothing');
});
