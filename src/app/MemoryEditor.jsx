import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { childFieldNames, projectOntoContract } from '../shared/contract.mjs';
import { SidecarError, createMemory, fetchEditRecord, saveMemory } from './api.mjs';
import {
	bodyBytes,
	bufferFromRecord,
	compareBuffers,
	composeBody,
	currentVersionFromRefusal,
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
	vaultVocabulary,
} from './editor-model.mjs';
import { Markdown } from './markdown.jsx';
import { axisCopy } from './records.mjs';
import { deniedRelations, reservedRelationAdvice } from './reserved-relations.mjs';
import { ErrorState, Identifier, LoadingState } from './ui.jsx';

/**
 * The one screen in this product that writes.
 *
 * Every other surface can be wrong and cost a reader a moment. This one can be wrong and cost the
 * user something the vault has no operation to give back, so the rules below are structural rather
 * than stylistic and each is here because of a measured failure:
 *
 *   1. **It loads through the edit door and never from anything already in this browser.** The door
 *      that DISPLAYS a memory does not return its entity declarations, and the write requires them.
 *      An editor that round-trips the display record commits — exit 0, no refusal, no warning — with
 *      every named thing the memory declared deleted. The list this screen is entered from holds
 *      exactly that lossy shape, which is why `rows` is used for SUGGESTIONS and never for a save.
 *
 *   2. **The facts are on screen beside the prose at all times.** A write replaces the body and the
 *      structure together, so a prose edit re-sends the structure unchanged — and the two halves can
 *      drift apart with nothing in the engine noticing. Adjacency is the whole mitigation; a tab or
 *      an accordion is a hazard you can only see by navigating away from it.
 *
 *   3. **A save has three success-ish outcomes and this screen branches on all of them.** Committed,
 *      no-change, and committed-with-facts-dropped are three different sentences. "Saved" over the
 *      third is a lie about the third of the user's work that was refused.
 *
 *   4. **Nothing the user typed is discarded except by the user.** A stale version is a recoverable
 *      condition that names the version that is now current. There is no path in this file from a
 *      refusal to an empty buffer.
 *
 *   5. **No vocabulary is written down.** Every option list is built from what the engine printed at
 *      launch, unioned with what this vault already uses. The single exception is a DENIAL list of
 *      relation names, which fails safe by refusing something that has since become permitted.
 *
 *   6. **It issues no ranked query, ever.** Suggestions are counted out of the listing already in
 *      this browser. The ranked door writes a permanent record storing the query text; wired to a
 *      suggestion list it would write one per keystroke.
 */

/** Fields the note editor is measured against, when the engine published a ceiling. */
const AMBER_AT = 0.85;

/** How many suggestions any one datalist offers. Longer lists stop being suggestions. */
const SUGGESTION_LIMIT = 60;

// ---------------------------------------------------------------------------------------------
// Small pure helpers that only this screen needs
// ---------------------------------------------------------------------------------------------

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** A stable, order-independent signature of the structure, for "has anything but prose changed". */
function structureSignature(buffer) {
	return JSON.stringify({
		title: trimmed(buffer.title),
		memory_type: trimmed(buffer.memory_type),
		scope: buffer.scope ?? {},
		facts: buffer.facts.map((row) => [trimmed(row.subject), trimmed(row.predicate), trimmed(row.object), row.qualifiers]),
		entities: buffer.entities.map((row) => [trimmed(row.n), trimmed(row.kind), trimmed(row.is)]),
	});
}

/**
 * Phrases in the note that look like they name something and are not any fact's endpoint.
 *
 * Entirely client-side, entirely a suggestion, and deliberately crude: quoted spans, backticked
 * spans, and runs of capitalised words. It NEVER proposes a fact — it offers to open a row with the
 * subject filled in, and a person writes the claim. Deriving facts from prose is the one thing this
 * product removed on purpose, and a UI that did it would put the inference back with a worse model.
 */
