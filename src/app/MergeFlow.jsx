import { useEffect, useMemo, useState } from 'react';

import { fetchEditRecord, runMerge } from './api.mjs';
import {
	MERGE_STEPS,
	NO_RANKING_FIELD,
	planMemoryMerge,
	PROMOTE_INTENTS,
	REVERSIBILITY,
	reversibilityFor,
	ROLLBACK_IS_NOT_OFFERED,
} from './merge-model.mjs';
import {
	Badge,
	Button,
	Checkbox,
	ChoiceRow,
	Decision,
	DecisionList,
	EmptyState,
	ErrorState,
	Field,
	Input,
	LoadingState,
	Note,
	PageHead,
	PageSection,
	RunBar,
	Table,
	Td,
	Textarea,
	Th,
	Tr,
} from './ui/index.mjs';

/**
 * THE CURATION SURFACE, and the one thing every screen in it shares.
 *
 * PREVIEW → RUN → RECEIPT, in that order, with the write issued from the preview's own button. No
 * gesture in this product both opens a preview and commits: the button that starts a run is inside
 * the panel that lists what the run will write, by name, so there is no path where a user authorises
 * a count.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS FILE WAS REWRITTEN IN THE REBUILD, AND NOTHING IN IT CHANGED
 * ---------------------------------------------------------------------------------------------
 *
 * Every screen below was drawn in `curation-*` class names and `.button` — the vocabulary of the
 * 3,487-line stylesheet the redesign deleted. Nothing replaced those rules, so these screens
 * rendered as unstyled browser defaults: a native `fieldset` with its legend notch, native radios,
 * a bare `input`, no page column, and buttons in the platform's own grey. Two design systems in one
 * tree is the diagnosis the owner gave of the last build; one of them being empty is worse, not
 * better, because the screens still exist and still open.
 *
 * So the markup here is now the same `src/app/ui` components every other screen composes, and the
 * copy, the ordering, the state machine and every call are untouched — the argument each of these
 * screens makes was reviewed and approved, and only its drawing was missing.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------------------------
 *
 * There is no "Merge" button wired to the engine's own address maintenance, in any mode. Run on a
 * real vault it reports that it applied, with mass conserved, and leaves both memories present,
 * readable and served. A button on it ships green — its own tests pass, it returns success — and the
 * user watches the list not change and concludes this app is broken. Everything below is composed
 * out of the two writes whose effects this app has actually observed.
 */

// =============================================================================================
// Unify a spelling
// =============================================================================================
//
// IT USED TO BE HERE, AND IT IS NOW A SCREEN OF ITS OWN.
//
// `UnifySpelling` took one nominated pair, asked which spelling survived, previewed the rewrite and
// ran it. Everything about the mechanism was right and the surface was wrong: a vault carries a
// dozen such pairs at once, and answering them one modal at a time — from a row buried in a list of
// five equal headings — is the shape that made the last version of this product an inventory of its
// own capabilities.
//
// `ClusterReview.jsx` replaces it with OpenRefine's model: the fingerprint proposes every cluster at
// once, the reader ticks and chooses down a table, one preview covers the whole batch, and the
// clustering is recomputed the moment the run ends. The preview, the run, the stop-on-first-refusal
// and the resume are the same arithmetic in `merge-model.mjs` — nothing about the write path moved.
// The old component is DELETED rather than kept beside the new one, because two ways to do one
// thing is exactly how the previous design lost its consistency.

// =============================================================================================
// Merge two memories
// =============================================================================================

/**
 * Two memories that say the same thing, composed into one.
 *
 * The composition is a STARTING POINT and the screen says so: the body is editable and every fact
 * can be dropped before the write. A machine-composed payload presented as final would be this app
 * authoring the user's memory, and the union of two bodies is the one part of a merge no function
 * can do correctly.
 *
 * Both records are loaded through the LINEAGE door, never from the list: the display door does not
 * carry entity declarations, and a merge assembled from it would commit having deleted every named
 * thing both memories declared.
 */
