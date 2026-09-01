/**
 * THE CLUSTER REVIEW, as arithmetic. No React, no fetching, no engine call.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE HIGHEST-LEVERAGE THING ON THE CURATION SCREEN
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Names in this store join on EXACT CHARACTER IDENTITY and nothing else. There is no stemmer, no
 * alias table and no fuzzy match anywhere under a fact — `the retry budget` and `retry budget` are
 * two things, permanently, and each of them looks complete from where it is standing. Roughly three
 * names in four appear in exactly one fact, which means the vault is very likely MORE CONNECTED
 * than any screen can currently show. Every pair merged here turns two loose ends into one
 * junction. It is the only thing in this product that improves the data rather than the picture.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE MODEL IS OPENREFINE'S, DELIBERATELY
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A fingerprint pass proposes clusters; the reader ticks the ones that are really one thing and
 * picks the surviving spelling; the merge runs and the clustering is recomputed immediately, so the
 * next pass is over what the vault holds now rather than over what it held when the page loaded.
 * That last step is not a nicety — a review screen that keeps showing pre-merge clusters is a
 * screen that invites the same merge twice, and the second one writes every memory again to change
 * nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE FINGERPRINT IS NOT A SECOND ONE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It is `normaliseWords` from `graph-model.mjs` — lowercase, strip punctuation, drop articles and
 * the other function words, fold a trailing plural, sort the tokens — which is the key the
 * near-duplicate FINDING already uses. Writing a second one here would let the count on the
 * curation screen and the clusters on the review screen disagree about the same vault, and the
 * reader would have no way to tell which was right.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A BATCH IS SIMULATED BEFORE IT IS PREVIEWED
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A cluster of three spellings is two renames, and one memory can be written by both of them. If
 * the second rename were planned against the listing the browser loaded, its preview would describe
 * facts that the first rename has already changed — a preview that is wrong in exactly the case the
 * reader cannot check. So `planClusterBatch` applies each step's rewrite to an in-memory copy of
 * the records before planning the next one. The preview is then true about CONTENT, and the run
 * re-reads the vault to get the versions right (see `refreshStep`).
 */

import { normaliseWords } from './graph-model.mjs';
import { planRename, renameRequest, summariseRenameRun } from './merge-model.mjs';
import { renameInDelta } from '../shared/rename.mjs';

/**
 * The fingerprint, and the sentence the screen prints about it.
 *
 * Both live here so the rule the reader is shown is the rule the clustering used. A key described
 * in JSX and computed in a module drifts the first time either is touched, and a reader who has
 * been told the wrong rule cannot tell a bad cluster from a bad explanation.
 */
export const FINGERPRINT = Object.freeze({
	id: 'fingerprint',
	of: normaliseWords,
	sentence:
		'Two names are proposed as one when they survive the same flattening: lowercased, stripped ' +
		'of punctuation, with “the”, “a” and the other joining words dropped, a trailing plural ' +
		'folded, and the remaining words sorted. That catches an article, a hyphen, a capital and a ' +
		'reversed word order — and it proposes only. Nothing here decides that two names are one.',
	caveat:
		'It over-proposes on purpose. “read” and “reads” flatten together and may be two genuinely ' +
		'different things, which is why every cluster is a question rather than a queue.',
});

/**
 * THE ORDER, and the sentence the screen prints about it.
 *
 * The same rule the curation screen sorts findings by, for the same reason: what is at stake is the
 * facts a cluster splits, and then the memories that would have to be written to unsplit them.
 * Names last, and the key after that, which makes the order TOTAL — the same vault clusters into
 * the same list twice, whatever order the export arrived in.
 */
export const CLUSTER_RANKING = Object.freeze({
	sentence:
		'Ordered by how much is at stake: the facts the split spellings hold between them first, ' +
		'then the memories a merge would write. Ties break on the names, so this order is the same ' +
		'every time you open it.',
	short: 'facts at stake, then memories to write',
});

const text = (value) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

// =============================================================================================
// The clusters
// =============================================================================================

/**
 * The clusters, built from the near-duplicate findings the curation screen already computed.
 *
 * NOT FROM A SECOND PASS OVER THE GRAPH. Taking them from the backlog is what makes a dismissal
 * mean the same thing on both screens: the key a cluster carries here is the key the dismissal
 * store holds, so "these two really are different things" answered on either screen is answered on
 * both. A separate detector would have its own keys and the two screens would quietly disagree
 * about how much is left to do.
 *
 * @param {object} backlog  the model from `buildBacklog`
 * @param {object} [options]
 * @param {Map<string,string>} [options.survivors]  key → the surface the reader chose to keep
 */
