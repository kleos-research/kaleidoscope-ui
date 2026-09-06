/**
 * THE KIND × KIND MATRIX, AS ARITHMETIC. No React, no canvas, no fetching, no engine call.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every other surface on the names screens is about NAMES. This one is about the KINDS the names
 * were declared as, and it answers two questions no other view can: what sorts of things connect
 * to what sorts, and — the one that matters to whoever is writing the memories — whether the kind
 * vocabulary has sprawled past the schema. The entity kind is an open registry: the engine names a
 * handful, accepts any new value, and a working vault accumulates several times as many as the
 * schema lists. That drift is a write-path quality signal, it is invisible on every other screen,
 * and here it is the shape of the picture — the kinds the schema names on one side of a rule and
 * everything a writer coined on the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE WRITES A KIND DOWN
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The rows are the kinds THIS vault declares, read off the reconstructed graph. Which of them the
 * schema names is decided against a list parsed out of the engine's own printed contract at
 * launch, handed in by the caller. This file holds no kind name, and if the schema list did not
 * arrive it says so rather than guessing: a partition drawn from a remembered list would put a
 * newly-published kind on the wrong side of the rule and look exactly like a correct one.
 */

import { primaryKind } from './names-model.mjs';

/**
 * The three groups a row or column belongs to, in the order they are drawn.
 *
 * A kind is either one the schema names, one a writer introduced, or the absence of one — the
 * endpoints no memory ever declared. The third is not a kind and it is not dropped either: on a
 * working vault most fact endpoints are undeclared, and a matrix that left them out would draw the
 * minority of the vault and call it the picture.
 */
export const KIND_GROUPS = Object.freeze(['schema', 'beyond', 'undeclared']);

/**
 * The key a row or column is addressed by in the count table. Kinds are open strings, so the
 * undeclared bucket cannot be spelled as one of them — a writer could declare a kind called
 * "undeclared" tomorrow. It is `null`, and it is labelled by the view rather than by a string here.
 */
const UNDECLARED = null;

const compareText = (a, b) => String(a).localeCompare(String(b));

/**
 * @param {object}      graph        from `buildGraph`
 * @param {string[]|null} schemaKinds the kinds the engine's contract lists, read at launch; null
 *                                   when the contract was not read
 * @returns {{
 *   kinds: Array<{ kind: string|null, group: string, total: number, asSubject: number, asObject: number }>,
 *   counts: number[][],   // counts[row][column], in the order of `kinds`
 *   max: number,
 *   factCount: number,
 *   groups: { schema: number, beyond: number, undeclared: number },
 *   schemaKnown: boolean,
 *   schemaUnused: string[],
 *   undeclaredEndpoints: number,
 * }}
 */
