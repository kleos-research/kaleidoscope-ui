/**
 * The editor's arithmetic, with no React in it.
 *
 * Everything a save depends on being right is in this file, as pure functions over plain values, so
 * each one can be driven from a test without rendering anything. That is not a style preference:
 * the failures this editor exists to prevent are all silent, all reported as success by the door,
 * and none of them is visible on the screen the user is looking at. A property that can only be
 * checked by clicking is a property nobody checks twice.
 *
 * Four rules run through all of it.
 *
 *   - **The payload is a PROJECTION onto the write contract, never a spread of the loaded record.**
 *     A field the runtime schema does not name causes the whole call to fail to parse, before
 *     anything is written, so an editor that spread the record it loaded would break on every field
 *     the engine ever adds. Fields the editor does not expose are carried through unchanged when
 *     the record supplied them and omitted when it did not — never invented, never defaulted.
 *
 *   - **No vocabulary is written down here.** Relations, entity kinds and memory types are open,
 *     growing registries. Every list this file produces is counted out of records already in the
 *     browser or read from the contract the engine printed at launch.
 *
 *   - **A refusal is matched to a row by SURFACE STRING, never by the index it carries.** Measured:
 *     that index does not correspond to the position of the fact in the payload that was sent, so
 *     keying on it points confidently at an innocent row in the one situation where being wrong
 *     matters most.
 *
 *   - **The undeclared-endpoint check is GATED.** It runs only when the memory declares at least
 *     one named thing, because a memory that declares none is a legitimate regime that a large
 *     share of agent-written memories are in. Running it unconditionally is the difference between
 *     a guard and an outage.
 */

/**
 * The keys the editor edits itself. Everything else on a loaded delta is carried, untouched.
 *
 * These are FIELD NAMES in the write contract — structure, not an open registry of values — which
 * is why naming them here is not the transcription the vocabulary rule forbids. The values that go
 * in them are never listed anywhere in this repository.
 */
const EDITED_KEYS = ['title', 'memory_type', 'facts', 'entities', 'scope'];

/** The three fields that make a fact a statement. The rest of a row is qualifiers. */
const TRIPLE_KEYS = ['subject', 'predicate', 'object'];

let rowCounter = 0;
/** A key that is stable across a re-render and never derived from content the user is editing. */
export const newRowId = () => `row-${(rowCounter += 1)}`;

const text = (value) => (typeof value === 'string' ? value : '');
const trimmed = (value) => text(value).trim();

// ---------------------------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------------------------

/**
 * Turn a loaded record into the thing the form edits.
 *
 * `carried` is the whole point of the shape. It holds every key of the loaded delta the editor does
 * not render — the verbatim source excerpt, the evidence list, the corrections, the validity
 * window, anything the contract lists that this version has no control for — so a prose-only save
 * puts them back exactly as they arrived. They are not defaulted and not invented: a key the record
 * did not carry is absent from `carried` and therefore absent from the payload.
 */
export function bufferFromRecord(record) {
	const delta = record?.semantic_delta ?? {};

	const carried = {};
	for (const [key, value] of Object.entries(delta)) {
		if (!EDITED_KEYS.includes(key)) carried[key] = value;
	}

	return {
		title: text(delta.title),
		memory_type: text(delta.memory_type),
		scope: { ...(delta.scope ?? {}) },
		body: withoutRepeatedHeading(record?.content_md, delta.title),
		facts: (delta.facts ?? []).map((fact) => factRow(fact)),
		entities: (delta.entities ?? []).map((entity) => ({
			id: newRowId(),
			n: text(entity?.n),
			kind: text(entity?.kind),
			is: text(entity?.is),
		})),
		carried,
	};
}

/**
 * A fact row. The triple is split out because it is what the form edits; everything else on the
 * fact travels in `qualifiers`, whole, and goes back exactly as it came.
 */
function factRow(fact) {
	const qualifiers = {};
	for (const [key, value] of Object.entries(fact ?? {})) {
		if (!TRIPLE_KEYS.includes(key)) qualifiers[key] = value;
	}
	return {
		id: newRowId(),
		subject: text(fact?.subject),
		predicate: text(fact?.predicate),
		object: text(fact?.object),
		qualifiers,
	};
}

