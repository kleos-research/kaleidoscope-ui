/**
 * THE NAMES SCREENS, AS ARITHMETIC. No React, no canvas, no fetching, no engine call.
 *
 * `graph-model.mjs` reconstructs one graph from the export the browser already holds. This file is
 * everything the three name surfaces READ off that reconstruction: the table's rows and its four
 * orders, the panel a selected name fills, the bounded neighbourhood the ego drawing draws, and the
 * element set the whole-vault overview paints.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE TABLE IS THE ENTRY POINT AND THE PICTURE IS NOT
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A readable label chip is about 120 × 20 px. Twelve hundred of them need roughly 2.9M px² of ink
 * against about 1.5M px² of canvas — **the labels alone want about twice the whole drawing** — so a
 * fully-labelled vault picture is not a design decision, it is arithmetically impossible. That is
 * why the default surface is a table of names and why the overview labels on hover, above a zoom
 * threshold, and always for the largest few.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * TWO CEILINGS, AND THEY ARE DIFFERENT KINDS OF NUMBER
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `EGO_CAP` is a LEGIBILITY limit: the controlled study this design was reviewed against put
 * readers wrong or unsure more than half the time on connectivity tasks at 100 nodes, so the ego
 * drawing stops well below that and says how many it did not draw. `OVERVIEW_CEILING` is a
 * RENDERING limit: what a canvas can repaint inside a frame. Holding one number for both is how a
 * legibility claim comes to be enforced by a renderer, and how a renderer's limit comes to be
 * quoted as a claim about what a person can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT HERE, ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **There is no path between two names.** Two names drawn from this vault share a component about
 * 2% of the time, so the feature answers "no path" in ~97 of every 100 uses; and where a path does
 * exist the component is very nearly a tree, so the path is unique and linear — a breadcrumb, not a
 * drawing. It is a beautiful demo with a near-total failure rate, and no function below computes
 * one. Neither is there community detection (the components already ARE the clusters, and each is
 * a tree), edge bundling (there are no parallel edges to bundle), or a centrality score (max degree
 * is ten, so the whole interesting part of the ladder is a few dozen rows the table shows in full).
 */

import { normaliseWords } from './graph-model.mjs';

/**
 * THE EGO DRAWING'S HARD NODE CAP.
 *
 * Sixty, and it is a promise rather than a hope: the neighbourhood is grown a whole ring at a time
 * and the ring that would cross this number is not drawn at all, so the reader never sees a
 * half-drawn ring they cannot tell from a complete one. Max degree in a vault of this shape is
 * about ten, so depth 1 is at most eleven nodes and the cap is almost never reached — which is
 * exactly why it is cheap to keep. A cap that fires constantly is a budget; a cap that never fires
 * is a guarantee.
 */
export const EGO_CAP = 60;

/** The ego stepper's range. Three is where a neighbourhood stops being about the thing at its centre. */
export const EGO_MAX_DEPTH = 3;

/**
 * WHAT THE OVERVIEW CANVAS WILL PAINT, in drawn elements.
 *
 * Not a legibility limit — see the header. A canvas draws a circle in about a microsecond, so this
 * is set by what fits in a 16ms frame with room to spare, measured rather than guessed. Above it
 * the overview refuses and says so, because a picture that silently drew 40% of a vault would look
 * exactly like a vault that was 40% this size.
 */
export const OVERVIEW_CEILING = 20_000;

/** How many of the biggest names keep a label at every zoom level. */
export const ALWAYS_LABELLED = 12;

const compareText = (a, b) => String(a).localeCompare(String(b));

/** The most-declared kind for a name, or null. Ties break on the kind's own spelling, so it is stable. */
export function primaryKind(node) {
	let best = null;
	let bestCount = 0;
	for (const [kind, count] of node?.kinds ?? []) {
		if (count > bestCount || (count === bestCount && best !== null && compareText(kind, best) < 0)) {
			best = kind;
			bestCount = count;
		}
	}
	return best;
}

/** When a name was last mentioned, as a sortable number. Absent dates sort last, never as zero-equals-old. */
function lastMentioned(node) {
	let best = null;
	for (const memory of node.memories) {
		const at = memory.created_on ? Date.parse(memory.created_on) : Number.NaN;
		const value = Number.isNaN(at) ? null : at;
		if (value !== null && (best === null || value > best)) best = value;
	}
	if (best !== null) return best;
	// No parseable date anywhere on the node. Sequence is the store's own order and is a fallback,
	// not an equivalent: it orders correctly and it is not a time.
	let sequence = null;
	for (const memory of node.memories) {
		if (typeof memory.sequence === 'number' && (sequence === null || memory.sequence > sequence)) {
			sequence = memory.sequence;
		}
	}
	return sequence === null ? null : sequence;
}

