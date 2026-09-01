import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * THE ONLY NODE-LINK DRAWING IN THIS PRODUCT, and it replaces a graph engine.
 *
 * WHY THERE IS NO GRAPH LIBRARY BEHIND THIS. The research this design was approved against is
 * unambiguous about what may be drawn: a node-link canvas earns its place in exactly one state — an
 * ego network at depth 1–2 around an entity the reader has already chosen — and never as a whole
 * vault view, because a readable label chip is about 120 × 20 px and a vault's worth of them needs
 * roughly twice the ink of the whole canvas. Bound the drawing to one neighbourhood and the largest
 * thing it ever has to lay out is a hub plus its neighbours, with a hard cap well under a hundred
 * nodes. That is trigonometry. It was costing 571 kB of shipped JavaScript — more than half the
 * bundle — to have a physics engine do it.
 *
 * WHY THE LAYOUT IS DETERMINISTIC AND NOT A FORCE SIMULATION. With hundreds of disconnected
 * components a force layout has no force between 99% of node pairs, so what actually decides where
 * the islands sit is the gravity term — a knob. The picture is then arranged by a parameter rather
 * than by the data, and it moves every time it is drawn. Rings placed by breadth-first distance
 * from each component's own hub are reproducible, are the same drawing on every reload, and are
 * exactly what GraphFocus.dc.html shows: a centre with its neighbours around it.
 *
 * WHAT IT DOES NOT DO, on purpose: no clustering (the components already ARE the clusters, and each
 * is very nearly a tree), no edge bundling (there are no parallel edges to bundle), and no
 * path-between-two-names (two names share a component about 2% of the time, and when they do the
 * component is a tree so the path is a breadcrumb rather than a drawing).
 */

/**
 * HOW MUCH OF A RELATION NAME FITS ON AN EDGE.
 *
 * The approved drawing is labelled with relations like "is keyed on" and "stopped using", which fit.
 * A real vault's relation vocabulary is open and written by agents, and it carries names several
 * times that length — nine of those, all crossing at the centre of a nine-spoke drawing, is a grey
 * smear with the hub underneath it. The full value is on the `<title>`, and the panel beside the
 * drawing carries every one of them in full and in order, so nothing here is the only copy.
 */
const EDGE_LABEL_CHARS = 22;

/** Ring radii, in the drawing's own units. Depth 0 is the hub. */
const RING = [0, 150, 260, 350];

const clipLabel = (value) => {
	const text = String(value ?? '');
	return text.length <= EDGE_LABEL_CHARS ? text : `${text.slice(0, EDGE_LABEL_CHARS - 1)}…`;
};

/** About the width of one character of the edge-label face, in this drawing's own units. */
const EDGE_LABEL_CHAR_WIDTH = 5.4;

/**
 * WHETHER THE RELATION NAMES CAN BE DRAWN AT ALL — measured, not guessed at from a count.
 *
 * The caller used to decide this with `edges.length <= 40`, which is a proxy for the property and
 * is wrong in both directions. What actually decides it is how much ROOM each label has, and on an
 * ego drawing that is the arc between two spokes: the labels sit on a ring at 62% of the first ring
 * out, so `n` spokes divide `2πr` between them. GraphFocus is labelled with relations like "is keyed
 * on" — 11 characters — and they fit. A real vault's relation names run to forty characters of
 * snake_case, and ten of those on one hub produce a grey smear across the middle of the picture
 * with the hub underneath it, at any edge count under the old threshold.
 *
 * When they do not fit, nothing is drawn and nothing is lost: every relation is listed in full, in
 * order, in the panel beside the drawing.
 */
export function edgeLabelsFit(edges) {
	const spokes = edges?.length ?? 0;
	if (spokes === 0) return true;
	const arc = (2 * Math.PI * RING[1] * 0.62) / spokes;
	let longest = 0;
	for (const edge of edges) longest = Math.max(longest, clipLabel(edge?.label ?? '').length);
	return longest * EDGE_LABEL_CHAR_WIDTH <= arc;
}


const HUB_R = 26;
const NODE_R = 9;

/**
 * Place every node, once, by breadth-first depth from its own component's most-connected node.
 *
 * Components are packed left to right, largest first, on a row that wraps — which is the honest
 * arrangement for a set of islands that have no relationship to each other. Nothing here is
 * random and nothing is animated, so the same elements always draw the same picture.
 */
