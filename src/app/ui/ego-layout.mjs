/**
 * THE EGO DRAWING'S GEOMETRY, AS ARITHMETIC. No React, no SVG, no DOM, no measurement of text.
 *
 * Three things live here and all of them used to be inside the component that draws them: where
 * every node sits, where every node's name sits beside it, and where every relation name sits
 * along its line. They are here because all three are claims that can be checked — "the same
 * elements draw the same picture" and "no two names overlap" are properties of arithmetic — and a
 * `.jsx` file cannot be imported by `node --test`, so arithmetic inside a React component was the
 * one piece of the graph screen no test could reach. The component imports from here and the
 * tests import from here, and the two see the same function.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE RELATION NAMES ARE DRAWN AT ALL, AND HOW
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * GraphFocus draws the relation on every edge — "is keyed on", "stopped using" — and they are the
 * second most interesting thing in the picture: a reader who opened it for the relations and got
 * nine bare lines has been handed a diagram of the word "connected". The previous version measured
 * whether the LONGEST name fit the arc between two spokes and, when it did not, dropped all of
 * them. On a real vault the relation vocabulary is open and written by agents, and it runs to
 * sixty characters of snake_case, so the busiest names — the ones a reader actually opens — were
 * exactly the ones that lost every label.
 *
 * So the drawing makes room instead of giving up, in this order:
 *
 *   1. LABELS RUN ALONG THEIR LINE, not across it. A label drawn horizontally at a spoke's midpoint
 *      needs a slot the width of the label in the ring of slots around the hub, and the slots are
 *      2πr/n wide. Rotated along the spoke it needs a slot the HEIGHT of the label, which is a
 *      constant twelve pixels, and it uses the spoke's length instead — which is the one dimension
 *      this drawing has plenty of.
 *
 *   2. THE FIRST RING MOVES OUT to fit the longest name that touches the hub, up to a bound the
 *      frame can still hold at life size. A forty-character name needs about 240 px of line; the
 *      mockup's ring is 150 px from the hub. The ring is measured from the names, so a vault whose
 *      relations are all short draws exactly the mockup.
 *
 *   3. A LABEL THAT WOULD COLLIDE SLIDES ALONG ITS OWN LINE, AND MAY CROSS TO ITS OTHER SIDE. Every
 *      label is a capsule; every node, every node's name, every line and every label already
 *      placed is an obstacle; and a label tries the middle of its free span first and then steps
 *      outward and inward until it finds a clear stretch, trying either side of the line at each
 *      step. The second side is what saves two statements between one pair — they straddle their
 *      shared line instead of queueing along it — and a name on a chord that a spoke's label
 *      already sits beside. Longest names are placed first because they have the fewest choices.
 *
 *   4. WHAT STILL CANNOT FIT IS NUMBERED, NOT DROPPED. A name longer than its whole line, or one
 *      with no clear stretch left, gets a small numbered mark on the line and its name in a legend
 *      the drawing carries in its corner — and the legend's heading says how many. A drawing with
 *      no relation names looks exactly like a drawing whose relations are unknown; a drawing that
 *      says "3 relations with no room on their lines" is telling the truth about itself.
 *
 * NODE NAMES SIT ON THE FAR SIDE OF THEIR NODE FROM THE HUB, as GraphFocus draws them — "manual
 * cache purge" to the left of the left-hand node, "cross-branch reuse" to the right of the
 * right-hand one, "lockfile hash" above the top. A name hung under every node, which is what the
 * previous version did, put a forty-character name straight across the two spokes beside it; on
 * the far side of the node the inside of the ring belongs to the relation names and the outside
 * to the node names, and the two never meet. The ring also grows until neighbouring names clear
 * each other, which the same forty-character names need at the top and bottom of the ring.
 *
 * Text widths are ESTIMATED from a per-character constant rather than measured, because this runs
 * with no font to measure against and its output has to be identical on every machine. The
 * constants were calibrated in a browser against the bundled UI face at the sizes the stylesheet
 * draws — every relation name and every surface in a real vault, measured with `measureText` —
 * and sit just above the widest per-character average any string of its length reached, so the
 * estimate errs toward reporting a collision that is not there rather than missing one.
 */

