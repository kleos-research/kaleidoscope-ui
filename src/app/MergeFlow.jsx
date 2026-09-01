import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchEditRecord, fetchSnapshot, runMerge, runRename } from './api.mjs';
import {
	describeResume,
	MERGE_STEPS,
	NO_RANKING_FIELD,
	planMemoryMerge,
	planRename,
	PROMOTE_INTENTS,
	renameRequest,
	REVERSIBILITY,
	reversibilityFor,
	ROLLBACK_IS_NOT_OFFERED,
	summariseRenameRun,
} from './merge-model.mjs';
import { Chip, EmptyState, ErrorState, LoadingState } from './ui.jsx';

/**
 * THE CURATION SURFACE, and the one thing every screen in it shares.
 *
 * PREVIEW → RUN → RECEIPT, in that order, with the write issued from the preview's own button. No
 * gesture in this product both opens a preview and commits: the button that starts a run is inside
 * the panel that lists what the run will write, by name, so there is no path where a user authorises
 * a count.
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

/**
 * The whole run for a near-duplicate pair: pick the survivor, look at what will change, do it.
 *
 * @param {object} props
 * @param {Array} props.records    the export listing this browser already holds
 * @param {Array<string>} props.spellings  the surfaces the backlog nominated, longest-standing first
 * @param {object} props.evidence  per spelling, what the backlog knows: facts, memories, kinds
 */
