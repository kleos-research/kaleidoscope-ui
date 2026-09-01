/**
 * The hub programme, as arithmetic. No rendering, no fetching, no engine call.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `graph-model.mjs` reconstructs the graph, projects it through a lens, and picks a default view.
 * All of it assumes the shape a working vault has: a few hundred names, a maximum degree in single
 * digits, and fragmentation as the subject. That assumption fails in exactly one way, and it fails
 * hard: **a large vault has a hub** — one name, usually the one meaning "the owner of this vault",
 * joined to a large fraction of everything, with a degree in the tens or hundreds of thousands.
 * Thrown at a force layout that is a black disc, and a user looking at a black disc concludes the
 * product is broken. It is not a framerate problem. The machine draws it perfectly happily.
 *
 * This file is the treatment. Three decisions, in order:
 *
 *   1. **Which regime is this graph in?** One pass over the degree distribution, before anything is
 *      drawn (`detectRegime`).
 *   2. **What counts as a hub, here?** A threshold computed from THIS graph's distribution, never a
 *      constant (`collapseThreshold`).
 *   3. **What does the drawing do about it?** Collapse the hub into a compound meta-node, or absorb
 *      it into the background — and in both cases say exactly what was hidden, how much, and how to
 *      bring it back (`planView`).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY IT WORKS ON THE PROJECTION AND NOT ON THE ENTITY GRAPH
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `planView` takes what `projectLens` returned — drawn nodes and drawn edges, whatever lens made
 * them — rather than raw surfaces. A hub is a property of the picture the user is looking at, and
 * the three lenses do not agree about who has one: a name touched by one memory is a chip in C and
 * a vertex in E. Written against surfaces this would have been correct in exactly one lens and
 * silently wrong in the other two, which is the same defect as a hardcoded threshold wearing
 * different clothes.
 *
 * Regime DETECTION stays on the entity graph, because PRD 0005 R16 asks for one pass over the
 * cached export at load, before a lens is chosen. The two readings answer different questions and
 * both are reported.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE EVERY FUNCTION BELOW OBEYS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **Every reduction is visible, counted exactly, and reversible.** A view that quietly narrows is
 * the failure this entire programme exists to prevent: the reader cannot tell a sparse vault from a
 * cropped one, and has no reason to suspect the difference. So nothing here removes an element
 * without writing a ledger row that names it, counts it, and carries the action that puts it back —
 * and `planView` with no reductions asked for returns the complete projection, always.
 *
 * **No suppression is ever keyed to a surface string.** There is no stop list in this file and there
 * must never be one. A hub is found by its degree against a threshold derived from the data; a
 * literal surface written into a suppression path is a transcribed vocabulary, which this project
 * forbids outright, and it would stop matching the day a writer spelled the name differently —
 * silently, and in the direction that hides things.
 */

import { DEFAULT_LENS, DRAW_CAP, projectLens, scopeSurfaces } from './graph-model.mjs';

/**
 * The floor under the collapse threshold.
 *
 * `p99 × 4` alone degenerates on a fragmented graph. A working vault is mostly degree-1 names, so
 * its 99th-percentile degree is often 1 or 2, and four times that is 4 — at which point a third of
 * the vault is a "hub" and the collapse fires on everything. Twenty is roughly where a node stops
 * being readable as a ring of labels around a point, which is the only thing the collapse protects.
 */
export const COLLAPSE_FLOOR = 20;

/** How far past the 99th percentile a node must be before it is an outlier rather than a busy node. */
export const COLLAPSE_MULTIPLE = 4;

/**
 * The degree distribution, in one pass plus one sort.
 *
 * The singleton fraction is here because it is the other half of regime detection and it is nearly
 * free: PRD 0005 §6 names it as the instrument that would falsify the whole design if real vaults
 * came back connected. It is computed whether or not anything reads it today, because the cost is a
 * counter and the alternative is not being able to answer the question later.
 */
