import * as RadixCheckbox from '@radix-ui/react-checkbox';

import { cx } from './cx.mjs';
import { Check } from './icons.jsx';

/**
 * BrowseScale, as shapes: the strip over the list, a time heading, a row, and the preview beside
 * them.
 *
 * THIS IS THE SCREEN THE OWNER SINGLED OUT — "Browse B yeah super cool, build all of it" — so every
 * value below is lifted from `design/BrowseB.dc.html` and `design/BrowseScale.dc.html` through the
 * tokens, and none is invented here. Three properties of the drawing are load-bearing and are
 * therefore rules rather than styling:
 *
 *   1. TIME DOES THE GROUPING. Sticky headings with their own counts — "Today 4", "Earlier this
 *      week 17", "August 50" — are the whole reason six hundred memories stay scannable. A flat
 *      list of six hundred titles is a list nobody reads the middle of.
 *   2. THE SELECTED ROW IS ACCENT-SOFT WITH A 2px LEFT EDGE, and EVERY row carries that edge in
 *      `transparent`. The mockup draws it only on the selected row, which pushes that row's text
 *      2px right of every other row's. "I don't think that's aligned correctly" was a real reading
 *      of the last build and it is not one this screen is going to earn again.
 *   3. A ROW IS CHEAP OFF SCREEN. Every row sets `content-visibility`, so a list grown to several
 *      thousand rows does no layout and no paint for the rows nobody is looking at, while staying
 *      one array the keyboard can walk and the browser can find text in.
 */

/* ------------------------------------------------------------------------------ over the list */

/**
 * The strip above the rows: how they are ordered, and how to move through them.
 *
 * The keyboard hint is on the SCREEN rather than in a help sheet because it is the only way to
 * discover it, and because a list whose selection moves without the mouse is the difference between
 * reading a vault and clicking through one.
 */
export function ListBar({ children, hint = null }) {
	return (
		<div className="mlist-bar">
			<div className="mlist-bar-left">{children}</div>
			{hint ? <div className="mlist-bar-hint">{hint}</div> : null}
		</div>
	);
}

/**
 * "TODAY · 4". Sticky, so the reader scrolling the middle of August always knows they are in it.
 *
 * The count is the group's own size and not the window's: a heading that counted only what had been
 * rendered would shrink as the reader scrolled toward it, which is the one number on this screen
 * that must not move.
 */
export function TimeHeading({ label, count }) {
	return (
		<div className="mgroup" role="presentation">
			<span className="mgroup-label">{label}</span>
			<span className="mgroup-count">{count}</span>
		</div>
	);
}

/* ---------------------------------------------------------------------------------- one row */

/**
 * One memory in the list: its title, one line of meta, and — on hover or once a selection exists —
 * the tick that puts it in a bulk run.
 *
 * THE TICK IS NOT ALWAYS DRAWN, and that is the difference between this list and the last one. A
 * permanent checkbox column makes every row a form control and makes the list about removal, which
 * is not what a person opens a memory browser to do. It appears where the pointer is, stays once
 * anything is ticked, and is reachable from the keyboard with `x` — so the capability is whole and
 * the default screen is the one that was approved.
 *
 * `dimmed` is a memory another one corrects or contradicts. BrowseScale draws it at half strength
 * with the word "superseded" in its meta. There is no superseded FIELD in this store — the reading
 * is an inversion over what the memories themselves declare — which is why it is a prop computed by
 * the caller rather than anything this component knows how to work out.
 */
export function MemoryRow({
	id,
	title,
	meta,
	selected = false,
	dimmed = false,
	ticked = false,
	onTick = null,
	onSelect,
	onOpen = null,
}) {
	return (
		<div
			className={cx('mrow', selected && 'mrow-selected', dimmed && 'mrow-dimmed', ticked && 'mrow-ticked')}
			role="listitem"
			data-memory={id}
		>
			{onTick ? (
				// The tick must not open the memory, and the row must not swallow the tick. Two
				// separate controls rather than one control with a stopPropagation, because a row
				// that navigates when you tick it is how a person loses a selection they were
				// halfway through building.
				<span className="mrow-tick">
					<RadixCheckbox.Root
						className="checkbox"
						checked={ticked}
						onCheckedChange={(next) => onTick(next === true)}
						aria-label={`Select ${title}`}
					>
						<RadixCheckbox.Indicator>
							<Check size={10} />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
				</span>
			) : null}

			<button
				type="button"
				className="mrow-open"
				aria-current={selected ? 'true' : undefined}
				onClick={onSelect}
				onDoubleClick={onOpen ?? undefined}
			>
				<span className="mrow-title">{title}</span>
				<span className="mrow-meta">{meta}</span>
			</button>
		</div>
	);
}

/**
 * The rows, as one list.
 *
 * A `role="list"` of `role="listitem"`, deliberately, and NOT a listbox: a listbox option may not
 * contain its own controls, and every row here carries a tick and an open. The selection is
 * announced by `aria-current` on the row that is being previewed, which is what it actually is —
 * "the one on screen beside this list" rather than "the one chosen from a menu".
 */
export function MemoryRows({ label, scrollRef = null, children }) {
	return (
		<div className="mlist-rows" role="list" aria-label={label} ref={scrollRef}>
			{children}
		</div>
	);
}

/**
 * The bar that appears only once something is ticked.
 *
 * It carries the COUNT IN WORDS on the control itself, because the number is the thing being
 * authorised and a bar that hides it is a bar the user cannot check. It is pinned to the bottom of
 * the list rather than floating over it: a strip that covers rows while you are choosing rows is a
 * control fighting its own job.
 */
export function BulkBar({ children }) {
	return (
		<div className="mlist-bulk" role="region" aria-label="Selected memories">
			{children}
		</div>
	);
}

/* ------------------------------------------------------------------------------- the preview */

/**
 * The right-hand pane: read the memory without leaving the list.
 *
 * ITS GUTTER IS DECLARED ONCE, on the pane, and the head, the words and the sections all read it.
 * That is the fix for the thing the owner could see and could not name — "I don't think that's
 * aligned correctly. I don't think there's enough padding." Every label in this pane shares one
 * left edge because there is one number and it is not spelled in three places.
 */
export function Preview({ children }) {
	return <div className="preview">{children}</div>;
}

/**
 * Title and meta on the left; the one filled control and the overflow on the right, on the same
 * top edge.
 *
 * `align-items: flex-start`, not `flex-end`: the title wraps to two lines on a long memory and a
 * bottom-aligned Edit button would then sit level with the second line, drifting down the screen as
 * the reader moved between memories. Everything a screen does that is not its one action lives
 * behind the "…" — that is what stops this head growing the row of five equal controls the last
 * build had.
 */
export function PreviewHead({ children, actions = null }) {
	return (
		<header className="preview-head">
			<div className="preview-head-titles">{children}</div>
			{actions ? <div className="preview-head-actions">{actions}</div> : null}
		</header>
	);
}

/** A block down the preview: the words, then what the agent acts on, then everything deferred. */
export function PreviewBlock({ children, className }) {
	return <div className={cx('preview-block', className)}>{children}</div>;
}
