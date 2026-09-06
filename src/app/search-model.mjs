/*
 * THE TWO SEARCHES, AS ARITHMETIC.
 *
 * The search screen does two different things and names them differently, and this file is the half
 * of both that touches nothing:
 *
 *   "Find these words"            runs over the rows the browser already holds. No call, no write.
 *   "Ask the way your agent does" is the engine's ranked door, and everything here READS its answer.
 *
 * Nothing in this file calls the ranked door, and nothing in this file may start doing so. The rule
 * the whole screen exists under is that a ranked search happens only on an explicit press; a helper
 * that fetched in order to compute a reading would break it from underneath the button.
 *
 * THE OTHER RULE THIS FILE IS BUILT AROUND: every reading below is derived from something the engine
 * actually said, not from something that looks like it. "Nothing was dropped for size" is read off
 * the omission reasons, never off the fill of the bar — a result can sit at a third of the budget
 * and still have dropped a memory, and a sentence inferred from the bar would say the opposite with
 * total confidence.
 */

/** The engine's own answer is bytes. The drawings read "2.1 KB", "32 KB" — 1024, spelled KB. */
const KB = 1024;

const encoder = new TextEncoder();

/**
 * Bytes, as the drawings write them: "10.4 KB" and "32 KB" — one decimal, and no trailing ".0".
 *
 * The drawings carry both spellings, in the same card, two inches apart: the amount used has a
 * decimal and the ceiling does not. That is not an inconsistency to tidy up, it is a real
 * distinction — a measurement has a decimal because its precision is meaningful, and a budget is a
 * round number somebody chose. Printing "32.0 KB" implies the ceiling was measured.
 *
 * Bytes below a kilobyte are spelled in bytes rather than rounded, because a memory of two hundred
 * characters is a real thing in a vault and "0.0 KB" reads as a failure to load it.
 */
export function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return null;
	if (bytes < KB) return { value: String(Math.round(bytes)), unit: 'bytes' };
	const kb = bytes / KB;
	const value = kb < 100 ? kb.toFixed(1) : String(Math.round(kb));
	return { value: value.endsWith('.0') ? value.slice(0, -2) : value, unit: 'KB' };
}

/** The same, joined — for a meta line rather than a display number with its own unit span. */
export function bytesLabel(bytes) {
	const read = formatBytes(bytes);
	return read ? `${read.value} ${read.unit}` : null;
}

/**
 * THE INSTANT SEARCH. Every typed word must appear somewhere in the row.
 *
 * AND rather than OR, because this box is used to narrow. `toRow` already flattened each record
 * into `haystack` — title, prose, every fact triple, every entity name and kind, every piece of
 * evidence — for the list's own filter, and this reuses it rather than growing a second definition
 * of "matches" that would drift from the one the list screen uses.
 *
 * It is deliberately dumb, and the screen says so in words. It cannot find a memory that means the
 * same thing in different words. That is the OTHER button, and the whole reason there are two.
 */
export function findTheseWords(rows, query) {
	const words = String(query ?? '')
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return [];
	return rows.filter((row) => words.every((word) => row.haystack.includes(word)));
}

/**
 * WHAT THE AGENT WOULD RECEIVE, one row per served memory, in the order the engine served them.
 *
 * `hits` are the engine's own `selected_hits` and their ORDER IS THE RANK. Nothing here re-sorts,
 * re-scores or drops one: the screen's entire claim is that this is what the agent would have been
 * given, and a row removed on the way through — a stale one, a short one, one whose title is empty
 * — would make that claim false while looking like tidying.
 *
 * `rows` and `relations` are the listing the browser already holds, and they are joined in for ONE
 * reason: to say whether a later memory corrects or contradicts this one. That is not a flag on a
 * record — there is no `superseded` field anywhere in this product — it is the inversion of what
 * other memories declare, computed once by `relationIndex` for the list screen and reused here.
 * A served memory that the vault itself says has been corrected is exactly the row a person is
 * looking for on this screen, so it is drawn dimmed and named.
 */
