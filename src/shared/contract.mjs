/**
 * The projection onto the write contract, in the one place both sides of the wire read it from.
 *
 * The engine refuses an unknown field on `semantic_delta` by failing DESERIALIZATION, which happens
 * before any item is written and costs the whole call. The record a read door returns carries more
 * than the write door accepts — derived values, ordering keys, the fold's own arithmetic — so a
 * round trip has to project, and it has to project against the contract read at runtime rather than
 * against a list somebody typed here once.
 *
 * This module is in `shared/` and imports nothing, because the projection has to happen twice and
 * the two copies must not drift. The BROWSER projects, so the payload it composes is a projection
 * of the buffer rather than a spread of the loaded record — that is PRD 0003 R2, and it is what
 * makes the form survive a field the engine adds later. The SERVER projects again on the way out,
 * because the browser is not the only thing that can post to it and a call lost to an unknown field
 * is a call in which nothing was written and nothing says which field did it.
 *
 * Projecting twice is not belt-and-braces theatre: each side REPORTS what it dropped, by name, from
 * what it actually dropped. A field the client expected to keep shows up in that list rather than
 * in a refusal nobody can read.
 */

/**
 * A repeated field's children are declared once; an open-key map declares a placeholder instead.
 * Meeting one of those means "any key is allowed here", so a projection stops at it rather than
 * emptying the object — a fact's qualifier map is an open registry, and a projection that pruned it
 * against the placeholder would delete every qualifier on every fact it round-tripped.
 */
export const isOpenKeyPlaceholder = (name) => name.startsWith('<');

/** The direct children of one field path — what a projection onto that object may carry. */
export function childFieldNames(fields, parent) {
	const prefix = `${parent}.`;
	return Object.keys(fields ?? {})
		.filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('.'))
		.map((path) => path.slice(prefix.length));
}

/**
 * Keep only what the write contract accepts at this path, recursively.
 *
 * @param {*} value                    the object to project
 * @param {string} path                the dotted contract path `value` sits at
 * @param {Record<string, object>} fields  the parsed contract, from the runtime read
 * @param {Set<string>} dropped        every path this call removed, for the caller to report
 */
export function projectOntoContract(value, path, fields, dropped = new Set()) {
	if (value === null || typeof value !== 'object') return value;

	if (Array.isArray(value)) {
		return value.map((item) => projectOntoContract(item, path, fields, dropped));
	}

	const accepted = childFieldNames(fields, path);
	if (accepted.length === 0 || accepted.some(isOpenKeyPlaceholder)) return value;

	const kept = {};
	for (const [key, child] of Object.entries(value)) {
		if (!accepted.includes(key)) {
			dropped.add(`${path}.${key}`);
			continue;
		}
		kept[key] = projectOntoContract(child, `${path}.${key}`, fields, dropped);
	}
	return kept;
}
