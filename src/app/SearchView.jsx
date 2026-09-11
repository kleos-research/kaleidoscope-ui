import { useCallback, useMemo, useRef, useState } from 'react';


import { askRanked } from './api.mjs';
import { ago } from './when.mjs';
import {
	bytesLabel,
	budgetReading,
	findTheseWords,
	answerIsStale,
	isRankedAnswer,
	omittedRows,
	rankedRows,
	rankingControls,
	servedCaption,
	whyThese,
} from './search-model.mjs';
import {
	AskBox,
	AskLayout,
	Card,
	Display,
	DetailRow,
	DetailRows,
	EmptyState,
	ErrorState,
	Icon,
	Identifier,
	Meter,
	Page,
	RankedResult,
	ResultBlock,
	ResultList,
	Rule,
} from './ui/index.mjs';

/**
 * THE SEARCH SCREEN — two different things, named differently, sharing one input.
 *
 * "Find these words" is instant. It runs over the rows this browser already holds, it reaches no
 * server, and it writes nothing. It also cannot find a memory that means the same thing in
 * different words, and the screen says so rather than letting the user discover it.
 *
 * "Ask the way your agent does" is the engine's ranked door. It is the ONLY place in this product
 * that reaches it.
 *
 * THE RULE, WRITTEN WHERE IT WOULD BE BROKEN:
 *
 *   A ranked search happens ONLY on an explicit user action on the search screen. Never on load,
 *   never on a poll, never on a keystroke, never on a refresh, never from any other screen.
 *
 * There is exactly one call to `askRanked` in this file and it is inside an `onAsk` handler. It is
 * NOT in a `useEffect`, and it must never move into one — an effect is by definition a call that
 * happens because the component rendered, which is the definition of "on load". Nor is it in the
 * form's `onSubmit`: Enter in a text field is a keystroke, and the box submits the free search.
 *
 * Why the rule is worth this much care. The ranked door ALWAYS records an exposure row; the row is
 * permanent; it stores the query verbatim; and nothing this app publishes reads one back or removes
 * one. A search screen that asked as you typed would turn browsing your own memory into a keystroke
 * log inside it, and the user would have no way to undo that or even to look at what was kept.
 *
 * `test/server.test.mjs` measures the property rather than trusting this comment: it walks every
 * route and every screen load, asserts the exposure count did not move, then presses the door once
 * and asserts it moved by exactly one.
 */
