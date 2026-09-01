import { useEffect, useRef } from 'react';

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

/**
 * The Cytoscape binding, written by hand.
 *
 * `react-cytoscapejs` is the obvious dependency and it is not taken: last published 2022, a class
 * component, and it wraps an imperative library in a declarative shell that then has to be fought
 * whenever a layout needs to be re-run at a moment React does not know about. The binding below is
 * the whole of what that package would have given us. Cytoscape owns the canvas; React owns the
 * DOM around it; the only traffic between them is elements in and selection out.
 *
 * fcose is the layout because it is the one in this family that handles DISCONNECTED COMPONENTS
 * deliberately, packing them rather than letting them drift to infinity — which is the shape this
 * vault actually has. It is MIT, and so are its two transitive dependencies. (`elkjs` is
 * EPL-2.0 OR GPL-3.0-or-later and must never enter this tree; it is what a graph library without a
 * layout engine makes people reach for.)
 */
cytoscape.use(fcose);

/**
 * Colour is read from the stylesheet, not written here, so the light and dark palettes live beside
 * every other colour in the app and a theme switch is one place. Cytoscape's stylesheet does not
 * resolve CSS custom properties, so they are resolved once per bind and re-resolved when the
 * system theme changes.
 */
function readPalette(element) {
	const style = getComputedStyle(element);
	const value = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
	return {
		slots: Array.from({ length: 8 }, (_, index) => value(`--k${index}`, '#888888')),
		other: value('--k-other', '#8b8b8b'),
		text: value('--text', '#000000'),
		muted: value('--muted', '#666666'),
		line: value('--line-strong', '#cccccc'),
		accent: value('--accent', '#2f5d8a'),
		surface: value('--surface', '#ffffff'),
	};
}