/** One empty fact row, for the create form and for the Add button. */
export const emptyFactRow = () => ({
	id: newRowId(),
	subject: '',
	predicate: '',
	object: '',
	qualifiers: {},
});

export const emptyEntityRow = (n = '') => ({ id: newRowId(), n, kind: '', is: '' });

/**
 * The create form's starting state: the same form, empty, with one fact row present and focused.
 *
 * The note is seeded with nothing rather than with a heading, because the heading is composed from
 * the title at save time and a seeded `# ` would be a heading the user has to notice and delete
 * when they retitle. See `composeBody`.
 */
export const emptyBuffer = (axes = []) => ({
	title: '',
	memory_type: '',
	scope: Object.fromEntries(axes.map((axis) => [axis, null])),
	body: '',
	facts: [emptyFactRow()],
	entities: [],
	carried: {},
});

// ---------------------------------------------------------------------------------------------
// The body, and its leading heading
// ---------------------------------------------------------------------------------------------

/** What the engine requires a body to begin with. Read off its own refusal, not invented here. */
const LEADING_HEADING = /^#\s+\S/;

/**
 * Take the heading off the words WHEN IT IS THE TITLE AGAIN, and only then.
 *
 * The editor draws the title as an H1 across the top of both panes, so a body that opens with the
 * same sentence shows it twice — once as the memory's title and once as `# ` and the same words, in
 * the pane that is supposed to hold the prose. The approved design draws paragraphs there.
 *
 * IT IS EXACT, IN BOTH DIRECTIONS, OR IT DOES NOT HAPPEN. Only the two shapes `composeBody`
 * produces are removed — `# title\n\nrest` and a heading-only `# title\n` — so putting the heading
 * back reproduces the loaded bytes character for character. A body whose heading is authored prose
 * that DIFFERS from the title is left completely alone, because in a meaningful share of real
 * memories that difference is deliberate, and an editor that quietly rewrote it would be changing
 * something the user never touched.
 */
export function withoutRepeatedHeading(body, title) {
	const words = text(body);
	const heading = trimmed(title);
	if (heading.length === 0) return words;
	if (words === `# ${heading}\n`) return '';
	const prefix = `# ${heading}\n\n`;
	return words.startsWith(prefix) ? words.slice(prefix.length) : words;
}

/**
 * Compose the body the write actually carries, and guarantee its leading heading.
 *
 * The engine refuses a body that does not begin with a Markdown H1. **The editor composes the body,
 * so it guarantees the heading and the human never meets the rule.**
 *
 *   - A body that already begins with a heading gets NOTHING prepended. No double headings.
 *   - A body that does not gets one built from the required title field. Nothing is scraped and
 *     nothing is invented — the title is a declared field the form already holds.
 *   - The heading and the title are NOT kept in sync afterwards. In a meaningful share of real
 *     memories the heading is authored prose that deliberately differs from the title; editing the
 *     title seeds a new heading and never rewrites an existing one. "They differ" is a normal state
 *     and raises no warning anywhere in this app.
 *
 * Leading blank lines are removed before the check, because the requirement is that the body
 * BEGINS with the heading and a blank first line fails it. That removes whitespace and nothing else.
 */
export function composeBody({ body, title }) {
	const withoutLeadingBlanks = text(body).replace(/^(?:[ \t]*\r?\n)+/, '');
	if (LEADING_HEADING.test(withoutLeadingBlanks)) return withoutLeadingBlanks;

	const heading = trimmed(title);
	const rest = withoutLeadingBlanks;
	if (heading.length === 0) return rest; // Save is blocked on a missing title before this matters.
	return rest.length === 0 ? `# ${heading}\n` : `# ${heading}\n\n${rest}`;
}

/** What the composed body costs against the engine's published request ceiling. */
export const bodyBytes = (value) => new TextEncoder().encode(text(value)).length;

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/** Drop the empty strings a form produces, so an untouched optional field is absent, not blank. */
function withoutBlanks(object) {
	const kept = {};
	for (const [key, value] of Object.entries(object)) {
		if (value === '' || value === undefined) continue;
		kept[key] = value;
	}
	return kept;
}

