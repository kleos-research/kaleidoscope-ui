/**
 * The curation backlog, as arithmetic. No rendering, no fetching, no engine call.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SCREEN AND NOT A RAIL
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `graph-model.mjs` already finds all of this. It found twelve near-duplicate pairs, twenty-five
 * names declared under two kinds, a hundred and seventy-seven islands and two hundred and
 * twenty-nine relationship names used exactly once on the development vault — and it showed them
 * in a rail beside a drawing, as a list of nominations that went nowhere.
 *
 * Several hundred weakly-ordered findings are a LIST, not a picture, and a list beside a canvas is
 * a list nobody scrolls. Three things had to be added before those nominations became work a person
 * can do, and each of them is arithmetic rather than chrome:
 *
 *   1. **A stated order.** Several hundred findings in an arbitrary order is a pile. The order here
 *      is by how much is at stake — the facts and the memories the finding touches — it is total
 *      and therefore stable, and `RANKING` carries the sentence the screen prints so the rule the
 *      reader is shown is the rule the sort actually used.
 *   2. **A dismissal.** "These two really are different things" is the commonest true answer to a
 *      near-duplicate, and without somewhere to put it the backlog is unusable on the second visit:
 *      the same twelve pairs, in the same order, every time. The key is derived from the finding's
 *      own content (see `dismissalKey`), never from its position, so it survives the next write.
 *   3. **The cost, in one sentence, per kind.** "vandrel per quorix coefficient" and
 *      "vandrel per-quorix coefficient" being two nodes is only a problem if you know why, and the
 *      why is not visible from the two strings. (The pair is invented. An illustration lifted from
 *      the vault this was developed against is a disclosure no text scanner can see, because a
 *      scanner has no vault to compare a comment with.)
 *
 * NOTHING HERE MERGES ANYTHING, and nothing here writes to the vault. Every finding terminates in
 * the memories it came from, and the only verb on the screen is "open this memory in the editor".
 * Merge is M6 and it depends on the snapshot spine, which is why `dismissalKey` is a pure function
 * with its own tests: it is the thing M6 will key its "already decided" state on.
 */

import { isolatedFacts, kindConflicts, nearDuplicates, onceUsedPredicates } from './graph-model.mjs';

/**
 * The unit separator, as the joiner inside a dismissal key.
 *
 * A name in this vault can contain a space, a hyphen, a colon and a slash — the near-duplicate
 * detector exists BECAUSE names differ by exactly those characters — so any printable joiner makes
 * two different findings collide on one key, and a collision here means dismissing one finding
 * silently hides another. U+001F cannot appear in a surface that came out of the write contract.
 */
const UNIT = '\u001f';

/**
 * THE FIVE KINDS OF FINDING, and what each one costs the person who owns the vault.
 *
 * The `costs` sentence is the reason this is a product rather than a report. Every one of these is
 * detectable by a twenty-line function; none of them is actionable without knowing what goes wrong
 * if it is left alone, and none of the five failures is visible from the row itself.
 *
 * `id` is part of every dismissal key, so these strings are frozen: renaming one orphans every
 * dismissal a user has made under it. The TITLES may change freely.
 */
export const FINDING_KINDS = Object.freeze([
	Object.freeze({
		id: 'near-duplicate',
		title: 'Names that are nearly the same',
		costs:
			'Two spellings are two separate things to the store — identity is character-exact — so ' +
			'an agent that reaches one of them never sees the other one’s facts, and neither half ' +
			'ever looks incomplete from where it is standing.',
		fix: 'Rewrite the losing spelling in every memory that uses it, declaration and facts together.',
	}),
	Object.freeze({
		id: 'kind-conflict',
		title: 'One name, declared as two kinds of thing',
		costs:
			'Two memories disagree about what this name IS. Every fact written about it is answering ' +
			'a question about one of the two, and nothing on the record says which — so the ' +
			'disagreement is inherited by everything written next.',
		fix: 'Decide which kind is right and edit the declaration in the memories that disagree.',
	}),
	Object.freeze({
		id: 'island',
		title: 'A fact joined to nothing else',
		costs:
			'This claim is true and unreachable. Nothing else you have written touches either end of ' +
			'it, so it is found only by an agent that already knows the exact words in it — which is ' +
			'the one case where it was not needed.',
		fix: 'Name something in it that the rest of the vault already talks about, or accept it as a note.',
	}),
	Object.freeze({
		id: 'once-used-predicate',
		title: 'A relationship name used exactly once',
		costs:
			'A relationship name used once groups nothing. Five ways of writing "depends on" are five ' +
			'one-member sets, and no question about dependencies can be asked across them.',
		fix: 'Reuse a name already in this vault, or accept that this relation is genuinely singular.',
	}),
	Object.freeze({
		id: 'declared-never-used',
		title: 'A name declared and then never used',
		costs:
			'The memory declares this name and then never writes a fact about it. The declaration ' +
			'does nothing: the name has no facts, no position and no way in — it is a promise the ' +
			'memory did not keep.',
		fix: 'Write the fact the declaration implies, or drop the declaration.',
	}),
]);