export function buildClusters(backlog, { survivors = new Map() } = {}) {
	const group = backlog?.groups?.find((entry) => entry.kind.id === 'near-duplicate') ?? null;
	const findings = group?.findings ?? [];

	const clusters = findings.map((finding) => {
		const spellings = (finding.detail?.spellings ?? []).map((spelling) => ({
			surface: spelling.surface,
			facts: spelling.facts ?? 0,
			kinds: spelling.kinds ?? [],
			declared: spelling.declared ?? false,
		}));

		/*
		 * THE DEFAULT SURVIVOR IS THE ONE WITH THE MOST FACTS, and that is a considered default
		 * rather than the first thing in the array. Keeping the busier spelling means the smaller
		 * rewrite: fewer memories written, fewer copies taken, fewer chances for the run to stop
		 * partway. `detail.spellings` is already sorted facts-descending then alphabetically by the
		 * detector, so the head of it is that spelling and the choice is stable.
		 *
		 * It is a DEFAULT and it is always overridable, because the busier spelling is not always
		 * the better one — a typo can out-number the name it is a typo of.
		 */
		const fallback = spellings[0]?.surface ?? null;
		const chosen = survivors.get(finding.key) ?? null;
		const survivor = spellings.some((entry) => entry.surface === chosen) ? chosen : fallback;

		return {
			key: finding.key,
			rule: finding.detail?.rule ?? null,
			// Whether merging RELABELS one group or JOINS two. Materially different acts: joining two
			// components is the case the whole feature exists for, and it is worth saying which one
			// the reader is looking at before they tick it.
			joins: finding.detail?.same_component === false,
			spellings,
			survivor,
			losing: spellings.map((entry) => entry.surface).filter((surface) => surface !== survivor),
			// What a merge would ADD to the surviving name's degree, which is what `DegreeBar` draws
			// in the warn tint. The argument for merging is then visible in the bar rather than in a
			// sentence beside it.
			provisional: spellings
				.filter((entry) => entry.surface !== survivor)
				.reduce((total, entry) => total + entry.facts, 0),
			kept: spellings.find((entry) => entry.surface === survivor) ?? null,
			// The kinds this cluster disagrees about, if it does. Choosing a spelling is also
			// choosing a kind, and that is not visible from the two strings.
			kinds: [...new Set(spellings.flatMap((entry) => entry.kinds))],
			memories: finding.memories ?? [],
			stake: finding.stake,
			finding,
		};
	});

	return {
		fingerprint: FINGERPRINT,
		ranking: CLUSTER_RANKING,
		clusters,
		// Kept beside the live list so the review screen can say how many clusters the reader has
		// already answered without going back to the backlog for it.
		dismissed: group?.dismissed ?? [],
		counts: {
			clusters: clusters.length,
			dismissed: group?.dismissed?.length ?? 0,
			names: clusters.reduce((total, cluster) => total + cluster.spellings.length, 0),
			facts: clusters.reduce((total, cluster) => total + cluster.stake.facts, 0),
			memories: new Set(
				clusters.flatMap((cluster) => cluster.memories.map((memory) => memory.memory_id)),
			).size,
			// The clusters where merging joins two parts of the vault that nothing currently
			// connects. This is the number that says whether curation would change the SHAPE of the
			// graph or only its labels.
			joining: clusters.filter((cluster) => cluster.joins).length,
		},
	};
}

// =============================================================================================
// The batch
// =============================================================================================

/**
 * Apply one rename to a copy of the listing, so the next step can be planned against the result.
 *
 * Pure, and it uses the SAME rewrite the preview and the server use. A simulation with its own copy
 * of the rewrite would diverge from the real one at exactly the point where a reader stopped being
 * able to check it.
 */
export function applyRename(records, { from, to }) {
	return (records ?? []).map((record) => {
		const rewritten = renameInDelta(record?.semantic ?? {}, { from, to });
		return rewritten.touched ? { ...record, semantic: rewritten.delta } : record;
	});
}

/**
 * Every write a batch of ticked clusters would perform, in the order it would perform them.
 *
 * One STEP per losing spelling, because one call to the rename door carries one pair. A cluster of
 * three spellings is two steps, and the second is planned against the first one's result.
 *
 * @param {Array} records   the export listing this browser holds
 * @param {Array} clusters  the ticked clusters, each `{key, survivor, losing, spellings}`
 */
