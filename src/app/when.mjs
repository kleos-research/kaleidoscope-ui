/**
 * WHEN SOMETHING WAS WRITTEN, IN THE WORDS THE MOCKUPS USE.
 *
 * "written today". "6 weeks ago". Four approved screens put a date beside a memory and none of them
 * prints a timestamp: a reader recognises "3 days ago" and has to decode "2026-08-29", and the
 * decoding is the whole of what they were doing with the number.
 *
 * IT IS ONE MODULE BECAUSE THE PHRASE HAS TO BE ONE PHRASE. The previous design spelled the same
 * date four ways on four screens, which is the class of inconsistency the owner could see without
 * being able to name — so the reading view, the list, the preview and a link card all say it from
 * here.
 *
 * THE EXACT VALUE IS NEVER THROWN AWAY. `exact()` returns the record's own string, unreformatted,
 * for the places that need to be checkable — the history row, a title attribute. A relative phrase
 * is for recognising; the stored value is for comparing, and the two are not interchangeable.
 *
 * A DATE THIS FUNCTION CANNOT PARSE COMES BACK AS `null`, never as "unknown" or an empty string.
 * The caller renders `NotRecorded`, which is the app's one wording for an absent value.
 */

/** Where the buckets change. Days, because everything above a week is derived from them. */
const DAY = 86_400_000;

/**
 * The written date as a phrase, or `null` when there is no date to say anything about.
 *
 * A FUTURE DATE FALLS BACK TO THE STORED VALUE rather than being rounded down to "today". Vault
 * content is written by other people's agents and a clock ahead of this one is ordinary; "today"
 * for a date that has not happened is a small, silent lie, and the stored string is never one.
 *
 * @param {string|null|undefined} value  an ISO date or timestamp from the record
 * @param {number} now                   injectable so the buckets can be tested
 * @returns {string|null}
 */
export function ago(value, now = Date.now()) {
	const at = parse(value);
	if (at === null) return null;

	const elapsed = now - at;
	// More than a few minutes ahead of this machine. Under that, clock skew, which is not news.
	if (elapsed < -300_000) return exact(value);

	const days = Math.floor(Math.max(elapsed, 0) / DAY);
	if (days < 1) return 'today';
	if (days < 2) return 'yesterday';
	if (days < 7) return `${days} days ago`;

	const weeks = Math.floor(days / 7);
	if (weeks < 6) return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;

	const months = Math.floor(days / 30);
	if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`;

	const years = Math.floor(days / 365);
	return years === 1 ? 'a year ago' : `${years} years ago`;
}

/**
 * "written today", "written 6 weeks ago" — the form the memory's own page and its preview use.
 *
 * The verb is part of the phrase because the date on a memory is not the date of what it is about.
 * A memory written yesterday can be about a decision from March, and a bare "yesterday" beside a
 * title is read as the second thing. See the reading view's history row, which keeps all of them
 * apart under their own names.
 */
export function written(value, now = Date.now()) {
	const phrase = ago(value, now);
	return phrase === null ? null : `written ${phrase}`;
}

/** The stored value, exactly as the record spells it. Never reformatted, never localised. */
export function exact(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Milliseconds, or `null` for anything this cannot read as a date. */
function parse(value) {
	const text = exact(value);
	if (text === null) return null;
	const at = Date.parse(text);
	return Number.isNaN(at) ? null : at;
}
