/**
 * Rewriting one name into another, inside one memory's semantic delta.
 *
 * This is in `shared/` for the same reason the contract projection is: it has to run TWICE and the
 * two copies must not drift. The BROWSER runs it to build the preview — "here is what each fact
 * becomes" — and the SERVER runs it again on the record it loaded through the lineage door, a
 * moment before it writes. If the preview and the write used two implementations, the preview would
 * be a drawing of what a different function would have done, which is worse than no preview: the
 * user authorises the picture and the vault gets the other thing.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE HAZARD THIS FUNCTION EXISTS TO CLOSE
 * ---------------------------------------------------------------------------------------------
 *
 * A rename that touches the facts and forgets the declaration — or the reverse — produces a write
 * that COMMITS while dropping every fact that names the surface, when the memory declares at least
 * one name. The response says committed. Nothing in it says the facts are gone. A rename is a loop,
 * so one such bug does that across N memories and reports N successes.
 *
 * So the rewrite is ONE PASS producing ONE composed payload: `facts[].subject`, `facts[].object`
 * and `entities[].n` move together or not at all. There is no code path here that returns a delta
 * with one of the three rewritten and another not.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT MATCHES, AND WHY IT IS NOT CLEVER
 * ---------------------------------------------------------------------------------------------
 *
 * Character-exact equality, and nothing else. No case folding, no trimming, no normalisation. The
 * store's own notion of identity between two names is exact-match on the characters, which is the
 * entire reason near-duplicates exist as a finding — and a rename that matched loosely would rewrite
 * surfaces the user never saw in the preview. The near-miss clusterer nominates; this function is
 * told two exact strings by a person.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT REWRITE, AND REPORTS INSTEAD
 * ---------------------------------------------------------------------------------------------
 *
 * A surface can appear in prose, in an entity's one-line gloss, in a fact's qualifier values, and in
 * the memory's title. Rewriting those is AUTHORING — a gloss is a sentence a person wrote, and a
 * qualifier value may be a literal rather than a mention. This function leaves them exactly as they
 * are and returns them as `untouched`, so the preview can say "this memory also says the old
 * spelling here, and this rewrite will not change it" rather than leaving the user to find out.
 */

/** Trimmed, non-empty, or null. The same shape check the graph model uses on a surface. */
const text = (value) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

/**
 * A fact's identity for de-duplication: the triple AND every qualifier.
 *
 * The triple alone is not enough. Two facts with the same subject, predicate and object but
 * different validity windows, modes or `about` keys are two different claims, and collapsing them
 * because a rename made their triples equal would delete a claim the user never asked to delete.
 */
export function factIdentity(fact) {
	const qualifiers = {};
	for (const [key, value] of Object.entries(fact ?? {})) {
		if (key === 'subject' || key === 'predicate' || key === 'object') continue;
		qualifiers[key] = value;
	}
	// Sorted keys, so two facts that differ only in the order their qualifiers were written are one
	// fact. JSON of an object preserves insertion order, and insertion order here is whatever an
	// agent happened to emit.
	const ordered = Object.keys(qualifiers)
		.sort()
		.map((key) => [key, qualifiers[key]]);
	return JSON.stringify([
		text(fact?.subject),
		text(fact?.predicate),
		text(fact?.object),
		ordered,
	]);
}

/** Where else in this delta the old spelling appears, spelled exactly, that this will not rewrite. */
function untouchedMentions(delta, from) {
	const found = [];
	const look = (where, value) => {
		const string = typeof value === 'string' ? value : null;
		if (string !== null && string.includes(from)) found.push({ where, text: string });
	};

	look('title', delta?.title);
	for (const [index, entity] of (delta?.entities ?? []).entries()) {
		// The name itself IS rewritten, so only the gloss is reported here.
		look(`entities[${index}].is`, entity?.is);
	}
	for (const [index, fact] of (delta?.facts ?? []).entries()) {
		for (const [key, value] of Object.entries(fact?.about ?? {})) {
			look(`facts[${index}].about.${key}`, value);
		}
	}
	return found;
}

/**
 * Rewrite `from` to `to` across one delta's facts and declarations, in one pass.
 *
 * @param {object} delta         a semantic delta, already projected onto the write contract
 * @param {object} what
 * @param {string} what.from     the losing spelling, exactly as the facts spell it
 * @param {string} what.to       the surviving spelling
 * @returns {{
 *   delta: object,
 *   touched: boolean,
 *   changes: Array<{where: string, field: string, before: string, after: string}>,
 *   statements: Array<{before: string, after: string}>,
 *   merged_declarations: Array<object>,
 *   collapsed_facts: Array<object>,
 *   untouched: Array<{where: string, text: string}>
 * }}
 */