function stylesheet(palette) {
	return [
		{
			selector: 'node',
			style: {
				// SHAPE carries role, LABEL carries the kind, COLOUR is redundant with both. An
				// unknown kind renders grey and still says its own name.
				'background-color': (node) => palette.slots[node.data('slot')] ?? palette.other,
				'background-opacity': 0.85,
				shape: (node) => (node.data('marked') ? 'diamond' : 'ellipse'),
				'border-width': (node) => (node.data('marked') ? 2 : 1),
				'border-style': (node) => (node.data('marked') ? 'dashed' : 'solid'),
				'border-color': palette.line,
				width: 'data(size)',
				height: 'data(size)',
				label: 'data(label)',
				color: palette.text,
				'font-size': 9,
				// WRAP, NOT ELLIPSIS. The label is two lines — the surface, then its kind — joined
				// by a newline, and `ellipsis` ignores a manual newline: it lays the whole label out
				// as one run and clips it to `text-max-width`, taking a bite out of the MIDDLE of
				// every name long enough to matter, which renders most of this canvas as half-words.
				// Wrapping honours the newline, keeps the kind on its own line, and breaks a long
				// surface across lines rather than eating it.
				'text-wrap': 'wrap',
				'text-max-width': 120,
				'text-valign': 'bottom',
				'text-margin-y': 3,
				'text-background-color': palette.surface,
				'text-background-opacity': 0.72,
				'text-background-padding': 2,
				'min-zoomed-font-size': 7,
			},
		},
		{
			// A MEMORY IS A DIFFERENT SHAPE, NOT A DIFFERENT COLOUR. The two node kinds on this canvas
			// are what the whole C lens is about — a memory you can click into a verb, and a name two
			// memories share — so the distinction has to survive a monochrome print and a colour-blind
			// reader. Rectangle for the thing that has a title; ellipse for the thing that has a
			// spelling. The label is the memory's own title, wrapped, on the node rather than under it.
			selector: 'node[kind = "memory"]',
			style: {
				shape: 'round-rectangle',
				'background-color': palette.accent,
				'background-opacity': 0.16,
				'border-width': 1.5,
				'border-style': 'solid',
				'border-color': palette.accent,
				width: 'label',
				height: 'label',
				padding: 6,
				'text-valign': 'center',
				'text-halign': 'center',
				'text-max-width': 108,
				'font-size': 9,
				'text-background-opacity': 0,
			},
		},
		{
			// A COLLAPSED HUB, and it is a real compound parent rather than a big circle.
			//
			// This is the one primitive Cytoscape was chosen for. The parent has its own id, so the
			// selection, the layout and the click-into-the-editor path all keep working through a
			// collapse; the hub node itself is its first child, so the box is labelled with what it
			// holds and the hub is still there to click. HATCHED — a dashed border and a barely-there
			// fill — because it must not read as a node that happens to be large: it is a container,
			// and its label says how many names are inside it and not drawn.
			selector: 'node[kind = "meta"]',
			style: {
				shape: 'round-rectangle',
				'background-color': palette.muted,
				'background-opacity': 0.06,
				'border-width': 2,
				'border-style': 'dashed',
				'border-color': palette.muted,
				padding: 18,
				'text-valign': 'top',
				'text-halign': 'center',
				'text-margin-y': -4,
				'text-max-width': 200,
				'font-size': 10,
				'text-background-opacity': 0.85,
			},
		},
		{
			// A node carrying badges from an absorbed name. The badge count is on the node because
			// "it became an attribute of its neighbours" has to be visible on the neighbour, and the
			// panel lists what each badge says.
			selector: 'node[badges]',
			style: { 'border-width': 2.5, 'border-style': 'double', 'border-color': palette.accent },
		},
		{
			selector: 'node[?conflict]',
			// A second, independent channel for the second finding: a dotted ring for one surface
			// declared under two kinds. Redundant with the panel row, so never colour alone.
			style: { 'border-style': 'dotted', 'border-width': 3, 'border-color': palette.accent },
		},
		{
			selector: 'edge',
			style: {
				'curve-style': 'bezier',
				width: 1.2,
				'line-color': palette.line,
				'target-arrow-color': palette.line,
				'target-arrow-shape': 'triangle',
				'arrow-scale': 0.7,
				label: 'data(label)',
				'font-size': 8,
				color: palette.muted,
				'text-rotation': 'autorotate',
				'text-background-color': palette.surface,
				'text-background-opacity': 0.7,
				'text-background-padding': 1,
				'min-zoomed-font-size': 8,
			},
		},
		{
			// An INCIDENCE — this memory touched this name. It is the commonest edge in the default
			// lens, so it is the quietest: no arrowhead, because "touched" has no direction worth
			// drawing, and the direction that does exist (subject or object) is in the panel.
			selector: 'edge[kind = "incidence"]',
			style: { 'target-arrow-shape': 'none', width: 1, 'line-opacity': 0.8 },
		},
		{
			// A SHARED SURFACE — two memories that name the same thing. Drawn without an arrow and
			// labelled with the name itself, because an edge whose reason is not on screen is exactly
			// what makes the memories lens mute, and the label is the only place the reason fits.
			selector: 'edge[kind = "shared-surface"]',
			style: { 'target-arrow-shape': 'none', 'line-style': 'solid', width: 1.4, 'line-opacity': 0.7 },
		},
		{
			selector: 'edge[band = "rare"]',
			// Most relationship names in a real vault are used exactly once. THE PALE DASHED EDGES
			// ARE THE FRAGMENTATION — visible as a texture before any label is read.
			style: { 'line-style': 'dashed', 'line-opacity': 0.45, width: 0.9 },
		},
		{
			selector: ':selected',
			style: {
				'border-color': palette.accent,
				'border-width': 3,
				'line-color': palette.accent,
				'target-arrow-color': palette.accent,
				'line-opacity': 1,
			},
		},
		{ selector: '.dim', style: { opacity: 0.18, 'text-opacity': 0 } },
		{ selector: '.hit', style: { 'border-color': palette.accent, 'border-width': 4 } },
	];
}

