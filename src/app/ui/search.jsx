import { cx } from './cx.mjs';
import { Search } from './icons.jsx';
import { RankBadge } from './badge.jsx';

/**
 * THE RESULT AND ITS RAIL, at the search screen's own widths.
 *
 * Not `Reading`, and the difference is not cosmetic. `Reading` is ReadB's layout — one memory's
 * prose at `--column-read` beside a facts rail at `--rail-facts` — and it is sized for reading
 * sentences. This is Search's: a list of short rows that fills the page, beside a 300px rail of
 * readings about the answer as a whole. Reusing the reading layout here would set the results to a
 * prose measure and the rail to a width the drawing does not use.
 *
 * `rail` is a prop rather than a child for the same reason it is there: nothing can put the results
 * in the rail or the rail above the results.
 */
/*
  THE RAIL STICKS, AND A STALE PANEL SAYS SO.

  Measured on the built screen at 1440x900: the column ran to y=1819 while the rail stopped at
  y=751, so a third of the page was an empty 326px gutter, and scrolling to the last result took
  the budget reading — the thing that explains the list — off the screen entirely. Sticking the
  rail keeps the reading beside the results it describes for the whole scroll, and costs nothing:
  it is already the shorter of the two.

  `stale` dims the whole panel when the question in the box is no longer the question that produced
  it. Dimmed rather than hidden: the answer was true of a real question, so it stays readable and
  stops presenting itself as current.
*/
export function AskLayout({ rail = null, stale = false, children }) {
	return (
		<div className={stale ? 'ask-split is-stale' : 'ask-split'} aria-stale={stale || undefined}>
			<div className="ask-column">{children}</div>
			{rail ? <aside className="ask-rail">{rail}</aside> : null}
		</div>
	);
}

/** The gap between result rows, once, so the two lists on this screen cannot drift apart. */
export function ResultList({ children }) {
	return <div className="result-list">{children}</div>;
}

/**
 * A block on this screen: its label, and the reading of the whole block beside it.
 *
 * "IT WOULD RECEIVE — 4 of 349 · nothing left out". The caption is a prop rather than a child so it
 * cannot drift below the label into the body, where it would read as a property of the first result
 * instead of a property of the answer.
 */
export function ResultBlock({ label, caption = null, children }) {
	return (
		<section className="result-block">
			<header className="result-block-head">
				<div className="eyebrow">{label}</div>
				{caption ? <span className="item-count">{caption}</span> : null}
			</header>
			{children}
		</section>
	);
}

/**
 * THE BIG BOX, AND THE TWO BUTTONS THAT ARE NOT THE SAME BUTTON.
 *
 * One input, two jobs, named differently — which is the whole point of the drawing. "Find these
 * words" runs over rows the browser already holds and writes nothing. "Ask the way your agent does"
 * is the engine's ranked door, it records an exposure row in the user's own vault, and it is the
 * only place in this product that reaches it.
 *
 * TYPING SUBMITS THE FREE ONE. The `<form>` wraps the field and its `onSubmit` calls `onFind`, never
 * `onAsk`. That is not a preference about defaults: the rule this screen exists under is that a
 * ranked search happens only on an explicit press — never on a keystroke — and Enter in a text field
 * is a keystroke. Wiring the form to the ranked door would put a permanent record of a read into the
 * vault every time somebody typed a word and reflexively hit Return.
 *
 * `findCount` is drawn beside its own button, always, because it is the answer to a question the
 * user has not had to ask yet: how many of these are here already, without asking anything. A zero
 * there is the strongest possible argument for pressing the other button.
 */
export function AskBox({
	query,
	onQuery,
	onFind,
	onAsk,
	findCount = null,
	mode = 'find',
	busy = false,
	elapsedMs = null,
	placeholder = 'Find or ask',
}) {
	return (
		<div className="ask">
			<form
				className="ask-box"
				role="search"
				onSubmit={(event) => {
					event.preventDefault();
					onFind?.();
				}}
			>
				<Search size={16} className="icon ask-icon" />
				<input
					className="ask-input"
					type="search"
					value={query}
					placeholder={placeholder}
					aria-label={placeholder}
					autoComplete="off"
					onChange={(event) => onQuery?.(event.target.value)}
				/>
			</form>

			<div className="ask-actions">
				<button
					type="button"
					className={cx('ask-mode', mode === 'find' && 'ask-mode-on')}
					aria-pressed={mode === 'find'}
					onClick={() => onFind?.()}
				>
					Find these words
					{findCount === null ? null : <span className="ask-mode-count">{findCount}</span>}
				</button>

				{/*
				  THE ONE FILLED CONTROL ON THIS SCREEN, and the one door in this product to the ranked
				  search. It is a real <button> with a click handler and nothing else: no form submit,
				  no keyboard shortcut, no effect that presses it, and a failed press is not tried
				  again — a second attempt is a second permanent record of a read nobody performed.
				*/}
				<button
					type="button"
					className="btn btn-primary btn-sm"
					disabled={busy || query.trim() === ''}
					onClick={() => onAsk?.()}
				>
					{busy ? 'Asking…' : 'Ask the way your agent does'}
				</button>

				<span className="ask-spacer" />

				{/*
				  The round trip, not the engine's own time. It includes starting a process, so it is
				  labelled as what it is where the reader can see the label — in the ranking disclosure
				  — rather than presented as a benchmark of retrieval.
				*/}
				{elapsedMs === null ? null : (
					<span className="ask-timing">{Math.round(elapsedMs).toLocaleString()} ms</span>
				)}
			</div>
		</div>
	);
}

/**
 * ONE MEMORY THE AGENT WOULD HAVE RECEIVED, drawn at its rank.
 *
 * `dimmed` is for a served memory the vault itself says has been corrected or contradicted by a
 * later one. It is dimmed rather than hidden or re-sorted, because it WAS served: the agent would
 * have been given it, and a screen that quietly dropped it would be lying in the direction that
 * matters most. The dimming is what makes it findable, and finding it is the point of the screen.
 *
 * `note` is the one line under a dimmed row saying which memory answers it. A dimmed row with no
 * explanation is a row the reader cannot act on, and "that is the fastest way to find a memory
 * worth fixing" is the promise the screen makes two inches to the right.
 *
 * `rank` MAY BE NULL, and that is how the same row serves both halves of this screen. The badge is
 * a claim — "the engine put this here, in this position" — so the free word search, which ranks
 * nothing, renders without one rather than with a number counted off in the browser. A position in
 * a list looks exactly like a position in a ranking, and only one of them is a fact.
 */
export function RankedResult({ rank = null, title, meta, dimmed = false, note = null, onOpen = null }) {
	const inner = (
		<>
			<span className="result-head">
				{rank === null ? null : <RankBadge rank={rank} dimmed={dimmed} />}
				<span className="result-title">{title}</span>
			</span>
			<span className={rank === null ? 'result-meta result-meta-flush' : 'result-meta'}>{meta}</span>
			{note ? (
				<span className={rank === null ? 'result-note result-meta-flush' : 'result-note'}>{note}</span>
			) : null}
		</>
	);

	// A row that cannot be opened is not drawn as a button. A control that looks pressable and does
	// nothing is worse on this screen than anywhere else: the reader has just been told these are
	// the memories their agent would use, and their next move is to go and look at one.
	if (!onOpen) return <div className={cx('result', dimmed && 'result-dimmed')}>{inner}</div>;

	return (
		<button
			type="button"
			className={cx('result', 'result-open', dimmed && 'result-dimmed')}
			onClick={onOpen}
		>
			{inner}
		</button>
	);
}
