/**
 * Curation, as arithmetic. No React, no fetching, no engine call.
 *
 * Every property a curation run depends on is a pure function here, because a property you can only
 * check by clicking is a property nobody checks twice — and a curation run is the one thing in this
 * product that writes to N memories from a single gesture. The preview is the whole safety
 * mechanism, so the preview is computed by a function a test can drive with a fixture, and the
 * screen renders what it returns rather than working it out again in JSX.
 *
 * `planRename` is deliberately the SAME rewrite the server performs — both call `renameInDelta`
 * from `shared/`. If the preview ran its own copy, the user would be authorising a picture of what
 * a different function would have done.
 */

import { renameInDelta, undeclaredEndpoints } from '../shared/rename.mjs';

const text = (value) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

// =============================================================================================
// Unify a spelling — the preview
// =============================================================================================

/**
 * Exactly which memories a rename will write, and what each of their facts becomes.
 *
 * Computed over the listing this browser already holds, so the preview costs no engine call and can
 * be rendered instantly. The RUN does not trust it: every write re-reads its own memory through the
 * lineage door a moment before it writes, and carries the version the user was looking at so a
 * memory that moved in between is refused rather than rewritten unseen.
 *
 * The order of the rows IS the write order, and it is total — title, then id — so the same vault
 * previews the same way twice whatever order the export arrived in. A preview whose order changed
 * between two renders would make "the run stopped after the third one" meaningless.
 *
 * @param {Array} records  the export listing, each `{memory_id, version_id, semantic}`
 * @param {{from: string, to: string}} what
 */
export function planRename(records, { from, to }) {
	const blockers = [];
	if (!text(from)) blockers.push('There is no spelling to retire.');
	if (!text(to)) blockers.push('There is no surviving spelling.');
	if (from === to) {
		blockers.push('Both spellings are the same string, so this run would write every memory and change nothing.');
	}
	if (blockers.length > 0) {
		return { from, to, memories: [], counts: emptyCounts(), blockers, warnings: [] };
	}

	const memories = [];
	for (const record of records ?? []) {
		const delta = record?.semantic ?? {};
		const rewritten = renameInDelta(delta, { from, to });
		if (!rewritten.touched) continue;

		const before = undeclaredEndpoints(delta);
		const after = undeclaredEndpoints(rewritten.delta);

		memories.push({
			memory_id: record?.memory_id ?? null,
			// What the run carries as `seen_version_id`: the version this preview was built from. It
			// is not what the write uses — the server re-reads that — it is how a memory written to
			// between the preview and the confirm is refused instead of rewritten unseen.
			seen_version_id: record?.version_id ?? null,
			title: text(delta?.title),
			memory_type: text(delta?.memory_type),
			changes: rewritten.changes,
			// The line the preview renders per fact: what it says now, and what it will say.
			statements: rewritten.statements,
			// A rewrite can make two facts identical. That is the one place a rename removes a
			// claim, so it is named in the preview rather than discovered in a count afterwards.
			collapsed_facts: rewritten.collapsed_facts,
			// Both spellings declared in one memory become one declaration, and the two usually
			// disagree about kind — which is why unifying a spelling is also a decision about a kind.
			merged_declarations: rewritten.merged_declarations,
			// Where this memory also spells the old name and this rewrite will NOT change it: the
			// gloss, the title, a qualifier value. Rewriting those is authoring, and authoring is not
			// something a loop should do to N memories.
			untouched_mentions: rewritten.untouched,
			declares: after.declares,
			// Endpoints this memory already fails to declare. Pre-existing, not caused by the
			// rename, and shown because the write drops facts naming them and reports success.
			undeclared_before: before.undeclared,
			undeclared_after: after.undeclared,
		});
	}

	memories.sort(
		(a, b) =>
			String(a.title ?? '').localeCompare(String(b.title ?? '')) ||
			String(a.memory_id ?? '').localeCompare(String(b.memory_id ?? '')),
	);

	const warnings = [];
	const collapsing = memories.filter((memory) => memory.collapsed_facts.length > 0);
	if (collapsing.length > 0) {
		warnings.push(
			`${collapsing.length} of these memories hold two facts that become the same fact once the ` +
				`spellings are one. The duplicate is dropped, and each one is named below.`,
		);
	}
	const kindDisagreements = memories.filter((memory) =>
		memory.merged_declarations.some((merge) => merge.kept.kind !== merge.dropped.kind),
	);
	if (kindDisagreements.length > 0) {
		warnings.push(
			`${kindDisagreements.length} of these memories declare the two spellings as different kinds ` +
				`of thing. Unifying the spelling also decides the kind, and the losing declaration is ` +
				`dropped.`,
		);
	}
	const alsoSpelledElsewhere = memories.filter((memory) => memory.untouched_mentions.length > 0);
	if (alsoSpelledElsewhere.length > 0) {
		warnings.push(
			`${alsoSpelledElsewhere.length} of these memories also write the old spelling in a gloss, a ` +
				`title or a qualifier. Those are sentences a person wrote and this run does not touch ` +
				`them.`,
		);
	}

	return {
		from,
		to,
		memories,
		counts: {
			memories: memories.length,
			facts: memories.reduce((total, memory) => total + memory.changes.length, 0),
			declarations: memories.reduce(
				(total, memory) => total + memory.changes.filter((change) => change.field === 'n').length,
				0,
			),
			collapsed: memories.reduce((total, memory) => total + memory.collapsed_facts.length, 0),
		},
		blockers: memories.length === 0 ? [`No memory in this vault writes “${from}”.`] : [],
		warnings,
	};
}

