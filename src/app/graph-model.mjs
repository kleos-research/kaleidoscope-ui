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
 * THERE WAS A DRAW BUDGET HERE — two numbers, in drawn elements, that decided when a whole-vault
 * canvas would refuse and offer to prune itself. It is gone with the canvas it governed.
 *
 * The budget it replaced it with lives in `names-model.mjs`, and it is a different KIND of number:
 * the ego drawing's hard node cap is about what a person can read, and the overview's ceiling is
 * about what a painter can put on a canvas in a frame. Those two were one number here, which is
 * how a legibility limit came to be enforced on a renderer and a renderer's limit came to be
 * quoted as a legibility claim.
 */

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
	/** memory_id -> the memory, which the selection panel lists and the table orders by. */
	const memories = new Map();

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
		const memoryCreated = text(semantic.created_on);
		const memorySequence = typeof semantic.sequence === 'number' ? semantic.sequence : null;

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
					sequence: memorySequence,
					created_on: memoryCreated,
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
					// WHEN, AND IN WHAT ORDER, carried on the node itself. The selection panel prints
					// "correction · 3 days ago" beside every memory that names a thing, and the table
					// can be ordered by "recently mentioned" — neither is answerable from a memory id,
					// and looking both up again from the record list is a second index that can
					// disagree with this one about the same memory.
					node.memories.push({
						memory_id: memoryId,
						title: memoryTitle,
						memory_type: memoryType,
						created_on: memoryCreated,
						sequence: memorySequence,
					});
				}
			}

			// Which distinct surfaces this memory touches, in first-seen order. Both ends are walked
			// even when they are the same node, because the export literally contains two endpoints.
			if (memory) {
				for (const surface of [subject, object]) {
					if (memory.surfaceSet.has(surface)) continue;
					memory.surfaceSet.add(surface);
					memory.surfaces.push(surface);
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
// THE THREE EMPTY STATES
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// THREE CONDITIONS, THREE SENTENCES, AND ONLY ONE OF THEM IS A DEFECT. Collapsing them into one
// "nothing to draw" is the failure this function exists to prevent: a young vault that is working
// exactly as intended reads as a broken screen, and a genuinely broken build reads as a young
// vault.
//
// There used to be a fourth, and it was about a lens that no longer exists — it said that no two
// memories shared a name, which was a statement about a projection rather than about the vault.
// The surface these states now guard is a TABLE OF NAMES, and a table of names needs exactly one
// thing to be worth opening: a name. So the conditions are about names and facts, and each one
// still names what the reader should do instead.

/**
 * @returns {{kind: string, heading: string, body: string}|null}
 *          null when there is something to show.
 */
export function emptyState(graph) {
	if (graph.counts.memoryCount === 0) {
		return {
			kind: 'no-memories',
			heading: 'This vault is empty',
			body: 'Memories arrive when an agent writes one. There is nothing here yet, and that is not a fault.',
		};
	}

	if (graph.counts.edgeCount === 0) {
		return {
			kind: 'no-facts',
			heading: `${graph.counts.memoryCount.toLocaleString()} memories, and nothing said about a name yet`,
			body:
				'None of these memories records a statement with both ends filled in, so there is no name for ' +
				'this table to be about. Statements are what put a name in here. This is a normal state for a ' +
				'young vault, and it changes the first time an agent writes one.',
		};
	}

	return null;
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
