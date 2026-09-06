import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchEditRecord, runMerge } from './api.mjs';
import { composeBody, splitLeadingHeading } from './editor-model.mjs';
import { useFocusActions } from './focus-actions.mjs';
import { markSyntax } from './markdown-syntax.mjs';
import {
	joinAtMarker,
	MERGE_STEPS,
	NO_RANKING_FIELD,
	planMemoryMerge,
	PROMOTE_INTENTS,
	REVERSIBILITY,
	reversibilityFor,
	ROLLBACK_IS_NOT_OFFERED,
	splitAtJoin,
} from './merge-model.mjs';
import {
	Badge,
	Button,
	Card,
	Checkbox,
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
	Icon,
	Input,
	LoadingState,
	MenuItem,
	NamedThing,
	Note,
	OverflowMenu,
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
 *   - the COMPOSITION is ReadB with EditB's bar: the merged memory's words in the reading column
 *     and what the agent acts on in the rail beside them — because a merged memory is a memory, and
 *     the person checking it should be looking at the object they read every day. Every fact in
 *     the rail is a tick under the eyebrow of the memory it came from; the order of the two writes
 *     and what can put them back are closed rows under the facts; the declarations are the rail's
 *     last card, name and kind on a line. The one write is in the top bar — Cancel and a filled
 *     "Merge them", where the editor keeps Cancel and Save — and the rail ends in the one line about
 *     reversibility, as the editor's pane does. The duplicate's words are drawn as a marked block
 *     under the survivor's, so the join the reader is expected to rewrite is visible as a join.
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

/** The eyebrow over a group of facts, by which memory wrote them. */
const GROUP_LABELS = Object.freeze([
	{ source: 'survivor', label: () => 'From this memory' },
	{ source: 'both', label: () => 'Written in both' },
	{ source: 'duplicate', label: (duplicateTitle) => `From “${duplicateTitle}”` },
]);

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
export function MergeMemories({ survivorId, duplicateId, onDone, onOpen, onRepick = null, onSwap = null }) {
	const [loaded, setLoaded] = useState(null);
	const [loadError, setLoadError] = useState(null);
	// The words, in two halves: the survivor's, and the duplicate's after the join marker. Each is
	// its own field so the join is drawn as a join; the marker goes back between them at the write.
	const [words, setWords] = useState('');
	const [joined, setJoined] = useState('');
	const [seam, setSeam] = useState(null);
	const [dropped, setDropped] = useState(() => new Set());
	const [report, setReport] = useState(null);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);
	const joinRef = useRef(null);

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
				const halves = splitAtJoin(wordsOf(composed_, survivorId).body);
				setWords(halves.before);
				setJoined(halves.after);
				setSeam(halves);
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

	const segments = useMemo(() => markSyntax(words), [words]);
	const joinedSegments = useMemo(() => markSyntax(joined), [joined]);

	/*
	  THE JOIN IS WHERE THE EDITING HAPPENS, so the page opens with it in view: the seam sits about
	  two-fifths down the screen, with the survivor's last lines above it and the duplicate's first
	  under it, and the rail beside both. Never scrolled up — a short survivor keeps its title on
	  screen — and `scrollIntoView` is not used, because a block taller than the viewport is pinned
	  to its top edge by it, which put the seam itself off-screen.
	*/
	useEffect(() => {
		const join = joinRef.current;
		const screen = join?.closest('.screen');
		if (!plan || !join || !screen) return;
		const target = join.getBoundingClientRect().top - screen.getBoundingClientRect().top - screen.clientHeight * 0.4;
		if (target > 0) screen.scrollTop = target;
	}, [plan]);

	const survivorTitle = plan?.semantic_delta?.title ?? survivorId;
	const duplicateTitle = loaded?.duplicate?.semantic_delta?.title ?? duplicateId;

	/*
	  THE ONE WRITE, reached through a ref so the bar's button always runs the current composition
	  without the bar being rebuilt on every keystroke in the words.
	*/
	const runRef = useRef(() => {});
	runRef.current = async () => {
		if (!plan || !loaded) return;
		setBusy(true);
		setError(null);
		try {
			const body_ = {
				survivor: {
					memory_id: survivorId,
					seen_version_id: loaded.survivor.expected_version_id,
					content_md: composeBody({
						body: joinAtMarker({ ...(seam ?? {}), before: words, after: joined }),
						title: survivorTitle,
						heading,
					}),
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
	};

	/*
	  EDITB'S BAR: the secondary choices behind "…", then Cancel, then the one filled control. The
	  write used to be in a run bar 2,200px below the fold, under four sentences; the reader pressed
	  it with the facts off-screen and authorised a count, which the run bar's own doc comment forbids.
	*/
	useFocusActions(
		() => (
			<>
				{onSwap || onRepick ? (
					<OverflowMenu label="More for this merge">
						{onSwap ? (
							<MenuItem onSelect={onSwap}>Keep “{duplicateTitle}” instead, remove this one</MenuItem>
						) : null}
						{onRepick ? <MenuItem onSelect={onRepick}>Pick a different memory</MenuItem> : null}
					</OverflowMenu>
				) : null}
				<span className="topbar-divider" aria-hidden="true" />
				<Button onClick={onDone} disabled={busy}>
					Cancel
				</Button>
				<Button tone="primary" disabled={busy || !plan || Boolean(report)} onClick={() => runRef.current()}>
					{busy ? 'Writing…' : 'Merge them'}
				</Button>
			</>
		),
		[busy, plan, report, duplicateTitle, onSwap, onRepick, onDone],
	);

	if (loadError) return <ErrorState heading="These two memories could not be loaded" error={loadError} />;
	if (!plan) return <LoadingState what="Loading both memories through the door that carries their declarations" />;

	if (report) return <MergeReceipt report={report} onDone={onDone} onOpen={onOpen} />;

	const reversibility = reversibilityFor('merge');
	const facts = plan.semantic_delta.facts ?? [];
	const entities = plan.semantic_delta.entities ?? [];
	const groups = GROUP_LABELS.map((group) => ({
		source: group.source,
		label: group.label(duplicateTitle),
		facts: facts
			.map((fact, index) => ({ fact, index }))
			.filter(({ index }) => (plan.provenance[index]?.source ?? 'survivor') === group.source),
	})).filter((group) => group.facts.length > 0);

	return (
		<Reading
			rail={
				<>
					{/*
					  FIRST IN THE RAIL: every fact the merged memory would carry, each one a tick, under
					  the eyebrow of the memory it came from. A dropped fact stays on the page, struck
					  through, so the list still says what the two memories held and the reader can put
					  one back. The aside is the live count.
					*/}
					<Card title="What your agent acts on" aside={`${composed.facts.length} of ${facts.length}`}>
						{groups.map((group) => (
							<div className="merge-group" key={group.source}>
								<Eyebrow>{group.label}</Eyebrow>
								<ul className="merge-facts" aria-label={group.label}>
									{group.facts.map(({ fact, index }) => {
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
											</li>
										);
									})}
								</ul>
							</div>
						))}
					</Card>

					{/* THE READER'S TWO ROWS, before the reference: the order of the writes, and what can put them back. */}
					<DetailRows>
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
							<p className="copy">
								Both memories’ declarations travel with the facts, in one payload, so a merge
								cannot commit with its facts dropped from the stored record.
							</p>
							<p className="meta">
								<a href="#/reversibility">What can be undone, for every action</a>
							</p>
						</DetailRow>
					</DetailRows>

					<Card title="Named things, from both memories" aside={entities.length}>
						{entities.map((entity) => (
							<NamedThing key={entity.n} name={entity.n} kind={entity.kind} gloss={entity.is} compact />
						))}
						{plan.declaration_conflicts.map((conflict) => (
							<Note key={conflict.name} tone="warn">
								Both declare “{conflict.name}” and they disagree. Keeping the survivor’s: “
								{conflict.kept.kind ?? 'no kind'}”.
							</Note>
						))}
					</Card>

					{/* Said once, here, in the editor's own words for its own foot. */}
					<p className="reading-rail-foot">
						<Icon.Info size={13} className="icon" />
						<span>A copy is kept before both writes. There is no undo.</span>
					</p>
				</>
			}
		>
			<header className="reading-head">
				<Display level={1} size="2xl">
					{survivorTitle}
				</Display>
				<div className="reading-meta">
					{plan.semantic_delta.memory_type ? <Badge>{plan.semantic_delta.memory_type}</Badge> : null}
					<span>merging in “{duplicateTitle}”</span>
				</div>
			</header>

			{plan.declaration_regime_change ? (
				<Note tone="warn">
					<strong>{plan.declaration_regime_change.heading}</strong>{' '}
					{plan.declaration_regime_change.sentence}
				</Note>
			) : null}

			{/*
			  THE WORDS, editable, in the same shape the editor draws them. The survivor's words first;
			  the duplicate's under them as a marked block, because the join between the two is the
			  one editorial act this screen exists for and a raw comment in the prose did not say so.
			*/}
			<Section title="The words">
				<ProseField
					value={words}
					segments={segments}
					spellCheck="true"
					aria-label="The survivor’s words"
					onChange={(event) => setWords(event.target.value)}
				/>
			</Section>

			{seam?.marker ? (
				<div className="merge-join" ref={joinRef}>
					<Eyebrow>From “{duplicateTitle}” — rewrite the join</Eyebrow>
					<ProseField
						value={joined}
						segments={joinedSegments}
						spellCheck="true"
						aria-label={`The words merged in from “${duplicateTitle}”`}
						onChange={(event) => setJoined(event.target.value)}
					/>
				</div>
			) : null}

			{error ? <ErrorState heading="This merge could not be started" error={error} /> : null}
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
 * WHICH ONE SURVIVES IS ASKED ON THE COMPOSITION, not here. It decides which body leads, which
 * declaration wins a disagreement, and which memory is the one that gets removed — and it can only
 * be answered once the other memory exists on screen. So the chooser asks for the other memory
 * and nothing else; the composition's "…" swaps the two, and the swap remounts it with the roles
 * reversed so nothing composed under the old answer survives.
 */
export function MergeScreen({ memoryId, rows, onDone, onOpen }) {
	const [partnerId, setPartnerId] = useState(null);
	const [survivorIsThis, setSurvivorIsThis] = useState(true);
	const [query, setQuery] = useState('');

	const here = rows.find((row) => row.memory_id === memoryId) ?? null;
	const partner = rows.find((row) => row.memory_id === partnerId) ?? null;

	// Nothing is listed until two characters are typed: forty unfiltered memories under an empty
	// box were an inventory, and the reader came here knowing which memory they meant.
	const needle = query.trim().toLowerCase();
	const candidates = useMemo(() => {
		if (needle.length < 2) return [];
		return rows
			.filter((row) => row.memory_id !== memoryId)
			.filter((row) => `${row.title ?? ''} ${row.memory_id}`.toLowerCase().includes(needle))
			.slice(0, 40);
	}, [rows, memoryId, needle]);

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
				onSwap={() => setSurvivorIsThis(!survivorIsThis)}
			/>
		);
	}

	return (
		<div className="page page-narrow">
			<PageHead
				title="Merge this memory into another"
				subtitle="Two memories become one. Nothing is written from this screen."
				actions={<Button onClick={onDone}>Cancel</Button>}
			/>

			<Card
				title="Merging"
				aside={`${here.fact_count.toLocaleString()} ${here.fact_count === 1 ? 'fact' : 'facts'}`}
			>
				<Display level={2} size="xs">
					{here.title ?? here.memory_id}
				</Display>
			</Card>

			{/*
			  The find box needs no note. It finds the words typed in what is already loaded — the
			  same substring match the list uses — and asks the engine nothing; nothing here nominates
			  a pair, because this app has no way to tell that two memories say the same thing.
			*/}
			<Field label="Find the other memory">
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

			{needle.length < 2 ? null : candidates.length === 0 ? (
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
							actions={row.memory_type ? <Badge>{row.memory_type}</Badge> : null}
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