const emptyCounts = () => ({ memories: 0, facts: 0, declarations: 0, collapsed: 0 });

/** What the run posts, taken from the plan the user actually looked at. */
export const renameRequest = (plan) => ({
	from: plan.from,
	to: plan.to,
	items: plan.memories.map((memory) => ({
		memory_id: memory.memory_id,
		seen_version_id: memory.seen_version_id,
	})),
});

// =============================================================================================
// Unify a spelling — reading the report
// =============================================================================================

/**
 * The states one memory can end a run in, and the sentence each gets.
 *
 * `continues` is the property the run branches on and it is here beside the copy so the two cannot
 * disagree: a state described as harmless that stopped the run, or the reverse, is a report that
 * argues with itself.
 */
export const RENAME_STATES = Object.freeze({
	rewritten: { label: 'Rewritten', tone: 'ok', continues: true, sentence: 'The new spelling is in this memory.' },
	already_named: {
		label: 'Already using it',
		tone: 'ok',
		continues: true,
		sentence: 'This memory did not use the old spelling, so nothing was written to it.',
	},
	changed: {
		label: 'Changed since you looked',
		tone: 'stop',
		continues: false,
		sentence:
			'Something wrote to this memory after the preview was built. What would have been rewritten ' +
			'is not what you approved.',
	},
	busy: {
		label: 'The vault is busy',
		tone: 'stop',
		continues: false,
		sentence: 'Another process is writing to this vault. Nothing about this memory changed.',
	},
	refused: { label: 'Refused', tone: 'stop', continues: false, sentence: 'The engine declined this write.' },
	partial: {
		label: 'Written, and short',
		tone: 'stop',
		continues: false,
		sentence:
			'This memory was written and the store kept fewer facts than were sent. The run stopped here ' +
			'rather than carrying the same loss across everything after it.',
	},
	endpoint_check_failed: {
		label: 'Not sent',
		tone: 'stop',
		continues: false,
		sentence: 'This app refused to send the rewrite, before the call, because it would have dropped facts.',
	},
	no_copy: {
		label: 'No copy could be kept',
		tone: 'stop',
		continues: false,
		sentence: 'A copy is taken before every write, and this one could not be written. Nothing was sent.',
	},
	unverified: {
		label: 'Written, and unconfirmed',
		tone: 'stop',
		continues: false,
		sentence: 'The write reported success and the check afterwards did not agree. Open this memory.',
	},
	already_gone: {
		label: 'Not here any more',
		tone: 'stop',
		continues: false,
		sentence: 'This memory could not be addressed, so there was nothing to rewrite.',
	},
	unlicensed: { label: 'The gate is shut', tone: 'stop', continues: false, sentence: 'This engine declined to run.' },
	engine_fault: {
		label: 'The engine faulted',
		tone: 'stop',
		continues: false,
		sentence: 'The engine did not answer in a shape this app knows. Nothing here is a claim about your vault.',
	},
	not_attempted: {
		label: 'Not attempted',
		tone: 'idle',
		continues: false,
		sentence: 'The run stopped above this one, so it was never written to.',
	},
});