export function MergeMemories({ survivorId, duplicateId, onDone, onOpen }) {
	const [loaded, setLoaded] = useState(null);
	const [loadError, setLoadError] = useState(null);
	const [body, setBody] = useState('');
	const [dropped, setDropped] = useState(() => new Set());
	const [report, setReport] = useState(null);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		(async () => {
			try {
				const [survivor, duplicate] = await Promise.all([
					fetchEditRecord(survivorId),
					fetchEditRecord(duplicateId),
				]);
				if (!live) return;
				setLoaded({ survivor, duplicate });
				setBody(planMemoryMerge(survivor, duplicate).content_md);
			} catch (cause) {
				if (live) setLoadError(cause);
			}
		})();
		return () => {
			live = false;
		};
	}, [survivorId, duplicateId]);

	const plan = useMemo(
		() => (loaded ? planMemoryMerge(loaded.survivor, loaded.duplicate) : null),
		[loaded],
	);

	const composed = useMemo(() => {
		if (!plan) return null;
		const facts = (plan.semantic_delta.facts ?? []).filter((fact, index) => !dropped.has(index));
		return { ...plan.semantic_delta, facts };
	}, [plan, dropped]);

	if (loadError) return <ErrorState heading="These two memories could not be loaded" error={loadError} />;
	if (!plan) return <LoadingState what="Loading both memories through the door that carries their declarations" />;

	if (report) return <MergeReceipt report={report} onDone={onDone} onOpen={onOpen} />;

	const reversibility = reversibilityFor('merge');
	const facts = plan.semantic_delta.facts ?? [];
	const entities = plan.semantic_delta.entities ?? [];

	return (
		<div className="page page-narrow">
			<PageHead
				title="Merge two memories"
				subtitle="The composition below is a starting point, not a proposal. Edit the note, drop any fact you do not want, and nothing is written until you press the button at the bottom."
			/>

			{plan.declaration_regime_change ? (
				<Note tone="warn">
					<strong>{plan.declaration_regime_change.heading}</strong>{' '}
					{plan.declaration_regime_change.sentence}
				</Note>
			) : null}

			<Field label="The note the survivor will carry">
				{(id) => (
					<Textarea
						id={id}
						prose
						value={body}
						rows={14}
						onChange={(event) => setBody(event.target.value)}
					/>
				)}
			</Field>

			<PageSection
				title="What your agent will act on"
				count={composed.facts.length}
				aside={
					<span className="item-count">
						{plan.counts.from_survivor} from the survivor, {plan.counts.from_duplicate} from the
						duplicate, {plan.counts.shared} written in both
					</span>
				}
			>
				<Table label="Every fact the merged memory would carry">
					<tbody>
						{facts.map((fact, index) => (
							<Tr key={`${fact.subject}-${fact.predicate}-${fact.object}-${index}`}>
								<Td className="table-tick">
									<Checkbox
										checked={!dropped.has(index)}
										label={`Keep “${fact.subject} ${fact.predicate} ${fact.object}”`}
										onCheckedChange={() => {
											const next = new Set(dropped);
											if (next.has(index)) next.delete(index);
											else next.add(index);
											setDropped(next);
										}}
									/>
								</Td>
								<Td subject>
									<span className="fact">
										<span>{fact.subject}</span>{' '}
										<span className="fact-relation">{fact.predicate}</span>{' '}
										<span>{fact.object}</span>
									</span>
								</Td>
								<Td>
									<Badge>{plan.provenance[index]?.source ?? 'survivor'}</Badge>
								</Td>
							</Tr>
						))}
					</tbody>
				</Table>
			</PageSection>

			<PageSection title="Named things, from both memories" count={entities.length}>
				<Note>
					Both memories’ declarations travel with the facts, in one payload. A merge that folded in
					the facts and forgot the declarations would commit with those facts dropped from the
					stored record and nothing in the response saying so.
				</Note>
				{plan.declaration_conflicts.map((conflict) => (
					<Note key={conflict.name} tone="warn">
						Both declare “{conflict.name}” and they disagree. Keeping the survivor’s: “
						{conflict.kept.kind ?? 'no kind'}”.
					</Note>
				))}
			</PageSection>

			{/* THE ORDER, on the screen, with the reason each write is where it is. */}
			<PageSection title="The order the two writes happen in">
				<DecisionList label="The two writes a merge is made of">
					{MERGE_STEPS.map((step) => (
						<Decision key={step.step} lead={step.label}>
							{step.why}
						</Decision>
					))}
				</DecisionList>
			</PageSection>

			<Note tone="warn">
				<strong>Before you do this.</strong> {reversibility.confirmation} What can put it back:{' '}
				{reversibility.recovers.toLowerCase()}.
			</Note>

			{error ? <ErrorState heading="This merge could not be started" error={error} /> : null}

			<RunBar
				what={`${composed.facts.length} ${composed.facts.length === 1 ? 'fact' : 'facts'} and ${entities.length} ${entities.length === 1 ? 'named thing' : 'named things'} are written to the survivor, then the duplicate is removed.`}
			>
				<Button onClick={onDone} disabled={busy}>
					Cancel
				</Button>
				<Button
					tone="primary"
					disabled={busy}
					onClick={async () => {
						setBusy(true);
						setError(null);
						try {
							const body_ = {
								survivor: {
									memory_id: survivorId,
									seen_version_id: loaded.survivor.expected_version_id,
									content_md: body,
									semantic_delta: composed,
								},
								duplicate: {
									memory_id: duplicateId,
									seen_version_id: loaded.duplicate.expected_version_id,
								},
							};
							setReport(await runMerge(body_));
						} catch (cause) {
							setError(cause);
						} finally {
							setBusy(false);
						}
					}}
				>
					{busy ? 'Writing…' : 'Merge them'}
				</Button>
			</RunBar>
		</div>
	);
}