/** Radius of the node the drawing is about. */
export const HUB_R = 26;
/** Radius of every other node before its degree grows it. */
export const NODE_R = 9;

/**
 * The first ring's radius when nothing needs more room. GraphFocus's own: its hub is at (420, 380)
 * and every neighbour is 230 units from it. An earlier version drew the ring at 150, which is why
 * two thirteen-character names at the foot of a nine-spoke drawing touched — the mockup had never
 * been tight enough for that to happen.
 */
export const RING_MIN = 230;
/**
 * The furthest the first ring is allowed out. Past this a depth-1 drawing no longer fits the frame
 * beside the panel at life size, and the whole point of moving the ring is to keep labels legible.
 */
export const RING_MAX = 330;
/** How much further out each later ring sits than the one inside it. */
const RING_STEP = [110, 90];

/** About the width of one character, in px, at the three faces the drawing uses. */
export const EDGE_LABEL_CHAR = 6.0; /* 10.5px UI face, relation names and the "+n" count */
const NAME_LABEL_CHAR = 7.1; /* 12.5px UI face, node names */
const HUB_LABEL_CHAR = 8.6; /* 15px semibold, the hub's name */

const EDGE_LABEL_THICKNESS = 12;
const NAME_LABEL_THICKNESS = 14;
const HUB_LABEL_THICKNESS = 17;

/**
 * Clear space between the end of a label and the edge of a node. It has to exceed the node's own
 * collision margin plus half a label's thickness, or a label that exactly fills its line touches
 * the node at both ends by arithmetic and falls back for no visible reason.
 */
const GAP = 9;
/** Clear space between a node's edge and its name. */
const NAME_PAD = 6;
/** How far below the hub's centre its name's baseline sits — GraphFocus's own 22 past the radius. */
const HUB_NAME_DROP = 22;
/** The space between a node's name and the "+n" count drawn after it — the tspan's own `dx`. */
const BEYOND_GAP = 5;
/** How far the ring grows per attempt while it is crowded. */
const RING_GROW = 10;
/** How far a label sits off the line it belongs to, so the line does not strike through it. */
const LABEL_LIFT = 7;
/**
 * The two sides of a line a label may sit on, in the order tried: above first, so a drawing with
 * room draws the mockup — every name on the upper side of its spoke — and below only where above
 * is taken. A label is read the same way up on either side; only its distance from the line flips.
 */
const SIDES = [1, -1];
/** How far a colliding label slides along its line per attempt. */
const SLIDE_STEP = 10;
/** A numbered mark's radius. Two digits of the mono face fit inside it. */
export const MARKER_R = 8;

/** A node's drawn radius. The hub is fixed; everything else grows a little with degree. */
export const nodeRadius = (node, depth) =>
	depth === 0 ? HUB_R : NODE_R + Math.min(6, (node?.degree ?? 1) / 2);

/** The estimated width of a label, in the drawing's own units. */
export const labelWidth = (text, perChar = EDGE_LABEL_CHAR) => String(text ?? '').length * perChar;

/**
 * Place every node, once, by breadth-first depth from its own component's centre.
 *
 * Components are packed left to right, largest first, on a row that wraps — which is the honest
 * arrangement for a set of islands that have no relationship to each other. Nothing here is
 * random and nothing is animated, so the same elements always draw the same picture.
 *
 * @param centres  the node this drawing is about, or SEVERAL — the focused name and a pinned one.
 *                 Each component is centred on the first of them it contains, in the order given,
 *                 and a component containing none of them is centred on its most-connected node.
 *                 With one centre this is the drawing GraphFocus shows; with two it is the same
 *                 drawing twice, side by side, which is what a comparison of two names looks like
 *                 when the two share no component — the common case by a wide margin.
 * @returns {Map<string, {x, y, depth, angle}>}, with `ring` — the first ring's radius around the
 *          first centre — on the map, so a caller can say how far out the drawing had to go.
 */