export function planClusterBatch(records, clusters) {
	const steps = [];
	let working = records ?? [];

	for (const cluster of clusters ?? []) {
		const survivor = text(cluster?.survivor);
		if (!survivor) continue;
		// Alphabetical rather than the array's order, so the same tick set plans the same batch
		// twice. The order of the losing spellings does not change what lands, and an unstable one
		// would make "the run stopped after the second step" mean something different each time.
		const losing = [...(cluster.losing ?? [])].sort((a, b) => a.localeCompare(b));
		for (const from of losing) {
			const plan = planRename(working, { from, to: survivor });
			steps.push({
				cluster_key: cluster.key,
				from,
				to: survivor,
				plan,
				// A step with nothing to write is still LISTED. It is how the reader finds out that
				// one half of a cluster is a name no memory actually writes — which happens, and is
				// invisible from the cluster row.
				writes: plan.memories.length,
			});
			if (plan.memories.length > 0) working = applyRename(working, { from, to: survivor });
		}
	}

	// Memories written by more than one step. Named rather than counted: this is the reader's only
	// warning that a later step's preview describes a memory an earlier step has already changed,
	// and the run re-reads before every such step rather than trusting the version it started with.
	const byMemory = new Map();
	steps.forEach((step, index) => {
		for (const memory of step.plan.memories) {
			const held = byMemory.get(memory.memory_id) ?? { memory_id: memory.memory_id, title: memory.title, steps: [] };
			held.steps.push(index);
			byMemory.set(memory.memory_id, held);
		}
	});
	const crossed = [...byMemory.values()].filter((entry) => entry.steps.length > 1);

	const writing = steps.filter((step) => step.writes > 0);

	return {
		steps,
		crossed,
		counts: {
			clusters: new Set(steps.map((step) => step.cluster_key)).size,
			steps: steps.length,
			writing: writing.length,
			memories: byMemory.size,
			facts: steps.reduce((total, step) => total + step.plan.counts.facts, 0),
			declarations: steps.reduce((total, step) => total + step.plan.counts.declarations, 0),
			collapsed: steps.reduce((total, step) => total + step.plan.counts.collapsed, 0),
		},
		// Every warning any step raised, deduplicated, so the reader meets them before the button
		// rather than inside a step's own panel three screens down.
		warnings: [...new Set(steps.flatMap((step) => step.plan.warnings))],
		blockers: writing.length === 0 ? ['None of the ticked clusters names a spelling any memory writes.'] : [],
	};
}

/** What one step posts, taken from the plan the reader actually looked at. */
export const stepRequest = (step) => renameRequest(step.plan);

/**
 * Does a re-planned step still describe what the reader approved?
 *
 * Compared on CONTENT — the memories, in order, and what each of their facts becomes — and not on
 * the versions, because the versions are the thing that is expected to have moved. A step whose
 * content moved is a step whose preview is no longer true, and the run stops on it for the same
 * reason a single write stops on a stale version: what would be written is not what was authorised.
 */
export function samePlanShape(approved, replanned) {
	const shape = (plan) =>
		(plan?.memories ?? []).map((memory) => [
			memory.memory_id,
			memory.statements.map((statement) => `${statement.before}→${statement.after}`).join('|'),
		]);
	const before = shape(approved);
	const after = shape(replanned);

	if (before.length !== after.length) {
		return {
			same: false,
			why:
				`The preview named ${before.length} ${before.length === 1 ? 'memory' : 'memories'} and ` +
				`this step would now write ${after.length}.`,
		};
	}
	for (let index = 0; index < before.length; index += 1) {
		if (before[index][0] !== after[index][0] || before[index][1] !== after[index][1]) {
			return {
				same: false,
				why: `What would be written to ${after[index][0]} is not what the preview showed.`,
			};
		}
	}
	return { same: true, why: null };
}

// =============================================================================================
// Reading the batch report
// =============================================================================================

/**
 * The states a STEP can end in. The run's own states are `merge-model`'s and describe one memory;
 * these describe one rename, and only two of them let the batch continue.
 */
