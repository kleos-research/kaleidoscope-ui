import { cx } from './cx.mjs';
import { Eyebrow } from './text.jsx';

/**
 * PANE FURNITURE: the band across the top of a screen, and the head, body and foot of one pane.
 *
 * `shell.css` already gives a screen its regions — `.screen-split`, `.pane`, `.pane-bordered`,
 * `.pane-surface`. What it does not give is what goes INSIDE one, and that is the part the last
 * design got wrong in a way the owner could see without being able to name: "I don't think that's
 * aligned correctly. I don't think there's enough padding." Every pane had its own idea of its
 * gutter, so no two labels on the screen shared a left edge.
 *
 * So the gutter is a property of the PANE, declared once as `--pane-pad`, and everything below
 * reads it. A head, a body and a foot in the same pane cannot disagree about where the text starts,
 * and two panes side by side can have different gutters — the editor's reading column is drawn at
 * 48px and its side pane at 26 — without either one spelling a number.
 */

/**
 * The strip across the full width of a screen, above a split.
 *
 * The editor's title lives here, and that is the argument for the shape: the title belongs to the
 * memory, not to a column, so drawing it inside either pane would say it was part of that half.
 */
export function Band({ children, className }) {
	return <div className={cx('band', className)}>{children}</div>;
}

/**
 * What a pane is: its label, and at most one thing you can do to it.
 *
 * The label is an `Eyebrow` — it names a block, it does not open a section — and the action beside
 * it is quiet. A pane with two competing controls in its head is a pane with two stories.
 */
export function PaneHead({ label, action = null, className }) {
	return (
		<div className={cx('pane-head', className)}>
			<Eyebrow>{label}</Eyebrow>
			{action}
		</div>
	);
}

/** The scrolling middle of a pane: the pane's gutter, a column, one gap. */
export function PaneBody({ gap = 'md', children, className }) {
	return <div className={cx('pane-body', gap === 'lg' && 'pane-body-lg', className)}>{children}</div>;
}

/**
 * A line pinned to the bottom of a pane, over a hairline.
 *
 * It is for a sentence that is true of the whole pane and must not scroll away — "A copy is kept
 * before this save. There is no undo." Nothing in here is a control, and nothing in here is the
 * only copy of anything: it is the standing condition, not the notification.
 */
export function PaneFoot({ icon = null, children, className }) {
	return (
		<div className={cx('pane-foot', className)}>
			{icon}
			<span>{children}</span>
		</div>
	);
}
