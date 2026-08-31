/**
 * One door, one cache, one index.
 *
 * The export door returns the WHOLE vault, accepts no filter and no offset, and writes nothing.
 * Those three facts are not negotiable from this side, so the only lever this process has is what
 * it does after the bytes arrive: strip, index, and serve slices.
 *
 * The reason this is one module and not one per screen is the failure it prevents. The list, the
 * detail view, the curation rail and the reconstructed graph all describe the same memories. If
 * two of them fetch separately they will disagree — not loudly, and not reproducibly, because the
 * vault genuinely changes under the UI whenever an agent writes. A user would see a row saying one
 * thing and a page saying another, and no test would catch it, because each screen is correct
 * about the payload it fetched. **There is one cache and every screen reads it.**
 *
 * The cache is invalidated by an explicit refresh and by nothing else. NOTHING HERE POLLS. A timer
 * that re-exports is a timer that reorders the list under a reading user; and the ranked door,
 * which is the one a poll would be tempting to use, records that it ran.
 */

/**
 * A ceiling on what this version will attempt to hold, above which it says so and does not try.
 *
 * This number is a CONFIGURED CEILING, not a measurement. Nothing here measured where the whole-
 * vault strategy stops working; what is known is that the door has no pagination, so the payload,
 * the parse and this index all grow linearly, and that a spinner which never ends is a worse
 * failure than a refusal that names the count. Setting it properly needs a timing run against
 * vaults at several sizes, which is a measurement this milestone did not take.
 */
export const DEFAULT_LISTING_CEILING = 25_000;

/** Absent, null and empty-string all mean "the writer left this axis out". See `SCOPE_UNSET`. */
const normaliseScope = (value) =>
	value === null || value === undefined || value === '' ? null : String(value);

/**
 * The wire value for "this axis is unset" in a filter query.
 *
 * An omitted axis matches EVERYTHING — a blank cell reads as "less" and means "more" — so it is a
 * bucket a user must be able to select, which means it needs a spelling on the wire. The empty
 * string is that spelling, and it is total: an empty-string axis value in a record is folded into
 * the same bucket when the index is built, so no record can fall between the two.
 */
export const SCOPE_UNSET = '';

const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

/** Every string a person can see on a row or a detail page, flattened once, lowercased once. */
function haystackFor(record) {
	const s = record.semantic ?? {};
	const parts = [record.memory_id, s.title, s.memory_type, record.content_md, s.context];

	for (const entity of s.entities ?? []) parts.push(entity?.n, entity?.kind, entity?.is);
	for (const fact of s.facts ?? []) parts.push(fact?.subject, fact?.predicate, fact?.object);
	for (const item of s.evidence ?? []) parts.push(item?.reference, item?.kind);
	for (const item of s.corrections ?? []) parts.push(item?.handle, item?.says);
	for (const axis of Object.values(s.scope ?? {})) parts.push(axis);

	return parts.filter((part) => typeof part === 'string').join('\n').toLowerCase();
}

/**
 * The undeclared-endpoint count, and THE GATE ON IT.
 *
 * The check runs only when a memory declares at least one named thing. A memory that declares none
 * is a real and entirely legitimate regime — a large share of agent-written memories are in it —
 * and running the check there would flag almost every honest memory in a young vault as defective.
 * Where a memory declares nothing this returns `null`, which the screen renders as a neutral
 * sentence rather than as a warning, and the difference between `null` and `0` is load-bearing:
 * `0` means the check ran and found nothing, `null` means it did not run.
 */
function undeclaredEndpoints(semantic) {
	const declared = semantic.entities ?? [];
	if (declared.length === 0) return null;

	const names = new Set(declared.map((entity) => lower(entity?.n).trim()).filter(Boolean));
	let count = 0;
	for (const fact of semantic.facts ?? []) {
		for (const endpoint of [fact?.subject, fact?.object]) {
			const key = lower(endpoint).trim();
			if (key && !names.has(key)) count += 1;
		}
	}
	return count;
}

function tally(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

const facetRows = (map) =>
	[...map.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));

/**
 * Build every index the screens read, in one pass over the records.
 *
 * No option list anywhere in this file is written down. Types, scope values and relation states are
 * all computed from what the records actually carry — including the SCOPE AXIS NAMES themselves,
 * which are taken from the records rather than named here, so an axis the engine adds later shows
 * up as a facet instead of being silently dropped by a list somebody typed once.
 */