/**
 * THE FOUR NUMBERS ABOVE THE TABLE, AND THE SENTENCE THEY ADD UP TO.
 *
 * This IS the whole-vault view, delivered as text. Every claim the picture can make about the shape
 * of this vault is one of these four readings, and here they are legible instead of estimated by
 * eye. The picture is kept for the job text cannot do — seeing WHERE the small things are, and that
 * a duplicate pair sits on opposite sides of the vault — not for these numbers.
 *
 * @param {object} graph      from `buildGraph`
 * @param {Array}  duplicates from `nearDuplicates`
 */
export function vaultShape(graph, duplicates = []) {
	const counts = graph.counts;
	return {
		nameCount: counts.nodeCount,
		statementCount: counts.edgeCount,
		namedOnce: counts.degreeOneCount,
		componentCount: counts.componentCount,
		largestComponent: counts.largestComponent,
		duplicateGroups: duplicates.length,
		duplicateNames: duplicates.reduce((total, group) => total + group.surfaces.length, 0),
		maxDegree: counts.maxDegree,
	};
}

/**
 * Surface -> what a merge would do to it.
 *
 * `provisional` is the degree this name WOULD gain if every other spelling proposed against it
 * turned out to be the same thing. That number is the entire argument for merging and it belongs in
 * the bar beside the real one: the reader is looking at four connections and two that are one
 * identity decision away, which is a different proposition from "four".
 *
 * BOTH RULES ARE IN HERE, and that is a correction rather than a preference. The strict rule differs
 * only in punctuation and case; the loose one also ignores word order, articles and a trailing
 * plural and finds several times as many. An earlier version admitted only the strict rule, and the
 * result was a screen whose summary card said twelve and whose tab said two — one label, one
 * population, two numbers, and no way for a reader to tell which was their vault. Every proposal is
 * a QUESTION either way: the chip shows the other spelling, the action is spelled "Merge?", and the
 * rule that found it and the evidence behind it are on the curation screen, where the decision is
 * actually made.
 *
 * A surface can be proposed by both rules and by more than one group, so the others accumulate and
 * are deduplicated. Taking the last group to mention a name would silently drop the other spelling
 * that a reader could see with their own eyes in the row above.
 */
export function duplicateIndex(duplicates = []) {
	const index = new Map();
	for (const group of duplicates) {
		for (const entry of group.surfaces) {
			const existing = index.get(entry.surface) ?? {
				keys: [],
				rules: new Set(),
				others: new Map(),
				sameComponent: true,
			};
			existing.keys.push(group.key);
			existing.rules.add(group.rule);
			if (!group.sameComponent) existing.sameComponent = false;
			for (const other of group.surfaces) {
				if (other.surface === entry.surface) continue;
				existing.others.set(other.surface, other.degree);
			}
			index.set(entry.surface, existing);
		}
	}

	const flat = new Map();
	for (const [surface, entry] of index) {
		if (entry.others.size === 0) continue;
		flat.set(surface, {
			keys: entry.keys,
			rules: [...entry.rules],
			sameComponent: entry.sameComponent,
			others: [...entry.others.keys()],
			provisional: [...entry.others.values()].reduce((total, degree) => total + degree, 0),
		});
	}
	return flat;
}

/**
 * How many names the "possible duplicates" tab holds — the count that must agree with the card.
 *
 * The card counts GROUPS and the tab counts NAMES, and those are honestly different numbers, so
 * both are computed from one function and the screen labels them differently rather than printing
 * two numbers under one word.
 */
export const duplicateNameCount = (duplicates = []) => duplicateIndex(duplicates).size;

/**
 * THE FOUR ORDERS THE TABS OFFER.
 *
 * Two of them are sorts and two of them are FILTERS wearing a sort's clothes, and the difference is
 * why each carries its own count in the tab: "Possible duplicates 12" and "Named once 888" change
 * what is in the table, not merely what order it is in, and a reader who cannot see that from the
 * control will read a shorter table as a bug.
 */