const KIND_BY_ID = new Map(FINDING_KINDS.map((kind) => [kind.id, kind]));

/**
 * THE ORDER, and the sentence the screen prints about it.
 *
 * Both live here, together, so the rule the reader is shown is the rule the sort used. An ordering
 * explained in JSX and implemented here drifts the first time either is touched, and an arbitrary
 * order presented as a priority is worse than an admitted arbitrary one — the reader works the top
 * of the list believing the bottom matters less.
 *
 * Stake is two numbers rather than one blended score. Facts first: a finding that touches seven
 * facts is splitting seven claims, and that is the damage. Memories second: among findings that
 * split the same number of claims, the one spread across more memories is the one that is hardest
 * to see from any single page — which is the whole reason this screen exists. Names third, and then
 * the key, which makes the order TOTAL: the same vault sorts the same way twice, whatever order the
 * export happened to arrive in.
 */
export const RANKING = Object.freeze({
	id: 'stake',
	sentence:
		'Ordered by how much is at stake: the number of facts the finding splits or leaves ' +
		'unreachable first, then the number of memories that would have to be edited to resolve it. ' +
		'Ties break on the names themselves, so this order is the same every time you open it.',
	groups:
		'The headings are in that same order, by the biggest single thing under each — not by how ' +
		'many there are. A hundred one-fact findings are still a hundred one-fact findings, and they ' +
		'do not belong above the one that splits nine.',
	short: 'facts at stake, then memories to edit',
});

/** A trimmed non-empty string, or null. */
const text = (value) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

/**
 * The dismissal key: derived from WHAT THE FINDING IS ABOUT, never from where it sat in a list.
 *
 * This is the whole reason dismissal works on the second visit. A key that was an index, a position
 * or a component id would be re-minted by the next write — components are numbered in the order the
 * export arrives — and every dismissal a person made would silently come back as a fresh finding,
 * which is exactly the failure the feature exists to prevent, dressed as data.
 *
 * The names are SORTED before joining, so a group that arrives spelled in the other order is the
 * same key. The kind is in the key because one surface can be the subject of two different findings
 * and dismissing "it is declared as two kinds" must not also hide "it is nearly the same name as
 * that one".
 *
 * A near-duplicate group keyed on its whole surface set means a THIRD spelling appearing later
 * produces a new key and a new finding. That is deliberate: the user's answer was about the pair in
 * front of them, and a new spelling is new evidence, not the same question again.
 */
export function dismissalKey(finding) {
	const kind = finding?.kind ?? finding?.kind_id ?? '';
	const names = [...(finding?.key_names ?? finding?.names ?? [])]
		.map((name) => String(name))
		.sort();
	return `${kind}${UNIT}${names.join(UNIT)}`;
}

/**
 * Accept dismissals as records or as bare keys, and hand back the lookup plus the records.
 *
 * The store returns records — key, when, and the names as they were spelled at the time — because a
 * "review what you dismissed" screen that can only show opaque keys is a screen nobody can audit.
 * A bare key is accepted too so a test does not have to build a record to assert filtering.
 */
function indexDismissals(dismissed) {
	const byKey = new Map();
	for (const entry of dismissed ?? []) {
		if (typeof entry === 'string') {
			byKey.set(entry, { key: entry, dismissed_at: null, names: [], kind: null, reason: null });
			continue;
		}
		const key = text(entry?.key);
		if (!key) continue;
		byKey.set(key, entry);
	}
	return byKey;
}

/**
 * The memories one finding comes from, deduplicated and counted.
 *
 * Every finding on this screen ends in a memory, because a memory is the only thing in this product
 * a person can actually change. A finding that could not name one would be an observation, and this
 * screen has no room for observations.
 */
