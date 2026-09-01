import { cx } from './cx.mjs';

/**
 * ONE THING THAT NEEDS A DECISION.
 *
 * Four parts, always in this order, and the order IS the design: what it is, what is at stake, the
 * evidence, and the ways out. A curation finding, a proposed cluster of spellings and one step of a
 * merge report are all that shape — in each of them the reader is reading a claim, checking the
 * number beside it, and choosing — so they are one component. Three components that agreed on the
 * day they were written would not agree a month later, and the owner's word for the last version of
 * that was "I don't think there's enough padding".
 */

/** The list. Hairlines between rows, none above the first. */
export function DecisionList({ label, children, className }) {
	return (
		<ul className={cx('decisions', className)} aria-label={label}>
			{children}
		</ul>
	);
}

/**
 * @param lead    what this is — a name, a pair of spellings, a rewritten fact.
 * @param stake   the quantities the ordering used, as a string. NEVER a rank and never a score: a
 *                reader can check "7 facts · 5 memories" against the evidence under it, and they
 *                have no way at all to check a 4.
 * @param actions the ways out. Rendered last, because a reader who has not read the evidence is not
 *                yet choosing.
 */
export function Decision({ lead, stake = null, actions = null, children, className, ...rest }) {
	return (
		<li className={cx('decision', className)} {...rest}>
			<div className="decision-head">
				<div className="decision-lead">{lead}</div>
				{stake ? <div className="decision-stake">{stake}</div> : null}
			</div>
			{children ? <div className="decision-body">{children}</div> : null}
			{actions ? <div className="decision-actions">{actions}</div> : null}
		</li>
	);
}

/**
 * The memories one decision comes from, each openable.
 *
 * EVERY DECISION ON THESE SCREENS ENDS IN A MEMORY, because a memory is the only thing in this
 * product a person can actually change. A finding that could not name one would be an observation,
 * and neither of these screens has room for observations.
 */
export function Sources({ children, className }) {
	return <ul className={cx('decision-sources', className)}>{children}</ul>;
}

export function Source({ children, note = null }) {
	return (
		<li className="decision-source">
			{children}
			{note ? <span className="decision-source-note">{note}</span> : null}
		</li>
	);
}

/**
 * WHAT A FACT BECOMES, before and after — never "3 facts change".
 *
 * A count is a number a person cannot check, and the failure this exists to prevent is somebody
 * authorising a rewrite of memories they have not read. So both statements are printed whole and
 * the arrow is the only thing between them.
 */
export function Rewrites({ children, className }) {
	return <ul className={cx('rewrites', className)}>{children}</ul>;
}

export function Rewrite({ before, after }) {
	return (
		<li className="rewrite">
			<span className="rewrite-before">{before}</span>
			<span className="rewrite-arrow" aria-hidden="true">
				→
			</span>
			<span className="rewrite-after">{after}</span>
		</li>
	);
}

/**
 * The bar that carries a review screen's one write, pinned under the list it describes.
 *
 * `what` is a SENTENCE, not a count. "Merge" over a table of forty rows authorises a number; "3
 * clusters, 6 memories will be written" authorises a thing. The button beside it is the only filled
 * control on the screen, which is what makes it findable at the bottom of a long list.
 *
 * Sticky inside the flow rather than fixed to the viewport, because a bar fixed to the viewport
 * covers the last row of the table above it — and on this screen the last row is a cluster.
 */
export function RunBar({ what, children, className }) {
	return (
		<div className={cx('runbar', className)}>
			<div className="runbar-what">{what}</div>
			<div className="runbar-actions">{children}</div>
		</div>
	);
}
