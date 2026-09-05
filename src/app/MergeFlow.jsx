import { useEffect, useMemo, useState } from 'react';

import { fetchEditRecord, runMerge } from './api.mjs';
import { composeBody, splitLeadingHeading } from './editor-model.mjs';
import { markSyntax } from './markdown-syntax.mjs';
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
	Card,
	Checkbox,
	ChoiceRow,
	Decision,
	DecisionList,
	DetailRow,
	DetailRows,
	Display,
	EmptyState,
	ErrorState,
	Eyebrow,
	FactSentence,
	Field,
	Input,
	LoadingState,
	NamedThing,
	Note,
	PageHead,
	PageSection,
	ProseField,
	Reading,
	RunBar,
	Section,
	Table,
	Td,
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
 * WHAT THESE SCREENS ARE DRAWN AS, AND WHY
 * ---------------------------------------------------------------------------------------------
 *
 * Neither the chooser nor the composition has a mockup. They were first drawn in the deleted
 * stylesheet's vocabulary and rendered as browser defaults; the rebuild redrew them on `src/app/ui`
 * with every string, ordering and call untouched, and nobody had looked at them since. This pass
 * gives each the density budget every approved screen keeps to — one story, a first thing, a second
 * thing, and a third thing closed until asked for — and it borrows the shapes from the mockups
 * that exist rather than inventing new ones:
 *
 *   - the CHOOSER is a page head, one card about the memory in hand, a find box and a list, with
 *     its one control in the head. It had two display headings, a run bar whose only button was
 *     Cancel, and three sentences of caveat above the first thing to read;
 *   - the COMPOSITION is ReadB: the merged memory's words in the reading column and what the agent
 *     acts on in the rail beside them — because a merged memory is a memory, and the person checking
 *     it should be looking at the object they read every day. Every fact in the rail is a tick, the
 *     declarations are the rail's second card, and the order of the two writes and what can put
 *     them back are closed rows under it. The one write is in a run bar under the words, with the
 *     reversibility sentence beside the button rather than in a panel that scrolls away.
 *
 * Every honesty statement the previous drawing made is still made; none is behind a tooltip.
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

/** The word for where a fact came from, beside the fact. Three sources is too many for a colour. */
const FROM = { survivor: 'survivor', duplicate: 'duplicate', both: 'both' };