function unlinkedMentions(body, facts) {
	const endpoints = new Set(
		facts.flatMap((row) => [trimmed(row.subject).toLowerCase(), trimmed(row.object).toLowerCase()]),
	);
	const found = [];
	const seen = new Set();
	const source = typeof body === 'string' ? body : '';
	const patterns = [/`([^`\n]{2,60})`/g, /"([^"\n]{2,60})"/g, /\b((?:[A-Z][\w-]+)(?:\s+[A-Z][\w-]+){0,3})\b/g];
	for (const pattern of patterns) {
		for (const [, phrase] of source.matchAll(pattern)) {
			const value = phrase.trim();
			const key = value.toLowerCase();
			if (value.length < 2 || seen.has(key) || endpoints.has(key)) continue;
			seen.add(key);
			found.push(value);
			if (found.length >= 12) return found;
		}
	}
	return found;
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
 * @param {string|null} props.memoryId  null for a create, which is the same form in an empty state
 * @param {object} props.session        the launch readings; every vocabulary comes from here
 * @param {Array}  props.rows           the listing already in this browser, for SUGGESTIONS only
 * @param {(memoryId: string|null) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export function MemoryEditor({ memoryId = null, session, rows, onSaved, onCancel, onOpen, onReopen }) {
	const creating = memoryId === null;

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
	const [staleBadge, setStaleBadge] = useState(null);
	const [declarationPrompt, setDeclarationPrompt] = useState(null);
	const [learnedCaps, setLearnedCaps] = useState(null);
	const [preview, setPreview] = useState(false);

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

	// ------------------------------------------------------------------------- derived state

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
			.map(([value, count]) => ({ value, count, in_schema: true }))
			.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
		const seen = new Set(ranked.map((entry) => entry.value));
		for (const value of contract?.declarable_memory_types ?? contract?.memory_types ?? []) {
			if (!seen.has(value)) ranked.push({ value, count: 0, in_schema: true });
		}
		return ranked;
	}, [rows, contract]);

	const surfaceOptions = useMemo(() => vault.surfaces.slice(0, SUGGESTION_LIMIT), [vault]);

	const blockers = useMemo(() => (buffer ? saveBlockers(buffer) : []), [buffer]);
	const duplicates = useMemo(() => (buffer ? duplicateFactRows(buffer.facts) : new Set()), [buffer]);
	const undeclared = useMemo(() => (buffer ? undeclaredSurfaces(buffer) : null), [buffer]);
	const declaredCount = useMemo(
		() => (buffer ? buffer.entities.filter((row) => trimmed(row.n)).length : 0),
		[buffer],
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

	const proseDirty = Boolean(buffer && baseline && buffer.body !== baseline.body);
	const structureDirty = Boolean(
		buffer && baseline && structureSignature(buffer) !== structureSignature(baseline),
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
	 * NEW names and NEW relations one save may mint, and the engine reports against it rather than
	 * refusing. They must never share a number on screen — the consequences are not the same and a
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

	const mentions = useMemo(
		() => (buffer ? unlinkedMentions(buffer.body, buffer.facts) : []),
		[buffer],
	);

	const refusedRows = useMemo(
		() => (result?.refused_facts && buffer ? refusalsByRow(result.refused_facts, buffer.facts) : new Map()),
		[result, buffer],
	);

	const factCap = learnedCaps?.facts ?? null;
	const atCap = factCap !== null && completeFacts.length >= factCap;

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
	const addEntity = useCallback(
		(names) => {
			const seeds = (Array.isArray(names) ? names : [names]).filter((name) => typeof name === 'string');
			setBuffer((current) => {
				if (!current) return current;
				const existing = new Set(current.entities.map((row) => trimmed(row.n).toLowerCase()));
				const additions = (seeds.length > 0 ? seeds : ['']).filter(
					(name) => name === '' || !existing.has(name.trim().toLowerCase()),
				);
				return { ...current, entities: [...current.entities, ...additions.map((name) => emptyEntityRow(name))] };
			});
		},
		[],
	);

	const requestEntity = useCallback(
		(seed = '') => {
			if (declaredCount === 0) {
				setDeclarationPrompt({ kind: 'first', seed, surfaces: mentionedSurfaces(buffer?.facts ?? []) });
				return;
			}
			addEntity(seed);
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
		async (body, sentBuffer, submitted, droppedByClient = []) => {
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
					setConflict({
						loaded: expectedVersion,
						current: currentVersion,
						theirs,
						sentence,
						merge: null,
					});
					setStaleBadge(currentVersion);
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
					raw: body,
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
					write,
					sentence:
						`The engine reported the outcome "${write.effect ?? 'nothing at all'}", which this ` +
						`build does not know how to read. It is NOT being shown as a success. Re-open this ` +
						`memory and check what is there before changing anything else.`,
				});
				return;
			}

			// Committed. The version has moved, so a follow-up save — including the resend below —
			// guards against the version this write returned and not the one the form loaded.
			if (write.version_id) setExpectedVersion(write.version_id);
			setStaleBadge(null);
			const savedBuffer = { ...sentBuffer, body: composeBody({ body: sentBuffer.body, title: sentBuffer.title }) };
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

			setResult({ kind: 'committed', write, submitted, droppedByClient });
		},
		[memoryId, expectedVersion],
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
				const { delta, dropped } = toSemanticDelta(sent, fields, projectOntoContract);
				const content_md = composeBody({ body: sent.body, title: sent.title });
				const submitted = delta.facts?.length ?? 0;

				const body = creating
					? await createMemory({ content_md, semantic_delta: delta })
					: await saveMemory(memoryId, {
							content_md,
							semantic_delta: delta,
							expected_version_id: versionOverride ?? expectedVersion,
						});
				await readResponse(body, sent, submitted, dropped);
			} catch (error) {
				setResult({
					kind: 'transport',
					sentence:
						error instanceof SidecarError
							? error.message
							: (error?.message ?? 'The save could not be sent.'),
					error,
				});
			} finally {
				setSaving(false);
			}
		},
		[buffer, fields, creating, memoryId, expectedVersion, denied, readResponse],
	);

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
			setResult({
				kind: 'declare_then_save',
				surfaces,
				sentence:
					'Each of these now has a row in Named things. Give every one a kind and a one-line ' +
					'"what this is" — the gloss is what decides whether it joins the thing already in your ' +
					'vault or starts a second copy of it — then save again.',
			});
		},
		[buffer],
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
				action={
					<button type="button" className="button" onClick={onCancel}>
						Back
					</button>
				}
			/>
		);
	}

	if (loadError) {
		return (
			<ErrorState
				heading="This memory could not be opened for editing"
				error={loadError}
				action={
					<button type="button" className="button" onClick={onCancel}>
						Back
					</button>
				}
			/>
		);
	}

	if (!buffer) return <LoadingState what="Loading this memory the way a save needs it" />;

	// ------------------------------------------------------------------------- the screen

	/**
	 * A create that COMMITTED has produced a memory, and this form still names none.
	 *
	 * Pressing Save again from here would not update what was just written — it would write a
	 * SECOND memory, because a create carries no id and the engine derives one from the write. So
	 * the form stops accepting saves at that point and the receipt offers the only two honest
	 * continuations: leave, or re-open the memory that now exists through the door an edit loads
	 * from.
	 */
	const createdId = creating && result?.kind === 'committed' ? (result.write?.memory_id ?? null) : null;

	const saveDisabled = saving || blockers.length > 0 || reservedRows.size > 0 || Boolean(createdId);

	return (
		<div className="editor">
			<EditorHeader
				creating={creating}
				title={buffer.title}
				expectedVersion={expectedVersion}
				staleBadge={staleBadge}
				dirty={proseDirty || structureDirty}
				saving={saving}
				saveDisabled={saveDisabled}
				onSave={() => performSave()}
				onCancel={onCancel}
			/>

			{record?.dropped_fields?.length ? (
				<p className="editor-note-line">
					This memory carries {record.dropped_fields.length} field
					{record.dropped_fields.length === 1 ? '' : 's'} the write contract does not accept, and they
					are not part of what a save sends. They are derived values the engine recomputes:{' '}
					<span className="muted">{record.dropped_fields.join(', ')}</span>
				</p>
			) : null}

			<Outcome
				result={result}
				createdId={createdId}
				onDeclare={declareAndResend}
				onResend={() => performSave()}
				onDismiss={() => setResult(null)}
				onDone={() => onSaved(result?.write?.memory_id ?? memoryId)}
				onReopen={onReopen}
				onOpen={onOpen}
			/>

			{conflict ? (
				<ConflictDialog
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
						setStaleBadge(null);
						setConflict(null);
					}}
					onMerge={(merged) => {
						setBuffer(merged);
						setExpectedVersion(conflict.current);
						setConflict(null);
					}}
					onLater={() => setConflict(null)}
				/>
			) : null}

			{declarationPrompt ? (
				<DeclarationDialog
					prompt={declarationPrompt}
					onDeclareAll={(surfaces) => {
						addEntity(surfaces);
						setDeclarationPrompt(null);
					}}
					onDeclareOne={(seed) => {
						addEntity(seed);
						setDeclarationPrompt(null);
					}}
					onRemoveLast={(id) => {
						setBuffer((current) =>
							current ? { ...current, entities: current.entities.filter((row) => row.id !== id) } : current,
						);
						setDeclarationPrompt(null);
					}}
					onCancel={() => setDeclarationPrompt(null)}
				/>
			) : null}

			<div className="editor-head-fields">
				<label className="editor-field editor-field-title">
					<span className="editor-label">
						Title <em>required</em>
					</span>
					<input
						type="text"
						className="editor-input"
						value={buffer.title}
						autoFocus={creating}
						onChange={(event) => patch({ title: event.target.value })}
						aria-invalid={blockers.some((entry) => entry.field === 'title') || undefined}
					/>
					<FieldError blockers={blockers} field="title" />
				</label>

				<label className="editor-field">
					<span className="editor-label">
						Type <em>required</em>
					</span>
					<OpenValueInput
						value={buffer.memory_type}
						options={typeOptions}
						listId="editor-memory-types"
						onChange={(value) => patch({ memory_type: value })}
					/>
					<FieldError blockers={blockers} field="memory_type" />
					<span className="editor-help">
						Types persist. Reuse one rather than coining a near-synonym — no operation takes a type
						back, and reclassifying moves which memories this one is ever compared against.
					</span>
				</label>

				<fieldset className="editor-field editor-scope">
					<legend className="editor-label">Applies to</legend>
					{axes.map((axis) => {
						const copy = axisCopy(axis);
						const value = buffer.scope?.[axis] ?? null;
						return (
							<label key={axis} className="editor-scope-axis">
								<span>{copy.label}</span>
								<input
									type="text"
									className="editor-input"
									value={value ?? ''}
									placeholder={copy.every}
									onChange={(event) =>
										patch({
											scope: { ...buffer.scope, [axis]: event.target.value === '' ? null : event.target.value },
										})
									}
								/>
							</label>
						);
					})}
					<span className="editor-help">
						An empty axis matches <strong>every</strong> request. Setting one narrows this memory to
						exactly that value.
					</span>
				</fieldset>
			</div>

			{/*
			  TWO COLUMNS, BOTH ON SCREEN, ALWAYS. The prose and the facts drifting apart is the main
			  authoring hazard in this product — a rewritten paragraph changes what the memory is found
			  by, while the facts an agent reasons on still say the old thing, and nothing reconciles
			  them. Adjacency is the whole mitigation. On a narrow viewport these stack FACTS FIRST.
			*/}
			<div className="editor-columns">
				<section className="editor-note" aria-label="Note">
					<div className="editor-panel-head">
						<h2>Note</h2>
						<div className="editor-panel-actions">
							<button type="button" className="linklike" onClick={() => setPreview((on) => !on)}>
								{preview ? 'Edit' : 'Preview'}
							</button>
						</div>
					</div>

					{preview ? (
						<div className="editor-preview">
							<Markdown source={composed} />
						</div>
					) : (
						<textarea
							className="editor-body"
							value={buffer.body}
							spellCheck="true"
							onChange={(event) => patch({ body: event.target.value })}
							placeholder="What happened, in your words. The heading is written for you from the title."
						/>
					)}

					<div className="editor-body-meta">
						<span>{buffer.body.length.toLocaleString()} characters</span>
						{byteCeiling ? (
							<span className={bytes > byteCeiling ? 'is-over' : bytes > byteCeiling * AMBER_AT ? 'is-amber' : ''}>
								{bytes.toLocaleString()} of {byteCeiling.toLocaleString()} bytes
							</span>
						) : (
							<span>{bytes.toLocaleString()} bytes</span>
						)}
						{composed !== buffer.body ? (
							<span className="editor-heading-hint">
								A <code>#</code> heading is added from the title when this saves.
							</span>
						) : null}
					</div>

					{byteCeiling && bytes > byteCeiling ? (
						<p className="editor-inline-error">
							This note is too long to save — split it into two memories. The engine's request
							ceiling is {byteCeiling.toLocaleString()} bytes and this is {bytes.toLocaleString()}.
						</p>
					) : null}

					{/*
					  The DIRTY-PROSE HINT. It never blocks: many prose edits are genuinely typo fixes and
					  a modal on every one of them is a modal nobody reads.
					*/}
					{proseDirty && !structureDirty ? (
						<p className="editor-hint">
							You changed the note and not the facts. That is often right — but a save replaces
							both, so the facts on the right are what an agent will still read back.
						</p>
					) : null}

					{mentions.length > 0 ? (
						<div className="editor-mentions">
							<span className="editor-mentions-label">Mentioned in the note, not in any fact:</span>
							{mentions.map((phrase) => (
								<button
									key={phrase}
									type="button"
									className="editor-mention"
									onClick={() => addFact({ subject: phrase })}
									title="Open a fact row with this as the subject"
								>
									{phrase}
								</button>
							))}
						</div>
					) : null}
				</section>

				<section className="editor-structure" aria-label="Facts and named things">
					<FactsPanel
						buffer={buffer}
						completeFacts={completeFacts}
						factCap={factCap}
						atCap={atCap}
						duplicates={duplicates}
						reservedRows={reservedRows}
						refusedRows={refusedRows}
						undeclared={undeclared}
						blockers={blockers}
						predicateOptions={predicateOptions}
						surfaceOptions={surfaceOptions}
						closed={contract?.closed ?? {}}
						// Tier C and only tier C. Everywhere a closed list would be a menu, this decides
						// whether the menu is offered at all — one switch, read once, rather than a
						// judgement made again at each control.
						vocabularyVerified={session?.compatibility?.vocabulary_verified !== false}
						onAdd={() => addFact()}
						onPatch={patchFact}
						onRemove={removeFact}
						onDeclare={(surface) => requestEntity(surface)}
					/>

					<EntitiesPanel
						buffer={buffer}
						declaredCount={declaredCount}
						minting={minting}
						blockers={blockers}
						kindOptions={kindOptions}
						vault={vault}
						onAdd={() => requestEntity('')}
						onPatch={patchEntity}
						onRemove={removeEntity}
					/>

					<CarriedPanel carried={buffer.carried} />
				</section>
			</div>

			{/*
			  * TWO SENTENCES, AND BOTH ARE MEASURED.
			  *
			  * The first was true before the snapshot spine existed and is still true: no published
			  * operation returns a prior version of a memory to service, and a copy on this machine
			  * cannot be put back — the import door refuses a per-memory export outright, and refuses
			  * a whole-vault one over a vault that already holds the record. That is
			  * docs/RESTORE-EXPERIMENT.md, and test/restore.test.mjs asserts it on every run.
			  *
			  * The second is the honest half of what the spine bought: the bytes exist, they are
			  * outside the vault, and a person can read them and save them. Saying more than that
			  * here — "you can undo this" — is the exact failure PRD 0004 exists to prevent, and the
			  * copy may only change when that test goes red.
			  */}
			<p className="editor-undo">
				<strong>There is no undo.</strong> A save replaces what is there, and no published
				operation puts an earlier version back. This app does keep a copy of the memory as it
				was, on this machine and outside your vault, which you can read and save to a file —
				but returning it to service is not something the memory engine can do.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Header and save bar
// ---------------------------------------------------------------------------------------------

function EditorHeader({
	creating,
	title,
	expectedVersion,
	staleBadge,
	dirty,
	saving,
	saveDisabled,
	onSave,
	onCancel,
}) {
	return (
		<header className="editor-head">
			<div className="editor-head-left">
				<h1>{creating ? 'New memory' : `Editing ${trimmed(title) || 'this memory'}`}</h1>
				{creating ? null : (
					<span className="editor-version">
						replacing <Identifier value={expectedVersion} label="expected version" />
					</span>
				)}
				{staleBadge ? (
					<span className="editor-stale">
						the vault has moved to <Identifier value={staleBadge} label="current version" /> — saving
						will ask again
					</span>
				) : null}
			</div>
			<div className="editor-head-right">
				{dirty ? <span className="editor-dirty">unsaved changes</span> : null}
				<button type="button" className="button" onClick={onCancel} disabled={saving}>
					Cancel
				</button>
				<button type="button" className="button button-primary" onClick={onSave} disabled={saveDisabled}>
					{saving ? 'Saving…' : creating ? 'Create' : 'Save'}
				</button>
			</div>
		</header>
	);
}

function FieldError({ blockers, field }) {
	const matches = blockers.filter((entry) => entry.field === field);
	if (matches.length === 0) return null;
	return (
		<span className="editor-inline-error" role="alert">
			{matches.map((entry) => entry.message).join(' ')}
		</span>
	);
}

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

function FactsPanel({
	buffer,
	completeFacts,
	factCap,
	atCap,
	duplicates,
	reservedRows,
	refusedRows,
	undeclared,
	blockers,
	predicateOptions,
	surfaceOptions,
	closed,
	vocabularyVerified,
	onAdd,
	onPatch,
	onRemove,
	onDeclare,
}) {
	return (
		<div className="editor-panel">
			<div className="editor-panel-head">
				<h2>Facts</h2>
				<span className="editor-count">
					{completeFacts.length}
					{factCap === null ? '' : ` / ${factCap}`}
				</span>
				<div className="editor-panel-actions">
					<button type="button" className="button" onClick={onAdd} disabled={atCap}>
						+ Add fact
					</button>
				</div>
			</div>

			{atCap ? (
				<p className="editor-inline-error">
					This memory is at the {factCap}-fact limit the engine named. Split it into two memories.
				</p>
			) : null}

			<FieldError blockers={blockers} field="facts" />

			<ul className="editor-facts">
				{buffer.facts.map((row) => (
					<FactRow
						key={row.id}
						row={row}
						duplicate={duplicates.has(row.id)}
						reserved={reservedRows.get(row.id) ?? null}
						refused={refusedRows.get(row.id) ?? null}
						undeclared={undeclared}
						predicateOptions={predicateOptions}
						surfaceOptions={surfaceOptions}
						closed={closed}
						vocabularyVerified={vocabularyVerified}
						onPatch={onPatch}
						onRemove={() => onRemove(row.id)}
						onDeclare={onDeclare}
					/>
				))}
			</ul>

			{/*
			  `null` is not zero and they render differently. Zero means the check ran and found
			  nothing; null means the memory declares nothing at all, in which case every fact commits
			  and every name is matched loosely — and flagging them would be an outage, not a guard.
			*/}
			{undeclared === null ? (
				<p className="editor-hint">
					This memory declares no named things, so every fact commits and each name is matched on
					its characters alone. Declaring one changes that for all of them.
				</p>
			) : undeclared.length > 0 ? (
				<p className="editor-inline-error">
					{undeclared.length} name{undeclared.length === 1 ? '' : 's'} used by a fact here{' '}
					{undeclared.length === 1 ? 'is' : 'are'} not declared below. Because this memory declares
					something, {undeclared.length === 1 ? 'that fact' : 'those facts'} will be dropped while
					the rest of the memory commits.
				</p>
			) : null}
		</div>
	);
}

function FactRow({
	row,
	duplicate,
	reserved,
	refused,
	undeclared,
	predicateOptions,
	surfaceOptions,
	closed,
	vocabularyVerified,
	onPatch,
	onRemove,
	onDeclare,
}) {
	const [open, setOpen] = useState(false);
	const undeclaredHere = (undeclared ?? []).filter((surface) =>
		[trimmed(row.subject).toLowerCase(), trimmed(row.object).toLowerCase()].includes(
			surface.toLowerCase(),
		),
	);

	const classes = ['editor-fact'];
	if (duplicate) classes.push('is-duplicate');
	if (reserved) classes.push('is-refused');
	if (refused) classes.push('is-refused');

	return (
		<li className={classes.join(' ')}>
			<div className="editor-triple">
				<SurfaceInput
					label="Subject"
					value={row.subject}
					options={surfaceOptions}
					onChange={(value) => onPatch(row.id, { subject: value })}
				/>
				<RelationInput
					value={row.predicate}
					options={predicateOptions}
					onChange={(value) => onPatch(row.id, { predicate: value })}
				/>
				<SurfaceInput
					label="Object"
					value={row.object}
					options={surfaceOptions}
					onChange={(value) => onPatch(row.id, { object: value })}
				/>
				<div className="editor-fact-actions">
					<button
						type="button"
						className="linklike"
						aria-expanded={open}
						onClick={() => setOpen((on) => !on)}
						title="Qualifiers: how this is known, what kind of claim it is, and when it holds"
					>
						⋯
					</button>
					<button type="button" className="linklike" onClick={onRemove} title="Remove this fact">
						✕
					</button>
				</div>
			</div>

			{reserved ? (
				<p className="editor-inline-error" role="alert">
					{reservedRelationAdvice(reserved)}
				</p>
			) : null}

			{duplicate ? (
				<p className="editor-inline-error">
					Another row states the same thing. Two identical facts are either collapsed into one or
					refused, depending on how they are numbered — neither is an outcome to find on a receipt.
				</p>
			) : null}

			{refused ? (
				<p className="editor-inline-error" role="alert">
					Not stored: this memory declares nothing about {refused.surfaces.join(', ')}.{' '}
					{refused.surfaces.map((surface) => (
						<button key={surface} type="button" className="linklike" onClick={() => onDeclare(surface)}>
							Declare “{surface}”
						</button>
					))}
				</p>
			) : null}

			{!refused && undeclaredHere.length > 0 ? (
				<p className="editor-warn-line">
					Not declared:{' '}
					{undeclaredHere.map((surface) => (
						<button key={surface} type="button" className="linklike" onClick={() => onDeclare(surface)}>
							{surface}
						</button>
					))}
				</p>
			) : null}

			{open ? (
				<Qualifiers
					row={row}
					closed={closed}
					vocabularyVerified={vocabularyVerified}
					onPatch={onPatch}
				/>
			) : null}
		</li>
	);
}

/**
 * The qualifiers, behind a per-row disclosure so the common case is three fields.
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
		<div className="editor-qualifiers">
			<label className="editor-qualifier">
				<span>What kind of claim</span>
				<ClosedValueSelect
					verified={vocabularyVerified}
					value={q.mode ?? ''}
					values={closed['semantic_delta.facts.mode'] ?? []}
					onChange={(value) => setQualifier('mode', value)}
				/>
			</label>

			<label className="editor-qualifier">
				<span>How it is known</span>
				<ClosedValueSelect
					verified={vocabularyVerified}
					value={q.basis ?? ''}
					values={closed['semantic_delta.facts.basis'] ?? []}
					onChange={(value) => setQualifier('basis', value)}
				/>
			</label>

			{['from', 'until'].map((key) => (
				<div key={key} className="editor-qualifier editor-qualifier-time">
					<span>{key === 'from' ? 'True from' : 'True until'}</span>
					<input
						type="text"
						className="editor-input"
						value={time(key).t ?? ''}
						placeholder="2026, 2026-03, 2026-03-15…"
						onChange={(event) => setTime(key, 't', event.target.value)}
					/>
					<ClosedValueSelect
						verified={vocabularyVerified}
						value={time(key).grain ?? ''}
						values={closed['semantic_delta.facts.from.grain'] ?? []}
						onChange={(value) => setTime(key, 'grain', value)}
					/>
				</div>
			))}

			{about.length > 0 ? (
				<div className="editor-qualifier editor-qualifier-about">
					<span>Qualifiers on this fact</span>
					<ul className="plain">
						{about.map(([key, value]) => (
							<li key={key}>
								<span className="key">{key}</span>{' '}
								<span className="muted">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
							</li>
						))}
					</ul>
					<span className="editor-help">
						Preserved exactly and not editable here. Each key carries a declared class that decides
						whether its value is resolved or validated, and this screen cannot supply one.
					</span>
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Named things
// ---------------------------------------------------------------------------------------------

function EntitiesPanel({
	buffer,
	declaredCount,
	minting,
	blockers,
	kindOptions,
	vault,
	onAdd,
	onPatch,
	onRemove,
}) {
	return (
		<div className="editor-panel">
			<div className="editor-panel-head">
				<h2>Named things</h2>
				<span className="editor-count">{declaredCount}</span>
				<div className="editor-panel-actions">
					<button type="button" className="button" onClick={onAdd}>
						+ Declare
					</button>
				</div>
			</div>

			{/*
			  THE SECOND COUNTER. Not the caps — those are refusals. This is the per-write budget for
			  what one save MINTS, which the engine reports against rather than refusing, and the two
			  must never share a number.
			*/}
			{minting.names.length > 0 || minting.relations.length > 0 ? (
				<p className="editor-hint">
					This save would create {minting.names.length} name
					{minting.names.length === 1 ? '' : 's'} and {minting.relations.length} relation
					{minting.relations.length === 1 ? '' : 's'} this vault has never seen. Reusing a name that
					already exists is what makes a fact join the rest of the vault rather than start an island.
				</p>
			) : null}

			<ul className="editor-entities">
				{buffer.entities.map((row) => (
					<EntityRow
						key={row.id}
						row={row}
						blockers={blockers}
						kindOptions={kindOptions}
						known={knownName(vault, row.n)}
						onPatch={onPatch}
						onRemove={() => onRemove(row.id)}
					/>
				))}
			</ul>

			{declaredCount === 0 ? (
				<p className="editor-hint">
					Nothing is declared, so every fact commits and each name is matched on its characters
					alone. Declaring the first one changes that for every fact in this memory.
				</p>
			) : null}
		</div>
	);
}

/**
 * One declaration: the name as the facts spell it, the gloss, and the kind — in that order.
 *
 * The gloss is not last and is not styled as optional, because it is not documentation. It is what
 * the matcher probes with, and it is the field that decides whether this name joins the thing
 * already in the graph or starts a second copy of it. The door requires it; the form must not be
 * gentler than the door.
 */
function EntityRow({ row, blockers, kindOptions, known, onPatch, onRemove }) {
	const rowBlockers = blockers.filter((entry) => entry.field === `entity:${row.id}`);
	const suggestion = known?.glosses?.[0] ?? null;

	return (
		<li className={`editor-entity${rowBlockers.length > 0 ? ' is-invalid' : ''}`}>
			<div className="editor-entity-grid">
				<label className="editor-field">
					<span className="editor-label">Name, as the facts spell it</span>
					<input
						type="text"
						className="editor-input"
						value={row.n}
						onChange={(event) => onPatch(row.id, { n: event.target.value })}
					/>
				</label>

				<label className="editor-field editor-field-gloss">
					<span className="editor-label">
						What this is <em>required</em>
					</span>
					<input
						type="text"
						className="editor-input"
						value={row.is}
						placeholder="What the matcher probes with — a bare name matches on its characters alone"
						onChange={(event) => onPatch(row.id, { is: event.target.value })}
						aria-invalid={rowBlockers.length > 0 || undefined}
					/>
					<span className="editor-help">
						This decides whether the name joins the thing already in your vault or starts a second
						copy of it. It is not a description.
					</span>
				</label>

				<label className="editor-field editor-field-kind">
					<span className="editor-label">
						Kind <em>required</em>
					</span>
					<OpenValueInput
						value={row.kind}
						options={kindOptions}
						listId={`editor-kinds-${row.id}`}
						onChange={(value) => onPatch(row.id, { kind: value })}
					/>
				</label>

				<div className="editor-entity-actions">
					<button type="button" className="linklike" onClick={onRemove} title="Remove this declaration">
						✕
					</button>
				</div>
			</div>

			{rowBlockers.length > 0 ? (
				<p className="editor-inline-error" role="alert">
					{rowBlockers.map((entry) => entry.message).join(' ')}
				</p>
			) : null}

			{known ? (
				<div className="editor-known">
					<span>
						{known.memories} other memor{known.memories === 1 ? 'y' : 'ies'} in this vault use this
						exact name.
					</span>
					{suggestion && trimmed(row.is) !== suggestion.gloss ? (
						<button
							type="button"
							className="linklike"
							onClick={() =>
								onPatch(row.id, {
									is: suggestion.gloss,
									kind: trimmed(row.kind) || (known.kinds[0]?.kind ?? ''),
								})
							}
						>
							Use the gloss {suggestion.count} of them use
						</button>
					) : null}
					{known.conflicted ? (
						<span className="editor-warn-line">
							This name is already glossed {known.glosses.length} different ways here, which is what
							one thing spelled twice looks like — and also what two different things sharing a name
							looks like. Only you can tell which.
						</span>
					) : null}
				</div>
			) : null}
		</li>
	);
}

/** Everything on the loaded delta this version has no control for, carried through untouched. */
function CarriedPanel({ carried }) {
	const keys = Object.keys(carried ?? {}).filter((key) => {
		const value = carried[key];
		if (value === null || value === undefined) return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === 'object') return Object.values(value).some((item) => item !== null);
		return true;
	});
	if (keys.length === 0) return null;
	return (
		<div className="editor-panel editor-carried">
			<h2>Carried through unchanged</h2>
			<p className="editor-help">
				This memory also holds {keys.join(', ')}. This version has no control for{' '}
				{keys.length === 1 ? 'it' : 'them'}, so {keys.length === 1 ? 'it is' : 'they are'} sent back
				exactly as {keys.length === 1 ? 'it' : 'they'} arrived — not defaulted, not invented, and not
				dropped.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Value controls
// ---------------------------------------------------------------------------------------------

/**
 * An OPEN registry: free text with a suggestion list, and a value the schema never named is kept.
 *
 * The vault routinely holds values the schema does not list — that is what an open registry means —
 * so an existing value renders as itself, stays selected, and is marked rather than rewritten.
 */
function OpenValueInput({ value, options, listId, onChange, placeholder }) {
	const match = options.find((entry) => entry.value === value);
	const unlisted = trimmed(value).length > 0 && !match;
	return (
		<>
			<input
				type="text"
				className="editor-input"
				list={listId}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
			/>
			<datalist id={listId}>
				{options.slice(0, SUGGESTION_LIMIT).map((entry) => (
					<option key={entry.value} value={entry.value}>
						{entry.count > 0 ? `${entry.count} in this vault` : 'from the engine'}
					</option>
				))}
			</datalist>
			{unlisted ? <span className="editor-unlisted">new to this vault</span> : null}
			{match && !match.in_schema ? <span className="editor-unlisted">used in this vault</span> : null}
		</>
	);
}

/**
 * The relation control. It EXCLUDES the reserved set and the save refuses it on submit.
 *
 * A reserved name does not produce a clean refusal: the memory commits and its graph entry fails
 * under its own error code, and no published operation repairs that. So it is kept out of the list
 * and checked again at save time, because a list is not a control against a paste.
 */
function RelationInput({ value, options, onChange }) {
	const listId = useId();
	return (
		<label className="editor-triple-part editor-triple-relation">
			<span className="editor-label">Relation</span>
			<OpenValueInput value={value} options={options} listId={listId} onChange={onChange} />
		</label>
	);
}

function SurfaceInput({ label, value, options, onChange }) {
	const listId = useId();
	return (
		<label className="editor-triple-part">
			<span className="editor-label">{label}</span>
			<input
				type="text"
				className="editor-input"
				list={listId}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
			<datalist id={listId}>
				{options.map((entry) => (
					<option key={entry.value} value={entry.value} />
				))}
			</datalist>
		</label>
	);
}

/**
 * A CLOSED list. A value the record carries that the schema does not name is kept and marked.
 *
 * The record is the truth and the schema is the newer artefact, so the value stays selected and the
 * save is allowed. Blanking it, or mapping it to a near neighbour, would rewrite the user's memory
 * to match a list.
 */
function ClosedValueSelect({ value, values, verified = true, onChange }) {
	const current = trimmed(value);
	const unrecognised = current.length > 0 && !values.includes(current);

	// TIER B: THE MENU BECOMES A TEXT BOX.
	//
	// The list came out of a write contract this build has not been tested against, so it may be
	// SHORT rather than wrong — and a short menu is the worse failure of the two, because it looks
	// authoritative. A user who cannot find the value they mean in a dropdown concludes it is not
	// allowed; a user looking at a text box with suggestions beside it types the value they meant.
	//
	// What it never does is substitute a list this app wrote down. A bundled vocabulary standing in
	// for a failed parse is the exact drift that reading the contract at run time exists to prevent.
	if (!verified) {
		const listId = `unverified-${values.join('-').replace(/[^a-z0-9-]/gi, '') || 'none'}`;
		return (
			<>
				<input
					type="text"
					className="editor-input"
					value={current}
					list={values.length > 0 ? listId : undefined}
					onChange={(event) => onChange(event.target.value)}
				/>
				{values.length > 0 ? (
					<datalist id={listId}>
						{values.map((option) => (
							<option key={option} value={option} />
						))}
					</datalist>
				) : null}
				<span className="editor-unlisted">
					{values.length > 0
						? `unverified — this engine's contract is not one this build was tested against. ${values.join(', ')} is what could still be read out of it.`
						: 'unverified — nothing could be read out of this engine\u2019s contract for this field.'}
				</span>
			</>
		);
	}

	return (
		<>
			<select className="editor-input" value={current} onChange={(event) => onChange(event.target.value)}>
				<option value="">not recorded</option>
				{values.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
				{unrecognised ? (
					<option value={current}>{current} — not in this engine's list</option>
				) : null}
			</select>
			{unrecognised ? <span className="editor-unlisted">kept as it is</span> : null}
		</>
	);
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

/**
 * What a save did, branched EXHAUSTIVELY.
 *
 * A save has three success-ish endings and several failures, and the one this component exists for
 * is the middle one: the write committed and stored fewer facts than it was sent. That is neither
 * "Saved" nor "Save failed" and both would be false.
 */
function Outcome({ result, createdId, onDeclare, onResend, onDismiss, onDone, onOpen, onReopen }) {
	if (!result) return null;

	if (result.kind === 'committed') {
		const write = result.write;
		const named = write.named_things;
		return (
			<div className="editor-outcome is-good" role="status">
				<h2>Saved</h2>
				<p>
					<Identifier value={write.version_id} label="new version" />
					{named && (named.created !== null || named.matched !== null) ? (
						<>
							{' · '}
							{named.created ?? 0} named thing{(named.created ?? 0) === 1 ? '' : 's'} created,{' '}
							{named.matched ?? 0} matched to things already in this vault
						</>
					) : null}
					{write.stored_claim_count === null ? null : (
						<>
							{' · '}
							{write.stored_claim_count} fact{write.stored_claim_count === 1 ? '' : 's'} stored
						</>
					)}
				</p>
				{write.over_budget ? (
					<p className="editor-warn-line">
						This save minted more than one write's budget for new names and relations. Nothing was
						refused; the engine reported it.
					</p>
				) : null}
				<div className="editor-outcome-actions">
					<button type="button" className="button button-primary" onClick={onDone}>
						Done
					</button>
					{createdId ? (
						<button type="button" className="button" onClick={() => onReopen(createdId)}>
							Keep editing this memory
						</button>
					) : (
						<button type="button" className="button" onClick={onDismiss}>
							Keep editing
						</button>
					)}
				</div>
			</div>
		);
	}

	if (result.kind === 'no_change') {
		return (
			<div className="editor-outcome" role="status">
				<h2>No change — a memory with this content already exists</h2>
				<p>
					Nothing was written, and that is the correct outcome rather than a failure. The vault
					already holds this exact content, so the engine returned the existing record instead of
					storing a second copy of it.
				</p>
				{result.write.memory_id ? (
					<p>
						It is <Identifier value={result.write.memory_id} label="memory id" />
						{onOpen ? (
							<>
								{' '}
								<button type="button" className="linklike" onClick={() => onOpen(result.write.memory_id)}>
									Open it
								</button>
							</>
						) : null}
					</p>
				) : null}
				<div className="editor-outcome-actions">
					<button type="button" className="button" onClick={onDismiss}>
						Keep editing
					</button>
				</div>
			</div>
		);
	}

	if (result.kind === 'partial') {
		const surfaces = refusedSurfaces(result.refused_facts);
		const stored = result.write.stored_claim_count ?? '—';
		return (
			<div className="editor-outcome is-partial" role="alert">
				<h2>
					Saved — but {result.refused_facts.length} of {result.submitted} facts were not stored
				</h2>
				<p>
					The note, the title and {stored} fact{stored === 1 ? '' : 's'} were saved as{' '}
					<Identifier value={result.write.version_id} label="new version" />. These were dropped
					because they name something this memory does not declare:
				</p>
				<ul className="editor-dropped">
					{result.refused_facts.map((refusal, index) => (
						<li key={index}>
							<span className="muted">
								{(refusal.undeclared ?? []).join(', ') || 'a name this memory does not declare'}
							</span>
							{refusal.reason ? <span className="editor-help"> {refusal.reason}</span> : null}
						</li>
					))}
				</ul>
				<p className="editor-help">
					The rows those names appear on are marked in the fact list. They are matched by the name
					itself and not by the position the refusal reports, because that position does not
					correspond to the order the facts were sent in.
				</p>
				<div className="editor-outcome-actions">
					<button type="button" className="button button-primary" onClick={() => onDeclare(surfaces)}>
						Declare {surfaces.length === 1 ? 'it' : `all ${surfaces.length}`} and re-save
					</button>
					<button type="button" className="button" onClick={onDismiss}>
						Leave them out
					</button>
				</div>
			</div>
		);
	}

	if (result.kind === 'declare_then_save') {
		return (
			<div className="editor-outcome" role="status">
				<h2>{result.surfaces.length} declaration{result.surfaces.length === 1 ? '' : 's'} added</h2>
				<p>{result.sentence}</p>
				<div className="editor-outcome-actions">
					<button type="button" className="button button-primary" onClick={onResend}>
						Save again
					</button>
					<button type="button" className="button" onClick={onDismiss}>
						Not yet
					</button>
				</div>
			</div>
		);
	}

	if (result.kind === 'shortfall') {
		return (
			<div className="editor-outcome is-bad" role="alert">
				<h2>The save stored fewer facts than it was sent</h2>
				<p>
					{result.submitted} fact{result.submitted === 1 ? '' : 's'} were submitted and the engine
					reported {result.write.shortfall.stored} stored with{' '}
					{result.write.shortfall.refused} refused. Those numbers do not add up, and this app cannot
					say which facts are in the vault.
				</p>
				<p>
					The memory has been re-read.{' '}
					{result.reread
						? `It now holds ${result.reread.fact_count} fact(s) and ${result.reread.entity_count} declaration(s).`
						: 'That re-read also failed — open this memory again before changing anything else.'}
				</p>
				<div className="editor-outcome-actions">
					<button type="button" className="button" onClick={onDismiss}>
						Dismiss
					</button>
				</div>
			</div>
		);
	}

	if (result.kind === 'fold_failed') {
		return (
			<div className="editor-outcome is-bad" role="alert">
				<h2>The memory was written and its graph entry failed</h2>
				<p>{result.sentence ?? 'The engine reported a fold failure.'}</p>
				<p>
					This is the one outcome that is neither a refusal you can retry nor a success. The memory
					is in the vault with no nodes and no claims, and no published operation repairs that. The
					only recovery is to remove it and write it again.
				</p>
				<div className="editor-outcome-actions">
					<button type="button" className="button" onClick={onDismiss}>
						Dismiss
					</button>
				</div>
			</div>
		);
	}

	if (result.kind === 'reserved_relation') {
		return (
			<div className="editor-outcome is-bad" role="alert">
				<h2>“{result.relation}” cannot be written as a relation</h2>
				<p>{result.sentence}</p>
				<div className="editor-outcome-actions">
					<button type="button" className="button" onClick={onDismiss}>
						Dismiss
					</button>
				</div>
			</div>
		);
	}

	if (result.kind === 'refused') {
		return (
			<div className="editor-outcome is-bad" role="alert">
				<h2>{refusalHeading(result.classified)}</h2>
				{/* The engine's own sentence, whole. It names the repair; a paraphrase of it does not. */}
				<p>{result.sentence ?? 'The engine declined this write and said nothing further.'}</p>
				{result.next ? <p className="editor-help">{result.next}</p> : null}
				{result.classified?.kind === 'all_endpoints_undeclared' &&
				(result.classified.surfaces ?? []).length > 0 ? (
					<div className="editor-outcome-actions">
						<button
							type="button"
							className="button button-primary"
							onClick={() => onDeclare(result.classified.surfaces)}
						>
							Declare all {result.classified.surfaces.length} and continue
						</button>
					</div>
				) : null}
				<div className="editor-outcome-actions">
					<button type="button" className="button" onClick={onDismiss}>
						Dismiss
					</button>
				</div>
			</div>
		);
	}

	// Anything else, including an outcome value this build does not know. LOUD, never a success.
	return (
		<div className="editor-outcome is-bad" role="alert">
			<h2>This save ended in a way this app does not recognise</h2>
			<p>{result.sentence ?? 'No further detail was returned.'}</p>
			<p className="editor-help">
				It is not being shown as a success. Nothing on this screen can say whether the write
				happened, so re-open this memory and check before changing anything else.
			</p>
			<div className="editor-outcome-actions">
				<button type="button" className="button" onClick={onDismiss}>
					Dismiss
				</button>
			</div>
		</div>
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
// The conflict
// ---------------------------------------------------------------------------------------------

/**
 * Someone else changed this memory while it was open. That is the NORMAL case, not the edge case:
 * agents write this vault while the tab is open.
 *
 * The refusal is exact and names the version that is now current, so there is never a reason to
 * discard a buffer to report it. Exactly one action here throws typing away, and it is the one the
 * user pressed.
 */
function ConflictDialog({ conflict, mine, onKeepMine, onTakeTheirs, onMerge, onLater }) {
	const [merging, setMerging] = useState(false);
	const [picks, setPicks] = useState({});

	const comparison = conflict.theirs ? compareBuffers(mine, conflict.theirs) : null;

	const applyMerge = () => {
		const theirs = conflict.theirs;
		if (!theirs) return;
		const next = { ...mine };
		for (const [field, side] of Object.entries(picks)) {
			if (side === 'mine') continue;
			if (field === 'facts' && side === 'both') {
				const seen = new Set(
					mine.facts.map((row) => `${trimmed(row.subject)}|${trimmed(row.predicate)}|${trimmed(row.object)}`),
				);
				next.facts = [
					...mine.facts,
					...theirs.facts.filter(
						(row) =>
							!seen.has(`${trimmed(row.subject)}|${trimmed(row.predicate)}|${trimmed(row.object)}`),
					),
				];
			} else if (field === 'entities' && side === 'both') {
				const seen = new Set(mine.entities.map((row) => trimmed(row.n).toLowerCase()));
				next.entities = [
					...mine.entities,
					...theirs.entities.filter((row) => !seen.has(trimmed(row.n).toLowerCase())),
				];
			} else if (side === 'theirs') {
				next[field] = theirs[field];
				if (field === 'facts' || field === 'entities') next.carried = theirs.carried;
			}
		}
		onMerge(next);
	};

	return (
		<div className="editor-conflict" role="alertdialog" aria-label="This memory changed while you were editing">
			<h2>Someone else changed this memory while you were editing</h2>
			<p>
				You loaded <Identifier value={conflict.loaded} label="the version you loaded" />. The vault is
				now on <Identifier value={conflict.current} label="the current version" />.{' '}
				<strong>Your edits are safe and still on screen.</strong>
			</p>
			{conflict.sentence ? <p className="editor-help">{conflict.sentence}</p> : null}

			{comparison ? (
				<table className="editor-compare">
					<thead>
						<tr>
							<th>Field</th>
							<th>Theirs</th>
							<th>Yours</th>
							{merging ? <th>Keep</th> : null}
						</tr>
					</thead>
					<tbody>
						{comparison.map((line) => {
							const field = {
								Title: 'title',
								Type: 'memory_type',
								Facts: 'facts',
								'Named things': 'entities',
								Note: 'body',
							}[line.field];
							return (
								<tr key={line.field} className={line.same ? '' : 'is-different'}>
									<th scope="row">{line.field}</th>
									<td>{String(line.theirs)}</td>
									<td>{String(line.mine)}</td>
									{merging ? (
										<td>
											<select
												className="editor-input"
												value={picks[field] ?? 'mine'}
												onChange={(event) => setPicks({ ...picks, [field]: event.target.value })}
											>
												<option value="mine">yours</option>
												<option value="theirs">theirs</option>
												{field === 'facts' || field === 'entities' ? (
													<option value="both">both</option>
												) : null}
											</select>
										</td>
									) : null}
								</tr>
							);
						})}
					</tbody>
				</table>
			) : (
				<p className="editor-warn-line">
					Their version could not be re-read, so there is nothing to compare against. Your buffer is
					untouched — saving again will overwrite whatever is there now.
				</p>
			)}

			<div className="editor-outcome-actions">
				<button type="button" className="button button-primary" onClick={onKeepMine}>
					Keep mine, overwrite theirs
				</button>
				<button type="button" className="button" onClick={onTakeTheirs} disabled={!conflict.theirs}>
					Take theirs, discard mine
				</button>
				{merging ? (
					<button type="button" className="button" onClick={applyMerge} disabled={!conflict.theirs}>
						Apply this merge
					</button>
				) : (
					<button
						type="button"
						className="button"
						onClick={() => setMerging(true)}
						disabled={!conflict.theirs}
					>
						Merge field by field…
					</button>
				)}
				<button type="button" className="button" onClick={onLater}>
					Keep editing, decide later
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// The declaration switch
// ---------------------------------------------------------------------------------------------

/**
 * Crossing the entity-declaration switch, in both directions.
 *
 * It is a switch and not a gradient. Declaring nothing means every fact commits and every name is
 * matched loosely; declaring one thing means every name any fact mentions must be declared or that
 * fact is dropped while the rest of the write commits. So the first declaration is a decision that
 * changes how every OTHER fact in the memory is treated, and the panel says exactly that.
 */
function DeclarationDialog({ prompt, onDeclareAll, onDeclareOne, onRemoveLast, onCancel }) {
	if (prompt.kind === 'last') {
		return (
			<div className="editor-conflict" role="alertdialog" aria-label="Removing the last declaration">
				<h2>This would leave the memory declaring nothing</h2>
				<p>
					With nothing declared, no fact is ever refused for naming something undeclared — and every
					name in every fact is matched on its characters alone rather than against what you said it
					is. Neither is wrong; they are different regimes, and a large share of memories are in the
					looser one.
				</p>
				<div className="editor-outcome-actions">
					<button type="button" className="button button-primary" onClick={() => onRemoveLast(prompt.id)}>
						Remove it anyway
					</button>
					<button type="button" className="button" onClick={onCancel}>
						Keep it
					</button>
				</div>
			</div>
		);
	}

	const surfaces = prompt.surfaces ?? [];
	return (
		<div className="editor-conflict" role="alertdialog" aria-label="Declaring the first named thing">
			<h2>This memory declares nothing yet. Declaring one thing changes every fact.</h2>
			<p>
				Right now every fact here commits and each name is matched on its characters alone. The
				moment this memory declares <em>one</em> named thing, every name any fact mentions must also
				be declared — and a fact naming something undeclared is dropped while the rest of the memory
				saves.
			</p>
			{surfaces.length > 0 ? (
				<>
					<p>The facts here name {surfaces.length}:</p>
					<ul className="editor-surfaces">
						{surfaces.map((surface) => (
							<li key={surface}>{surface}</li>
						))}
					</ul>
				</>
			) : (
				<p className="editor-help">No fact here names anything yet, so there is nothing to lose.</p>
			)}
			<div className="editor-outcome-actions">
				{surfaces.length > 0 ? (
					<button type="button" className="button button-primary" onClick={() => onDeclareAll(surfaces)}>
						Declare all {surfaces.length} and continue
					</button>
				) : null}
				<button type="button" className="button" onClick={() => onDeclareOne(prompt.seed ?? '')}>
					{prompt.seed ? `Declare only “${prompt.seed}”` : 'Add one blank row'}
				</button>
				<button type="button" className="button" onClick={onCancel}>
					Cancel
				</button>
			</div>
		</div>
	);
}
