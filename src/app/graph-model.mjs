/**
 * The reconstructed graph, as arithmetic. No rendering, no fetching, no engine call.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THIS IS A RECONSTRUCTION. IT IS NOT THE ENGINE'S GRAPH.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * No door returns the engine's own nodes and edges. What this module does is group the facts of
 * the cached export on the endpoint SURFACE STRING, which is sound in principle — identity in this
 * system is exact surface match, a property a client can see — and still not faithful. Four known
 * gaps, with the direction each runs:
 *
 *   1. The engine may hold two surfaces as one deferred identity. We see two strings, we draw two
 *      nodes.                                                                → we OVER-FRAGMENT.
 *   2. There is a class of link the export does not carry at all. No door emits it.
 *                                                                            → we UNDER-CONNECT.
 *   3. Supersession. Every fact of every live memory is drawn with equal weight; a superseded
 *      claim and its successor render as two identical edges.                → we OVER-DRAW.
 *   4. Removed memories are excluded from the export while remaining reachable by id. Whether
 *      their nodes persist in the engine's graph is not answerable.          → UNKNOWN.
 *
 * Over-fragmenting is the safe direction and it is chosen deliberately. The cost of a drawn edge
 * that does not exist is a user merging two things that were never one — an irreversible rewrite
 * across every memory that names them. The cost of a missing edge is a click. So the rule that
 * governs every line below is: **NEVER PRODUCE AN EDGE THE EXPORT DOES NOT LITERALLY CONTAIN.**
 * The near-duplicate detector at the bottom is a CANDIDATE GENERATOR for a human, never a
 * transform on the model. Nothing here merges anything.
 */

/**
 * The legibility budget, in drawn elements (nodes + edges). Not a framerate budget: the library
 * will happily draw ten times this at an acceptable framerate and teach nobody anything.
 */
export const DRAW_TARGET = 800;
export const DRAW_CAP = 2000;

/** A trimmed non-empty string, or null. Absent is reported as absent everywhere in this app. */
const text = (value) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

/**
 * The near-duplicate key: lowercase, and drop everything that is not a letter or a digit.
 *
 * `Opus 5`, `opus-5` and `OPUS 5.` all land on `opus5`. This key is used ONLY to nominate pairs
 * for a person to look at. It is never a node id, never a group-by for the graph itself, and
 * nothing in this file merges two surfaces that share one.
 */
export function normaliseSurface(surface) {
	return String(surface ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

/**
 * English function words, folded out of the looser key below.
 *
 * This is NOT a transcribed vocabulary of the kind this project forbids. It contains no memory
 * type, no entity kind and no relationship name — nothing read from the vault appears in it. It is
 * a list of articles and prepositions, and it exists because on a real vault the commonest
 * near-duplicate by a wide margin is one writer's leading "the".
 */
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'of', 'for', 'in', 'on', 'to', 'and', 'is', 'its', 'that', 'this']);

/**
 * The looser key: same words, ignoring order, articles, and a trailing plural.
 *
 * The three shapes it catches, in invented names rather than in anybody's: `the vandrel beacon` /
 * `vandrel beacon` differ by an article, `quorix_reading` / `the quorix reading` by punctuation and
 * an article together, and `mirdel staging trellis` / `mirdel trellis staging` by word order alone.
 * Looser means more false pairs, so a group found only by this rule is LABELLED as found by it and
 * the panel says which rule matched. It still merges nothing.
 *
 * THE EXAMPLES ARE INVENTED ON PURPOSE. Illustrating a rule with a pair taken out of the vault the
 * screen was developed against is the leak a text scanner cannot catch — it has no vault to compare
 * a comment with — and an example that reads as somebody's data is exactly as disclosing in a
 * comment as it is in a screenshot. `test/boundary-vault.test.mjs` is the check that holds this.
 */