export function degreeStats(graph) {
	const degrees = new Int32Array(graph.nodes.size);
	let index = 0;
	let singletons = 0;
	for (const node of graph.nodes.values()) {
		degrees[index] = node.degree;
		if (node.degree <= 1) singletons += 1;
		index += 1;
	}
	degrees.sort();

	const at = (quantile) =>
		degrees.length === 0 ? 0 : degrees[Math.min(degrees.length - 1, Math.floor(quantile * (degrees.length - 1)))];

	return {
		count: degrees.length,
		max: degrees.length === 0 ? 0 : degrees[degrees.length - 1],
		p50: at(0.5),
		p90: at(0.9),
		p99: at(0.99),
		singletonCount: singletons,
		singletonFraction: degrees.length === 0 ? 0 : singletons / degrees.length,
	};
}

/**
 * `max(20, p99 × 4)` — PRD 0005 R17.
 *
 * **Why the threshold is relative to a percentile of this graph and not a constant.** A fixed cap is
 * wrong in one of two directions and there is no value that is wrong in neither:
 *
 *   * Set it high enough to mean something on a vault with a 100,000-degree hub — say 500 — and on a
 *     working vault, whose busiest name touches ten facts, it never fires. The collapse becomes code
 *     that has never run, which is the same as code that does not exist, and nobody finds out until
 *     the first large vault meets it.
 *   * Set it low enough to fire on a working vault — say 8 — and on the large vault it fires on
 *     hundreds of nodes at once, including every node that carries the actual topology. The picture
 *     collapses into a field of boxes and the reduction has eaten the thing it was reducing.
 *
 * A percentile-relative threshold asks a different question, and it is the right one: **is this node
 * an outlier IN THIS GRAPH?** Four times the 99th percentile means "four times more connected than
 * all but the busiest one per cent of names here". On a working vault, where the spread is narrow,
 * nothing clears it and the collapse correctly never fires — a threshold derived from the data is
 * visibly a computed guard rather than a magic number, and its silence is evidence rather than an
 * absence of evidence. On a starred vault the hub clears it by three orders of magnitude and
 * nothing else comes close.
 *
 * The floor is the guard on the guard: see COLLAPSE_FLOOR.
 */
export function collapseThreshold(stats) {
	return Math.max(COLLAPSE_FLOOR, stats.p99 * COLLAPSE_MULTIPLE);
}

/**
 * Every node past the threshold, busiest first, each with the two counts a collapse needs.
 *
 * `leafNeighbours` is how many of this node's neighbours appear in NO OTHER FACT — the mass a
 * collapse absorbs. `connectorNeighbours` is the rest: the ones carrying topology, which stay drawn.
 * Both are computed here rather than at collapse time because they are what the OFFER has to say
 * before the user accepts it, and an offer that cannot state its own consequence is a dialogue box
 * asking for a signature on a blank page.
 */
export function findHubs(graph, threshold) {
	const hubs = [];
	for (const node of graph.nodes.values()) {
		if (node.degree <= threshold) continue;
		let leaves = 0;
		let connectors = 0;
		const counted = new Set();
		for (const edge of graph.incident.get(node.surface) ?? []) {
			const other = edge.source === node.surface ? edge.target : edge.source;
			if (other === node.surface || counted.has(other)) continue;
			counted.add(other);
			// "Drawn nowhere else" is a property of the whole graph: a neighbour whose every fact
			// runs through this hub has no position without it.
			if ((graph.nodes.get(other)?.degree ?? 0) <= 1) leaves += 1;
			else connectors += 1;
		}
		hubs.push({
			surface: node.surface,
			degree: node.degree,
			neighbourCount: counted.size,
			leafNeighbours: leaves,
			connectorNeighbours: connectors,
		});
	}
	return hubs.sort((a, b) => b.degree - a.degree || a.surface.localeCompare(b.surface));
}

