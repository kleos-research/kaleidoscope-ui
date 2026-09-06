// The ego drawing's geometry, tested as arithmetic and nothing else.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS FOR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// GraphFocus draws the relation name on every edge, and on a real vault those names run to sixty
// characters of snake_case. The previous drawing dropped all of them the moment the longest one
// did not fit the arc between two spokes — which on the vault it was reviewed against meant the
// busiest names, the ones a reader opens, were the ones drawn with no relations at all. The
// geometry now makes room: labels along their lines, a ring that moves out, labels that slide,
// and a numbered fallback for what still cannot fit. Each of those is a property, and this file
// holds each one to its claim:
//
//   1. the same elements draw the same picture;
//   2. no two placed labels overlap, and no label sits on a node or its name — checked with this
//      file's OWN overlap arithmetic, not the module's, because a collision test that trusts the
//      collider it is testing proves the collider agrees with itself;
//   3. the ring is the mockup's on a vault of short names, grows with a long one, and stops at
//      the bound the frame sets;
//   4. what could not be placed is numbered from 1 in edge order, carries its reason, and the
//      counts add up — `drawn + numbered === named`, so nothing is dropped silently;
//   5. every node's name sits on the far side of it from the centre, which is what leaves the
//      inside of the ring to the relation names.
//
// EVERY SURFACE AND RELATION NAME BELOW IS INVENTED. This repository is public and the vault the
// drawing was measured against is not.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EDGE_LABEL_CHAR,
	HUB_R,
	RING_MAX,
	RING_MIN,
	egoDrawing,
	layout,
	labelWidth,
	namePlacement,
	nodeRadius,
	placeEdgeLabels,
} from '../src/app/ui/ego-layout.mjs';

// ------------------------------------------------------------------------------------------------
// fixtures — invented, and shaped for the property under test
// ------------------------------------------------------------------------------------------------

/** A hub and `n` neighbours, each joined to the hub by one relation named by `relationFor`. */
function star(n, relationFor = () => 'moors_at', { nameFor = (i) => `quorix reading ${i}` } = {}) {
	const nodes = [{ id: 'vandrel beacon', label: 'vandrel beacon', degree: n }];
	const edges = [];
	for (let i = 0; i < n; i += 1) {
		const id = nameFor(i);
		nodes.push({ id, label: id, degree: 1 });
		edges.push({ id: `e${i}`, source: 'vandrel beacon', target: id, label: relationFor(i) });
	}
	return { nodes, edges };
}

const SHORT = ['girds', 'nestles in', 'overtakes', 'answers to', 'buttresses', 'shadows', 'ferries', 'annotates', 'quarries'];

/** A relation name of exactly `length` characters, in the shape agents actually write them. */
const longRelation = (length) => 'is_'.padEnd(length, 'xq_').slice(0, length);

// ------------------------------------------------------------------------------------------------
// this file's own collision arithmetic — deliberately not the module's
// ------------------------------------------------------------------------------------------------

/** A placed label as four corners of a rotated rectangle. */
function labelCorners(entry, thickness = 12) {
	const width = labelWidth(entry.text, EDGE_LABEL_CHAR);
	const a = (entry.angle * Math.PI) / 180;
	const ux = Math.cos(a);
	const uy = Math.sin(a);
	const nx = -uy;
	const ny = ux;
	const hw = width / 2;
	const ht = thickness / 2;
	return [
		{ x: entry.x - ux * hw - nx * ht, y: entry.y - uy * hw - ny * ht },
		{ x: entry.x + ux * hw - nx * ht, y: entry.y + uy * hw - ny * ht },
		{ x: entry.x + ux * hw + nx * ht, y: entry.y + uy * hw + ny * ht },
		{ x: entry.x - ux * hw + nx * ht, y: entry.y - uy * hw + ny * ht },
	];
}

