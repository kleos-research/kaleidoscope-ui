/**
 * THE ARITHMETIC BEHIND BrowseScale — the five facets, the time grouping, and the filter.
 *
 * Everything here is a pure function over rows the browser already holds. NOTHING IN THIS FILE MAY
 * BECOME A REQUEST, and that is a property of the code rather than of a label: there is no fetch
 * helper in scope, so no keystroke that lands in `applyBrowseFilters` can reach the engine. The
 * ranked door records every distinct query string it is given, permanently, in a store nothing
 * published reads back — a filter box wired to it turns browsing into a keystroke log inside the
 * user's own vault. See `records.mjs` and PRD 0002 §3.4.
 *
 * WHY THE FACETS ARE FIVE AND WHY THEY ARE NAMED THIS WAY. The owner walked the old rail and could
 * not use it: "Also present in this vault — defect. I don't know this filter." · "Applies to branch.
 * I don't know why we have it, and I don't even know how this works." · "Corrections and
 * contradictions. I don't know." · "I had to scroll for ten minutes for each." The approved mockup
 * answers with five closed rows, in this order:
 *
 *   Kind            the memory's own type value, exactly as the record spells it
 *   When            the same buckets the list groups by, so a facet and a heading agree
 *   Still true      the plain-English form of "validity window" AND of "corrections and
 *                   contradictions" — both answer one question and the reader asks it once
 *   Mentions        a declared name, which is how a person actually looks for a memory
 *   Branch or file  LAST, and it says what it is when opened, because the owner did not know
 *
 * The project is NOT here. It is the switcher in the top bar — the axis every screen is read along
 * — and it never appears as a removable chip. See `withinProject` in `records.mjs`.
 *
 * NO VOCABULARY IS WRITTEN DOWN. Kind values come from the engine's own vocabulary and are merely
 * counted here; mention values, place values and the axes themselves are computed from the loaded
 * records. The only literal lists below are of THIS APP'S OWN buckets — time ranges and the seven
 * truth states — which are structure this app defines rather than an open registry the engine owns.
 */

import { validityOf } from './records.mjs';

/** Milliseconds in a day. The time buckets are all derived from days, as `when.mjs` is. */
const DAY = 86_400_000;

/** The scope axis the top-bar switcher owns. It is deliberately absent from every facet below. */
const PROJECT_AXIS = 'project';

/**
 * The sentinel for "the writer left this axis out", which is a real bucket and not a missing value.
 * An omitted axis matches EVERY request, so this bucket is wider than any named value in it.
 */
export const EVERY = '\u0000every';

/** Joins an axis to one of its values inside the single "Branch or file" facet. */
const PLACE_SEP = '\u0000';

export const placeValue = (axis, value) => `${axis}${PLACE_SEP}${value}`;
export const splitPlace = (encoded) => {
	const at = String(encoded).indexOf(PLACE_SEP);
	return at === -1 ? [encoded, EVERY] : [encoded.slice(0, at), encoded.slice(at + PLACE_SEP.length)];
};

/** The one value in "When" that is not a time bucket: everything written since the last visit. */
export const SINCE_LAST_LOOKED = '\u0000since';

export const EMPTY_FILTERS = {
	text: '',
	kind: [],
	when: [],
	truth: [],
	mentions: [],
	place: [],
};

export function isFiltered(filters) {
	return (
		filters.text.trim().length > 0 ||
		filters.kind.length > 0 ||
		filters.when.length > 0 ||
		filters.truth.length > 0 ||
		filters.mentions.length > 0 ||
		filters.place.length > 0
	);
}

/** How many separate narrowings are on. The foot's "Clear both filters" counts these. */
export function activeFacetCount(filters) {
	let count = 0;
	if (filters.text.trim().length > 0) count += 1;
	for (const key of ['kind', 'when', 'truth', 'mentions', 'place']) {
		if (filters[key].length > 0) count += 1;
	}
	return count;
}

/* ------------------------------------------------------------------------------ the time axis */

/**
 * Which time bucket a written date falls in, as a key and the words the heading prints.
 *
 * THE BUCKETS ARE WHAT MAKES 600+ BROWSABLE, and they are the same object on the group heading and
 * in the "When" facet — a facet value and a heading that disagreed would be two different claims
 * about the same set. BrowseScale draws exactly this ladder: "Today", "Earlier this week",
 * "August".
 *
 * A month inside the current year prints as its bare month name; an earlier year carries the year,
 * because "August" in a list that spans two Augusts names neither of them. A row whose date cannot
 * be read lands in its own bucket rather than being dropped — a memory this app cannot date is
 * still a memory, and hiding it would make the count on the foot a lie.
 *
 * `sortKey` descends with age, so the buckets order themselves and no caller has to know the ladder.
 */