/**
 * REGIME DETECTION, at load, in one pass over the cached export.
 *
 * Three regimes, separated by two thresholds, and each threshold is derived rather than chosen:
 *
 *   | regime     | the reading                                             | the treatment           |
 *   | ---------- | ------------------------------------------------------- | ----------------------- |
 *   | `working`  | nothing past the collapse threshold, and the default     | draw it                 |
 *   |            | view fits under the cap                                  |                         |
 *   | `over-cap` | still nothing past the threshold, but the largest group   | the reduction ladder    |
 *   |            | is more elements than a person can read                  |                         |
 *   | `hub`      | one name is an outlier against this graph's own p99      | collapse it             |
 *
 * `hub` is tested FIRST because the two readings are not exclusive — a vault with a hub is also over
 * the cap — and the treatments are not interchangeable. Reducing to "the largest connected group" on
 * a starred vault returns the star; no rung of the ladder helps, because the problem is not the
 * quantity of elements but the shape they are in.
 *
 * `forced` separates "there is a hub" from "the canvas cannot proceed without doing something about
 * it". A thirty-node star with a degree-25 centre is past the threshold and still draws fine; there
 * the collapse is OFFERED, not applied. Conflating the two would make a reduction the user never
 * asked for into the default on a graph that was perfectly legible — which is the silent narrowing
 * this whole programme exists to prevent, arrived at from the other side.
 *
 * @param {object} graph
 * @param {number} [options.cap]
 * @param {number|null} [options.projectedElements] the element count of the view actually about to
 *        be drawn. Given, it decides `forced`; absent, the entity-level count stands in. The two can
 *        differ by orders of magnitude between lenses, and `forced` is a statement about the drawing.
 */
export function detectRegime(graph, { cap = DRAW_CAP, projectedElements = null } = {}) {
	const stats = degreeStats(graph);
	const threshold = collapseThreshold(stats);
	const hubs = findHubs(graph, threshold);

	const wholeElements = graph.counts.nodeCount + graph.counts.edgeCount;
	const largest = graph.components[0];
	const largestElements = largest ? largest.size + largest.edgeCount : 0;
	const drawnElements = projectedElements ?? wholeElements;

	const regime = hubs.length > 0 ? 'hub' : largestElements > cap ? 'over-cap' : 'working';
	const forced = regime === 'hub' ? drawnElements > cap : regime === 'over-cap';

	return {
		regime,
		forced,
		threshold,
		stats,
		hubs,
		cap,
		wholeElements,
		largestComponentElements: largestElements,
		treatment:
			regime === 'hub' ? (forced ? 'collapse' : 'offer-collapse') : regime === 'over-cap' ? 'reduce' : 'draw',
		// The sentence is built here, beside the numbers it quotes, so a screen cannot render one
		// treatment while describing a different one.
		reason:
			regime === 'hub'
				? `“${hubs[0].surface}” is named by ${hubs[0].degree.toLocaleString()} facts. Anything past ` +
					`${threshold.toLocaleString()} is an outlier in this vault — that is four times its ` +
					`99th-percentile name, which is named by ${stats.p99.toLocaleString()}.`
				: regime === 'over-cap'
					? `The largest connected group is ${largestElements.toLocaleString()} elements, past the ` +
						`${cap.toLocaleString()} this view draws. Nothing here is an outlier: the busiest name is named ` +
						`by ${stats.max.toLocaleString()} facts, against a threshold of ${threshold.toLocaleString()}.`
					: `Nothing here is past the collapse threshold of ${threshold.toLocaleString()}, and the default ` +
						`view fits. The busiest name is named by ${stats.max.toLocaleString()} facts.`,
	};
}

/**
 * The scope a hub regime seeds on, as a RULE rather than a materialised set.
 *
 * Two steps out, not one. A depth-1 ego network on a hub is a hundred thousand leaves and it is
 * useless twice over: it is far over the cap before the collapse, and after the collapse it is a
 * single box with nothing beside it, because in a depth-1 ego nothing has a reason to be drawn
 * except the hub itself. Going out to two puts the tail behind the connectors on screen, which is
 * the only part with any structure in it.
 *
 * It is a rule and not a set because the whole view state has to survive being written into the
 * address bar and read back (R25). A default that returned a hundred thousand surfaces could not be
 * a link.
 */
export const hubScope = (hub) => ({ kind: 'ego', seed: hub.surface ?? hub, depth: 2 });