/**
 * The semantic delta a save sends, as a projection onto the contract's own field list.
 *
 * @param {object} buffer
 * @param {Record<string, object>} fields  the parsed write contract, read from the engine at launch
 * @param {(value: any, path: string, fields: any, dropped: Set<string>) => any} project
 *
 * The projection function is passed in rather than imported so this module stays free of every
 * dependency: it is the same one the sidecar uses on the way out, from `shared/contract.mjs`, and
 * the two sides project against the same runtime read.
 */
export function toSemanticDelta(buffer, fields, project) {
	const dropped = new Set();

	const facts = buffer.facts
		.filter((row) => TRIPLE_KEYS.every((key) => trimmed(row[key]).length > 0))
		.map((row) =>
			withoutBlanks({
				// The qualifiers first, so an edited triple always wins over whatever arrived on the
				// loaded fact under the same key.
				...row.qualifiers,
				subject: trimmed(row.subject),
				predicate: trimmed(row.predicate),
				object: trimmed(row.object),
			}),
		);

	const entities = buffer.entities
		.filter((row) => trimmed(row.n).length > 0)
		.map((row) => ({ n: trimmed(row.n), kind: trimmed(row.kind), is: trimmed(row.is) }));

	const scope = {};
	for (const [axis, value] of Object.entries(buffer.scope ?? {})) {
		scope[axis] = trimmed(value).length > 0 ? trimmed(value) : null;
	}

	const composed = {
		// Carried first: an editor-owned key below overwrites it, and a key the editor does not own
		// survives untouched.
		...buffer.carried,
		title: trimmed(buffer.title),
		memory_type: trimmed(buffer.memory_type),
		facts,
		// An empty declaration list is sent as an empty list rather than omitted, because "declares
		// nothing" is a REGIME and not an absence: it is the difference between every fact being
		// accepted loosely and every undeclared endpoint being dropped.
		entities,
		scope,
	};

	return { delta: project(composed, 'semantic_delta', fields, dropped), dropped: [...dropped].sort() };
}

// ---------------------------------------------------------------------------------------------
// What the form knows before it saves
// ---------------------------------------------------------------------------------------------

const statementOf = (row) =>
	`${trimmed(row.subject).toLowerCase()} ${trimmed(row.predicate).toLowerCase()} ${trimmed(row.object).toLowerCase()}`;

/**
 * Rows that state the same triple as another row.
 *
 * Flagged here rather than discovered from a receipt, because the two outcomes downstream are
 * different and neither is one the user should meet after the fact: unnumbered duplicates are
 * silently collapsed and numbered ones are refused, so "I wrote two facts and got one" and "I wrote
 * two facts and got a refusal" are the same authoring mistake with two different endings.
 */
export function duplicateFactRows(facts) {
	const seen = new Map();
	const duplicates = new Set();
	for (const row of facts) {
		if (!TRIPLE_KEYS.every((key) => trimmed(row[key]).length > 0)) continue;
		const key = statementOf(row);
		if (seen.has(key)) {
			duplicates.add(seen.get(key));
			duplicates.add(row.id);
		} else {
			seen.set(key, row.id);
		}
	}
	return duplicates;
}

/**
 * Facts the prose USED TO support and no longer does — the editor's drift warning.
 *
 * A save replaces the body and the structure together, so the two halves of one memory can be
 * edited apart with nothing in the engine noticing: a rewritten paragraph changes what the memory
 * is found by while the facts an agent reasons on still say the old thing. Adjacency is the main
 * mitigation and this is the second one.
 *
 * IT IS A DRIFT DETECTOR, NOT A COVERAGE CHECK, and the difference is the whole reason it is
 * usable. "This endpoint is nowhere in the prose" is true of a large share of perfectly good
 * memories — an agent writes three sentences and six facts, and the facts are the structured part
 * precisely because they are not spelled out in the paragraph. Flagging those would put a warning
 * on most rows of most memories, which is a warning nobody reads.
 *
 * So a row is only flagged when the endpoint was in the words THIS SESSION LOADED and is not in
 * the words now. That makes the drawn sentence — "No longer in the words" — literally true, and it
 * fires exactly when the user has just deleted the sentence a fact rests on.
 *
 * @param body          what the note says now
 * @param baselineBody  what it said when this editor opened, or after the last save
 * @returns {Map<string, string[]>} row id -> the endpoints that left, in the order they appear
 */