/** Separating-axis test for two convex quadrilaterals. */
function rectanglesOverlap(a, b) {
	for (const shape of [a, b]) {
		for (let i = 0; i < shape.length; i += 1) {
			const p = shape[i];
			const q = shape[(i + 1) % shape.length];
			const axis = { x: q.y - p.y, y: -(q.x - p.x) };
			const project = (corners) => {
				let low = Number.POSITIVE_INFINITY;
				let high = Number.NEGATIVE_INFINITY;
				for (const corner of corners) {
					const value = corner.x * axis.x + corner.y * axis.y;
					low = Math.min(low, value);
					high = Math.max(high, value);
				}
				return [low, high];
			};
			const [aLow, aHigh] = project(a);
			const [bLow, bHigh] = project(b);
			if (aHigh <= bLow || bHigh <= aLow) return false;
		}
	}
	return true;
}

/** The axis-aligned box a node's name occupies, from the placement the drawing uses. */
function nameBox(node, point) {
	const name = namePlacement(node, point);
	const left =
		name.anchor === 'start' ? name.x : name.anchor === 'end' ? name.x - name.width : name.x - name.width / 2;
	const top = name.y - name.thickness * 0.85;
	return [
		{ x: left, y: top },
		{ x: left + name.width, y: top },
		{ x: left + name.width, y: top + name.thickness },
		{ x: left, y: top + name.thickness },
	];
}

/** Whether a circle at `point` with radius `r` meets the rectangle `corners` (a sampled test). */
function circleMeetsRectangle(point, r, corners) {
	for (let i = 0; i < corners.length; i += 1) {
		const p = corners[i];
		const q = corners[(i + 1) % corners.length];
		for (let t = 0; t <= 1; t += 0.05) {
			const x = p.x + (q.x - p.x) * t;
			const y = p.y + (q.y - p.y) * t;
			if (Math.hypot(x - point.x, y - point.y) < r) return true;
		}
	}
	return false;
}

/** Every overlap in a drawing, described, so a failure names the pair rather than a count. */
function overlapsIn(elements, drawing) {
	const found = [];
	const boxes = drawing.labels.map((entry) => ({ id: entry.id, corners: labelCorners(entry) }));
	for (let i = 0; i < boxes.length; i += 1) {
		for (let j = i + 1; j < boxes.length; j += 1) {
			if (rectanglesOverlap(boxes[i].corners, boxes[j].corners)) found.push(`label ${boxes[i].id} on label ${boxes[j].id}`);
		}
	}
	for (const node of elements.nodes) {
		const point = drawing.placed.get(node.id);
		const r = nodeRadius(node, point.depth);
		const name = nameBox(node, point);
		for (const box of boxes) {
			if (circleMeetsRectangle(point, r, box.corners)) found.push(`label ${box.id} on node ${node.id}`);
			if (rectanglesOverlap(name, box.corners)) found.push(`label ${box.id} on the name of ${node.id}`);
		}
	}
	return found;
}

// ------------------------------------------------------------------------------------------------
// the properties
// ------------------------------------------------------------------------------------------------

test('the same elements draw the same picture, twice', () => {
	const elements = star(9, (i) => SHORT[i]);
	const first = egoDrawing(elements, 'vandrel beacon');
	const second = egoDrawing(elements, 'vandrel beacon');
	for (const node of elements.nodes) {
		assert.deepEqual(second.placed.get(node.id), first.placed.get(node.id), `${node.id} moved between two drawings`);
	}
	assert.deepEqual(second.labels, first.labels);
	assert.deepEqual(second.markers, first.markers);
});