export function normaliseWords(surface) {
	return String(surface ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
		.split(' ')
		.filter((word) => word.length > 0 && !FUNCTION_WORDS.has(word))
		.map((word) => word.replace(/ies$/, 'y').replace(/(?:es|s)$/, ''))
		.sort()
		.join(' ');
}

/**
 * Union-find, so components cost one pass over the edges rather than a traversal per node.
 * Isolation is the headline statistic on this screen, so it has to be cheap enough to always be on.
 */
function unionFind(size) {
	const parent = new Int32Array(size).map((_, index) => index);
	const find = (index) => {
		let root = index;
		while (parent[root] !== root) root = parent[root];
		let walk = index;
		while (parent[walk] !== root) {
			const next = parent[walk];
			parent[walk] = root;
			walk = next;
		}
		return root;
	};
	return {
		find,
		union(a, b) {
			const rootA = find(a);
			const rootB = find(b);
			if (rootA !== rootB) parent[rootB] = rootA;
		},
	};
}

/**
 * Build the whole model from the cached export, in one pass.
 *
 * A NODE is a distinct subject/object surface. An EDGE is a fact.
 *
 * Whether a surface was also DECLARED as a named thing is an attribute of the node, never an
 * admission test. Building from declared entities only is the tempting filter and it is a defect:
 * on a real vault most fact endpoints are undeclared, so that graph draws almost nothing and
 * reports success. A declared name that appears in no fact has no edge and no position — it is
 * not drawn, and it is reported separately as `declaredNeverAsserted`, which is itself a finding.
 *
 * @param {Array<object>} records exported memory records: `{ memory_id, semantic: { facts, entities, … } }`
 */
export function buildGraph(records = []) {
	/** surface -> node */
	const nodes = new Map();
	const edges = [];
	/** memory_id -> the memory as a NODE, because two of the three lenses draw it as one */
	const memories = new Map();
	/**
	 * One entry per fact ENDPOINT: this memory touched this surface, in this role, with this
	 * predicate. It is the bipartite half of the model and it is what lens C draws.
	 *
	 * Kept as the raw list rather than pre-aggregated, because the aggregation is a drawing
	 * decision (one line per memory/surface pair) and the counts underneath it are a finding. A
	 * self-referential fact contributes two entries, deliberately: it is two endpoints.
	 */
	const incidences = [];

	const nodeFor = (surface) => {
		let node = nodes.get(surface);
		if (!node) {
			node = {
				id: surface,
				surface,
				// A multiset: the same surface can be declared under two kinds by two memories, and
				// that disagreement is a finding rather than something to resolve by picking one.
				kinds: new Map(),
				glosses: [],
				// The declarations THEMSELVES, each still carrying the memory that made it.
				//
				// `kinds` above is a count and `glosses` is a set, and both throw away the one thing
				// a curation screen needs: WHICH memory said it. A finding that reports "this name is
				// declared as two kinds" and cannot name the two memories that disagree is a finding
				// nobody can act on — it sends the reader to the list to search for the name by hand.
				declarations: [],
				declared: false,
				degree: 0,
				memories: [],
				memorySet: new Set(),
				componentId: -1,
				componentSize: 0,
			};
			nodes.set(surface, node);
		}
		return node;
	};

	const declaredSurfaces = new Map(); // surface -> [{ memory_id, kind, gloss }]

	for (const record of records) {
		const semantic = record?.semantic ?? {};
		const memoryId = record?.memory_id ?? semantic.memory_id ?? null;
		const memoryTitle = text(semantic.title);
		const memoryType = text(semantic.memory_type);

		// The memory as a node. Every operation this app can perform is addressed by memory id, so
		// a lens with no memory node in it is a lens with no verbs — you can look at a fact and you
		// cannot click it into anything that edits it. That is the whole argument for lens C.
		const memory = memoryId
			? {
					id: memoryId,
					memory_id: memoryId,
					title: memoryTitle,
					memory_type: memoryType,
					scope: semantic.scope ?? null,
					sequence: semantic.sequence ?? null,
					version_id: record?.version_id ?? null,
					factCount: (semantic.facts ?? []).length,
					entityCount: (semantic.entities ?? []).length,
					// Distinct endpoint surfaces this memory touches, in first-seen order.
					surfaces: [],
					surfaceSet: new Set(),
				}
			: null;
		if (memory) memories.set(memoryId, memory);

		for (const entity of semantic.entities ?? []) {
			const surface = text(entity?.n);
			if (!surface) continue;
			const kind = text(entity?.kind);
			const gloss = text(entity?.is);
			const list = declaredSurfaces.get(surface) ?? [];
			list.push({ memory_id: memoryId, memory_title: memoryTitle, kind, gloss });
			declaredSurfaces.set(surface, list);
		}

		for (const fact of semantic.facts ?? []) {
			const subject = text(fact?.subject);
			const object = text(fact?.object);
			const predicate = text(fact?.predicate);
			// A fact missing an endpoint has no position in a drawing of endpoints. It is still a
			// fact of that memory and the detail view still shows it; it is counted, not drawn.
			if (!subject || !object) continue;

			const source = nodeFor(subject);
			const target = nodeFor(object);
			const edge = {
				id: `e${edges.length}`,
				source: subject,
				target: object,
				predicate: predicate ?? null,
				memory_id: memoryId,
				memory_title: memoryTitle,
				memory_type: memoryType,
				confidence:
					typeof fact?.confidence_millionths === 'number' ? fact.confidence_millionths / 1e6 : null,
				// The qualifier fields, carried whole so a click can show the fact as written rather
				// than as this file's paraphrase of it.
				mode: text(fact?.mode),
				from: text(fact?.from),
				until: text(fact?.until),
			};
			edges.push(edge);

			source.degree += 1;
			target.degree += 1;
			for (const node of source === target ? [source] : [source, target]) {
				if (memoryId && !node.memorySet.has(memoryId)) {
					node.memorySet.add(memoryId);
					node.memories.push({ memory_id: memoryId, title: memoryTitle, memory_type: memoryType });
				}
			}

			// The two endpoints, as incidences. Both are recorded even when they are the same node,
			// because the export literally contains two endpoints and this list is the export's
			// shape rather than the drawing's.
			if (memory) {
				for (const [surface, role] of [
					[subject, 'subject'],
					[object, 'object'],
				]) {
					incidences.push({
						id: `i${incidences.length}`,
						memory_id: memoryId,
						surface,
						role,
						predicate: predicate ?? null,
						fact: edge.id,
					});
					if (!memory.surfaceSet.has(surface)) {
						memory.surfaceSet.add(surface);
						memory.surfaces.push(surface);
					}
				}
			}
		}
	}

	// Declarations are attached only to surfaces that actually appear in a fact. The rest are
	// reported as their own finding rather than drawn as floating vertices with no edges.
	const declaredNeverAsserted = [];
	for (const [surface, declarations] of declaredSurfaces) {
		const node = nodes.get(surface);
		if (!node) {
			declaredNeverAsserted.push({ surface, declarations });
			continue;
		}
		node.declared = true;
		node.declarations = declarations;
		for (const declaration of declarations) {
			if (declaration.kind) node.kinds.set(declaration.kind, (node.kinds.get(declaration.kind) ?? 0) + 1);
			if (declaration.gloss && !node.glosses.includes(declaration.gloss)) node.glosses.push(declaration.gloss);
		}
	}

	// ── components ──────────────────────────────────────────────────────────────────────────────
	const order = [...nodes.keys()];
	const indexOf = new Map(order.map((surface, index) => [surface, index]));
	const sets = unionFind(order.length);
	for (const edge of edges) sets.union(indexOf.get(edge.source), indexOf.get(edge.target));

	/** root index -> component */
	const byRoot = new Map();
	for (const surface of order) {
		const root = sets.find(indexOf.get(surface));
		let component = byRoot.get(root);
		if (!component) {
			component = { id: `c${byRoot.size}`, nodes: [], size: 0, edgeCount: 0, memories: new Set() };
			byRoot.set(root, component);
		}
		component.nodes.push(surface);
		component.size += 1;
		const node = nodes.get(surface);
		for (const memory of node.memories) component.memories.add(memory.memory_id);
	}
	for (const edge of edges) byRoot.get(sets.find(indexOf.get(edge.source))).edgeCount += 1;

	for (const component of byRoot.values()) {
		for (const surface of component.nodes) {
			const node = nodes.get(surface);
			node.componentId = component.id;
			node.componentSize = component.size;
		}
	}

	const components = [...byRoot.values()]
		.map((component) => ({
			id: component.id,
			size: component.size,
			edgeCount: component.edgeCount,
			nodes: component.nodes,
			memoryIds: [...component.memories],
			// The label a person recognises: the highest-degree surface in it.
			label: component.nodes.reduce(
				(best, surface) => (nodes.get(surface).degree > (nodes.get(best)?.degree ?? -1) ? surface : best),
				component.nodes[0] ?? null,
			),
		}))
		.sort((a, b) => b.size - a.size || b.edgeCount - a.edgeCount || String(a.id).localeCompare(String(b.id)));

	// ── counts the header and the fidelity strip render ──────────────────────────────────────────
	const predicates = new Map();
	for (const edge of edges) {
		if (!edge.predicate) continue;
		predicates.set(edge.predicate, (predicates.get(edge.predicate) ?? 0) + 1);
	}
	const kinds = new Map();
	for (const node of nodes.values()) {
		for (const [kind, count] of node.kinds) kinds.set(kind, (kinds.get(kind) ?? 0) + count);
	}

	let degreeOne = 0;
	let maxDegree = 0;
	let declaredCount = 0;
	let connectorCount = 0;
	for (const node of nodes.values()) {
		if (node.degree === 1) degreeOne += 1;
		if (node.degree > maxDegree) maxDegree = node.degree;
		if (node.declared) declaredCount += 1;
		// A CONNECTOR is a surface two or more memories touch. It is the only kind of surface that
		// carries connective information at the memory level: one touched by a single memory is a
		// PROPERTY of that memory, and it belongs on that memory's node as a chip rather than in the
		// layout as a vertex. Lens C draws the connectors and folds the rest into chips, which is
		// relocation and not suppression — every folded surface is still on a node, still filterable
		// and still a rail row.
		node.connector = node.memories.length > 1;
		if (node.connector) connectorCount += 1;
		delete node.memorySet;
	}

	// The memory side of the bipartite model: which of a memory's surfaces are connectors, and
	// therefore whether the memory is drawn in C at all or relocated to the rail.
	let connectedMemories = 0;
	for (const memory of memories.values()) {
		delete memory.surfaceSet;
		memory.connectorSurfaces = memory.surfaces.filter((surface) => nodes.get(surface)?.connector);
		memory.foldedSurfaces = memory.surfaces.filter((surface) => !nodes.get(surface)?.connector);
		if (memory.connectorSurfaces.length > 0) connectedMemories += 1;
	}

	const counts = {
		nodeCount: nodes.size,
		edgeCount: edges.length,
		componentCount: components.length,
		largestComponent: components[0]?.size ?? 0,
		degreeOneCount: degreeOne,
		maxDegree,
		distinctPredicates: predicates.size,
		distinctKinds: kinds.size,
		declaredNodeCount: declaredCount,
		undeclaredNodeCount: nodes.size - declaredCount,
		// A component of exactly two nodes joined by one fact: the shape the rail calls an island.
		isolatedFactCount: components.filter((component) => component.size <= 2 && component.edgeCount <= 1).length,
		memoryCount: records.length,
		// The memory level, which is a different and much better-connected graph than the entity
		// one. These four are what decide the C lens's empty state and its header counter.
		memoryNodeCount: memories.size,
		incidenceCount: incidences.length,
		connectorCount,
		loneSurfaceCount: nodes.size - connectorCount,
		connectedMemoryCount: connectedMemories,
		unconnectedMemoryCount: memories.size - connectedMemories,
		factsWithoutEndpoints: records.reduce(
			(total, record) =>
				total +
				(record?.semantic?.facts ?? []).filter((fact) => !text(fact?.subject) || !text(fact?.object)).length,
			0,
		),
	};

	return {
		nodes,
		edges,
		memories,
		incidences,
		components,
		counts,
		declaredNeverAsserted,
		predicates: [...predicates.entries()]
			.map(([predicate, count]) => ({ predicate, count }))
			.sort((a, b) => b.count - a.count || a.predicate.localeCompare(b.predicate)),
		kinds: [...kinds.entries()]
			.map(([kind, count]) => ({ kind, count }))
			.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
		// Which edges touch a node, precomputed once: expansion and neighbourhood are interactive.
		incident: incidenceIndex(nodes, edges),
	};
}

function incidenceIndex(nodes, edges) {
	const index = new Map([...nodes.keys()].map((surface) => [surface, []]));
	for (const edge of edges) {
		index.get(edge.source).push(edge);
		if (edge.target !== edge.source) index.get(edge.target).push(edge);
	}
	return index;
}

/**
 * Surfaces that are nearly the same string and did not merge.
 *
 * This is the single most useful thing this screen can tell its owner, and it exists BECAUSE
 * identity is exact match: `Opus 5` and `opus-5` are two things to the engine, forever, until a
 * person rewrites one. The detector nominates; it never acts. Every group is returned with the
 * evidence behind each spelling, so the reader decides whether the two are actually one thing —
 * `read` and `reads` normalise together and may be genuinely different.
 */
export function nearDuplicates(graph) {
	const bucketBy = (keyOf) => {
		const buckets = new Map();
		for (const node of graph.nodes.values()) {
			const key = keyOf(node.surface);
			if (!key) continue;
			const bucket = buckets.get(key) ?? [];
			bucket.push(node);
			buckets.set(key, bucket);
		}
		return [...buckets.entries()].filter(([, bucket]) => bucket.length > 1);
	};

	// Two rules, run strictest first, and each group says which one found it. The strict rule
	// differs only in punctuation and case and is very nearly always a genuine duplicate; the loose
	// rule ignores word order, articles and a trailing plural, which finds several times as many and
	// asks more of the reader. Both nominate. Neither merges.
	const strict = new Map(bucketBy(normaliseSurface).map(([key, bucket]) => [key, bucket]));
	const seen = new Set();
	const groups = [];

	for (const [key, bucket] of strict) {
		groups.push({ rule: 'punctuation-and-case', key, bucket });
		for (const node of bucket) seen.add(node.surface);
	}
	for (const [key, bucket] of bucketBy(normaliseWords)) {
		// Skip a group the strict rule already reported in full; report the rest, which are the
		// ones a reader has not seen.
		if (bucket.every((node) => seen.has(node.surface))) continue;
		groups.push({ rule: 'same-words', key, bucket });
	}

	return groups
		.map(({ rule, key, bucket }) => ({
			rule,
			key,
			surfaces: bucket
				.map((node) => ({
					surface: node.surface,
					degree: node.degree,
					kinds: [...node.kinds.keys()],
					declared: node.declared,
					memories: node.memories,
					componentId: node.componentId,
				}))
				.sort((a, b) => b.degree - a.degree || a.surface.localeCompare(b.surface)),
			// Whether the two spellings are already joined by a fact. Same component means unifying
			// them changes the labels; different components means unifying them joins two islands.
			sameComponent: new Set(bucket.map((node) => node.componentId)).size === 1,
			weight: bucket.reduce((total, node) => total + node.degree, 0),
		}))
		.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

/**
 * The same surface declared under two or more kinds. Cheap, and it is a real disagreement between
 * two memories rather than a spelling accident.
 */
export function kindConflicts(graph) {
	return [...graph.nodes.values()]
		.filter((node) => node.kinds.size > 1)
		.map((node) => ({
			surface: node.surface,
			kinds: [...node.kinds.entries()].map(([kind, count]) => ({ kind, count })),
			memories: node.memories,
		}))
		.sort((a, b) => b.kinds.length - a.kinds.length || a.surface.localeCompare(b.surface));
}

/** Components of one fact — the islands. Each is a whole claim nothing else in the vault touches. */
export function isolatedFacts(graph) {
	return graph.components
		.filter((component) => component.size <= 2 && component.edgeCount <= 1)
		.map((component) => {
			const edge = graph.incident.get(component.nodes[0])?.[0] ?? null;
			return { component, edge };
		});
}

/** Relationship names used exactly once. Most of them are, and that IS the fragmentation. */
export function onceUsedPredicates(graph) {
	return graph.predicates.filter((entry) => entry.count === 1);
}

/**
 * Every node within `depth` steps of a seed, plus the seed. Used by "expand this node's
 * neighbours" and by the fallback when one component is still too big to draw.
 */
export function neighbourhood(graph, seed, depth = 1) {
	const reached = new Set([seed]);
	let frontier = [seed];
	for (let step = 0; step < depth; step += 1) {
		const next = [];
		for (const surface of frontier) {
			for (const edge of graph.incident.get(surface) ?? []) {
				for (const end of [edge.source, edge.target]) {
					if (!reached.has(end)) {
						reached.add(end);
						next.push(end);
					}
				}
			}
		}
		frontier = next;
		if (frontier.length === 0) break;
	}
	return reached;
}

/**
 * The drawn subgraph: a set of node surfaces, plus every export edge whose BOTH ends are in it.
 *
 * Element count is returned so a caller can compare against DRAW_CAP before anything is drawn.
 * Nothing here truncates. A view that quietly dropped 60% of itself is a refusal spelled as an
 * answer, and the reader cannot tell a sparse vault from a truncated one.
 */
export function subgraph(graph, surfaces) {
	const set = surfaces instanceof Set ? surfaces : new Set(surfaces);
	const nodes = [...set].map((surface) => graph.nodes.get(surface)).filter(Boolean);
	const edges = graph.edges.filter((edge) => set.has(edge.source) && set.has(edge.target));
	return { nodes, edges, elementCount: nodes.length + edges.length };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE LENSES
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ONE reconstruction, three projections of it. A lens switch is `projectLens` run again over the
// SAME `buildGraph` result — nothing is refetched, nothing is rebuilt, and a selection that exists
// in the target lens survives the switch. That is not a performance note: three lenses each
// building their own model is three models that can disagree about the vault, and the disagreement
// would show up as a node that exists on one screen and not on another with no explanation.
//
// WHY C IS THE DEFAULT, and it is not a taste.
//
// The entity lens (E) is the obvious one and it is the wrong first screen for two reasons, the
// second fatal. First, at the entity level a real vault is mostly disconnected dyads: names appear
// in exactly one fact and nothing joins them. Second, E DISCARDS THE MEMORY. Every operation this
// app can perform — open, edit, remove, unify, merge — is addressed by memory id, so a canvas with
// no memory node on it is a canvas with no verbs, and a node's only route into an action is a link
// in a side panel.
//
// THE MEMORY LEVEL IS A DIFFERENT GRAPH, AND IT IS FAR BETTER CONNECTED. Measured with the
// functions below, on a 339-memory vault, at the moment this was written:
//
//   entity level (E)   1,149 names, 888 facts, 311 components, largest holds 193 names — 16.8%
//   connections (C)      274 nodes, 279 joins,  31 components, largest holds 149 nodes  — 54.4%
//   memories (M)         172 nodes, 286 joins,  31 components, largest holds  88 nodes  — 51.2%
//
// Ten times fewer components, and a largest component that holds half the drawing rather than a
// sixth of it. The reason is not a smarter algorithm: two memories written months apart routinely
// name the same thing while sharing no fact endpoint PAIR, so a join that is invisible at the
// entity level is an edge at the memory level. That is why C is the default and E is a lens you
// choose. The same reading also says what C hides and must therefore relocate: of those 339
// memories, 172 share a name with another memory and 167 share none — so the counter naming those
// 167 is not a nicety, it is half the vault.
//
// M is the memory level with the reason removed: it draws that two memories are joined and not
// WHAT joins them, and the shared surface is exactly the thing a user would act on. So M is in
// budget and mute, and it is offered rather than defaulted to.
//
// C is the bipartite model restricted to its connectors: memory nodes, the surfaces two or more
// memories touch, and the incidences between them. A surface only one memory touches is folded
// onto that memory as a chip — RELOCATION, not suppression: it is still on the node, still in the
// rail, still a finding. The memories left with no connector at all are relocated the same way,
// into a counter that is a filter rather than a silent omission.

/**
 * The lenses, as data, so the control that switches them cannot drift from the projection that
 * implements them. `id` is what goes in the URL and it is a single letter on purpose: it is this
 * app's own vocabulary, not a value read from the vault, and it is short enough to live in a
 * fragment beside everything else the view has to restore.
 */
export const LENSES = [
	{
		id: 'C',
		name: 'Connections',
		nodeKinds: ['memory', 'entity'],
		edgeKinds: ['incidence'],
		summary: 'Memories, and the names two or more of them share.',
	},
	{
		id: 'M',
		name: 'Memories',
		nodeKinds: ['memory'],
		edgeKinds: ['shared-surface'],
		summary: 'Memories only, joined where they share a name.',
	},
	{
		id: 'E',
		name: 'Claims',
		nodeKinds: ['entity'],
		edgeKinds: ['claim'],
		summary: 'Names only, joined by the facts that relate them.',
	},
];

export const DEFAULT_LENS = 'C';

export const lensById = (id) => LENSES.find((lens) => lens.id === id) ?? LENSES[0];

/**
 * A drawn node's id, and the two things it can address.
 *
 * Entity and memory nodes share one id space on the canvas, and a surface is an arbitrary string
 * the user's agents wrote — so the prefix is separated on the FIRST colon only and never split
 * naively, or a surface containing a colon addresses nothing.
 */
export const entityNodeId = (surface) => `e:${surface}`;
export const memoryNodeId = (memoryId) => `m:${memoryId}`;

export function parseNodeId(id) {
	if (typeof id !== 'string') return null;
	const cut = id.indexOf(':');
	if (cut < 1) return null;
	const kind = id.slice(0, cut);
	const ref = id.slice(cut + 1);
	if (kind === 'e') return { kind: 'entity', surface: ref };
	if (kind === 'm') return { kind: 'memory', memory_id: ref };
	return null;
}

/**
 * The scope, resolved to a set of entity surfaces.
 *
 * SCOPE IS EXPRESSED IN ENTITY SURFACES IN ALL THREE LENSES, and that is a deliberate choice with
 * a consequence worth stating. Every rung of the ladder — the largest group, one group, everything,
 * an ego network, a minimum degree, one memory type — is a statement about names, so all six
 * survive a lens change and mean the obvious thing: in C and M they select the names that are
 * ALLOWED TO JOIN two memories.
 *
 * Where it stops making sense is a scope whose names are each touched by exactly one memory. In E
 * that scope draws a picture; in C and M it draws nothing, because nothing in it joins anything.
 * That is not an empty canvas to shrug at — `projectLens` returns it as `emptyReason`, and the
 * screen says which lens would show it instead of leaving the user in front of a blank stage.
 */
export function scopeSurfaces(graph, scope) {
	const kind = scope?.kind ?? 'all';
	if (kind === 'component') {
		return new Set(graph.components.find((component) => component.id === scope.componentId)?.nodes ?? []);
	}
	if (kind === 'ego' && scope.seed) return neighbourhood(graph, scope.seed, scope.depth ?? 2);
	if (kind === 'degree') {
		return new Set(
			[...graph.nodes.values()]
				.filter((node) => node.degree >= (scope.minDegree ?? 3))
				.map((node) => node.surface),
		);
	}
	if (kind === 'memory_type') {
		const surfaces = new Set();
		for (const edge of graph.edges) {
			if (edge.memory_type !== scope.memoryType) continue;
			surfaces.add(edge.source);
			surfaces.add(edge.target);
		}
		return surfaces;
	}
	return new Set(graph.nodes.keys());
}

/**
 * How much pairing work the M lens is allowed to do before it refuses.
 *
 * The M projection joins every pair of memories that share a surface, so one name touched by k
 * memories costs k(k-1)/2 pairs. On a hub that is quadratic, and the cap check cannot save a
 * projection that has already spent the time building the pairs. So the upper bound is computed
 * FIRST, from the degree sequence, and the projection refuses with that number rather than
 * computing it. A refusal that names its own number is a control panel; a hang is not.
 */
const PAIR_WORK_CEILING = 200_000;

/**
 * Project the one reconstruction through one lens.
 *
 * @param {object} graph               what `buildGraph` returned
 * @param {object} [options]
 * @param {string} [options.lens]      'C', 'M' or 'E'
 * @param {Set<string>} [options.surfaces]  the scope, already resolved
 * @param {boolean} [options.showUnconnectedMemories]  draw the memories no connector reaches
 * @returns {{lens: string, nodes: object[], edges: object[], elementCount: number,
 *            unconnected: object[], emptyReason: string|null, refusal: object|null}}
 *
 * NOTHING HERE TRUNCATES. The element count is returned so the caller can compare it with the cap
 * before a single element is drawn; a projection that dropped part of itself to fit would be a
 * refusal spelled as an answer, and the reader could not tell a sparse vault from a cropped view.
 */
export function projectLens(graph, { lens = DEFAULT_LENS, surfaces, showUnconnectedMemories = false } = {}) {
	const scoped = surfaces instanceof Set ? surfaces : new Set(surfaces ?? graph.nodes.keys());

	if (lens === 'E') {
		const cut = subgraph(graph, scoped);
		return {
			lens: 'E',
			nodes: cut.nodes.map((node) => ({
				id: entityNodeId(node.surface),
				kind: 'entity',
				surface: node.surface,
				node,
				degree: node.degree,
			})),
			edges: cut.edges.map((edge) => ({
				id: `c:${edge.id}`,
				kind: 'claim',
				source: entityNodeId(edge.source),
				target: entityNodeId(edge.target),
				label: edge.predicate ?? '',
				predicate: edge.predicate,
				memory_id: edge.memory_id,
				memory_title: edge.memory_title,
				memory_type: edge.memory_type,
				claim: edge,
			})),
			elementCount: cut.elementCount,
			unconnected: [],
			emptyReason: cut.elementCount === 0 ? 'nothing-in-scope' : null,
			refusal: null,
		};
	}

	// C and M share their node selection exactly: the connectors inside the scope, and the memories
	// those connectors reach. Two lenses over one selection, so a memory drawn in C is drawn in M.
	const connectors = [...scoped].map((surface) => graph.nodes.get(surface)).filter((node) => node?.connector);
	const drawnMemories = new Map();
	for (const node of connectors) {
		for (const memory of node.memories) {
			const record = graph.memories.get(memory.memory_id);
			if (record) drawnMemories.set(memory.memory_id, record);
		}
	}

	// The memories a scoped surface touches that no scoped CONNECTOR reaches. Relocated, never
	// hidden: they are returned here and the screen renders them as a counter that is a filter.
	const unconnected = [];
	const touched = new Set();
	for (const surface of scoped) {
		for (const memory of graph.nodes.get(surface)?.memories ?? []) touched.add(memory.memory_id);
	}
	for (const memoryId of touched) {
		if (drawnMemories.has(memoryId)) continue;
		const record = graph.memories.get(memoryId);
		if (record) unconnected.push(record);
	}
	if (showUnconnectedMemories) for (const record of unconnected) drawnMemories.set(record.memory_id, record);

	const memoryNode = (record) => ({
		id: memoryNodeId(record.memory_id),
		kind: 'memory',
		// THE ID A CLICK NEEDS. Every verb in this product is addressed by memory id, so the node
		// carries it rather than an index into a list that the next projection would renumber.
		memory_id: record.memory_id,
		title: record.title,
		memory_type: record.memory_type,
		memory: record,
		// The surfaces folded onto this node as chips: what C does with a name only this memory
		// touches. They are on the node, not deleted from the model.
		folded: record.foldedSurfaces,
		degree: 0,
	});

	if (lens === 'M') {
		// The upper bound on pairing work, from the degree sequence, before any pair is built.
		const work = connectors.reduce((total, node) => {
			const k = node.memories.length;
			return total + (k * (k - 1)) / 2;
		}, 0);
		if (work > PAIR_WORK_CEILING) {
			return {
				lens: 'M',
				nodes: [],
				edges: [],
				elementCount: 0,
				unconnected,
				emptyReason: null,
				refusal: {
					kind: 'pair-work',
					pairs: work,
					ceiling: PAIR_WORK_CEILING,
					reason:
						`Joining these memories pairwise is up to ${work.toLocaleString()} joins, past the ` +
						`${PAIR_WORK_CEILING.toLocaleString()} this lens will compute. Narrow the scope, or use ` +
						'Connections, which draws the shared name once instead of once per pair.',
				},
			};
		}

		/** `a|b` (sorted) -> the shared surfaces behind that join */
		// Keyed on the two ids and CARRYING them, rather than parsed back out of the key. A memory
		// id is vault content: a delimiter that turns out to appear inside one addresses the wrong
		// node, silently, and the drawing is wrong in a way no assertion about counts would catch.
		const pairs = new Map();
		for (const node of connectors) {
			const ids = node.memories.map((memory) => memory.memory_id).filter((id) => drawnMemories.has(id));
			for (let i = 0; i < ids.length; i += 1) {
				for (let j = i + 1; j < ids.length; j += 1) {
					const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
					const pair = pairs.get(`${a}\u0000${b}`) ?? { a, b, shared: [] };
					pair.shared.push(node.surface);
					pairs.set(`${a}\u0000${b}`, pair);
				}
			}
		}

		const nodes = [...drawnMemories.values()].map(memoryNode);
		const byId = new Map(nodes.map((node) => [node.memory_id, node]));
		const edges = [...pairs.values()].map(({ a, b, shared }, index) => {
			byId.get(a).degree += 1;
			byId.get(b).degree += 1;
			return {
				id: `s:${index}`,
				// A shared-surface edge is a PROJECTION of two incidences the export literally
				// contains — memory A touched this name, memory B touched this name — and never an
				// inference. The surfaces behind it travel on the edge and are named in the panel,
				// because an edge whose reason is not on screen is the whole reason M is not the
				// default.
				kind: 'shared-surface',
				source: memoryNodeId(a),
				target: memoryNodeId(b),
				surfaces: shared,
				label: shared.length === 1 ? shared[0] : `${shared.length} shared names`,
			};
		});
		return {
			lens: 'M',
			nodes,
			edges,
			elementCount: nodes.length + edges.length,
			unconnected,
			emptyReason: nodes.length === 0 ? 'no-connectors' : null,
			refusal: null,
		};
	}

	// ── C ───────────────────────────────────────────────────────────────────────────────────────
	const drawnSurfaces = new Set(connectors.map((node) => node.surface));
	const nodes = [
		...[...drawnMemories.values()].map(memoryNode),
		...connectors.map((node) => ({
			id: entityNodeId(node.surface),
			kind: 'entity',
			surface: node.surface,
			node,
			degree: node.memories.length,
		})),
	];
	const byId = new Map(nodes.map((node) => [node.id, node]));

	// One line per memory/surface pair, carrying both ends rather than encoding them in a key that
	// would then have to be parsed back out. A surface is vault content and may contain anything.
	const lines = new Map();
	for (const incidence of graph.incidences) {
		if (!drawnSurfaces.has(incidence.surface) || !drawnMemories.has(incidence.memory_id)) continue;
		const key = `${incidence.memory_id}\u0000${incidence.surface}`;
		const line = lines.get(key) ?? { memory_id: incidence.memory_id, surface: incidence.surface, group: [] };
		line.group.push(incidence);
		lines.set(key, line);
	}

	const edges = [...lines.values()].map(({ memory_id: memoryId, surface, group }, index) => {
		const source = memoryNodeId(memoryId);
		const target = entityNodeId(surface);
		if (byId.has(source)) byId.get(source).degree += 1;
		const predicates = [...new Set(group.map((incidence) => incidence.predicate).filter(Boolean))];
		return {
			id: `i:${index}`,
			// One line per memory/surface pair rather than one per endpoint. That is an aggregation
			// of identical endpoints between the same two nodes — every one of them is in the export
			// — and never a link the export does not carry. The count travels on the edge.
			kind: 'incidence',
			source,
			target,
			incidences: group,
			count: group.length,
			predicates,
			label: predicates.length === 1 ? predicates[0] : `${group.length}`,
		};
	});

	return {
		lens: 'C',
		nodes,
		edges,
		elementCount: nodes.length + edges.length,
		unconnected,
		emptyReason: nodes.length === 0 ? 'no-connectors' : null,
		refusal: null,
	};
}

/**
 * The connected components of a PROJECTION, so the fallback ladder can be evaluated in the lens the
 * user is actually looking at rather than in the entity graph underneath it.
 */
export function projectionComponents(projection) {
	const order = projection.nodes.map((node) => node.id);
	const indexOf = new Map(order.map((id, index) => [id, index]));
	const sets = unionFind(order.length);
	for (const edge of projection.edges) {
		const a = indexOf.get(edge.source);
		const b = indexOf.get(edge.target);
		if (a !== undefined && b !== undefined) sets.union(a, b);
	}
	const byRoot = new Map();
	for (const id of order) {
		const root = sets.find(indexOf.get(id));
		const bucket = byRoot.get(root) ?? [];
		bucket.push(id);
		byRoot.set(root, bucket);
	}
	return [...byRoot.values()].map((ids) => ids.length).sort((a, b) => b - a);
}

/**
 * THE DEFAULT VIEW: lens C over the whole vault, and the ladder that fires when it does not fit.
 *
 * This used to be "the largest connected component", and it was the right answer for the lens that
 * shipped first. In the ENTITY lens the whole vault is the failure this screen exists to avoid: a
 * few hundred scattered islands, most of them a single fact, drifting apart under a force layout at
 * a perfectly good framerate while teaching nothing. It renders and it is worthless.
 *
 * In lens C the same vault is not that picture. The projection has already folded every name only
 * one memory touches onto the memory that touches it, so what remains is exactly the connective
 * structure — and that fits with headroom, needs no seed, and answers "what shape is this?" before
 * asking "where do you want to start?". A seeded ego network is the standard cold-start
 * recommendation for a graph view and it is the wrong first question here: it makes the user choose
 * a starting point before they know what is in the vault.
 *
 * So the ladder is lens-dependent, each rung names itself in the banner, and nothing it leaves out
 * is hidden — the memories with no shared name are counted and listed, which is RELOCATION rather
 * than suppression. The distinction is the whole design: suppressing degree-1 nodes is the standard
 * remedy for this picture and it deletes three quarters of the vertices along with every finding
 * worth showing. The picture gets prettier as it gets emptier and nothing on screen says so.
 *
 * The scope it returns is URL-ENCODABLE — a rule and its arguments, never a materialised set of
 * surfaces. A default that returned the set could not be written into the address bar, so a reload
 * could not restore it, and the view would silently be a different one from the link that named it.
 */
export function defaultView(graph, { lens = DEFAULT_LENS, cap = DRAW_CAP } = {}) {
	const rung = (scope) => {
		const projection = projectLens(graph, { lens, surfaces: scopeSurfaces(graph, scope) });
		return { scope, projection, elements: projection.elementCount };
	};

	const largest = graph.components[0];
	if (!largest || largest.size === 0) {
		return {
			scope: { kind: 'all' },
			rule: 'empty',
			elements: 0,
			reason: 'This vault has no facts with two endpoints.',
		};
	}

	// RUNG 1, AND IT IS LENS-DEPENDENT — which is the whole reason the ladder is not a constant.
	//
	// In C and M the whole vault is the right first screen: the projection has already folded every
	// name only one memory touches, so what is left is the connective structure and it fits. In E
	// the whole vault is the confetti field this screen exists to avoid — hundreds of scattered
	// islands drifting apart under a force layout at a perfectly good framerate, teaching nothing —
	// so E starts one rung lower, at the largest group, exactly as it always has.
	const ladder =
		lens === 'E'
			? [{ kind: 'component', componentId: largest.id }, { kind: 'all' }]
			: [{ kind: 'all' }, { kind: 'component', componentId: largest.id }];

	for (const scope of ladder) {
		const step = rung(scope);
		if (step.elements > cap) continue;
		if (step.elements === 0 && scope.kind !== 'all') continue;
		return {
			scope,
			rule: scope.kind === 'all' ? 'whole-vault' : 'largest-component',
			elements: step.elements,
			reason:
				scope.kind === 'all'
					? lens === 'E'
						? `Everything: ${graph.counts.componentCount} separate groups, and that is the shape.`
						: `Every memory that shares a name with another one — ${step.projection.nodes.length} nodes, ` +
							`${step.projection.edges.length} joins. ${step.projection.unconnected.length} memories share ` +
							'no name with any other and are listed on the right rather than drawn as dots.'
					: `The largest connected group: ${largest.size} names joined by ${largest.edgeCount} facts. ` +
						`The other ${graph.counts.componentCount - 1} groups are listed on the right — that is where the work is.`,
		};
	}

	// Both rungs are over budget. Seed on the busiest name rather than truncating anything.
	const hub = largest.nodes.reduce(
		(best, surface) =>
			graph.nodes.get(surface).degree > (graph.nodes.get(best)?.degree ?? -1) ? surface : best,
		largest.nodes[0],
	);
	for (const depth of [2, 1]) {
		const scope = { kind: 'ego', seed: hub, depth };
		const step = rung(scope);
		if (step.elements <= cap) {
			return {
				scope,
				rule: 'ego',
				elements: step.elements,
				reason:
					`The whole vault is past what this view draws in this lens. ` +
					`Showing ${depth} step${depth === 1 ? '' : 's'} around "${hub}", its busiest name.`,
			};
		}
	}

	return {
		scope: { kind: 'ego', seed: hub, depth: 1 },
		rule: 'refused',
		elements: rung({ kind: 'ego', seed: hub, depth: 1 }).elements,
		reason:
			`"${hub}" alone touches ${graph.nodes.get(hub).degree} facts, which is past what this view draws. ` +
			'Pick a reduction below; nothing has been dropped silently.',
	};
}

/**
 * The colour assignment, computed from THIS vault at load.
 *
 * Entity kinds are an open registry that is observably growing, so a fixed palette is a
 * transcription that drifts silently. The top N by count get a hue; everything else gets the
 * "other" slot and is still labelled with its own name, because text degrades perfectly over an
 * unbounded set and colour does not. Colour never carries meaning alone here — the kind is also
 * on the node's label and in the click panel.
 */
export function kindPalette(graph, size = 8) {
	const assignment = new Map();
	graph.kinds.slice(0, size).forEach((entry, index) => assignment.set(entry.kind, index));
	return {
		size,
		slotOf: (kind) => (kind && assignment.has(kind) ? assignment.get(kind) : -1),
		named: graph.kinds.slice(0, size).map((entry, index) => ({ ...entry, slot: index })),
		otherCount: Math.max(0, graph.kinds.length - size),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FOUR EMPTY STATES
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// FOUR CONDITIONS, FOUR SENTENCES, AND ONLY ONE OF THEM IS A DEFECT. Collapsing them into one
// "nothing to draw" is the failure this function exists to prevent: a young vault that is working
// exactly as intended reads as a broken screen, and a genuinely broken build reads as a young
// vault. The third state is the one that is usually missing, and it is the one where this product
// has the most to say — the rail, not the drawing, is what a user needs at that moment.

/**
 * @returns {{kind: string, heading: string, body: string, drawCanvas: boolean, railFullWidth: boolean}|null}
 *          null when there is something to draw.
 */
export function emptyState(graph, { lens = DEFAULT_LENS } = {}) {
	if (graph.counts.memoryCount === 0) {
		return {
			kind: 'no-memories',
			heading: 'This vault is empty',
			body: 'Memories arrive when an agent writes one. There is nothing here yet, and that is not a fault.',
			drawCanvas: false,
			railFullWidth: false,
		};
	}

	if (graph.counts.edgeCount === 0) {
		return {
			kind: 'no-facts',
			heading: `${graph.counts.memoryCount.toLocaleString()} memories, no facts`,
			body:
				'None of these memories records a fact with both a subject and an object, so there is nothing ' +
				'to join. Facts are what make the graph. This is a normal state for a young vault.',
			drawCanvas: false,
			railFullWidth: false,
		};
	}

	// THE ONE THAT USED TO BE FOLDED INTO THE ONE ABOVE, AND IS A COMPLETELY DIFFERENT SENTENCE.
	// There are facts, and they draw fine as claims — what there is not is a single name that two
	// memories both touch, so at the memory level nothing connects to anything. An empty canvas
	// here would be read as a broken screen. The rail goes full width instead, because in this
	// state the rail IS the product: every row in it is the work that would create the first join.
	if (lens !== 'E' && graph.counts.connectorCount === 0) {
		return {
			kind: 'no-connectors',
			heading: 'Nothing here connects yet',
			body:
				`Every one of these ${graph.counts.nodeCount.toLocaleString()} names is mentioned by exactly one ` +
				`memory, so no two memories share anything and there is nothing to join. The ` +
				`${graph.counts.edgeCount.toLocaleString()} facts are still there — the Claims lens draws them — ` +
				'but at the memory level this vault has no structure yet. That is the normal state of a young ' +
				'vault and the list on the right is where it changes.',
			drawCanvas: false,
			railFullWidth: true,
		};
	}

	return null;
}

/**
 * The engine's own reading of its embedding model, as a warning that belongs ON THIS STRIP.
 *
 * A graph drawn on a build without the model is a DIFFERENT GRAPH, not a slower one: a whole
 * channel of what the engine does with these memories is absent, silently, with nothing erroring
 * and nothing logging. That is a fact about the drawing, so it goes beside the drawing rather than
 * only in the footer where a reader has already stopped looking.
 *
 * The status word is read from the engine and never compared against a list of words written down
 * here: anything other than bundled is reported AS THE ENGINE SPELLED IT.
 */
export function modelWarning(reading) {
	const status = reading?.status ?? null;
	if (status === 'bundled') return null;
	return {
		status,
		text:
			status === null
				? 'This build has not said whether its embedding model is bundled. Until it does, treat this ' +
					'drawing as reconstructed from an engine of unknown shape.'
				: `The engine reports its embedding model as "${status}" rather than bundled. A build without ` +
					'the model is a different system, not a slower one, and what it holds about these memories ' +
					'is not what a full build would hold.',
	};
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FIDELITY STRIP: TWO SETS OF COUNTS, AND THE DIFFERENCE BETWEEN THEM
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The strip already said, permanently, that this drawing is the app's own reconstruction and named
// the four ways it is wrong. What it did not do is put the ENGINE's own numbers beside the app's —
// and the discrepancy is the message, not the two numbers.
//
// Two rules hold this honest, and the second is the one that is easy to get wrong:
//
//   1. A row that CAN be compared reports both readings and says what their difference means.
//   2. A row that CANNOT be compared says exactly that. The engine's health reading publishes no
//      count of the links this drawing draws — the one edge-like number it does publish counts a
//      DIFFERENT class of link, the one the export does not carry at all, so putting it opposite
//      this app's edge count would invent a comparison and then report a difference as if it meant
//      something. An invented comparison is worse than an absent one: it is checkable, and it is
//      wrong.

/**
 * @param {object} graph    the reconstruction
 * @param {object} health   the engine's own health reading, as `/api/health` serves it, or null
 * @returns {{rows: object[], notes: object[], available: boolean}}
 */
export function fidelityReading(graph, health) {
	const reading = health?.data ?? health ?? null;
	const engineGraph = reading?.graph ?? null;
	const rows = [];
	const notes = [];

	rows.push({
		key: 'nodes',
		label: 'names',
		client: graph.counts.nodeCount,
		engine: typeof engineGraph?.density?.nodes === 'number' ? engineGraph.density.nodes : null,
		comparable: typeof engineGraph?.density?.nodes === 'number',
		meaning: null,
	});

	rows.push({
		key: 'edges',
		label: 'links',
		client: graph.counts.edgeCount,
		engine: null,
		comparable: false,
		// Said in the strip, in these words, rather than shown as a blank cell.
		meaning:
			'The engine publishes no count of the links this drawing draws. The one it does publish counts ' +
			'a different class of link — the class this reconstruction cannot see at all — so there is no ' +
			'number to put here that would mean the same thing.',
	});

	const nodeRow = rows[0];
	if (nodeRow.comparable) {
		const difference = nodeRow.client - nodeRow.engine;
		nodeRow.difference = difference;
		nodeRow.meaning =
			difference === 0
				? 'The two agree. That is not proof they are the same set — only that they are the same size.'
				: difference > 0
					? `This app draws ${difference.toLocaleString()} more names than the engine holds. It counts ` +
						'every distinct spelling; two spellings the engine already holds as one thing are two ' +
						'nodes here, so a positive difference is this drawing over-fragmenting, which is the ' +
						'direction it is built to err in.'
					: `The engine holds ${Math.abs(difference).toLocaleString()} more names than this app draws. ` +
						'This app only ever draws a name that appears in a fact of a memory the export carries, ' +
						'so a negative difference is names the export does not reach.';
	}

	if (!reading) {
		notes.push({
			key: 'unavailable',
			text:
				'The engine has not answered with its own reading yet, so only this app’s counts are shown. ' +
				'A single set of counts on this strip is half the point of it.',
		});
		return { rows, notes, available: false };
	}

	// The engine's own statement about how current its graph is. R15: no bare status word and no
	// bare "behind" number — each is rendered with what it means for what is on screen.
	if (engineGraph) {
		const status = engineGraph.status ?? null;
		const behind = typeof engineGraph.behind === 'number' ? engineGraph.behind : null;
		if (status && status !== 'ready') {
			notes.push({
				key: 'status',
				text:
					`The engine describes its own graph as "${status}"` +
					(behind === null ? '' : `, ${behind.toLocaleString()} entries behind the log`) +
					'. This drawing is not built from that graph — it is built from the exported memories, ' +
					'which are current — so the two are answering slightly different questions about the same ' +
					'vault, and the difference above is partly this.',
			});
		} else if (behind !== null && behind > 0) {
			notes.push({
				key: 'behind',
				text:
					`The engine's own graph is ${behind.toLocaleString()} entries behind the log it is folded ` +
					'from. This drawing is built from the export, which is current, so the counts above are not ' +
					'taken at the same moment.',
			});
		}

		const gap = engineGraph.gap_classification ?? null;
		if (gap?.status) {
			const missing = typeof gap.missing_folds === 'number' ? gap.missing_folds : null;
			notes.push({
				key: 'gap',
				text:
					missing === 0
						? `The engine examined the gap and classified all of it: nothing it is behind on is a memory, ` +
							'so no memory of yours is missing from its side of this comparison.'
						: `The engine classified its gap as "${gap.status}"` +
							(missing === null ? '.' : `, with ${missing.toLocaleString()} it accounts for as memories.`),
			});
		}
	} else {
		notes.push({
			key: 'no-engine-graph',
			text:
				'This engine’s health reading carries nothing about its own graph, so there is no second set ' +
				'of counts to compare with. What is above is this app’s reconstruction and nothing else.',
		});
	}

	return { rows, notes, available: true };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE VIEW, IN THE URL
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ── THE TOKEN INTERACTION, WHICH IS THE WHOLE HAZARD HERE ────────────────────────────────────
//
// This app is launched at `http://127.0.0.1:<port>/#token=<the launch token>`. The token is in the
// FRAGMENT because a fragment is the one part of a URL the browser never puts on the wire; it is
// read once at startup and the entry is immediately rewritten with `history.replaceState` so the
// credential is not reachable by pressing Back. The route is ALSO in the fragment (`#/graph`), so
// the view state and the credential share one carrier, and that is the trap:
//
//   * ENCODING MUST BUILD THE FRAGMENT FROM THE VIEW STATE, NEVER BY EDITING THE FRAGMENT THAT IS
//     THERE. "Read the current fragment, set one parameter, write it back" is the obvious
//     implementation and it copies whatever else the fragment holds into the new history entry —
//     which, in the one instant between launch and capture, is the token. That would write a
//     credential into browser history, where it outlives the tab. So `encodeGraphView` takes state
//     and returns a string, and it is the only thing that composes a fragment for this screen.
//   * DECODING MUST IGNORE A `token` PARAMETER RATHER THAN CARRYING IT. A fragment that still holds
//     one is a fragment the capture has not run over yet; the view decodes to its default and the
//     token is not copied into the view state, from where the next write would put it back.
//   * EVERY WRITE IS `replaceState`, NEVER A PUSH. Ticking a filter is not a navigation, and a
//     history stack with forty entries for one screen makes Back useless — which matters more here
//     than usual, because Back is how a user returns from a memory they clicked to the drawing they
//     clicked it from.
//
// WHAT THIS DOES AND DOES NOT BUY, said plainly: a reload restores the VIEW and cannot restore the
// SESSION. The token is minted per launch and lives only in the launch URL and in one variable in
// this tab, so a reloaded tab has no credential and the sidecar answers 401 — the app says so and
// asks for a relaunch. Putting the token anywhere that survives a reload (storage, a cookie, the
// query string) would fix the reload and would be a materially worse product: the credential has
// total read and write authority over the vault. So the URL carries the view, the launch carries
// the credential, and within a session Back, Forward and a copied link all land on the same
// drawing.

/** The parameter names this screen owns. Anything else in the fragment is not this screen's. */
const VIEW_PARAMETERS = [
	'lens', 'scope', 'group', 'seed', 'depth', 'degree', 'type', 'kind', 'sel', 'loners',
	// The hub reductions — PRD 0005 R18 and R25 both say the absorbed set is in the URL, and the
	// reason is not symmetry with the filters. A reduction is the one piece of view state that
	// REMOVES things: a link that carries the lens and the scope but not the collapse shows the
	// recipient a different picture from the one the sender was looking at, and neither of them can
	// tell. `collapse` and `absorb` repeat, one per node id; `expand` carries a count as well, so it
	// is written `<k>|<id>` and split on the FIRST bar, because a surface may contain one and a
	// decimal count may not.
	'collapse', 'absorb', 'expand',
];

/**
 * A reduction state as three plain arrays.
 *
 * The screen holds `collapsed`/`absorbed` as Sets and `expanded` as a Map, because that is what
 * `planView` reads. The codec deals in arrays instead, and the conversion happens at the one seam
 * in `GraphView.jsx`: a codec whose round trip can be asserted with `deepEqual` is a codec a test
 * can hold, and a Set inside an assertion is a comparison that silently succeeds on identity.
 */
const reductionArrays = (state) => ({
	collapsed: [...(state?.collapsed ?? [])].map(String),
	absorbed: [...(state?.absorbed ?? [])].map(String),
	expanded: [...(state?.expanded ?? [])].map(([id, k]) => [String(id), Number(k)]),
});

/**
 * The view state as a fragment query string, built from the state and from nothing else.
 *
 * Defaults are OMITTED rather than written, so the common case is `#/graph` and a link a user
 * copies says only what they changed.
 */
export function encodeGraphView({
	lens,
	scope,
	kindFilter = [],
	typeFilter = [],
	selected = null,
	showUnconnectedMemories = false,
	collapsed = [],
	absorbed = [],
	expanded = [],
} = {}) {
	const parameters = new URLSearchParams();
	if (lens && lens !== DEFAULT_LENS) parameters.set('lens', lens);

	const kind = scope?.kind ?? null;
	if (kind === 'component') {
		parameters.set('scope', 'group');
		parameters.set('group', String(scope.componentId ?? ''));
	} else if (kind === 'ego') {
		parameters.set('scope', 'ego');
		parameters.set('seed', String(scope.seed ?? ''));
		if (scope.depth != null && scope.depth !== 2) parameters.set('depth', String(scope.depth));
	} else if (kind === 'degree') {
		parameters.set('scope', 'degree');
		parameters.set('degree', String(scope.minDegree ?? 3));
	} else if (kind === 'memory_type') {
		parameters.set('scope', 'type');
		parameters.set('type', String(scope.memoryType ?? ''));
	} else if (kind === 'all') {
		parameters.set('scope', 'all');
	}

	for (const value of kindFilter) parameters.append('kind', value);
	for (const value of typeFilter) parameters.append('type', value);
	if (selected) parameters.set('sel', selected);
	if (showUnconnectedMemories) parameters.set('loners', '1');

	const reductions = reductionArrays({ collapsed, absorbed, expanded });
	for (const id of reductions.collapsed) parameters.append('collapse', id);
	for (const id of reductions.absorbed) parameters.append('absorb', id);
	for (const [id, k] of reductions.expanded) {
		if (Number.isFinite(k) && k > 0) parameters.append('expand', `${k}|${id}`);
	}

	return parameters.toString();
}

/**
 * The inverse. Unknown parameters are dropped, and `token` is dropped LOUDLY in the sense that it
 * is named here: it is the one parameter that must never survive a round trip through this codec.
 */
export function decodeGraphView(search) {
	const raw = typeof search === 'string' ? search.replace(/^[#?]+/, '') : '';
	const parameters = new URLSearchParams(raw);

	const lens = parameters.get('lens');
	const scopeName = parameters.get('scope');
	let scope = null;
	if (scopeName === 'all') scope = { kind: 'all' };
	else if (scopeName === 'group') scope = { kind: 'component', componentId: parameters.get('group') ?? '' };
	else if (scopeName === 'ego') {
		const depth = Number(parameters.get('depth'));
		scope = {
			kind: 'ego',
			seed: parameters.get('seed') ?? '',
			depth: Number.isFinite(depth) && depth > 0 ? depth : 2,
		};
	} else if (scopeName === 'degree') {
		const minDegree = Number(parameters.get('degree'));
		scope = { kind: 'degree', minDegree: Number.isFinite(minDegree) && minDegree > 0 ? minDegree : 3 };
	} else if (scopeName === 'type') scope = { kind: 'memory_type', memoryType: parameters.get('type') ?? '' };

	// `type` is two things — the scope's argument and a facet filter — and only the facet reading
	// belongs in the filter list. Taking every `type` would make selecting a scope also tick its
	// own filter, which then removes every edge asserted by any other kind of memory.
	const typeFilter = parameters.getAll('type').filter((value) => !(scopeName === 'type' && value === scope?.memoryType));

	// A malformed `expand` is DROPPED rather than defaulted to some k. "Show me some of it" is not a
	// state this screen has: every expansion carries a number the chip renders as `showing k of N`,
	// and inventing one here would put a number on screen that came from a broken link.
	const expanded = [];
	for (const raw of parameters.getAll('expand')) {
		const bar = raw.indexOf('|');
		if (bar < 1) continue;
		const k = Number(raw.slice(0, bar));
		const id = raw.slice(bar + 1);
		if (!Number.isFinite(k) || k <= 0 || id.length === 0) continue;
		expanded.push([id, Math.floor(k)]);
	}

	return {
		// A lens name that is not one of ours falls back to the default rather than drawing nothing.
		lens: LENSES.some((entry) => entry.id === lens) ? lens : DEFAULT_LENS,
		scope,
		kindFilter: parameters.getAll('kind'),
		typeFilter,
		selected: parameters.get('sel'),
		showUnconnectedMemories: parameters.get('loners') === '1',
		collapsed: parameters.getAll('collapse'),
		absorbed: parameters.getAll('absorb'),
		expanded,
	};
}

/** Every parameter this codec will emit, so a test can assert what it will never emit. */
export const graphViewParameters = () => [...VIEW_PARAMETERS];

/**
 * The facet filters, applied to a PROJECTION rather than to the model.
 *
 * One implementation for all three lenses, because a filter that behaved differently per lens is
 * three filters, and the two that are not on screen are the ones that rot. The rules:
 *
 *   - an entity node survives a kind filter if any of its declared kinds is selected; a node with
 *     no declaration at all is matched by the explicit `(not declared)` value, never by silence;
 *   - a memory node survives a type filter if its own type is selected;
 *   - a CLAIM edge survives a type filter on the memory that asserted it, which is what the type
 *     facet has always meant in the entity lens;
 *   - an edge survives only if both of its endpoints did;
 *   - a node left with no surviving edge is dropped unless it is the selection, so filtering never
 *     leaves the canvas gaining floating dots the user cannot account for.
 *
 * Nothing here is a reduction the user was not told about: the element count of the result is what
 * the header renders, beside the count before it.
 */
export function filterProjection(projection, { kindFilter = [], typeFilter = [], keep = null } = {}) {
	if (kindFilter.length === 0 && typeFilter.length === 0) return projection;

	const kept = new Map();
	for (const node of projection.nodes) {
		if (node.kind === 'entity' && kindFilter.length > 0) {
			const kinds = [...node.node.kinds.keys()];
			const matched = kinds.length === 0 ? kindFilter.includes('(not declared)') : kinds.some((kind) => kindFilter.includes(kind));
			if (!matched) continue;
		}
		if (node.kind === 'memory' && typeFilter.length > 0 && !typeFilter.includes(node.memory_type)) continue;
		kept.set(node.id, node);
	}

	const edges = projection.edges.filter((edge) => {
		if (!kept.has(edge.source) || !kept.has(edge.target)) return false;
		if (edge.kind === 'claim' && typeFilter.length > 0) return typeFilter.includes(edge.memory_type);
		return true;
	});

	const attached = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
	const nodes = [...kept.values()].filter((node) => attached.has(node.id) || node.id === keep);
	return { ...projection, nodes, edges, elementCount: nodes.length + edges.length };
}