export function rankedRows(result, { rows = [], relations = null } = {}) {
	const hits = Array.isArray(result?.selected_hits) ? result.selected_hits : [];
	const byId = new Map(rows.map((row) => [row.memory_id, row]));

	return hits.map((hit, index) => {
		const known = byId.get(hit?.memory_id) ?? null;
		const links = relations?.get(hit?.memory_id) ?? null;
		// Both directions of "a later memory disagrees with this one". They are different claims —
		// a correction replaces, a contradiction disputes — and both are reasons to dim.
		const answered = [...(links?.corrected_by ?? []), ...(links?.contradicted_by ?? [])];

		return {
			rank: index + 1,
			memory_id: hit?.memory_id ?? null,
			// The title is the memory's own, from the listing where the listing has it. The ranked
			// door serves `content_md` rather than a parsed title, and re-parsing it here would give
			// this screen a second spelling of every title in the product.
			title: known?.title ?? firstHeading(hit?.content_md) ?? null,
			memory_type: hit?.memory_type ?? known?.memory_type ?? null,
			created_on: hit?.created_on ?? known?.created_on ?? null,
			// The size of the memory's own words. NOT a share of the context total: the served text
			// carries framing per memory that the engine composes and does not attribute, so these
			// do not sum to `context_bytes` and are never presented as though they should.
			bytes: encoder.encode(String(hit?.content_md ?? '')).length,
			superseded: answered.length > 0,
			// Which memory says so, for the one line under a dimmed row. A handle that resolved to
			// nothing is not evidence of anything, so only resolved ones are carried.
			answered_by: answered
				.map((link) => ({ memory_id: link.from, title: byId.get(link.from)?.title ?? null }))
				.filter((link) => link.memory_id),
			// Whether this memory is in the listing the browser holds. A served memory that is not
			// is not an error — the listing may be scoped to a project, or capped — but it is the
			// difference between a row that opens and a row that cannot.
			in_listing: known !== null,
		};
	});
}