export const NAME_ORDERS = Object.freeze([
	{
		id: 'connected',
		label: 'Most connected',
		/*
		 * The default. And the caveat the mockup's own copy carries: with a maximum degree around
		 * ten the distance between rank 1 and rank 20 is a handful of facts, so this is an ORDERING
		 * and not an importance claim. The degree bar says the same thing by having visible ticks
		 * rather than a smooth length — it is honest about the resolution it has.
		 */
		compare: (a, b) => b.degree - a.degree || b.memoryCount - a.memoryCount || compareText(a.surface, b.surface),
	},
	{
		id: 'recent',
		label: 'Recently mentioned',
		compare: (a, b) => {
			if (a.lastAt === null && b.lastAt === null) return compareText(a.surface, b.surface);
			if (a.lastAt === null) return 1;
			if (b.lastAt === null) return -1;
			return b.lastAt - a.lastAt || compareText(a.surface, b.surface);
		},
	},
	{
		id: 'duplicates',
		label: 'Possible duplicates',
		only: (row) => row.alsoSpelled.length > 0,
		compare: (a, b) =>
			b.degree + b.provisional - (a.degree + a.provisional) || compareText(a.surface, b.surface),
	},
	{
		id: 'once',
		label: 'Named once',
		only: (row) => row.degree === 1,
		compare: (a, b) => {
			if (a.lastAt === null && b.lastAt === null) return compareText(a.surface, b.surface);
			if (a.lastAt === null) return 1;
			if (b.lastAt === null) return -1;
			return b.lastAt - a.lastAt || compareText(a.surface, b.surface);
		},
	},
]);

export const DEFAULT_ORDER = NAME_ORDERS[0].id;

export const orderById = (id) => NAME_ORDERS.find((order) => order.id === id) ?? NAME_ORDERS[0];

/**
 * Every name, as a table row, before any order or filter is applied.
 *
 * Built once per graph and re-ordered afterwards, because the four tabs are four readings of one
 * list. Deriving the rows inside each tab is how two tabs come to disagree about one name's degree.
 */
export function nameRows(graph, duplicates = []) {
	const index = duplicateIndex(duplicates);
	const rows = [];
	for (const node of graph.nodes.values()) {
		const duplicate = index.get(node.surface) ?? null;
		rows.push({
			surface: node.surface,
			kind: primaryKind(node),
			kindCount: node.kinds.size,
			gloss: node.glosses[0] ?? null,
			degree: node.degree,
			memoryCount: node.memories.length,
			componentId: node.componentId,
			componentSize: node.componentSize,
			declared: node.declared,
			lastAt: lastMentioned(node),
			alsoSpelled: duplicate?.others ?? [],
			provisional: duplicate?.provisional ?? 0,
			sameComponent: duplicate?.sameComponent ?? null,
		});
	}
	return rows;
}

/**
 * Filter by what the reader typed, then by the tab, then order.
 *
 * The query matches the surface AND the loose fingerprint, so typing `retry budget` finds
 * `the retry budget` — which is the whole point of a screen whose subject is that those two are
 * different things. It never matches a kind or a gloss: a find box that quietly matched three
 * fields returns rows whose reason for being there is invisible.
 */
export function orderedRows(rows, { query = '', order = DEFAULT_ORDER } = {}) {
	const chosen = orderById(order);
	const needle = String(query ?? '').trim().toLowerCase();
	const loose = needle ? normaliseWords(needle) : '';

	const matched = rows.filter((row) => {
		if (chosen.only && !chosen.only(row)) return false;
		if (!needle) return true;
		if (row.surface.toLowerCase().includes(needle)) return true;
		return loose.length > 0 && normaliseWords(row.surface).includes(loose);
	});

	return matched.sort(chosen.compare);
}

/** The count each tab would show, computed on the unfiltered rows so a query cannot move it. */
export function orderCounts(rows) {
	const counts = {};
	for (const order of NAME_ORDERS) {
		counts[order.id] = order.only ? rows.filter(order.only).length : rows.length;
	}
	return counts;
}

/**
 * WHAT A SELECTED NAME IS, AS TEXT — the second surface in this product and the more used one.
 *
 * A picture of nine nodes cannot tell a reader what is said about the thing at its centre; it can
 * only tell them that nine things are. So the panel is the answer to "what do we know about this",
 * the drawing is the answer to "what is the shape around it", and this function produces the first.
 *
 * BECAUSE DEGREE IS BOUNDED AT ABOUT TEN, EVERY LIST HERE IS COMPLETE. No pagination, no "show
 * more" that hides a claim, no truncation the reader cannot see the edge of. The panel renders the
 * first few and offers the rest behind a count — which is a different thing from a list that stops.
 */