export function driftingFactRows({ body, baselineBody, facts }) {
	const now = text(body).toLowerCase();
	const before = text(baselineBody).toLowerCase();
	const drifted = new Map();
	if (before.length === 0) return drifted;

	for (const row of facts ?? []) {
		if (!TRIPLE_KEYS.every((key) => trimmed(row[key]).length > 0)) continue;
		const gone = [];
		for (const key of ['subject', 'object']) {
			const surface = trimmed(row[key]);
			const needle = surface.toLowerCase();
			if (needle.length === 0) continue;
			if (before.includes(needle) && !now.includes(needle)) gone.push(surface);
		}
		if (gone.length > 0) drifted.set(row.id, gone);
	}
	return drifted;
}

// ---------------------------------------------------------------------------------------------
// The validity window
// ---------------------------------------------------------------------------------------------
//
// `temporal` is one of the keys the editor CARRIES rather than owns — see `bufferFromRecord` — and
// these two functions are the one exception: the editor sets `valid_until` and nothing else in it.
// They are here rather than in the screen because the invariant they hold is the one the payload
// test asserts: a memory whose record carried no `temporal` at all must still send none, so an
// absent object stays absent until a date is actually chosen. Defaulting it to a pair of nulls
// would make every prose-only save assert a validity window the memory never had.
//
// THE VALUE IS AN RFC 3339 TIMESTAMP. Measured against the engine on a clone rather than assumed:
// `"2027-01-01"` is refused as `InvalidTimestamp` and `{t, grain}` is refused as the wrong type.
// The date control is a date, so the day is composed up to a timestamp on the way in and read back
// down to a date on the way out.

/** The end date this memory carries, as a `yyyy-mm-dd` for a date control, or null. */
export function validUntilDate(buffer) {
	const value = buffer?.carried?.temporal?.valid_until ?? null;
	if (typeof value !== 'string' || value.length === 0) return null;
	return value.slice(0, 10);
}

/**
 * Set or clear the end date.
 *
 * @param date `yyyy-mm-dd`, or null to go back to "still true".
 */
export function withValidUntil(buffer, date) {
	const temporal = buffer?.carried?.temporal ?? null;

	if (date === null) {
		// Nothing to clear, and nothing to invent: a record that carried no window still carries none.
		if (!temporal || temporal.valid_until === null || temporal.valid_until === undefined) {
			return buffer;
		}
		return { ...buffer, carried: { ...buffer.carried, temporal: { ...temporal, valid_until: null } } };
	}

	return {
		...buffer,
		carried: {
			...buffer.carried,
			temporal: {
				// `valid_from` is preserved exactly, including its absence: this control is about the
				// end of a memory's life and has no business asserting when it began.
				...(temporal ?? {}),
				valid_until: `${date}T00:00:00Z`,
			},
		},
	};
}

/** Every distinct surface this memory's facts name, in the order they first appear. */
export function mentionedSurfaces(facts) {
	const surfaces = [];
	const seen = new Set();
	for (const row of facts) {
		for (const key of ['subject', 'object']) {
			const surface = trimmed(row[key]);
			if (!surface || seen.has(surface.toLowerCase())) continue;
			seen.add(surface.toLowerCase());
			surfaces.push(surface);
		}
	}
	return surfaces;
}

/**
 * Which surfaces the memory's facts name that it does not declare — **or `null`, meaning the
 * question does not apply.**
 *
 * `null` is not zero and the screen renders them differently. Zero means the check ran and found
 * nothing; null means the memory declares nothing at all, in which case every fact commits and
 * every name is matched loosely, and flagging them would block a large share of what agents
 * legitimately write.
 */
export function undeclaredSurfaces(buffer) {
	const declared = buffer.entities
		.map((row) => trimmed(row.n).toLowerCase())
		.filter((name) => name.length > 0);
	if (declared.length === 0) return null;

	const names = new Set(declared);
	return mentionedSurfaces(buffer.facts).filter((surface) => !names.has(surface.toLowerCase()));
}

