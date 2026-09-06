import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { hitIndex } from '../overview-layout.mjs';

/**
 * THE WHOLE VAULT, AS ONE PICTURE. The only view in this product that draws every name at once.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It is a DIAGNOSTIC and an OVERVIEW. You open it to feel the size and shape of what your agent
 * knows: where the one large region is, how much of the vault is a field of small unconnected
 * things, and whether two spellings of what is probably one name are sitting on opposite sides of
 * it. It is not the default surface and it is not how you find a particular memory — the table is
 * both of those, and this canvas never pretends otherwise.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY IT DOES NOT LABEL EVERYTHING, AS ARITHMETIC RATHER THAN AS TASTE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A readable label is about 120 × 20 px. Twelve hundred of them need roughly twice the ink of the
 * whole canvas, so "label them all" is not a thing that can be done badly — it is a thing that
 * cannot be done. What it can do instead, and does:
 *
 *   - the largest few names keep a label at every zoom level, so the picture is never anonymous;
 *   - above a zoom threshold every name in view gets one, because by then there is room;
 *   - whatever is under the pointer is named immediately.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A CANVAS AND NOT SVG
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Twelve hundred nodes and a thousand edges is about two thousand elements, and a pan is a change
 * to all of them at once. In SVG that is two thousand live DOM nodes the browser re-rasterises per
 * frame; on a canvas it is one element and a draw call, and the hit-testing SVG would have given
 * for free is a grid lookup that costs about half a microsecond. The ego drawing next door IS SVG,
 * deliberately — it has at most sixty nodes and every one of them is a link.
 *
 * NOTHING HERE IS ANIMATED. The layout is deterministic and the picture does not settle, drift or
 * re-arrange itself. A diagnostic you run fortnightly is only useful if what changed between two
 * runs is the vault.
 */

/** Label everything in view once the reader is this many times zoomed in past the opening fit. */
const LABEL_ZOOM = 3;

/** The most a focus is allowed to magnify the picture, in screen px per layout unit. */
const FOCUS_ZOOM_CAP = 3.5;

/** Screen radius of a drawn name, in px, before the zoom multiplier. */
const screenRadius = (degree) => 1.9 + Math.sqrt(Math.max(0, degree ?? 0)) * 1.5;

/** How much zoom is allowed to grow the ink. Nodes stay legible at the fit and never become blobs. */
const inkScale = (scale, fit) => Math.min(2.4, Math.max(0.85, scale / Math.max(fit, 1e-6)));

/**
 * The palette, read from the stylesheet rather than written down here.
 *
 * The kind vocabulary is open and is read from the engine at run time, so the slots are assigned to
 * whatever kinds THIS vault uses. Reading the values off the element also means the drawing follows
 * the reader's theme with no second palette to keep in step.
 */
function readInk(element) {
	const style = getComputedStyle(element);
	const value = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
	return {
		slots: [0, 1, 2, 3, 4, 5, 6, 7].map((index) => value(`--k${index}`, '#94908a')),
		other: value('--k-other', '#94908a'),
		edge: value('--graph-edge', '#cfcabf'),
		accent: value('--accent', '#2f5d8a'),
		warn: value('--warn', '#8a4a17'),
		text: value('--text', '#1a1917'),
		faint: value('--faint', '#94908a'),
		surface: value('--surface', '#ffffff'),
		line: value('--line', '#e6e2db'),
		// A canvas resolves no custom properties of its own, so the family is read here and spelled
		// into the `font` string below. Left as `var(--font-ui)` the assignment silently fails and
		// every label falls back to the browser's default serif — which looks like a design choice.
		font: value('--font-ui', 'sans-serif'),
	};
}

/**
 * @param {object}   props
 * @param {Array}    props.nodes           from `overviewElements`
 * @param {Array}    props.edges
 * @param {Array}    props.duplicateLinks  the pairs a merge would join — the actionable structure
 * @param {Set}      props.alwaysLabelled  ids that keep a label at every zoom level
 * @param {object}   props.layout          from `overviewLayout` — positions, bounds, components
 * @param {object|null} props.focus        from `overviewFocus`: the components to keep lit, fit the
 *                                         view to, and label whole, and the names to ring. `null`
 *                                         is the whole vault, undimmed.
 * @param {string|null} props.selected
 * @param {Function} props.onSelect        (id | null) => void, on a click
 * @param {Function} props.onOpen          (id) => void, on a double click
 */