export function nameReading(graph, surface, duplicates = []) {
	const node = graph.nodes.get(surface);
	if (!node) return null;

	const incident = graph.incident.get(surface) ?? [];
	const predicates = new Set();
	const statements = [];
	for (const edge of incident) {
		if (edge.predicate) predicates.add(edge.predicate);
		const outgoing = edge.source === surface;
		statements.push({
			id: edge.id,
			predicate: edge.predicate,
			other: outgoing ? edge.target : edge.source,
			outgoing,
			memory_id: edge.memory_id,
			memory_title: edge.memory_title,
			mode: edge.mode,
			from: edge.from,
			until: edge.until,
		});
	}

	const memories = [...node.memories].sort((a, b) => {
		const at = a.created_on ? Date.parse(a.created_on) : Number.NaN;
		const bt = b.created_on ? Date.parse(b.created_on) : Number.NaN;
		if (Number.isNaN(at) && Number.isNaN(bt)) return (b.sequence ?? 0) - (a.sequence ?? 0);
		if (Number.isNaN(at)) return 1;
		if (Number.isNaN(bt)) return -1;
		return bt - at;
	});

	const index = duplicateIndex(duplicates);

	return {
		surface,
		kind: primaryKind(node),
		kinds: [...node.kinds.entries()].map(([kind, count]) => ({ kind, count })),
		gloss: node.glosses[0] ?? null,
		glosses: node.glosses,
		declared: node.declared,
		degree: node.degree,
		memoryCount: node.memories.length,
		relationCount: predicates.size,
		componentId: node.componentId,
		componentSize: node.componentSize,
		statements,
		memories,
		alsoSpelled: index.get(surface)?.others ?? [],
	};
}

/**
 * THE BOUNDED NEIGHBOURHOOD THE EGO DRAWING DRAWS.
 *
 * Grown a whole ring at a time, and a ring that would cross `EGO_CAP` is refused entire. That is
 * the difference between a drawing that is complete to a stated depth and one that is complete to
 * an unstated fraction of a depth — and a reader cannot tell the second from the first by looking,
 * which is what makes it a refusal spelled as an answer.
 *
 * @returns {{nodes, edges, depth, reachedDepth, capped, hidden}}
 *          `hidden` is how many neighbours the refused ring would have added. It is a real count,
 *          not an estimate, so the drawing can say "4 more at this depth" rather than "some".
 */
export function egoElements(graph, surface, { depth = 1, palette = null, cap = EGO_CAP } = {}) {
	const seed = graph.nodes.get(surface);
	if (!seed) return { nodes: [], edges: [], depth, reachedDepth: 0, capped: false, hidden: 0 };

	const reached = new Map([[surface, 0]]);
	let frontier = [surface];
	let reachedDepth = 0;
	let capped = false;
	let hidden = 0;

	for (let step = 1; step <= Math.max(1, depth); step += 1) {
		const ring = [];
		const inRing = new Set();
		for (const from of frontier) {
			for (const edge of graph.incident.get(from) ?? []) {
				for (const end of [edge.source, edge.target]) {
					if (reached.has(end) || inRing.has(end)) continue;
					inRing.add(end);
					ring.push(end);
				}
			}
		}
		if (ring.length === 0) break;
		if (reached.size + ring.length > cap) {
			capped = true;
			hidden = ring.length;
			break;
		}
		for (const end of ring) reached.set(end, step);
		frontier = ring;
		reachedDepth = step;
	}

	const slotOf = palette?.slotOf ?? (() => -1);
	const nodes = [...reached.keys()].map((id) => {
		const node = graph.nodes.get(id);
		const kind = primaryKind(node);
		return {
			id,
			label: id,
			kind,
			slot: slotOf(kind),
			degree: node.degree,
			depth: reached.get(id),
			memoryCount: node.memories.length,
		};
	});

	// Every export edge whose BOTH ends are drawn. Never a synthesised one: an edge on this canvas
	// that the export does not literally contain is a claim this app invented about the reader's
	// memories, and the direction of that error is somebody merging two things that were never one.
	const edges = graph.edges
		.filter((edge) => reached.has(edge.source) && reached.has(edge.target))
		.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			label: edge.predicate,
		}));

	return { nodes, edges, depth, reachedDepth, capped, hidden };
}

/**
 * THE WHOLE VAULT, AS ELEMENTS FOR THE OVERVIEW CANVAS.
 *
 * This view is a DIAGNOSTIC and an OVERVIEW, and it is neither the default nor a way to find a
 * particular thing. You open it to feel the size and shape of what your agent knows — where the
 * one big region is, how much of the vault is a field of small things, and whether two spellings of
 * one thing are sitting on opposite sides of it. Everything below is chosen for that job:
 *
 *   - `degree` sizes a node, so how often a name is used is the first thing the eye reads;
 *   - `slot` colours it by kind, from the run-time palette, so no kind vocabulary is written down;
 *   - `duplicateLinks` are the actionable structure — a dashed line between two spellings of what
 *     is probably one thing, which is the one relationship the layout cannot show by position
 *     because the two are usually in different components.
 */