export function SearchView({
	initialQuery = '',
	rows,
	relations,
	project = null,
	onOpen,
	onQueryChange = null,
}) {
	const [query, setQuery] = useState(initialQuery);
	/*
	  Which of the two searches the page below is showing. IT STARTS ON THE FREE ONE, ALWAYS, and
	  arriving with a query in the URL does not change that. A link that ran a ranked search merely
	  by being opened is "on load" wearing a different hat — and a link is the commonest way a screen
	  gets loaded a second time.
	*/
	const [mode, setMode] = useState('find');
	const [answer, setAnswer] = useState(null);
	const [askError, setAskError] = useState(null);
	const [busy, setBusy] = useState(false);

	/*
	  IS THE ANSWER ON SCREEN STILL AN ANSWER TO THE QUESTION IN THE BOX?

	  `asked_for` is stamped onto every answer at the moment it is asked, so this is a comparison and
	  not new state. Trimmed on both sides because trailing space is not a different question, and
	  guarded on `answer` so an empty screen is never "stale".
	*/
	const stale = answerIsStale(answer, query);

	// Cancels a press that is still out when a second one arrives. It never starts a request; it
	// only stops one this screen already sent.
	const inFlight = useRef(null);

	const found = useMemo(() => findTheseWords(rows, query), [rows, query]);

	const onFind = useCallback(() => {
		setMode('find');
		onQueryChange?.(query);
	}, [query, onQueryChange]);

	/**
	 * THE ONE PRESS. Everything this app does with the ranked door happens inside this function.
	 *
	 * Deliberately plain: one call, no retry, no warm-up, no second call for a count. Each of those
	 * would be another permanent record of a read the user did not perform, which is why the test
	 * that guards this asserts the exposure count moves by EXACTLY ONE per press rather than merely
	 * moving.
	 */
	const onAsk = useCallback(async () => {
		const asking = query.trim();
		if (asking === '') return;

		inFlight.current?.abort();
		const controller = new AbortController();
		inFlight.current = controller;

		setBusy(true);
		setAskError(null);
		setMode('ask');
		onQueryChange?.(asking);

		// Measured around the whole round trip, and labelled as that where it is read. It includes
		// starting the engine process, so it is not a measurement of retrieval and the disclosure
		// below says so rather than letting a bare number imply one.
		const started = performance.now();
		try {
			const body = await askRanked(
				{
					query: asking,
					// Asked inside the project the user is looking at, because that is their question:
					// what would my agent get, here. An omitted axis matches every memory, so "every
					// project" is the axis left out rather than a value sent.
					scope: project ? { project } : undefined,
				},
				{ signal: controller.signal },
			);
			// THE ANSWER IS INSIDE THE ENVELOPE. Every route on this sidecar answers with the same
			// wrapper — outcome, exit code, provenance — and the ranked answer is its `data`. Read
			// the wrapper instead and every field below is `undefined`, which the readings would
			// turn into a confident "your agent would have been given nothing". `isRankedAnswer`
			// below is what stops that being renderable at all.
			setAnswer({
				...(body?.data ?? {}),
				asked_for: asking,
				elapsed_ms: performance.now() - started,
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			// The previous answer is CLEARED rather than left standing. Old memories under a new
			// question would read as "this is what your agent would get for that", which is the one
			// thing this screen must never say wrongly.
			setAnswer(null);
			setAskError(error);
		} finally {
			if (inFlight.current === controller) {
				inFlight.current = null;
				setBusy(false);
			}
		}
	}, [query, project, onQueryChange]);

	return (
		<Page narrow>
			<AskBox
				query={query}
				onQuery={setQuery}
				onFind={onFind}
				onAsk={onAsk}
				findCount={query.trim() === '' ? null : found.length}
				mode={mode}
				busy={busy}
				elapsedMs={mode === 'ask' && answer ? answer.elapsed_ms : null}
			/>

			<Rule />

			{mode === 'find' ? (
				<FoundWords query={query} found={found} total={rows.length} onOpen={onOpen} />
			) : (
				<Answer
					busy={busy}
					error={askError}
					result={answer}
					answer={answer}
					stale={stale}
					rows={rows}
					relations={relations}
					project={project}
					onOpen={onOpen}
				/>
			)}
		</Page>
	);
}

/**
 * THE FREE HALF. Rows this browser already holds, matched on the words as typed.
 *
 * The empty state is the important part, and it is not an apology. A word search that finds nothing
 * has genuinely answered a question — these words are not in your memories — and the honest next
 * move is the other button, which asks a different question entirely.
 */
function FoundWords({ query, found, total, onOpen }) {
	if (query.trim() === '') {
		return (
			<EmptyState heading="Two searches, and this box does both">
				<p>
					<strong>Find these words</strong> looks through the {total.toLocaleString()} memories
					already loaded in this window. It is instant, it reaches nothing and it records nothing
					— but it only finds the words you type.
				</p>
				<p>
					<strong>Ask the way your agent does</strong> is the door your agent reads through. It
					ranks on meaning as well as words, and it shows you exactly what your agent would have
					been handed for the question.
				</p>
			</EmptyState>
		);
	}

	if (found.length === 0) {
		return (
			<EmptyState heading="None of your memories contain those words">
				<p>
					This search finds the words you type and nothing else. It does not rank, and it cannot
					find a memory that says the same thing in different words — that is the other button,
					and it is the one worth pressing next.
				</p>
			</EmptyState>
		);
	}

	return (
		<ResultBlock
			label="Contains these words"
			caption={`${found.length.toLocaleString()} of ${total.toLocaleString()} · nothing was asked`}
		>
			<ResultList>
				{found.map((row) => (
					<RankedResult
						key={row.memory_id}
						title={row.title}
						meta={[row.memory_type, ago(row.created_on)].filter(Boolean).join(' · ')}
						onOpen={() => onOpen(row.memory_id)}
					/>
				))}
			</ResultList>
		</ResultBlock>
	);
}

/**
 * THE RANKED HALF: what the agent would have been given, and everything true about it.
 */
function Answer({ busy, error, result, answer, stale, rows, relations, project, onOpen }) {
	const [ranking, setRanking] = useState(false);
	if (error) {
		return <ErrorState heading="That question did not reach the engine" error={error} />;
	}
	if (busy && !result) return <EmptyState heading="Asking your memory the way your agent does…" />;
	if (!result) return null;

	/*
	  THE ANSWER ARRIVED IN A SHAPE THIS BUILD CANNOT READ — say so, rather than render it.

	  This is not defensive tidiness. Every reading on this screen is a claim about what the user's
	  agent would have been handed, and an unreadable answer makes all of them zero: nought memories,
	  nought bytes of nought, "room to spare, so nothing was dropped for size". That is not a degraded
	  screen, it is a confident and completely false one, and it is what this screen actually did
	  before `isRankedAnswer` existed. An engine that changes the shape must produce a message the
	  user can report, never a tidy empty answer about their own memory.
	*/
	if (!isRankedAnswer(result)) {
		return (
			<EmptyState heading="This app could not read the answer it was given">
				<p>
					The door answered, and the reply did not carry the served memories and the context
					budget this build expects. Nothing below could be said honestly, so nothing is said.
					The search itself did happen and is recorded in your vault.
				</p>
			</EmptyState>
		);
	}

	const served = rankedRows(result, { rows, relations });
	const omitted = omittedRows(result, { rows });
	const budget = budgetReading(result);
	const controls = rankingControls(result);

	return (
		<>
			{/*
			  THE HONESTY BANNER. Two sentences, both load-bearing, and the second is the one nobody
			  expects: pressing that button wrote a row into their own vault. It sits ABOVE the
			  results rather than in a footnote under them, which is the difference between
			  disclosing something and admitting it.
			*/}
			{/*
			  THE BANNER STOPS CLAIMING CURRENCY THE MOMENT THE QUESTION MOVES.

			  The answer already carries `asked_for` — the exact question that produced it — so
			  staleness is a comparison, not new plumbing. Typing over the box used to leave the old
			  answer standing under a sentence promising it was "exactly what it would have been given
			  FOR THIS QUESTION", which made the one screen whose whole purpose is not misdescribing
			  the agent's view say the single false thing it must never say.

			  The error path already reasoned this way — it clears the answer rather than let old
			  memories stand under a new question. This applies the same rule to the keystroke path.
			  The answer is DIMMED rather than cleared: it was true of a real question and a reader may
			  still want it, so it stays readable and stops asserting.
			*/}
			<Card tone={stale ? 'default' : 'accent'} className="banner-row">
				<Icon.Info size={15} className="icon banner-icon" />
				<p className="banner-copy">
					{stale ? (
						<>
							This answer is for <strong>“{answer?.asked_for}”</strong>, which is no longer the
							question in the box. Press Ask to run the one you have typed.
						</>
					) : (
						<>
							This is the same door your agent reads through, so what you see below is{' '}
							<strong>exactly what it would have been given</strong> for this question. Asking is
							recorded in the vault the way your agent's own reads are, and that record includes the
							question you typed — it stays in the vault.
						</>
					)}
				</p>
			</Card>

			<AskLayout
				stale={stale}
				rail={
					<>
						<Card title="How much it got">
							<div className="budget-read">
								<Display level={2} size="md">
									{bytesLabel(budget.used)?.split(' ')[0] ?? '—'}
									<span className="budget-unit">
										{' '}
										{bytesLabel(budget.used)?.split(' ')[1] ?? ''}
									</span>
								</Display>
								<span className="budget-of">of {bytesLabel(budget.max)}</span>
							</div>
							<Meter
								value={budget.used}
								max={budget.max}
								label={`${bytesLabel(budget.used)} of ${bytesLabel(budget.max)} of context used`}
							/>
							{/*
							  Read off the omission reasons, never off the fill of the bar. A result can
							  sit at a third of the budget and still have dropped a memory that would not
							  have fitted whole, and a sentence inferred from the bar would deny that
							  with complete confidence on the screen whose promise is honesty.
							*/}
							<p className="budget-note">{budget.sentence}</p>
							{budget.requested === null ? null : (
								<p className="budget-note">
									A budget of {bytesLabel(budget.requested)} was asked for; the engine applied{' '}
									{bytesLabel(budget.max)}.
								</p>
							)}
						</Card>

						<Card title={served.length === 1 ? 'Why this one' : `Why these ${served.length}`}>
							<p className="rail-copy">{whyThese(result)}</p>
							{/*
							  THE MOCKUP'S ONE ACCENT LINE, not a chevron row with hairlines. Opened, it says
							  what the engine ran under as sentences where this build knows the name and as
							  the engine spells it where it does not — the echo, never the request, because an
							  omitted control comes back filled in with the published default.
							*/}
							<button
								type="button"
								className="link-more"
								aria-expanded={ranking}
								onClick={() => setRanking(!ranking)}
							>
								{ranking ? 'Hide the ranking' : 'Show the ranking'}
							</button>
							{ranking ? (
								<ul className="reasons">
									<li>asked “{result.asked_for}”</li>
									<li>within {project ? `project ${project}` : 'every project'}</li>
									{controls.map((control) => (
										<li key={control.name}>{control.words}</li>
									))}
									<li>{Math.round(result.elapsed_ms).toLocaleString()} ms, including engine start-up</li>
								</ul>
							) : null}
						</Card>

						{/*
						  THE CALL TO ACTION, in the approved words. It is the whole argument for putting
						  the ranked door in a person's hands: the fastest route to a memory worth fixing
						  is the agent naming the one it would have used.
						*/}
						<Card tone="warn">
							<p className="rail-lede">One of these looks wrong to you?</p>
							<p className="rail-copy">
								That is the fastest way to find a memory worth fixing — your agent just told you
								it would use it.
							</p>
						</Card>
					</>
				}
			>
				<ResultBlock
					label="It would receive"
					caption={servedCaption(result, { pool: rows.length })}
				>
					{/*
					  WHAT WAS LEFT OUT, directly under the block head that announces it — closed, with
					  its count showing — rather than as the closing row 1,500px under the caption. The
					  shared reason is said once, in the label, when there is one; each title opens the
					  memory when the listing holds it, which is what `in_listing` was computed for.
					*/}
					{omitted.length > 0 ? (
						<DetailRows>
							<DetailRow
								label={
									omitted.every((row) => row.reason === 'context_byte_budget')
										? 'Left out for size'
										: 'Ranked, then left out'
								}
								count={omitted.length}
							>
								<ResultList>
									{omitted.map((row) => (
										<RankedResult
											key={row.memory_id}
											title={row.title ?? <Identifier value={row.memory_id} label="memory id" />}
											meta={
												omitted.every((entry) => entry.reason === row.reason) ? '' : row.words
											}
											onOpen={row.in_listing ? () => onOpen(row.memory_id) : null}
										/>
									))}
								</ResultList>
							</DetailRow>
						</DetailRows>
					) : null}
					{served.length === 0 ? (
						<EmptyState heading="Your agent would have been given nothing for this">
							<p>
								The door answered and served no memory. That is a real answer about this vault
								rather than a failure: nothing in it ranked highly enough to be worth your
								agent's context.
							</p>
						</EmptyState>
					) : (
						<ResultList>
							{served.map((row) => (
								<RankedResult
									key={row.memory_id}
									rank={row.rank}
									title={row.title}
									dimmed={row.superseded}
									/*
									  THE PHRASE, NOT THE STORED STRING. Search.dc.html draws
									  "correction · today · 2.1 KB", and every other list in this product
									  says "today" and "3 days ago" — this row was the only one printing a
									  bare `2026-08-23`, which reads as a different kind of thing beside
									  them. The exact value is still on the memory's own page.
									*/
									meta={[
										row.superseded ? 'superseded' : row.memory_type,
										ago(row.created_on),
										bytesLabel(row.bytes),
									]
										.filter(Boolean)
										.join(' · ')}
									/*
									  NAMED, not merely dimmed. "Superseded" is not a field on a memory in
									  this product — it is computed from what OTHER memories declare — so the
									  row says which memory answers it instead of asserting a flag the vault
									  does not carry. A dimmed row with no explanation is a row the reader
									  cannot act on.
									*/
									note={
										row.superseded
											? `A later memory answers this${
													row.answered_by[0]?.title ? `: ${row.answered_by[0].title}` : ''
												}.`
											: null
									}
									onOpen={row.in_listing ? () => onOpen(row.memory_id) : null}
								/>
							))}
						</ResultList>
					)}
				</ResultBlock>

			</AskLayout>
		</>
	);
}
