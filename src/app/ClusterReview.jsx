import { useCallback, useMemo, useState } from 'react';

import { fetchSnapshot, runRename } from './api.mjs';
import {
	describeBatchResume,
	planClusterBatch,
	samePlanShape,
	stepRequest,
	summariseBatch,
} from './cluster-model.mjs';
import { planRename, renameRequest, reversibilityFor } from './merge-model.mjs';
import {
	Badge,
	Button,
	Checkbox,
	ChoiceRow,
	Decision,
	DecisionList,
	DegreeBar,
	DetailRow,
	DetailRows,
	EmptyState,
	ErrorState,
	Note,
	PageHead,
	Rewrite,
	Rewrites,
	RunBar,
	Source,
	Sources,
	Stat,
	StatNote,
	StatStrip,
	Table,
	Td,
	Th,
	Tr,
} from './ui/index.mjs';

/**
 * THE CLUSTER REVIEW — OpenRefine's, on this vault's names.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCREEN IS THE POINT OF THE CURATION SURFACE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Names in this store join on exact character identity, and roughly three in four appear in exactly
 * one fact. A vault that looks like a field of loose ends is usually a vault whose ends are spelled
 * two ways, so merging a pair does not tidy the picture — it turns two degree-1 leaves into one
 * degree-2 junction, which is a real edge an agent can walk. It is the only thing in this product
 * that improves the data.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * FOUR STAGES, AND THE WRITE IS ISSUED FROM THE THIRD
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   REVIEW    the fingerprint's proposals. Tick the ones that are really one thing; pick the
 *             spelling that survives. Nothing is written and nothing is read.
 *   PREVIEW   every memory the batch would write, and what each of its facts becomes. Named, never
 *             counted — a count is a number a person cannot check.
 *   RUN       one rename at a time, one memory at a time, a copy before each write, stopping at the
 *             first refusal.
 *   RECEIPT   the boundary: what landed, where it stopped, what was never attempted — and then the
 *             clustering is recomputed, because the next pass must be over the vault as it is now.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE MERGE IS N UPDATES. THE ENGINE HAS NO WORKING ONE.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The engine publishes an operation that would do this in one call. Run against a real vault it
 * reports that it applied, with mass conserved, and leaves both names present, addressable and
 * served. A button on it ships green — its own tests pass, it returns success — and the user
 * watches the list not change and concludes this app is broken. So the merge here is composed out
 * of the one write whose effect this app has actually observed: rewrite every memory that names the
 * losing spelling, as N updates, each carrying the version the user was shown and each preceded by
 * a copy.
 */
