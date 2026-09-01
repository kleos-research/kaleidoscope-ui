import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchDismissals, setDismissal } from './api.mjs';
import { buildBacklog, dismissalRecordFor, kindById } from './backlog-model.mjs';
import { buildClusters } from './cluster-model.mjs';
import { ClusterReview } from './ClusterReview.jsx';
import { buildGraph } from './graph-model.mjs';
import {
	Badge,
	Button,
	Decision,
	DecisionList,
	DetailRow,
	DetailRows,
	EmptyState,
	ErrorState,
	Identifier,
	Input,
	LoadingState,
	Note,
	PageHead,
	PageSection,
	Source,
	Sources,
	Stat,
	StatNote,
	StatStrip,
} from './ui/index.mjs';

/** How many findings of one kind go into the DOM before the reader asks for more. */
const PAGE = 25;

/** How many of a finding's memories are on screen before the rest are one press away. */
const SOURCES = 4;

/** The same, for the sentences a memory wrote about a name. */
const GLOSSES = 3;

/**
 * NEEDS A DECISION.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE STORY THIS SCREEN TELLS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * First: how much of your vault is loose, in four numbers and one sentence. Second: the single
 * thing worth doing about it, which is merging names that are the same thing spelled twice — the
 * only action in this product that improves the DATA rather than the picture. Third, and closed
 * until asked for: everything else, biggest first.
 *
 * The previous version of this screen was five equal headings with several hundred rows under them
 * and no answer to "what should I do". That is the diagnosis the whole redesign is built on: "No
 * thinking balance. Just like, I wanted to have these functions, so I just put everything together
 * at one place."
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DUPLICATES ARE NOT ONE OF THE FIVE HEADINGS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * They have a screen instead. Four of the five kinds of finding end in one memory open in the
 * editor and there is nothing for a run to do; the fifth is the same edit repeated across every
 * memory that writes a name, which is exactly what makes it worth a run and exactly what makes it
 * unbearable by hand. Rendering it here as a peer of the other four, with a "merge" button on each
 * row, would put the highest-leverage thing on the screen at the same weight as a relation name
 * used once — and would give it two doors, which is how the last version became an inventory.
 *
 * NOTHING ON THIS SCREEN WRITES. Dismissal is this app's own note in this app's own state
 * directory; the vault is not touched and no agent is told anything. The merge writes, and it does
 * it from behind a preview on its own screen.
 */