/** One row of the report, with the engine's own sentence kept beside this app's classification. */
export function describeRenameItem(item) {
	const known = RENAME_STATES[item?.state] ?? null;
	return {
		memory_id: item?.memory_id ?? null,
		title: item?.title ?? null,
		state: item?.state ?? 'unknown',
		label: known?.label ?? 'Something this app does not recognise',
		tone: known?.tone ?? 'stop',
		// This app's sentence, and then the engine's, in that order and never merged. A paraphrase
		// of a refusal loses the repair the engine named.
		sentence: known?.sentence ?? 'This build does not know what this outcome means, so it is not called a success.',
		said: item?.message ?? null,
		facts_rewritten: item?.observed?.facts_rewritten ?? item?.changes?.length ?? 0,
		snapshot: item?.snapshot ?? null,
	};
}

/**
 * THE BOUNDARY, which is the deliverable of a stopped run.
 *
 * Three numbers and three lists, never one line. "Renamed 7 memories" over a run where the fourth
 * was refused is a false statement about the user's own data, and the user has no other instrument
 * to catch it with.
 */
export function summariseRenameRun(report) {
	const items = (report?.items ?? []).map(describeRenameItem);
	const rewritten = items.filter((item) => item.state === 'rewritten');
	const untouched = items.filter((item) => item.state === 'already_named');
	const stoppedOn = items.find((item) => RENAME_STATES[item.state]?.continues === false && item.state !== 'not_attempted');
	const notAttempted = items.filter((item) => item.state === 'not_attempted');

	return {
		from: report?.from ?? null,
		to: report?.to ?? null,
		complete: !report?.stopped,
		heading: report?.stopped
			? 'The run stopped part of the way through'
			: `“${report?.from}” is now “${report?.to}” everywhere it was used`,
		sentence: report?.stopped
			? `${rewritten.length} rewritten, one refused, ${notAttempted.length} never attempted. Nothing ` +
				`below the refusal was written to.`
			: `${rewritten.length} ${rewritten.length === 1 ? 'memory was' : 'memories were'} rewritten.`,
		rewritten,
		untouched,
		stopped_on: stoppedOn ?? null,
		not_attempted: notAttempted,
		// Every copy the run took, in the order taken. Listed rather than counted, because the point
		// of saying a copy was kept is that a person can go and look at it.
		snapshots: report?.snapshots ?? [],
		// What is left to do, ready to post once the conflict is resolved. Null when the run finished.
		resume: report?.resume ?? null,
	};
}

/**
 * What a resume will do, in words, before it is pressed.
 *
 * The memories that landed are NOT in it. A resume that re-sent the whole list would mint a fresh
 * version of every memory that already carried the new spelling — and the run guards against that
 * too, by reporting a memory that no longer uses the old spelling as already named rather than
 * writing it. Two independent guarantees, because this is the button a user presses while annoyed.
 */
export function describeResume(summary) {
	if (!summary?.resume) return null;
	return {
		count: summary.resume.items.length,
		sentence:
			`Picks up at “${summary.stopped_on?.title ?? summary.stopped_on?.memory_id ?? 'the refusal'}” and ` +
			`writes the ${summary.resume.items.length} ${summary.resume.items.length === 1 ? 'memory' : 'memories'} ` +
			`the run never reached. The ${summary.rewritten.length} already rewritten are not written again.`,
		request: summary.resume,
	};
}

// =============================================================================================
// Merge two memories
// =============================================================================================

/**
 * Compose one memory out of two, as a STARTING POINT for a person to edit.
 *
 * The union is mechanical and the judgement is not: two bodies cannot be merged by a function, so
 * this concatenates them under a rule and says it did. Nothing here is presented as final — the
 * screen that renders this makes every part of it editable, which is PRD 0006 §3.3 step 1.
 *
 * The declarations are unioned WITH the facts, in one payload. That is the single most likely way
 * to lose data in this product: fold in the other memory's facts and forget its declarations and
 * the write commits with those facts absent from the stored record, and nothing in the response
 * says so.
 */