export function ClusterReview({
	records,
	clusters,
	busyKey,
	onDismiss,
	onReread,
	onOpen,
	onEdit,
	onDone,
}) {
	const [stage, setStage] = useState('review');
	const [ticked, setTicked] = useState(() => new Set());
	const [survivors, setSurvivors] = useState(() => new Map());
	/*
	  The batch the reader is looking at. Frozen into state at the moment "Preview" is pressed, so
	  the panel cannot change under them between reading it and confirming it — a preview recomputed
	  on every render would silently become a different preview when the parent re-read the vault.
	*/
	const [batch, setBatch] = useState(null);
	const [results, setResults] = useState([]);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);
	// Whether the panel on screen is the remainder of a run that stopped, which changes what it
	// says about itself and nothing about what it does.
	const [resuming, setResuming] = useState(false);

	const chosen = useMemo(
		() =>
			clusters.clusters
				.filter((cluster) => ticked.has(cluster.key))
				.map((cluster) => {
					const survivor = survivors.get(cluster.key) ?? cluster.survivor;
					return {
						...cluster,
						survivor,
						losing: cluster.spellings
							.map((entry) => entry.surface)
							.filter((surface) => surface !== survivor),
					};
				}),
		[clusters, ticked, survivors],
	);

	// What the ticked set would write, computed live so the bar at the bottom is never a guess.
	const proposed = useMemo(() => planClusterBatch(records, chosen), [records, chosen]);

	const toggle = useCallback((key) => {
		setTicked((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	/**
	 * THE RUN. One rename at a time, and it stops at the first thing that is not a plain success.
	 *
	 * Between steps it RE-READS THE VAULT, for two independent reasons. The versions: a memory
	 * written by step one carries a new version, and step two would otherwise send the version the
	 * preview was built from and be refused for a conflict this app caused. The content: a step
	 * whose rewrite no longer matches what the reader approved is not sent at all, which is the same
	 * guarantee a single write's version check gives, lifted to the batch.
	 */
	const run = useCallback(
		async (plan) => {
			setStage('running');
			setBusy(true);
			setError(null);

			const collected = plan.steps.map(() => ({ state: 'not_attempted' }));
			let live = records;
			let wrote = false;

			for (let index = 0; index < plan.steps.length; index += 1) {
				const step = plan.steps[index];

				if (step.writes === 0) {
					// Reported rather than skipped. It is how a reader finds out that one half of a
					// cluster is a spelling no memory actually writes, which is invisible from the row.
					collected[index] = { state: 'nothing_to_write' };
					setResults([...collected]);
					continue;
				}

				let request = stepRequest(step);

				if (wrote) {
					let fresh;
					try {
						fresh = await onReread?.();
					} catch (cause) {
						collected[index] = { state: 'failed', error: cause };
						break;
					}
					live = fresh ?? live;
					const replanned = planRename(live, { from: step.from, to: step.to });
					const agreement = samePlanShape(step.plan, replanned);
					if (!agreement.same) {
						collected[index] = { state: 'moved', why: agreement.why };
						break;
					}
					request = renameRequest(replanned);
				}

				let report;
				try {
					report = await runRename(request);
				} catch (cause) {
					collected[index] = { state: 'failed', error: cause, request };
					break;
				}

				wrote = true;
				collected[index] = { state: report.stopped ? 'stopped' : 'done', report, request };
				setResults([...collected]);
				if (report.stopped) break;
			}

			setResults([...collected]);
			setBusy(false);
			setStage('receipt');

			// RE-CLUSTER. The parent re-reads the vault, which rebuilds the graph, the findings and
			// the clusters — so the review this screen returns to is over what the vault holds now
			// rather than over what it held when the page loaded. A review screen that kept showing
			// pre-merge clusters would invite the same merge twice, and the second one writes every
			// memory again to change nothing.
			if (wrote) {
				try {
					await onReread?.();
				} catch {
					// The run is over and its report is on screen. A failed re-read means the counts
					// behind this screen are stale, which the receipt's own button will retry; it is
					// not a reason to replace a report the reader needs with an error about a read.
				}
			}
		},
		[records, onReread],
	);

	const summary = useMemo(
		() => (batch ? summariseBatch(batch.steps, results) : null),
		[batch, results],
	);

	if (stage === 'preview' && batch) {
		return (
			<PreviewBatch
				batch={batch}
				resuming={resuming}
				error={error}
				busy={busy}
				onOpen={onOpen}
				onEdit={onEdit}
				onBack={() => {
					setBatch(null);
					setResuming(false);
					setStage('review');
				}}
				onConfirm={() => run(batch)}
			/>
		);
	}

	if ((stage === 'running' || stage === 'receipt') && summary) {
		return (
			<Receipt
				summary={summary}
				running={stage === 'running'}
				onOpen={onOpen}
				onResume={async () => {
					/*
					  RESUME IS A FRESH PREVIEW, NOT A REPLAY — and it re-plans the WHOLE batch rather
					  than restarting at an index.
					
					  Re-planning is what makes "without redoing" true, and it is stronger than
					  arithmetic on step numbers would be: a rename that already finished names a
					  spelling no memory writes any more, so it re-plans to zero memories and is
					  reported as nothing to write. The same holds inside the rename that stopped —
					  the memories that landed no longer carry the old spelling, so the plan does not
					  name them. Nothing that landed is written twice, and nothing has to be counted
					  to make that true.
					
					  An index would also have been WRONG here: the re-read changes which clusters
					  exist, so the step numbering the previous run stopped at need not survive it.
					*/
					setBusy(true);
					try {
						const fresh = (await onReread?.()) ?? records;
						const remaining = planClusterBatch(fresh, chosen);
						setBatch(remaining);
						setResuming(true);
						setStage('preview');
					} catch (cause) {
						setError(cause);
					} finally {
						setBusy(false);
					}
				}}
				onAgain={() => {
					setTicked(new Set());
					setBatch(null);
					setResults([]);
					setResuming(false);
					setStage('review');
				}}
				onDone={onDone}
				busy={busy}
			/>
		);
	}

	if (clusters.counts.clusters === 0) {
		return (
			<div className="page">
				<PageHead title="Names that may be one thing" />
				<EmptyState
					heading="Nothing here looks like the same name twice"
					action={<Button onClick={onDone}>Back to what needs a decision</Button>}
				>
					<p>
						{clusters.counts.dismissed > 0
							? `Every proposal has been answered — ${clusters.counts.dismissed.toLocaleString()} of them are dismissed, and they are listed on the previous screen.`
							: 'No two names in this vault flatten to the same key. That is what a vault with one spelling per thing looks like.'}
					</p>
					<p>{clusters.fingerprint.sentence}</p>
				</EmptyState>
			</div>
		);
	}

	return (
		<div className="page">
			<PageHead
				title="Names that may be one thing"
				subtitle={`${clusters.counts.clusters.toLocaleString()} proposed · ${clusters.ranking.short}`}
				actions={<Button onClick={onDone}>Back</Button>}
			/>

			<StatStrip>
				<Stat value={clusters.counts.clusters.toLocaleString()} tone="warn">
					{clusters.counts.clusters === 1 ? 'name to decide about' : 'names to decide about'}
				</Stat>
				<Stat value={clusters.counts.facts.toLocaleString()}>
					facts are held apart by the spellings
				</Stat>
				<Stat value={clusters.counts.joining.toLocaleString()}>
					would join two parts nothing connects today
				</Stat>
				<StatNote>
					Tick the ones that really are one thing and choose the spelling to keep. Nothing is
					written until you have seen{' '}
					<strong>every memory that would change, and what each of its facts becomes.</strong>
				</StatNote>
			</StatStrip>

			{/*
			  THE RULE THAT PROPOSED THESE, in the same words the code used, and the admission that it
			  over-proposes. A reader who has not been told the rule cannot tell a bad cluster from a
			  bad explanation, and this one is deliberately loose: it is a nomination, not a verdict.
			*/}
			<Note>
				<strong>How these were found:</strong> {clusters.fingerprint.sentence}{' '}
				{clusters.fingerprint.caveat}
			</Note>

			<Table className="cluster-table" label="Names that may be one thing">
				<thead>
					<tr>
						<Th width="40px">
							<span className="sr-only">Merge</span>
						</Th>
						<Th>Spellings, and the one to keep</Th>
						<Th width="150px">Connected to</Th>
						<Th width="110px" numeric>
							In memories
						</Th>
						<Th width="120px">
							<span className="sr-only">Not the same</span>
						</Th>
					</tr>
				</thead>
				<tbody>
					{clusters.clusters.map((cluster) => (
						<ClusterRow
							key={cluster.key}
							cluster={cluster}
							checked={ticked.has(cluster.key)}
							survivor={survivors.get(cluster.key) ?? cluster.survivor}
							busy={busyKey === cluster.key}
							onToggle={() => toggle(cluster.key)}
							onSurvivor={(surface) =>
								setSurvivors((current) => new Map(current).set(cluster.key, surface))
							}
							onDismiss={() => onDismiss(cluster.finding, 'they really are two different things')}
						/>
					))}
				</tbody>
			</Table>

			<RunBar
				what={
					ticked.size === 0
						? 'Tick a name to see exactly what merging it would write.'
						: `${proposed.counts.clusters.toLocaleString()} ${
								proposed.counts.clusters === 1 ? 'name' : 'names'
							} · ${proposed.counts.steps.toLocaleString()} ${
								proposed.counts.steps === 1 ? 'rename' : 'renames'
							} · ${proposed.counts.memories.toLocaleString()} ${
								proposed.counts.memories === 1 ? 'memory' : 'memories'
							} would be written`
				}
			>
				{/*
				  THE ONLY FILLED CONTROL ON THE SCREEN, and it opens a preview rather than writing.
				  No gesture in this product both opens a preview and commits.
				*/}
				<Button
					tone="primary"
					disabled={ticked.size === 0 || proposed.counts.writing === 0}
					onClick={() => {
						setBatch(proposed);
						setResults([]);
						setResuming(false);
						setStage('preview');
					}}
				>
					Preview the merge
				</Button>
			</RunBar>
		</div>
	);
}

/**
 * One proposal: the spellings, which one survives, and what merging them would gain.
 *
 * THE DEGREE BAR IS THE ARGUMENT. Solid ticks are the facts the surviving spelling already has;
 * the warn-tinted ones are the facts it would gain. A reader looking at `4 + 2` can see the whole
 * case for merging without reading a sentence about it — which is why that mode exists on the
 * component at all.
 */
function ClusterRow({ cluster, checked, survivor, busy, onToggle, onSurvivor, onDismiss }) {
	const kept = cluster.spellings.find((entry) => entry.surface === survivor) ?? null;
	const gained = cluster.spellings
		.filter((entry) => entry.surface !== survivor)
		.reduce((total, entry) => total + entry.facts, 0);

	// Two spellings declared as different kinds is not visible from the two strings, and choosing
	// one spelling also decides the kind. So it is said on the row, before the tick.
	const kinds = [...new Set(cluster.spellings.flatMap((entry) => entry.kinds))];

	// TICKED IS `selected`, NOT `attention`. They are different tones for different claims: the
	// accent tint says "you chose this", the warn tint says "look at this". A row the reader ticked
	// is not a warning, and spending the warning tint on a choice would leave the app with no way
	// to say the other thing.
	return (
		<Tr selected={checked}>
			<Td>
				<Checkbox
					checked={checked}
					onCheckedChange={onToggle}
					label={`Merge ${cluster.spellings.map((entry) => entry.surface).join(' and ')}`}
				/>
			</Td>
			<Td subject>
				<div className="decision-body">
					<ChoiceRow
						// The cluster key, so two rows cannot become one radio group and clear each
						// other's choice.
						name={`survivor-${cluster.key}`}
						legend={`Which spelling of ${cluster.spellings[0]?.surface} survives?`}
						value={survivor}
						onChange={onSurvivor}
						options={cluster.spellings.map((entry) => ({
							value: entry.surface,
							label: entry.surface,
							note: `${entry.facts} ${entry.facts === 1 ? 'fact' : 'facts'}${
								entry.kinds.length > 0 ? ` · ${entry.kinds.join(', ')}` : ' · declared by nothing'
							}`,
						}))}
					/>
					<p className="meta">
						{cluster.rule === 'punctuation-and-case'
							? 'These differ only in punctuation or case.'
							: 'Same words, in a different order or with a joining word on one side.'}{' '}
						{cluster.joins
							? 'They sit in separate groups, so merging them joins two parts of your vault that nothing connects today.'
							: 'Both already sit in one connected group, so merging them relabels rather than reconnects.'}
						{kinds.length > 1
							? ' They are declared as different kinds of thing, so choosing a spelling also decides the kind.'
							: ''}
					</p>
				</div>
			</Td>
			<Td>
				<DegreeBar count={kept?.facts ?? 0} provisional={gained} />
			</Td>
			<Td numeric>{cluster.memories.length.toLocaleString()}</Td>
			<Td>
				{/*
				  THE OTHER TRUE ANSWER, and the commonest one. Without somewhere to put "these really
				  are two different things" the list is unusable on the second visit: the same twelve
				  proposals, in the same order, forever.
				*/}
				<Button size="sm" disabled={busy} onClick={onDismiss}>
					{busy ? 'Saving…' : 'Not the same'}
				</Button>
			</Td>
		</Tr>
	);
}

/**
 * THE PREVIEW. It names the memories; it never states only a count.
 *
 * The whole failure this panel exists to prevent is a reader authorising a rewrite of memories they
 * have not seen, and the list is what makes "these four" different from "four". The write is issued
 * from the button at the bottom of this panel and from nowhere earlier, so there is no path in this
 * product where a gesture both opens a preview and commits.
 */
function PreviewBatch({ batch, resuming, error, busy, onConfirm, onBack, onOpen, onEdit }) {
	const reversibility = reversibilityFor('unify-spelling');
	const steps = batch.steps.filter((step) => step.writes > 0);

	return (
		<div className="page">
			<PageHead
				title={resuming ? 'What is left to write' : 'What this merge will write'}
				subtitle={`${batch.counts.memories.toLocaleString()} ${
					batch.counts.memories === 1 ? 'memory' : 'memories'
				} · ${batch.counts.facts.toLocaleString()} ${
					batch.counts.facts === 1 ? 'change' : 'changes'
				} · ${batch.counts.declarations.toLocaleString()} of them declarations`}
				actions={<Button onClick={onBack}>Back to the list</Button>}
			/>

			{resuming ? (
				<Note tone="accent">
					This is a fresh reading of your vault, not a replay. The renames that finished are not
					in it, and the memories that were already rewritten are not either — they no longer
					write the old spelling, so nothing below names them.
				</Note>
			) : null}

			{batch.warnings.map((warning) => (
				<Note key={warning} tone="warn">
					{warning}
				</Note>
			))}

			{/*
			  A memory written by two steps of one batch. Named rather than counted: it is the reader's
			  only warning that a later step's preview describes a memory an earlier step will already
			  have changed — which is exactly why the run re-reads the vault before every step after
			  the first, and refuses to send one whose rewrite has moved.
			*/}
			{batch.crossed.length > 0 ? (
				<Note>
					{batch.crossed.length.toLocaleString()}{' '}
					{batch.crossed.length === 1 ? 'memory is' : 'memories are'} written by more than one of
					these renames:{' '}
					{batch.crossed.map((entry) => entry.title ?? entry.memory_id).join(', ')}. Each rename
					is a separate write, so this app re-reads the vault between them and stops rather than
					sending a rewrite that no longer matches what you are reading here.
				</Note>
			) : null}

			<DetailRows>
				{steps.map((step, index) => (
					<DetailRow
						key={`${step.from}${step.to}`}
						label={`“${step.from}” becomes “${step.to}”`}
						count={`${step.plan.counts.memories} ${
							step.plan.counts.memories === 1 ? 'memory' : 'memories'
						}`}
						defaultOpen={index === 0}
					>
						<Step step={step} onOpen={onOpen} onEdit={onEdit} />
					</DetailRow>
				))}
			</DetailRows>

			{/*
			  The reversibility of THIS action, in words, at the point of it. Not a global banner:
			  "this cannot be undone" repeated on every screen is dismissed on every screen, and then
			  the one that needed reading is not read.
			*/}
			<Note>
				<strong>Before you do this.</strong> {reversibility.confirmation} What can put it back:{' '}
				{reversibility.recovers.toLowerCase()}.
			</Note>

			{error ? <ErrorState heading="This run could not be started" error={error} /> : null}

			<RunBar
				what={`Each memory is written on its own, with a copy kept first. The run stops at the first refusal and tells you where it stopped.`}
			>
				<Button onClick={onBack} disabled={busy}>
					Cancel
				</Button>
				<Button tone="primary" onClick={onConfirm} disabled={busy}>
					{busy
						? 'Writing…'
						: `Rewrite ${batch.counts.memories} ${
								batch.counts.memories === 1 ? 'memory' : 'memories'
							}`}
				</Button>
			</RunBar>
		</div>
	);
}

/** One rename inside the batch: every memory it writes, and what each of its facts becomes. */
function Step({ step, onOpen, onEdit }) {
	return (
		<DecisionList label={`Memories that write “${step.from}”`}>
			{step.plan.memories.map((memory, index) => (
				<Decision
					key={memory.memory_id}
					lead={
						<>
							<span className="decision-stake">{index + 1}</span>
							<button type="button" className="btn btn-quiet" onClick={() => onOpen?.(memory.memory_id)}>
								{memory.title ?? memory.memory_id}
							</button>
							{memory.memory_type ? <Badge>{memory.memory_type}</Badge> : null}
						</>
					}
					stake={`${memory.changes.length} ${memory.changes.length === 1 ? 'change' : 'changes'}`}
					actions={
						<button type="button" className="btn btn-quiet" onClick={() => onEdit?.(memory.memory_id)}>
							Open it in the editor instead
						</button>
					}
				>
					<Rewrites>
						{memory.statements.map((statement, position) => (
							<Rewrite
								key={`${statement.before}-${position}`}
								before={statement.before}
								after={statement.after}
							/>
						))}
					</Rewrites>

					{memory.merged_declarations.map((merge) => (
						<Note key={merge.name} tone="warn">
							Both spellings are declared here. Keeping “{merge.kept.kind ?? 'no kind'}” and
							dropping the declaration that called it “{merge.dropped.kind ?? 'no kind'}”.
						</Note>
					))}
					{memory.collapsed_facts.map((collapsed) => (
						<Note key={collapsed.index} tone="warn">
							Two facts become the same fact: “{collapsed.statement}”. One is dropped.
						</Note>
					))}
					{memory.untouched_mentions.length > 0 ? (
						<Note>
							This memory also spells “{step.from}” in{' '}
							{memory.untouched_mentions.map((mention) => mention.where).join(', ')}. Those are
							sentences a person wrote and this run does not rewrite them.
						</Note>
					) : null}
				</Decision>
			))}
		</DecisionList>
	);
}

/**
 * THE RECEIPT, and on a stopped run it is a map of the boundary.
 *
 * Two levels, because a stopped batch has two of them. Across the renames: which finished, which
 * one stopped, which were never started. Inside the one that stopped: which memories were rewritten
 * and which were never reached. A report that gave only the first would leave a half-written rename
 * looking like a whole one, and "merged 7 names" over a run whose fourth was refused is a false
 * statement about somebody's own data that they have no other instrument to catch.
 */
function Receipt({ summary, running, onOpen, onResume, onAgain, onDone, busy }) {
	const resume = describeBatchResume(summary);

	return (
		<div className="page">
			<PageHead title={running ? 'Writing…' : summary.heading} subtitle={summary.sentence} />

			{summary.stopped_on ? (
				<Note tone="warn">
					<strong>
						Stopped at “{summary.stopped_on.from}” → “{summary.stopped_on.to}” —{' '}
						{summary.stopped_on.label}.
					</strong>{' '}
					{summary.stopped_on.said ?? summary.stopped_on.run?.stopped_on?.sentence ?? ''}{' '}
					{summary.stopped_on.run?.stopped_on?.said
						? `The engine said: ${summary.stopped_on.run.stopped_on.said}`
						: ''}{' '}
					Nothing after it was written to.
				</Note>
			) : null}

			<DecisionList label="What this run did">
				{summary.rows.map((row) => (
					<Decision
						key={`${row.from}${row.to}`}
						lead={
							<>
								<span>
									“{row.from}” → “{row.to}”
								</span>
								<Badge tone={row.tone === 'stop' ? 'warn' : row.tone === 'ok' ? 'accent' : 'neutral'}>
									{row.label}
								</Badge>
							</>
						}
						stake={
							row.run
								? `${row.run.rewritten.length} of ${
										row.run.rewritten.length + row.run.not_attempted.length
									} written`
								: null
						}
					>
						{row.said ? <Note tone="warn">{row.said}</Note> : null}
						{row.run ? (
							<>
								<Sources>
									{row.run.rewritten.map((item) => (
										<Source
											key={item.memory_id}
											note={`${item.facts_rewritten} ${item.facts_rewritten === 1 ? 'change' : 'changes'}`}
										>
											<button
												type="button"
												className="btn btn-quiet"
												onClick={() => onOpen?.(item.memory_id)}
											>
												{item.title ?? item.memory_id}
											</button>
										</Source>
									))}
								</Sources>
								{row.run.not_attempted.length > 0 ? (
									<Note>
										{row.run.not_attempted.length.toLocaleString()} never attempted:{' '}
										{row.run.not_attempted
											.map((item) => item.title ?? item.memory_id)
											.join(', ')}
										.
									</Note>
								) : null}
							</>
						) : null}
					</Decision>
				))}
			</DecisionList>

			<DetailRows>
				<Copies snapshots={summary.snapshots} />
			</DetailRows>

			{running ? null : (
				<RunBar
					what={
						resume
							? resume.sentence
							: 'The names are recounted from the vault as it is now, so the next pass is over what you just changed.'
					}
				>
					{resume ? (
						<Button tone="primary" disabled={busy} onClick={onResume}>
							{busy ? 'Reading…' : `Pick up where it stopped — ${resume.steps_left} left`}
						</Button>
					) : null}
					<Button tone={resume ? 'default' : 'primary'} onClick={onAgain}>
						Look at the names again
					</Button>
					<Button onClick={onDone}>Back to what needs a decision</Button>
				</RunBar>
			)}
		</div>
	);
}

/**
 * EVERY COPY THE RUN TOOK, LISTED, AND EACH ONE ACTUALLY REACHABLE.
 *
 * The point of saying a copy was kept is that a person can go and look at one; a count would be a
 * promise instead of a receipt. This was once an `<a href>` at the copy's own API path — and every
 * route under `/api/` is token-gated, so that navigation carried no Authorization header and
 * answered a bare 401. It read as wired and was not.
 *
 * So the bytes are fetched through the same door everything else uses and handed over as a file.
 * The payload is a STRING from the sidecar to the `Blob`: the engine signs its own serialisation
 * and the import door checks that digest, so a copy this app parsed and re-emitted would be refused
 * at exactly the moment somebody finally needed it.
 */
function Copies({ snapshots }) {
	const [busy, setBusy] = useState(null);
	const [failed, setFailed] = useState(null);

	if (!snapshots || snapshots.length === 0) return null;

	const save = async (snapshot) => {
		setBusy(snapshot.snapshot_id);
		setFailed(null);
		try {
			const body = await fetchSnapshot(snapshot.snapshot_id);
			const text = body?.snapshot?.export_json ?? null;
			if (typeof text !== 'string') {
				throw new Error('This copy carries no export payload, so there is no file to save.');
			}
			const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = `${snapshot.snapshot_id}.export.json`;
			link.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			setFailed({ id: snapshot.snapshot_id, message: cause?.message ?? String(cause) });
		} finally {
			setBusy(null);
		}
	};

	return (
		<DetailRow
			label="Copies kept, one before each write"
			count={snapshots.length.toLocaleString()}
		>
			<Sources>
				{snapshots.map((snapshot) => (
					<Source
						key={snapshot.snapshot_id}
						note={`${snapshot.operation} of ${snapshot.memory_id ?? 'a new memory'} · ${snapshot.payload_bytes.toLocaleString()} bytes`}
					>
						<code className="identifier">{snapshot.snapshot_id}</code>
						{snapshot.payload_bytes > 0 ? (
							<button
								type="button"
								className="btn btn-quiet"
								disabled={busy === snapshot.snapshot_id}
								onClick={() => save(snapshot)}
							>
								{busy === snapshot.snapshot_id ? 'reading…' : 'save it to a file'}
							</button>
						) : (
							<span className="decision-source-note">
								{snapshot.suppressed_reason
									? `no bytes were kept — ${snapshot.suppressed_reason}`
									: 'no bytes were kept'}
							</span>
						)}
					</Source>
				))}
			</Sources>
			{failed ? (
				<Note tone="warn">
					{failed.id} could not be read: {failed.message}
				</Note>
			) : null}
			<Note>
				These are copies. Putting one back is not something the engine can do — a copy can be
				read and saved, and nothing returns it to the vault it came from.
			</Note>
		</DetailRow>
	);
}