/**
 * The rows a refusal names, MATCHED BY SURFACE STRING.
 *
 * Each refusal carries the surfaces it could not resolve. It also carries an index, and that index
 * does not correspond to the position of the fact in the payload that was sent — so it is displayed
 * and never used to choose a row.
 *
 * @returns {Map<string, {surfaces: string[], reason: string|null}>} keyed by row id
 */
export function refusalsByRow(refusedFacts, facts) {
	const byRow = new Map();
	for (const refusal of refusedFacts ?? []) {
		const surfaces = (refusal?.undeclared ?? []).map((surface) => trimmed(surface).toLowerCase());
		if (surfaces.length === 0) continue;
		for (const row of facts) {
			const endpoints = [trimmed(row.subject).toLowerCase(), trimmed(row.object).toLowerCase()];
			if (!surfaces.some((surface) => endpoints.includes(surface))) continue;
			const existing = byRow.get(row.id) ?? { surfaces: [], reason: refusal?.reason ?? null };
			for (const surface of refusal.undeclared ?? []) {
				if (!existing.surfaces.includes(surface)) existing.surfaces.push(surface);
			}
			byRow.set(row.id, existing);
		}
	}
	return byRow;
}

/** Every surface any refusal named, de-duplicated, for the "declare all and re-save" action. */
export function refusedSurfaces(refusedFacts) {
	const surfaces = [];
	const seen = new Set();
	for (const refusal of refusedFacts ?? []) {
		for (const surface of refusal?.undeclared ?? []) {
			const key = trimmed(surface).toLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			surfaces.push(trimmed(surface));
		}
	}
	return surfaces;
}

/**
 * The three conditions the door refuses on, checked before the call rather than reported after it.
 *
 * Deliberately only three. Every other refusal in the product is either unreachable by construction
 * (the heading, which the editor composes) or one the engine is the authority on (the caps, whose
 * numbers this app can only learn by being refused once). A form that guessed at the rest would
 * block saves the engine would have accepted.
 */
export function saveBlockers(buffer) {
	const blockers = [];
	if (trimmed(buffer.title).length === 0) blockers.push({ field: 'title', message: 'A memory needs a title.' });
	if (trimmed(buffer.memory_type).length === 0) {
		blockers.push({ field: 'memory_type', message: 'A memory needs a type.' });
	}
	const complete = buffer.facts.filter((row) =>
		TRIPLE_KEYS.every((key) => trimmed(row[key]).length > 0),
	);
	if (complete.length === 0) {
		blockers.push({
			field: 'facts',
			message: 'A memory needs at least one fact. What does this say about what?',
		});
	}
	// The gloss is required by the door, and the form must not be gentler than the door.
	for (const row of buffer.entities) {
		if (trimmed(row.n).length === 0) continue;
		if (trimmed(row.is).length === 0) {
			blockers.push({
				field: `entity:${row.id}`,
				message: `"${trimmed(row.n)}" needs a one-line "what this is". It is what the matcher probes with.`,
			});
		}
		if (trimmed(row.kind).length === 0) {
			blockers.push({ field: `entity:${row.id}`, message: `"${trimmed(row.n)}" needs a kind.` });
		}
	}
	return blockers;
}

// ---------------------------------------------------------------------------------------------
// What this vault already holds
// ---------------------------------------------------------------------------------------------

/**
 * Every suggestion list the editor offers, counted out of the records ALREADY IN THIS BROWSER.
 *
 * NOTHING HERE ISSUES A REQUEST, and in particular nothing here reaches the ranked door. A
 * suggestion lookup wired to it would write a permanent record — storing the text it was given —
 * per keystroke, into a store nothing published reads back or removes. The cached export is exact
 * for this purpose anyway: entity identity is character identity, so a name that matches is the
 * same node and a name that does not is a different one.
 *
 * @param {Array<object>} rows  the `toRow` output the list screen already holds
 */
