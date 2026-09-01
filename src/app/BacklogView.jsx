import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchDismissals, setDismissal } from './api.mjs';
import { buildBacklog, dismissalRecordFor, kindById } from './backlog-model.mjs';
import { buildGraph } from './graph-model.mjs';
import { UnifySpelling } from './MergeFlow.jsx';
import { Chip, EmptyState, ErrorState, LoadingState } from './ui.jsx';

/** How many findings of one kind go into the DOM before the reader asks for more. */
const PAGE = 25;

/**
 * THE BACKLOG.
 *
 * The graph screen already found all of this and showed it in a rail, where it was a list of
 * nominations that went nowhere. Three things make it a screen instead:
 *
 *   * it is REACHABLE — from the main navigation, not from inside a drawing;
 *   * it has an ORDER, printed at the top in the same words the sort used; and
 *   * a finding can be ANSWERED. "These two really are different things" is the commonest true
 *     answer to a near-duplicate, and until there was somewhere to put it the backlog was unusable
 *     on the second visit: the same twelve pairs, in the same order, forever.
 *
 * The near-duplicate rows now have a second route out: **unify the spelling**, which is N writes
 * across N memories with no engine operation behind it. It arrives here rather than on the graph
 * because this is where the finding is, and it arrives only now because it needed the snapshot
 * spine underneath it — a "unify these" button that wrote nothing would have been worse than its
 * absence, and one that wrote without a copy would have been worse still.
 *
 * Every OTHER kind of finding still ends in one memory open in the editor. Four of the five are
 * decisions about a single memory's content and there is nothing for a run to do.
 */
export function BacklogView({ records, onEdit, onOpen, onBack, onShowGraph }) {
	const graph = useMemo(() => buildGraph(records), [records]);

	const [dismissed, setDismissed] = useState(null);
	const [storeError, setStoreError] = useState(null);
	const [writeError, setWriteError] = useState(null);
	const [busyKey, setBusyKey] = useState(null);
	const [showDismissed, setShowDismissed] = useState(false);
	/*
	  The curation run in flight, if any. It is state on this screen rather than a route because it
	  is started from a finding and it carries that finding's evidence with it: a URL would have to
	  re-derive which pair the user was looking at, and the two spellings are the whole of what the
	  run is about.
	*/
	const [unifying, setUnifying] = useState(null);

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

	if (storeError) {
		return (
			<ErrorState
				heading="What you have already dismissed could not be read"
				error={storeError}
				action={
					<button type="button" className="button" onClick={load}>
						Try again
					</button>
				}
			/>
		);
	}

	if (dismissed === null) return <LoadingState what="Reading what you have already dismissed" />;

	if (unifying) {
		return (
			<UnifySpelling
				records={records}
				spellings={unifying.spellings}
				evidence={unifying.evidence}
				onOpen={onOpen}
				onEdit={onEdit}
				onDone={() => setUnifying(null)}
			/>
		);
	}

	if (graph.counts.edgeCount === 0) {
		return (
			<EmptyState
				heading="There is nothing here to curate yet"
				action={
					<button type="button" className="button" onClick={onBack}>
						Back to the list
					</button>
				}
			>
				<p>
					Every finding on this screen is about how the facts in your memories join up to each
					other, and this vault has no fact with two named ends. That is not a fault — prose-only
					memories are memories, and they are served like any other.
				</p>
			</EmptyState>
		);
	}

	return (
		<div className="backlog">
			<Head backlog={backlog} onBack={onBack} onShowGraph={onShowGraph} />

			{writeError ? (
				<p className="banner banner-warn" role="alert">
					{writeError.message} Nothing on this screen was changed and nothing in your vault was
					touched.
				</p>
			) : null}

			{backlog.counts.findings === 0 ? (
				<EmptyState heading="Nothing is outstanding">
					<p>
						{backlog.counts.dismissed > 0
							? `Every finding this app can compute has been answered — ${backlog.counts.dismissed.toLocaleString()} of them are dismissed and listed below.`
							: 'None of the five checks below found anything in this vault. That is unusual and it is worth knowing what was checked, so the headings are still here.'}
					</p>
				</EmptyState>
			) : null}

			{backlog.groups.map((group) => (
				<Group
					key={group.kind.id}
					group={group}
					busyKey={busyKey}
					onEdit={onEdit}
					onOpen={onOpen}
					onDismiss={(finding, reason) =>
						act('dismiss', dismissalRecordFor(finding, { reason }))
					}
					onUnify={(finding) =>
						setUnifying({
							spellings: finding.names,
							// The evidence per spelling travels with the run, because choosing which
							// spelling survives is also choosing which KIND survives, and the pairs in
							// a real vault routinely disagree about that.
							evidence: finding.detail?.spellings ?? [],
						})
					}
				/>
			))}

			<Dismissed
				backlog={backlog}
				open={showDismissed}
				setOpen={setShowDismissed}
				busyKey={busyKey}
				onRestore={(key) => act('restore', { key })}
			/>
		</div>
	);
}