export function UnifySpelling({ records, spellings, evidence = [], onDone, onOpen, onEdit }) {
	const [survivor, setSurvivor] = useState(spellings[0] ?? '');
	const [stage, setStage] = useState('choose');
	const [report, setReport] = useState(null);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);

	const losing = spellings.filter((spelling) => spelling !== survivor);

	// The preview, recomputed from the listing whenever the choice changes. It is arithmetic over a
	// payload already in memory, so it costs no engine call and cannot go stale between renders.
	const plan = useMemo(
		() => (losing.length === 1 ? planRename(records, { from: losing[0], to: survivor }) : null),
		[records, losing.join(''), survivor],
	);

	const run = useCallback(
		async (request) => {
			setBusy(true);
			setError(null);
			try {
				const body = await runRename(request);
				setReport(body);
				setStage('receipt');
			} catch (cause) {
				setError(cause);
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	if (stage === 'receipt' && report) {
		return <RenameReceipt report={report} onDone={onDone} onOpen={onOpen} onResume={run} busy={busy} />;
	}

	return (
		<section className="curation">
			<header className="curation-head">
				<h2>Unify a spelling</h2>
				<p className="curation-lede">
					Two spellings are two separate things to the store — identity is character-exact — so an
					agent that reaches one of them never sees the other one’s facts. This rewrites the losing
					spelling in every memory that uses it: its facts and its declaration together, one memory
					at a time.
				</p>
			</header>

			{/*
			  THE CHOICE COMES FIRST, and it is a choice about a kind as well as a spelling. The pairs
			  in this vault routinely disagree about what the name IS — a tool on one side and a
			  service on the other — so the evidence per spelling is on the radio, not in a tooltip.
			*/}
			<fieldset className="curation-choice">
				<legend>Which spelling survives?</legend>
				{spellings.map((spelling) => {
					const found = evidence.find((entry) => entry.surface === spelling) ?? null;
					return (
						<label key={spelling} className="curation-option">
							<input
								type="radio"
								name="survivor"
								value={spelling}
								checked={survivor === spelling}
								onChange={() => {
									setSurvivor(spelling);
									setStage('choose');
								}}
							/>
							<span className="curation-option-name">{spelling}</span>
							{found ? (
								<span className="curation-option-evidence">
									{found.facts} {found.facts === 1 ? 'fact' : 'facts'}
									{found.kinds?.length ? ` · declared ${found.kinds.join(', ')}` : ' · declared by nothing'}
								</span>
							) : null}
						</label>
					);
				})}
			</fieldset>

			{losing.length !== 1 ? (
				<p className="curation-note">
					This run rewrites one spelling into another. Pick the survivor from a pair.
				</p>
			) : plan.blockers.length > 0 ? (
				<EmptyState heading="There is nothing to write">
					{plan.blockers.map((blocker) => (
						<p key={blocker}>{blocker}</p>
					))}
				</EmptyState>
			) : (
				<Preview
					plan={plan}
					busy={busy}
					error={error}
					onOpen={onOpen}
					onEdit={onEdit}
					onCancel={onDone}
					onConfirm={() => run(renameRequest(plan))}
				/>
			)}
		</section>
	);
}

/**
 * THE PREVIEW. It names the memories; it never states only a count.
 *
 * A count is a number a person cannot check. The whole failure this panel exists to prevent is a
 * user authorising a rewrite of memories they have not seen — and the list is what makes "these
 * four" different from "four".
 */
function Preview({ plan, busy, error, onConfirm, onCancel, onOpen, onEdit }) {
	const reversibility = reversibilityFor('unify-spelling');

	return (
		<div className="curation-preview">
			<h3>
				{plan.counts.memories} {plan.counts.memories === 1 ? 'memory' : 'memories'} will be written
			</h3>
			<p className="curation-lede">
				“{plan.from}” becomes “{plan.to}” in {plan.counts.facts}{' '}
				{plan.counts.facts === 1 ? 'place' : 'places'}, including {plan.counts.declarations}{' '}
				{plan.counts.declarations === 1 ? 'declaration' : 'declarations'}. Nothing is written until you
				press the button at the bottom of this panel.
			</p>

			{plan.warnings.map((warning) => (
				<p key={warning} className="curation-warning">
					{warning}
				</p>
			))}

			<ol className="curation-plan">
				{plan.memories.map((memory, index) => (
					<li key={memory.memory_id} className="curation-plan-row">
						<div className="curation-plan-head">
							<span className="curation-plan-order">{index + 1}</span>
							<button type="button" className="linklike" onClick={() => onOpen?.(memory.memory_id)}>
								{memory.title ?? memory.memory_id}
							</button>
							{memory.memory_type ? <Chip>{memory.memory_type}</Chip> : null}
							<button type="button" className="linklike" onClick={() => onEdit?.(memory.memory_id)}>
								open in the editor
							</button>
						</div>

						{/* What each fact becomes, before and after, rather than "3 facts change". */}
						<ul className="curation-statements">
							{memory.statements.map((statement, position) => (
								<li key={`${statement.before}-${position}`}>
									<span className="curation-before">{statement.before}</span>
									<span className="curation-arrow" aria-hidden="true">
										→
									</span>
									<span className="curation-after">{statement.after}</span>
								</li>
							))}
						</ul>

						{memory.merged_declarations.map((merge) => (
							<p key={merge.name} className="curation-warning">
								Both spellings are declared here. Keeping “{merge.kept.kind ?? 'no kind'}” and
								dropping the declaration that called it “{merge.dropped.kind ?? 'no kind'}”.
							</p>
						))}
						{memory.collapsed_facts.map((collapsed) => (
							<p key={collapsed.index} className="curation-warning">
								Two facts become the same fact: “{collapsed.statement}”. One is dropped.
							</p>
						))}
						{memory.untouched_mentions.length > 0 ? (
							<p className="curation-note">
								Also spells “{plan.from}” in {memory.untouched_mentions.map((mention) => mention.where).join(', ')}
								. This run does not rewrite those — they are sentences a person wrote.
							</p>
						) : null}
					</li>
				))}
			</ol>

			{/*
			  The reversibility of THIS action, in the dialog, in words. Not a global banner: "this
			  cannot be undone" repeated on every screen is dismissed on every screen, and then the one
			  that needed reading is not read.
			*/}
			<p className="curation-reversibility">
				<strong>Before you do this.</strong> {reversibility.confirmation} What can put it back:{' '}
				{reversibility.recovers.toLowerCase()}.
			</p>

			{error ? <ErrorState heading="This run could not be started" error={error} /> : null}

			<div className="curation-actions">
				<button type="button" className="button" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
				{/*
				  THE WRITE IS ISSUED FROM HERE and nowhere earlier. The gesture that opened this panel
				  wrote nothing, which is what makes the panel a preview rather than a delay.
				*/}
				<button type="button" className="button button-primary" onClick={onConfirm} disabled={busy}>
					{busy
						? 'Writing…'
						: `Rewrite ${plan.counts.memories} ${plan.counts.memories === 1 ? 'memory' : 'memories'}`}
				</button>
			</div>
		</div>
	);
}

/**
 * THE RECEIPT, and on a stopped run it is a map of the boundary.
 *
 * Three lists, never one line: what was rewritten, what refused and in the engine's own words why,
 * and what was never attempted. "Renamed 7 memories" over a run where the fourth was refused is a
 * false statement about the user's own data and they have no other instrument to catch it with.
 */
function RenameReceipt({ report, onDone, onOpen, onResume, busy }) {
	const summary = useMemo(() => summariseRenameRun(report), [report]);
	const resume = describeResume(summary);

	return (
		<section className="curation">
			<header className="curation-head">
				<h2>{summary.heading}</h2>
				<p className="curation-lede">{summary.sentence}</p>
			</header>

			{summary.stopped_on ? (
				<div className="curation-stop">
					<h3>
						Stopped at “{summary.stopped_on.title ?? summary.stopped_on.memory_id}” — {summary.stopped_on.label}
					</h3>
					<p>{summary.stopped_on.sentence}</p>
					{/* The engine's own sentence, whole, beside this app's classification of it. */}
					{summary.stopped_on.said ? <p className="curation-said">The engine said: {summary.stopped_on.said}</p> : null}
					<button type="button" className="linklike" onClick={() => onOpen?.(summary.stopped_on.memory_id)}>
						Open it
					</button>
				</div>
			) : null}

			<RowList heading="Rewritten" tone="ok" rows={summary.rewritten} onOpen={onOpen} />
			<RowList heading="Already using the surviving spelling" tone="idle" rows={summary.untouched} onOpen={onOpen} />
			<RowList heading="Never attempted" tone="idle" rows={summary.not_attempted} onOpen={onOpen} />

			{/*
			  EVERY COPY, LISTED. The point of saying a copy was kept is that a person can go and look
			  at one; a count would be a promise instead of a receipt.
			*/}
			<SnapshotList snapshots={summary.snapshots} />

			<div className="curation-actions">
				{resume ? (
					<button
						type="button"
						className="button button-primary"
						disabled={busy}
						onClick={() => onResume(resume.request)}
					>
						{busy ? 'Writing…' : `Resume — ${resume.count} left`}
					</button>
				) : null}
				<button type="button" className="button" onClick={onDone}>
					Done
				</button>
			</div>
			{resume ? <p className="curation-note">{resume.sentence}</p> : null}
		</section>
	);
}

/**
 * EVERY COPY, LISTED, AND EACH ONE ACTUALLY REACHABLE.
 *
 * The point of saying a copy was kept is that a person can go and look at one; a count would be a
 * promise instead of a receipt. This was an `<a href>` at the receipt's own `href` — and every route
 * under `/api/` is token-gated, so that navigation carried no Authorization header and answered a
 * bare 401. The offer read as wired and was not, which is the same failure the rest of this product
 * spends its comments refusing.
 *
 * So the bytes are fetched through the same door everything else uses, and handed to the user as a
 * file. The payload is a STRING from the sidecar to the `Blob` — the engine signs its own
 * serialisation and the import door checks that digest, so a copy this app parsed and re-emitted
 * would be refused at exactly the moment somebody finally needed it.
 */
function SnapshotList({ snapshots }) {
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
		<details className="curation-snapshots">
			<summary>
				{snapshots.length} {snapshots.length === 1 ? 'copy was' : 'copies were'} kept, one before
				each write
			</summary>
			<ul>
				{snapshots.map((snapshot) => (
					<li key={snapshot.snapshot_id}>
						<code className="identifier">{snapshot.snapshot_id}</code> — {snapshot.operation} of{' '}
						{snapshot.memory_id ?? 'a new memory'} at version {snapshot.version_id ?? '—'},{' '}
						{snapshot.payload_bytes.toLocaleString()} bytes
						{snapshot.payload_bytes > 0 ? (
							<button
								type="button"
								className="linklike"
								disabled={busy === snapshot.snapshot_id}
								onClick={() => save(snapshot)}
							>
								{busy === snapshot.snapshot_id ? 'reading…' : 'save it to a file'}
							</button>
						) : (
							<span className="curation-said">
								{snapshot.suppressed_reason
									? `no bytes were kept — ${snapshot.suppressed_reason}`
									: 'no bytes were kept'}
							</span>
						)}
					</li>
				))}
			</ul>
			{failed ? (
				<p className="curation-warning">
					{failed.id} could not be read: {failed.message}
				</p>
			) : null}
			<p className="curation-note">
				These are copies. Putting one back is not something the engine can do — a copy can be read
				and saved, and nothing returns it to the vault it came from.
			</p>
		</details>
	);
}

function RowList({ heading, tone, rows, onOpen }) {
	if (rows.length === 0) return null;
	return (
		<div className={`curation-rows curation-rows-${tone}`}>
			<h3>
				{heading} ({rows.length})
			</h3>
			<ul>
				{rows.map((row) => (
					<li key={row.memory_id}>
						<button type="button" className="linklike" onClick={() => onOpen?.(row.memory_id)}>
							{row.title ?? row.memory_id}
						</button>
						{row.facts_rewritten > 0 ? (
							<span className="curation-count">
								{row.facts_rewritten} {row.facts_rewritten === 1 ? 'change' : 'changes'}
							</span>
						) : null}
						{row.said ? <span className="curation-said">{row.said}</span> : null}
					</li>
				))}
			</ul>
		</div>
	);
}

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

	return (
		<section className="curation">
			<header className="curation-head">
				<h2>Merge two memories</h2>
				<p className="curation-lede">
					The composition below is a starting point, not a proposal. Edit the note, drop any fact you
					do not want, and nothing is written until you press the button at the bottom.
				</p>
			</header>

			{plan.declaration_regime_change ? (
				<div className="curation-stop">
					<h3>{plan.declaration_regime_change.heading}</h3>
					<p>{plan.declaration_regime_change.sentence}</p>
				</div>
			) : null}

			<div className="curation-compose">
				<label htmlFor="merge-body">The note the survivor will carry</label>
				<textarea id="merge-body" value={body} rows={14} onChange={(event) => setBody(event.target.value)} />
			</div>

			<h3>
				{composed.facts.length} facts — {plan.counts.from_survivor} from the survivor,{' '}
				{plan.counts.from_duplicate} from the duplicate, {plan.counts.shared} written in both
			</h3>
			<ul className="curation-facts">
				{(plan.semantic_delta.facts ?? []).map((fact, index) => (
					<li key={`${fact.subject}-${fact.predicate}-${fact.object}-${index}`}>
						<label>
							<input
								type="checkbox"
								checked={!dropped.has(index)}
								onChange={() => {
									const next = new Set(dropped);
									if (next.has(index)) next.delete(index);
									else next.add(index);
									setDropped(next);
								}}
							/>
							<span>
								{fact.subject} {fact.predicate} {fact.object}
							</span>
							<Chip tone="neutral">{plan.provenance[index]?.source ?? 'survivor'}</Chip>
						</label>
					</li>
				))}
			</ul>

			<h3>{(plan.semantic_delta.entities ?? []).length} named things, from both memories</h3>
			<p className="curation-note">
				Both memories’ declarations travel with the facts, in one payload. A merge that folded in the
				facts and forgot the declarations would commit with those facts dropped from the stored
				record and nothing in the response saying so.
			</p>
			{plan.declaration_conflicts.map((conflict) => (
				<p key={conflict.name} className="curation-warning">
					Both declare “{conflict.name}” and they disagree. Keeping the survivor’s: “
					{conflict.kept.kind ?? 'no kind'}”.
				</p>
			))}

			{/* THE ORDER, on the screen, with the reason each write is where it is. */}
			<ol className="curation-order">
				{MERGE_STEPS.map((step) => (
					<li key={step.step}>
						<strong>{step.label}.</strong> {step.why}
					</li>
				))}
			</ol>

			<p className="curation-reversibility">
				<strong>Before you do this.</strong> {reversibility.confirmation} What can put it back:{' '}
				{reversibility.recovers.toLowerCase()}.
			</p>

			{error ? <ErrorState heading="This merge could not be started" error={error} /> : null}

			<div className="curation-actions">
				<button type="button" className="button" onClick={onDone} disabled={busy}>
					Cancel
				</button>
				<button
					type="button"
					className="button button-primary"
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
				</button>
			</div>
		</section>
	);
}

