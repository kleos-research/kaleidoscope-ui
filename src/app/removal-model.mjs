/**
 * Removal, as arithmetic and as sentences. No React, no fetch, no engine call.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE COPY IS IN A MODULE AND NOT IN THE COMPONENTS
 * ---------------------------------------------------------------------------------------------
 *
 * Removal hides a memory from everything that reads it. It does not erase it: the text stays on
 * disk inside the vault folder, and the lineage door can still read the record. The obvious
 * implementation — a trash icon, a red button, a "Deleted" toast — ships in an afternoon, tests
 * green, and every one of those three is false.
 *
 * So the sentences ARE the deliverable here, which makes them a thing to test rather than a thing
 * to review. A string in a component is checked by looking at a screen; a string exported from a
 * module is checked by a test that runs on every commit, and `test/removal.test.mjs` walks every
 * export of this file looking for a word this product may not say.
 *
 * The same reasoning covers the arithmetic below. Which of the four states a run reports for one
 * memory, and whether a partial run is allowed to render as a success, are properties you can
 * otherwise only check by clicking — which is to say properties nobody checks twice.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE WRITTEN-DOWN LIST HERE IS A DENIAL LIST
 * ---------------------------------------------------------------------------------------------
 *
 * `FORBIDDEN_WORDS` names what the removal flow may never say. That direction is deliberate and it
 * is the same rule the reserved-relation list follows: a stale denial refuses something that has
 * since become sayable, and a person sees a failing test; a stale allow list accepts something that
 * has since become a lie, and nobody sees anything.
 *
 * ---------------------------------------------------------------------------------------------
 * AWAITING SIGN-OFF
 * ---------------------------------------------------------------------------------------------
 *
 * PRD 0004 §3.2 presents its wording as a recommendation for the product owner to sign rather than
 * as a settled decision. It is implemented here verbatim, because a paraphrase of a sentence that
 * is waiting to be signed is neither the recommendation nor an approved alternative. The three
 * properties any replacement has to keep are stated beside the sentence itself.
 */

// ---------------------------------------------------------------------------------------------
// The label, everywhere it appears
// ---------------------------------------------------------------------------------------------

/**
 * The action, in every surface: the button, the overflow menu, the bulk bar, the tooltip, the
 * accessible label, the run report and the receipt.
 *
 * It is not a euphemism, and the distinction is worth stating once. "Delete" and a trash icon are
 * pictures of incineration; they promise the bytes are gone. This promises something narrower and
 * true — the memory leaves the set of things agents can retrieve — and it leaves the product
 * somewhere to stand when the user later finds the text in their vault folder, which they can.
 */
export const REMOVE_LABEL = 'Remove from memory';

/** The same action where a row has no room for the full label. Never an icon on its own. */
export const REMOVE_LABEL_TIGHT = 'Remove…';

// ---------------------------------------------------------------------------------------------
// The load-bearing sentence
// ---------------------------------------------------------------------------------------------

/**
 * THE SENTENCE. It ships verbatim, in the dialog body, never truncated, never behind a disclosure,
 * never in a tooltip.
 *
 * Three properties make it the right one, and any replacement has to keep all three:
 *
 *   1. it states the benefit FIRST, so it does not read as a warning to be dismissed;
 *   2. it names a mechanism the user can check — on disk, in their own vault folder — rather than
 *      a euphemism. A claim the user can falsify in a file browser is the one kind of claim that
 *      earns trust when it holds;
 *   3. it attributes the absence to the engine rather than to this app, so the user does not go
 *      looking for a better tool that does not exist.
 */
export const WHAT_REMOVAL_DOES =
	'This hides it from every agent and from exports; the text itself stays on disk in your vault ' +
	'folder, because kscope has no command that erases a memory.';

/** The same sentence for a run over several memories. Pluralised, and otherwise identical. */
export const WHAT_REMOVAL_DOES_MANY =
	'This hides them from every agent and from exports; the text itself stays on disk in your vault ' +
	'folder, because kscope has no command that erases a memory.';

/**
 * What the product says about getting a memory back, and it says it because it was MEASURED.
 *
 * `docs/DECISIONS.md` records the run: the import door was tried from every direction against a
 * removed memory
 * and found it closed four ways. `test/restore.test.mjs` asserts all four, so the day the engine
 * changes this the suite goes red — and a red test is what would authorise changing this sentence,
 * rather than the sentence being softened first and a mechanism looked for afterwards.
 */
export const NO_UN_REMOVE = 'There is no un-remove.';