export function layout(nodes, edges, centres = null) {
	const wanted = Array.isArray(centres) ? centres.filter(Boolean) : centres ? [centres] : [];
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const neighbours = new Map(nodes.map((node) => [node.id, []]));
	const incident = new Map(nodes.map((node) => [node.id, []]));
	for (const edge of edges) {
		if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
		neighbours.get(edge.source).push(edge.target);
		neighbours.get(edge.target).push(edge.source);
		incident.get(edge.source).push(edge);
		if (edge.target !== edge.source) incident.get(edge.target).push(edge);
	}

	// Components, in a stable order: by size, then by the id of the first member.
	const seen = new Set();
	const components = [];
	for (const node of nodes) {
		if (seen.has(node.id)) continue;
		const members = [];
		const queue = [node.id];
		seen.add(node.id);
		while (queue.length > 0) {
			const id = queue.shift();
			members.push(id);
			for (const next of neighbours.get(id) ?? []) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		components.push(members);
	}
	components.sort((a, b) => b.length - a.length || String(a[0]).localeCompare(String(b[0])));

	/*
	 * THE FIRST RING IS MEASURED FROM THE NAMES ON THE SPOKES, per component. The room a label
	 * needs along a spoke is its own width plus the two node radii it must clear and a gap at each
	 * end; the ring goes out to the longest of those, bounded above so the drawing still fits its
	 * frame and below so a vault of short names draws the mockup's spacing exactly.
	 */
	const ringFor = (hub) => {
		let needed = RING_MIN;
		for (const edge of incident.get(hub) ?? []) {
			const other = byId.get(edge.source === hub ? edge.target : edge.source);
			const room = HUB_R + nodeRadius(other, 1) + 2 * GAP + labelWidth(edge.label, EDGE_LABEL_CHAR);
			needed = Math.max(needed, room);
		}
		return Math.min(RING_MAX, needed);
	};

	const placed = new Map();
	const span = (RING_MAX + RING_STEP[0] + RING_STEP[1]) * 2 + 80;
	const perRow = Math.max(1, Math.ceil(Math.sqrt(components.length)));
	let ring = RING_MIN;

	components.forEach((members, index) => {
		const cx = (index % perRow) * span;
		const cy = Math.floor(index / perRow) * span;

		// The centre is the first wanted node in this component, otherwise the most connected one —
		// which is what makes a component's drawing about the thing it is actually about.
		const hub =
			wanted.find((id) => members.includes(id)) ??
			members.reduce((best, id) =>
				(neighbours.get(id)?.length ?? 0) > (neighbours.get(best)?.length ?? 0) ? id : best,
			);

		const depth = new Map([[hub, 0]]);
		const queue = [hub];
		while (queue.length > 0) {
			const id = queue.shift();
			for (const next of neighbours.get(id) ?? []) {
				if (depth.has(next)) continue;
				depth.set(next, Math.min(depth.get(id) + 1, RING_STEP.length + 1));
				queue.push(next);
			}
		}

		const rings = new Map();
		for (const id of members) {
			const d = depth.get(id) ?? RING_STEP.length + 1;
			if (!rings.has(d)) rings.set(d, []);
			rings.get(d).push(id);
		}
		for (const ids of rings.values()) ids.sort();

		/** Every ring placed around this centre, for a given first-ring radius. */
		const placeRings = (first) => {
			const radii = [0, first, first + RING_STEP[0], first + RING_STEP[0] + RING_STEP[1]];
			const local = new Map();
			for (const [d, ids] of rings) {
				if (d === 0) {
					local.set(ids[0], { x: cx, y: cy, depth: 0, angle: null });
					continue;
				}
				const radius = radii[d];
				// Start each ring at the top and step evenly. The half-step offset on odd rings stops
				// ring 2 hiding directly behind ring 1.
				const offset = d % 2 === 0 ? Math.PI / ids.length : 0;
				ids.forEach((id, position) => {
					const angle = -Math.PI / 2 + offset + (position / ids.length) * Math.PI * 2;
					local.set(id, {
						x: cx + Math.cos(angle) * radius,
						y: cy + Math.sin(angle) * radius,
						depth: d,
						angle,
					});
				});
			}
			return local;
		};

		/*
		 * THE RING GROWS UNTIL IT IS NOT CROWDED, and crowded means either of two things. The node
		 * names on it overlap each other — fourteen forty-character names around a 150 px ring do,
		 * at the top and the bottom, where neighbours are stacked a few pixels apart — or a relation
		 * name that would fit its spoke cannot find a clear stretch of it, because the hub's own name
		 * lies across the foot of every downward spoke. `ringFor` above is the floor the names' bare
		 * widths set; this is the floor the crowding sets. Bounded by the same ceiling as the labels,
		 * so what is still crowded at RING_MAX is what the frame could not hold.
		 */
		const spokes = incident.get(hub) ?? [];
		const crowded = (local) =>
			namesOverlap(local, byId, [hub, ...(rings.get(1) ?? [])]) ||
			spokesBlocked(members.map((id) => byId.get(id)), spokes, local);
		let first = ringFor(hub);
		let local = placeRings(first);
		while (first < RING_MAX && crowded(local)) {
			first = Math.min(RING_MAX, first + RING_GROW);
			local = placeRings(first);
		}
		for (const [id, point] of local) placed.set(id, point);
		if (index === 0) ring = first;
	});

	placed.ring = ring;
	return placed;
}

/**
 * WHERE A NODE'S NAME GOES: on the far side of the node from the centre of its component.
 *
 * Eight-way, from the node's angle: beside it when it sits to the left or right, above or below
 * when it sits at the top or bottom, and offset on both axes in between — which is exactly how
 * GraphFocus places "CI runner pool" below and to the right of a lower-right node. The hub's own
 * name is centred under it. Returned as the text's anchor point and its SVG `text-anchor`, and
 * used by both the drawing and the collision arithmetic so the two cannot disagree.
 *
 * @returns {{x, y, anchor, width, thickness}} `y` is the BASELINE; `width` is the estimate.
 */
export function namePlacement(node, point) {
	const text = String(node?.label ?? node?.id ?? '').split('\n')[0];
	const radius = nodeRadius(node, point.depth);
	// The "+n" count of what lies beyond a node is drawn after its name, in the same text, so the
	// name's footprint carries it — a relation name must not run under the count either.
	const beyond = node?.beyond > 0 ? BEYOND_GAP + labelWidth(`+${node.beyond}`, EDGE_LABEL_CHAR) : 0;
	if (point.depth === 0 || point.angle === undefined || point.angle === null) {
		return {
			x: point.x,
			y: point.y + radius + (point.depth === 0 ? HUB_NAME_DROP : NAME_PAD + 8),
			anchor: 'middle',
			width: labelWidth(text, point.depth === 0 ? HUB_LABEL_CHAR : NAME_LABEL_CHAR) + beyond,
			thickness: point.depth === 0 ? HUB_LABEL_THICKNESS : NAME_LABEL_THICKNESS,
		};
	}
	const cos = Math.cos(point.angle);
	const sin = Math.sin(point.angle);
	const reach = radius + NAME_PAD;
	const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
	// Above the node the baseline sits at the bottom of the glyphs; below, at the top of them.
	const drop = sin > 0.35 ? 10 : sin < -0.35 ? -3 : 4;
	return {
		x: point.x + cos * reach,
		y: point.y + sin * reach + drop,
		anchor,
		width: labelWidth(text, NAME_LABEL_CHAR) + beyond,
		thickness: NAME_LABEL_THICKNESS,
	};
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// capsules — every obstacle is a thick line segment, and a node is a segment of zero length
// ────────────────────────────────────────────────────────────────────────────────────────────────

const pointToSegment = (px, py, ax, ay, bx, by) => {
	const vx = bx - ax;
	const vy = by - ay;
	const length = vx * vx + vy * vy;
	const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length));
	return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
};

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const segmentsCross = (a, b) => {
	const o1 = orient(a.ax, a.ay, a.bx, a.by, b.ax, b.ay);
	const o2 = orient(a.ax, a.ay, a.bx, a.by, b.bx, b.by);
	const o3 = orient(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
	const o4 = orient(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
	return o1 * o2 < 0 && o3 * o4 < 0;
};

/** Whether two capsules overlap. */
function capsulesTouch(a, b) {
	if (segmentsCross(a, b)) return true;
	const gap = Math.min(
		pointToSegment(a.ax, a.ay, b.ax, b.ay, b.bx, b.by),
		pointToSegment(a.bx, a.by, b.ax, b.ay, b.bx, b.by),
		pointToSegment(b.ax, b.ay, a.ax, a.ay, a.bx, a.by),
		pointToSegment(b.bx, b.by, a.ax, a.ay, a.bx, a.by),
	);
	return gap < a.half + b.half;
}

/** A node's name as a capsule: horizontal, the width of its estimate, around its glyphs. */
function nameCapsule(node, point) {
	const name = namePlacement(node, point);
	const left =
		name.anchor === 'start' ? name.x : name.anchor === 'end' ? name.x - name.width : name.x - name.width / 2;
	// The baseline sits about a third of the way up the box the glyphs occupy.
	const cy = name.y - name.thickness * 0.35;
	return { ax: left, ay: cy, bx: left + name.width, by: cy, half: name.thickness / 2 };
}

/** Whether any two of these nodes' names, as placed, sit on each other. */
function namesOverlap(placed, byId, ids) {
	const capsules = ids.map((id) => nameCapsule(byId.get(id), placed.get(id)));
	for (let i = 0; i < capsules.length; i += 1) {
		for (let j = i + 1; j < capsules.length; j += 1) {
			if (capsulesTouch(capsules[i], capsules[j])) return true;
		}
	}
	return false;
}

/**
 * Whether a relation name on a spoke from the hub, which would fit the spoke's bare length, still
 * has nowhere to go — the crowding case a longer ring relieves. A name longer than the whole spoke
 * is not counted: growing the ring is what `ringFor` already did for that, up to its bound.
 */
function spokesBlocked(nodes, spokes, placed) {
	return placeEdgeLabels(nodes, spokes, placed).markers.some((marker) => marker.reason === 'no-clear-stretch');
}

/**
 * WHERE EVERY RELATION NAME SITS, or the number it wears instead.
 *
 * @param {Array} nodes  `{ id, label, degree, beyond? }` — `beyond` widens the name's footprint
 * @param {Array} edges  `{ id, source, target, label }`
 * @param {Map}   placed from `layout`
 * @returns {{labels, markers, counts}}
 *   `labels`  — `{ id, text, x, y, angle }`, the label's centre and its rotation in degrees;
 *   `markers` — `{ id, text, number, x, y, reason }`, one per name that could not be drawn on its
 *               line, numbered from 1 in the order the edges were given. `reason` is
 *               `longer-than-line` or `no-clear-stretch`;
 *   `counts`  — `{ named, drawn, numbered, unnamed }`. `named` is every edge that carries a
 *               relation; `drawn + numbered === named`; `unnamed` is edges with no relation
 *               recorded, which get neither a label nor a number.
 */
export function placeEdgeLabels(nodes, edges, placed) {
	const byId = new Map(nodes.map((node) => [node.id, node]));

	const obstacles = [];
	for (const node of nodes) {
		const point = placed.get(node.id);
		if (!point) continue;
		obstacles.push({
			ax: point.x,
			ay: point.y,
			bx: point.x,
			by: point.y,
			half: nodeRadius(node, point.depth) + 2,
			kind: 'node',
		});
		obstacles.push({ ...nameCapsule(node, point), kind: 'name' });
	}

	/*
	 * The free span of every drawn edge: the part of the line between the two node edges, with a gap
	 * at each end. A label lives on this span and nowhere else. The line itself is an obstacle for
	 * OTHER labels — a name with a line drawn through it is a name nobody can read — but not for its
	 * own, which sits a few pixels off it.
	 */
	const spans = [];
	for (const edge of edges) {
		const a = placed.get(edge.source);
		const b = placed.get(edge.target);
		if (!a || !b || edge.source === edge.target) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = Math.hypot(dx, dy);
		if (length === 0) continue;
		const ux = dx / length;
		const uy = dy / length;
		const ra = nodeRadius(byId.get(edge.source), a.depth) + GAP;
		const rb = nodeRadius(byId.get(edge.target), b.depth) + GAP;
		const from = { x: a.x + ux * ra, y: a.y + uy * ra };
		const free = length - ra - rb;
		// The line as an obstacle, thin, and only its free part — the ends are inside nodes already.
		obstacles.push({
			ax: from.x,
			ay: from.y,
			bx: from.x + ux * Math.max(0, free),
			by: from.y + uy * Math.max(0, free),
			half: 1,
			line: edge.id,
			kind: 'line',
		});
		// Slide away from the busier end first: on a star that is the hub, where the spokes converge.
		const outward =
			(byId.get(edge.source)?.degree ?? 0) >= (byId.get(edge.target)?.degree ?? 0) ? 1 : -1;
		spans.push({ edge, from, ux, uy, free, outward });
	}

	const counts = { named: 0, drawn: 0, numbered: 0, unnamed: 0 };
	const labels = [];
	const markers = [];

	/**
	 * A label's capsule with its centre `c` units along the span, lifted off the line. The lift is on
	 * the side the text reads as "up", which is what keeps the glyphs above their line whichever way
	 * the line runs.
	 */
	const capsuleAt = (span, c, width, thickness, lift) => {
		const { from, ux, uy } = span;
		const flip = ux < 0 ? -1 : 1;
		const nx = uy * flip;
		const ny = -ux * flip;
		const cx = from.x + ux * c + nx * lift;
		const cy = from.y + uy * c + ny * lift;
		return {
			ax: cx - ux * (width / 2),
			ay: cy - uy * (width / 2),
			bx: cx + ux * (width / 2),
			by: cy + uy * (width / 2),
			half: thickness / 2,
			cx,
			cy,
		};
	};

	const clearOf = (capsule, own) =>
		!obstacles.some((obstacle) => obstacle.line !== own && capsulesTouch(capsule, obstacle));

	/** Candidate centres along a span: the middle first, then alternately further out and in. */
	const candidates = (span, width) => {
		const low = width / 2;
		const high = span.free - width / 2;
		const middle = span.free / 2;
		const list = [middle];
		for (let step = SLIDE_STEP; middle + step <= high || middle - step >= low; step += SLIDE_STEP) {
			const out = middle + step * span.outward;
			const back = middle - step * span.outward;
			if (out >= low && out <= high) list.push(out);
			if (back >= low && back <= high) list.push(back);
		}
		return list;
	};

	// Longest first: the label with the fewest places it can go chooses first.
	const named = spans
		.filter((span) => String(span.edge.label ?? '').length > 0)
		.sort(
			(a, b) =>
				String(b.edge.label).length - String(a.edge.label).length ||
				String(a.edge.id).localeCompare(String(b.edge.id)),
		);
	counts.named = named.length;
	counts.unnamed = spans.length - named.length;

	const fallen = [];
	for (const span of named) {
		const text = String(span.edge.label);
		const width = labelWidth(text, EDGE_LABEL_CHAR);
		let placedAt = null;
		if (width <= span.free) {
			// Nearest the middle first, and at each position the upper side before the lower, so a
			// label moves off the midpoint only when both sides of it are taken.
			for (const c of candidates(span, width)) {
				for (const side of SIDES) {
					const capsule = capsuleAt(span, c, width, EDGE_LABEL_THICKNESS, LABEL_LIFT * side);
					if (!clearOf(capsule, span.edge.id)) continue;
					placedAt = capsule;
					break;
				}
				if (placedAt) break;
			}
		}
		if (!placedAt) {
			// Why it fell back, so a test can tell the two apart and the ring can grow for one of
			// them: a name longer than its whole line is a fact about the name; one with no clear
			// stretch is a fact about how crowded the drawing is around it.
			span.reason = width > span.free ? 'longer-than-line' : 'no-clear-stretch';
			fallen.push(span);
			continue;
		}
		obstacles.push({ ...placedAt, kind: 'label' });
		const reading = Math.atan2(span.uy, span.ux) * (180 / Math.PI);
		labels.push({
			id: span.edge.id,
			text,
			x: placedAt.cx,
			y: placedAt.cy,
			// Never upside down: a line running leftward is read from its other end.
			angle: span.ux < 0 ? reading + 180 : reading,
		});
	}
	counts.drawn = labels.length;

	/*
	 * THE ONES THAT DID NOT FIT, numbered in the order the edges were given — which is the order the
	 * panel beside the drawing lists them in. A mark is small enough to find a clear spot almost
	 * anywhere on its line; if even that fails it sits at the middle, over whatever is there,
	 * because a mark the reader cannot find is worse than one that touches a line.
	 */
	const order = new Map(edges.map((edge, index) => [edge.id, index]));
	fallen.sort((a, b) => order.get(a.edge.id) - order.get(b.edge.id));
	fallen.forEach((span, index) => {
		const size = MARKER_R * 2;
		let placedAt = null;
		for (const c of candidates(span, size)) {
			const capsule = capsuleAt(span, c, 0, size, 0);
			if (!clearOf(capsule, span.edge.id)) continue;
			placedAt = capsule;
			break;
		}
		if (!placedAt) placedAt = capsuleAt(span, span.free / 2, 0, size, 0);
		obstacles.push({ ...placedAt, kind: 'marker' });
		markers.push({
			id: span.edge.id,
			text: String(span.edge.label),
			number: index + 1,
			x: placedAt.cx,
			y: placedAt.cy,
			reason: span.reason,
		});
	});
	counts.numbered = markers.length;

	return { labels, markers, counts };
}

/**
 * The whole drawing, in one call: where the nodes are and where the names are.
 *
 * @param {{nodes, edges}}       elements
 * @param {string|string[]|null} centres  see `layout`
 */
export function egoDrawing(elements, centres = null) {
	const nodes = elements?.nodes ?? [];
	const edges = elements?.edges ?? [];
	const placed = layout(nodes, edges, centres);
	const labelling = placeEdgeLabels(nodes, edges, placed);
	return { placed, ring: placed.ring, ...labelling };
}

/** The box that holds every placed node and every name beside one. */
export function boundsOf(nodes, placed) {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const node of nodes) {
		const point = placed.get(node.id);
		if (!point) continue;
		const radius = nodeRadius(node, point.depth);
		// A name beside a node reaches past it — a forty-character name by two hundred pixels — and
		// a box drawn to the nodes alone would cut the names off at the frame's edge.
		const name = namePlacement(node, point);
		const left =
			name.anchor === 'start' ? name.x : name.anchor === 'end' ? name.x - name.width : name.x - name.width / 2;
		minX = Math.min(minX, point.x - radius, left);
		maxX = Math.max(maxX, point.x + radius, left + name.width);
		minY = Math.min(minY, point.y - radius, name.y - name.thickness);
		maxY = Math.max(maxY, point.y + radius, name.y + name.thickness * 0.4);
	}
	if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
	const pad = 30;
	return {
		x: minX - pad,
		y: minY - pad,
		width: Math.max(1, maxX - minX + pad * 2),
		height: Math.max(1, maxY - minY + pad * 2),
	};
}

/**
 * Grow a bounding box to the frame it will be drawn in, so the scale never goes above 1:1.
 *
 * It only ever grows: a drawing WIDER than its frame still scales down, which is what makes a
 * two-step neighbourhood fit. Both axes are taken to the frame's aspect first, because
 * `preserveAspectRatio="xMidYMid meet"` would otherwise letterbox the short one and reintroduce a
 * scale on both.
 */
export function atMostLifeSize(bounds, frame) {
	if (!frame || !(frame.width > 0) || !(frame.height > 0)) return bounds;
	const aspect = frame.width / frame.height;
	let width = Math.max(bounds.width, frame.width);
	let height = Math.max(bounds.height, frame.height);
	width = Math.max(width, height * aspect);
	height = Math.max(height, width / aspect);
	return {
		x: bounds.x + bounds.width / 2 - width / 2,
		y: bounds.y + bounds.height / 2 - height / 2,
		width,
		height,
	};
}
