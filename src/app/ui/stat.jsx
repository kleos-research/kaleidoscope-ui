import { cx } from './cx.mjs';

/**
 * THE SHAPE OF THE THING, STATED BEFORE ANYTHING IS DRAWN.
 *
 * GraphEntry opens with four of these: `799 named once and never again`, `304 separate clusters,
 * largest is 160`, `12 look like the same thing, spelled twice`, and then one that is not a number
 * at all but the sentence those three add up to. That row is the whole of the whole-vault view,
 * delivered as text, and it is why no screen in this product renders a picture of eleven hundred
 * nodes: the entire payload of that picture is four numbers and a sentence, and the numbers are
 * legible here instead of estimated by eye.
 *
 * The strip is used twice — over the names table and over the curation screen — so it is one
 * component. The alternative is two rows of cards that agree today.
 */

/** The row. Cards flex to equal width unless one asks for more (`grow`). */
export function StatStrip({ children, className }) {
	return <div className={cx('stats', className)}>{children}</div>;
}

/**
 * One reading: a number in the serif, and the words that say what it counts.
 *
 * THE WORDS ARE A SENTENCE FRAGMENT, NOT A LABEL. "named once and never again" tells a reader what
 * the number means; "singletons" tells them what it is called. The mockups are unanimous on this
 * and it is the same rule as the curation screen's cost sentences — a label a reader has to be
 * taught is a label that failed.
 *
 * `tone="warn"` is for a reading that is the reason to act. There is at most one per strip; two
 * warn cards side by side are two things shouting and neither is heard.
 */
export function Stat({ value, tone = 'neutral', grow = false, children, className }) {
	return (
		<div
			className={cx('stat', tone !== 'neutral' && `stat-${tone}`, grow && 'stat-grow', className)}
		>
			<div className="stat-value">{value}</div>
			<div className="stat-label">{children}</div>
		</div>
	);
}

/**
 * The card in the strip that carries no number — the sentence the numbers add up to.
 *
 * It is a peer of the readings rather than a paragraph under them because it is the same claim at
 * the same level: "this is more connected than it looks" is a fact about the vault, and putting it
 * below the row would make it a footnote to the row rather than the point of it.
 */
export function StatNote({ grow = true, children, className }) {
	return (
		<div className={cx('stat', 'stat-note', grow && 'stat-grow', className)}>
			{/*
			  ONE ELEMENT, because `.stat` is a flex COLUMN and this card's children are a sentence.
			  Handed to that column directly, "…so this is", the emphasised clause and "Every pair you
			  merge…" became three flex items and the sentence was drawn as three stacked lines, which
			  pushed the whole strip to nearly twice the height GraphEntry draws.
			*/}
			<p className="stat-note-body">{children}</p>
		</div>
	);
}

/**
 * THE SENTENCE THAT SAYS WHAT SOMETHING COSTS YOU. The most repeated object on the curation screen.
 *
 * The mockups draw it as small text on the raised tint inside a white card — under a field in
 * EditValues ("Names join only when they match exactly…"), under a group heading here. It is not a
 * banner, an alert or a callout: it does not interrupt, it explains the thing directly above it,
 * and it is quiet enough that a screen can carry six of them without becoming a warning label.
 *
 * `tone="warn"` is the version that says what goes wrong rather than how something works. Reserved,
 * for the same reason the warn stat is: a screen where everything is tinted has no emphasis at all.
 */
export function Note({ tone = 'neutral', children, className, ...rest }) {
	return (
		<p className={cx('note', tone !== 'neutral' && `note-${tone}`, className)} {...rest}>
			{children}
		</p>
	);
}