function MergeReceipt({ report, onDone, onOpen }) {
	return (
		<section className="curation">
			<header className="curation-head">
				<h2>{report.complete ? 'Merged.' : report.half_finished?.heading ?? 'The merge did not finish'}</h2>
				{report.half_finished ? <p className="curation-lede">{report.half_finished.sentence}</p> : null}
				{!report.complete && report.both_memories_intact ? (
					<p className="curation-lede">
						Nothing was written. Both memories are exactly as they were — which is why the memory that
						survives is written first.
					</p>
				) : null}
			</header>

			<ol className="curation-order">
				{report.steps.map((step) => (
					<li key={step.step}>
						<strong>{step.step === 'update-survivor' ? 'Wrote the survivor' : 'Removed the duplicate'}</strong>{' '}
						— {step.state}
						{step.message ? <span className="curation-said"> {step.message}</span> : null}
					</li>
				))}
			</ol>

			<div className="curation-actions">
				<button type="button" className="button" onClick={() => onOpen?.(report.survivor_id)}>
					Open the survivor
				</button>
				<button type="button" className="button" onClick={onDone}>
					Done
				</button>
			</div>
		</section>
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
			<EmptyState
				heading="That memory is not in what was loaded"
				action={
					<button type="button" className="button" onClick={onDone}>
						Back
					</button>
				}
			>
				<p>A merge is composed from two records this app has read, and one of them is missing.</p>
			</EmptyState>
		);
	}

	if (partner) {
		const survivorId = survivorIsThis ? memoryId : partner.memory_id;
		const duplicateId = survivorIsThis ? partner.memory_id : memoryId;
		return (
			<>
				{/* Held to the same measure as the panel below it: a context line pinned to the window's
				    left edge above a centred column reads as two screens rather than one. */}
				<p className="curation-note curation-context">
					Merging <strong>{here.title ?? here.memory_id}</strong> and{' '}
					<strong>{partner.title ?? partner.memory_id}</strong>.{' '}
					<button type="button" className="linklike" onClick={() => setPartnerId(null)}>
						pick a different memory
					</button>
				</p>
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
		<section className="curation">
			<header className="curation-head">
				<h2>Merge this memory into another</h2>
				<p className="curation-lede">
					Two memories become one: this app writes the memory that survives, then removes the
					other. Nothing on this screen is written, and nothing here nominates a pair — this app
					has no way to tell that two memories say the same thing, so you name the other one.
				</p>
			</header>

			<p className="curation-note">
				From <strong>{here.title ?? here.memory_id}</strong> ·{' '}
				{here.fact_count.toLocaleString()} {here.fact_count === 1 ? 'fact' : 'facts'}
			</p>

			<fieldset className="curation-choice">
				<legend>Which one survives?</legend>
				<label className="curation-option">
					<input
						type="radio"
						name="survivor-side"
						checked={survivorIsThis}
						onChange={() => setSurvivorIsThis(true)}
					/>
					<span className="curation-option-name">This memory survives</span>
					<span className="curation-option-evidence">
						the other one is removed once the survivor is written
					</span>
				</label>
				<label className="curation-option">
					<input
						type="radio"
						name="survivor-side"
						checked={!survivorIsThis}
						onChange={() => setSurvivorIsThis(false)}
					/>
					<span className="curation-option-name">The one I pick survives</span>
					<span className="curation-option-evidence">this memory is the one removed</span>
				</label>
			</fieldset>

			<div className="curation-compose">
				<label htmlFor="merge-find">Find the other memory</label>
				<input
					id="merge-find"
					type="text"
					value={query}
					autoComplete="off"
					placeholder="part of its title"
					onChange={(event) => setQuery(event.target.value)}
				/>
				<p className="curation-note">
					This finds the words you type in what is already loaded. It does not rank and it asks the
					engine nothing.
				</p>
			</div>

			<ol className="curation-plan">
				{candidates.map((row) => (
					<li key={row.memory_id} className="curation-plan-row">
						<div className="curation-plan-head">
							<button
								type="button"
								className="linklike"
								onClick={() => setPartnerId(row.memory_id)}
							>
								{row.title ?? row.memory_id}
							</button>
							{row.memory_type ? <Chip>{row.memory_type}</Chip> : null}
							<span className="curation-count">
								{row.fact_count.toLocaleString()} {row.fact_count === 1 ? 'fact' : 'facts'}
							</span>
							<button type="button" className="linklike" onClick={() => onOpen?.(row.memory_id)}>
								read it first
							</button>
						</div>
					</li>
				))}
			</ol>
			{candidates.length === 0 ? (
				<p className="curation-note">No memory in what was loaded matches “{query}”.</p>
			) : null}

			<div className="curation-actions">
				<button type="button" className="button" onClick={onDone}>
					Cancel
				</button>
			</div>
		</section>
	);
}