test('a vault of short relation names draws at the mockup’s own ring, with every relation on its line', () => {
	const elements = star(9, (i) => SHORT[i]);
	const drawing = egoDrawing(elements, 'vandrel beacon');
	assert.equal(drawing.ring, RING_MIN, 'nine short names need no more room than GraphFocus draws');
	assert.equal(drawing.counts.named, 9);
	assert.equal(drawing.counts.drawn, 9, 'every one of the mockup’s nine relations is on its line');
	assert.equal(drawing.counts.numbered, 0);
	assert.deepEqual(overlapsIn(elements, drawing), []);

	// Each label lies ON its own spoke: the point it is centred on is a few pixels off the line
	// from the hub to that neighbour, and its rotation is the spoke's own angle.
	const hub = drawing.placed.get('vandrel beacon');
	for (const entry of drawing.labels) {
		const edge = elements.edges.find((candidate) => candidate.id === entry.id);
		const other = drawing.placed.get(edge.target);
		const dx = other.x - hub.x;
		const dy = other.y - hub.y;
		const length = Math.hypot(dx, dy);
		const off = Math.abs(((entry.x - hub.x) * dy - (entry.y - hub.y) * dx) / length);
		assert.ok(off < 10, `label ${entry.id} sits ${off.toFixed(1)}px off its line`);
		const spoke = (Math.atan2(dy, dx) * 180) / Math.PI;
		const turn = Math.abs((((entry.angle - spoke) % 180) + 180) % 180);
		assert.ok(turn < 1e-6 || Math.abs(turn - 180) < 1e-6, `label ${entry.id} is not rotated along its spoke`);
		// And never upside down.
		const reading = ((entry.angle % 360) + 360) % 360;
		assert.ok(reading <= 90 || reading >= 270, `label ${entry.id} at ${entry.angle}° reads upside down`);
	}
});

test('the ring moves out for a long relation name, and every label still clears every other', () => {
	const elements = star(6, (i) => (i === 2 ? longRelation(36) : SHORT[i]));
	const drawing = egoDrawing(elements, 'vandrel beacon');
	assert.ok(drawing.ring > RING_MIN, `a 36-character name needs more than ${RING_MIN}px of spoke`);
	assert.ok(drawing.ring <= RING_MAX);
	assert.equal(drawing.counts.drawn, 6, 'the long name and the five short ones are all on their lines');
	assert.deepEqual(overlapsIn(elements, drawing), []);

	// The layout's own report of the ring is where the neighbours actually sit.
	const hub = drawing.placed.get('vandrel beacon');
	for (const node of elements.nodes.slice(1)) {
		const point = drawing.placed.get(node.id);
		assert.ok(Math.abs(Math.hypot(point.x - hub.x, point.y - hub.y) - drawing.ring) < 1e-6);
	}
});

test('a name longer than the longest line the frame allows is numbered, and says why', () => {
	const elements = star(4, (i) => (i === 1 ? longRelation(70) : SHORT[i]));
	const drawing = egoDrawing(elements, 'vandrel beacon');
	assert.equal(drawing.ring, RING_MAX, 'the ring goes as far as the frame allows and no further');
	assert.equal(drawing.counts.named, 4);
	assert.equal(drawing.counts.drawn, 3);
	assert.equal(drawing.counts.numbered, 1);
	assert.equal(drawing.markers.length, 1);
	assert.equal(drawing.markers[0].id, 'e1');
	assert.equal(drawing.markers[0].number, 1);
	assert.equal(drawing.markers[0].reason, 'longer-than-line');
	assert.equal(drawing.markers[0].text, longRelation(70), 'the legend carries the whole name, unclipped');

	// The mark sits on its own line, so a reader can find which line the number belongs to.
	const hub = drawing.placed.get('vandrel beacon');
	const other = drawing.placed.get(elements.edges[1].target);
	const dx = other.x - hub.x;
	const dy = other.y - hub.y;
	const off = Math.abs(((drawing.markers[0].x - hub.x) * dy - (drawing.markers[0].y - hub.y) * dx) / Math.hypot(dx, dy));
	assert.ok(off < 1e-6, 'the numbered mark is centred on its line');
});

test('what is numbered is numbered in edge order, from 1, and the counts add up', () => {
	// Two parallel statements between one pair share one line, and a third neighbour's name is too
	// long for any line: three different ways to fall back, and they number 1, 2, 3 in edge order.
	const elements = star(3, (i) => (i === 0 ? longRelation(70) : SHORT[i]));
	elements.edges.push({ id: 'e9', source: 'vandrel beacon', target: 'quorix reading 1', label: longRelation(30) });
	elements.edges.push({ id: 'e10', source: 'vandrel beacon', target: 'quorix reading 1', label: longRelation(31) });
	elements.nodes[2].degree = 3;
	const drawing = egoDrawing(elements, 'vandrel beacon');

	assert.equal(drawing.counts.named, 5);
	assert.equal(drawing.counts.drawn + drawing.counts.numbered, drawing.counts.named, 'nothing is dropped silently');
	assert.ok(drawing.counts.numbered >= 1);
	assert.deepEqual(
		drawing.markers.map((marker) => marker.number),
		drawing.markers.map((_, index) => index + 1),
	);
	const order = new Map(elements.edges.map((edge, index) => [edge.id, index]));
	const positions = drawing.markers.map((marker) => order.get(marker.id));
	assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'numbered in the order the edges were given');
	for (const marker of drawing.markers) assert.ok(['longer-than-line', 'no-clear-stretch'].includes(marker.reason));
	assert.deepEqual(overlapsIn(elements, drawing), []);
});

