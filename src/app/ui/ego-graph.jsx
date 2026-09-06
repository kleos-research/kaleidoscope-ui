import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MARKER_R, egoDrawing, namePlacement, nodeRadius } from './ego-layout.mjs';

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
 * WHERE THE GEOMETRY IS. Not here. `ego-layout.mjs` decides where every node sits and where every
 * relation name sits along its line, as arithmetic with no DOM, so a test can assert that no two
 * names overlap rather than trust this file to have drawn them apart. This component draws what it
 * is handed and owns exactly three things the arithmetic cannot: the frame it is drawn in, the
 * wheel and the drag, and what is under the pointer.
 *
 * WHAT IT DOES NOT DO, on purpose: no clustering (the components already ARE the clusters, and each
 * is very nearly a tree), no edge bundling (there are no parallel edges to bundle), and no
 * path-between-two-names (two names share a component about 2% of the time, and when they do the
 * component is a tree so the path is a breadcrumb rather than a drawing).
 */

/** The box that holds every placed node and every name beside one. */
function boundsOf(nodes, placed) {
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
		const left = name.anchor === 'start' ? name.x : name.anchor === 'end' ? name.x - name.width : name.x - name.width / 2;
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

/**
 * @param elements  `{ nodes, edges }` — plain objects, not a library's element shape. A node may
 *                  carry `beyond`, the exact count of names one step past it that are not drawn.
 * @param focus     the node this drawing is about, placed at the centre of its component.
 * @param pinned    a second name kept on the canvas: the centre of its own component when the two
 *                  share none, and drawn hollow at the focus's size wherever it lands.
 * @param shared    a Set of the names joined to both the focus and the pin, ringed in the accent.
 * @param drawing   from `egoDrawing`, when the caller has already computed it — the panel beside
 *                  this drawing lists the numbered relations, so it needs the same answer.
 * @param onSelect  (id | null) => void. Clicking the background clears the selection.
 * @param onHover   (id | null, {x, y}) => void, in client coordinates.
 * @param inset     CSS px at the frame's foot that belong to the legend drawn over it. The drawing
 *                  is fitted to the frame MINUS this strip, so no node sits under the legend.
 * @param beyondMarks whether to print the "+n" count beside a name. Off at one step: it is a
 *                  number a reader has to decode from the legend, and it earns its place only when
 *                  deciding whether to open a neighbour — which is a two-step question.
 */
export function EgoGraph({
	elements,
	focus = null,
	pinned = null,
	shared = null,
	drawing: given = null,
	selected = null,
	inset = 0,
	beyondMarks = true,
	onSelect = () => {},
	onHover = () => {},
	label = 'The names in this view and what connects them',
}) {
	const nodes = elements?.nodes ?? [];
	const edges = elements?.edges ?? [];
	const drawing = useMemo(
		() => given ?? egoDrawing(elements, pinned ? [focus, pinned] : focus),
		[given, elements, focus, pinned],
	);
	const placed = drawing.placed;
	const bounds = useMemo(() => boundsOf(nodes, placed), [nodes, placed]);
	const edgeById = useMemo(() => new Map(edges.map((edge) => [edge.id, edge])), [edges]);

	const [view, setView] = useState(null);
	const [hoveredEdge, setHoveredEdge] = useState(null);
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

	/*
	  THE FIT KNOWS ABOUT THE LEGEND. `boundsOf` and `atMostLifeSize` see nodes and a frame and
	  nothing else, so at two steps the bottom nodes and their names sat under the legend box. The
	  drawing is fitted to the frame less the legend's strip, and the viewBox is then grown by that
	  strip's share so the drawing sits above it and the strip stays empty — scale unchanged.
	*/
	const fitted = useMemo(() => {
		if (!frame || inset <= 0) return atMostLifeSize(bounds, frame);
		const usable = { width: frame.width, height: Math.max(1, frame.height - inset) };
		const box = atMostLifeSize(bounds, usable);
		return { ...box, height: box.height * (frame.height / usable.height) };
	}, [bounds, frame, inset]);
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

	/** Where the pointer is, in the drawing's own units, so a hover label can sit beside it. */
	const localPoint = (event) => {
		const matrix = svg.current?.getScreenCTM?.();
		if (!matrix) return null;
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		return { x: point.x, y: point.y };
	};

	const colour = (node) =>
		node.slot === undefined || node.slot < 0 || node.slot > 7
			? 'var(--k-other)'
			: `var(--k${node.slot})`;

	const hoverText = hoveredEdge ? edgeById.get(hoveredEdge.id)?.label : null;

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
							{/*
							  A 1.4px line cannot be pointed at. This is the same line, fourteen wide and
							  painted in nothing, so the pointer finds it — and the relation it carries is
							  named beside the pointer while it is there. Every relation is also in the
							  panel and, for all but the numbered ones, on the line itself: the hover
							  repeats, it is never the only copy.
							*/}
							{edge.label ? (
								<line
									x1={a.x}
									y1={a.y}
									x2={b.x}
									y2={b.y}
									className="ego-edge-hit"
									onPointerEnter={(event) => {
										if (drag.current) return;
										const at = localPoint(event);
										if (at) setHoveredEdge({ id: edge.id, ...at });
									}}
									onPointerMove={(event) => {
										if (drag.current) return;
										const at = localPoint(event);
										if (at) setHoveredEdge({ id: edge.id, ...at });
									}}
									onPointerLeave={() => setHoveredEdge(null)}
								/>
							) : null}
						</g>
					);
				})}
			</g>

			{/*
			  THE RELATION NAMES, along their lines. Where each one sits — and which could not be
			  placed — is decided in `ego-layout.mjs`; this only draws the answer. `text-anchor` and
			  `dominant-baseline` centre the glyphs on the point the arithmetic chose, and the rotation
			  is the line's own angle, never upside down.
			*/}
			<g>
				{drawing.labels.map((entry) => (
					<text
						key={entry.id}
						className="ego-edge-label"
						transform={`translate(${entry.x} ${entry.y}) rotate(${entry.angle})`}
						textAnchor="middle"
						dominantBaseline="middle"
					>
						{entry.text}
					</text>
				))}
			</g>

			<g>
				{nodes.map((node) => {
					const point = placed.get(node.id);
					if (!point) return null;
					const radius = nodeRadius(node, point.depth);
					const name = namePlacement(node, point);
					const isSelected = selected === node.id;
					/*
					  THE PIN IS TOLD APART WHEREVER IT LANDS. Usually it is the centre of its own
					  component — two names share one about 2% of the time — but when the two ARE
					  joined, the layout centres the component on the focus and the pin sits on a ring
					  at a ring node's size, so the label arithmetic still holds. Either way it is drawn
					  hollow in the text ink with "pinned" under its name: the name the reader chose to
					  keep is never one more coloured circle to find.
					*/
					const isPinned = pinned !== null && node.id === pinned && node.id !== focus;
					const isShared = Boolean(shared?.has(node.id));
					const beyond = node.beyond ?? 0;
					const text = String(node.label ?? node.id).split('\n')[0];
					return (
						<g
							key={node.id}
							className="ego-node"
							data-selected={isSelected ? 'true' : undefined}
							data-shared={isShared ? 'true' : undefined}
							onClick={(event) => {
								event.stopPropagation();
								onSelect(node.id);
							}}
							onPointerEnter={(event) => onHover(node.id, { x: event.clientX, y: event.clientY })}
							onPointerLeave={() => onHover(null, null)}
						>
							{/*
							  THE COUNT BEYOND, REPEATED IN WORDS on the node's own tooltip. The "+3" after
							  the name is the promise; this is the same promise as a sentence.
							*/}
							{beyond > 0 ? (
								<title>
									{`${beyond} more ${beyond === 1 ? 'name' : 'names'} beyond “${text}”, not drawn`}
								</title>
							) : null}
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
							{isPinned ? (
								<circle
									cx={point.x}
									cy={point.y}
									r={radius}
									fill="var(--surface)"
									className="ego-shape ego-shape-pinned"
								/>
							) : point.depth === 0 ? (
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
							{/*
							  THE NAME SITS ON THE FAR SIDE OF ITS NODE FROM THE HUB, as GraphFocus draws
							  it: beside the nodes at the sides, above the ones at the top. That leaves
							  the inside of the ring to the relation names and the outside to the node
							  names, which is the whole reason both can be drawn at once.
							*/}
							<text
								className={point.depth === 0 ? 'ego-label ego-label-hub' : 'ego-label'}
								x={name.x}
								y={name.y}
								textAnchor={name.anchor}
							>
								{text}
								{/*
								  WHAT LIES BEYOND, as a small count at the end of the name. "+3" is exact:
								  the names one step past this one that the canvas does not hold, so a
								  reader deciding whether to open it decides on a number rather than a
								  hunch. It rides on the name so it sits on the far side of the node with
								  it, outside the ring, where the relation names never go.
								*/}
								{beyondMarks && beyond > 0 ? (
									<tspan className="ego-beyond" dx="5">
										+{beyond}
									</tspan>
								) : null}
							</text>
							{isPinned ? (
								<text
									className="ego-label-pin"
									x={name.x}
									y={name.y + 13}
									textAnchor={name.anchor}
								>
									pinned
								</text>
							) : null}
						</g>
					);
				})}
			</g>

			{/*
			  THE NUMBERED ONES: a relation with no room on its line wears a number on it instead, and
			  the legend in the corner of the frame says which relation that is. Drawn over the nodes
			  so a mark that had to sit near one is still findable.
			*/}
			<g>
				{drawing.markers.map((marker) => (
					<g key={marker.id} className="ego-marker" transform={`translate(${marker.x} ${marker.y})`}>
						<circle r={MARKER_R} className="ego-marker-ring" />
						<text className="ego-marker-text" textAnchor="middle" dominantBaseline="central">
							{marker.number}
						</text>
					</g>
				))}
			</g>

			{hoveredEdge && hoverText ? (
				<text
					className="ego-edge-hover"
					x={hoveredEdge.x}
					y={hoveredEdge.y - 14}
					textAnchor="middle"
				>
					{hoverText}
				</text>
			) : null}
		</svg>
	);
}