export function buildIndex(listing) {
	const byId = new Map();
	const haystack = new Map();
	const derived = new Map();

	const types = new Map();
	const scope = new Map(); // axis -> Map(value -> count)
	const contradictedBy = new Map(); // memory_id -> [memory_id]
	const validity = { serving: 0, not_yet: 0, no_longer: 0, unset: 0 };

	const now = Date.now();

	for (const record of listing.memories ?? []) {
		const s = record.semantic ?? {};
		byId.set(record.memory_id, record);
		haystack.set(record.memory_id, haystackFor(record));

		tally(types, s.memory_type ?? null);

		for (const [axis, raw] of Object.entries(s.scope ?? {})) {
			if (!scope.has(axis)) scope.set(axis, new Map());
			tally(scope.get(axis), normaliseScope(raw));
		}

		const from = Date.parse(s.temporal?.valid_from ?? '');
		const until = Date.parse(s.temporal?.valid_until ?? '');
		if (Number.isNaN(from) && Number.isNaN(until)) validity.unset += 1;
		else if (!Number.isNaN(from) && from > now) validity.not_yet += 1;
		else if (!Number.isNaN(until) && until < now) validity.no_longer += 1;
		else validity.serving += 1;

		// `contradicts` carries memory ids, so inverting it across the cache is exact and costs one
		// pass. `corrections` does NOT: it names a handle and a sentence, not a memory, so there is
		// no id-level inverse of it to compute and none is invented here.
		for (const target of s.contradicts ?? []) {
			if (typeof target !== 'string') continue;
			if (!contradictedBy.has(target)) contradictedBy.set(target, []);
			contradictedBy.get(target).push(record.memory_id);
		}

		derived.set(record.memory_id, {
			entity_count: (s.entities ?? []).length,
			fact_count: (s.facts ?? []).length,
			declares_named_things: (s.entities ?? []).length > 0,
			undeclared_endpoint_count: undeclaredEndpoints(s),
			declares_corrections: (s.corrections ?? []).length > 0,
			declares_contradictions: (s.contradicts ?? []).length > 0,
			contradicted_by: [],
		});
	}

	for (const [target, sources] of contradictedBy) {
		const row = derived.get(target);
		if (row) row.contradicted_by = sources;
	}

	// The DEFAULT ORDER, decided once, here, so no screen re-derives it.
	//
	// The key is the record's monotonic write-order field and NOT the first-written date. The date
	// has day granularity and ties heavily on a vault written by agents in bursts, so sorting on it
	// produces an order that changes between loads for no reason a user can see. The date is what a
	// human recognises, so it is displayed beside the row; the write order is what actually orders.
	// The memory id breaks any remaining tie, which is what makes the order TOTAL rather than
	// merely stable-ish.
	const order = [...byId.keys()].sort((a, b) => compareWritten(byId, b, a) || a.localeCompare(b));

	return {
		byId,
		order,
		haystack,
		derived,
		axes: [...scope.keys()].sort(),
		facets: {
			memory_type: facetRows(types),
			scope: Object.fromEntries([...scope].map(([axis, values]) => [axis, facetRows(values)])),
			validity,
			relations: {
				declares_corrections: [...derived.values()].filter((d) => d.declares_corrections).length,
				declares_contradictions: [...derived.values()].filter((d) => d.declares_contradictions)
					.length,
				contradicted_by_another: contradictedBy.size,
			},
		},
	};
}

const sequenceOf = (byId, id) => byId.get(id)?.semantic?.sequence ?? 0;
const compareWritten = (byId, a, b) => sequenceOf(byId, a) - sequenceOf(byId, b);

const SORTS = {
	written: (byId) => (a, b) => compareWritten(byId, a, b) || a.localeCompare(b),
	title: (byId) => (a, b) =>
		lower(byId.get(a)?.semantic?.title).localeCompare(lower(byId.get(b)?.semantic?.title)) ||
		a.localeCompare(b),
	facts: (byId, derived) => (a, b) =>
		(derived.get(a)?.fact_count ?? 0) - (derived.get(b)?.fact_count ?? 0) || a.localeCompare(b),
};

/** The sort keys this server offers, computed from the table above so the two cannot drift. */
export const SORT_KEYS = Object.keys(SORTS);