/** The drawn id of a hub, in the id space `projectLens` uses. */
export const hubNodeId = (hub) => `e:${hub.surface ?? hub}`;

/**
 * THE PLAN: which elements are drawn, what was hidden, and how to bring each piece back.
 *
 * This is the one function the canvas reads. It takes a PROJECTION — whatever `projectLens`
 * returned for the current lens and scope — and three user-initiated reductions, and it returns the
 * drawn elements plus a LEDGER. Nothing is removed that does not appear in the ledger with its own
 * count and its own undo, and calling this with no reductions returns the projection unchanged,
 * which is the property that makes "nothing narrows silently" checkable rather than promised.
 *
 * @param {object} projection      `{ nodes, edges }` from `projectLens`
 * @param {Set}  opts.collapsed    node ids to draw as compound meta-nodes
 * @param {Set}  opts.absorbed     node ids to take off the canvas and hang on their neighbours
 * @param {Map}  opts.expanded     node id → how many of its hidden neighbours to reveal
 * @param {string|null} opts.pinned  a node id that stays drawn whatever happens (the selection)
 */
export function planView(
	projection,
	{ collapsed = new Set(), absorbed = new Set(), expanded = new Map(), cap = DRAW_CAP, pinned = null } = {},
) {
	const byId = new Map(projection.nodes.map((node) => [node.id, node]));
	const incident = new Map();
	for (const edge of projection.edges) {
		for (const end of edge.source === edge.target ? [edge.source] : [edge.source, edge.target]) {
			const list = incident.get(end);
			if (list) list.push(edge);
			else incident.set(end, [edge]);
		}
	}

	const drawn = new Set(byId.keys());
	const droppedEdges = new Set();
	const badges = new Map();
	const metaNodes = [];
	const ledger = [];
	const parentOf = new Map();
	let capReached = false;

	const otherEnd = (edge, id) => (edge.source === id ? edge.target : edge.source);
	// The in-lens degree, which is what "drawn nowhere else" is a statement about.
	const drawnDegree = (id) => (incident.get(id) ?? []).length;
	/**
	 * The tie-break, and it is deliberately NOT `localeCompare`.
	 *
	 * Two reasons, and the second is the one that matters. It is slow: the ids being ordered here are
	 * a hub's neighbours, almost all of the same degree, so the tie-break runs on nearly every
	 * comparison of a sort over a hundred thousand items — measured at two seconds for a single
	 * click, which is a hang. And it is not deterministic across machines: `localeCompare` reads the
	 * runtime's collation, so "the top 150 by this order" could be a different 150 in a different
	 * locale, and the `showing k of N` chip would be a true sentence about a set nobody else sees.
	 * Code-unit order is stable everywhere and is the order this file states.
	 */
	const byId2 = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
	// The label a person recognises, and the number behind it. An entity node carries the whole
	// underlying node, so the box can say how many FACTS name it even in a lens whose edges are not
	// facts — the two numbers are different and the box shows both rather than picking one.
	const labelOf = (id) => byId.get(id)?.surface ?? byId.get(id)?.title ?? id;
	const factsOf = (id) => byId.get(id)?.node?.degree ?? null;

	// ── absorb into context ────────────────────────────────────────────────────────────────────
	//
	// The honest form of the stop-list idea. A name so universal that drawing it says nothing —
	// every memory touches it, so the edge carries no information — leaves the canvas and becomes an
	// ATTRIBUTE of each node it touched. A star becomes a readable forest and nothing is deleted:
	// the badge on each neighbour still names the relationship and its direction. Per node,
	// user-initiated, reversible, announced, and never keyed to a string.
	for (const id of [...absorbed].sort((a, b) => drawnDegree(b) - drawnDegree(a) || byId2(a, b))) {
		if (!drawn.has(id) || id === pinned) continue;
		drawn.delete(id);

		let hiddenEdges = 0;
		const touched = new Set();
		for (const edge of incident.get(id) ?? []) {
			if (droppedEdges.has(edge.id)) continue;
			droppedEdges.add(edge.id);
			hiddenEdges += 1;
			const other = otherEnd(edge, id);
			if (other !== id) touched.add(other);
		}

		// A neighbour whose only edge was to the absorbed node is now an isolated dot. On a name this
		// universal there are a hundred thousand of them, and a hundred thousand dots is the same
		// black disc by another route. They leave with it — counted and named SEPARATELY, because
		// "the node you absorbed" and "the names that had nothing else" are two different things to
		// have hidden, and one number for both would conflate a choice with its consequence.
		let orphanedNodes = 0;
		const survivors = [];
		for (const other of touched) {
			if (!drawn.has(other)) continue;
			const stillDrawn = (incident.get(other) ?? []).some(
				(edge) => !droppedEdges.has(edge.id) && drawn.has(otherEnd(edge, other)),
			);
			if (stillDrawn || other === pinned) {
				survivors.push(other);
				continue;
			}
			drawn.delete(other);
			orphanedNodes += 1;
		}

		const survivorSet = new Set(survivors);
		for (const edge of incident.get(id) ?? []) {
			const other = otherEnd(edge, id);
			if (!survivorSet.has(other)) continue;
			const list = badges.get(other) ?? [];
			list.push({
				id,
				label: labelOf(id),
				predicate: edge.predicate ?? edge.label ?? null,
				direction: edge.source === id ? 'from' : 'to',
				edge,
			});
			badges.set(other, list);
		}

		ledger.push({
			kind: 'absorbed',
			id,
			label: labelOf(id),
			hiddenNodes: 1 + orphanedNodes,
			hiddenEdges,
			orphanedNodes,
			sentence:
				`“${labelOf(id)}” is off the canvas and on its neighbours instead: ` +
				`${survivors.length.toLocaleString()} name${survivors.length === 1 ? '' : 's'} now carry it as a badge ` +
				'saying which relationship joined them' +
				(orphanedNodes > 0
					? `. ${orphanedNodes.toLocaleString()} of them had no other link at all and left the canvas with ` +
						'it — they are still in the list, and still in the memories that wrote them.'
					: '.'),
			undo: { action: 'restore-absorbed', id, label: `Draw “${labelOf(id)}” again` },
			list: { action: 'open-list', id, label: `List everything that names it` },
		});
	}

	// ── collapse into a compound meta-node ─────────────────────────────────────────────────────
	//
	// A REAL graph element, not a drawing trick, which is the whole reason Cytoscape's compound
	// nodes were chosen over a library that only draws: the parent has a stable id, so selection,
	// layout and the click-into-the-editor path all keep working through the collapse. The hub node
	// itself becomes the parent's first child, so the box is labelled with what it contains and the
	// hub is still there to click.
	for (const id of [...collapsed].sort((a, b) => drawnDegree(b) - drawnDegree(a) || byId2(a, b))) {
		// Absorption supersedes collapse: they are two treatments of one node, and offering both at
		// once would be drawing a box around something that is no longer on the canvas.
		if (!drawn.has(id) || absorbed.has(id)) continue;

		// Which neighbours are drawn for a reason of their own? One with an edge that does not run
		// through this hub carries topology and stays. The rest are the mass.
		const hidden = [];
		const seen = new Set();
		for (const edge of incident.get(id) ?? []) {
			if (droppedEdges.has(edge.id)) continue;
			const other = otherEnd(edge, id);
			if (other === id || seen.has(other) || !drawn.has(other)) continue;
			seen.add(other);
			const elsewhere = (incident.get(other) ?? []).some(
				(candidate) =>
					!droppedEdges.has(candidate.id) &&
					candidate.source !== id &&
					candidate.target !== id &&
					drawn.has(otherEnd(candidate, other)),
			);
			if (!elsewhere && other !== pinned) hidden.push(other);
		}

		const wanted = Math.max(0, expanded.get(id) ?? 0);

		// Busiest first, then by id, so "the top k" is a STATED order and the same k gives the same k
		// names on every machine. A reveal whose order moved between runs would make the
		// `showing k of N` chip a lie about which k.
		//
		// Sorted only when something is actually going to be revealed. A plain collapse reveals
		// nothing, so ordering a hundred thousand ids to decide which of them to hide first would be
		// most of the cost of the commonest operation on this screen — and it would buy an order
		// nobody reads.
		if (wanted > 0) hidden.sort((a, b) => drawnDegree(b) - drawnDegree(a) || byId2(a, b));

		// Hide the whole mass first, then reveal back up to k. The other order runs the cap check
		// while a hundred thousand leaves are still counted as drawn, so it refuses every reveal and
		// the expansion silently does nothing — the failure mode of a guard evaluated against the
		// wrong state: it reports as working and has never let anything through.
		const withheld = new Map();
		let hiddenEdges = 0;
		for (const other of hidden) {
			drawn.delete(other);
			const dropped = [];
			for (const edge of incident.get(other) ?? []) {
				if (droppedEdges.has(edge.id)) continue;
				droppedEdges.add(edge.id);
				dropped.push(edge);
				hiddenEdges += 1;
			}
			withheld.set(other, dropped);
		}

		const revealed = [];
		// Re-check the cap BEFORE each addition, not after the batch. A reveal that overshot and then
		// apologised has already drawn the thing the cap exists to prevent.
		let elementsNow = drawn.size + (projection.edges.length - droppedEdges.size) + metaNodes.length + 1;
		for (const candidate of hidden) {
			if (revealed.length >= wanted) break;
			const dropped = withheld.get(candidate) ?? [];
			if (elementsNow + 1 + dropped.length > cap) {
				capReached = true;
				break;
			}
			drawn.add(candidate);
			// A revealed child sits INSIDE the parent box, which is what a compound node is for.
			parentOf.set(candidate, `hub:${id}`);
			for (const edge of dropped) droppedEdges.delete(edge.id);
			hiddenEdges -= dropped.length;
			revealed.push(candidate);
			elementsNow += 1 + dropped.length;
		}
		if (revealed.length < wanted && revealed.length < hidden.length) capReached = true;

		const hiddenNodes = hidden.length - revealed.length;
		const kept = seen.size - hidden.length;
		parentOf.set(id, `hub:${id}`);
		metaNodes.push({
			id: `hub:${id}`,
			childId: id,
			label: labelOf(id),
			drawnDegree: drawnDegree(id),
			factDegree: factsOf(id),
			hiddenNodes,
			hiddenEdges,
			shownChildren: revealed.length,
			keptNeighbours: kept,
			// What the list holds. **A hundred thousand items is a list, and a node-link diagram is
			// not** — this is the load-bearing half of the collapse, and the number on the box is the
			// promise the list has to keep.
			listTotal: factsOf(id) ?? drawnDegree(id),
		});
		ledger.push({
			kind: 'collapsed',
			id,
			label: labelOf(id),
			hiddenNodes,
			hiddenEdges,
			shownChildren: revealed.length,
			capReached,
			sentence:
				`“${labelOf(id)}” is joined to ${drawnDegree(id).toLocaleString()} things here. ` +
				`${hiddenNodes.toLocaleString()} that are joined to nothing else ` +
				`${hiddenNodes === 1 ? 'is' : 'are'} inside the box with ${hiddenEdges.toLocaleString()} of its links; ` +
				`${kept.toLocaleString()} that go somewhere else stay drawn` +
				(revealed.length > 0 ? `, and ${revealed.length.toLocaleString()} are shown inside it.` : '.'),
			undo: {
				action: 'uncollapse',
				id,
				label: `Draw all ${hiddenNodes.toLocaleString()} of them`,
				// The consequence of the undo, stated before it is taken. Offering "show everything"
				// without saying it is forty times the cap is how a canvas blacks out on a click.
				elementsAfter: drawn.size + hiddenNodes + (projection.edges.length - droppedEdges.size) + hiddenEdges,
			},
			list: { action: 'open-list', id, label: `List all ${(factsOf(id) ?? drawnDegree(id)).toLocaleString()} of them` },
		});
	}

	const nodes = [];
	for (const id of drawn) {
		const node = byId.get(id);
		if (node) nodes.push({ ...node, parent: parentOf.get(id) ?? null, badges: badges.get(id) ?? [] });
	}
	const edges = projection.edges.filter((edge) => !droppedEdges.has(edge.id));

	return {
		nodes,
		edges,
		metaNodes,
		badges,
		ledger,
		capReached,
		elementCount: nodes.length + edges.length + metaNodes.length,
		hidden: {
			nodes: ledger.reduce((total, entry) => total + entry.hiddenNodes, 0),
			edges: ledger.reduce((total, entry) => total + entry.hiddenEdges, 0),
		},
		// What the same projection would have drawn with nothing reduced. Carried so a strip can put
		// the two numbers side by side without recomputing, and so a test can check that the
		// difference is exactly what the ledger claims it is.
		unreduced: {
			nodes: projection.nodes.length,
			edges: projection.edges.length,
			elementCount: projection.nodes.length + projection.edges.length,
		},
	};
}