export function timeBucket(value, now = Date.now()) {
	const at = typeof value === 'string' && value.trim() ? Date.parse(value.trim()) : Number.NaN;
	if (Number.isNaN(at)) return { key: 'undated', label: 'No date recorded', sortKey: -1 };

	const days = Math.floor(Math.max(now - at, 0) / DAY);
	if (days < 1) return { key: 'today', label: 'Today', sortKey: Number.MAX_SAFE_INTEGER };
	if (days < 2) return { key: 'yesterday', label: 'Yesterday', sortKey: Number.MAX_SAFE_INTEGER - 1 };
	if (days < 7) {
		return {
			key: 'this-week',
			label: 'Earlier this week',
			sortKey: Number.MAX_SAFE_INTEGER - 2,
		};
	}

	const when = new Date(at);
	const year = when.getFullYear();
	const month = when.getMonth();
	const thisYear = new Date(now).getFullYear();
	const name = MONTHS[month];
	return {
		key: `m-${year}-${month}`,
		label: year === thisYear ? name : `${name} ${year}`,
		// Months sort by their own position in time, which is always below the three named buckets.
		sortKey: year * 12 + month,
	};
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

/** Which sorts the time headings are true of. Under any other sort a heading would be a lie. */
export const GROUPED_SORTS = new Set(['written', 'written_asc']);

/**
 * The list as headed groups, or as one unheaded run.
 *
 * THE GROUPS FOLLOW THE ROW ORDER RATHER THAN IMPOSING ONE. Rows arrive already sorted, and a group
 * is a contiguous run of them — so "oldest first" produces the same ladder upside down with no
 * second sort, and a sort the ladder is not true of (title, fact count) produces ONE run with no
 * heading at all. A "Today" heading over a title-sorted list would be a claim about the rows under
 * it that the sort does not make.
 */
export function groupRows(rows, { sort = 'written', now = Date.now() } = {}) {
	if (!GROUPED_SORTS.has(sort)) return [{ key: 'all', label: null, rows }];

	const groups = [];
	let current = null;
	for (const row of rows) {
		const bucket = timeBucket(row.created_on, now);
		if (current === null || current.key !== bucket.key) {
			current = { key: bucket.key, label: bucket.label, rows: [] };
			groups.push(current);
		}
		current.rows.push(row);
	}
	return groups;
}

/**
 * Groups flattened into one addressable sequence of headings and rows.
 *
 * The list renders from this array and NOT from nested maps, and that is what makes j/k a single
 * increment over row positions instead of a walk of two levels. It is also what lets the visible
 * window be a slice: a windowed renderer over nested groups has to decide what half a group means.
 */
export function flattenGroups(groups) {
	const items = [];
	let position = 0;
	for (const group of groups) {
		if (group.label !== null) {
			items.push({ kind: 'heading', key: `h:${group.key}`, label: group.label, count: group.rows.length });
		}
		for (const row of group.rows) {
			items.push({ kind: 'row', key: row.memory_id, row, position });
			position += 1;
		}
	}
	return items;
}

/* --------------------------------------------------------------------------------- the facets */

/** Every declared name on a record, lowercased for matching but reported as it is spelled. */
function declaredNames(row) {
	return (row.record?.semantic?.entities ?? [])
		.map((entity) => entity?.n)
		.filter((name) => typeof name === 'string' && name.trim().length > 0);
}

/**
 * Which of the seven "Still true" states a row is in. A row can be in several at once, which is why
 * this returns a set rather than a bucket.
 *
 * THE VALIDITY WINDOW AND THE DECLARED RELATIONS ARE ONE FACET because they are one question. The
 * old rail asked it twice, under "Validity" and under "Corrections and contradictions", and the
 * owner understood neither label. "Still true" is the question a person actually has, and every
 * value below is an answer to it in words they do not have to be taught.
 */
export function truthStates(row, relations, now = Date.now()) {
	const states = new Set();
	const window = validityOf(row.record?.semantic, now);
	if (window) states.add(window);

	const entry = relations?.get(row.memory_id);
	if ((entry?.corrected_by ?? []).length > 0) states.add('corrected_by');
	if ((entry?.contradicted_by ?? []).length > 0) states.add('contradicted_by');
	if ((entry?.corrects ?? []).length > 0) states.add('corrects');
	if ((entry?.contradicts ?? []).length > 0) states.add('contradicts');
	return states;
}

/**
 * The words each state prints. This app's own vocabulary about its own computation, not the
 * engine's — `serving`/`not_yet`/`no_longer` are derived here from two date fields, and the four
 * relation states are derived by inverting what the records declare.
 */
export const TRUTH_LABELS = {
	serving: 'Still true today',
	not_yet: 'Not true yet',
	no_longer: 'No longer true',
	corrected_by: 'Corrected by a later memory',
	contradicted_by: 'Contradicted by another',
	corrects: 'Corrects an earlier memory',
	contradicts: 'Contradicts another',
};

/** Count how many rows fall in each value of a facet, so no value is offered without its size. */
function tally(rows, pick) {
	const counts = new Map();
	for (const row of rows) for (const value of pick(row)) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
}

const byCountThenName = (a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label));