function MergeReceipt({ report, onDone, onOpen }) {
	return (
		<div className="page page-narrow">
			<PageHead
				title={report.complete ? 'Merged.' : (report.half_finished?.heading ?? 'The merge did not finish')}
				subtitle={
					report.half_finished
						? report.half_finished.sentence
						: !report.complete && report.both_memories_intact
							? 'Nothing was written. Both memories are exactly as they were — which is why the memory that survives is written first.'
							: null
				}
			/>

			<DecisionList label="What each write did">
				{report.steps.map((step) => (
					<Decision
						key={step.step}
						lead={step.step === 'update-survivor' ? 'Wrote the survivor' : 'Removed the duplicate'}
						stake={step.state}
					>
						{step.message ?? null}
					</Decision>
				))}
			</DecisionList>

			<RunBar what="Nothing further is written by leaving this screen.">
				<Button onClick={() => onOpen?.(report.survivor_id)}>Open the survivor</Button>
				<Button tone="primary" onClick={onDone}>
					Done
				</Button>
			</RunBar>
		</div>
	);
}

/**
 * THE DOOR INTO `MergeMemories`, and it exists because there was not one.
 *
 * The composition screen, the plan, the two-write route and its tests were all written and nothing
 * imported the component: `runMerge`, `POST /api/merges` and `planMemoryMerge` were reachable only
 * from a test. A screen with no route is not a feature that is nearly finished — it is a mechanism
 * that reports as built and can never fire, which is the exact failure the rest of this repository
 * spends its comments refusing.
 *
 * The chooser is deliberately NOT a duplicate detector. The backlog finds near-duplicate NAMES; it
 * has no notion of two memories that say the same thing, and inventing one here would be this app
 * nominating pairs on evidence it does not have. So a person names the other memory, from the
 * listing this browser already holds, and the filter is the same substring match the list uses —
 * there is no ranked search in this product and this is not where the first one arrives.
 *
 * WHICH ONE SURVIVES IS ASKED BEFORE ANYTHING IS COMPOSED. It decides which body leads, which
 * declaration wins a disagreement, and which memory is the one that gets removed — and getting it
 * backwards is not visible from the composition afterwards.
 */
