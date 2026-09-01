import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { childFieldNames, projectOntoContract } from '../shared/contract.mjs';
import { SidecarError, createMemory, fetchEditRecord, saveMemory } from './api.mjs';
import {
	bodyBytes,
	bufferFromRecord,
	compareBuffers,
	composeBody,
	currentVersionFromRefusal,
	driftingFactRows,
	duplicateFactRows,
	emptyBuffer,
	emptyEntityRow,
	emptyFactRow,
	knownName,
	mentionedSurfaces,
	refusalsByRow,
	refusedSurfaces,
	saveBlockers,
	toSemanticDelta,
	undeclaredSurfaces,
	validUntilDate,
	vaultVocabulary,
	withValidUntil,
} from './editor-model.mjs';
import { useFocusActions } from './focus-actions.mjs';
import { axisCopy } from './records.mjs';
import { deniedRelations, reservedRelationAdvice } from './reserved-relations.mjs';
import {
	Badge,
	Band,
	Button,
	Card,
	Combobox,
	DetailRow,
	DetailRows,
	Dialog,
	ErrorState,
	Eyebrow,
	Field,
	Icon,
	IconButton,
	Identifier,
	Input,
	LoadingState,
	PaneBody,
	PaneFoot,
	PaneHead,
	Prompt,
	PromptList,
	PromptNote,
	PromptSentence,
	ReadingPair,
	Readings,
	Select,
	SelectItem,
	Table,
	Td,
	Th,
	TitleInput,
	Tr,
	UnsetField,
	useToast,
} from './ui/index.mjs';

/**
 * THE ONE SCREEN IN THIS PRODUCT THAT WRITES.
 *
 * The owner's verdict on the last one was the worst in the review — "a bigger problem; too much
 * info, too much to scroll, don't know what to do about it, where to go" — and his diagnosis names
 * the fix: "Title is on the left, then a note below it. Then on the right side there's Type
 * required, Applies to, Facts — it's all of that on the right side." **Two columns were never the
 * problem. Four things per column were.**
 *
 * So this screen holds exactly three things. The title, which spans both panes because it belongs
 * to the memory rather than to a column. The words, on the left. What the agent will act on, on the
 * right. Everything else this memory has — its type, where it applies, until when, the things it
 * declares by name — is behind one **Details** control in the bar, and everything the save itself
 * does is behind one row inside that.
 *
 * WHAT DID NOT CHANGE, because each of these is a measured failure rather than a preference:
 *
 *   1. **It loads through the edit door and never from anything already in this browser.** The door
 *      that DISPLAYS a memory does not return its entity declarations, and the write requires them.
 *      An editor that round-trips the display record commits — exit 0, no refusal, no warning — with
 *      every named thing the memory declared deleted. `rows` is for SUGGESTIONS and never for a save.
 *
 *   2. **The facts are beside the words at all times.** A write replaces the body and the structure
 *      together, so a prose edit re-sends the structure unchanged and the two halves can drift apart
 *      with nothing in the engine noticing. Adjacency is the mitigation; `driftingFactRows` is the
 *      second one, and a tab or an accordion would be a hazard you can only see by navigating away.
 *
 *   3. **A save has several endings and this screen branches on all of them.** Committed, no-change,
 *      and committed-with-facts-dropped are three different sentences. "Saved" over the third is a
 *      lie about the third of the user's work that was refused.
 *
 *   4. **Nothing the user typed is discarded except by the user.** A stale version is recoverable and
 *      names the version that is now current. There is no path in this file from a refusal to an
 *      empty buffer.
 *
 *   5. **No vocabulary is written down.** Every option list is built from what the engine printed at
 *      launch, unioned with what this vault already uses. The single exception is a DENIAL list of
 *      relation names, which fails safe by refusing something that has since become permitted.
 *
 *   6. **It issues no ranked query, ever.** Suggestions are counted out of the listing already in
 *      this browser. The ranked door writes a permanent record storing the query text; wired to a
 *      suggestion list it would write one per keystroke.
 */

/** Where the note's byte counter stops being background information. */
const AMBER_AT = 0.85;


/**
 * The value a closed menu uses for "not recorded".
 *
 * A NUL prefix, for the same reason the list screen uses one: the menu's other values are an open
 * vocabulary read from the engine, and any printable sentinel could one day BE one of them. This
 * one cannot be.
 */
const UNSET = '\u0000unset';

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** A stable, order-independent signature of the structure, for "has anything but prose changed". */
function structureSignature(buffer) {
	return JSON.stringify({
		title: trimmed(buffer.title),
		memory_type: trimmed(buffer.memory_type),
		scope: buffer.scope ?? {},
		carried: buffer.carried ?? {},
		facts: buffer.facts.map((row) => [
			trimmed(row.subject),
			trimmed(row.predicate),
			trimmed(row.object),
			row.qualifiers,
		]),
		entities: buffer.entities.map((row) => [trimmed(row.n), trimmed(row.kind), trimmed(row.is)]),
	});
}