/**
 * Every facet's values, with counts, computed over the rows the project switcher already narrowed
 * to.
 *
 * A VALUE WHOSE COUNT IS ZERO IS NOT OFFERED, and that one rule retires the divider the owner could
 * not read. The engine publishes two type lists — what a writer may declare, and what this
 * workspace holds — and the old control drew the difference between them under the label "Also
 * present in this vault". Dropping a value nothing carries makes the two lists collapse into the
 * one list a reader can act on: every kind offered here narrows to at least one memory. What a
 * writer may DECLARE is a question the editor answers, from the same vocabulary, where it is the
 * question being asked.
 *
 * @param rows        the project's rows, already narrowed, NOT yet filtered.
 * @param vocabulary  the engine's reading. Used only to ORDER the kinds; never to invent one.
 * @param relations   the correction/contradiction index over the whole payload.
 * @param lastLooked  the write-order watermark from the previous visit, or null.
 */
export function browseFacets(rows, { vocabulary = null, relations = null, lastLooked = null, now = Date.now() } = {}) {
	/* --- Kind ------------------------------------------------------------------------------- */
	const kindCounts = tally(rows, (row) => (row.memory_type ? [row.memory_type] : []));
	// The engine's declarable list first, in its order, then anything else on a record. A type the
	// engine no longer offers but the vault still holds is still a thing the reader can see, so it
	// is still offered — the engine's lists describe the workspace, not this payload.
	const declarable = vocabulary?.declarable_memory_types ?? [];
	const ordered = [
		...declarable.filter((value) => kindCounts.has(value)),
		...[...kindCounts.keys()].filter((value) => !declarable.includes(value)).sort(),
	];
	const kind = ordered.map((value) => ({ value, label: value, count: kindCounts.get(value) }));

	/* --- When ------------------------------------------------------------------------------- */
	const buckets = new Map();
	for (const row of rows) {
		const bucket = timeBucket(row.created_on, now);
		const seen = buckets.get(bucket.key);
		if (seen) seen.count += 1;
		else buckets.set(bucket.key, { value: bucket.key, label: bucket.label, count: 1, sortKey: bucket.sortKey });
	}
	const when = [...buckets.values()].sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey, ...rest }) => rest);
	// "Since I last looked" leads the facet when there is a mark to compare against. The mark lives
	// in this browser: the vault records nothing about what anyone has read, and this app does not
	// pretend otherwise.
	if (lastLooked !== null) {
		const count = rows.filter((row) => (row.sequence ?? -1) > lastLooked).length;
		if (count > 0) {
			when.unshift({ value: SINCE_LAST_LOOKED, label: 'Since I last looked', count });
		}
	}

	/* --- Still true ------------------------------------------------------------------------- */
	const truthCounts = tally(rows, (row) => truthStates(row, relations, now));
	const truth = Object.entries(TRUTH_LABELS)
		.map(([value, label]) => ({ value, label, count: truthCounts.get(value) ?? 0 }))
		.filter((entry) => entry.count > 0);

	/* --- Mentions --------------------------------------------------------------------------- */
	// A name counts ONCE per memory however many facts use it: the count is "memories I would still
	// see", which is what a reader is deciding on, not "times this string appears".
	const mentionCounts = tally(rows, (row) => new Set(declaredNames(row)));
	const mentions = [...mentionCounts.entries()]
		.map(([value, count]) => ({ value, label: value, count }))
		.sort(byCountThenName);

	/* --- Branch or file --------------------------------------------------------------------- */
	// The axes present on the loaded records, minus the one the top bar owns. An axis the engine
	// adds later appears here on its own, generically, rather than disappearing from the screen.
	const axes = [];
	for (const row of rows) {
		for (const axis of Object.keys(row.scope ?? {})) {
			if (axis !== PROJECT_AXIS && !axes.includes(axis)) axes.push(axis);
		}
	}
	axes.sort();

	const place = [];
	for (const axis of axes) {
		const counts = tally(rows, (row) => [row.scope?.[axis] ?? EVERY]);
		const every = counts.get(EVERY) ?? 0;
		// The "every …" bucket is listed first within its axis because it is usually the largest and
		// because its meaning is inverted: the writer left the axis out, so the memory applies to
		// every one of them rather than to none.
		if (every > 0) {
			place.push({ value: placeValue(axis, EVERY), label: `every ${wordFor(axis)}`, count: every, axis });
		}
		for (const [value, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))) {
			if (value === EVERY) continue;
			place.push({ value: placeValue(axis, value), label: `${wordFor(axis)} ${value}`, count, axis });
		}
	}

	return { kind, when, truth, mentions, place, axes };
}