export function layout(nodes, edges, focusId = null) {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const neighbours = new Map(nodes.map((node) => [node.id, []]));
	for (const edge of edges) {
		if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
		neighbours.get(edge.source).push(edge.target);
		neighbours.get(edge.target).push(edge.source);
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

	const placed = new Map();
	const span = RING[RING.length - 1] * 2 + 80;
	const perRow = Math.max(1, Math.ceil(Math.sqrt(components.length)));

	components.forEach((members, index) => {
		const cx = (index % perRow) * span;
		const cy = Math.floor(index / perRow) * span;

		// The centre is the focused node when it is in this component, otherwise the most connected
		// one — which is what makes a component's drawing about the thing it is actually about.
		const hub =
			(focusId && members.includes(focusId) ? focusId : null) ??
			members.reduce((best, id) =>
				(neighbours.get(id)?.length ?? 0) > (neighbours.get(best)?.length ?? 0) ? id : best,
			);

		const depth = new Map([[hub, 0]]);
		const queue = [hub];
		while (queue.length > 0) {
			const id = queue.shift();
			for (const next of neighbours.get(id) ?? []) {
				if (depth.has(next)) continue;
				depth.set(next, Math.min(depth.get(id) + 1, RING.length - 1));
				queue.push(next);
			}
		}

		const rings = new Map();
		for (const id of members) {
			const d = depth.get(id) ?? RING.length - 1;
			if (!rings.has(d)) rings.set(d, []);
			rings.get(d).push(id);
		}

		for (const [d, ids] of rings) {
			ids.sort();
			if (d === 0) {
				placed.set(ids[0], { x: cx, y: cy, depth: 0 });
				continue;
			}
			const radius = RING[d];
			// Start each ring at the top and step evenly. The half-step offset on odd rings stops
			// ring 2 hiding directly behind ring 1.
			const offset = d % 2 === 0 ? Math.PI / ids.length : 0;
			ids.forEach((id, position) => {
				const angle = -Math.PI / 2 + offset + (position / ids.length) * Math.PI * 2;
				placed.set(id, {
					x: cx + Math.cos(angle) * radius,
					y: cy + Math.sin(angle) * radius,
					depth: d,
				});
			});
		}
	});

	return placed;
}

/** The box that holds every placed node, with room for the labels that hang off them. */
function boundsOf(placed) {
	let minX = 0;
	let minY = 0;
	let maxX = 0;
	let maxY = 0;
	let first = true;
	for (const point of placed.values()) {
		if (first) {
			minX = maxX = point.x;
			minY = maxY = point.y;
			first = false;
			continue;
		}
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	const pad = 90;
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

/**
 * @param elements       `{ nodes, edges }` — plain objects, not a library's element shape.
 * @param focus          the node this drawing is about, placed at the centre of its component.
 * @param onSelect       (id | null) => void. Clicking the background clears the selection.
 * @param onHover        (id | null, {x, y}) => void, in client coordinates.
 * @param showEdgeLabels the caller decides; a canvas with more edges than labels can carry says so
 *                       in words rather than drawing an unreadable one.
 */
export function EgoGraph({
	elements,
	focus = null,
	selected = null,
	onSelect = () => {},
	onHover = () => {},
	showEdgeLabels = true,
	label = 'The names in this view and what connects them',
}) {
	const nodes = elements?.nodes ?? [];
	const edges = elements?.edges ?? [];
	const placed = useMemo(() => layout(nodes, edges, focus), [nodes, edges, focus]);
	const bounds = useMemo(() => boundsOf(placed), [placed]);

	const [view, setView] = useState(null);
	const drag = useRef(null);
	const svg = useRef(null);

	/*
	 * THE DRAWING IS NEVER MAGNIFIED, and that is what this measurement is for.
	 *
	 * The viewBox was the bounding box of the placed nodes, so an SVG at `width: 100%` scaled it to
	 * fill whatever frame it was in. A depth-1 ego network is 480 units across; the frame beside the
	 * panel is about 1,150 CSS px. Everything therefore drew at 2.4x — GraphFocus's 12.5px node
	 * labels came out at 30px, its 10.5px edge labels at 25px, and nine of those crossed at the
	 * centre in a picture the mockup draws as small marks around a hub.
	 *
	 * Scaling a font by the frame is also the wrong idea in principle: a label on a canvas is a
	 * mark, and a mark has one size. So the units of this drawing ARE CSS pixels, the viewBox is
	 * grown to the frame when the drawing is smaller than it, and the wheel is the only thing that
	 * changes the scale.
	 */
	const [frame, setFrame] = useState(null);
	useEffect(() => {
		const element = svg.current;
		if (!element || typeof ResizeObserver === 'undefined') return undefined;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				setFrame((last) =>
					last && Math.abs(last.width - rect.width) < 1 && Math.abs(last.height - rect.height) < 1
						? last
						: { width: rect.width, height: rect.height },
				);
			}
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const fitted = useMemo(() => atMostLifeSize(bounds, frame), [bounds, frame]);
	const box = view ?? fitted;

	/* Wheel zooms about the pointer; drag pans. Both write the viewBox, so nothing re-lays-out. */
	const onWheel = useCallback(
		(event) => {
			event.preventDefault();
			const rect = svg.current?.getBoundingClientRect();
			if (!rect) return;
			const factor = Math.exp(event.deltaY * 0.0015);
			const scale = Math.min(8, Math.max(0.15, factor));
			const px = box.x + ((event.clientX - rect.left) / rect.width) * box.width;
			const py = box.y + ((event.clientY - rect.top) / rect.height) * box.height;
			setView({
				x: px - (px - box.x) * scale,
				y: py - (py - box.y) * scale,
				width: box.width * scale,
				height: box.height * scale,
			});
		},
		[box],
	);

	const onPointerDown = (event) => {
		drag.current = { x: event.clientX, y: event.clientY, box };
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const onPointerMove = (event) => {
		if (!drag.current) return;
		const rect = svg.current?.getBoundingClientRect();
		if (!rect) return;
		const dx = ((event.clientX - drag.current.x) / rect.width) * drag.current.box.width;
		const dy = ((event.clientY - drag.current.y) / rect.height) * drag.current.box.height;
		setView({ ...drag.current.box, x: drag.current.box.x - dx, y: drag.current.box.y - dy });
	};

	const onPointerUp = () => {
		drag.current = null;
	};

	const colour = (node) =>
		node.slot === undefined || node.slot < 0 || node.slot > 7
			? 'var(--k-other)'
			: `var(--k${node.slot})`;

	return (
		<svg
			ref={svg}
			className="ego"
			role="img"
			aria-label={label}
			viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onClick={(event) => {
				if (event.target === svg.current) onSelect(null);
			}}
		>
			<g>
				{edges.map((edge) => {
					const a = placed.get(edge.source);
					const b = placed.get(edge.target);
					if (!a || !b) return null;
					return (
						<g key={edge.id}>
							<line
								x1={a.x}
								y1={a.y}
								x2={b.x}
								y2={b.y}
								className={edge.band === 'rare' ? 'ego-edge ego-edge-rare' : 'ego-edge'}
							/>
							{showEdgeLabels && edge.label ? (
								/*
								  Placed at 62% of the way out rather than at the midpoint. Every edge in an
								  ego drawing runs from one centre, so nine midpoints sit in a tight ring
								  around it and overlap each other; two-thirds out they fan apart.
								*/
								<text
									className="ego-edge-label"
									x={a.x + (b.x - a.x) * 0.62}
									y={a.y + (b.y - a.y) * 0.62 - 4}
									textAnchor="middle"
								>
									<title>{edge.label}</title>
									{clipLabel(edge.label)}
								</text>
							) : null}
						</g>
					);
				})}
			</g>

			<g>
				{nodes.map((node) => {
					const point = placed.get(node.id);
					if (!point) return null;
					const radius = point.depth === 0 ? HUB_R : NODE_R + Math.min(6, (node.degree ?? 1) / 2);
					const isSelected = selected === node.id;
					return (
						<g
							key={node.id}
							className="ego-node"
							data-selected={isSelected ? 'true' : undefined}
							onClick={(event) => {
								event.stopPropagation();
								onSelect(node.id);
							}}
							onPointerEnter={(event) => onHover(node.id, { x: event.clientX, y: event.clientY })}
							onPointerLeave={() => onHover(null, null)}
						>
							{/*
							  SHAPE CARRIES ROLE AND THE LABEL CARRIES THE NAME; colour is redundant with
							  both. A kind past the eighth slot draws grey and still says what it is,
							  because text degrades perfectly where a palette does not.
							*/}
							{/*
							  THE NODE THIS DRAWING IS ABOUT IS DRAWN IN THE TEXT INK, not in its kind's
							  colour. It is the one node on the canvas the reader did not come here to
							  identify — they already know what it is, it is in the heading beside them —
							  and the legend's job is to decode the OTHERS. Drawing it in a kind colour
							  makes it one more thing to look up.
							*/}
							{point.depth === 0 ? (
								<circle
									cx={point.x}
									cy={point.y}
									r={radius}
									fill="var(--text)"
									className="ego-shape ego-shape-hub"
								/>
							) : node.kind === 'memory' ? (
								<rect
									x={point.x - radius}
									y={point.y - radius * 0.72}
									width={radius * 2}
									height={radius * 1.44}
									rx={3}
									fill="var(--surface)"
									className="ego-shape"
								/>
							) : (
								<circle
									cx={point.x}
									cy={point.y}
									r={radius}
									fill={colour(node)}
									className="ego-shape"
									strokeDasharray={node.marked ? '3 2' : undefined}
								/>
							)}
							<text
								className={point.depth === 0 ? 'ego-label ego-label-hub' : 'ego-label'}
								x={point.x}
								y={point.y + radius + 14}
								textAnchor="middle"
							>
								{String(node.label ?? node.id).split('\n')[0]}
							</text>
						</g>
					);
				})}
			</g>
		</svg>
	);
}
