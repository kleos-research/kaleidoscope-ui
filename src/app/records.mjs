/**
 * The exported record, turned into the things a screen needs — and nothing else.
 *
 * Pure functions over a payload that has already arrived. Nothing here fetches, and that is the
 * point: filtering, sorting, faceting and paging are arithmetic over an array in memory, so no
 * keystroke in this app can reach the engine. See the note at the top of `api.mjs`.
 *
 * Two rules run through all of it:
 *   - a value the record does not carry is reported as ABSENT, never as an empty string, so the
 *     screen can say "not recorded" instead of leaving a blank a later contributor fills with a
 *     guess;
 *   - no vocabulary is written down. Types, kinds and relation names are read from the engine.
 */

/**
 * The scope axes, with the phrase each one renders when the writer left it out.
 *
 * These are FIELD NAMES in the write contract's `scope` object — structure, not an open registry of
 * values — which is why naming them here is not the transcription the vocabulary rule forbids. The
 * values that go in them are computed from the loaded records and never listed anywhere.
 *
 * The phrase is the whole point. An omitted axis matches EVERY request, so a blank cell reads as
 * "less" and means "more". An axis the engine adds later still renders, generically, rather than
 * disappearing from the screen.
 */
const AXIS_COPY = {
	project: { label: 'project', every: 'every project' },
	branch: { label: 'branch', every: 'every branch' },
	artifact: { label: 'file', every: 'every file' },
};

export const axisCopy = (key) => AXIS_COPY[key] ?? { label: key, every: `every ${key}` };

/** The axes actually present on the loaded records, in a stable order. */
export function scopeAxes(records) {
	const known = Object.keys(AXIS_COPY);
	const seen = new Set();
	for (const record of records) for (const key of Object.keys(record.semantic?.scope ?? {})) seen.add(key);
	const extra = [...seen].filter((key) => !known.includes(key)).sort();
	return [...known.filter((key) => seen.has(key)), ...extra];
}

const text = (value) => (typeof value === 'string' && value.trim().length > 0 ? value : null);

/**
 * How many of this memory's facts name something the memory does not declare — or `null`, meaning
 * the question does not apply.
 *
 * THE GATE IS THE REQUIREMENT. The check runs only when the memory declares at least one named
 * thing. A memory that declares none is in a different and entirely legitimate regime, and a large
 * share of agent-written memories are in it; running the check there would flag almost every honest
 * memory in a young vault as defective. `null` is not zero and the screen renders them differently.
 */
export function undeclaredEndpointCount(semantic) {
	const declared = new Set((semantic?.entities ?? []).map((entity) => entity?.n).filter(Boolean));
	if (declared.size === 0) return null;

	let count = 0;
	for (const fact of semantic?.facts ?? []) {
		if (!declared.has(fact?.subject) || !declared.has(fact?.object)) count += 1;
	}
	return count;
}

/**
 * One row's worth of a record, plus the lowercased haystack the filter box runs over.
 *
 * The haystack covers exactly the fields a reader can see — title, body, fact endpoints and
 * relations, declared names and their glosses, evidence references. A filter that matched a field
 * the screen never shows would find memories the user cannot then recognise.
 */
export function toRow(record) {
	const semantic = record?.semantic ?? {};
	const facts = semantic.facts ?? [];
	const entities = semantic.entities ?? [];

	const haystack = [
		semantic.title,
		record?.content_md,
		...facts.flatMap((fact) => [fact?.subject, fact?.predicate, fact?.object]),
		...entities.flatMap((entity) => [entity?.n, entity?.kind, entity?.is]),
		...(semantic.evidence ?? []).flatMap((item) => [item?.reference, item?.kind]),
	]
		.filter((value) => typeof value === 'string')
		.join('\n')
		.toLowerCase();

	return {
		record,
		memory_id: record?.memory_id ?? null,
		version_id: record?.version_id ?? null,
		title: text(semantic.title),
		memory_type: text(semantic.memory_type),
		scope: semantic.scope ?? {},
		fact_count: facts.length,
		entity_count: entities.length,
		// The record's monotonic ordering key. This is what sorts; the date is what is displayed.
		sequence: typeof semantic.sequence === 'number' ? semantic.sequence : null,
		created_on: text(semantic.created_on),
		undeclared_endpoints: undeclaredEndpointCount(semantic),
		corrections: semantic.corrections ?? [],
		contradicts: semantic.contradicts ?? [],
		haystack,
	};
}

/**
 * Order by write order, and break every tie on the memory id.
 *
 * The tie-break is not decoration. Write-order values are not unique across a vault — on a real one
 * a third of them repeat — so ordering on the key alone leaves groups of rows whose relative
 * position the sort does not decide, and a reader who reloads sees them shuffle for no reason they
 * can see. The first-written date is worse still: it has day granularity, so a vault written by
 * agents in bursts ties it heavily. The date is displayed because a human recognises it; the write
 * order sorts because it orders; the id makes the result total.
 */