export function MergeScreen({ memoryId, rows, onDone, onOpen }) {
	const [partnerId, setPartnerId] = useState(null);
	const [survivorIsThis, setSurvivorIsThis] = useState(true);
	const [query, setQuery] = useState('');

	const here = rows.find((row) => row.memory_id === memoryId) ?? null;
	const partner = rows.find((row) => row.memory_id === partnerId) ?? null;

	const candidates = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return rows
			.filter((row) => row.memory_id !== memoryId)
			.filter((row) =>
				needle.length === 0
					? true
					: `${row.title ?? ''} ${row.memory_id}`.toLowerCase().includes(needle),
			)
			.slice(0, 40);
	}, [rows, memoryId, query]);

	if (!here) {
		return (
			<div className="page page-narrow">
				<EmptyState
					heading="That memory is not in what was loaded"
					action={<Button onClick={onDone}>Back</Button>}
				>
					<p>A merge is composed from two records this app has read, and one of them is missing.</p>
				</EmptyState>
			</div>
		);
	}

	if (partner) {
		const survivorId = survivorIsThis ? memoryId : partner.memory_id;
		const duplicateId = survivorIsThis ? partner.memory_id : memoryId;
		return (
			<>
				{/* Held to the same measure as the panel below it: a context line pinned to the window's
				    left edge above a centred column reads as two screens rather than one. */}
				<div className="page page-narrow merge-context">
					<Note>
						Merging <strong>{here.title ?? here.memory_id}</strong> and{' '}
						<strong>{partner.title ?? partner.memory_id}</strong>.{' '}
						<Button tone="quiet" onClick={() => setPartnerId(null)}>
							pick a different memory
						</Button>
					</Note>
				</div>
				<MergeMemories
					key={`${survivorId}:${duplicateId}`}
					survivorId={survivorId}
					duplicateId={duplicateId}
					onDone={onDone}
					onOpen={onOpen}
				/>
			</>
		);
	}

	return (
		<div className="page page-narrow">
			<PageHead
				title="Merge this memory into another"
				subtitle="Two memories become one: this app writes the memory that survives, then removes the other. Nothing on this screen is written, and nothing here nominates a pair — this app has no way to tell that two memories say the same thing, so you name the other one."
			/>

			<Note>
				From <strong>{here.title ?? here.memory_id}</strong> ·{' '}
				{here.fact_count.toLocaleString()} {here.fact_count === 1 ? 'fact' : 'facts'}
			</Note>

			<PageSection title="Which one survives?">
				<ChoiceRow
					name={`survivor-side-${memoryId}`}
					legend="Which of the two memories is the one that survives"
					value={survivorIsThis ? 'this' : 'other'}
					onChange={(value) => setSurvivorIsThis(value === 'this')}
					options={[
						{
							value: 'this',
							label: 'This memory survives',
							note: 'the other one is removed once the survivor is written',
						},
						{
							value: 'other',
							label: 'The one I pick survives',
							note: 'this memory is the one removed',
						},
					]}
				/>
			</PageSection>

			<Field
				label="Find the other memory"
				note="This finds the words you type in what is already loaded. It does not rank and it asks the engine nothing."
			>
				{(id) => (
					<Input
						id={id}
						type="text"
						value={query}
						autoComplete="off"
						placeholder="part of its title"
						onChange={(event) => setQuery(event.target.value)}
					/>
				)}
			</Field>

			{candidates.length === 0 ? (
				<EmptyState heading={`No memory in what was loaded matches “${query}”.`}>
					<p>Every memory this app has read is searched. Try fewer words.</p>
				</EmptyState>
			) : (
				<DecisionList label="Memories this one could be merged into">
					{candidates.map((row) => (
						<Decision
							key={row.memory_id}
							lead={
								<Button tone="quiet" className="decision-open" onClick={() => setPartnerId(row.memory_id)}>
									{row.title ?? row.memory_id}
								</Button>
							}
							stake={`${row.fact_count.toLocaleString()} ${row.fact_count === 1 ? 'fact' : 'facts'}`}
							actions={
								<>
									{row.memory_type ? <Badge>{row.memory_type}</Badge> : null}
									<Button size="sm" onClick={() => onOpen?.(row.memory_id)}>
										read it first
									</Button>
								</>
							}
						/>
					))}
				</DecisionList>
			)}

			<RunBar what="Nothing is written from this screen. Picking a memory opens the composition.">
				<Button onClick={onDone}>Cancel</Button>
			</RunBar>
		</div>
	);
}