/**
 * The sentence a bulk run adds, and it is a design consequence rather than a caution.
 *
 * There is no batch delete. Removing twelve memories is twelve separate calls, each carrying its
 * own expected version, on a vault that agents may be writing to while the run is in flight. A
 * partial run is a normal outcome of that design, so the confirmation says so before the button is
 * pressed rather than the report explaining it afterwards.
 */
export const RUN_CAN_STOP =
	'Each one is removed separately, so this can stop partway — you will see exactly which ones ' +
	'landed.';

/** The way in to the escalation screen, from the confirmation. */
export const ESCALATION_PROMPT = 'Need it genuinely gone?';

/** The escalation screen's own name, used as its heading. */
export const ESCALATION_TITLE = 'What removal cannot do';

/**
 * The menu entry that opens it, named for the situation rather than for the screen. "What removal
 * cannot do" as a bare menu item beside "Remove" is a caveat a reader has to open to understand;
 * this is the PRD's own name for the case, and a reader who is not in it reads past it.
 */
export const ESCALATION_MENU_LABEL = 'This memory holds a secret…';

/**
 * The same way in from a confirmation, for one memory or for several. "What removal cannot do"
 * under a Remove button was a caveat about the button; this names the case a reader is in.
 */
export const escalationLink = (count) =>
	count > 1 ? 'One of these holds a secret…' : ESCALATION_MENU_LABEL;

// ---------------------------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------------------------

/**
 * What the user sees where the memory was.
 *
 * Not a toast that vanishes: a line they can read, next to the id in monospace, selectable. The id
 * is the only handle that still reaches the record — the listing door no longer returns it and the
 * export door omits it — so a receipt that dropped the id would leave the user with nothing to
 * hold.
 */
export const RECEIPT_HEADING = 'Removed.';
export const RECEIPT_SENTENCE = 'Hidden from agents and from exports. Still on disk.';

// ---------------------------------------------------------------------------------------------
// The escalation screen
// ---------------------------------------------------------------------------------------------

/**
 * The vault-destruction sentences, above the screen that renders them because everything else on
 * that screen is written around them.
 *
 * "Destroy the whole vault" is accurate here — the command below really does end every memory in
 * that vault — and accuracy is the whole rule. They are their own frozen list because the copy
 * check allows exactly these strings and nothing that merely resembles them.
 */
const DESTRUCTION_LEAD =
	'There is no purge command. The only complete answer is to destroy the whole vault and start ' +
	'again:';

const DESTRUCTION_AFTER =
	'That erases every memory you have, not just this one. We will show you the command; we will ' +
	'not run it for you.';

export const VAULT_DESTRUCTION_LINES = Object.freeze([DESTRUCTION_LEAD, DESTRUCTION_AFTER]);

/**
 * "What removal cannot do", as text, in the order it is read.
 *
 * IT IS ITS OWN SCREEN, reached from a link in the confirmation and from the memory's overflow
 * menu. Not a checkbox on the removal dialog: a checkbox would say the product has a stronger
 * removal to offer if you tick it. It does not. This is a different activity with a different
 * outcome, and the outcome is mostly "rotate the credential".
 *
 * ROTATION IS NAMED FIRST, before either removal option, because it is the only step that changes
 * the attacker's position. Everything else changes where bytes sit.
 */
