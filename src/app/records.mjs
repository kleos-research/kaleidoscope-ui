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

/**
 * The axes in the order a reader meets them: project first — "projects should be on the top; all
 * of this comes under a project at the end of the day" — then branch, then file, then anything an
 * engine adds later in its own order. The table above is the one place that order is written.
 */
export function orderAxes(names) {
	const known = Object.keys(AXIS_COPY);
	const present = new Set(names);
	return [...known.filter((key) => present.has(key)), ...names.filter((key) => !known.includes(key))];
}

/** The axes actually present on the loaded records, in a stable order. */
export function scopeAxes(records) {
	const seen = new Set();
	for (const record of records) for (const key of Object.keys(record.semantic?.scope ?? {})) seen.add(key);
	return orderAxes([...seen].sort());
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

/**
 * THE DATE SORTS FIRST, AND THIS IS WHAT MAKES THE TIME HEADINGS TRUE.
 *
 * It sorted on `sequence` alone, for a good reason stated above: write order is monotonic where a
 * day-granular date ties heavily. But `sequence` is the JOURNAL POSITION and `created_on` is a date
 * the WRITER supplied, and on a real vault the two disagree constantly — a memory written this
 * afternoon can carry an August date. BrowseScale groups the list under time headings, `groupRows`
 * builds a group as a contiguous run of one bucket, and so a list ordered by one quantity and
 * headed by another produced this, live, on 363 real memories:
 *
 *     TODAY 3 · YESTERDAY 50 · AUGUST 14 · AUGUST 1 · YESTERDAY 1 · AUGUST 1 · YESTERDAY 1 …
 *
 * — a heading emitted at every oscillation, most of them with nothing under them. `groupRows`
 * already carries the rule this broke: "a heading over rows the sort does not order that way is a
 * claim about them the sort does not make."
 *
 * So the displayed date is the primary key and the write order is the tie-break. The date's day
 * granularity is no longer a problem, because `sequence` resolves every tie inside a day and the id
 * resolves the rest: the order stays total and stable, and the ladder is now monotone by
 * construction.
 */
/** Below any date a vault can hold, and finite. See `dateKey`. */
const UNDATED = -8.64e15;

const dateKey = (row) => {
	const value = typeof row.created_on === 'string' ? Date.parse(row.created_on) : Number.NaN;
	// An unreadable date sorts oldest rather than being dropped, which matches `timeBucket`'s
	// "No date recorded" bucket sitting at the foot of the ladder. The sentinel is FINITE: with
	// `-Infinity`, two undated rows subtract to `NaN` and the comparator returns it, which is
	// undefined behaviour for `Array.prototype.sort` rather than a fall-through to the tie-break.
	return Number.isNaN(value) ? UNDATED : value;
};

export const SORTS = {
	written: {
		label: 'Newest first',
		compare: (a, b) =>
			dateKey(b) - dateKey(a) || (b.sequence ?? -1) - (a.sequence ?? -1) || byId(a, b),
	},
	written_asc: {
		label: 'Oldest first',
		compare: (a, b) =>
			dateKey(a) - dateKey(b) || (a.sequence ?? -1) - (b.sequence ?? -1) || byId(a, b),
	},
	title: {
		label: 'Title A–Z',
		compare: (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')) || byId(a, b),
	},
	facts: {
		label: 'Most facts',
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

/* ---------------------------------------------------------------------------------------------
 * THE FACETS AND THE FILTER USED TO BE HERE, AND THEY ARE GONE RATHER THAN KEPT BESIDE THE NEW ONES.
 *
 * What stood in this space was `buildFacets`, `applyFilters`, `EMPTY_FILTERS`, `isFiltered` and the
 * two label maps they read: the arithmetic behind a rail of always-open value lists that the owner
 * could not use. "Also present in this vault \u2014 defect. I don't know this filter." \u00b7 "Applies to
 * branch. I don't know why we have it, and I don't even know how this works." \u00b7 "I had to scroll
 * for ten minutes for each."
 *
 * Its replacement is `browse-model.mjs`, which answers the same questions with five named facets and
 * a time grouping. THE OLD ONE IS DELETED AND NOT DEPRECATED, for one specific reason: two modules
 * exporting `EMPTY_FILTERS` and `isFiltered` under the same names with DIFFERENT SHAPES is not dead
 * code, it is a loaded gun. An import resolved to the wrong one type-checks in a language with no
 * types, renders, and silently narrows nothing \u2014 which looks exactly like a vault with one memory
 * in it.
 *
 * What survives here is what is not about filtering: `validityOf` above, which `browse-model.mjs`
 * reads for its "Still true" facet, and the project axis below, which is a switcher rather than a
 * narrowing.
 * ------------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------------
 * THE PROJECT AXIS.
 *
 * "Project management should be a totally different thing. You can select which projects to display
 * together, or you can have a general global view. And projects should be on the top. All of this
 * comes under a project at the end of the day."
 *
 * So the project is not a facet and it does not go through `applyFilters`: it is a switcher at the
 * top of the shell that decides WHICH ROWS THE SCREENS BELOW ARE ABOUT, before any filter runs. It
 * never appears as a removable chip, because it is not one of several narrowings — it is the axis
 * the rest of them are read along.
 * ------------------------------------------------------------------------------------------- */

/** The field the scope object carries a project in. A field name, not a value. */
export const PROJECT_AXIS = 'project';

/**
 * The projects the loaded records actually mention, with how many memories each holds, plus the
 * count of memories that carry no project at all.
 *
 * The second number is not a project. It is reported separately because it means something
 * different, and `withinProject` is where that difference is enforced.
 */
export function projectOptions(rows) {
	const counts = new Map();
	let everywhere = 0;
	for (const row of rows) {
		const value = row.scope?.[PROJECT_AXIS] ?? null;
		if (value === null) everywhere += 1;
		else counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return {
		projects: [...counts.entries()]
			.map(([value, count]) => ({ value, label: value, count }))
			.sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))),
		everywhere,
	};
}

/**
 * The rows a chosen project is about — AND THIS IS THE HONEST PART.
 *
 * A memory written with no project APPLIES EVERYWHERE: the engine offers it to an agent working on
 * anything, because an omitted scope axis matches every request. So choosing a project must INCLUDE
 * those memories rather than exclude them. Treating "no project" as a project called none would
 * hide, from the project view, exactly the memories that are most certainly in force there — and
 * the screen would be quietly asserting the opposite of what the store does.
 *
 * `null` means every project, which is every row.
 */
export function withinProject(rows, project) {
	if (project === null || project === undefined) return rows;
	return rows.filter((row) => {
		const value = row.scope?.[PROJECT_AXIS] ?? null;
		return value === null || value === project;
	});
}

/**
 * A scope value short enough for a metadata line, or `null` when the whole value already is.
 *
 * THE ONE STRING IN THIS PRODUCT THAT IS SHORTENED, and it is shortened here, in code, rather than
 * by an ellipsis in a stylesheet — so the part that is kept is the part that says something. A
 * repository path is cut from the front, whole segments at a time, because its tail is the file
 * and its head is the tree every file in the project shares: `…/crossings/winter.yaml` tells a
 * reader which file, and `infra/staging/restore.ni…` tells them which directory. Anything else is
 * cut from the end.
 *
 * The screen that draws the short form draws it as a control that shows the whole value on a
 * press, which is what makes cutting it honest: nothing is recoverable only by hovering.
 */
export function shortenScope(value, max = 28) {
	const whole = String(value ?? '');
	if (whole.length <= max) return null;

	const segments = whole.split('/').filter((part) => part.length > 0);
	if (segments.length > 1) {
		let tail = segments[segments.length - 1];
		for (let index = segments.length - 2; index >= 1; index -= 1) {
			const longer = `${segments[index]}/${tail}`;
			if (longer.length + 2 > max) break;
			tail = longer;
		}
		return `…/${tail}`;
	}
	return `${whole.slice(0, max - 1).trimEnd()}…`;
}