/**
 * The persistent banner for a merge that stopped between its two writes.
 *
 * Rebuilt at launch from a record on disk, not from anything in this tab, because the state has to
 * survive a crash rather than only an exception. It offers exactly two actions and each says what it
 * will do; there is no third, because there is no operation to route one to.
 *
 * `.notice` is the shell's own class for a banner that changes what every screen below it MEANS.
 * Its doc comment already named this as one of the two things that qualify; this screen had grown a
 * second spelling of it instead.
 */
export function HalfFinishedMerge({ pending, busy, onFinish, onUndo }) {
	if (!pending) return null;
	const undo = reversibilityFor('undo-half-finished-merge');
	return (
		<section className="notice notice-warn" role="status">
			<h2>Half-finished merge.</h2>
			<p>
				“{pending.survivor_title ?? pending.survivor_id}” holds both memories’ content, and “
				{pending.duplicate_title ?? pending.duplicate_id}” is still here. A merge is complete only
				when both writes have committed, and only one of them has.
			</p>
			<div className="notice-actions">
				<Button tone="primary" size="sm" onClick={onFinish} disabled={busy}>
					Finish the merge — remove the duplicate
				</Button>
				<Button size="sm" onClick={onUndo} disabled={busy}>
					Undo — write the survivor back
				</Button>
			</div>
			<p>{undo.confirmation}</p>
		</section>
	);
}

// =============================================================================================
// Reversibility, and "promote"
// =============================================================================================

/**
 * The table, rendered from the same rows the confirmations are drawn from.
 *
 * One source, so a dialog cannot promise something this table denies. Every row that writes says
 * No, which is a measurement rather than caution: the import door was tried from four directions
 * against this build and refused every one.
 */
export function ReversibilityTable() {
	return (
		<div className="page page-narrow">
			<PageHead
				title="What can be undone"
				subtitle="Nothing in this list is undone by the engine. A copy is taken before every write and it can be read and saved to a file; putting one back into the vault it came from is not something the engine can do."
			/>
			<Table label="What recovers each action">
				<thead>
					<tr>
						<Th>Action</Th>
						<Th width="90px">Undo?</Th>
						<Th>What recovers it</Th>
					</tr>
				</thead>
				<tbody>
					{REVERSIBILITY.map((row) => (
						<Tr key={row.id}>
							<Td subject>{row.operation}</Td>
							<Td>{row.reversible ? 'Yes' : 'No'}</Td>
							<Td>{row.recovers}</Td>
						</Tr>
					))}
				</tbody>
			</Table>
			<Note>{ROLLBACK_IS_NOT_OFFERED}</Note>
		</div>
	);
}

/**
 * "Promote", which is not a button.
 *
 * The word came from a real request and it maps to no field. What it can honestly mean is a small
 * menu of named intents over one call, each labelled with the field it changes — and the two things
 * it cannot mean are IN the table rather than omitted, because a user who came looking for "pin
 * this" needs to be told it does not exist at the moment they look for it.
 */
export function PromoteMenu({ memoryId, onEdit }) {
	const real = PROMOTE_INTENTS.filter((intent) => intent.real);
	const unreal = PROMOTE_INTENTS.filter((intent) => !intent.real);

	return (
		<div className="page page-narrow">
			{/*
			  THE NEGATIVE HALF IS FIRST, and it is a requirement rather than a caveat. No affordance
			  in this product may imply a ranking the store does not have.
			*/}
			<PageHead title="Make this memory count for more" subtitle={NO_RANKING_FIELD} />

			<DecisionList label="What this can mean here">
				{real.map((intent) => (
					<Decision
						key={intent.id}
						lead={intent.label}
						stake={`changes ${intent.field}`}
						actions={
							<Button size="sm" onClick={() => onEdit?.(memoryId)}>
								Open the editor
							</Button>
						}
					>
						<p>{intent.what}</p>
						<Note>You do this in {intent.where}.</Note>
					</Decision>
				))}
			</DecisionList>

			<PageSection title="What this cannot mean here">
				<DecisionList label="What this cannot mean here">
					{unreal.map((intent) => (
						<Decision key={intent.id} lead={intent.label} className="decision-absent">
							<p>{intent.what}</p>
						</Decision>
					))}
				</DecisionList>
			</PageSection>
		</div>
	);
}