export const ESCALATION = Object.freeze({
	title: ESCALATION_TITLE,

	opening:
		'Removing a memory hides it. It does not erase it. If a password, a key, or a personal ' +
		'detail was written into this vault, removal is not enough.',

	rotate:
		'If a real credential is in here, rotate it. That is the only action that actually helps, ' +
		'and it helps whatever else you decide to do.',

	/** The four steps, in order, exactly as PRD 0004 §3.3 words them. */
	steps_lead: 'Before you run it:',
	steps: Object.freeze([
		'Save a snapshot of what you want to keep',
		'Open the snapshot and remove the secret from it by hand',
		'Run the command above in your own terminal',
		'Restore the cleaned snapshot',
	]),

	/**
	 * What this app can and cannot do for step 1 — and there is no button here, on purpose.
	 *
	 * The PRD draws step 1 as a `[ Save a snapshot ]` button. This app keeps copies of the memories
	 * it changed, and it has no door that exports a whole vault, which is what that step needs. A
	 * button wired to the copies it does have would be worse than none twice over: it would not
	 * produce the artefact the step is about, and on this screen specifically it would write a fresh
	 * plaintext copy of the secret. So the folder is named and the gap is stated.
	 */
	steps_note:
		'This app keeps a copy of each memory it changes, in the folder named beside the readings. ' +
		'That is not a copy of your whole vault and this app has no button that makes one — step 1 ' +
		'is yours to take before you run the command.',

	/**
	 * The last paragraph, and it is the part most tools leave out.
	 *
	 * A secret that reached this vault almost certainly reached somewhere outside it. Saying so is
	 * what stops the screen from implying that removing one copy is remediation.
	 */
	elsewhere:
		'One more thing, and it is the part most tools leave out: a secret that reached this vault ' +
		'probably also reached an agent transcript, a log, or a terminal history outside it. ' +
		'Removing one copy is not remediation. Rotating is.',

	/**
	 * NO THIRD OPTION, said out loud rather than left to be discovered.
	 *
	 * A user who has read a page about a leaked credential and been given two options will hunt for
	 * a third. Telling them there isn't one is faster and more honest than letting them search.
	 */
	no_third_option:
		'There is no third option. This app has looked for one: the engine publishes no way to ' +
		'remove a single memory’s text, and no way to put a removed one back.',

	/**
	 * WHY THIS PATH KEEPS NO COPY, on the screen rather than as a silent difference in behaviour.
	 *
	 * Everywhere else in this product a write is preceded by a local snapshot outside the vault.
	 * Here that snapshot would be a fresh plaintext copy of exactly the secret the user is trying to
	 * be rid of, written somewhere vault destruction will never find it. The one operation whose
	 * entire purpose is that no copy exist must not create one.
	 */
	no_snapshot_here:
		'A removal started from this screen keeps no local copy of the memory. Everywhere else in ' +
		'this app a copy is written before a change, outside your vault — here that copy would be a ' +
		'fresh plaintext copy of the very thing you are trying to be rid of, in a folder that command ' +
		'will never reach.',

	/** What the ranked door left behind, which is the one thing here the user cannot act on. */
	exposure_rows:
		'One more limit, named here and nowhere else because there is nothing to do about it: ' +
		'earlier retrievals recorded the query text that found this memory, and no published ' +
		'operation reads those records back or removes one. Removing the memory does not touch them.',

	// The two allowlisted sentences, on the object the screen reads everything else from, so the
	// screen never has to know they are special.
	vault_destruction_lead: DESTRUCTION_LEAD,
	vault_destruction_after: DESTRUCTION_AFTER,
});

/**
 * The command, rendered with the vault root this session already resolved.
 *
 * THE APP PRINTS IT AND NEVER RUNS IT. Destroying a vault on a button press inside a curation tool
 * is a blast radius no confirmation dialog earns, and typing it into one's own shell is a
 * meaningful consent step. Rendering it with the resolved root rather than a placeholder is the
 * difference between a command the user copies and one they assemble — and assembling it wrong is
 * how somebody destroys the wrong vault.
 *
 * A root this app has not resolved yields `null` rather than a command with a hole in it.
 */