function memoriesFrom(entries) {
	const byId = new Map();
	for (const entry of entries) {
		const id = text(entry?.memory_id);
		if (!id) continue;
		const held = byId.get(id) ?? {
			memory_id: id,
			title: text(entry?.title) ?? null,
			memory_type: text(entry?.memory_type) ?? null,
			facts: 0,
			// What this memory contributes to THIS finding — the spelling it used, the kind it
			// declared, the relation it coined. Rendered beside the title, because "open this one"
			// is a much easier decision when the row says what is in it.
			notes: [],
		};
		if (!held.title && text(entry?.title)) held.title = text(entry.title);
		if (!held.memory_type && text(entry?.memory_type)) held.memory_type = text(entry.memory_type);
		held.facts += entry?.facts ?? 0;
		const note = text(entry?.note);
		if (note && !held.notes.includes(note)) held.notes.push(note);
		byId.set(id, held);
	}
	return [...byId.values()].sort(
		(a, b) => b.facts - a.facts || String(a.title ?? '').localeCompare(String(b.title ?? '')),
	);
}

/** Every edge touching any surface in `surfaces`, each edge counted once. */
function edgesTouching(graph, surfaces) {
	const seen = new Set();
	const edges = [];
	for (const surface of surfaces) {
		for (const edge of graph.incident.get(surface) ?? []) {
			if (seen.has(edge.id)) continue;
			seen.add(edge.id);
			edges.push(edge);
		}
	}
	return edges;
}

const factEntries = (edges, note = null) =>
	edges.map((edge) => ({
		memory_id: edge.memory_id,
		title: edge.memory_title,
		memory_type: edge.memory_type,
		facts: 1,
		note,
	}));

// ---------------------------------------------------------------------------------------------
// The five detectors, each turned into findings of one shape
// ---------------------------------------------------------------------------------------------

function nearDuplicateFindings(graph) {
	return nearDuplicates(graph).map((group) => {
		const names = group.surfaces.map((entry) => entry.surface);
		const edges = edgesTouching(graph, names);
		return {
			kind: 'near-duplicate',
			names,
			key_names: names,
			// The one-line headline the row renders. Built here rather than in JSX so the same
			// string is available to a test, to a receipt, and to the dismissal record.
			label: names.join('  ·  '),
			detail: {
				rule: group.rule,
				same_component: group.sameComponent,
				spellings: group.surfaces.map((entry) => ({
					surface: entry.surface,
					facts: entry.degree,
					kinds: entry.kinds,
					declared: entry.declared,
				})),
			},
			// Whether unifying joins two islands or only relabels one group. Materially different
			// acts, and the rail said which on every row, so this screen does too.
			edges,
			memories: memoriesFrom(
				group.surfaces.flatMap((entry) =>
					edgesTouching(graph, [entry.surface]).map((edge) => ({
						memory_id: edge.memory_id,
						title: edge.memory_title,
						memory_type: edge.memory_type,
						facts: 1,
						note: `writes “${entry.surface}”`,
					})),
				),
			),
		};
	});
}

function kindConflictFindings(graph) {
	return kindConflicts(graph).map((entry) => {
		const node = graph.nodes.get(entry.surface);
		const edges = edgesTouching(graph, [entry.surface]);
		// The DECLARING memories, not the asserting ones. A kind is written in a declaration, so
		// those are the memories a person would open to resolve the disagreement; the memories that
		// merely use the name in a fact cannot fix it and would pad the row with dead ends.
		const declarations = (node?.declarations ?? []).filter((declaration) => text(declaration?.kind));
		return {
			kind: 'kind-conflict',
			names: [entry.surface],
			key_names: [entry.surface],
			label: entry.surface,
			detail: {
				kinds: entry.kinds,
				glosses: node?.glosses ?? [],
			},
			edges,
			memories: memoriesFrom(
				declarations.map((declaration) => ({
					memory_id: declaration.memory_id,
					title: declaration.memory_title,
					memory_type: null,
					facts: 0,
					note: `declares it a ${declaration.kind}`,
				})),
			),
		};
	});
}

function islandFindings(graph) {
	return isolatedFacts(graph)
		.filter(({ edge }) => edge)
		.map(({ edge }) => ({
			kind: 'island',
			names: [edge.source, edge.target],
			key_names: [edge.source, edge.target],
			label: `${edge.source} — ${edge.predicate ?? 'no relation name'} — ${edge.target}`,
			detail: { subject: edge.source, predicate: edge.predicate, object: edge.target },
			edges: [edge],
			memories: memoriesFrom(factEntries([edge], 'asserts this fact')),
		}));
}