/**
 * Undo one ledger row, as a pure state transition.
 *
 * The reduction state is three collections, so putting something back is removing a key — but doing
 * that inside the component means "reversible" is a property nobody can check without clicking.
 * Here it is a function, and the test asserts the round trip: reduce, undo every row, and get back
 * the plan the same projection produces with nothing asked for.
 */
export function applyUndo(state, entry) {
	const collapsed = new Set(state.collapsed ?? []);
	const absorbed = new Set(state.absorbed ?? []);
	const expanded = new Map(state.expanded ?? []);
	if (entry.undo.action === 'uncollapse') {
		collapsed.delete(entry.undo.id);
		expanded.delete(entry.undo.id);
	}
	if (entry.undo.action === 'restore-absorbed') absorbed.delete(entry.undo.id);
	return { collapsed, absorbed, expanded };
}

/**
 * The claim list behind a collapsed hub, built once and sliced by the scroller.
 *
 * **A hundred thousand items is a list, and a node-link diagram is not.** This is the load-bearing
 * half of the collapse: the picture stops trying to show the mass, and the list shows all of it, in
 * a stated order, every row linking to the memory that asserts it.
 *
 * Bucketed by predicate in one pass and concatenated in predicate-frequency order — no sort over the
 * rows themselves, because at this size the sort is most of the cost, and the export's own order is
 * meaningful anyway: it is the order the facts were written. Within a predicate the rows keep it.
 */