export function vaultDeleteCommand(root) {
	if (typeof root !== 'string' || root.trim().length === 0) return null;
	const path = root.trim();
	// Quoted only when it needs to be. A quoted path is correct either way and an unquoted one is
	// what a person expects to see, so the quotes appear exactly where a shell would need them.
	return `kscope vault-delete ${/[\s"'\\$`]/.test(path) ? JSON.stringify(path) : path}`;
}

// ---------------------------------------------------------------------------------------------
// The confirmation
// ---------------------------------------------------------------------------------------------

/**
 * Everything the confirmation says, for one memory or for many. A pure function of the selection.
 *
 * The bulk shape lists EVERY title in the selection rather than the first three and a count: the
 * user is authorising each of these, and a list they cannot see is a list they cannot check. The
 * component scrolls it; nothing here truncates it.
 *
 * @param {Array<{memory_id: string, title: string|null}>} selection
 */
export function confirmation(selection) {
	const items = Array.isArray(selection) ? selection : [];
	const many = items.length > 1;

	return {
		count: items.length,
		many,
		heading: many ? `Remove ${items.length} memories?` : 'Remove this memory?',
		// Every one of them, in the order the user selected. See the note above.
		titles: items.map((item) => item?.title ?? null),
		sentence: many ? WHAT_REMOVAL_DOES_MANY : WHAT_REMOVAL_DOES,
		// Two sentences for a run, one for a single removal. The second is a property of the design
		// rather than a warning, and it is only true of a run.
		notes: many ? [NO_UN_REMOVE, RUN_CAN_STOP] : [NO_UN_REMOVE],
		confirm: many ? `Remove ${items.length} from memory` : REMOVE_LABEL,
		cancel: 'Cancel',
		escalation_prompt: ESCALATION_PROMPT,
		escalation_title: ESCALATION_TITLE,
		escalation_link: escalationLink(items.length),
	};
}

/** The bulk action bar's label. It carries the count, because "Remove selected" hides the number. */
export const bulkBarLabel = (count) => `Remove ${count} from memory`;

// ---------------------------------------------------------------------------------------------
// The states one memory's removal can end in
// ---------------------------------------------------------------------------------------------

/**
 * Every state, with what it says and what it offers next.
 *
 * The three refusal classes PRD 0004 R8 requires are separate rows here and worded differently: a
 * moved version, vault contention, and the licence gate. None of them is reported as "removal
 * failed", because none of them is: two are retryable and one is about a key.
 *
 * `removed: true` appears on exactly one row. Every other row — including a state this build does
 * not recognise, which `describeItem` handles below — is not-removed. That asymmetry is the guard:
 * a new state added to the server without a row here renders as not-removed rather than as success.
 */
export const ITEM_STATES = Object.freeze({
	removed: Object.freeze({
		removed: true,
		label: 'Removed',
		next: null,
	}),

	changed: Object.freeze({
		removed: false,
		label: 'Not removed — this memory changed while the run was going',
		next: 'Open it, read what changed, and remove it on its own if you still want to.',
	}),

	busy: Object.freeze({
		removed: false,
		label: 'Not removed — another process is writing to this vault',
		next: 'Nothing is wrong. Wait a moment and run this again.',
	}),

	unlicensed: Object.freeze({
		removed: false,
		label: 'Not removed — this build’s licence gate refused the call',
		next: 'Activate a key and run this again. Nothing about this memory changed.',
	}),

	already_gone: Object.freeze({
		removed: false,
		label: 'Not removed by this run — it had already left the listing',
		next: 'Refresh the list; something else removed it first.',
	}),

	no_copy: Object.freeze({
		removed: false,
		label: 'Not removed — no copy could be kept first, so nothing was attempted',
		next: 'Your vault was not changed. Check the snapshot folder named in the readings.',
	}),

	// The call reported success and the follow-up read still returned a body. This is the state that
	// exists because "the call returned success" and "the memory is actually removed" are two
	// different claims, and only the second is the one a user cares about.
	unverified: Object.freeze({
		removed: false,
		label: 'Not removed — the call reported success and the memory still has a body',
		next: 'Read this memory again before changing anything else.',
	}),

	refused: Object.freeze({
		removed: false,
		label: 'Not removed — the engine declined',
		next: null,
	}),

	engine_fault: Object.freeze({
		removed: false,
		label: 'Not removed — the engine did not answer in a way this app understands',
		next: 'This is a fault to report rather than a request to correct.',
	}),

	not_attempted: Object.freeze({
		removed: false,
		label: 'Not attempted — the run stopped above this',
		next: 'Select these again to start a new run from here.',
	}),
});

/**
 * One item of a run report, as a screen reads it. A PURE FUNCTION over what the server sent.
 *
 * An unrecognised state is reported as not-removed, by name. The alternative — falling back to the
 * nearest known state — is how a build one version behind renders a refusal as a success.
 */
export function describeItem(item) {
	const state = typeof item?.state === 'string' && item.state.length > 0 ? item.state : 'unknown';
	const known = Object.hasOwn(ITEM_STATES, state) ? ITEM_STATES[state] : null;

	return {
		state,
		recognised: known !== null,
		removed: known?.removed === true,
		label: known?.label ?? `Not removed — this app does not recognise the outcome “${state}”`,
		next: known?.next ?? null,
		memory_id: item?.memory_id ?? null,
		title: item?.title ?? null,
		// The engine's own sentence, beside the label rather than instead of it. The engine's text
		// names the repair and a paraphrase of it does not.
		said: item?.message ?? null,
		// What the app observed when the answer did not match the claim: an exit code, an effect
		// value, a version that had moved. Shown rather than summarised.
		observed: item?.observed ?? null,
		snapshot: item?.snapshot ?? null,
	};
}

/**
 * The whole run, as a screen reads it.
 *
 * THE RULE THIS FUNCTION EXISTS FOR: a run that removed some and refused others never renders a
 * single success message. `tone` is `good` only when every selected memory was removed, so a screen
 * that keys its styling and its headline off this cannot report twelve removals over a run where
 * four were refused.
 */
export function summariseRun(report) {
	const items = (Array.isArray(report?.items) ? report.items : []).map(describeItem);

	const removed = items.filter((item) => item.removed);
	const not_attempted = items.filter((item) => item.state === 'not_attempted');
	const refused = items.filter((item) => !item.removed && item.state !== 'not_attempted');

	const total = items.length;
	const partial = removed.length > 0 && removed.length < total;
	const tone = total > 0 && removed.length === total ? 'good' : removed.length === 0 ? 'bad' : 'partial';

	const headline = (() => {
		if (total === 0) return 'Nothing was selected, so nothing was removed.';
		if (tone === 'good') return total === 1 ? RECEIPT_HEADING : `Removed ${total} memories.`;
		if (tone === 'bad') {
			return total === 1
				? 'This memory was not removed.'
				: 'Nothing was removed. The run stopped at the first refusal.';
		}
		return `${removed.length} of ${total} removed, and the run stopped there.`;
	})();

	return {
		items,
		total,
		removed,
		refused,
		not_attempted,
		partial,
		tone,
		headline,
		// Said under the headline of every run that removed anything, because the receipt is the one
		// place the honest half of the claim has to appear again.
		receipt: removed.length > 0 ? RECEIPT_SENTENCE : null,
	};
}

// ---------------------------------------------------------------------------------------------
// The word list — a DENIAL list, and the reason it points that way
// ---------------------------------------------------------------------------------------------

/**
 * Words the removal flow may never say.
 *
 * Each of them promises erasure, and this product cannot erase one memory. A user who reads one of
 * these and believes it will make a decision — about a leaked key, about a name that should never
 * have been written — on a promise the product cannot keep, and the damage is silent, arrives
 * later, and is found by somebody else. The opposite mistake costs a user minutes.
 *
 * There is no symmetric risk here, so there is no case for softening, and no case for leaving this
 * to review either: copy drifts and a check does not.
 */
export const FORBIDDEN_WORDS = Object.freeze([
	'permanently',
	'permanent',
	'erase',
	'erases',
	'erased',
	'wipe',
	'wipes',
	'wiped',
	'shred',
	'shreds',
	'shredded',
	'destroy',
	'destroys',
	'destroyed',
]);

/**
 * The exact strings where one of those words is allowed, and it is FOUR strings rather than one.
 *
 * PRD 0004 R1 allows a single exception — the vault-destruction sentence — and its own §3.2 and
 * §3.3 copy needs two more, which is a contradiction inside the document rather than a decision
 * this app is making on its own. The mandated sentence says *kscope has no command that erases a
 * memory*, and the escalation screen opens with *it does not erase it*. Both use the word to DENY
 * erasure, which is the opposite of the promise the rule exists to stop, and both are the sentences
 * the PRD asks for verbatim.
 *
 * So the allowlist is by exact string rather than by word or by screen, and it carries its own
 * self-test: `test/removal.test.mjs` asserts that no allowed line contains `permanently`, `wipe`
 * or `shred`. An allowlisted line can therefore never become a way to smuggle the promise back in,
 * which is the property that makes four entries as safe as one.
 */
export const ALLOWED_LINES = Object.freeze([
	WHAT_REMOVAL_DOES,
	WHAT_REMOVAL_DOES_MANY,
	...VAULT_DESTRUCTION_LINES,
	// Taken from the screen itself rather than transcribed, so an edit to the opening paragraph
	// cannot leave an allowlist entry pointing at a sentence that no longer exists.
	ESCALATION.opening,
]);

const WORD_PATTERN = new RegExp(`\\b(${FORBIDDEN_WORDS.join('|')})\\b`, 'gi');

const flatten = (value) => String(value).replace(/\s+/g, ' ').trim();

/** Whether a piece of copy is, or contains, one of the allowlisted strings. */
export const isAllowedLine = (text) => {
	const flat = flatten(text);
	return ALLOWED_LINES.some((allowed) => flat.includes(flatten(allowed)));
};

/**
 * Every forbidden word in a piece of copy, with the word it found.
 *
 * The allowlist is consulted by DEFAULT rather than behind a flag. A flag would mean every caller
 * decides whether the rule applies to it, and the caller that wants to say something it should not
 * is exactly the caller that would pass the flag.
 *
 * @param {string} text
 * @returns {string[]}  empty when the copy is clean
 */
export function forbiddenWordsIn(text) {
	if (typeof text !== 'string' || text.length === 0) return [];
	if (isAllowedLine(text)) return [];
	return [...text.matchAll(WORD_PATTERN)].map((match) => match[0].toLowerCase());
}