const LAYOUT = {
	name: 'fcose',
	quality: 'default',
	animate: false,
	randomize: true,
	// The two that matter on a fragmented graph: pack the components instead of letting them fly
	// apart, and give the singletons enough room that they read as separate rather than as noise.
	packComponents: true,
	// A MEMORY NODE IS AS BIG AS ITS TITLE, so the layout has to lay out the boxes rather than the
	// points inside them. Without this, fcose separates centres and the titles overlap into an
	// unreadable pile — which looks like a dense graph and is actually a layout that never saw the
	// labels. It costs a little quality and buys the only thing that matters here: legibility.
	nodeDimensionsIncludeLabels: true,
	nodeSeparation: 90,
	idealEdgeLength: 70,
	nodeRepulsion: 6000,
	padding: 24,
};

/**
 * @param {object} props
 * @param {{nodes: object[], edges: object[]}} props.elements already-selected, already-under-cap
 * @param {(nodeId: string|null) => void} props.onSelect  a prefixed node id — see `parseNodeId`
 * @param {(nodeId: string|null, position: {x:number,y:number}|null) => void} props.onHover
 * @param {string|null} props.focus a node id to centre and flash, set by the search box
 * @param {boolean} props.showEdgeLabels off above a few hundred edges, where they are unreadable
 */
export function GraphCanvas({ elements, onSelect, onHover, focus, showEdgeLabels }) {
	const container = useRef(null);
	const cy = useRef(null);
	const callbacks = useRef({ onSelect, onHover });
	callbacks.current = { onSelect, onHover };

	// One instance for the life of the screen. Rebuilding it on every element change would throw
	// away the viewport, and a canvas that re-zooms when you tick a filter is unusable.
	useEffect(() => {
		const instance = cytoscape({
			container: container.current,
			style: stylesheet(readPalette(container.current)),
			wheelSensitivity: 0.25,
			maxZoom: 4,
			minZoom: 0.05,
		});
		cy.current = instance;

		instance.on('tap', 'node', (event) => callbacks.current.onSelect(event.target.id()));
		instance.on('tap', (event) => {
			if (event.target === instance) callbacks.current.onSelect(null);
		});
		instance.on('mouseover', 'node', (event) => {
			const { x, y } = event.target.renderedPosition();
			callbacks.current.onHover(event.target.id(), { x, y });
		});
		instance.on('mouseout', 'node', () => callbacks.current.onHover(null, null));

		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const repaint = () => instance.style(stylesheet(readPalette(container.current)));
		media.addEventListener('change', repaint);

		return () => {
			media.removeEventListener('change', repaint);
			instance.destroy();
			cy.current = null;
		};
	}, []);

	// Elements in. The identity of `elements` is the memo key from the view, so this runs when the
	// drawn set actually changes and not on every render.
	useEffect(() => {
		const instance = cy.current;
		if (!instance) return;
		instance.batch(() => {
			instance.elements().remove();
			instance.add([
				...elements.nodes.map((data) => ({ group: 'nodes', data })),
				...elements.edges.map((data) => ({ group: 'edges', data })),
			]);
		});
		if (instance.elements().length > 0) instance.layout(LAYOUT).run();
	}, [elements]);

	useEffect(() => {
		cy.current?.style().selector('edge').style({ label: showEdgeLabels ? 'data(label)' : '' }).update();
	}, [showEdgeLabels, elements]);

	// The search box focuses a node rather than filtering to it, so its surroundings stay on screen.
	useEffect(() => {
		const instance = cy.current;
		if (!instance || !focus) return undefined;
		const node = instance.$id(focus);
		if (node.length === 0) return undefined;
		node.addClass('hit');
		instance.animate({ center: { eles: node }, zoom: 1.4 }, { duration: 300 });
		const timer = setTimeout(() => node.removeClass('hit'), 1600);
		return () => clearTimeout(timer);
	}, [focus, elements]);

	return <div className="graph-canvas" ref={container} />;
}