test('fourteen spokes with forty-character names still place their labels apart', () => {
	// The shape of the busiest name in a real vault: max degree, and names several times the
	// mockup's length on both the spokes and the nodes.
	const elements = star(14, (i) => longRelation(12 + ((i * 7) % 30)), {
		nameFor: (i) => `${'mirdel staging trellis'.slice(0, 8 + ((i * 5) % 14))} ${i}`,
	});
	const drawing = egoDrawing(elements, 'vandrel beacon');
	assert.deepEqual(overlapsIn(elements, drawing), []);
	assert.equal(drawing.counts.drawn + drawing.counts.numbered, 14);
	assert.ok(drawing.counts.drawn >= 12, `only ${drawing.counts.drawn} of 14 relations found room on their lines`);
});

test('a node’s name sits on the far side of it from the centre', () => {
	const elements = star(8, (i) => SHORT[i]);
	const placed = layout(elements.nodes, elements.edges, 'vandrel beacon');
	const hub = placed.get('vandrel beacon');
	for (const node of elements.nodes.slice(1)) {
		const point = placed.get(node.id);
		const name = namePlacement(node, point);
		const outward = (name.x - hub.x) * (point.x - hub.x) + (name.y - hub.y) * (point.y - hub.y);
		assert.ok(outward > 0, `the name of ${node.id} is anchored on the hub's side of it`);
		// Beside the node at the sides, and never anchored across it.
		if (point.x - hub.x > 60) assert.equal(name.anchor, 'start');
		if (point.x - hub.x < -60) assert.equal(name.anchor, 'end');
	}
	const hubName = namePlacement(elements.nodes[0], hub);
	assert.equal(hubName.anchor, 'middle');
	assert.ok(hubName.y > hub.y + HUB_R, 'the hub’s own name is under it, as GraphFocus draws it');
});

test('two centres draw two components side by side, each around its own name', () => {
	const elements = star(3, (i) => SHORT[i]);
	elements.nodes.push({ id: 'pell gate', label: 'pell gate', degree: 1 }, { id: 'harrow lantern', label: 'harrow lantern', degree: 1 });
	elements.edges.push({ id: 'p0', source: 'harrow lantern', target: 'pell gate', label: 'kindles' });
	const placed = layout(elements.nodes, elements.edges, ['vandrel beacon', 'pell gate']);
	assert.equal(placed.get('vandrel beacon').depth, 0);
	assert.equal(placed.get('pell gate').depth, 0, 'the pinned name is the centre of its own component');
	assert.equal(placed.get('harrow lantern').depth, 1);
	const gap = Math.hypot(
		placed.get('pell gate').x - placed.get('vandrel beacon').x,
		placed.get('pell gate').y - placed.get('vandrel beacon').y,
	);
	assert.ok(gap > 2 * RING_MAX, 'the two components do not overlap at any ring the layout can reach');
});

test('an edge with no relation recorded gets neither a label nor a number, and is counted', () => {
	const elements = star(3, (i) => (i === 1 ? null : SHORT[i]));
	const placed = layout(elements.nodes, elements.edges, 'vandrel beacon');
	const result = placeEdgeLabels(elements.nodes, elements.edges, placed);
	assert.equal(result.counts.named, 2);
	assert.equal(result.counts.unnamed, 1);
	assert.equal(result.counts.drawn, 2);
	assert.equal(result.counts.numbered, 0);
	assert.ok(!result.labels.some((entry) => entry.id === 'e1'));
	assert.ok(!result.markers.some((marker) => marker.id === 'e1'));
});