/**
 * The counts, and the ordering rule, above everything.
 *
 * Two things are said here that a findings list usually leaves out. The first is the SHARE: "412
 * findings" means nothing without a denominator, and "they touch 214 of your 326 memories" is what
 * tells a person whether this is a tidy vault with loose ends or a vault that is mostly loose ends.
 * The second is the ORDER, in the same words the sort used — a list in an unexplained order is read
 * as a priority list, and then the bottom of it is never read.
 */
function Head({ backlog, onBack, onShowGraph }) {
	const { counts, ranking } = backlog;
	const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

	return (
		<header className="backlog-head">
			<div className="backlog-head-row">
				<button type="button" className="button" onClick={onBack}>
					← The list
				</button>
				<h1>What needs a decision</h1>
				<button type="button" className="button" onClick={onShowGraph}>
					See it as a drawing
				</button>
			</div>

			<p className="backlog-lede">
				Nothing on this screen has been changed and nothing here changes anything on its own.
				These are the things that go wrong <em>between</em> memories — each memory below is fine
				on its own page, which is why none of this is visible from one.
			</p>

			<dl className="backlog-counts">
				<div>
					<dt>Outstanding</dt>
					<dd>{counts.findings.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Dismissed by you</dt>
					<dd>{counts.dismissed.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Memories they touch</dt>
					<dd>
						{counts.memories_touched.toLocaleString()}
						<span className="backlog-of">
							{' '}
							of {counts.memory_count.toLocaleString()} ·{' '}
							{share(counts.memories_touched, counts.memory_count)}%
						</span>
					</dd>
				</div>
				<div>
					<dt>Names they touch</dt>
					<dd>
						{counts.names_touched.toLocaleString()}
						<span className="backlog-of">
							{' '}
							of {counts.name_count.toLocaleString()} ·{' '}
							{share(counts.names_touched, counts.name_count)}%
						</span>
					</dd>
				</div>
				<div>
					<dt>Facts they touch</dt>
					<dd>
						{counts.facts_touched.toLocaleString()}
						<span className="backlog-of">
							{' '}
							of {counts.fact_count.toLocaleString()} ·{' '}
							{share(counts.facts_touched, counts.fact_count)}%
						</span>
					</dd>
				</div>
			</dl>

			<p className="backlog-ranking">
				<strong>The order:</strong> {ranking.sentence} {ranking.groups}
			</p>
		</header>
	);
}

/** One kind of problem: what it is, what it costs, and every instance of it, in stake order. */
function Group({ group, busyKey, onEdit, onOpen, onDismiss, onUnify }) {
	const [visible, setVisible] = useState(PAGE);
	const shown = group.findings.slice(0, visible);

	return (
		<section className="backlog-group">
			<h2>
				{group.kind.title}
				<span className="backlog-group-count">{group.counts.findings.toLocaleString()}</span>
			</h2>

			{/*
			  THE COST, not the definition. "Two names normalise to the same key" is a description of
			  a detector; it tells a reader nothing about whether to care. Every heading here is
			  followed by the sentence that says what happens if it is left alone, because that is
			  the sentence the decision is actually made on.
			*/}
			<p className="backlog-cost">{group.kind.costs}</p>
			{/*
			  WHAT RESOLVES IT, AND WHETHER THIS APP CAN DO IT.

			  The second sentence used to be unconditional — "this app does not do that for you" — and
			  one kind of finding now has a run behind it. A screen that denies a button it is about to
			  render teaches the reader to stop believing the sentence, which is expensive here: the
			  other four denials are true, and they are the ones that matter.
			*/}
			<p className="backlog-fix">
				<strong>What resolves it:</strong> {group.kind.fix}{' '}
				{group.kind.id === 'near-duplicate'
					? 'This app can do that across every memory that uses the name — one at a time, with a ' +
						'preview first and a copy before each write.'
					: 'This app does not do that for you — open the memories and change them.'}
			</p>

			{group.counts.findings === 0 ? (
				<p className="backlog-none">
					Nothing found.
					{group.counts.dismissed > 0
						? ` ${group.counts.dismissed.toLocaleString()} dismissed by you, listed at the bottom.`
						: ''}
				</p>
			) : (
				<>
					<p className="backlog-group-stake">
						Together these touch {group.counts.facts.toLocaleString()} facts across{' '}
						{group.counts.memories.toLocaleString()} memories.
						{group.counts.dismissed > 0
							? ` ${group.counts.dismissed.toLocaleString()} more are dismissed and not shown here.`
							: ''}
					</p>

					<ol className="backlog-findings">
						{shown.map((finding) => (
							<Finding
								key={finding.key}
								finding={finding}
								busy={busyKey === finding.key}
								onEdit={onEdit}
								onUnify={onUnify}
								onOpen={onOpen}
								onDismiss={onDismiss}
							/>
						))}
					</ol>

					{visible < group.findings.length ? (
						<button
							type="button"
							className="button"
							onClick={() => setVisible(visible + PAGE)}
						>
							{/*
							  The remainder is named, always. A bare "Show more" on a list of two
							  hundred and forty-nine hides how much is left, and a reader deciding
							  whether to keep going is deciding on exactly that number.
							*/}
							{group.findings.length - visible <= PAGE
								? `Show the last ${(group.findings.length - visible).toLocaleString()}`
								: `Show ${PAGE} more — ${(group.findings.length - visible).toLocaleString()} still below`}
						</button>
					) : null}
				</>
			)}
		</section>
	);
}

/** One finding: what it is, what is at stake, where it came from, and the one way to answer it. */
function Finding({ finding, busy, onEdit, onOpen, onDismiss, onUnify }) {
	const [asking, setAsking] = useState(false);
	const [reason, setReason] = useState('');

	return (
		<li className="backlog-finding">
			<div className="backlog-finding-head">
				<span className="backlog-finding-label">{finding.label}</span>
				{/*
				  The stake, on the row, in the same quantities the sort used. A rank number would be
				  a claim the reader cannot check; two counts are a claim they can.
				*/}
				<span className="backlog-stake">
					{finding.stake.facts.toLocaleString()}{' '}
					{finding.stake.facts === 1 ? 'fact' : 'facts'} ·{' '}
					{finding.memories.length.toLocaleString()}{' '}
					{finding.memories.length === 1 ? 'memory' : 'memories'}
				</span>
			</div>

			<Detail finding={finding} />

			{finding.memories.length === 0 ? (
				<p className="backlog-none">
					No memory could be named for this one. Every finding on this screen is supposed to end
					in a memory you can open, so this row is a defect in this app rather than in your
					vault.
				</p>
			) : (
				<ul className="backlog-memories">
					{finding.memories.map((memory) => (
						<li key={memory.memory_id}>
							{/*
							  THE EDITOR, not the reader's page. Every finding here is resolved by
							  changing a memory, and a route that lands on a read-only page makes the
							  reader find the same memory a second time through a different door.
							*/}
							<button
								type="button"
								className="linklike backlog-memory"
								onClick={() => onEdit(memory.memory_id)}
							>
								{memory.title ?? memory.memory_id}
							</button>
							{memory.notes.length > 0 ? (
								<span className="backlog-memory-note">{memory.notes.join(' · ')}</span>
							) : null}
							<button
								type="button"
								className="linklike backlog-memory-read"
								onClick={() => onOpen(memory.memory_id)}
							>
								read it first
							</button>
						</li>
					))}
				</ul>
			)}

			<div className="backlog-actions">
				{asking ? (
					<form
						className="backlog-dismiss-form"
						onSubmit={(event) => {
							event.preventDefault();
							onDismiss(finding, reason);
							setAsking(false);
						}}
					>
						<label htmlFor={`why-${finding.key}`}>Why is this not a problem? (optional)</label>
						<input
							id={`why-${finding.key}`}
							type="text"
							value={reason}
							autoComplete="off"
							placeholder="they really are two different things"
							onChange={(event) => setReason(event.target.value)}
						/>
						<button type="submit" className="button" disabled={busy}>
							{busy ? 'Saving…' : 'Dismiss it'}
						</button>
						<button type="button" className="button" onClick={() => setAsking(false)}>
							Cancel
						</button>
						{/*
						  Said at the point of the click, not in a footer. This app has no way to tell
						  the store that a person decided two names are different — no published
						  operation records it — so a dismissal is this app's own note about this
						  app's own screen, and a user who thought otherwise would believe their
						  agents had been told something they have not.
						*/}
						<p className="backlog-dismiss-note">
							This only changes what this app shows you. Your vault is not touched, and your
							agents are not told anything.
						</p>
					</form>
				) : (
					<>
						{/*
						  THE RUN, offered only where there is one to offer. Four of the five kinds of
						  finding are decisions about one memory's content; this is the only one that is
						  the same edit repeated across every memory that uses a name, which is exactly
						  what makes it worth a run and exactly what makes it dangerous by hand.

						  It opens a PREVIEW. Nothing is written from this click.
						*/}
						{finding.kind === 'near-duplicate' && finding.names.length === 2 ? (
							<button type="button" className="button" onClick={() => onUnify?.(finding)}>
								Unify the spelling…
							</button>
						) : null}
						<button type="button" className="button" onClick={() => setAsking(true)}>
							Not a problem
						</button>
					</>
				)}
			</div>
		</li>
	);
}

/** The evidence, per kind. Enough to decide without opening anything. */
function Detail({ finding }) {
	if (finding.kind === 'near-duplicate') {
		return (
			<div className="backlog-detail">
				<ul className="backlog-spellings">
					{finding.detail.spellings.map((spelling) => (
						<li key={spelling.surface}>
							<code className="identifier">{spelling.surface}</code>
							<span className="backlog-stake">
								{spelling.facts} {spelling.facts === 1 ? 'fact' : 'facts'}
							</span>
							{spelling.kinds.map((kind) => (
								<Chip key={kind}>{kind}</Chip>
							))}
							{spelling.declared ? null : <Chip tone="warn">never declared</Chip>}
						</li>
					))}
				</ul>
				<p className="backlog-why">
					{finding.detail.rule === 'punctuation-and-case'
						? 'These differ only in punctuation or case.'
						: 'These are the same words in a different order, or with an article on one side.'}{' '}
					{finding.detail.same_component
						? 'Both spellings already sit in one connected group, so unifying them relabels rather than reconnects.'
						: 'They sit in separate groups, so unifying them would join two parts of your vault that nothing currently connects.'}
					{finding.detail.spellings.some(
						(spelling) =>
							spelling.kinds.length > 0 &&
							spelling.kinds.join() !== finding.detail.spellings[0].kinds.join(),
					)
						? ' They are also declared as different kinds, so unifying the spelling is also a decision about the kind.'
						: ''}
				</p>
			</div>
		);
	}

	if (finding.kind === 'kind-conflict') {
		return (
			<div className="backlog-detail">
				<p className="backlog-why">
					Declared as{' '}
					{finding.detail.kinds.map((entry, index) => (
						<span key={entry.kind}>
							{index > 0 ? ' and ' : ''}
							<Chip tone="warn">{entry.kind}</Chip>
							<span className="backlog-of"> ({entry.count})</span>
						</span>
					))}
					.
				</p>
				{finding.detail.glosses.length > 0 ? (
					<ul className="backlog-glosses">
						{finding.detail.glosses.map((gloss) => (
							<li key={gloss}>“{gloss}”</li>
						))}
					</ul>
				) : null}
			</div>
		);
	}

	if (finding.kind === 'island') {
		return (
			<p className="backlog-detail backlog-triple">
				<code className="identifier">{finding.detail.subject}</code>
				<em>{finding.detail.predicate ?? 'no relation name'}</em>
				<code className="identifier">{finding.detail.object}</code>
			</p>
		);
	}

	if (finding.kind === 'once-used-predicate') {
		return finding.detail.fact ? (
			<p className="backlog-detail backlog-triple">
				<code className="identifier">{finding.detail.fact.subject}</code>
				<em>{finding.detail.fact.predicate}</em>
				<code className="identifier">{finding.detail.fact.object}</code>
			</p>
		) : null;
	}

	if (finding.kind === 'declared-never-used') {
		return (
			<div className="backlog-detail">
				<p className="backlog-why">
					Declared{finding.detail.kinds.length > 0 ? ' as ' : ''}
					{finding.detail.kinds.map((kind) => (
						<Chip key={kind}>{kind}</Chip>
					))}
					, and never written into a fact.
				</p>
				{finding.detail.glosses.map((gloss) => (
					<p key={gloss} className="backlog-gloss">
						“{gloss}”
					</p>
				))}
			</div>
		);
	}

	return null;
}

/**
 * What you decided was not a problem — reviewable, and reversible from the same screen.
 *
 * A hide with no review is how a backlog quietly stops reporting the thing it exists to report: a
 * user who dismisses the wrong row has no way to find out, and every count after that is smaller
 * for a reason nobody can see. So the dismissals are listed, with the words the user typed, the day
 * they typed them, and one button that puts the finding back.
 */
function Dismissed({ backlog, open, setOpen, busyKey, onRestore }) {
	const { counts, dismissed, resolved } = backlog;
	if (counts.dismissed === 0 && counts.resolved === 0) return null;

	return (
		<section className="backlog-group backlog-dismissed">
			<h2>
				Dismissed by you
				<span className="backlog-group-count">{counts.dismissed.toLocaleString()}</span>
			</h2>
			<p className="backlog-cost">
				These are kept in this app's own state directory, beside its snapshots and keyed to this
				vault — never in the vault itself, because the store has no place to record that a person
				looked at two names and decided they were different.
			</p>
			<button type="button" className="button" onClick={() => setOpen(!open)}>
				{open ? 'Hide them' : `Review the ${counts.dismissed.toLocaleString()} you dismissed`}
			</button>

			{open ? (
				<>
					<ul className="backlog-dismissed-list">
						{dismissed.map((finding) => (
							<li key={finding.key}>
								<span className="backlog-finding-label">{finding.label}</span>
								<span className="backlog-of">
									{kindById(finding.kind)?.title ?? finding.kind}
									{finding.dismissal?.dismissed_at
										? ` · ${new Date(finding.dismissal.dismissed_at).toLocaleDateString()}`
										: ''}
								</span>
								{finding.dismissal?.reason ? (
									<span className="backlog-memory-note">
										“{finding.dismissal.reason}”
									</span>
								) : null}
								<button
									type="button"
									className="linklike"
									disabled={busyKey === finding.key}
									onClick={() => onRestore(finding.key)}
								>
									{busyKey === finding.key ? 'putting it back…' : 'put it back'}
								</button>
							</li>
						))}
					</ul>

					{/*
					  A dismissal whose finding is no longer in the vault. Reported rather than
					  dropped, because the commonest reason a key stops matching is that the user
					  FIXED the thing — which is the one outcome this screen should be able to show
					  — and the second commonest is that this app changed how it keys findings, which
					  is a defect that would otherwise be invisible.
					*/}
					{resolved.length > 0 ? (
						<div className="backlog-resolved">
							<h3>No longer found in this vault</h3>
							<p className="backlog-cost">
								{resolved.length.toLocaleString()} things you dismissed are not among today's
								findings at all. Either you fixed them, or the memories behind them were
								removed. They are kept so the record of what you decided is not quietly
								thrown away.
							</p>
							<ul className="backlog-dismissed-list">
								{resolved.map((entry) => (
									<li key={entry.key}>
										<span className="backlog-finding-label">
											{entry.label ?? entry.names?.join(' · ') ?? entry.key}
										</span>
										<button
											type="button"
											className="linklike"
											disabled={busyKey === entry.key}
											onClick={() => onRestore(entry.key)}
										>
											forget this dismissal
										</button>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</>
			) : null}
		</section>
	);
}