export function kindMatrix(graph, { schemaKinds = null } = {}) {
	const schema = Array.isArray(schemaKinds) ? new Set(schemaKinds) : null;
	const kindOf = (surface) => {
		const node = graph.nodes.get(surface);
		return node ? (primaryKind(node) ?? UNDECLARED) : UNDECLARED;
	};

	/** kind -> { asSubject, asObject } */
	const tallies = new Map();
	const tally = (kind, role) => {
		let entry = tallies.get(kind);
		if (!entry) {
			entry = { asSubject: 0, asObject: 0 };
			tallies.set(kind, entry);
		}
		entry[role] += 1;
	};

	/**
	 * subject kind -> (object kind -> count). Two nested maps rather than a joined string key,
	 * because a kind is an open string and may contain whatever separator a key would use — and
	 * `null` is a legal Map key, which is what lets the undeclared bucket sit beside the real kinds
	 * without being spelled as one of them.
	 */
	const pairs = new Map();
	let undeclaredEndpoints = 0;
	for (const edge of graph.edges) {
		const from = kindOf(edge.source);
		const to = kindOf(edge.target);
		tally(from, 'asSubject');
		tally(to, 'asObject');
		if (from === UNDECLARED) undeclaredEndpoints += 1;
		if (to === UNDECLARED) undeclaredEndpoints += 1;
		let row = pairs.get(from);
		if (!row) {
			row = new Map();
			pairs.set(from, row);
		}
		row.set(to, (row.get(to) ?? 0) + 1);
	}

	const groupOf = (kind) => {
		if (kind === UNDECLARED) return 'undeclared';
		if (schema === null) return 'beyond';
		return schema.has(kind) ? 'schema' : 'beyond';
	};

	// Ordered by volume — how many fact endpoints name the kind — inside each group, and the
	// groups in their fixed order. Ties break on the kind's own spelling so the picture is stable.
	const rank = new Map(KIND_GROUPS.map((group, index) => [group, index]));
	const kinds = [...tallies.entries()]
		.map(([kind, entry]) => ({
			kind,
			group: groupOf(kind),
			total: entry.asSubject + entry.asObject,
			asSubject: entry.asSubject,
			asObject: entry.asObject,
		}))
		.sort(
			(a, b) =>
				rank.get(a.group) - rank.get(b.group) ||
				b.total - a.total ||
				compareText(a.kind ?? '', b.kind ?? ''),
		);

	const index = new Map(kinds.map((entry, at) => [entry.kind, at]));
	const counts = kinds.map(() => kinds.map(() => 0));
	let max = 0;
	for (const [from, row] of pairs) {
		for (const [to, count] of row) {
			counts[index.get(from)][index.get(to)] = count;
			if (count > max) max = count;
		}
	}

	const groups = { schema: 0, beyond: 0, undeclared: 0 };
	for (const entry of kinds) groups[entry.group] += 1;

	return {
		kinds,
		counts,
		max,
		factCount: graph.edges.length,
		groups,
		schemaKnown: schema !== null,
		// The kinds the schema names that nothing here is declared as. Not rows — the matrix is of
		// the vault — but a fact about the vault worth one clause in the caption.
		schemaUnused: schema === null ? [] : [...schema].filter((kind) => !tallies.has(kind)).sort(compareText),
		undeclaredEndpoints,
	};
}

/**
 * THE MATRIX WITH ITS LONG TAIL FOLDED — the kinds a writer coined past the first few, as one
 * row and one column that open on a press.
 *
 * A working vault carries a hundred-odd kinds, most used by one or two names, and a 123 × 123 grid
 * with rotated labels and mostly empty cells is "everything seen at once" in a new coat. What the
 * view draws is every kind the schema names, the `keepBeyond` most-used of the ones a writer added,
 * and the undeclared bucket; the rest are summed into a fold whose label carries their number, so
 * nothing is dropped and the size of the tail — which is the finding — is still on the picture.
 *
 * The fold is marked by `fold: true` on its entry rather than by a kind name, because a kind is an
 * open string and a writer could declare one called anything. `null` stays the undeclared marker.
 *
 * @param matrix       from `kindMatrix`
 * @param keepBeyond   how many writer-added kinds to keep as rows of their own; Infinity keeps all
 */