export const STEP_STATES = Object.freeze({
	done: { label: 'Merged', tone: 'ok', continues: true },
	nothing_to_write: { label: 'Nothing to write', tone: 'idle', continues: true },
	stopped: { label: 'Stopped part of the way', tone: 'stop', continues: false },
	moved: { label: 'Not sent — the vault moved', tone: 'stop', continues: false },
	failed: { label: 'Not sent — the call failed', tone: 'stop', continues: false },
	not_attempted: { label: 'Never attempted', tone: 'idle', continues: false },
});

/**
 * THE BOUNDARY ACROSS A BATCH, which is the deliverable of a stopped run.
 *
 * Two levels, and both are needed. Inside one step, the boundary is which memories were rewritten
 * and which were never reached — `summariseRenameRun` draws that. Across the batch, it is which
 * renames finished, which one stopped, and which were never started. A batch report that gave only
 * the second would leave a half-written rename looking like a whole one.
 *
 * @param {Array} steps    from `planClusterBatch`
 * @param {Array} results  per step: `{state, report?, error?}`, shorter than `steps` if it stopped
 */
export function summariseBatch(steps, results) {
	const rows = steps.map((step, index) => {
		const result = results?.[index] ?? { state: 'not_attempted' };
		const known = STEP_STATES[result.state] ?? STEP_STATES.failed;
		return {
			index,
			from: step.from,
			to: step.to,
			cluster_key: step.cluster_key,
			state: result.state ?? 'not_attempted',
			label: known.label,
			tone: known.tone,
			continues: known.continues,
			// The per-memory boundary inside this step, when there was a run to summarise.
			run: result.report ? summariseRenameRun(result.report) : null,
			said: result.error?.message ?? result.why ?? null,
			request: result.request ?? null,
		};
	});

	const stoppedAt = rows.find((row) => !row.continues && row.state !== 'not_attempted') ?? null;
	const done = rows.filter((row) => row.state === 'done');
	const memoriesWritten = new Set(
		rows.flatMap((row) => (row.run?.rewritten ?? []).map((item) => item.memory_id)),
	);

	return {
		rows,
		complete: stoppedAt === null,
		stopped_on: stoppedAt,
		done,
		not_attempted: rows.filter((row) => row.state === 'not_attempted'),
		heading: stoppedAt
			? 'The merge stopped part of the way through'
			: done.length === 1
				? 'One spelling was merged'
				: `${done.length} spellings were merged`,
		sentence: stoppedAt
			? `${done.length} of ${rows.length} renames finished and ${memoriesWritten.size} ` +
				`${memoriesWritten.size === 1 ? 'memory was' : 'memories were'} rewritten. Nothing below ` +
				`“${stoppedAt.from}” was written to.`
			: `${memoriesWritten.size} ${memoriesWritten.size === 1 ? 'memory was' : 'memories were'} ` +
				`rewritten across ${rows.length} ${rows.length === 1 ? 'rename' : 'renames'}.`,
		counts: {
			steps: rows.length,
			done: done.length,
			memories: memoriesWritten.size,
			facts: rows.reduce(
				(total, row) => total + (row.run?.rewritten ?? []).reduce((sum, item) => sum + item.facts_rewritten, 0),
				0,
			),
		},
		// Every copy the whole batch took, in the order taken. Listed rather than counted, because
		// the point of saying a copy was kept is that a person can go and look at it.
		snapshots: rows.flatMap((row) => row.run?.snapshots ?? []),
	};
}

/**
 * What a resume will do, in words, before it is pressed.
 *
 * IT RESTARTS AT THE STEP THAT STOPPED, NOT AT THE TOP. The steps that finished are not re-sent,
 * and inside the stopped step the memories that landed are not re-sent either — the run reports a
 * memory that no longer uses the old spelling as already named rather than writing it, so a resume
 * that over-reached would still not mint a second version. Two guarantees, because this is the
 * button somebody presses while annoyed.
 */
export function describeBatchResume(summary) {
	if (!summary || summary.complete) return null;
	const from = summary.stopped_on;
	const rest = summary.not_attempted.length;
	const inside = from?.run?.resume?.items?.length ?? null;

	return {
		from_index: from.index,
		sentence:
			`Picks up at “${from.from}” → “${from.to}”` +
			(inside === null
				? ', which was never sent, '
				: `, where ${inside} ${inside === 1 ? 'memory' : 'memories'} were never reached, `) +
			`and then runs the ${rest} ${rest === 1 ? 'rename' : 'renames'} after it. ` +
			`The ${summary.done.length} that finished are not run again.`,
		steps_left: rest + 1,
	};
}