export function VaultCanvas({
	nodes,
	edges,
	duplicateLinks = [],
	alwaysLabelled = new Set(),
	layout,
	focus = null,
	selected = null,
	onSelect = () => {},
	onOpen = () => {},
	label = 'Every name in this vault, drawn by how it is connected',
}) {
	const canvas = useRef(null);
	const frame = useRef(null);
	const view = useRef({ scale: 1, x: 0, y: 0, fit: 1 });
	const drag = useRef(null);
	const [hovered, setHovered] = useState(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	const positions = layout.positions;
	const index = useMemo(() => hitIndex(positions), [positions]);
	const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
	/*
	  A ONE-FACT ISLAND: two names and the statement between them, which is most of the components
	  in a vault of this shape. Drawn smaller and quieter, so two hundred of them read as a field the
	  eye can size at a glance rather than as confetti competing with the one region that has a shape.
	*/
	const island = (node) => (node.componentSize ?? 0) <= 2;

	/*
	  The draw. Imperative and outside React's render, because a pan is sixty of these a second and
	  a component that re-rendered on each one would be doing React's reconciliation for a picture
	  that has no DOM to reconcile.
	*/
	const paint = useCallback(() => {
		frame.current = null;
		const element = canvas.current;
		if (!element) return;
		const context = element.getContext('2d');
		if (!context) return;

		const ratio = window.devicePixelRatio || 1;
		const width = element.width / ratio;
		const height = element.height / ratio;
		const ink = readInk(element);
		const { scale, x: ox, y: oy, fit } = view.current;
		const zoom = inkScale(scale, fit);
		const sx = (x) => (x - ox) * scale;
		const sy = (y) => (y - oy) * scale;

		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);

		/*
		  WHAT THE READER HAS NARROWED TO IS AN ISLAND, NOT A NAME. `focus` names components, and a
		  node is lit when its component is one of them. `null` means no narrowing at all, which is
		  NOT the same as a focus with no components — that means the query matched nothing and the
		  whole canvas dims, which is the honest answer and is visibly different from "everything is
		  lit". The names that actually matched are ringed on top of that, so a reader sees both the
		  island and the thing on it they asked for.
		*/
		const lit = (id) => focus === null || focus.components.has(byId.get(id)?.componentId);
		const isMatch = (id) => focus !== null && focus.marked.has(id);
		const dimming = focus !== null;

		/*
		  Edges first, and thin. They are context for the nodes, not the subject. Two passes: the
		  islands' one statement each is drawn quieter, for the same reason their names are.
		*/
		context.lineWidth = Math.max(0.35, 0.55 * zoom);
		context.strokeStyle = ink.edge;
		for (const quiet of [false, true]) {
			context.globalAlpha = (dimming ? 0.25 : 0.75) * (quiet ? 0.55 : 1);
			context.beginPath();
			for (const edge of edges) {
				const a = positions.get(edge.source);
				const b = positions.get(edge.target);
				if (!a || !b) continue;
				if (island(byId.get(edge.source) ?? {}) !== quiet) continue;
				context.moveTo(sx(a.x), sy(a.y));
				context.lineTo(sx(b.x), sy(b.y));
			}
			context.stroke();
		}

		/*
		  THE ACTIONABLE STRUCTURE, DRAWN DIFFERENTLY FROM EVERYTHING ELSE.

		  A near-duplicate pair is the one relationship in this picture that position cannot show,
		  because the two spellings are usually in different components and the packing puts those
		  wherever their size says. So it gets its own mark: a dashed line, over the edges rather than
		  under them, which is legible across the whole canvas at the opening fit. It is drawn IN THE
		  HUE ITS GROUP WAS GIVEN, and so are the rings on its two ends, so the ends of one line can
		  be matched to each other across the canvas without following the line. This is the
		  difference between a pretty picture and a diagnostic — it is the only thing on the canvas
		  the reader can act on.
		*/
		const hueInk = (hue) => (hue >= 0 && hue <= 7 ? ink.slots[hue] : ink.warn);
		/*
		  THE LINES ARE DRAWN ON ASKING. Twenty dashed diagonals in eight hues were the loudest thing
		  on the whole-vault fit, and with every hue used by two or three pairs "a pair shares a
		  colour" identified nothing. A pair's line appears when the picture is narrowed, or when
		  either of its ends is under the pointer or selected; the rings on the ends stay, so the
		  pairs are still findable at the fit.
		*/
		const touched = (link) =>
			dimming ||
			link.source === hovered ||
			link.target === hovered ||
			link.source === selected ||
			link.target === selected;
		if (duplicateLinks.length > 0) {
			context.save();
			context.setLineDash([5, 4]);
			context.lineWidth = Math.max(0.9, 1.2 * zoom);
			context.globalAlpha = dimming ? 0.4 : 0.95;
			for (const link of duplicateLinks) {
				if (!touched(link)) continue;
				const a = positions.get(link.source);
				const b = positions.get(link.target);
				if (!a || !b) continue;
				context.strokeStyle = hueInk(link.hue ?? -1);
				context.beginPath();
				context.moveTo(sx(a.x), sy(a.y));
				context.lineTo(sx(b.x), sy(b.y));
				context.stroke();
			}
			context.restore();
		}

		/* Nodes, batched by colour so the canvas changes fill once per kind and not once per name. */
		const buckets = new Map();
		for (const node of nodes) {
			const point = positions.get(node.id);
			if (!point) continue;
			const px = sx(point.x);
			const py = sy(point.y);
			// Culled against the viewport with a margin. At the opening fit nothing is culled; zoomed
			// in, this is what keeps a pan the same cost as the visible part of the picture.
			if (px < -20 || py < -20 || px > width + 20 || py > height + 20) continue;
			const slot = node.slot >= 0 && node.slot <= 7 ? node.slot : -1;
			const key = `${slot}:${lit(node.id) ? 1 : 0}`;
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push({ node, px, py });
		}

		for (const [key, members] of buckets) {
			const [slotText, litText] = key.split(':');
			const slot = Number(slotText);
			context.fillStyle = slot === -1 ? ink.other : ink.slots[slot];
			/*
			 * A DIMMED NODE IS STILL A NODE. At 0.13 the 1,272 names that did not match a query were
			 * gone rather than quiet, so a search for a word two names carry emptied the canvas and
			 * left two dots the reader could not find. The dim has to keep the shape of the vault
			 * legible, because the shape is what this picture is for; the match is marked below.
			 */
			for (const quiet of [false, true]) {
				// An island's two names at half the ink and three quarters of the size: present, and
				// not competing with the region that has a shape.
				context.globalAlpha = (litText === '1' ? 1 : 0.3) * (quiet ? 0.5 : 1);
				context.beginPath();
				for (const { node, px, py } of members) {
					if (island(node) !== quiet) continue;
					const r = screenRadius(node.degree) * zoom * (quiet ? 0.75 : 1);
					context.moveTo(px + r, py);
					context.arc(px, py, r, 0, Math.PI * 2);
				}
				context.fill();
			}
		}

		/*
		 * A RING ON EVERY MATCH, in the accent. Raising a matched node's opacity cannot mark it: on a
		 * canvas of 1,274 dots a full-strength dot is what a dot looks like, and finding two of them
		 * is the search the reader just asked the app to do for them.
		 */
		if (dimming) {
			context.strokeStyle = ink.accent;
			context.lineWidth = Math.max(1.2, 1.6 * zoom);
			for (const node of nodes) {
				if (!isMatch(node.id)) continue;
				const point = positions.get(node.id);
				if (!point) continue;
				// A match on an island that is not lit is still ringed, quietly, so a query that hit
				// more islands than are shown leaves its other hits findable.
				context.globalAlpha = lit(node.id) ? 1 : 0.45;
				const r = screenRadius(node.degree) * zoom + 3.5;
				context.beginPath();
				context.arc(sx(point.x), sy(point.y), r, 0, Math.PI * 2);
				context.stroke();
			}
		}

		/* A ring on each end of a pair, in the pair's hue, so the dashed line has two visible ends. */
		context.globalAlpha = dimming ? 0.35 : 1;
		context.lineWidth = Math.max(1, 1.3 * zoom);
		for (const node of nodes) {
			if (!node.duplicate) continue;
			const point = positions.get(node.id);
			if (!point) continue;
			const r = screenRadius(node.degree) * zoom + 2.5;
			context.strokeStyle = hueInk(node.duplicateHue ?? -1);
			context.beginPath();
			context.arc(sx(point.x), sy(point.y), r, 0, Math.PI * 2);
			context.stroke();
		}

		/* The selected name, marked so it is findable after the panel beside it has been read. */
		const marked = [selected, hovered].filter(Boolean);
		context.globalAlpha = 1;
		for (const id of marked) {
			const point = positions.get(id);
			const node = byId.get(id);
			if (!point || !node) continue;
			const r = screenRadius(node.degree) * zoom + 4;
			context.beginPath();
			context.arc(sx(point.x), sy(point.y), r, 0, Math.PI * 2);
			context.strokeStyle = ink.text;
			context.lineWidth = 1.5;
			context.stroke();
		}

		/*
		  LABELS. Four reasons a name gets one, and they are cumulative: the largest few always,
		  everything in view once the reader has zoomed past the threshold, everything on an island
		  the reader has narrowed to, and whatever is under the pointer.
		*/
		context.globalAlpha = 1;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const everything = scale > view.current.fit * LABEL_ZOOM;
		const labelled = [];
		for (const node of nodes) {
			const wanted =
				everything ||
				alwaysLabelled.has(node.id) ||
				node.id === hovered ||
				node.id === selected ||
				(dimming && lit(node.id));
			if (!wanted) continue;
			if (dimming && !lit(node.id) && node.id !== hovered) continue;
			const point = positions.get(node.id);
			if (!point) continue;
			const px = sx(point.x);
			const py = sy(point.y);
			if (px < 0 || py < 0 || px > width || py > height) continue;
			labelled.push({ node, px, py });
		}

		/*
		  A LABEL THAT LANDS ON ANOTHER LABEL IS TWO LABELS NOBODY CAN READ.

		  So they are drawn biggest-first and one that would overlap a label already on the canvas is
		  dropped. That is the only honest way to spend an area budget the arithmetic at the head of
		  this file says is short: the reader gets the names of the largest things legibly, rather than
		  every name illegibly. The pointer's own label is exempt — it is what the reader asked for,
		  and it carries its own ground so it can sit over anything.
		*/
		labelled.sort((a, b) => (b.node.degree ?? 0) - (a.node.degree ?? 0));
		const taken = [];
		const clear = (box) =>
			!taken.some(
				(other) =>
					box.left < other.right &&
					box.right > other.left &&
					box.top < other.bottom &&
					box.bottom > other.top,
			);

		for (const { node, px, py } of labelled) {
			const emphasis = node.id === hovered || node.id === selected;
			/*
			  A NAME ON A NARROWED ISLAND IS A NAME, drawn as GraphFocus draws one: 12.5px in the
			  ink. The 10.5px faint form is the mockup's style for a relation label, and it is kept
			  for the whole-vault fit, where the labels are marks among a thousand dots.
			*/
			const onIsland = dimming && lit(node.id);
			const size = emphasis ? 12 : onIsland ? 12.5 : 10.5;
			context.font = `${emphasis ? 600 : 400} ${size}px ${ink.font}`;
			const text = node.label;
			const measured = context.measureText(text).width;
			const offset = screenRadius(node.degree) * zoom + (emphasis ? 11 : onIsland ? 10 : 8);
			const half = onIsland ? 9 : 8;
			const box = {
				left: px - measured / 2 - 3,
				right: px + measured / 2 + 3,
				top: py + offset - half,
				bottom: py + offset + half,
			};
			if (!emphasis && !clear(box)) continue;
			taken.push(box);

			if (emphasis) {
				// A pointer label sits over whatever it sits over, so it carries its own ground.
				context.fillStyle = ink.surface;
				context.globalAlpha = 0.92;
				context.fillRect(px - measured / 2 - 5, py + offset - 9, measured + 10, 17);
				context.globalAlpha = 1;
				context.strokeStyle = ink.line;
				context.lineWidth = 1;
				context.strokeRect(px - measured / 2 - 5, py + offset - 9, measured + 10, 17);
			} else {
				// A halo rather than a panel: at the opening fit a label sits among the edges it is
				// naming, and a filled box behind each of them would hide the picture it decorates.
				context.strokeStyle = ink.surface;
				context.lineWidth = 3;
				context.lineJoin = 'round';
				context.globalAlpha = 0.85;
				context.strokeText(text, px, py + offset);
				context.globalAlpha = 1;
			}
			context.fillStyle = emphasis || onIsland ? ink.text : ink.faint;
			context.fillText(text, px, py + offset);
		}
	}, [nodes, edges, duplicateLinks, positions, alwaysLabelled, focus, selected, hovered, byId]);

	/*
	  THE DRAW IS HELD IN A REF SO THE SCHEDULER NEVER CHANGES. `paint` is rebuilt on every hover and
	  selection, and a `schedule` rebuilt from it was in the fit effect's dependencies — so crossing
	  a dot after six wheel ticks re-ran the fit and threw the reader's zoom and pan away (the canvas
	  hashed identical to the opening fit). The fit now depends on the frame and the layout only; a
	  new `paint` merely asks for a repaint.
	*/
	const paintRef = useRef(paint);
	paintRef.current = paint;
	const schedule = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => paintRef.current());
	}, []);

	/*
	  THE DRAW, REACHABLE FROM OUTSIDE, SO THE COST OF A FRAME CAN BE MEASURED RATHER THAN ESTIMATED.

	  This canvas has one performance claim — that it stays responsive with a whole vault on it — and
	  a claim like that is worth exactly as much as the instrument behind it. Timing a COPY of this
	  loop measures the copy; timing the frames the browser happens to schedule measures the
	  scheduler. So the real function is attached to the element, and a measurement calls it directly
	  and times it.

	  It is one property assignment per render and it changes nothing about what is painted.
	*/
	useEffect(() => {
		const element = canvas.current;
		if (!element) return undefined;
		element.drawForMeasurement = paint;
		return () => {
			delete element.drawForMeasurement;
		};
	}, [paint]);

	/*
	  Size the backing store to the element and the display's pixel ratio, and refit on a resize.

	  THE FIRST SIZE IS MEASURED SYNCHRONOUSLY AND THE OBSERVER ONLY REPORTS CHANGES. A canvas whose
	  first size comes from a ResizeObserver paints at the element default — 300 x 150 — until that
	  observer delivers, and the browser stretches those 45,000 pixels across the whole frame. It
	  looks like a blurry drawing rather than like an unsized one, so it reads as a rendering
	  problem and never as a wiring one. Worse, observer callbacks are delivered as part of updating
	  the rendering, so on a page the browser has throttled they may not arrive at all.
	*/
	useLayoutEffect(() => {
		const element = canvas.current;
		if (!element) return undefined;
		const box = (element.parentElement ?? element).getBoundingClientRect();
		setSize((current) =>
			current.width === box.width && current.height === box.height
				? current
				: { width: box.width, height: box.height },
		);
		const observer = new ResizeObserver(([entry]) => {
			const measured = entry.contentRect;
			setSize((current) =>
				current.width === measured.width && current.height === measured.height
					? current
					: { width: measured.width, height: measured.height },
			);
		});
		observer.observe(element.parentElement ?? element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const element = canvas.current;
		if (!element || size.width === 0 || size.height === 0) return;
		const ratio = window.devicePixelRatio || 1;
		element.width = Math.round(size.width * ratio);
		element.height = Math.round(size.height * ratio);

		// Fit the whole vault, once, whenever the frame changes shape. The reader's own pan and zoom
		// are kept across a re-render but not across a resize — a viewport that changed shape has no
		// meaningful continuation of a previous one.
		const bounds = layout.bounds;
		const fit = Math.min(size.width / bounds.width, size.height / bounds.height);
		view.current = {
			fit,
			scale: fit,
			x: bounds.x - (size.width / fit - bounds.width) / 2,
			y: bounds.y - (size.height / fit - bounds.height) / 2,
		};
		schedule();
	}, [size, layout, schedule]);

	/*
	  THE VIEW FITS THE ISLAND. "Here is the island this name lives on, labelled" needs the island
	  to fill the frame, not to be three ringed dots in a field of confetti — so when the focus
	  changes the view moves to the box around its components and stops there. It is a jump and not
	  a glide: nothing on this canvas is animated, and a picture that arrives is one the reader can
	  read at once. The scale is capped so a two-name island is not blown up to a pair of dinner
	  plates; at the cap its two names and their statement are still the only things in view.
	*/
	useEffect(() => {
		const element = canvas.current;
		if (!element || size.width === 0 || size.height === 0) return;
		if (!focus || focus.components.size === 0) return;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const box of layout.components ?? []) {
			if (!focus.components.has(box.id)) continue;
			minX = Math.min(minX, box.x - box.radius);
			maxX = Math.max(maxX, box.x + box.radius);
			minY = Math.min(minY, box.y - box.radius);
			maxY = Math.max(maxY, box.y + box.radius);
		}
		if (!Number.isFinite(minX)) return;
		// Room for the labels that hang off the outermost names.
		const pad = 60;
		const width = maxX - minX + pad * 2;
		const height = maxY - minY + pad * 2;
		const fit = view.current.fit;
		const scale = Math.min(FOCUS_ZOOM_CAP, fit * 40, Math.max(fit, Math.min(size.width / width, size.height / height)));
		view.current = {
			...view.current,
			scale,
			x: (minX + maxX) / 2 - size.width / scale / 2,
			y: (minY + maxY) / 2 - size.height / scale / 2,
		};
		schedule();
	}, [focus, layout, size, schedule]);

	// A new `paint` — a hover, a selection, a narrowing — repaints; it never refits.
	useEffect(() => {
		schedule();
	}, [paint, schedule]);

	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
		},
		[],
	);

	const layoutPoint = (event) => {
		const rect = canvas.current.getBoundingClientRect();
		const { scale, x, y } = view.current;
		return {
			x: (event.clientX - rect.left) / scale + x,
			y: (event.clientY - rect.top) / scale + y,
		};
	};

	const onWheel = (event) => {
		event.preventDefault();
		const point = layoutPoint(event);
		const factor = Math.exp(-event.deltaY * 0.0016);
		const next = Math.min(view.current.fit * 40, Math.max(view.current.fit * 0.6, view.current.scale * factor));
		const rect = canvas.current.getBoundingClientRect();
		view.current = {
			...view.current,
			scale: next,
			x: point.x - (event.clientX - rect.left) / next,
			y: point.y - (event.clientY - rect.top) / next,
		};
		schedule();
	};

	const onPointerDown = (event) => {
		drag.current = { clientX: event.clientX, clientY: event.clientY, x: view.current.x, y: view.current.y, moved: false };
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const onPointerMove = (event) => {
		if (drag.current) {
			const dx = (event.clientX - drag.current.clientX) / view.current.scale;
			const dy = (event.clientY - drag.current.clientY) / view.current.scale;
			if (Math.abs(dx) + Math.abs(dy) > 1) drag.current.moved = true;
			view.current = { ...view.current, x: drag.current.x - dx, y: drag.current.y - dy };
			schedule();
			return;
		}
		const point = layoutPoint(event);
		// The hit radius is in layout units and grows as the picture shrinks, so a name is as easy to
		// point at when the whole vault is on screen as it is zoomed in.
		const found = index.at(point.x, point.y, 8 / view.current.scale);
		if (found !== hovered) setHovered(found);
	};

	const onPointerUp = (event) => {
		const wasDrag = drag.current?.moved ?? false;
		drag.current = null;
		if (wasDrag) return;
		const point = layoutPoint(event);
		const found = index.at(point.x, point.y, 8 / view.current.scale);
		onSelect(found);
	};

	return (
		<canvas
			ref={canvas}
			className="vault-canvas"
			role="img"
			aria-label={label}
			style={{ cursor: hovered ? 'pointer' : 'grab' }}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={() => {
				drag.current = null;
				setHovered(null);
			}}
			onDoubleClick={() => {
				if (hovered) onOpen(hovered);
			}}
		/>
	);
}