export function overviewElements(graph, { palette = null, duplicates = [] } = {}) {
	const slotOf = palette?.slotOf ?? (() => -1);
	const index = duplicateIndex(duplicates);

	const nodes = [];
	for (const node of graph.nodes.values()) {
		const kind = primaryKind(node);
		nodes.push({
			id: node.surface,
			label: node.surface,
			kind,
			slot: slotOf(kind),
			degree: node.degree,
			memoryCount: node.memories.length,
			componentId: node.componentId,
			componentSize: node.componentSize,
			duplicate: index.has(node.surface),
		});
	}

	const edges = graph.edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
	}));

	// One link per unordered pair inside a strict group, keyed so a group of three yields three.
	const seen = new Set();
	const duplicateLinks = [];
	for (const [surface, entry] of index) {
		for (const other of entry.others) {
			const key = surface < other ? `${surface}\u0000${other}` : `${other}\u0000${surface}`;
			if (seen.has(key)) continue;
			seen.add(key);
			duplicateLinks.push({
				id: `d${duplicateLinks.length}`,
				source: surface,
				target: other,
				sameComponent: entry.sameComponent,
			});
		}
	}

	// The names that keep a label at every zoom level: the biggest few, and nothing else. Twelve
	// labels on a vault-sized canvas is orientation; a hundred is the wall of text the arithmetic
	// at the top of this file says cannot fit.
	const always = new Set(
		[...nodes]
			.sort((a, b) => b.degree - a.degree || compareText(a.id, b.id))
			.slice(0, ALWAYS_LABELLED)
			.map((node) => node.id),
	);

	return {
		nodes,
		edges,
		duplicateLinks,
		alwaysLabelled: always,
		elementCount: nodes.length + edges.length + duplicateLinks.length,
		overCeiling: nodes.length + edges.length + duplicateLinks.length > OVERVIEW_CEILING,
	};
}

/**
 * Which names a query lights up in the overview.
 *
 * The overview and the table are ONE WORLD, and this is what makes that true rather than claimed:
 * the same box filters the table's rows and returns the set the canvas highlights, so a reader who
 * types a name sees the same answer in both renderings. A picture with its own search would be a
 * second feature that agrees with the first only until one of them is edited.
 *
 * Returns `null` for an empty query, which means "no highlight" and is not the same as an empty
 * set, which means "nothing matched" and dims the entire canvas.
 */
export function highlightSet(rows, query) {
	const needle = String(query ?? '').trim();
	if (needle.length === 0) return null;
	return new Set(orderedRows(rows, { query: needle, order: 'connected' }).map((row) => row.surface));
}

/**
 * THE ONE HONEST CAPTION under the overview, and the fuller statement behind it.
 *
 * Three claims, one line, and each is about what a reader is looking at rather than about the
 * implementation: it is the app's own drawing, names joined only where they are spelled the same,
 * and the picture carries shape rather than detail. The four-line version this replaced was true,
 * resident, and read past — honesty about a property and displaying it permanently are different
 * requirements.
 */
export const OVERVIEW_CAPTION =
	'Drawn by this app from what your memories say. Names join only where they are spelled ' +
	'identically, so this is the shape of your vault rather than the detail of it.';

/** The same claim where one name is in front of the reader, in the words GraphFocus draws. */
export const FOCUS_CAPTION =
	'Drawn by this app from what your memories say. Two spellings the engine already treats as one ' +
	'thing would still appear here twice.';

/**
 * THE URL CARRIES THE SURFACE VERBATIM, percent-encoded and nothing else.
 *
 * Not a normalised key, not a hash, not an index into a list. The entire subject of these screens
 * is that `retry budget` and `the retry budget` are two different things, so a route key that
 * folded them together would open one name's panel from the other's row — the exact confusion the
 * screen exists to show — and a route key that was a position in a sorted list would address a
 * different name after the next write.
 */
export const nameRoute = (surface) => `#/names/${encodeURIComponent(surface)}`;

/** The inverse. Returns null for anything that is not a name route, so the caller can fall through. */
export function surfaceFromRoute(hash) {
	const match = String(hash ?? '').match(/^#\/names\/(.+)$/);
	if (!match) return null;
	try {
		const surface = decodeURIComponent(match[1]);
		return surface.length > 0 ? surface : null;
	} catch {
		// A hand-edited or truncated percent-escape. Not a name, and not a crash.
		return null;
	}
}