/**
 * Serve a slice out of the index. SPAWNS NOTHING.
 *
 * Every filter, every sort and every page is answered from memory. That is the whole point of the
 * index: the filter box in the browser types against this, at the rate a person types, and it must
 * cost nothing and — far more important — it must not reach a door. The ranked door records that
 * it ran, per distinct query string, permanently, and a type-ahead wired to it would generate a
 * record per keystroke.
 *
 * @param {object} index     from `buildIndex`
 * @param {object} [query]
 * @param {string[]} [query.types]      memory types to keep; empty keeps all
 * @param {object} [query.scope]        axis -> array of values; `SCOPE_UNSET` selects the null bucket
 * @param {string} [query.text]         case-insensitive substring over the displayable fields
 * @param {string} [query.sort]         one of SORT_KEYS
 * @param {string} [query.order]        'asc' | 'desc'
 */
export function selectMemories(index, query = {}) {
	const { byId, derived } = index;
	const types = new Set(query.types ?? []);
	const text = lower(query.text ?? '').trim();
	const scopeFilters = Object.entries(query.scope ?? {}).filter(([, values]) => values?.length);

	let ids = index.order.filter((id) => {
		const s = byId.get(id)?.semantic ?? {};
		if (types.size > 0 && !types.has(s.memory_type)) return false;

		for (const [axis, values] of scopeFilters) {
			const actual = normaliseScope(s.scope?.[axis]);
			const wanted = values.some((value) =>
				value === SCOPE_UNSET ? actual === null : actual === value,
			);
			if (!wanted) return false;
		}

		if (text && !index.haystack.get(id)?.includes(text)) return false;
		return true;
	});

	const key = query.sort && SORTS[query.sort] ? query.sort : 'written';
	ids = [...ids].sort(SORTS[key](byId, derived));
	if ((query.order ?? 'desc') === 'desc') ids.reverse();

	return { ids, sort: { key, order: query.order === 'asc' ? 'asc' : 'desc' } };
}

/**
 * The cache itself.
 *
 * @param {object} deps
 * @param {() => Promise<object>} deps.load    the export door
 * @param {() => Promise<object>} deps.health  the cheap, non-writing health read
 * @param {number} [deps.ceiling]
 */
export function createListingCache({ load, health, ceiling = DEFAULT_LISTING_CEILING }) {
	let snapshot = null;
	let inFlight = null;

	async function fetchOnce() {
		const startedAt = performance.now();

		// The size check comes from the HEALTH read and never from the export.
		//
		// This looks like an extra call and it is the whole point: if the count were learned from
		// the export, then the only way to discover a vault is too large to export would be to
		// export it — and the user would get a timeout instead of a sentence naming the count. The
		// health read writes nothing and its cost does not grow with the vault.
		const reading = await health();
		const count = reading?.data?.semantic_catalog?.active_memories ?? null;
		if (typeof count === 'number' && count > ceiling) {
			const refusal = new Error(
				`This vault holds ${count.toLocaleString('en')} memories. This version loads the whole ` +
					`vault into one payload and does not handle a vault that size well, so it did not ` +
					`try. Nothing was read, written or changed.`,
			);
			refusal.kind = 'vault-too-large';
			refusal.memory_count = count;
			refusal.ceiling = ceiling;
			throw refusal;
		}

		const listing = await load();
		return {
			listing,
			index: buildIndex(listing),
			fetched_at: listing.fetched_at,
			// The engine's own commit position at the moment of the export, so a later health read
			// can tell the app the vault has moved WITHOUT re-exporting anything.
			commit_position: reading?.data?.commit_position ?? null,
			loaded_ms: Math.round(performance.now() - startedAt),
		};
	}

	return {
		/**
		 * The cached snapshot, loading it if this is the first read or a refresh was asked for.
		 *
		 * Single-flighted: concurrent callers share one child process rather than starting several
		 * whole-vault exports against the same vault at the same time.
		 */
		async read({ refresh = false } = {}) {
			if (snapshot && !refresh) return snapshot;
			if (inFlight) return inFlight;

			inFlight = fetchOnce()
				.then((next) => {
					snapshot = next;
					return next;
				})
				.finally(() => {
					inFlight = null;
				});

			return inFlight;
		},

		/** Drop the snapshot without fetching. The next read pays for the reload. */
		invalidate() {
			snapshot = null;
		},

		/** What the cache holds, for the app's own footer. Never triggers a load. */
		status() {
			return {
				loaded: snapshot !== null,
				loading: inFlight !== null,
				fetched_at: snapshot?.fetched_at ?? null,
				memory_count: snapshot?.listing?.memory_count ?? null,
				commit_position: snapshot?.commit_position ?? null,
				loaded_ms: snapshot?.loaded_ms ?? null,
				ceiling,
			};
		},
	};
}