function oncePredicateFindings(graph) {
	const byPredicate = new Map();
	for (const edge of graph.edges) {
		if (!edge.predicate) continue;
		const held = byPredicate.get(edge.predicate) ?? [];
		held.push(edge);
		byPredicate.set(edge.predicate, held);
	}
	return onceUsedPredicates(graph).map((entry) => {
		const edges = byPredicate.get(entry.predicate) ?? [];
		return {
			kind: 'once-used-predicate',
			// The relation name is not an entity name, so it is not in `names` — a screen that put
			// it there would offer it to a name-merge that cannot address it. It is still what the
			// dismissal is ABOUT, so it is what the key is built from.
			names: [],
			key_names: [entry.predicate],
			label: entry.predicate,
			detail: {
				predicate: entry.predicate,
				fact: edges[0]
					? { subject: edges[0].source, predicate: entry.predicate, object: edges[0].target }
					: null,
			},
			edges,
			memories: memoriesFrom(factEntries(edges, `uses “${entry.predicate}” once`)),
		};
	});
}

function declaredNeverUsedFindings(graph) {
	return graph.declaredNeverAsserted.map((entry) => ({
		kind: 'declared-never-used',
		names: [entry.surface],
		key_names: [entry.surface],
		label: entry.surface,
		detail: {
			kinds: [...new Set(entry.declarations.map((declaration) => declaration.kind).filter(Boolean))],
			glosses: [...new Set(entry.declarations.map((declaration) => declaration.gloss).filter(Boolean))],
		},
		edges: [],
		memories: memoriesFrom(
			entry.declarations.map((declaration) => ({
				memory_id: declaration.memory_id,
				title: declaration.memory_title,
				memory_type: null,
				facts: 0,
				note: declaration.kind ? `declares it a ${declaration.kind}` : 'declares it',
			})),
		),
	}));
}

/**
 * What is at stake, as counted quantities rather than a score.
 *
 * Three numbers, all of them things the reader can check against the row: how many facts this
 * finding splits or strands, how many memories would have to be opened to resolve it, and how many
 * names it involves. There is deliberately no weighted total — a single number would order the list
 * the same way and would be un-auditable, and the first question anyone asks of a priority score is
 * what it weighed.
 */
export function stakeOf(finding) {
	return {
		facts: finding.edges?.length ?? 0,
		memories: finding.memories?.length ?? 0,
		names: finding.key_names?.length ?? finding.names?.length ?? 0,
	};
}

/**
 * The total order. Stake first, and the key last so it is TOTAL.
 *
 * Without the final tie-break this sort is only as stable as the order the findings were generated
 * in, which is the order the export arrived in, which changes on every write. A "stable ranking"
 * that reshuffles the moment an unrelated memory is added is not one.
 */
export function compareFindings(a, b) {
	return (
		b.stake.facts - a.stake.facts ||
		b.stake.memories - a.stake.memories ||
		b.stake.names - a.stake.names ||
		a.key.localeCompare(b.key)
	);
}

export function rankFindings(findings) {
	return [...findings].sort(compareFindings);
}

/**
 * WHICH GROUP GOES FIRST, and the mistake this replaces, because the mistake is the instructive part.
 *
 * The first rule here was the sum: order the groups by the total facts at stake inside them. It is
 * defensible arithmetic and it produced exactly the wrong page. On the development vault it put
 * "a relationship name used exactly once" at the top — two hundred and forty-nine findings, every
 * one of them worth a single fact and a single memory, 249 in total — above the group holding the
 * nine-fact name conflict that is the most valuable thing on the screen. A reader working top-down
 * would have met two hundred and forty-nine trivia before the first thing worth doing. The sum was
 * true and it emphasised the wrong thing, which no assertion about the sum could have caught.
 *
 * So the groups are ordered by THE BIGGEST THING IN THEM, compared position by position: the group
 * whose worst problem is worst comes first, and if two groups' worst problems tie, their
 * next-worst decides, and so on. It is the same comparator the findings themselves use, so the page
 * is in one order at both levels; it is total, for the same reason; and it is the order a person
 * actually works a backlog in — the biggest thing they can see, then the next.
 *
 * A group that runs out while still tied is the smaller one and sorts last: fewer problems of
 * identical size is less at stake, which is the sum's one true intuition, kept where it is right.
 */
export function compareGroups(a, b) {
	const limit = Math.min(a.findings.length, b.findings.length);
	for (let index = 0; index < limit; index += 1) {
		const order = compareFindings(a.findings[index], b.findings[index]);
		if (order !== 0) return order;
	}
	return b.findings.length - a.findings.length || a.kind.id.localeCompare(b.kind.id);
}