/** The first ATX heading in a memory's prose, used only where the listing has no title for it. */
function firstHeading(markdown) {
	const match = String(markdown ?? '').match(/^#\s+(.+)$/m);
	return match ? match[1].trim() : null;
}

/**
 * IS THIS ACTUALLY A RANKED ANSWER?
 *
 * WRITTEN BECAUSE IT ALREADY HAPPENED. The ask route returns the sidecar's standard envelope and the
 * ranked answer sits inside its `data`; the screen read the envelope itself. Every field it wanted
 * was `undefined`, every reading below turned that into a zero, and the screen rendered "your agent
 * would have been given nothing for this — room to spare, so nothing was dropped for size" over a
 * vault of 351 memories. Nothing threw. Nothing logged. The most confident screen in the product was
 * confidently describing an object it had never read.
 *
 * That is the failure this function exists to make impossible: a missing answer must not be able to
 * spell itself as an empty one. A ranked answer carries a served list AND a byte budget, so both are
 * required — `selected_hits` alone would still admit the envelope of a refusal, and a budget alone
 * would admit a listing.
 */
export function isRankedAnswer(result) {
	return (
		Array.isArray(result?.selected_hits) &&
		typeof result?.maximum_context_bytes === 'number' &&
		Number.isFinite(result.maximum_context_bytes)
	);
}

/**
 * THE BUDGET, READ HONESTLY.
 *
 * The bar is `context_bytes` over `maximum_context_bytes`, both the engine's own numbers. The
 * SENTENCE under it is not read off the bar. Whether a memory was dropped for size is a fact in the
 * omission list, and the two can disagree in the direction that matters: a served set can stop well
 * short of the ceiling and still have dropped a memory that would not have fitted whole. A sentence
 * inferred from a third-full bar would then say "nothing was dropped for size" about a result that
 * dropped something for size, confidently, on the screen whose whole promise is that it is honest
 * about what the agent got.
 *
 * `requested` is carried because the engine publishes it separately: a caller may ask for a budget
 * and be given a smaller one, and a bar drawn against the number that was asked for rather than the
 * number that applied would overstate the room by exactly the difference.
 */
/** Above this the bar reads as full, so "room to spare" beside it is a sentence nobody believes. */
const NEARLY_FULL = 0.9;

export function budgetReading(result) {
	// NO DEFAULTS FOR THE TWO THAT DEFINE THE BAR. A missing budget is not a budget of zero, and
	// `0 bytes of 0 bytes` is the sentence that let an unread answer look like an empty one.
	const used = numberOr(result?.context_bytes, null);
	const max = numberOr(result?.maximum_context_bytes, null);
	const requested = numberOr(result?.requested_maximum_context_bytes, null);
	if (used === null || max === null) {
		return { used: null, max: null, requested: null, fraction: 0, dropped_for_size: 0, sentence: null };
	}
	const dropped = droppedForSize(result);
	const fraction = max > 0 ? Math.max(0, Math.min(1, used / max)) : 0;

	let sentence;
	if (dropped === 0) {
		/*
		 * THE CLAIM IS READ OFF THE OMISSIONS; THE ADJECTIVE IN FRONT OF IT IS READ OFF THE BAR.
		 *
		 * "nothing was dropped for size" stays exactly as it was — it is the evidenced half, and the
		 * whole point of this function is that it comes from the omission list. But "Room to spare"
		 * is a claim about the BAR DRAWN BESIDE IT, and a real answer put 31.5 KB into a 32 KB budget
		 * and printed that phrase under a bar filled to the end. Both halves were true and the
		 * sentence was still wrong, which is the worst kind of copy on a screen that sells honesty.
		 */
		sentence =
			fraction >= NEARLY_FULL
				? 'Nearly all of the budget was used, and nothing was dropped for size.'
				: 'Room to spare, so nothing was dropped for size.';
	} else if (dropped === 1) {
		sentence = 'The budget filled, so one more memory was dropped for size.';
	} else {
		sentence = `The budget filled, so ${dropped} more memories were dropped for size.`;
	}

	return {
		used,
		max,
		// Only when it differs, because a note that is always on screen is a note nobody reads.
		requested: requested !== null && requested !== max ? requested : null,
		fraction,
		dropped_for_size: dropped,
		sentence,
	};
}

/**
 * The reason codes, turned into something a person reads — and the fallback that matters more.
 *
 * This is a DISPLAY GLOSS over an open set, not a list this app relies on. An unrecognised reason is
 * rendered as the engine spelled it rather than hidden or bucketed into "other": a memory that was
 * left out for a reason this build has never heard of is the single most interesting row on the
 * screen, and swallowing it would make a new engine behaviour invisible in exactly the product
 * whose promise is to show what the agent was given.
 */
const OMISSION_WORDS = {
	context_byte_budget: 'did not fit the context budget',
	no_positive_marginal_value: 'added nothing the memories above had not already said',
};

/** Whether a reason means "this was dropped for size". Anything else is dropped for a reason. */
function isSizeReason(reason) {
	return reason === 'context_byte_budget';
}

/**
 * How many memories were dropped because they did not fit — read off the omission list and nothing
 * else. It is a separate function so the two readings that need it, the budget sentence and "why
 * these", each depend only on the omissions rather than on each other's shape requirements.
 */
export function droppedForSize(result) {
	return omissionsFor(result).filter((omission) => isSizeReason(omission.reason)).length;
}

export function omissionWords(reason) {
	return OMISSION_WORDS[reason] ?? `was left out: ${String(reason ?? 'no reason given')}`;
}

function omissionsFor(result) {
	return Array.isArray(result?.omissions) ? result.omissions : [];
}

/**
 * What was left out, joined to the listing so a left-out memory can be named rather than just
 * counted. A memory id with no title beside it tells a reader nothing they can act on.
 */
export function omittedRows(result, { rows = [] } = {}) {
	const byId = new Map(rows.map((row) => [row.memory_id, row]));
	return omissionsFor(result).map((omission) => ({
		memory_id: omission?.memory_id ?? null,
		reason: omission?.reason ?? null,
		words: omissionWords(omission?.reason),
		title: byId.get(omission?.memory_id)?.title ?? null,
		in_listing: byId.has(omission?.memory_id),
	}));
}

/**
 * The caption beside "IT WOULD RECEIVE": "4 of 349 · nothing left out".
 *
 * `pool` is how many memories the question was asked across — the listing the browser holds, inside
 * the project the user is in. It is the app's number, not the engine's, and it is the honest one to
 * print here: the engine publishes no vault total on a search, and a total invented from a
 * candidate pool would be a different quantity wearing the same words.
 */
export function servedCaption(result, { pool = null } = {}) {
	const served = Array.isArray(result?.selected_hits) ? result.selected_hits.length : 0;
	const omitted = omissionsFor(result).length;
	const scale = pool === null ? `${served}` : `${served} of ${pool}`;
	if (omitted === 0) return `${scale} · nothing left out`;
	return `${scale} · ${omitted} left out`;
}

/**
 * WHY THESE, in one sentence — and the last clause is conditional for the same reason the budget
 * sentence is.
 *
 * The approved drawing reads "…then cut to fit the budget above", beside a budget card reading
 * "Room to spare, so nothing was dropped for size". Both cannot be true of one result. So the
 * clause is printed when something really was cut for size and dropped when nothing was, which
 * keeps the approved wording for the case it describes and stops the screen contradicting itself
 * two inches apart in the case it does not.
 */
export function whyThese(result) {
	const base = 'Ranked on the words, on meaning, and on how the named things connect';
	return droppedForSize(result) > 0
		? `${base} — then cut to fit the budget above.`
		: `${base}. Everything ranked highly enough fitted inside the budget.`;
}

/**
 * The controls the engine actually ran under, for the disclosure behind "Show the ranking".
 *
 * Read off `result.search`, which is the engine's echo of what it used rather than what was sent —
 * an omitted control comes back filled in with the published default, and that default is the
 * number a reader needs. Per-channel scores are NOT here because the ranked door does not publish
 * them; a screen that invented a score bar would be illustrating an algorithm rather than reporting
 * one.
 */
export function rankingControls(result) {
	const search = result?.search ?? {};
	return Object.entries(search)
		.filter(([, value]) => value !== null && value !== undefined)
		.map(([name, value]) => ({ name, value: String(value), words: controlWords(name, value) }));
}

/**
 * A control the engine echoed, as a sentence where this build knows what the name means and as
 * the engine spells it where it does not — the same rule `OMISSION_WORDS` applies to reasons.
 *
 * These are FIELD NAMES on the door's echo, which is structure rather than an open registry; the
 * VALUE is never rewritten, only put in a sentence. `candidate_pool 200 / ledger true / top_k 20`
 * as bare labels were identifiers the owner would have to ask about.
 */
const CONTROL_WORDS = {
	candidate_pool: (value) => `looked at ${Number(value).toLocaleString()} candidates`,
	top_k: (value) => `kept up to ${Number(value).toLocaleString()}`,
	ledger: (value) =>
		String(value) === 'true' ? 'recorded the read in the vault' : `did not record the read (ledger ${value})`,
};

export function controlWords(name, value) {
	const known = CONTROL_WORDS[name];
	if (known && (name !== 'candidate_pool' && name !== 'top_k' || Number.isFinite(Number(value)))) {
		return known(value);
	}
	return `${name} ${value}`;
}

function numberOr(value, fallback) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