export function vaultVocabulary(rows) {
	const predicates = new Map();
	const kinds = new Map();
	const surfaces = new Map();
	/** name (as spelled) -> { memories, glosses: Map(gloss -> count) } */
	const names = new Map();

	const bump = (map, key) => {
		if (!key) return;
		map.set(key, (map.get(key) ?? 0) + 1);
	};

	for (const row of rows ?? []) {
		const semantic = row?.record?.semantic ?? {};
		for (const fact of semantic.facts ?? []) {
			bump(predicates, trimmed(fact?.predicate));
			bump(surfaces, trimmed(fact?.subject));
			bump(surfaces, trimmed(fact?.object));
		}
		for (const entity of semantic.entities ?? []) {
			const name = trimmed(entity?.n);
			if (!name) continue;
			bump(kinds, trimmed(entity?.kind));
			bump(surfaces, name);
			const entry = names.get(name) ?? { memories: 0, kinds: new Map(), glosses: new Map() };
			entry.memories += 1;
			bump(entry.kinds, trimmed(entity?.kind));
			bump(entry.glosses, trimmed(entity?.is));
			names.set(name, entry);
		}
	}

	const ranked = (map) =>
		[...map.entries()]
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

	return {
		predicates: ranked(predicates),
		kinds: ranked(kinds),
		surfaces: ranked(surfaces),
		names,
	};
}

/**
 * What this vault already says about a name someone is declaring.
 *
 * The gloss is what decides whether this memory's name joins an existing thing in the graph or
 * starts a second copy of it, so the most common gloss already in use is offered rather than left
 * for the user to re-invent — and how widely it is used is said out loud, because "3 other memories
 * say this" is the difference between reusing and guessing.
 *
 * A name already glossed two materially different ways is the only conflation signal available
 * anywhere in this product, and this is the one moment it can be acted on cheaply.
 */
export function knownName(vocabulary, name) {
	const entry = vocabulary?.names?.get(trimmed(name));
	if (!entry) return null;

	const glosses = [...entry.glosses.entries()]
		.filter(([gloss]) => gloss.length > 0)
		.map(([gloss, count]) => ({ gloss, count }))
		.sort((a, b) => b.count - a.count || a.gloss.localeCompare(b.gloss));
	const kinds = [...entry.kinds.entries()]
		.filter(([kind]) => kind.length > 0)
		.map(([kind, count]) => ({ kind, count }))
		.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));

	return {
		memories: entry.memories,
		glosses,
		kinds,
		// Two glosses that are not the same string, on the same name, in the same vault. Reported as
		// a signal and never acted on automatically: this app cannot tell a genuine second thing
		// from a second spelling of one thing, and the person looking at it can.
		conflicted: glosses.length > 1,
	};
}

// ---------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------

/**
 * The version the vault is on now, recovered from a refusal.
 *
 * The sidecar classifies the refusal and hands this over already parsed; this is the fallback for
 * when it could not. **If both fail the caller re-reads the memory — never discards the buffer.**
 * There is no path in this product from "we could not parse a refusal" to "we threw away what you
 * typed", and that is a stronger statement than any parse.
 */
export function currentVersionFromRefusal(body) {
	const direct = body?.write_refusal?.current_version_id;
	if (typeof direct === 'string' && direct.length > 0) return direct;
	const message = body?.refusal?.message ?? body?.error?.message ?? body?.reason ?? '';
	const match = String(message).match(/active version is\s+(\S+?)[\s.]*$/i);
	return match ? match[1] : null;
}

/** A one-line-per-field summary of two buffers, for the conflict dialog's side-by-side. */
export function compareBuffers(mine, theirs) {
	const line = (buffer) => ({
		title: trimmed(buffer.title),
		memory_type: trimmed(buffer.memory_type),
		facts: buffer.facts.filter((row) => TRIPLE_KEYS.every((key) => trimmed(row[key]))).length,
		entities: buffer.entities.filter((row) => trimmed(row.n)).length,
		body_characters: text(buffer.body).length,
	});
	const a = line(mine);
	const b = line(theirs);
	return [
		{ field: 'Title', mine: a.title, theirs: b.title, same: a.title === b.title },
		{ field: 'Type', mine: a.memory_type, theirs: b.memory_type, same: a.memory_type === b.memory_type },
		{ field: 'Facts', mine: a.facts, theirs: b.facts, same: a.facts === b.facts },
		{ field: 'Named things', mine: a.entities, theirs: b.entities, same: a.entities === b.entities },
		{
			field: 'Note',
			mine: `${a.body_characters} characters`,
			theirs: `${b.body_characters} characters`,
			same: a.body_characters === b.body_characters,
		},
	];
}