/**
 * The whole backlog, from a graph and the dismissals this vault has accumulated.
 *
 * @param {object} graph  the model from `buildGraph`
 * @param {object} [options]
 * @param {Array<object|string>} [options.dismissed]  records from the dismissal store, or bare keys
 */
export function buildBacklog(graph, { dismissed = [] } = {}) {
	const dismissals = indexDismissals(dismissed);

	const raw = [
		...nearDuplicateFindings(graph),
		...kindConflictFindings(graph),
		...islandFindings(graph),
		...oncePredicateFindings(graph),
		...declaredNeverUsedFindings(graph),
	];

	const findings = raw.map((finding) => {
		const key = dismissalKey(finding);
		return {
			...finding,
			key,
			stake: stakeOf(finding),
			dismissed: dismissals.has(key),
			dismissal: dismissals.get(key) ?? null,
		};
	});

	const live = rankFindings(findings.filter((finding) => !finding.dismissed));
	const hidden = rankFindings(findings.filter((finding) => finding.dismissed));

	// A dismissal whose finding is not in today's vault. It is REPORTED rather than dropped: a
	// store that silently accumulates keys nothing matches is a store that grows forever and looks
	// empty, and the commonest reason a key stops matching is that the user fixed the thing — which
	// is the one outcome this screen should be able to show.
	const present = new Set(findings.map((finding) => finding.key));
	const resolved = [...dismissals.values()].filter((entry) => !present.has(entry.key));

	const groups = FINDING_KINDS.map((kind) => {
		const mine = live.filter((finding) => finding.kind === kind.id);
		const mineHidden = hidden.filter((finding) => finding.kind === kind.id);
		return {
			kind,
			findings: mine,
			dismissed: mineHidden,
			counts: {
				findings: mine.length,
				dismissed: mineHidden.length,
				facts: mine.reduce((total, finding) => total + finding.stake.facts, 0),
				memories: new Set(
					mine.flatMap((finding) => finding.memories.map((memory) => memory.memory_id)),
				).size,
			},
		};
	})
		// See `compareGroups`, and the sum it replaces.
		.sort(compareGroups);

	// ── how much of the vault this backlog touches ────────────────────────────────────────────
	//
	// Shares, not just totals. "412 findings" is a number that means nothing on a vault of unknown
	// size; "they touch 214 of your 326 memories" is the sentence that says whether this is a tidy
	// vault with a few loose ends or a vault that is mostly loose ends.
	const touchedMemories = new Set();
	const touchedNames = new Set();
	const touchedFacts = new Set();
	for (const finding of live) {
		for (const memory of finding.memories) touchedMemories.add(memory.memory_id);
		for (const name of finding.names) touchedNames.add(name);
		for (const edge of finding.edges) touchedFacts.add(edge.id);
	}

	return {
		ranking: RANKING,
		findings: live,
		dismissed: hidden,
		resolved,
		groups,
		counts: {
			findings: live.length,
			dismissed: hidden.length,
			total: findings.length,
			resolved: resolved.length,
			memories_touched: touchedMemories.size,
			memory_count: graph.counts.memoryCount,
			names_touched: touchedNames.size,
			// EVERY name in the vault, which is not the same as every name in the drawing. A name
			// declared and never used in a fact has no node and no position, so `nodeCount` does not
			// count it — and one whole kind of finding on this screen is about exactly those names.
			// Using `nodeCount` alone would produce a share whose numerator can contain names its
			// denominator does not, which is the kind of count that is wrong by a little and cannot
			// be caught by looking at it.
			name_count: graph.counts.nodeCount + graph.declaredNeverAsserted.length,
			facts_touched: touchedFacts.size,
			fact_count: graph.counts.edgeCount,
		},
	};
}

/**
 * The record the dismissal store is asked to keep.
 *
 * The names and the label travel WITH the key so the review screen can show a person what they
 * dismissed without re-deriving it from a vault that has moved since. A store of opaque keys is a
 * store nobody can audit, and "show me what I hid" is the only thing that makes hiding safe.
 */
export function dismissalRecordFor(finding, { reason = null } = {}) {
	return {
		key: finding.key ?? dismissalKey(finding),
		kind: finding.kind,
		label: finding.label ?? null,
		names: [...(finding.key_names ?? finding.names ?? [])],
		reason: text(reason),
	};
}

/** The kind description behind an id, for a dismissal record whose finding is no longer present. */
export const kindById = (id) => KIND_BY_ID.get(id) ?? null;