export function foldKinds(matrix, { keepBeyond = 8 } = {}) {
	const keep = [];
	const folded = [];
	let beyondKept = 0;
	matrix.kinds.forEach((entry, at) => {
		if (entry.group === 'beyond') {
			if (beyondKept < keepBeyond) {
				beyondKept += 1;
				keep.push(at);
			} else folded.push(at);
		} else keep.push(at);
	});
	if (folded.length === 0) return { ...matrix, folded: 0 };

	// The fold sits at the end of the writer-added group, before the undeclared row.
	const undeclaredAt = keep.findIndex((at) => matrix.kinds[at].group === 'undeclared');
	const order = undeclaredAt === -1 ? [...keep, 'fold'] : [...keep.slice(0, undeclaredAt), 'fold', ...keep.slice(undeclaredAt)];

	const sumRow = (row, columns) => columns.reduce((total, at) => total + matrix.counts[row][at], 0);
	const cell = (r, c) => {
		if (r === 'fold' && c === 'fold') return folded.reduce((total, row) => total + sumRow(row, folded), 0);
		if (r === 'fold') return folded.reduce((total, row) => total + matrix.counts[row][c], 0);
		if (c === 'fold') return sumRow(r, folded);
		return matrix.counts[r][c];
	};

	const kinds = order.map((at) =>
		at === 'fold'
			? {
					kind: null,
					fold: true,
					group: 'beyond',
					total: folded.reduce((total, row) => total + matrix.kinds[row].total, 0),
					asSubject: folded.reduce((total, row) => total + matrix.kinds[row].asSubject, 0),
					asObject: folded.reduce((total, row) => total + matrix.kinds[row].asObject, 0),
				}
			: matrix.kinds[at],
	);
	const counts = order.map((r) => order.map((c) => cell(r, c)));
	let max = 0;
	for (const row of counts) for (const value of row) if (value > max) max = value;
	return { ...matrix, kinds, counts, max, folded: folded.length };
}

/**
 * HOW DARK A CELL IS, on a scale from 0 (empty) to 1 (the fullest cell in this matrix).
 *
 * Logarithmic, not linear. On a working vault the undeclared × undeclared cell holds a large share
 * of every fact and the interesting cells hold three or eight; on a linear scale every one of those
 * would be the same near-white and the picture would be one dark corner. A log scale keeps the
 * order — more facts is always darker — while letting a cell of three be told from a cell of one.
 * A single hue, light to dark: this encodes magnitude and nothing else.
 */
export function cellShade(count, max) {
	if (!(count > 0) || !(max > 0)) return 0;
	return Math.min(1, Math.log1p(count) / Math.log1p(max));
}

/**
 * THE SENTENCE UNDER THE MATRIX, built beside the numbers it quotes.
 *
 * The same rule as the overview's regime line: the words are composed in the model, next to the
 * arithmetic, so the screen cannot describe one reading while the picture above it shows another.
 * Two sentences, and the second is the one that changes when the schema list did not arrive — in
 * which case it says that, rather than pretending every kind is a writer's invention.
 */
export function kindMatrixReading(matrix) {
	const kindCount = matrix.groups.schema + matrix.groups.beyond;
	const plural = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
	const facts = plural(matrix.factCount, 'statement', 'statements');

	const opening =
		kindCount === 0
			? `No name in these ${facts} was declared as any kind.`
			: `${plural(kindCount, 'kind is', 'kinds are')} in use across ${facts}.`;

	if (!matrix.schemaKnown) {
		return (
			`${opening} This engine’s contract was not read at launch, so none of them can be told ` +
			'apart as named by the schema or added by a writer.'
		);
	}

	const parts = [];
	parts.push(
		matrix.groups.schema === 0
			? 'The schema names none of them'
			: `The schema names ${matrix.groups.schema.toLocaleString()} of them`,
	);
	if (matrix.groups.beyond > 0) {
		parts.push(
			`the other ${plural(matrix.groups.beyond, 'kind was', 'kinds were')} introduced by whoever wrote the memories`,
		);
	}
	if (matrix.schemaUnused.length > 0) {
		parts.push(`${plural(matrix.schemaUnused.length, 'kind', 'kinds')} the schema names ${matrix.schemaUnused.length === 1 ? 'is' : 'are'} not used here at all`);
	}
	let sentence = `${parts.join(', ')}.`;
	if (matrix.undeclaredEndpoints > 0) {
		sentence +=
			` ${plural(matrix.undeclaredEndpoints, 'fact end', 'fact ends')} ` +
			`${matrix.undeclaredEndpoints === 1 ? 'names' : 'name'} something no memory declared as any kind.`;
	}
	return `${opening} ${sentence}`;
}
