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
 * @param {object}   props.layout          from `overviewLayout` — positions and bounds
 * @param {Set|null} props.highlight       ids to keep lit while everything else dims. `null` = none
 * @param {string|null} props.selected
 * @param {Function} props.onSelect        (id | null) => void
 * @param {Function} props.onOpen          (id) => void, on a double click or Enter
 */
export function VaultCanvas({
	nodes,
	edges,
	duplicateLinks = [],
	alwaysLabelled = new Set(),
	layout,
	highlight = null,
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

		// Anything the reader has narrowed to. `null` means no narrowing at all, which is NOT the
		// same as an empty set — an empty set means the query matched nothing and the whole canvas
		// dims, which is the honest answer and is visibly different from "everything is lit".
		const lit = (id) => highlight === null || highlight.has(id);
		const dimming = highlight !== null;

		/* Edges first, and thin. They are context for the nodes, not the subject. */
		context.lineWidth = Math.max(0.35, 0.55 * zoom);
		context.strokeStyle = ink.edge;
		context.globalAlpha = dimming ? 0.25 : 0.75;
		context.beginPath();
		for (const edge of edges) {
			const a = positions.get(edge.source);
			const b = positions.get(edge.target);
			if (!a || !b) continue;
			context.moveTo(sx(a.x), sy(a.y));
			context.lineTo(sx(b.x), sy(b.y));
		}
		context.stroke();

		/*
		  THE ACTIONABLE STRUCTURE, DRAWN DIFFERENTLY FROM EVERYTHING ELSE.

		  A near-duplicate pair is the one relationship in this picture that position cannot show,
		  because the two spellings are usually in different components and the packing puts those
		  wherever their size says. So it gets its own mark: a dashed line in the warn ink, over the
		  edges rather than under them, which is legible across the whole canvas at the opening fit.
		  This is the difference between a pretty picture and a diagnostic — it is the only thing on
		  the canvas the reader can act on.
		*/
		if (duplicateLinks.length > 0) {
			context.save();
			context.setLineDash([5, 4]);
			context.lineWidth = Math.max(0.8, 1.1 * zoom);
			context.strokeStyle = ink.warn;
			context.globalAlpha = dimming ? 0.4 : 0.95;
			context.beginPath();
			for (const link of duplicateLinks) {
				const a = positions.get(link.source);
				const b = positions.get(link.target);
				if (!a || !b) continue;
				context.moveTo(sx(a.x), sy(a.y));
				context.lineTo(sx(b.x), sy(b.y));
			}
			context.stroke();
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
			context.globalAlpha = litText === '1' ? 1 : 0.3;
			context.beginPath();
			for (const { node, px, py } of members) {
				const r = screenRadius(node.degree) * zoom;
				context.moveTo(px + r, py);
				context.arc(px, py, r, 0, Math.PI * 2);
			}
			context.fill();
		}

		/*
		 * A RING ON EVERY MATCH, in the accent. Raising a matched node's opacity cannot mark it: on a
		 * canvas of 1,274 dots a full-strength dot is what a dot looks like, and finding two of them
		 * is the search the reader just asked the app to do for them.
		 */
		if (dimming) {
			context.globalAlpha = 1;
			context.strokeStyle = ink.accent;
			context.lineWidth = Math.max(1.2, 1.6 * zoom);
			context.beginPath();
			for (const node of nodes) {
				if (!lit(node.id)) continue;
				const point = positions.get(node.id);
				if (!point) continue;
				const r = screenRadius(node.degree) * zoom + 3.5;
				context.moveTo(sx(point.x) + r, sy(point.y));
				context.arc(sx(point.x), sy(point.y), r, 0, Math.PI * 2);
			}
			context.stroke();
		}

		/* A ring on the pair the reader could merge, so the dashed line has two visible ends. */
		context.globalAlpha = dimming ? 0.35 : 1;
		context.strokeStyle = ink.warn;
		context.lineWidth = Math.max(0.8, 1 * zoom);
		context.beginPath();
		for (const node of nodes) {
			if (!node.duplicate) continue;
			const point = positions.get(node.id);
			if (!point) continue;
			const r = screenRadius(node.degree) * zoom + 2.5;
			context.moveTo(sx(point.x) + r, sy(point.y));
			context.arc(sx(point.x), sy(point.y), r, 0, Math.PI * 2);
		}
		context.stroke();

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
		  LABELS. Three reasons a name gets one, and they are cumulative:
		  the largest few always, everything in view once the reader has zoomed past the threshold,
		  and whatever is under the pointer.
		*/
		context.globalAlpha = 1;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const everything = scale > view.current.fit * LABEL_ZOOM;
		const labelled = [];
		for (const node of nodes) {
			const wanted = everything || alwaysLabelled.has(node.id) || node.id === hovered || node.id === selected;
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
			context.font = `${emphasis ? 600 : 400} ${emphasis ? 12 : 10.5}px ${ink.font}`;
			const text = node.label;
			const measured = context.measureText(text).width;
			const offset = screenRadius(node.degree) * zoom + (emphasis ? 11 : 8);
			const box = {
				left: px - measured / 2 - 3,
				right: px + measured / 2 + 3,
				top: py + offset - 8,
				bottom: py + offset + 8,
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
			context.fillStyle = emphasis ? ink.text : ink.faint;
			context.fillText(text, px, py + offset);
		}
	}, [nodes, edges, duplicateLinks, positions, alwaysLabelled, highlight, selected, hovered, byId]);

	const schedule = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(paint);
	}, [paint]);

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

	useEffect(() => {
		schedule();
	}, [schedule]);

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