/** The composed body, cut into the heading the page draws as its H1 and the words the pane edits. */
const wordsOf = (plan, fallbackTitle) =>
	splitLeadingHeading(plan.content_md, plan.semantic_delta?.title ?? fallbackTitle);

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
export function MergeMemories({ survivorId, duplicateId, onDone, onOpen, onRepick = null }) {
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
				const composed_ = planMemoryMerge(survivor, duplicate);
				setBody(wordsOf(composed_, survivorId).body);
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

	/*
	  THE HEADING NEVER REACHES THE PANE. The composed body opens with the survivor's own `# ` line,
	  and this screen already draws that title as the page's H1 — so a pane that held the whole
	  body showed the reader a second title in raw Markdown, at the top of the words, which is the
	  exact thing the editor stopped doing. The heading is split off as the bytes it came as and
	  put back at the write, so a composition nobody edited is written byte for byte, and one that
	  has no heading gets one composed from the title rather than a refusal on its first line.
	*/
	const heading = useMemo(() => (plan ? wordsOf(plan, survivorId).heading : null), [plan, survivorId]);

	const composed = useMemo(() => {
		if (!plan) return null;
		const facts = (plan.semantic_delta.facts ?? []).filter((fact, index) => !dropped.has(index));
		return { ...plan.semantic_delta, facts };
	}, [plan, dropped]);

	const segments = useMemo(() => markSyntax(body), [body]);

	if (loadError) return <ErrorState heading="These two memories could not be loaded" error={loadError} />;
	if (!plan) return <LoadingState what="Loading both memories through the door that carries their declarations" />;

	if (report) return <MergeReceipt report={report} onDone={onDone} onOpen={onOpen} />;

	const reversibility = reversibilityFor('merge');
	const facts = plan.semantic_delta.facts ?? [];
	const entities = plan.semantic_delta.entities ?? [];
	const survivorTitle = plan.semantic_delta.title ?? survivorId;
	const duplicateTitle = loaded.duplicate?.semantic_delta?.title ?? duplicateId;
	const factWord = (n) => (n === 1 ? 'fact' : 'facts');

	return (
		<Reading
			rail={
				<>
					{/*
					  FIRST IN THE RAIL: every fact the merged memory would carry, each one a tick. A
					  dropped fact stays on the page, struck through, so the list still says what the
					  two memories held and the reader can put one back.
					*/}
					<Card title="What your agent acts on" aside={`${composed.facts.length} of ${facts.length}`}>
						<ul className="merge-facts" aria-label="Every fact the merged memory would carry">
							{facts.map((fact, index) => {
								const kept = !dropped.has(index);
								return (
									<li
										key={`${fact.subject}-${fact.predicate}-${fact.object}-${index}`}
										className={kept ? 'merge-fact' : 'merge-fact merge-fact-dropped'}
									>
										<Checkbox
											checked={kept}
											label={`Keep “${fact.subject} ${fact.predicate} ${fact.object}”`}
											onCheckedChange={() => {
												const next = new Set(dropped);
												if (next.has(index)) next.delete(index);
												else next.add(index);
												setDropped(next);
											}}
										/>
										<FactSentence
											subject={fact.subject}
											predicate={fact.predicate}
											object={fact.object}
										/>
										<span className="merge-fact-from">
											{FROM[plan.provenance[index]?.source] ?? FROM.survivor}
										</span>
									</li>
								);
							})}
						</ul>
						<p className="meta">
							{plan.counts.from_survivor} from the survivor, {plan.counts.from_duplicate} from the
							duplicate, {plan.counts.shared} written in both.
						</p>
					</Card>

					<Card title="Named things, from both memories" aside={entities.length}>
						{entities.map((entity) => (
							<NamedThing key={entity.n} name={entity.n} kind={entity.kind} gloss={entity.is} />
						))}
						{plan.declaration_conflicts.map((conflict) => (
							<Note key={conflict.name} tone="warn">
								Both declare “{conflict.name}” and they disagree. Keeping the survivor’s: “
								{conflict.kept.kind ?? 'no kind'}”.
							</Note>
						))}
						<Note>
							Both memories’ declarations travel with the facts, in one payload. A merge that
							folded in the facts and forgot the declarations would commit with those facts
							dropped from the stored record and nothing in the response saying so.
						</Note>
					</Card>

					<DetailRows>
						{/* THE ORDER, on the screen, with the reason each write is where it is. */}
						<DetailRow label="The order the two writes happen in" count={MERGE_STEPS.length}>
							<DecisionList label="The two writes a merge is made of">
								{MERGE_STEPS.map((step) => (
									<Decision key={step.step} lead={step.label}>
										{step.why}
									</Decision>
								))}
							</DecisionList>
						</DetailRow>
						<DetailRow label="What can put it back">
							<p className="copy">{reversibility.recovers}.</p>
							<p className="meta">
								<a href="#/reversibility">What can be undone, for every action</a>
							</p>
						</DetailRow>
					</DetailRows>
				</>
			}
		>
			<header className="reading-head">
				<Display level={1} size="2xl">
					{survivorTitle}
				</Display>
				<div className="reading-meta">
					{plan.semantic_delta.memory_type ? <Badge>{plan.semantic_delta.memory_type}</Badge> : null}
					<span>
						survives · takes in “{duplicateTitle}”, which is then removed
						{onRepick ? (
							<>
								{' '}
								<span className="faint">·</span>{' '}
								<Button tone="quiet" onClick={onRepick}>
									pick a different memory
								</Button>
							</>
						) : null}
					</span>
				</div>
			</header>

			{plan.declaration_regime_change ? (
				<Note tone="warn">
					<strong>{plan.declaration_regime_change.heading}</strong>{' '}
					{plan.declaration_regime_change.sentence}
				</Note>
			) : null}

			{/*
			  THE WORDS, editable, in the same shape the editor draws them. The composition below is
			  a starting point, not a proposal: the duplicate's words follow the survivor's under a
			  marker, and the reader is expected to rewrite the join.
			*/}
			<Section title="The words">
				<ProseField
					value={body}
					segments={segments}
					spellCheck="true"
					aria-label="The note the survivor will carry"
					onChange={(event) => setBody(event.target.value)}
				/>
			</Section>

			{error ? <ErrorState heading="This merge could not be started" error={error} /> : null}

			<RunBar
				what={`${composed.facts.length} ${factWord(composed.facts.length)} and ${entities.length} ${entities.length === 1 ? 'named thing' : 'named things'} are written to the survivor, then the duplicate is removed.`}
				note={`${reversibility.confirmation} What can put it back: ${reversibility.recovers.toLowerCase()}.`}
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
									content_md: composeBody({ body, title: survivorTitle, heading }),
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
		</Reading>
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
 * backwards is not visible from the composition afterwards. It is asked on the card about the
 * memory in hand, because it is a fact about that memory's fate.
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
			<MergeMemories
				key={`${survivorId}:${duplicateId}`}
				survivorId={survivorId}
				duplicateId={duplicateId}
				onDone={onDone}
				onOpen={onOpen}
				onRepick={() => setPartnerId(null)}
			/>
		);
	}

	return (
		<div className="page page-narrow">
			<PageHead
				title="Merge this memory into another"
				subtitle="Two memories become one: this app writes the memory that survives, then removes the other. Nothing is written from this screen — picking a memory opens the composition."
				actions={<Button onClick={onDone}>Cancel</Button>}
			/>

			<Card
				title="Merging"
				aside={`${here.fact_count.toLocaleString()} ${here.fact_count === 1 ? 'fact' : 'facts'}`}
			>
				<Display level={2} size="xs">
					{here.title ?? here.memory_id}
				</Display>
				<Eyebrow>Which one survives?</Eyebrow>
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
			</Card>

			<Field
				label="Find the other memory"
				note="This finds the words you type in what is already loaded. It does not rank and it asks the engine nothing — and nothing here nominates a pair: this app has no way to tell that two memories say the same thing, so you name the other one."
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
									<Button tone="quiet" size="sm" onClick={() => onOpen?.(row.memory_id)}>
										Read it first
									</Button>
								</>
							}
						/>
					))}
				</DecisionList>
			)}
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