export function hubIndex(graph, surface) {
	const incident = graph.incident.get(surface) ?? [];
	const buckets = new Map();
	for (const edge of incident) {
		const key = edge.predicate ?? '';
		const bucket = buckets.get(key);
		if (bucket) bucket.push(edge);
		else buckets.set(key, [edge]);
	}
	const groups = [...buckets.entries()]
		.map(([predicate, rows]) => ({ predicate: predicate || null, count: rows.length, rows }))
		.sort((a, b) => b.count - a.count || String(a.predicate).localeCompare(String(b.predicate)));

	const rows = [];
	const byPredicate = [];
	for (const group of groups) {
		byPredicate.push({ predicate: group.predicate, count: group.count, offset: rows.length });
		for (const edge of group.rows) rows.push(edge);
	}
	return { surface, total: rows.length, byPredicate, rows };
}

/**
 * One window of that list. The scroller renders this and a spacer; it never renders `total` rows.
 *
 * Clamped rather than throwing, because the caller is a scroll handler: a fast flick past the end
 * asks for an offset that does not exist, and the correct answer to that is the last page.
 */
export function hubWindow(index, offset, limit) {
	const start = Math.max(0, Math.min(index.total, Math.floor(offset)));
	const end = Math.max(start, Math.min(index.total, start + Math.max(0, Math.floor(limit))));
	return {
		offset: start,
		limit: end - start,
		total: index.total,
		rows: index.rows.slice(start, end).map((edge, position) => ({
			position: start + position,
			edge,
			other: edge.source === index.surface ? edge.target : edge.source,
			direction: edge.source === index.surface ? 'from' : 'to',
		})),
	};
}