export function BacklogView({ records, onEdit, onOpen, onBack, onReread, onShowGraph }) {
	const graph = useMemo(() => buildGraph(records), [records]);

	const [dismissed, setDismissed] = useState(null);
	const [storeError, setStoreError] = useState(null);
	const [writeError, setWriteError] = useState(null);
	const [busyKey, setBusyKey] = useState(null);
	/*
	  The cluster review, as a mode rather than a route. It is one continuous act — tick, choose,
	  preview, run, re-cluster — and the thing a reload would have to restore is a set of ticks and
	  a survivor per cluster, which is a working state rather than a place. The screen it returns to
	  is this one, and the browser Back button still leaves the whole surface, which is what a reader
	  reaching for it here actually means.
	*/
	const [reviewing, setReviewing] = useState(false);

	const load = useCallback(async () => {
		setStoreError(null);
		try {
			const body = await fetchDismissals();
			setDismissed(body?.dismissals ?? []);
		} catch (error) {
			// The list is NOT rendered as empty on a failed read. "You have dismissed nothing" over
			// a store holding a hundred decisions puts every one of them back on screen with no
			// indication that anything went wrong, and the user re-answers questions they already
			// answered. So the screen refuses instead, and says which file it could not read.
			setStoreError(error);
			setDismissed(null);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const backlog = useMemo(
		() => buildBacklog(graph, { dismissed: dismissed ?? [] }),
		[graph, dismissed],
	);

	// The clusters are derived from the backlog rather than from a second pass over the graph, so a
	// dismissal answered on either screen is answered on both. See `buildClusters`.
	const clusters = useMemo(() => buildClusters(backlog), [backlog]);

	const act = useCallback(
		async (action, payload) => {
			setBusyKey(payload.key);
			setWriteError(null);
			try {
				await setDismissal({ action, ...payload });
				await load();
			} catch (error) {
				setWriteError(error);
			} finally {
				setBusyKey(null);
			}
		},
		[load],
	);

	const dismiss = useCallback(
		(finding, reason) => act('dismiss', dismissalRecordFor(finding, { reason })),
		[act],
	);

	if (storeError) {
		return (
			<div className="page">
				<ErrorState
					heading="What you have already dismissed could not be read"
					error={storeError}
					action={<Button onClick={load}>Try again</Button>}
				/>
			</div>
		);
	}

	if (dismissed === null) return <LoadingState what="Reading what you have already dismissed" />;

	if (reviewing) {
		return (
			<ClusterReview
				records={records}
				clusters={clusters}
				busyKey={busyKey}
				onDismiss={dismiss}
				onReread={onReread}
				onOpen={onOpen}
				onEdit={onEdit}
				onDone={() => setReviewing(false)}
			/>
		);
	}

	if (graph.counts.edgeCount === 0) {
		return (
			<div className="page">
				<EmptyState
					heading="There is nothing here to curate yet"
					action={<Button onClick={onBack}>Back to your memories</Button>}
				>
					<p>
						Every finding on this screen is about how the facts in your memories join up to each
						other, and this vault has no fact with two named ends. That is not a fault —
						prose-only memories are memories, and they are served like any other.
					</p>
				</EmptyState>
			</div>
		);
	}

	// The near-duplicates lead the screen and are not repeated below it. See the note above.
	const groups = backlog.groups.filter((group) => group.kind.id !== 'near-duplicate');

	return (
		<div className="page">
			<PageHead
				title="Needs a decision"
				subtitle={`${backlog.counts.findings.toLocaleString()} outstanding · ${backlog.ranking.short}`}
				actions={
					onShowGraph ? (
						<Button onClick={onShowGraph}>See these names</Button>
					) : null
				}
			/>

			{writeError ? (
				<Note tone="warn" role="alert">
					{writeError.message} Nothing on this screen was changed and nothing in your vault was
					touched.
				</Note>
			) : null}

			<Shape backlog={backlog} clusters={clusters} />

			{clusters.counts.clusters > 0 ? (
				<Lead clusters={clusters} onReview={() => setReviewing(true)} />
			) : null}

			<PageSection
				title="Everything else"
				count={groups.reduce((total, group) => total + group.counts.findings, 0).toLocaleString()}
			>
				{/*
				  THE ORDER, IN THE SAME WORDS THE SORT USED. A list in an unexplained order is read as
				  a priority list, and then the bottom of it is never read at all. Saying the rule is
				  cheaper than earning that trust, and it is checkable: both sentences come from
				  `RANKING`, beside the comparator that implements them.
				*/}
				<Note>
					<strong>The order:</strong> {backlog.ranking.sentence} {backlog.ranking.groups}
				</Note>

				<DetailRows>
					{groups.map((group, index) => (
						<DetailRow
							key={group.kind.id}
							label={group.kind.title}
							count={group.counts.findings.toLocaleString()}
							/*
							  The biggest group opens, the rest wait. One worked example is what turns a
							  page of closed rows into a page a reader understands the shape of; opening
							  all five is the information overload this screen was rebuilt to answer.
							*/
							defaultOpen={index === 0}
						>
							<Group
								group={group}
								busyKey={busyKey}
								onEdit={onEdit}
								onOpen={onOpen}
								onDismiss={dismiss}
							/>
						</DetailRow>
					))}

					<Dismissed backlog={backlog} busyKey={busyKey} onRestore={(key) => act('restore', { key })} />
				</DetailRows>
			</PageSection>
		</div>
	);
}

/**
 * THE SHAPE OF THE THING, STATED BEFORE ANYTHING ELSE.
 *
 * Four readings and the sentence they add up to, exactly as GraphEntry opens. The last card is the
 * argument for the whole screen: names in this store join on exact character identity, so a vault
 * that looks like a field of loose ends is usually a vault whose ends have two spellings.
 *
 * The shares matter more than the totals. "412 findings" means nothing without a denominator;
 * "they touch 214 of your 326 memories" is the sentence that says whether this is a tidy vault with
 * a few loose ends or a vault that is mostly loose ends.
 */
function Shape({ backlog, clusters }) {
	const { counts } = backlog;
	const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

	return (
		<StatStrip>
			<Stat value={counts.memories_touched.toLocaleString()}>
				of your {counts.memory_count.toLocaleString()} memories are involved —{' '}
				{share(counts.memories_touched, counts.memory_count)}%
			</Stat>
			<Stat value={counts.facts_touched.toLocaleString()}>
				of {counts.fact_count.toLocaleString()} facts are split or unreachable
			</Stat>
			<Stat value={clusters.counts.clusters.toLocaleString()} tone="warn">
				{clusters.counts.clusters === 1
					? 'name looks like the same thing, spelled twice'
					: 'names look like the same thing, spelled twice'}
			</Stat>
			<StatNote>
				Names join only when they match character for character, so this is{' '}
				<strong>more connected than it looks.</strong> Every pair you merge turns two loose ends
				into one junction.
			</StatNote>
		</StatStrip>
	);
}

/**
 * THE ONE THING WORTH DOING FIRST, and the only filled control on the screen.
 *
 * It is a card rather than a heading in the list because it is not one of five equal problems. It
 * is the only finding this app can resolve for you, and it is the only change on this screen that
 * makes the vault more useful to an agent rather than merely tidier to look at.
 */
function Lead({ clusters, onReview }) {
	const { counts } = clusters;
	return (
		<div className="card card-accent">
			<div className="card-head">
				<div className="eyebrow">Start here</div>
				<span className="item-count">
					{counts.facts.toLocaleString()} facts · {counts.memories.toLocaleString()} memories
				</span>
			</div>
			<p>
				{counts.clusters === 1
					? 'One name in this vault is written two ways.'
					: `${counts.clusters.toLocaleString()} names in this vault are written more than one way.`}{' '}
				Each spelling is a separate thing to the store, so an agent that reaches one of them
				never sees the other one’s facts — and neither half looks incomplete from where it is
				standing.
				{counts.joining > 0
					? ` ${counts.joining.toLocaleString()} of them would join two parts of your vault that nothing currently connects.`
					: ''}
			</p>
			<div className="decision-actions">
				<Button tone="primary" onClick={onReview}>
					Review {counts.clusters.toLocaleString()}{' '}
					{counts.clusters === 1 ? 'name' : 'names'}
				</Button>
				<span className="item-count">
					Nothing is written until you have seen exactly what would change.
				</span>
			</div>
		</div>
	);
}

/** One kind of problem: what it costs, what resolves it, and every instance in stake order. */
function Group({ group, busyKey, onEdit, onOpen, onDismiss }) {
	const [visible, setVisible] = useState(PAGE);
	const shown = group.findings.slice(0, visible);

	if (group.counts.findings === 0) {
		return (
			<p className="meta">
				Nothing found.
				{group.counts.dismissed > 0
					? ` ${group.counts.dismissed.toLocaleString()} dismissed by you, listed at the bottom of this page.`
					: ''}
			</p>
		);
	}

	return (
		<>
			{/*
			  THE COST, not the definition. "Two names normalise to the same key" describes a
			  detector; it tells a reader nothing about whether to care. Every heading here is
			  followed by the sentence that says what happens if it is left alone, because that is
			  the sentence the decision is actually made on.
			*/}
			<Note>{group.kind.costs}</Note>

			<p className="meta">
				<strong>What resolves it:</strong> {group.kind.fix} This app does not do that for you —
				open the memories and change them. Together these touch{' '}
				{group.counts.facts.toLocaleString()} facts across{' '}
				{group.counts.memories.toLocaleString()} memories.
				{group.counts.dismissed > 0
					? ` ${group.counts.dismissed.toLocaleString()} more are dismissed and not shown here.`
					: ''}
			</p>

			<DecisionList label={group.kind.title}>
				{shown.map((finding) => (
					<Finding
						key={finding.key}
						finding={finding}
						busy={busyKey === finding.key}
						onEdit={onEdit}
						onOpen={onOpen}
						onDismiss={onDismiss}
					/>
				))}
			</DecisionList>

			{visible < group.findings.length ? (
				<Button onClick={() => setVisible(visible + PAGE)}>
					{/*
					  The remainder is NAMED, always. A bare "Show more" on a list of two hundred and
					  forty-nine hides how much is left, and a reader deciding whether to keep going is
					  deciding on exactly that number.
					*/}
					{group.findings.length - visible <= PAGE
						? `Show the last ${(group.findings.length - visible).toLocaleString()}`
						: `Show ${PAGE} more — ${(group.findings.length - visible).toLocaleString()} still below`}
				</Button>
			) : null}
		</>
	);
}

/** One finding: what it is, what is at stake, where it came from, and the way to answer it. */
function Finding({ finding, busy, onEdit, onOpen, onDismiss }) {
	const [asking, setAsking] = useState(false);
	const [reason, setReason] = useState('');

	return (
		<Decision
			lead={<span>{finding.label}</span>}
			stake={`${finding.stake.facts.toLocaleString()} ${
				finding.stake.facts === 1 ? 'fact' : 'facts'
			} · ${finding.memories.length.toLocaleString()} ${
				finding.memories.length === 1 ? 'memory' : 'memories'
			}`}
			actions={
				asking ? null : (
					<Button size="sm" onClick={() => setAsking(true)}>
						Not a problem
					</Button>
				)
			}
		>
			<Detail finding={finding} />

			{finding.memories.length === 0 ? (
				<Note tone="warn">
					No memory could be named for this one. Every finding on this screen is supposed to end
					in a memory you can open, so this row is a defect in this app rather than in your
					vault.
				</Note>
			) : (
				<Memories memories={finding.memories} onEdit={onEdit} onOpen={onOpen} />
			)}

			{asking ? (
				<form
					className="decision-actions"
					onSubmit={(event) => {
						event.preventDefault();
						onDismiss(finding, reason);
						setAsking(false);
					}}
				>
					<label className="meta" htmlFor={`why-${finding.key}`}>
						Why is this not a problem?
					</label>
					<Input
						id={`why-${finding.key}`}
						value={reason}
						autoComplete="off"
						placeholder="they really are two different things"
						onChange={(event) => setReason(event.target.value)}
					/>
					<Button type="submit" size="sm" disabled={busy}>
						{busy ? 'Saving…' : 'Dismiss it'}
					</Button>
					<Button size="sm" onClick={() => setAsking(false)}>
						Cancel
					</Button>
					{/*
					  Said at the point of the click, not in a footer. This app has no way to tell the
					  store that a person decided two names are different — no published operation
					  records it — so a dismissal is this app's own note about this app's own screen, and
					  a user who thought otherwise would believe their agents had been told something
					  they have not.
					*/}
					<span className="item-count">
						This changes what this app shows you. Your vault is not touched.
					</span>
				</form>
			) : null}
		</Decision>
	);
}

/**
 * The memories one finding comes from, with a ceiling on how many are on screen at once.
 *
 * THE CEILING IS THE WHOLE REASON THIS IS A COMPONENT. A name declared under two kinds in nine
 * memories renders nine rows, and twenty-seven such findings render two hundred and forty — which
 * is the page the owner was looking at when they said "I had to scroll for ten minutes". Four rows
 * plus the exact number of the rest is the same information at a tenth of the height, and the rest
 * are one press away rather than gone.
 */
function Memories({ memories, onEdit, onOpen }) {
	const [all, setAll] = useState(false);
	const shown = all ? memories : memories.slice(0, SOURCES);

	return (
		<>
			<Sources>
				{shown.map((memory) => (
					<Source key={memory.memory_id}>
						{/*
						  THE EDITOR, not the reading page. Every finding here is resolved by changing a
						  memory, and a route that lands on a read-only page makes the reader find the
						  same memory a second time through a different door.
						*/}
						<button type="button" className="btn btn-quiet" onClick={() => onEdit(memory.memory_id)}>
							{memory.title ?? memory.memory_id}
						</button>
						{memory.notes.length > 0 ? (
							<span className="decision-source-note">{memory.notes.join(' · ')}</span>
						) : null}
						<button type="button" className="btn btn-quiet" onClick={() => onOpen(memory.memory_id)}>
							read it first
						</button>
					</Source>
				))}
			</Sources>
			{memories.length > SOURCES ? (
				<button type="button" className="btn btn-quiet" onClick={() => setAll(!all)}>
					{all
						? `Show fewer than ${memories.length.toLocaleString()}`
						: `Show the other ${(memories.length - SOURCES).toLocaleString()}`}
				</button>
			) : null}
		</>
	);
}

/** The evidence, per kind. Enough to decide without opening anything. */
function Detail({ finding }) {
	if (finding.kind === 'kind-conflict') {
		return (
			<>
				<div className="decision-lead">
					<span className="meta">Declared as</span>
					{finding.detail.kinds.map((entry) => (
						<Badge key={entry.kind} tone="warn">
							{entry.kind} · {entry.count}
						</Badge>
					))}
				</div>
				<Glosses glosses={finding.detail.glosses} />
			</>
		);
	}

	if (finding.kind === 'island' || finding.kind === 'once-used-predicate') {
		const fact = finding.kind === 'island' ? finding.detail : finding.detail.fact;
		if (!fact) return null;
		return (
			<div className="decision-lead">
				<Identifier value={fact.subject} />
				<Badge tone="accent">{fact.predicate ?? 'no relation name'}</Badge>
				<Identifier value={fact.object} />
			</div>
		);
	}

	if (finding.kind === 'declared-never-used') {
		return (
			<>
				<div className="decision-lead">
					<span className="meta">Declared</span>
					{finding.detail.kinds.map((kind) => (
						<Badge key={kind}>{kind}</Badge>
					))}
					<span className="meta">and never written into a fact.</span>
				</div>
				<Glosses glosses={finding.detail.glosses} />
			</>
		);
	}

	return null;
}

/**
 * THE SENTENCES SOMEBODY WROTE ABOUT THIS NAME, one per line and capped.
 *
 * They are the evidence a kind conflict actually turns on: "is this a tool or a project" is
 * answered by reading what the two memories said it was, not by comparing two kind labels. Side by
 * side in a wrapping row they read as one run-on sentence, which is how the previous version of
 * this screen made its most useful evidence unreadable — so they are a list.
 *
 * Capped, because a name declared in nine memories carries nine of them and the row stops being a
 * row. The cap says how many it is hiding, which is the difference between deferring and losing.
 */
function Glosses({ glosses }) {
	const [all, setAll] = useState(false);
	if (glosses.length === 0) return null;
	const shown = all ? glosses : glosses.slice(0, GLOSSES);

	return (
		<>
			<Sources>
				{shown.map((gloss) => (
					<Source key={gloss}>
						<span className="meta">“{gloss}”</span>
					</Source>
				))}
			</Sources>
			{glosses.length > GLOSSES ? (
				<button type="button" className="btn btn-quiet" onClick={() => setAll(!all)}>
					{all
						? 'Show fewer of these sentences'
						: `Show the other ${(glosses.length - GLOSSES).toLocaleString()}`}
				</button>
			) : null}
		</>
	);
}

/**
 * WHAT YOU DECIDED WAS NOT A PROBLEM — reviewable, and reversible from the same row.
 *
 * A hide with no review is how a backlog quietly stops reporting the thing it exists to report: a
 * user who dismisses the wrong row has no way to find out, and every count after that is smaller
 * for a reason nobody can see. So the dismissals are listed, with the words the user typed, the day
 * they typed them, and one control that puts the finding back.
 */
function Dismissed({ backlog, busyKey, onRestore }) {
	const { counts, dismissed, resolved } = backlog;
	if (counts.dismissed === 0 && counts.resolved === 0) return null;

	return (
		<DetailRow label="Dismissed by you" count={counts.dismissed.toLocaleString()}>
			<Note>
				These are kept in this app’s own state directory, beside its copies and keyed to this
				vault — never in the vault itself, because the store has no place to record that a person
				looked at two names and decided they were different.
			</Note>

			<DecisionList label="Dismissed findings">
				{dismissed.map((finding) => (
					<Decision
						key={finding.key}
						lead={<span>{finding.label}</span>}
						stake={
							finding.dismissal?.dismissed_at
								? new Date(finding.dismissal.dismissed_at).toLocaleDateString()
								: null
						}
						actions={
							<Button
								size="sm"
								disabled={busyKey === finding.key}
								onClick={() => onRestore(finding.key)}
							>
								{busyKey === finding.key ? 'Putting it back…' : 'Put it back'}
							</Button>
						}
					>
						<p className="meta">
							{kindById(finding.kind)?.title ?? finding.kind}
							{finding.dismissal?.reason ? ` — “${finding.dismissal.reason}”` : ''}
						</p>
					</Decision>
				))}
			</DecisionList>

			{/*
			  A dismissal whose finding is no longer in the vault. Reported rather than dropped,
			  because the commonest reason a key stops matching is that the user FIXED the thing —
			  which is the one outcome this screen should be able to show — and the second commonest is
			  that this app changed how it keys findings, which is a defect that would otherwise be
			  invisible.
			*/}
			{resolved.length > 0 ? (
				<>
					<Note>
						{resolved.length.toLocaleString()} things you dismissed are not among today’s
						findings at all. Either you fixed them, or the memories behind them were removed.
						They are kept so the record of what you decided is not quietly thrown away.
					</Note>
					<DecisionList label="No longer found in this vault">
						{resolved.map((entry) => (
							<Decision
								key={entry.key}
								lead={<span>{entry.label ?? entry.names?.join(' · ') ?? entry.key}</span>}
								actions={
									<Button
										size="sm"
										disabled={busyKey === entry.key}
										onClick={() => onRestore(entry.key)}
									>
										Forget this dismissal
									</Button>
								}
							/>
						))}
					</DecisionList>
				</>
			) : null}
		</DetailRow>
	);
}