/**
 * The word a reader uses for a scope axis. `artifact` is the contract's field name and "file" is
 * what it holds; an axis this app has never met prints its own name rather than vanishing.
 */
export function wordFor(axis) {
	if (axis === 'artifact') return 'file';
	return axis;
}

/* -------------------------------------------------------------------------------- the filter */

/**
 * Apply every narrowing, in the browser, over rows already in memory.
 *
 * WITHIN A FACET THE VALUES ARE OR'D; ACROSS FACETS THEY ARE AND'ED. That is what the counts beside
 * the values mean: picking a second kind widens, picking a kind and then a name narrows. A facet
 * that AND'ed inside itself would make its own counts wrong the moment a second value was ticked,
 * and the reader would be looking at a number that could not happen.
 */
export function applyBrowseFilters(rows, filters, relations, now = Date.now()) {
	const needle = filters.text.trim().toLowerCase();
	const kinds = new Set(filters.kind);
	const when = new Set(filters.when);
	const truth = new Set(filters.truth);
	const mentions = new Set(filters.mentions);
	const places = filters.place.map(splitPlace);

	return rows.filter((row) => {
		if (needle && !row.haystack.includes(needle)) return false;
		if (kinds.size > 0 && !kinds.has(row.memory_type)) return false;

		if (when.size > 0) {
			const inBucket = when.has(timeBucket(row.created_on, now).key);
			// `lastLooked` is not carried here: the facet resolved it to a sequence when it was
			// built, and re-deriving it would let the list and the count disagree mid-session.
			const sinceMark = when.has(SINCE_LAST_LOOKED) && row.newer_than_watermark === true;
			if (!inBucket && !sinceMark) return false;
		}

		if (truth.size > 0) {
			const states = truthStates(row, relations, now);
			let hit = false;
			for (const state of states) if (truth.has(state)) hit = true;
			if (!hit) return false;
		}

		if (mentions.size > 0) {
			if (!declaredNames(row).some((name) => mentions.has(name))) return false;
		}

		if (places.length > 0) {
			const hit = places.some(([axis, value]) => {
				const actual = row.scope?.[axis] ?? null;
				return value === EVERY ? actual === null : actual === value;
			});
			if (!hit) return false;
		}

		return true;
	});
}

/**
 * Stamp each row with whether it arrived after the last visit.
 *
 * Done ONCE, against the mark read at launch, rather than inside the filter — a predicate that
 * re-read a moving watermark would answer differently for the facet's count and for the list under
 * it, and the reader would see "12" over eleven rows with no way to tell which was wrong.
 */
export function markWatermark(rows, lastLooked) {
	if (lastLooked === null) return rows;
	return rows.map((row) => ({ ...row, newer_than_watermark: (row.sequence ?? -1) > lastLooked }));
}

/* ------------------------------------------------------------------------------- a row's marks */

/**
 * What the second line of a row says, as data rather than as markup.
 *
 * Composed here so the list, and anything that later needs the same sentence, cannot spell it two
 * ways. `headed` says a time heading is already carrying the date, which is the whole reason the
 * grouped list can afford a one-line meta where BrowseB, which has no headings, needs the date in
 * it.
 */
export function rowMarks(row, relations, { headed = false, now = Date.now() } = {}) {
	const entry = relations?.get(row.memory_id);
	const supersededBy = (entry?.corrected_by ?? []).length + (entry?.contradicted_by ?? []).length;
	const corrects = (entry?.corrects ?? []).length;
	const contradicts = (entry?.contradicts ?? []).length;

	return {
		// Dimmed and labelled "superseded", exactly as BrowseScale draws the row that another memory
		// corrects. It is a computed reading and not a flag on the record: there is no superseded
		// field in this store, and the honest form of the question is the inversion of what the
		// memories themselves declare.
		superseded: supersededBy > 0,
		when: headed ? null : timeBucket(row.created_on, now).label,
		kind: row.memory_type,
		facts: row.fact_count,
		corrects,
		contradicts,
		// Only when the memory declares at least one named thing. A memory that declares none is in
		// a different and entirely legitimate regime, and running the check there would flag almost
		// every honest memory in a young vault as defective (PRD 0002 R13).
		undeclared: row.undeclared_endpoints ?? 0,
	};
}