/**
 * The reduction ladder's rungs, each carrying the element count it would produce IN THIS LENS.
 *
 * Extracted from the panel that used to compute it inline, for one reason: it had never run. A
 * working vault draws a few hundred elements against a cap of two thousand, so every button on that
 * panel was arithmetic nobody had ever seen a result from — and from there a robust result and an
 * inert knob look exactly the same. As a pure function it is checkable against a fixture that
 * genuinely crosses the cap.
 *
 * Every rung states its own consequence before it is taken, INCLUDING the ones that do not help. A
 * rung still over the cap is returned with `fits: false` rather than dropped, because "this
 * reduction is not enough either" is something the reader needs to know and an absent button cannot
 * say it.
 */
export function reductionOptions(graph, { cap = DRAW_CAP, lens = DEFAULT_LENS, memoryTypes = [], hubs = [] } = {}) {
	const elementsOf = (scope) => projectLens(graph, { lens, surfaces: scopeSurfaces(graph, scope) }).elementCount;

	const options = [];
	const largest = graph.components[0];
	if (largest) {
		options.push({
			key: 'largest-component',
			label: 'The largest connected group',
			scope: { kind: 'component', componentId: largest.id },
			elements: elementsOf({ kind: 'component', componentId: largest.id }),
		});
	}
	for (const minDegree of [3, 2]) {
		options.push({
			key: `degree-${minDegree}`,
			label: `Names used by ${minDegree} facts or more`,
			scope: { kind: 'degree', minDegree },
			elements: elementsOf({ kind: 'degree', minDegree }),
		});
	}
	for (const entry of memoryTypes.slice(0, 4)) {
		options.push({
			key: `type-${entry.value}`,
			label: `Memories of type “${entry.value}”`,
			scope: { kind: 'memory_type', memoryType: entry.value },
			elements: elementsOf({ kind: 'memory_type', memoryType: entry.value }),
		});
	}

	// THE EGO RUNGS, and they are here because the panel needed them.
	//
	// The first fixture that genuinely crossed the cap found that every rung above was still over it:
	// on a densely connected vault "the largest group" IS the whole thing, and a minimum degree of
	// two removes almost nothing. The panel then offered five reductions, none of which fitted, and a
	// sentence pointing at the search box — an escape hatch with no number on it, which is the one
	// thing every other rung is careful not to be.
	//
	// These two are the same rungs the automatic ladder falls through, which is the correct
	// relationship between the two: the panel offers by hand what the ladder would have chosen, so a
	// user who dismisses the automatic choice is not offered a different set of options from the one
	// that was made for them.
	if (largest) {
		const busiest = largest.nodes.reduce(
			(best, surface) =>
				(graph.nodes.get(surface)?.degree ?? 0) > (graph.nodes.get(best)?.degree ?? -1) ? surface : best,
			largest.nodes[0],
		);
		for (const depth of [2, 1]) {
			options.push({
				key: `ego-${depth}`,
				label: `Around “${busiest}”, ${depth} step${depth === 1 ? '' : 's'} out`,
				scope: { kind: 'ego', seed: busiest, depth },
				elements: elementsOf({ kind: 'ego', seed: busiest, depth }),
			});
		}
	}

	// The rung that exists only in a hub regime, and the only one that helps there: every other rung
	// returns the star, because the problem is the shape and not the quantity.
	for (const hub of hubs.slice(0, 2)) {
		const scope = hubScope(hub);
		const projection = projectLens(graph, { lens, surfaces: scopeSurfaces(graph, scope) });
		options.push({
			key: `collapse-${hub.surface}`,
			label: `Around “${hub.surface}”, with it collapsed`,
			scope,
			collapse: hubNodeId(hub),
			elements: planView(projection, { collapsed: new Set([hubNodeId(hub)]), cap }).elementCount,
		});
	}

	return options
		.filter((option) => option.elements > 0)
		.map((option) => ({ ...option, fits: option.elements <= cap }));
}