export function renameInDelta(delta, { from, to }) {
	if (typeof from !== 'string' || from.length === 0) throw new TypeError('a rename needs a name to rewrite');
	if (typeof to !== 'string' || to.length === 0) throw new TypeError('a rename needs a name to rewrite it to');

	const changes = [];
	const statements = [];
	const collapsed = [];
	const mergedDeclarations = [];

	// ---- the facts -----------------------------------------------------------------------------
	const seen = new Map();
	const facts = [];
	for (const [index, fact] of (delta?.facts ?? []).entries()) {
		const before = { subject: fact?.subject, object: fact?.object };
		const next = { ...fact };
		let moved = false;

		if (next.subject === from) {
			next.subject = to;
			changes.push({ where: `facts[${index}]`, field: 'subject', before: from, after: to });
			moved = true;
		}
		if (next.object === from) {
			next.object = to;
			changes.push({ where: `facts[${index}]`, field: 'object', before: from, after: to });
			moved = true;
		}

		if (moved) {
			statements.push({
				before: `${before.subject} ${fact?.predicate ?? '—'} ${before.object}`,
				after: `${next.subject} ${next.predicate ?? '—'} ${next.object}`,
			});
		}

		// A rewrite can make two facts identical. That is the ONE place a rename removes a claim, so
		// it is reported by name rather than quietly de-duplicated: the preview says which fact
		// disappears into which, and the user sees it before the call.
		const identity = factIdentity(next);
		if (seen.has(identity)) {
			collapsed.push({
				index,
				into: seen.get(identity),
				statement: `${next.subject} ${next.predicate ?? '—'} ${next.object}`,
			});
			continue;
		}
		seen.set(identity, index);
		facts.push(next);
	}

	// ---- the declarations, in the SAME composed payload -----------------------------------------
	const declaredNames = new Map();
	const entities = [];
	for (const [index, entity] of (delta?.entities ?? []).entries()) {
		const next = { ...entity };
		if (next.n === from) {
			next.n = to;
			changes.push({ where: `entities[${index}]`, field: 'n', before: from, after: to });
		}

		const held = declaredNames.get(next.n);
		if (held !== undefined) {
			// Both spellings were declared in this memory and the rename has made them one name. The
			// two declarations may disagree about kind — they usually do, which is why unifying a
			// spelling is also a decision about a kind — so the loser is REPORTED rather than
			// silently dropped, with both kinds named.
			mergedDeclarations.push({
				name: next.n,
				kept: { kind: held.kind ?? null, is: held.is ?? null },
				dropped: { kind: next.kind ?? null, is: next.is ?? null },
			});
			continue;
		}
		declaredNames.set(next.n, next);
		entities.push(next);
	}

	const composed = { ...delta };
	if (delta?.facts !== undefined) composed.facts = facts;
	if (delta?.entities !== undefined) composed.entities = entities;

	return {
		delta: composed,
		touched: changes.length > 0,
		changes,
		statements,
		merged_declarations: mergedDeclarations,
		collapsed_facts: collapsed,
		untouched: untouchedMentions(delta, from),
	};
}

/** Does this delta name that surface anywhere a rename would rewrite? The run's idempotence check. */
export function mentionsSurface(delta, surface) {
	if (typeof surface !== 'string' || surface.length === 0) return false;
	for (const fact of delta?.facts ?? []) {
		if (fact?.subject === surface || fact?.object === surface) return true;
	}
	for (const entity of delta?.entities ?? []) {
		if (entity?.n === surface) return true;
	}
	return false;
}

/**
 * Every fact endpoint this delta names that it does not also declare.
 *
 * The check runs ONLY when the memory declares at least one name. That condition is not a nicety:
 * a memory declaring nothing has every endpoint resolved another way and commits all of its facts,
 * and running this check on it would refuse, in the client, a write the engine accepts. A memory
 * declaring one name has every OTHER endpoint dropped, silently, with the write reporting success.
 * Same function, two regimes, and the regime is decided by a count.
 */
export function undeclaredEndpoints(delta) {
	const declared = new Set();
	for (const entity of delta?.entities ?? []) {
		const name = text(entity?.n);
		if (name) declared.add(name);
	}
	if (declared.size === 0) return { declares: 0, undeclared: [] };

	const missing = new Set();
	for (const fact of delta?.facts ?? []) {
		for (const endpoint of [text(fact?.subject), text(fact?.object)]) {
			if (endpoint && !declared.has(endpoint)) missing.add(endpoint);
		}
	}
	return { declares: declared.size, undeclared: [...missing].sort() };
}