const byId = (a, b) => String(a.memory_id).localeCompare(String(b.memory_id));

export const SORTS = {
	written: {
		label: 'Written',
		compare: (a, b) => (b.sequence ?? -1) - (a.sequence ?? -1) || byId(a, b),
	},
	written_asc: {
		label: 'Written, oldest first',
		compare: (a, b) => (a.sequence ?? -1) - (b.sequence ?? -1) || byId(a, b),
	},
	title: {
		label: 'Title',
		compare: (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')) || byId(a, b),
	},
	facts: {
		label: 'Fact count',
		compare: (a, b) => b.fact_count - a.fact_count || byId(a, b),
	},
};

export const DEFAULT_SORT = 'written';

/**
 * Which memories correct or contradict which, in both directions.
 *
 * The outbound direction is what a record declares. The inbound direction — what corrects THIS —
 * is an inversion over the whole cache, which costs one pass and needs no call.
 *
 * A correction names its target by a HANDLE, and a handle is whatever the writing agent called the
 * thing. On a real vault most of them resolve to no memory at all. So resolution is reported rather
 * than assumed: `by_id` when the handle is a memory id, `by_title` when it is exactly some memory's
 * title, and `unresolved` otherwise — which the screen says in words instead of rendering a link
 * that goes nowhere.
 */
export function relationIndex(rows) {
	const byMemoryId = new Map(rows.map((row) => [row.memory_id, row]));
	const byTitle = new Map();
	for (const row of rows) {
		const key = row.title?.trim().toLowerCase();
		// First writer wins; a duplicated title is not a resolution and must not silently pick one.
		if (key && !byTitle.has(key)) byTitle.set(key, row.memory_id);
		else if (key) byTitle.set(key, null);
	}

	const resolve = (handle) => {
		const raw = String(handle ?? '').trim();
		if (!raw) return { handle: raw, target: null, how: 'unresolved' };
		if (byMemoryId.has(raw)) return { handle: raw, target: raw, how: 'by_id' };
		const titled = byTitle.get(raw.toLowerCase());
		if (titled) return { handle: raw, target: titled, how: 'by_title' };
		return { handle: raw, target: null, how: 'unresolved' };
	};

	const empty = () => ({ corrects: [], contradicts: [], corrected_by: [], contradicted_by: [] });
	const index = new Map(rows.map((row) => [row.memory_id, empty()]));

	for (const row of rows) {
		const entry = index.get(row.memory_id);

		for (const correction of row.corrections) {
			const link = { ...resolve(correction?.handle), says: text(correction?.says) };
			entry.corrects.push(link);
			if (link.target && link.target !== row.memory_id) {
				index.get(link.target)?.corrected_by.push({ from: row.memory_id, says: link.says, how: link.how });
			}
		}

		for (const contradiction of row.contradicts) {
			// The field is a list whose items may be a bare handle or an object carrying one.
			const handle = typeof contradiction === 'string' ? contradiction : contradiction?.handle;
			const link = { ...resolve(handle), says: text(contradiction?.says) };
			entry.contradicts.push(link);
			if (link.target && link.target !== row.memory_id) {
				index
					.get(link.target)
					?.contradicted_by.push({ from: row.memory_id, says: link.says, how: link.how });
			}
		}
	}

	return index;
}

/** The validity buckets, computed against the moment the list was rendered. */
export function validityOf(semantic, now = Date.now()) {
	const from = semantic?.temporal?.valid_from ?? null;
	const until = semantic?.temporal?.valid_until ?? null;
	if (!from && !until) return null; // No window set. Not a bucket — the absence of one.

	const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
	const end = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	if (now < start) return 'not_yet';
	if (now > end) return 'no_longer';
	return 'serving';
}

export const VALIDITY_LABELS = {
	serving: 'Currently serving',
	not_yet: 'Not yet',
	no_longer: 'No longer',
};

export const RELATION_LABELS = {
	corrects: 'Declares a correction',
	contradicts: 'Declares a contradiction',
	corrected_by: 'Corrected by another memory',
	contradicted_by: 'Contradicted by another memory',
};

/** Count how many loaded rows fall in each bucket of a facet, so an option can carry its own size. */
function tally(rows, pick) {
	const counts = new Map();
	for (const row of rows) {
		for (const value of pick(row)) counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}

/**
 * Every facet's option list, computed from the loaded records — except the memory types, which come
 * from the engine's own vocabulary and are merely COUNTED here.
 *
 * The difference matters and it is the reason the type control has a divider in it. The engine
 * returns two lists that are not the same: what a writer may declare, and what this workspace
 * already holds. A control built only from the loaded records cannot offer a declarable type that
 * nothing has used yet; a control built only from the declarable list hides a type that is in the
 * vault and cannot be written any more.
 */
export function buildFacets(rows, vocabulary, relations, now = Date.now()) {
	const typeCounts = tally(rows, (row) => (row.memory_type ? [row.memory_type] : []));

	const declarable = vocabulary?.declarable_memory_types ?? null;
	const present = vocabulary?.memory_types ?? null;
	const known = declarable ?? [];
	const alsoPresent = (present ?? []).filter((value) => !known.includes(value));
	// A type sitting on a record that neither list mentions is still a thing the user can see, so it
	// is offered rather than dropped — the engine's lists describe the workspace, not this payload.
	const unlisted = [...typeCounts.keys()].filter(
		(value) => !known.includes(value) && !alsoPresent.includes(value),
	);

	const asOption = (value) => ({ value, count: typeCounts.get(value) ?? 0 });

	const axes = scopeAxes(rows.map((row) => row.record));
	const scope = axes.map((axis) => {
		const counts = tally(rows, (row) => [row.scope?.[axis] ?? null]);
		const options = [...counts.entries()]
			.filter(([value]) => value !== null)
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
		return {
			axis,
			copy: axisCopy(axis),
			// The "every …" bucket is listed FIRST because it is usually the largest and it is the
			// one whose meaning is inverted.
			every: { value: null, count: counts.get(null) ?? 0 },
			options,
		};
	});

	const validityCounts = tally(rows, (row) => {
		const bucket = validityOf(row.record?.semantic, now);
		return bucket ? [bucket] : [];
	});

	const relationCounts = new Map();
	for (const key of Object.keys(RELATION_LABELS)) {
		let count = 0;
		for (const row of rows) if ((relations.get(row.memory_id)?.[key] ?? []).length > 0) count += 1;
		relationCounts.set(key, count);
	}

	return {
		types: {
			declarable: known.map(asOption),
			also_present: alsoPresent.map(asOption),
			unlisted: unlisted.map(asOption),
			// True when the engine told us nothing — a control with no values invites a user to
			// conclude the vault has no types, so the screen says which is the case.
			vocabulary_missing: declarable === null && present === null,
		},
		scope,
		validity: [...Object.keys(VALIDITY_LABELS)].map((value) => ({
			value,
			count: validityCounts.get(value) ?? 0,
		})),
		relations: [...Object.keys(RELATION_LABELS)].map((value) => ({
			value,
			count: relationCounts.get(value) ?? 0,
		})),
	};
}

export const EMPTY_FILTERS = {
	text: '',
	types: [],
	scope: {}, // axis -> array of values; the string ' every' stands for the null bucket
	validity: [],
	relations: [],
	from_sequence: null,
	to_sequence: null,
};

/** The sentinel for "this axis was left out", which is a real bucket and not a missing value. */
export const EVERY = ' every';

export function isFiltered(filters) {
	return (
		filters.text.trim().length > 0 ||
		filters.types.length > 0 ||
		filters.validity.length > 0 ||
		filters.relations.length > 0 ||
		filters.from_sequence !== null ||
		filters.to_sequence !== null ||
		Object.values(filters.scope).some((values) => values?.length > 0)
	);
}

/**
 * Apply every filter, in the browser, over rows already in memory.
 *
 * NOTHING IN THIS FUNCTION MAY BECOME A REQUEST. It is the honest answer to a type-ahead: exact,
 * instant, and it writes nothing. The ranked door that a "real" search would use records every
 * distinct query string it is given, permanently, in a store nothing published reads back — so a
 * filter box wired to it turns browsing into a keystroke log inside the vault. If this ever feels
 * too weak, the fix is a better index HERE, not a call from here.
 */
export function applyFilters(rows, filters, relations) {
	const needle = filters.text.trim().toLowerCase();

	return rows.filter((row) => {
		if (needle && !row.haystack.includes(needle)) return false;
		if (filters.types.length > 0 && !filters.types.includes(row.memory_type)) return false;

		for (const [axis, values] of Object.entries(filters.scope)) {
			if (!values || values.length === 0) continue;
			const actual = row.scope?.[axis] ?? null;
			const key = actual === null ? EVERY : actual;
			if (!values.includes(key)) return false;
		}

		if (filters.validity.length > 0) {
			const bucket = validityOf(row.record?.semantic);
			if (!bucket || !filters.validity.includes(bucket)) return false;
		}

		if (filters.relations.length > 0) {
			const entry = relations.get(row.memory_id);
			const matches = filters.relations.some((key) => (entry?.[key] ?? []).length > 0);
			if (!matches) return false;
		}

		if (filters.from_sequence !== null && (row.sequence ?? -1) < filters.from_sequence) return false;
		if (filters.to_sequence !== null && (row.sequence ?? -1) > filters.to_sequence) return false;

		return true;
	});
}