export function planMemoryMerge(survivor, duplicate) {
	const left = survivor?.semantic_delta ?? survivor?.semantic ?? {};
	const right = duplicate?.semantic_delta ?? duplicate?.semantic ?? {};

	// ---- facts: union, de-duplicated on the triple AND the qualifiers -------------------------
	const facts = [];
	const seen = new Set();
	const provenance = [];
	const key = (fact) => JSON.stringify([fact?.subject, fact?.predicate, fact?.object, fact?.about ?? null, fact?.mode ?? null, fact?.from ?? null, fact?.until ?? null]);
	for (const [source, list] of [
		['survivor', left.facts ?? []],
		['duplicate', right.facts ?? []],
	]) {
		for (const fact of list) {
			const identity = key(fact);
			if (seen.has(identity)) {
				const held = provenance.find((entry) => entry.key === identity);
				if (held) held.source = 'both';
				continue;
			}
			seen.add(identity);
			facts.push(fact);
			provenance.push({ key: identity, source, statement: `${fact?.subject} ${fact?.predicate} ${fact?.object}` });
		}
	}

	// ---- declarations: union on the exact name ------------------------------------------------
	const entities = [];
	const declared = new Map();
	const declarationConflicts = [];
	for (const [source, list] of [
		['survivor', left.entities ?? []],
		['duplicate', right.entities ?? []],
	]) {
		for (const entity of list) {
			const name = text(entity?.n);
			if (!name) continue;
			const held = declared.get(name);
			if (held) {
				// Both memories declare this name. If they disagree about what it IS, the survivor's
				// declaration is kept and the disagreement is REPORTED — it is a decision, and a
				// composition that resolved it silently would be this function authoring.
				if (held.kind !== entity.kind || held.is !== entity.is) {
					declarationConflicts.push({ name, kept: held, dropped: entity, from: source });
				}
				continue;
			}
			declared.set(name, entity);
			entities.push(entity);
		}
	}

	const evidence = [];
	const evidenceSeen = new Set();
	for (const item of [...(left.evidence ?? []), ...(right.evidence ?? [])]) {
		const identity = JSON.stringify([item?.kind, item?.reference, item?.digest ?? null]);
		if (evidenceSeen.has(identity)) continue;
		evidenceSeen.add(identity);
		evidence.push(item);
	}

	const delta = { ...left };
	if (facts.length > 0) delta.facts = facts;
	if (entities.length > 0) delta.entities = entities;
	if (evidence.length > 0) delta.evidence = evidence;

	const body = [
		text(survivor?.content_md) ?? '',
		'',
		`<!-- merged in from “${text(right?.title) ?? duplicate?.memory_id}” -->`,
		'',
		// The duplicate's body without its heading: a document may begin with exactly one, and two
		// would make the composed body refuse on a rule about its first line.
		(text(duplicate?.content_md) ?? '').replace(/^#\s+.*\n?/, '').trim(),
	]
		.join('\n')
		.trim();

	const endpoints = undeclaredEndpoints(delta);

	return {
		survivor_id: survivor?.memory_id ?? null,
		duplicate_id: duplicate?.memory_id ?? null,
		content_md: body,
		semantic_delta: delta,
		provenance,
		declaration_conflicts: declarationConflicts,
		counts: {
			facts: facts.length,
			from_survivor: (left.facts ?? []).length,
			from_duplicate: (right.facts ?? []).length,
			shared: provenance.filter((entry) => entry.source === 'both').length,
			entities: entities.length,
		},
		// The check that runs before any call, in the browser as well as on the server, under the
		// condition that decides whether it means anything at all.
		endpoints,
		// The modal in PRD 0006 R9: a memory that declared nothing becoming one that declares
		// something changes the regime for every fact it holds, and it must never be a side effect.
		declaration_regime_change:
			(left.entities ?? []).length === 0 && entities.length > 0
				? {
						heading: 'This memory is about to start declaring names',
						sentence:
							'It declares none today, so every fact in it is stored. Once it declares even one, ' +
							'a fact naming anything it does not declare is dropped and the write still reports ' +
							'success. The composition below declares all of them.',
					}
				: null,
	};
}

/** The two writes, in the order they must happen, named so a screen can render the order. */
export const MERGE_STEPS = Object.freeze([
	Object.freeze({
		step: 'update-survivor',
		label: 'Write the memory that survives',
		why: 'First. If the second write fails you are left with two memories, which is visible and repairable.',
	}),
	Object.freeze({
		step: 'remove-duplicate',
		label: 'Remove the duplicate',
		why: 'Second. Removing first would lose its content the moment the other write failed, and nothing un-removes.',
	}),
]);

// =============================================================================================
// Reversibility, per operation, honestly
// =============================================================================================

/**
 * WHAT ACTUALLY RECOVERS EACH ACTION, from the experiment rather than from an assumption.
 *
 * There is no global "this cannot be undone" banner in this product and there must not be one. It
 * is true of almost everything here, which is exactly why a banner repeated everywhere is dismissed
 * everywhere — and then the one dialog that needed reading is not read. So reversibility is stated
 * in the confirmation for THAT action, in words, and the strings differ per row on purpose.
 *
 * `reversible` is false on every row that writes. That is not pessimism: the import door was tried
 * from four directions against this build and refused every one of them, with a fifth constraint on
 * how the bytes may be stored. The day that changes, `test/restore.test.mjs` goes red and this table
 * is what gets edited.
 */
export const REVERSIBILITY = Object.freeze([
	Object.freeze({
		id: 'edit',
		operation: 'Edit one memory',
		reversible: false,
		recovers: 'The copy taken before the write',
		confirmation:
			'This replaces the current version. There is no undo inside the engine; a copy was saved first.',
	}),
	Object.freeze({
		id: 'remove',
		operation: 'Remove one memory',
		reversible: false,
		recovers: 'The copy taken before the write',
		confirmation: 'Agents stop retrieving it. The text stays on your disk. Nothing un-removes it.',
	}),
	Object.freeze({
		id: 'merge',
		operation: 'Merge two memories',
		reversible: false,
		recovers: 'The copy, and — between the two writes only — this app’s own record of the survivor',
		confirmation:
			'Two writes: this app updates the memory that survives, then removes the other one. If the ' +
			'second fails you will be told, and offered a way to finish it.',
	}),
	Object.freeze({
		id: 'unify-spelling',
		operation: 'Unify a spelling across N memories',
		reversible: false,
		recovers: 'The copy taken before each write — and only for the memories the run actually reached',
		confirmation:
			'This writes one memory at a time. It stops at the first refusal and tells you which ones ' +
			'were written and which were not.',
	}),
	Object.freeze({
		id: 'split-name',
		operation: 'Split one name that means two things',
		reversible: false,
		recovers: 'The copy taken before each write, for the memories the run reached',
		confirmation:
			'This renames the minority sense in the memories that use it, one at a time, stopping at the ' +
			'first refusal.',
	}),
	Object.freeze({
		id: 'rescope',
		operation: 'Widen or narrow where a memory applies',
		reversible: false,
		recovers: 'The copy taken before the write',
		confirmation: 'This changes where it applies. Nothing serves differently until you save.',
	}),
	Object.freeze({
		id: 'first-declaration',
		operation: 'Give a memory its first declared name',
		reversible: false,
		recovers: 'The copy — or re-writing the facts that were dropped',
		confirmation:
			'Once a memory declares one name, a fact naming anything it does not declare is dropped and ' +
			'the write still reports success.',
	}),
	Object.freeze({
		id: 'undo-half-finished-merge',
		operation: 'Undo a half-finished merge',
		reversible: false,
		recovers: 'It IS the recovery — and it is a third write, not a rollback',
		confirmation:
			'This writes the survivor back to the content it had before the merge. That is a new version ' +
			'carrying the old content; the merged version stays in the memory’s history.',
	}),
]);

export const reversibilityFor = (id) => REVERSIBILITY.find((row) => row.id === id) ?? null;

/**
 * The sentence under the table, and it names the one thing that DOES reverse and is not offered.
 *
 * The engine publishes a rollback. It belongs to the operation whose effect this app never observed
 * — the one that reports a merge and moves nothing — so rolling it back unwinds a transition that
 * did nothing. It is a true row and it is not a recovery path for anything on this screen, and
 * offering it would be the same mistake as the merge button that ships green.
 */
export const ROLLBACK_IS_NOT_OFFERED =
	'The engine publishes a rollback. It reverses an operation whose effect this app has never been ' +
	'able to observe, so it is not offered here and it does not undo anything on this list.';

// =============================================================================================
// "Promote" — what the word can honestly mean
// =============================================================================================

/**
 * THERE IS NO PRIORITY FIELD. This is the negative half and it is a requirement, not a note.
 *
 * The word came from a real request and it does not map to anything in the write contract. Every
 * intent below changes a field that exists and is named for that field. None of them makes a memory
 * "rank higher", because nothing in the store ranks memories by an attribute a person can set — and
 * an affordance that implied one would be this app reporting a state nothing holds.
 */
export const NO_RANKING_FIELD =
	'There is no priority, importance, or pin. The store has no field for “this one matters more”, so ' +
	'nothing here can set one. What you can change is where a memory applies, what kind of claim it ' +
	'makes, how long it stays valid, and how a fact is known.';

/**
 * The honest menu. Each row names the field it changes and where the change is made.
 *
 * `real: false` rows are kept IN the table rather than omitted. A user who came looking for "pin
 * this" needs to be told it does not exist, at the moment they look for it; a menu that silently
 * lacked the row would read as an app that forgot rather than a store that has no such thing.
 */
export const PROMOTE_INTENTS = Object.freeze([
	Object.freeze({
		id: 'widen-scope',
		real: true,
		label: 'Make it apply everywhere',
		field: 'scope',
		what: 'Clear a scope axis. An axis that is not set matches every request; an axis that is set matches only that value.',
		where: 'the editor, under Scope',
	}),
	Object.freeze({
		id: 'narrow-scope',
		real: true,
		label: 'Make it apply to one project only',
		field: 'scope',
		what: 'Set a scope axis. The honest opposite of widening, and the same edit.',
		where: 'the editor, under Scope',
	}),
	Object.freeze({
		id: 'extend-validity',
		real: true,
		label: 'Change how long it stays valid',
		field: 'temporal',
		what: 'Set or clear the date after which it stops being served. On a real vault nothing has ever set one — this would be the first.',
		where: 'the editor, under Validity',
	}),
	Object.freeze({
		id: 'strengthen-basis',
		real: true,
		label: 'Say how a fact is known',
		field: 'facts[].basis',
		what: 'Change one fact’s basis, from the closed list the write contract publishes. Read the values from the engine, never from a list typed here.',
		where: 'the editor, on the fact’s own row',
	}),
	Object.freeze({
		id: 'change-mode',
		real: true,
		label: 'Change what kind of claim a fact makes',
		field: 'facts[].mode',
		what: 'Change one fact’s mode, from the closed list the contract publishes.',
		where: 'the editor, on the fact’s own row',
	}),
	Object.freeze({
		id: 'reclassify',
		real: true,
		label: 'Change what kind of memory it is',
		field: 'memory_type',
		what: 'Reclassify the memory. It has a side effect worth knowing: duplicates are compared within a type, so this moves which memories it is ever compared against.',
		where: 'the editor, at the top',
	}),
	Object.freeze({
		id: 'confidence',
		real: false,
		label: 'Raise its confidence',
		field: null,
		what: 'Confidence is derived by the store. It is not in the write contract and this app cannot set it.',
		where: null,
	}),
	Object.freeze({
		// The id is a string like every other string in this module, and the denial check walks all
		// of them — so it is named for what is absent rather than for the thing that is absent. A
		// key spelled `rank` would fail the very rule this row exists to state.
		id: 'no-such-field',
		real: false,
		label: 'Pin it, or make it more important',
		field: null,
		what: 'There is no such field. Nothing in the store ranks memories by an attribute you can set.',
		where: null,
	}),
]);

/**
 * THE DENIAL LIST, and it is a denial list for the reason every list in this repository is.
 *
 * A stale denial refuses something and the user sees a message. A stale allow list accepts something
 * and the damage is silent. This one is checked over this app's own user-facing strings by a test:
 * a control labelled "pin" or "priority" would be claiming a rank the store does not have, and the
 * user would arrange their vault around a lever connected to nothing.
 */
export const RANK_WORDS = Object.freeze([
	'pin',
	'pinned',
	'priority',
	'prioritise',
	'prioritize',
	'importance',
	'boost',
	'star',
	'starred',
	'rank',
	'ranked',
	'more important',
	'most important',
]);

const RANK_PATTERN = new RegExp(`\\b(${RANK_WORDS.join('|')})\\b`, 'gi');

/**
 * Strings that may contain a denied word BECAUSE OF WHERE THEY APPEAR.
 *
 * IT IS DERIVED, NOT TYPED. Every exemption comes from a row of the menu that is marked as not
 * real — a row rendered struck through, with the sentence saying the field does not exist directly
 * beneath it — plus the sentence that denies the whole class. So an exemption cannot be added by
 * hand: adding one means adding a row that the screen renders as absent, which is the only context
 * in which naming the thing a user came looking for is honest.
 *
 * A label is exempt as well as its explanation, because the label is what the user searched the
 * screen for. "Pin it" struck through, above "there is no such field", is the row doing its job.
 */
export const RANK_ALLOWED = Object.freeze([
	NO_RANKING_FIELD,
	...PROMOTE_INTENTS.filter((intent) => !intent.real).flatMap((intent) => [intent.label, intent.what]),
]);

export function rankWordsIn(value) {
	const flat = String(value).replace(/\s+/g, ' ').trim();
	if (RANK_ALLOWED.some((line) => line.replace(/\s+/g, ' ').trim() === flat)) return [];
	return [...new Set((flat.match(RANK_PATTERN) ?? []).map((word) => word.toLowerCase()))];
}