/** Values a vault already uses for one open field, most-used first, with the runtime list merged. */
function openRegistry({ fromVault, fromEngine, exclude }) {
	const merged = new Map();
	for (const { value, count } of fromVault ?? []) {
		if (!value || exclude?.has(value)) continue;
		merged.set(value, { value, count, in_schema: false });
	}
	for (const value of fromEngine ?? []) {
		if (!value || exclude?.has(value)) continue;
		const existing = merged.get(value);
		if (existing) existing.in_schema = true;
		else merged.set(value, { value, count: 0, in_schema: true });
	}
	return [...merged.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {string|null} props.memoryId  null for a create, which is this same screen, empty
 * @param {object} props.session        the launch readings; every vocabulary comes from here
 * @param {Array}  props.rows           the listing already in this browser, for SUGGESTIONS only
 */
export function MemoryEditor({ memoryId = null, session, rows, onSaved, onCancel, onOpen }) {
	const creating = memoryId === null;
	const { toast } = useToast();

	const contract = session?.vocabulary ?? null;
	const fields = contract?.fields ?? null;
	const vocabularyUsable = Boolean(fields && Object.keys(fields).length > 0);

	const [record, setRecord] = useState(null);
	const [loadError, setLoadError] = useState(null);
	const [buffer, setBuffer] = useState(null);
	const [baseline, setBaseline] = useState(null);
	const [expectedVersion, setExpectedVersion] = useState(null);

	const [saving, setSaving] = useState(false);
	const [result, setResult] = useState(null);
	const [conflict, setConflict] = useState(null);
	const [declarationPrompt, setDeclarationPrompt] = useState(null);
	const [learnedCaps, setLearnedCaps] = useState(null);
	const [details, setDetails] = useState(false);
	const [qualifiersFor, setQualifiersFor] = useState(null);
	/*
	  A CREATE DOES NOT OPEN WITH TWO WARNINGS ON IT.

	  Everything `saveBlockers` returns is true from the first frame of an empty form — it has no
	  title, no type and no fact, because nobody has typed one yet. Showing that as a refusal before
	  the user has done anything is the "information overload" the owner was looking at, and it
	  teaches people to read past warnings. The blockers still exist from the first frame: the count
	  on Details says how many are hiding behind it, and pressing Save says all of them at once.
	*/
	const [attempted, setAttempted] = useState(false);

	const axes = useMemo(() => childFieldNames(fields ?? {}, 'semantic_delta.scope').sort(), [fields]);

	// ------------------------------------------------------------------------- the load
	//
	// THE EDIT DOOR, ON EVERY OPEN. Not the cache, not the display record, and not conditionally —
	// including when a perfectly good row for this memory is already on screen behind this one.

	useEffect(() => {
		if (!vocabularyUsable) return undefined;
		if (creating) {
			const fresh = emptyBuffer(axes);
			setBuffer(fresh);
			setBaseline(fresh);
			setRecord({ creating: true });
			return undefined;
		}
		let cancelled = false;
		setRecord(null);
		setLoadError(null);
		(async () => {
			try {
				const loaded = await fetchEditRecord(memoryId);
				if (cancelled) return;
				const next = bufferFromRecord(loaded);
				setRecord(loaded);
				setBuffer(next);
				setBaseline(next);
				setExpectedVersion(loaded.expected_version_id ?? null);
			} catch (error) {
				if (!cancelled) setLoadError(error);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [memoryId, creating, vocabularyUsable, axes]);

	// ------------------------------------------------------------------------- what this vault holds

	const vault = useMemo(() => vaultVocabulary(rows), [rows]);
	const denied = useMemo(() => deniedRelations(contract?.denied), [contract]);

	const predicateOptions = useMemo(
		() =>
			openRegistry({
				fromVault: vault.predicates,
				fromEngine: contract?.known?.['semantic_delta.facts.predicate'],
				exclude: denied,
			}),
		[vault, contract, denied],
	);

	const kindOptions = useMemo(
		() =>
			openRegistry({
				fromVault: vault.kinds,
				fromEngine: contract?.known?.['semantic_delta.entities.kind'],
			}),
		[vault, contract],
	);

	const typeOptions = useMemo(() => {
		const present = new Map();
		for (const row of rows ?? []) {
			const type = trimmed(row?.memory_type);
			if (!type) continue;
			present.set(type, (present.get(type) ?? 0) + 1);
		}
		const ranked = [...present.entries()]
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
		const seen = new Set(ranked.map((entry) => entry.value));
		for (const value of contract?.declarable_memory_types ?? contract?.memory_types ?? []) {
			if (!seen.has(value)) ranked.push({ value, count: 0 });
		}
		return ranked;
	}, [rows, contract]);

	/*
	  EVERY SURFACE, NOT THE TOP SIXTY. `Combobox` ranks against what was typed and then caps the
	  panel, so handing it a pre-truncated vocabulary only hid the names a reader had to type more of
	  to reach — and offered to mint each of them as new. See the note in `combobox.jsx`.
	*/
	const surfaceOptions = vault.surfaces;
	/**
	 * What each scope axis is already set to somewhere in this vault, with how often.
	 *
	 * Counted per axis in a nested map rather than under one joined key. A project name or a path
	 * contains spaces, and a joined key that had to be split apart again truncates every one of
	 * them: offering "Payments" where the vault says "Payments platform" is an offer to write a
	 * scope that matches nothing, which is the failure this control exists to prevent.
	 */
	const scopeOptions = useMemo(() => {
		const byAxis = new Map();
		for (const row of rows ?? []) {
			for (const [axis, raw] of Object.entries(row?.scope ?? {})) {
				const value = trimmed(raw);
				if (!value) continue;
				const counts = byAxis.get(axis) ?? new Map();
				counts.set(value, (counts.get(value) ?? 0) + 1);
				byAxis.set(axis, counts);
			}
		}
		const offered = {};
		for (const [axis, counts] of byAxis) {
			offered[axis] = [...counts.entries()]
				.map(([value, count]) => ({ value, count }))
				.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
		}
		return offered;
	}, [rows]);

	// ------------------------------------------------------------------------- what the form knows

	const blockers = useMemo(() => (buffer ? saveBlockers(buffer) : []), [buffer]);
	const duplicates = useMemo(() => (buffer ? duplicateFactRows(buffer.facts) : new Set()), [buffer]);
	const undeclared = useMemo(() => (buffer ? undeclaredSurfaces(buffer) : null), [buffer]);
	const declaredCount = useMemo(
		() => (buffer ? buffer.entities.filter((row) => trimmed(row.n)).length : 0),
		[buffer],
	);

	const drifted = useMemo(
		() =>
			buffer && baseline
				? driftingFactRows({ body: buffer.body, baselineBody: baseline.body, facts: buffer.facts })
				: new Map(),
		[buffer, baseline],
	);

	const reservedRows = useMemo(() => {
		if (!buffer) return new Map();
		const hits = new Map();
		for (const row of buffer.facts) {
			const relation = trimmed(row.predicate);
			if (relation && denied.has(relation)) hits.set(row.id, relation);
		}
		return hits;
	}, [buffer, denied]);

	const composed = useMemo(
		() => (buffer ? composeBody({ body: buffer.body, title: buffer.title }) : ''),
		[buffer],
	);
	const bytes = useMemo(() => bodyBytes(composed), [composed]);
	const byteCeiling = session?.contract?.limits?.cli_request_bytes ?? null;
	const overCeiling = Boolean(byteCeiling && bytes > byteCeiling);

	const dirty = Boolean(
		buffer &&
			baseline &&
			(buffer.body !== baseline.body || structureSignature(buffer) !== structureSignature(baseline)),
	);
	const proseOnly = Boolean(
		buffer &&
			baseline &&
			buffer.body !== baseline.body &&
			structureSignature(buffer) === structureSignature(baseline),
	);

	const completeFacts = useMemo(
		() =>
			buffer
				? buffer.facts.filter(
						(row) => trimmed(row.subject) && trimmed(row.predicate) && trimmed(row.object),
					)
				: [],
		[buffer],
	);

	/**
	 * The SECOND counter, and it counts a different thing against a different limit.
	 *
	 * The caps are refusals: over one, the write is declined. This is a per-write budget for how many
	 * NEW names and NEW relations one save may mint, which the engine reports against rather than
	 * refusing. They must never share a number on screen — the consequences are not the same, and a
	 * combined counter would be amber for the wrong reason.
	 */
	const minting = useMemo(() => {
		if (!buffer) return { names: [], relations: [] };
		const names = buffer.entities
			.map((row) => trimmed(row.n))
			.filter((name) => name && !vault.names.has(name));
		const relations = [...new Set(completeFacts.map((row) => trimmed(row.predicate)))].filter(
			(relation) =>
				relation &&
				!vault.predicates.some((entry) => entry.value === relation) &&
				!(contract?.known?.['semantic_delta.facts.predicate'] ?? []).includes(relation),
		);
		return { names, relations };
	}, [buffer, vault, completeFacts, contract]);

	const refusedRows = useMemo(
		() =>
			result?.refused_facts && buffer ? refusalsByRow(result.refused_facts, buffer.facts) : new Map(),
		[result, buffer],
	);

	const factCap = learnedCaps?.facts ?? null;
	const atCap = factCap !== null && completeFacts.length >= factCap;

	/** Blockers that live behind the Details control, so the control can say that they are there. */
	const hiddenBlockers = blockers.filter((entry) => entry.field !== 'title' && entry.field !== 'facts');

	// ------------------------------------------------------------------------- buffer edits

	const patch = useCallback((change) => {
		setBuffer((current) => (current ? { ...current, ...change } : current));
	}, []);

	const patchFact = useCallback((id, change) => {
		setBuffer((current) =>
			current
				? {
						...current,
						facts: current.facts.map((row) => (row.id === id ? { ...row, ...change } : row)),
					}
				: current,
		);
	}, []);

	const patchEntity = useCallback((id, change) => {
		setBuffer((current) =>
			current
				? {
						...current,
						entities: current.entities.map((row) => (row.id === id ? { ...row, ...change } : row)),
					}
				: current,
		);
	}, []);

	const addFact = useCallback((seed = {}) => {
		setBuffer((current) =>
			current ? { ...current, facts: [...current.facts, { ...emptyFactRow(), ...seed }] } : current,
		);
	}, []);

	const removeFact = useCallback((id) => {
		setBuffer((current) =>
			current ? { ...current, facts: current.facts.filter((row) => row.id !== id) } : current,
		);
	}, []);

	/**
	 * Declaring the first named thing MOVES THE MEMORY ACROSS A SWITCH, so it is a decision and not a
	 * click. With zero declarations every fact commits and every name is matched loosely; with one or
	 * more, every name any fact mentions must be declared or THAT FACT IS DROPPED while the rest of
	 * the write commits. A user helpfully declaring one thing on a memory that declared none is the
	 * most dangerous single interaction in this product.
	 */
	const addEntity = useCallback((names) => {
		const seeds = (Array.isArray(names) ? names : [names]).filter((name) => typeof name === 'string');
		setBuffer((current) => {
			if (!current) return current;
			const existing = new Set(current.entities.map((row) => trimmed(row.n).toLowerCase()));
			const additions = (seeds.length > 0 ? seeds : ['']).filter(
				(name) => name === '' || !existing.has(name.trim().toLowerCase()),
			);
			return {
				...current,
				entities: [...current.entities, ...additions.map((name) => emptyEntityRow(name))],
			};
		});
	}, []);

	const requestEntity = useCallback(
		(seed = '') => {
			if (declaredCount === 0) {
				setDeclarationPrompt({ kind: 'first', seed, surfaces: mentionedSurfaces(buffer?.facts ?? []) });
				return;
			}
			addEntity(seed);
			setDetails(true);
		},
		[declaredCount, addEntity, buffer],
	);

	const removeEntity = useCallback(
		(id) => {
			const named = buffer?.entities.filter((row) => trimmed(row.n)) ?? [];
			const target = buffer?.entities.find((row) => row.id === id);
			if (named.length === 1 && target && trimmed(target.n)) {
				setDeclarationPrompt({ kind: 'last', id });
				return;
			}
			setBuffer((current) =>
				current ? { ...current, entities: current.entities.filter((row) => row.id !== id) } : current,
			);
		},
		[buffer],
	);

	// ------------------------------------------------------------------------- the save

	const readResponse = useCallback(
		async (body, sentBuffer, submitted) => {
			// A refusal is a COMPLETED call the engine declined. It arrives as HTTP 200 with the
			// refusal intact, so this branch is not an error path — it is one of the outcomes.
			if (body?.outcome === 'refused') {
				const classified = body.write_refusal ?? { kind: 'other' };
				const sentence = body.refusal?.message ?? body.reason ?? body.error?.message ?? null;

				if (classified.kind === 'stale_version') {
					const current = classified.current_version_id ?? currentVersionFromRefusal(body);
					// If the parse failed we RE-READ the memory for its version. There is no path from
					// "we could not read a refusal" to "we threw away what you typed".
					let theirs = null;
					let currentVersion = current;
					try {
						const reloaded = await fetchEditRecord(memoryId);
						theirs = bufferFromRecord(reloaded);
						currentVersion = reloaded.expected_version_id ?? current;
					} catch {
						theirs = null;
					}
					setConflict({ loaded: expectedVersion, current: currentVersion, theirs, sentence });
					return;
				}

				if (classified.kind === 'over_cap') setLearnedCaps(classified.caps ?? null);

				setResult({
					kind: classified.kind === 'fold_failed' ? 'fold_failed' : 'refused',
					classified,
					sentence,
					next: body.error?.next ?? body.refusal?.next ?? null,
				});
				return;
			}

			const write = body?.write ?? null;
			if (!write) {
				setResult({
					kind: 'unrecognised',
					sentence:
						'The local server answered a save with a body this build does not recognise. ' +
						'Nothing on this screen can say whether the write happened — re-open this memory ' +
						'and check before changing anything else.',
				});
				return;
			}

			if (write.verdict === 'no_change') {
				setResult({ kind: 'no_change', write });
				return;
			}

			if (write.verdict !== 'committed') {
				setResult({
					kind: 'unrecognised',
					sentence:
						`The engine reported the outcome "${write.effect ?? 'nothing at all'}", which this ` +
						`build does not know how to read. It is NOT being shown as a success. Re-open this ` +
						`memory and check what is there before changing anything else.`,
				});
				return;
			}

			// Committed. The version has moved, so a follow-up save — including a re-save from a
			// partial receipt — guards against the version this write returned, not the loaded one.
			if (write.version_id) setExpectedVersion(write.version_id);
			const savedBuffer = {
				...sentBuffer,
				body: composeBody({ body: sentBuffer.body, title: sentBuffer.title }),
			};
			setBaseline(savedBuffer);
			setBuffer((current) => (current === sentBuffer ? savedBuffer : current));

			// The independent post-condition, which does not depend on the refusal key being present:
			// a guard that can only fire when a particular key arrived is a guard that fails open.
			if (write.shortfall) {
				let reread = null;
				try {
					reread = await fetchEditRecord(write.memory_id ?? memoryId);
				} catch {
					reread = null;
				}
				setResult({ kind: 'shortfall', write, reread, submitted });
				return;
			}

			if (write.partial) {
				setResult({ kind: 'partial', write, refused_facts: write.refused_facts, submitted });
				return;
			}

			/*
			  A CLEAN COMMIT IS THE ONE OUTCOME THAT LEAVES THIS SCREEN.

			  Everything above is a state the user has to answer; this is not. Standing on the editor
			  afterwards is also the one way a create can go wrong that nothing can repair — a create
			  carries no id, so pressing Save again writes a SECOND memory rather than updating the
			  one that now exists. Landing on the memory itself answers "did that work?" with the
			  memory, which is a better answer than a sentence saying it did.
			*/
			toast({
				title: creating ? 'Written to your vault' : 'Saved',
				description:
					write.stored_claim_count === null || write.stored_claim_count === undefined
						? null
						: `${write.stored_claim_count} fact${write.stored_claim_count === 1 ? '' : 's'} stored${
								write.over_budget
									? ' · this save minted more new names and relations than one write budgets for. Nothing was refused; the engine reported it.'
									: ''
							}`,
			});
			onSaved(write.memory_id ?? memoryId);
		},
		[memoryId, expectedVersion, creating, onSaved, toast],
	);

	const performSave = useCallback(
		async ({ versionOverride = null, bufferOverride = null } = {}) => {
			const sent = bufferOverride ?? buffer;
			if (!sent) return;

			// Refused on submit, not merely excluded from a menu: a value can be pasted, and a memory
			// that authors one of these COMMITS with no graph entry at all, which nothing repairs.
			const reserved = sent.facts.find((row) => denied.has(trimmed(row.predicate)));
			if (reserved) {
				setResult({
					kind: 'reserved_relation',
					relation: trimmed(reserved.predicate),
					sentence: reservedRelationAdvice(trimmed(reserved.predicate)),
				});
				return;
			}

			setSaving(true);
			setResult(null);
			try {
				const { delta } = toSemanticDelta(sent, fields, projectOntoContract);
				const content_md = composeBody({ body: sent.body, title: sent.title });
				const submitted = delta.facts?.length ?? 0;

				const body = creating
					? await createMemory({ content_md, semantic_delta: delta })
					: await saveMemory(memoryId, {
							content_md,
							semantic_delta: delta,
							expected_version_id: versionOverride ?? expectedVersion,
						});
				await readResponse(body, sent, submitted);
			} catch (error) {
				setResult({
					kind: 'transport',
					sentence:
						error instanceof SidecarError
							? error.message
							: (error?.message ?? 'The save could not be sent.'),
				});
			} finally {
				setSaving(false);
			}
		},
		[buffer, fields, creating, memoryId, expectedVersion, denied, readResponse],
	);

	/**
	 * Save, or say what is stopping it — and open the drawer the missing thing is in.
	 *
	 * A disabled Save button on a screen whose required fields are behind a control is a button that
	 * cannot be argued with. This one always responds.
	 */
	const attemptSave = useCallback(() => {
		setAttempted(true);
		if (blockers.length > 0) {
			setResult({ kind: 'blocked', blockers });
			if (hiddenBlockers.length > 0) setDetails(true);
			return;
		}
		performSave();
	}, [blockers, hiddenBlockers.length, performSave]);

	/** Declare the surfaces a partial write refused, then re-save AGAINST THE NEW VERSION. */
	const declareAndResend = useCallback(
		(surfaces) => {
			const next = {
				...buffer,
				entities: [
					...buffer.entities,
					...surfaces
						.filter(
							(surface) =>
								!buffer.entities.some(
									(row) => trimmed(row.n).toLowerCase() === surface.trim().toLowerCase(),
								),
						)
						.map((surface) => emptyEntityRow(surface)),
				],
			};
			setBuffer(next);
			setDetails(true);
			setResult({
				kind: 'declare_then_save',
				surfaces,
				sentence:
					'Each of these now has a row under Details. Give every one a kind and a one-line ' +
					'"what this is" — the gloss is what decides whether it joins the thing already in your ' +
					'vault or starts a second copy of it — then save again.',
			});
		},
		[buffer],
	);

	/*
	  A REFUSAL THAT IS NO LONGER TRUE STOPS BEING ON SCREEN.

	  "This memory is not ready to be written" is a list of what is missing, and the user fixes it by
	  filling those things in — at which point a standing red panel is describing a state the screen
	  is no longer in. Every other outcome here is about a call that actually happened and stays
	  until it is dismissed; this one is about the form.
	*/
	useEffect(() => {
		if (result?.kind === 'blocked' && blockers.length === 0) setResult(null);
	}, [result, blockers]);

	// ------------------------------------------------------------------------- the controls in the bar
	//
	// Held in a ref so the bar is rebuilt when its BUTTONS change and not when the note does. A save
	// closure that depended on the buffer would push a new node into the shell on every keystroke.

	const saveRef = useRef(attemptSave);
	saveRef.current = attemptSave;
	const cancelRef = useRef(null);
	cancelRef.current = () => (dirty ? setResult({ kind: 'confirm_cancel' }) : onCancel());

	useFocusActions(
		() => (
			<>
				<Button onClick={() => setDetails(true)}>
					<Icon.Settings size={13} className="icon" />
					Details
					{hiddenBlockers.length > 0 ? <Badge tone="warn">{hiddenBlockers.length}</Badge> : null}
				</Button>
				<span className="topbar-divider" aria-hidden="true" />
				{/*
				  Cancel ASKS when there is something to lose. It is the only control on this screen
				  that can throw away typing, and a mis-click on it is unrecoverable in a product with
				  no undo — so it is the one place a confirmation earns its interruption.
				*/}
				<Button onClick={() => cancelRef.current()} disabled={saving}>
					Cancel
				</Button>
				<Button tone="primary" onClick={() => saveRef.current()} disabled={saving}>
					{saving ? 'Saving…' : creating ? 'Write it' : 'Save'}
				</Button>
			</>
		),
		[saving, creating, hiddenBlockers.length],
	);

	// ------------------------------------------------------------------------- refusals to render

	if (!vocabularyUsable) {
		return (
			<ErrorState
				heading="The editor cannot open without the engine's own vocabulary"
				error={{
					message:
						'Every control on this screen — the relation list, the kinds, the types, the ' +
						'qualifier values — is generated from the write contract the engine printed at ' +
						'launch, and that reading is missing or empty. Falling back to a list compiled into ' +
						'this app is exactly the failure the rule exists to prevent: it keeps looking ' +
						'correct after the engine stops accepting a value, and the records written through ' +
						'it still look like data. Nothing was read and nothing was changed.',
				}}
				action={<Button onClick={onCancel}>Back</Button>}
			/>
		);
	}

	if (loadError) {
		return (
			<ErrorState
				heading="This memory could not be opened for editing"
				error={loadError}
				action={<Button onClick={onCancel}>Back</Button>}
			/>
		);
	}

	if (!buffer) return <LoadingState what="Loading this memory the way a save needs it" />;

	const titleBlocker = attempted ? (blockers.find((entry) => entry.field === 'title') ?? null) : null;
	const factsBlocker = attempted ? (blockers.find((entry) => entry.field === 'facts') ?? null) : null;
	const vocabularyVerified = session?.compatibility?.vocabulary_verified !== false;
	const notices = conflict || declarationPrompt || result;

	return (
		<div className="edit">
			{/*
			  THE TITLE SPANS BOTH PANES, and it is an H1 rather than a labelled field. It belongs to
			  the memory rather than to a column, and it is the first line of a document — which is
			  what the reading screen will draw it as, in the same face, at the same weight.
			*/}
			<Band>
				<TitleInput
					value={buffer.title}
					autoFocus={creating}
					aria-label="The memory's title"
					aria-invalid={titleBlocker ? true : undefined}
					placeholder="What did you learn?"
					onChange={(event) => patch({ title: event.target.value })}
				/>
				{titleBlocker ? (
					<p className="field-note field-note-warn" role="alert">
						{titleBlocker.message} It is what your agent sees first, and it is not scraped out of
						the words below.
					</p>
				) : null}
			</Band>

			{notices ? (
				<div className="edit-notices">
					{conflict ? (
						<ConflictPrompt
							conflict={conflict}
							mine={buffer}
							onKeepMine={() => {
								setConflict(null);
								performSave({ versionOverride: conflict.current });
							}}
							onTakeTheirs={() => {
								if (!conflict.theirs) return;
								setBuffer(conflict.theirs);
								setBaseline(conflict.theirs);
								setExpectedVersion(conflict.current);
								setConflict(null);
							}}
							onLater={() => setConflict(null)}
						/>
					) : null}

					{declarationPrompt ? (
						<DeclarationPrompt
							prompt={declarationPrompt}
							onDeclareAll={(surfaces) => {
								addEntity(surfaces);
								setDeclarationPrompt(null);
								setDetails(true);
							}}
							onDeclareOne={(seed) => {
								addEntity(seed);
								setDeclarationPrompt(null);
								setDetails(true);
							}}
							onRemoveLast={(id) => {
								setBuffer((current) =>
									current
										? { ...current, entities: current.entities.filter((row) => row.id !== id) }
										: current,
								);
								setDeclarationPrompt(null);
							}}
							onCancel={() => setDeclarationPrompt(null)}
						/>
					) : null}

					{result ? (
						<SaveOutcome
							result={result}
							onDiscard={onCancel}
							onDeclare={declareAndResend}
							onResend={() => performSave()}
							onDismiss={() => setResult(null)}
							onOpenDetails={() => setDetails(true)}
							onOpen={onOpen}
						/>
					) : null}
				</div>
			) : null}

			<div className="screen-split">
				{/* LEFT: exactly one thing — the words. */}
				<section className="pane pane-bordered pane-reading" aria-label="The words">
					<PaneHead label="The words" />
					<textarea
						className="textarea textarea-prose edit-prose"
						value={buffer.body}
						spellCheck="true"
						aria-label="The memory, in your own words"
						placeholder="What happened, and what it means for next time."
						onChange={(event) => patch({ body: event.target.value })}
					/>
					{overCeiling || (byteCeiling && bytes > byteCeiling * AMBER_AT) ? (
						<PaneFoot className={overCeiling ? 'warn-text' : undefined}>
							{overCeiling
								? `This note is ${bytes.toLocaleString()} bytes and the engine accepts ${byteCeiling.toLocaleString()}. Split it into two memories — a save this long is refused before anything is written.`
								: `${bytes.toLocaleString()} of ${byteCeiling.toLocaleString()} bytes.`}
						</PaneFoot>
					) : null}
				</section>

				{/* RIGHT: exactly one thing — what the agent will act on. */}
				<section className="pane pane-surface pane-side pane-edit" aria-label="What your agent acts on">
					<PaneHead
						label="What your agent acts on"
						action={
							<Button tone="quiet" onClick={() => addFact()} disabled={atCap}>
								Add a fact
							</Button>
						}
					/>

					<PaneBody>
						{buffer.facts.map((row) => (
							<FactCard
								key={row.id}
								row={row}
								duplicate={duplicates.has(row.id)}
								reserved={reservedRows.get(row.id) ?? null}
								refused={refusedRows.get(row.id) ?? null}
								drifted={drifted.get(row.id) ?? null}
								undeclared={undeclared}
								predicateOptions={predicateOptions}
								surfaceOptions={surfaceOptions}
								onPatch={patchFact}
								onRemove={() => removeFact(row.id)}
								onQualifiers={() => setQualifiersFor(row.id)}
								onDeclare={requestEntity}
							/>
						))}

						{factsBlocker ? (
							<p className="field-note field-note-warn" role="alert">
								{factsBlocker.message}
							</p>
						) : null}

						{atCap ? (
							<p className="field-note field-note-warn">
								This memory is at the {factCap}-fact limit the engine named. Split it into two.
							</p>
						) : null}

						{/*
						  `null` is not zero and they read differently. Zero means the check ran and found
						  nothing; null means this memory declares nothing at all, in which case every fact
						  commits and every name is matched on its characters — a regime a large share of
						  agent-written memories are in, and flagging it would be an outage rather than a
						  guard.
						*/}
						{undeclared === null ? (
							<p className="field-note">
								This memory declares nothing by name, so every fact here commits and each name is
								matched on its characters alone. Declaring one thing changes that for all of them.
							</p>
						) : undeclared.length > 0 ? (
							<p className="field-note field-note-warn">
								{undeclared.length} name{undeclared.length === 1 ? '' : 's'} used above{' '}
								{undeclared.length === 1 ? 'is' : 'are'} not declared. Because this memory declares
								something, {undeclared.length === 1 ? 'that fact' : 'those facts'} will be dropped
								while the rest of it commits.
							</p>
						) : null}

						{proseOnly ? (
							<p className="field-note">
								You changed the words and not the facts. That is often right — but a save replaces
								both, so these are what an agent will still read back.
							</p>
						) : null}
					</PaneBody>

					{/*
					  TWO SENTENCES, BOTH MEASURED, AND THE COPY MAY ONLY CHANGE WHEN A TEST GOES RED.
					  The copy exists, outside the vault, and a person can read it and save it. Returning
					  it to service is not something the memory engine can do — no published operation puts
					  an earlier version back, which `test/restore.test.mjs` asserts on every run.
					*/}
					<PaneFoot icon={<Icon.Info size={13} className="icon" />}>
						A copy is kept before this save. There is no undo.
					</PaneFoot>
				</section>
			</div>

			<Dialog
				open={details}
				onOpenChange={setDetails}
				wide
				title="Details"
				description="Everything about this memory that is not its words or its facts."
				footer={
					<Button tone="primary" onClick={() => setDetails(false)}>
						Back to the memory
					</Button>
				}
			>
				<DetailsSheet
					buffer={buffer}
					axes={axes}
					blockers={attempted ? blockers : []}
					typeOptions={typeOptions}
					kindOptions={kindOptions}
					scopeOptions={scopeOptions}
					vault={vault}
					minting={minting}
					record={record}
					creating={creating}
					expectedVersion={expectedVersion}
					headingComposed={composed !== buffer.body}
					onPatch={patch}
					onPatchEntity={patchEntity}
					onAddEntity={() => requestEntity('')}
					onRemoveEntity={removeEntity}
					onSetBuffer={setBuffer}
				/>
			</Dialog>

			<Dialog
				open={qualifiersFor !== null}
				onOpenChange={(open) => setQualifiersFor(open ? qualifiersFor : null)}
				title="How this fact is held"
				description="What kind of claim it is, how it is known, and when it holds. Every value here comes from the engine's own contract."
				footer={
					<Button tone="primary" onClick={() => setQualifiersFor(null)}>
						Done
					</Button>
				}
			>
				<Qualifiers
					row={buffer.facts.find((entry) => entry.id === qualifiersFor) ?? null}
					closed={contract?.closed ?? {}}
					vocabularyVerified={vocabularyVerified}
					onPatch={patchFact}
				/>
			</Dialog>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// A fact, being edited
// ---------------------------------------------------------------------------------------------

/**
 * The object an agent will act on, drawn as the sentence it is and editable in place.
 *
 * Every part is a control, and none of them wears a box until it is touched: the memory is being
 * written in the shape it will be read in. The relation keeps the accent chip because it IS a
 * control — `reading.jsx` draws the same verb as plain accent text, where it is not one.
 */
function FactCard({
	row,
	duplicate,
	reserved,
	refused,
	drifted,
	undeclared,
	predicateOptions,
	surfaceOptions,
	onPatch,
	onRemove,
	onQualifiers,
	onDeclare,
}) {
	const [naming, setNaming] = useState(false);

	const undeclaredHere = (undeclared ?? []).filter((surface) =>
		[trimmed(row.subject).toLowerCase(), trimmed(row.object).toLowerCase()].includes(
			surface.toLowerCase(),
		),
	);
	const stale = Boolean(drifted || refused || reserved || duplicate);

	return (
		<div className={`fact-row fact-row-editing${stale ? ' fact-row-stale' : ''}`}>
			<div className="fact-row-line">
				<div className="fact-part" onFocus={() => setNaming(true)} onBlur={() => setNaming(false)}>
					<Combobox
						value={row.subject}
						onValueChange={(value) => onPatch(row.id, { subject: value })}
						options={surfaceOptions}
						placeholder="what this is about"
						inputClassName="input-inline"
						createLabel={(typed) => `Use “${typed}” as a new name`}
						emptyLabel="No name in this vault matches"
					/>
				</div>

				<Combobox
					value={row.predicate}
					onValueChange={(value) => onPatch(row.id, { predicate: value })}
					options={predicateOptions}
					layout="cloud"
					groupLabel="Used in this vault"
					placeholder="relates how"
					inputClassName="input-relation"
					createLabel={(typed) => `Use “${typed}”`}
					createCost="accepted, but splits the facts of a relation"
				/>

				<div className="fact-part" onFocus={() => setNaming(true)} onBlur={() => setNaming(false)}>
					<Combobox
						value={row.object}
						onValueChange={(value) => onPatch(row.id, { object: value })}
						options={surfaceOptions}
						placeholder="to what"
						inputClassName="input-inline input-end"
						createLabel={(typed) => `Use “${typed}” as a new name`}
						emptyLabel="No name in this vault matches"
					/>
				</div>

				<span className="fact-row-actions">
					<IconButton label="How this fact is held" onClick={onQualifiers}>
						<Icon.More size={14} />
					</IconButton>
					<IconButton label="Remove this fact" onClick={onRemove}>
						<Icon.Close size={13} />
					</IconButton>
				</span>
			</div>

			{/*
			  THE SENTENCE THAT MAKES THE CHOICE ABOVE MEAN SOMETHING, at the moment it is being made.
			  Names join only on exact character identity, so picking the row that already exists is
			  the single act that keeps two mentions of one thing one thing. It appears while a name
			  is being edited and not at rest, because on a card that is not being touched it would be
			  eleven words of standing chrome per fact.
			*/}
			{naming ? (
				<p className="field-note">
					Names join only when they match exactly. Picking the existing one is what keeps them one
					thing.
				</p>
			) : null}

			{drifted ? (
				<p className="fact-note">
					No longer in the words: {drifted.join(', ')}. Remove it, or say it in the prose.
				</p>
			) : null}

			{reserved ? (
				<p className="fact-note" role="alert">
					{reservedRelationAdvice(reserved)}
				</p>
			) : null}

			{duplicate ? (
				<p className="fact-note">
					Another row states the same thing. Two identical facts are either collapsed into one or
					refused, depending on how they are numbered — neither is an outcome to find on a receipt.
				</p>
			) : null}

			{refused ? (
				<p className="fact-note" role="alert">
					Not stored: this memory declares nothing about {refused.surfaces.join(', ')}.{' '}
					{refused.surfaces.map((surface) => (
						<Button key={surface} tone="quiet" onClick={() => onDeclare(surface)}>
							Declare “{surface}”
						</Button>
					))}
				</p>
			) : null}

			{!refused && undeclaredHere.length > 0 ? (
				<p className="fact-note">
					Not declared:{' '}
					{undeclaredHere.map((surface) => (
						<Button key={surface} tone="quiet" onClick={() => onDeclare(surface)}>
							{surface}
						</Button>
					))}
				</p>
			) : null}
		</div>
	);
}

/**
 * The qualifiers, in a sheet of their own so the fact stays three words wide.
 *
 * Every value list here is CLOSED and comes from the contract the engine printed at launch. A value
 * a record already carries that the schema does not list is kept, rendered as itself, and marked —
 * never blanked and never mapped to a near neighbour. The record is the truth and the schema is the
 * newer artefact.
 *
 * The open qualifier map (`about`) is rendered read-only. Its keys carry a declared class that
 * decides how a value is read, and authoring one from here without that class is a change this
 * screen cannot make honestly.
 */
function Qualifiers({ row, closed, vocabularyVerified, onPatch }) {
	if (!row) return null;
	const q = row.qualifiers ?? {};

	const setQualifier = (key, value) =>
		onPatch(row.id, { qualifiers: { ...q, [key]: value === '' ? null : value } });

	const about = q.about && typeof q.about === 'object' ? Object.entries(q.about) : [];

	const time = (key) => {
		const value = q[key];
		return value && typeof value === 'object' ? value : { t: '', grain: '' };
	};
	const setTime = (key, part, value) => {
		const next = { ...time(key), [part]: value };
		const empty = !trimmed(next.t) && !trimmed(next.grain);
		onPatch(row.id, { qualifiers: { ...q, [key]: empty ? null : next } });
	};

	return (
		<div className="sheet">
			<p className="fact">
				<span>{trimmed(row.subject) || '—'}</span>{' '}
				<span className="fact-relation">{trimmed(row.predicate) || '—'}</span>{' '}
				<span>{trimmed(row.object) || '—'}</span>
			</p>

			<Field label="What kind of claim this is">
				<ClosedValueSelect
					verified={vocabularyVerified}
					label="What kind of claim this is"
					value={q.mode ?? ''}
					values={closed['semantic_delta.facts.mode'] ?? []}
					onChange={(value) => setQualifier('mode', value)}
				/>
			</Field>

			<Field label="How it is known">
				<ClosedValueSelect
					verified={vocabularyVerified}
					label="How it is known"
					value={q.basis ?? ''}
					values={closed['semantic_delta.facts.basis'] ?? []}
					onChange={(value) => setQualifier('basis', value)}
				/>
			</Field>

			{['from', 'until'].map((key) => (
				<Field
					key={key}
					label={key === 'from' ? 'True from' : 'True until'}
					note={
						key === 'from'
							? 'Left empty, this fact inherits when the memory is about.'
							: 'Left empty, it stays open — an end never inherits, because that would close every open interval in the vault.'
					}
				>
					<div className="sheet-grid">
						<Input
							className="sheet-axis-control"
							value={time(key).t ?? ''}
							placeholder="2026, 2026-03, 2026-03-15…"
							onChange={(event) => setTime(key, 't', event.target.value)}
						/>
						<ClosedValueSelect
							verified={vocabularyVerified}
							label={key === 'from' ? 'The grain of the start' : 'The grain of the end'}
							value={time(key).grain ?? ''}
							values={closed['semantic_delta.facts.from.grain'] ?? []}
							onChange={(value) => setTime(key, 'grain', value)}
						/>
					</div>
				</Field>
			))}

			{about.length > 0 ? (
				<Card title="Qualifiers on this fact">
					<Readings>
						{about.map(([key, value]) => (
							<ReadingPair key={key} term={key}>
								{typeof value === 'object' ? JSON.stringify(value) : String(value)}
							</ReadingPair>
						))}
					</Readings>
					<p className="field-note">
						Preserved exactly and not editable here. Each key carries a declared class that decides
						whether its value is resolved against the graph or validated as a literal, and this
						screen cannot supply one.
					</p>
				</Card>
			) : null}
		</div>
	);
}

/**
 * A CLOSED list. A value the record carries that the schema does not name is kept and marked.
 *
 * The record is the truth and the schema is the newer artefact, so the value stays selected and the
 * save is allowed. Blanking it, or mapping it to a near neighbour, would rewrite the user's memory
 * to match a list.
 */
function ClosedValueSelect({ value, values, label, verified = true, onChange }) {
	const current = trimmed(value);
	const unrecognised = current.length > 0 && !values.includes(current);

	// TIER B: THE MENU BECOMES A TEXT BOX.
	//
	// The list came out of a write contract this build has not been tested against, so it may be
	// SHORT rather than wrong — and a short menu is the worse failure of the two, because it looks
	// authoritative. A user who cannot find the value they mean in a dropdown concludes it is not
	// allowed; a user looking at a text box with what could be read beside it types what they meant.
	//
	// What it never does is substitute a list this app wrote down. A bundled vocabulary standing in
	// for a failed parse is the exact drift that reading the contract at run time exists to prevent.
	if (!verified) {
		return (
			<>
				<Input
					value={current}
					aria-label={label}
					onChange={(event) => onChange(event.target.value)}
				/>
				<p className="field-note field-note-warn">
					{values.length > 0
						? `Unverified: this engine's contract is not one this build was tested against. ${values.join(', ')} is what could still be read out of it.`
						: 'Unverified: nothing could be read out of this engine’s contract for this field.'}
				</p>
			</>
		);
	}

	return (
		<>
			<Select
				label={label}
				value={current === '' ? UNSET : current}
				placeholder="not recorded"
				onValueChange={(next) => onChange(next === UNSET ? '' : next)}
			>
				<SelectItem value={UNSET}>not recorded</SelectItem>
				{values.map((option) => (
					<SelectItem key={option} value={option}>
						{option}
					</SelectItem>
				))}
				{unrecognised ? (
					<SelectItem value={current}>{current} — not in this engine’s list</SelectItem>
				) : null}
			</Select>
			{unrecognised ? (
				<p className="field-note">
					This value is not in the list this engine published. It is what the record says, so it is
					kept exactly as it is.
				</p>
			) : null}
		</>
	);
}

// ---------------------------------------------------------------------------------------------
// Details: everything that is not the words or the facts
// ---------------------------------------------------------------------------------------------

/**
 * The four things the approved design took OFF the screen, and one row about the save itself.
 *
 * They are in one sheet rather than down the side of the editor because that is the insight the
 * owner approved: the second column was fine, the four unrelated blocks stacked in it were not.
 * Nothing here is hidden — the control that opens it carries a count when something inside it is
 * stopping the save.
 */
function DetailsSheet({
	buffer,
	axes,
	blockers,
	typeOptions,
	kindOptions,
	scopeOptions,
	vault,
	minting,
	record,
	creating,
	expectedVersion,
	headingComposed,
	onPatch,
	onPatchEntity,
	onAddEntity,
	onRemoveEntity,
	onSetBuffer,
}) {
	const [ending, setEnding] = useState(false);
	const typeBlocker = blockers.find((entry) => entry.field === 'memory_type') ?? null;
	// `blockers` arrives empty until a save has been attempted, so nothing here is marked in red
	// before the user has asked for anything. See `attempted` in the screen above.
	const endsOn = validUntilDate(buffer);
	const declared = buffer.entities;
	const dropped = record?.dropped_fields ?? [];
	const carriedKeys = Object.keys(buffer.carried ?? {}).filter((key) => {
		const value = buffer.carried[key];
		if (value === null || value === undefined) return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === 'object') return Object.values(value).some((item) => item !== null);
		return true;
	});

	return (
		<div className="sheet">
			<Card title="What kind of memory this is">
				<Field
					note="Types are append-only: no operation takes one back, and a near-synonym persists forever beside the word it duplicates. Reuse one."
					tone={typeBlocker ? 'warn' : 'neutral'}
				>
					<Combobox
						value={buffer.memory_type}
						onValueChange={(value) => onPatch({ memory_type: value })}
						options={typeOptions}
						placeholder="the kind of thing this is"
						createLabel={(typed) => `Use “${typed}” as a new type`}
						createCost="new to this vault, and permanent"
						emptyLabel="No type in this vault matches"
					/>
				</Field>
				{typeBlocker ? (
					<p className="field-note field-note-warn" role="alert">
						{typeBlocker.message}
					</p>
				) : null}
			</Card>

			<Card title="Where it applies">
				{axes.map((axis) => {
					const copy = axisCopy(axis);
					const value = buffer.scope?.[axis] ?? null;
					return (
						<div key={axis} className="sheet-axis">
							<span className="sheet-axis-label">{copy.label}</span>
							<span className="sheet-axis-control">
								{value === null ? (
									<UnsetField
										phrase={copy.every}
										onSet={() => onPatch({ scope: { ...buffer.scope, [axis]: '' } })}
									/>
								) : (
									<Combobox
										value={value}
										onValueChange={(next) =>
											onPatch({ scope: { ...buffer.scope, [axis]: next === '' ? null : next } })
										}
										options={scopeOptions[axis] ?? []}
										placeholder={copy.every}
										createLabel={(typed) => `Use “${typed}”`}
										emptyLabel="Nothing in this vault uses this axis yet"
									/>
								)}
							</span>
						</div>
					);
				})}
				<p className="field-note">
					Left empty, a line matches every request. Fill one in and this memory is only ever offered
					for that exact value — narrowing hides it more often than it helps.
				</p>
			</Card>

			<Card title="Until when">
				<div className="sheet-axis">
					<span className="sheet-axis-control">
						{/*
						  OPENING THE CONTROL IS NOT SETTING A DATE. Seeding it with today would end the
						  memory today, and the next save would mean it — the user asked to see the
						  field, not to retire the memory they are in the middle of editing.
						*/}
						{endsOn === null && !ending ? (
							<UnsetField phrase="still true" onSet={() => setEnding(true)} />
						) : (
							<Input
								type="date"
								value={endsOn ?? ''}
								aria-label="The day this memory stops being offered"
								onChange={(event) =>
									onSetBuffer((current) =>
										withValidUntil(current, event.target.value === '' ? null : event.target.value),
									)
								}
							/>
						)}
					</span>
					{/*
					  THE ACTION IS NAMED, as EditValues draws it. The dashed field is clickable too, but
					  a dashed box reading "still true" does not say what pressing it would do, and this
					  is the control that retires a memory — the one place in the sheet where guessing at
					  an affordance costs something. The label is the whole disclosure.
					*/}
					{endsOn === null && !ending ? (
						<Button tone="quiet" onClick={() => setEnding(true)}>
							Set an end date
						</Button>
					) : (
						<Button
							tone="quiet"
							onClick={() => {
								setEnding(false);
								onSetBuffer((current) => withValidUntil(current, null));
							}}
						>
							Still true
						</Button>
					)}
				</div>
				<p className="field-note">
					An ended memory stops being offered to your agent and stays readable here. That is the
					gentler alternative to removing something that was simply true at the time.
				</p>
			</Card>

			<Card
				title="Named things"
				aside={declared.length === 0 ? 'none declared' : `${declared.length} declared`}
			>
				{declared.length === 0 ? (
					<p className="field-note">
						Nothing is declared, so every fact commits and each name is matched on its characters
						alone. Declaring the first one changes that for every fact in this memory.
					</p>
				) : (
					declared.map((row) => (
						<DeclaredThing
							key={row.id}
							row={row}
							blockers={blockers}
							kindOptions={kindOptions}
							known={knownName(vault, row.n)}
							onPatch={onPatchEntity}
							onRemove={() => onRemoveEntity(row.id)}
						/>
					))
				)}
				<div className="head-actions">
					<Button tone="quiet" onClick={onAddEntity}>
						Declare something
					</Button>
				</div>
				{minting.names.length > 0 || minting.relations.length > 0 ? (
					<p className="field-note">
						This save would create {minting.names.length} name
						{minting.names.length === 1 ? '' : 's'} and {minting.relations.length} relation
						{minting.relations.length === 1 ? '' : 's'} this vault has never seen. Reusing one that
						already exists is what makes a fact join the rest of the vault rather than start an
						island.
					</p>
				) : null}
			</Card>

			{/*
			  THE DERIVED-FIELDS NOTICE, WHICH USED TO BE THE FIRST THING ON THE SCREEN. It is true, it
			  is worth being able to find, and it is about the mechanics of the save rather than about
			  the memory — so it is one closed row at the bottom of the sheet.
			*/}
			<DetailRows>
				<DetailRow
					label="What a save sends"
					count={creating ? 'a new memory' : 'replaces one version'}
				>
					<Readings>
						{creating ? null : (
							<ReadingPair term="Replaces">
								<Identifier value={expectedVersion} label="the version this save replaces" />
							</ReadingPair>
						)}
						<ReadingPair term="Sends">
							the words and the structure together, in one call. There is no body-only write, which
							is why the facts are beside the words rather than behind a tab.
						</ReadingPair>
						{headingComposed ? (
							<ReadingPair term="Heading">
								a <code className="identifier">#</code> line is composed from the title, because the
								engine refuses a note that does not begin with one. Your words are not changed.
							</ReadingPair>
						) : null}
						{carriedKeys.length > 0 ? (
							<ReadingPair term="Carried through">
								{carriedKeys.join(', ')} — this version has no control for{' '}
								{carriedKeys.length === 1 ? 'it' : 'them'}, so{' '}
								{carriedKeys.length === 1 ? 'it is' : 'they are'} sent back exactly as{' '}
								{carriedKeys.length === 1 ? 'it' : 'they'} arrived: not defaulted, not invented, and
								not dropped.
							</ReadingPair>
						) : null}
						{dropped.length > 0 ? (
							<ReadingPair term="Not sent">
								{dropped.join(', ')} — {dropped.length === 1 ? 'a value' : 'values'} the engine
								derives and recomputes. The write contract does not accept{' '}
								{dropped.length === 1 ? 'it' : 'them'}, and sending{' '}
								{dropped.length === 1 ? 'it' : 'them'} would fail the whole call before anything was
								written.
							</ReadingPair>
						) : null}
					</Readings>
				</DetailRow>
			</DetailRows>
		</div>
	);
}

/**
 * One declaration: the name as the facts spell it, its kind, and the gloss.
 *
 * The gloss is not styled as optional and is not last in importance, because it is not
 * documentation: it is what the matcher probes with, and it is the field that decides whether this
 * name joins the thing already in the graph or starts a second copy of it. The door requires it,
 * and the form must not be gentler than the door.
 */
function DeclaredThing({ row, blockers, kindOptions, known, onPatch, onRemove }) {
	const rowBlockers = blockers.filter((entry) => entry.field === `entity:${row.id}`);
	const suggestion = known?.glosses?.[0] ?? null;

	return (
		<div className="declared">
			<div className="declared-head">
				<span className="declared-name">
					<Input
						value={row.n}
						aria-label="The name, as the facts spell it"
						placeholder="as the facts spell it"
						onChange={(event) => onPatch(row.id, { n: event.target.value })}
					/>
				</span>
				<span className="declared-kind">
					<Combobox
						value={row.kind}
						onValueChange={(value) => onPatch(row.id, { kind: value })}
						options={kindOptions}
						placeholder="what sort of thing"
						createLabel={(typed) => `Use “${typed}” as a new kind`}
						emptyLabel="No kind in this vault matches"
					/>
				</span>
				<IconButton label={`Remove the declaration of ${trimmed(row.n) || 'this name'}`} onClick={onRemove}>
					<Icon.Close size={13} />
				</IconButton>
			</div>

			<Input
				value={row.is}
				aria-label="What this is, in one line"
				placeholder="what this is, in one line"
				aria-invalid={rowBlockers.length > 0 || undefined}
				onChange={(event) => onPatch(row.id, { is: event.target.value })}
			/>

			{trimmed(row.is).length === 0 ? (
				<p className="field-note field-note-warn">
					This sentence is what finds the thing later.{' '}
					<strong>“{trimmed(row.n) || 'A bare name'}” alone matches on its characters</strong> — the
					sentence is what makes it findable when someone asks about the subject rather than the
					spelling.
				</p>
			) : null}

			{rowBlockers.length > 0 ? (
				<p className="field-note field-note-warn" role="alert">
					{rowBlockers.map((entry) => entry.message).join(' ')}
				</p>
			) : null}

			{known ? (
				<p className="field-note">
					{known.memories} other memor{known.memories === 1 ? 'y' : 'ies'} in this vault use this
					exact name.{' '}
					{suggestion && trimmed(row.is) !== suggestion.gloss ? (
						<Button
							tone="quiet"
							onClick={() =>
								onPatch(row.id, {
									is: suggestion.gloss,
									kind: trimmed(row.kind) || (known.kinds[0]?.kind ?? ''),
								})
							}
						>
							Use the gloss {suggestion.count} of them use
						</Button>
					) : null}
					{known.conflicted ? (
						<span className="warn-text">
							{' '}
							It is already glossed {known.glosses.length} different ways here, which is what one
							thing spelled twice looks like — and also what two different things sharing a name
							looks like. Only you can tell which.
						</span>
					) : null}
				</p>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// What a save did
// ---------------------------------------------------------------------------------------------

/**
 * Every ending except the clean one, which leaves this screen instead of reporting on it.
 *
 * It stands ON the page rather than over it: what the user typed is still on screen behind every
 * one of these, and several of them are decisions about that typing.
 */
function SaveOutcome({ result, onDeclare, onDiscard, onResend, onDismiss, onOpenDetails, onOpen }) {
	if (result.kind === 'confirm_cancel') {
		return (
			<Prompt
				title="Leave this memory as it was?"
				tone="warn"
				role="alertdialog"
				label="Leaving without saving"
				actions={
					<>
						<Button tone="warn" onClick={onDiscard}>
							Discard what I typed
						</Button>
						<Button tone="primary" onClick={onDismiss}>
							Keep editing
						</Button>
					</>
				}
			>
				<PromptSentence>
					Nothing has been written. What is on this screen is only in this browser, and leaving now
					loses it — this product has no undo, and it has no draft either.
				</PromptSentence>
			</Prompt>
		);
	}

	if (result.kind === 'blocked') {
		const hidden = result.blockers.filter(
			(entry) => entry.field !== 'title' && entry.field !== 'facts',
		);
		return (
			<Prompt
				title="This memory is not ready to be written"
				tone="warn"
				role="alert"
				actions={
					hidden.length > 0 ? (
						<Button tone="primary" onClick={onOpenDetails}>
							Open details
						</Button>
					) : (
						<Button onClick={onDismiss}>Close</Button>
					)
				}
			>
				<PromptList>
					{result.blockers.map((entry) => (
						<li key={`${entry.field}:${entry.message}`}>{entry.message}</li>
					))}
				</PromptList>
				<PromptNote>
					Nothing was sent. Each of these is a condition the engine refuses on, checked here so the
					refusal is not what tells you.
				</PromptNote>
			</Prompt>
		);
	}

	if (result.kind === 'no_change') {
		return (
			<Prompt
				title="Nothing was written — this content is already in your vault"
				actions={
					<>
						{result.write.memory_id && onOpen ? (
							<Button tone="primary" onClick={() => onOpen(result.write.memory_id)}>
								Open the memory that already holds it
							</Button>
						) : null}
						<Button onClick={onDismiss}>Keep editing</Button>
					</>
				}
			>
				<PromptSentence>
					This is the correct outcome rather than a failure: the vault already holds this exact
					content, so the engine returned the record it has instead of storing a second copy of it.
				</PromptSentence>
			</Prompt>
		);
	}

	if (result.kind === 'partial') {
		const surfaces = refusedSurfaces(result.refused_facts);
		const stored = result.write.stored_claim_count ?? '—';
		return (
			<Prompt
				title={`Saved — and ${result.refused_facts.length} of ${result.submitted} facts were not stored`}
				tone="warn"
				role="alert"
				actions={
					<>
						<Button tone="primary" onClick={() => onDeclare(surfaces)}>
							Declare {surfaces.length === 1 ? 'it' : `all ${surfaces.length}`} and save again
						</Button>
						<Button onClick={onDismiss}>Leave them out</Button>
					</>
				}
			>
				<PromptSentence>
					The words, the title and {stored} fact{stored === 1 ? '' : 's'} were saved as{' '}
					<Identifier value={result.write.version_id} label="new version" />. These were dropped
					because they name something this memory does not declare.
				</PromptSentence>
				<PromptList>
					{result.refused_facts.map((refusal, index) => (
						<li key={index}>
							{(refusal.undeclared ?? []).join(', ') || 'a name this memory does not declare'}
							{refusal.reason ? <span className="faint"> — {refusal.reason}</span> : null}
						</li>
					))}
				</PromptList>
				<PromptNote>
					The rows those names appear on are marked beside the words. They are matched by the name
					itself and never by the position the refusal reports, because that position does not
					correspond to the order the facts were sent in.
				</PromptNote>
			</Prompt>
		);
	}

	if (result.kind === 'declare_then_save') {
		return (
			<Prompt
				title={`${result.surfaces.length} declaration${result.surfaces.length === 1 ? '' : 's'} added`}
				actions={
					<>
						<Button tone="primary" onClick={onResend}>
							Save again
						</Button>
						<Button onClick={onOpenDetails}>Fill them in first</Button>
					</>
				}
			>
				<PromptSentence>{result.sentence}</PromptSentence>
			</Prompt>
		);
	}

	if (result.kind === 'shortfall') {
		return (
			<Prompt
				title="The save stored fewer facts than it was sent"
				tone="warn"
				role="alert"
				actions={<Button onClick={onDismiss}>Close</Button>}
			>
				<PromptSentence>
					{result.submitted} fact{result.submitted === 1 ? '' : 's'} were submitted and the engine
					reported {result.write.shortfall.stored} stored with {result.write.shortfall.refused}{' '}
					refused. Those numbers do not add up, and this app cannot say which facts are in the vault.
				</PromptSentence>
				<PromptNote>
					The memory has been re-read.{' '}
					{result.reread
						? `It now holds ${result.reread.fact_count} fact(s) and ${result.reread.entity_count} declaration(s).`
						: 'That re-read also failed — open this memory again before changing anything else.'}
				</PromptNote>
			</Prompt>
		);
	}

	if (result.kind === 'fold_failed') {
		return (
			<Prompt
				title="The memory was written and its graph entry failed"
				tone="warn"
				role="alert"
				actions={<Button onClick={onDismiss}>Close</Button>}
			>
				<PromptSentence>{result.sentence ?? 'The engine reported a fold failure.'}</PromptSentence>
				<PromptNote>
					This is the one outcome that is neither a refusal you can retry nor a success. The memory
					is in the vault with no nodes and no claims, and no published operation repairs that. The
					only recovery is to remove it and write it again.
				</PromptNote>
			</Prompt>
		);
	}

	if (result.kind === 'reserved_relation') {
		return (
			<Prompt
				title={`“${result.relation}” cannot be written as a relation`}
				tone="warn"
				role="alert"
				actions={<Button onClick={onDismiss}>Close</Button>}
			>
				<PromptSentence>{result.sentence}</PromptSentence>
			</Prompt>
		);
	}

	if (result.kind === 'refused') {
		const surfaces = result.classified?.surfaces ?? [];
		return (
			<Prompt
				title={refusalHeading(result.classified)}
				tone="warn"
				role="alert"
				actions={
					result.classified?.kind === 'all_endpoints_undeclared' && surfaces.length > 0 ? (
						<>
							<Button tone="primary" onClick={() => onDeclare(surfaces)}>
								Declare all {surfaces.length} and continue
							</Button>
							<Button onClick={onDismiss}>Close</Button>
						</>
					) : (
						<Button onClick={onDismiss}>Close</Button>
					)
				}
			>
				{/* The engine's own sentence, whole. It names the repair; a paraphrase of it does not. */}
				<PromptSentence>
					{result.sentence ?? 'The engine declined this write and said nothing further.'}
				</PromptSentence>
				{result.next ? <PromptNote>{result.next}</PromptNote> : null}
			</Prompt>
		);
	}

	// Anything else, including an outcome value this build does not know. LOUD, never a success.
	return (
		<Prompt
			title="This save ended in a way this app does not recognise"
			tone="warn"
			role="alert"
			actions={<Button onClick={onDismiss}>Close</Button>}
		>
			<PromptSentence>{result.sentence ?? 'No further detail was returned.'}</PromptSentence>
			<PromptNote>
				It is not being shown as a success. Nothing on this screen can say whether the write
				happened, so re-open this memory and check before changing anything else.
			</PromptNote>
		</Prompt>
	);
}

function refusalHeading(classified) {
	switch (classified?.kind) {
		case 'over_cap':
			return 'This memory is over one of the engine’s limits';
		case 'all_endpoints_undeclared':
			return 'Every fact here names something this memory does not declare';
		case 'needs_a_fact':
			return 'A memory needs at least one fact';
		case 'needs_a_title':
			return 'A memory needs a title';
		case 'needs_a_heading':
			return 'The note must begin with a heading';
		case 'unknown_field':
			return 'This build sent a field the engine does not accept';
		default:
			return 'The engine declined this save';
	}
}

// ---------------------------------------------------------------------------------------------
// The conflict, and the declaration switch
// ---------------------------------------------------------------------------------------------

/**
 * Someone else changed this memory while it was open. That is the NORMAL case, not the edge case:
 * agents write this vault while the tab is open.
 *
 * The refusal is exact and names the version that is now current, so there is never a reason to
 * discard a buffer in order to report it. Exactly one action here throws typing away, and it is the
 * one the user pressed.
 */
function ConflictPrompt({ conflict, mine, onKeepMine, onTakeTheirs, onLater }) {
	const comparison = conflict.theirs ? compareBuffers(mine, conflict.theirs) : null;

	return (
		<Prompt
			title="Someone else changed this memory while you were editing"
			tone="warn"
			role="alertdialog"
			label="This memory changed while you were editing"
			actions={
				<>
					<Button tone="primary" onClick={onKeepMine}>
						Keep mine, overwrite theirs
					</Button>
					<Button onClick={onTakeTheirs} disabled={!conflict.theirs}>
						Take theirs, discard mine
					</Button>
					<Button tone="quiet" onClick={onLater}>
						Keep editing, decide later
					</Button>
				</>
			}
		>
			<PromptSentence>
				You loaded <Identifier value={conflict.loaded} label="the version you loaded" />. The vault is
				now on <Identifier value={conflict.current} label="the current version" />.{' '}
				<strong>Your edits are safe and still on screen.</strong>
			</PromptSentence>
			{comparison ? (
				<Table label="What is different between the two versions">
					<thead>
						<tr>
							<Th>Field</Th>
							<Th>Theirs</Th>
							<Th>Yours</Th>
						</tr>
					</thead>
					<tbody>
						{comparison.map((line) => (
							<Tr key={line.field} attention={!line.same}>
								<Td>{line.field}</Td>
								<Td>{String(line.theirs)}</Td>
								<Td>{String(line.mine)}</Td>
							</Tr>
						))}
					</tbody>
				</Table>
			) : (
				<PromptNote>
					Their version could not be re-read, so there is nothing to compare against. Your buffer is
					untouched — saving again will overwrite whatever is there now.
				</PromptNote>
			)}
		</Prompt>
	);
}

/**
 * Crossing the entity-declaration switch, in both directions.
 *
 * It is a switch and not a gradient. Declaring nothing means every fact commits and every name is
 * matched loosely; declaring one thing means every name any fact mentions must be declared or that
 * fact is dropped while the rest of the write commits. So the first declaration is a decision that
 * changes how every OTHER fact in the memory is treated, and this says exactly that.
 */
function DeclarationPrompt({ prompt, onDeclareAll, onDeclareOne, onRemoveLast, onCancel }) {
	if (prompt.kind === 'last') {
		return (
			<Prompt
				title="This would leave the memory declaring nothing"
				tone="warn"
				role="alertdialog"
				label="Removing the last declaration"
				actions={
					<>
						<Button tone="primary" onClick={() => onRemoveLast(prompt.id)}>
							Remove it anyway
						</Button>
						<Button onClick={onCancel}>Keep it</Button>
					</>
				}
			>
				<PromptSentence>
					With nothing declared, no fact is ever refused for naming something undeclared — and every
					name in every fact is matched on its characters alone rather than against what you said it
					is. Neither is wrong; they are different regimes, and a large share of memories are in the
					looser one.
				</PromptSentence>
			</Prompt>
		);
	}

	const surfaces = prompt.surfaces ?? [];
	return (
		<Prompt
			title="This memory declares nothing yet, and declaring one thing changes every fact"
			role="alertdialog"
			label="Declaring the first named thing"
			actions={
				<>
					{surfaces.length > 0 ? (
						<Button tone="primary" onClick={() => onDeclareAll(surfaces)}>
							Declare all {surfaces.length} and continue
						</Button>
					) : null}
					<Button onClick={() => onDeclareOne(prompt.seed ?? '')}>
						{prompt.seed ? `Declare only “${prompt.seed}”` : 'Add one blank row'}
					</Button>
					<Button tone="quiet" onClick={onCancel}>
						Cancel
					</Button>
				</>
			}
		>
			<PromptSentence>
				Right now every fact here commits and each name is matched on its characters alone. The moment
				this memory declares <em>one</em> named thing, every name any fact mentions must also be
				declared — and a fact naming something undeclared is dropped while the rest of the memory
				saves.
			</PromptSentence>
			{surfaces.length > 0 ? (
				<>
					<PromptNote>The facts here name {surfaces.length}:</PromptNote>
					<PromptList>
						{surfaces.map((surface) => (
							<li key={surface}>{surface}</li>
						))}
					</PromptList>
				</>
			) : (
				<PromptNote>No fact here names anything yet, so there is nothing to lose.</PromptNote>
			)}
		</Prompt>
	);
}