/**
 * The persistent banner for a merge that stopped between its two writes.
 *
 * Rebuilt at launch from a record on disk, not from anything in this tab, because the state has to
 * survive a crash rather than only an exception. It offers exactly two actions and each says what it
 * will do; there is no third, because there is no operation to route one to.
 */
export function HalfFinishedMerge({ pending, busy, onFinish, onUndo }) {
	if (!pending) return null;
	const undo = reversibilityFor('undo-half-finished-merge');
	return (
		<div className="curation-banner" role="status">
			<strong>Half-finished merge.</strong>{' '}
			<span>
				“{pending.survivor_title ?? pending.survivor_id}” holds both memories’ content, and “
				{pending.duplicate_title ?? pending.duplicate_id}” is still here. A merge is complete only when
				both writes have committed, and only one of them has.
			</span>
			<div className="curation-actions">
				<button type="button" className="button button-primary" onClick={onFinish} disabled={busy}>
					Finish the merge — remove the duplicate
				</button>
				<button type="button" className="button" onClick={onUndo} disabled={busy}>
					Undo — write the survivor back
				</button>
			</div>
			<p className="curation-note">{undo.confirmation}</p>
		</div>
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
		<section className="curation">
			<h2>What can be undone</h2>
			<p className="curation-lede">
				Nothing in this list is undone by the engine. A copy is taken before every write and it can be
				read and saved to a file; putting one back into the vault it came from is not something the
				engine can do.
			</p>
			<table className="curation-table">
				<thead>
					<tr>
						<th scope="col">Action</th>
						<th scope="col">Undo?</th>
						<th scope="col">What recovers it</th>
					</tr>
				</thead>
				<tbody>
					{REVERSIBILITY.map((row) => (
						<tr key={row.id}>
							<th scope="row">{row.operation}</th>
							<td>{row.reversible ? 'Yes' : 'No'}</td>
							<td>{row.recovers}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="curation-note">{ROLLBACK_IS_NOT_OFFERED}</p>
		</section>
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
		<section className="curation">
			<h2>Make this memory count for more</h2>
			{/*
			  THE NEGATIVE HALF IS FIRST, and it is a requirement rather than a caveat. No affordance
			  in this product may imply a ranking the store does not have.
			*/}
			<p className="curation-lede">{NO_RANKING_FIELD}</p>

			<ul className="curation-intents">
				{real.map((intent) => (
					<li key={intent.id}>
						<button type="button" className="linklike" onClick={() => onEdit?.(memoryId)}>
							{intent.label}
						</button>
						<span className="curation-field">changes {intent.field}</span>
						<p>{intent.what}</p>
						<p className="curation-note">You do this in {intent.where}.</p>
					</li>
				))}
			</ul>

			<h3>What this cannot mean here</h3>
			<ul className="curation-intents curation-intents-absent">
				{unreal.map((intent) => (
					<li key={intent.id}>
						<span className="curation-absent">{intent.label}</span>
						<p>{intent.what}</p>
					</li>
				))}
			</ul>
		</section>
	);
}
