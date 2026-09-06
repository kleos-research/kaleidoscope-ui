import { useState } from 'react';

import { cx } from './cx.mjs';

/**
 * The typographic pieces every screen re-uses, and the two rules they carry.
 *
 * RULE ONE — A VALUE THE RECORD DOES NOT CARRY IS RENDERED IN WORDS. Never a dash, never an empty
 * cell, never a placeholder that could be mistaken for data. The failure mode is not a reader
 * misunderstanding a blank; it is the next contributor treating the blank as a bug and filling it
 * with something plausible, after which the product asserts something the store never recorded.
 *
 * RULE TWO — AN OMITTED SCOPE MATCHES EVERYTHING. "applies to every branch" is wider than a branch,
 * not narrower, and a blank cell reads as the opposite. `ScopeLine` is the one place that sentence
 * is composed, so it cannot be spelled two ways on two screens.
 */

/** What an absent value looks like. One component, so there is exactly one wording. */
export function NotRecorded({ what = null }) {
	return (
		<span className="faint">
			not recorded{what ? <span className="sr-only"> — {what}</span> : null}
		</span>
	);
}

/**
 * An identifier or a path, in monospace and selectable.
 *
 * DELIBERATELY NOT TRUNCATED IN THE DOM. These are what a save conflict quotes back, and a person
 * comparing two of them is comparing character by character — an ellipsis in the middle of one is
 * the difference between a comparison and a guess. CSS may wrap it; nothing shortens it.
 */
export function Identifier({ value, label = null, className }) {
	if (!value) return <NotRecorded what={label} />;
	return (
		<code className={cx('identifier', className)} title={label ?? undefined}>
			{value}
		</code>
	);
}

/**
 * The section label above a block: "WHAT YOUR AGENT ACTS ON", "NAMED THINGS", "WHERE THIS CAME
 * FROM". A label, never a heading — it names a block, it does not open a section.
 */
export function Eyebrow({ children, className }) {
	return <div className={cx('eyebrow', className)}>{children}</div>;
}

/**
 * A serif heading. `level` is the DOCUMENT level and `size` is the drawn size, and they are
 * separate on purpose: a preview pane's title is an `h2` drawn at 27px while the memory's own page
 * draws the same string as an `h1` at 34px, and neither should have to lie about its outline
 * position to get the right size.
 */
export function Display({ level = 2, size = 'md', children, className, ...rest }) {
	const Tag = `h${level}`;
	return (
		<Tag className={cx('display', className)} style={{ fontSize: `var(--display-${size})` }} {...rest}>
			{children}
		</Tag>
	);
}

/**
 * "applies to every branch", "project Payments platform · every file".
 *
 * @param scope   the record's scope object.
 * @param axes    which axes to render, in order. Supplied by the caller, because which axes exist
 *                is a property of the loaded records rather than a list this repository writes down.
 * @param phrase  (axis) => ({ label, every }) — the words for an axis and for its absence.
 * @param only    'set' renders ONLY the axes this memory actually narrows, falling back to the
 *                first axis's "every …" phrase when it narrows none.
 * @param shorten (value) => string | null — the short form of a value for a headline, or null to
 *                draw it whole. Supplied by the caller for the same reason `phrase` is; a screen
 *                that reads a value in full passes nothing.
 *
 * WHY `only` EXISTS. Every axis is worth saying somewhere, and the complete reading is under "Where
 * it applies" on the same page. On the HEADLINE, "project kaleidoscope · every branch · every file"
 * spends two thirds of the line saying that two things a reader has never heard of were left blank
 * — which is the exact reading the owner gave of the rejected build ("Branch. I don't know why we
 * have it. File. I have no idea, and it's too long"). An unset axis is the default; the default is
 * what a headline leaves out.
 */
export function ScopeLine({ scope, axes, phrase, only = null, shorten = null }) {
	const narrowed = axes.filter((axis) => (scope?.[axis] ?? null) !== null);
	let shown = axes;
	if (only === 'set') {
		// A memory that narrows nothing still has to say so, and it says it about ONE axis — which is
		// exactly what ReadB draws: "correction · written today · applies to every branch".
		shown = narrowed.length > 0 ? narrowed : axes.slice(0, 1);
	}
	return (
		<span>
			{shown.map((axis, index) => {
				const value = scope?.[axis] ?? null;
				const copy = phrase(axis);
				return (
					<span key={axis}>
						{index > 0 ? <span className="faint"> · </span> : null}
						{value === null ? (
							<span className="faint">{copy.every}</span>
						) : (
							<>
								<span className="faint">{copy.label} </span>
								<ScopeValue value={value} short={shorten ? shorten(value) : null} />
							</>
						)}
					</span>
				);
			})}
		</span>
	);
}

/**
 * One scope value on a metadata line — whole, or cut short with the whole value one press away.
 *
 * The owner read a scope line on the rejected build and said of the file axis: "I have no idea.
 * And it's too long — it just goes on and on and on." A repository path is sixty characters that
 * push the date, the type and the project off the line and tell a reader nothing they were looking
 * for, so the headline draws the short form the caller supplies.
 *
 * THE SHORT FORM IS A BUTTON, NOT A TOOLTIP. It used to be a CSS ellipsis with the whole value on
 * hover, which is a value a touch screen cannot reach and a keyboard cannot ask for. Now the cut
 * value is a control: press it and the whole value is drawn in its place, wrapping as it needs to,
 * and press again to fold it. The dotted underline is what says there is more; the whole value is
 * also shown in full and editable under "Where it applies", which is the screen that exists to
 * change it.
 */
export function ScopeValue({ value, short = null }) {
	const [open, setOpen] = useState(false);
	if (short === null) return <span className="scope-value">{value}</span>;
	return (
		<button
			type="button"
			className={cx('scope-value', 'scope-value-cut', open && 'scope-value-open')}
			aria-expanded={open}
			aria-label={open ? undefined : `${short} — show the whole value`}
			onClick={() => setOpen(!open)}
		>
			{open ? value : short}
		</button>
	);
}

/** A rail card: one titled block of one kind of thing. The unit the reading screens are built from. */
export function Card({ title = null, aside = null, tone = 'neutral', children, className }) {
	return (
		<section className={cx('card', tone !== 'neutral' && `card-${tone}`, className)}>
			{title || aside ? (
				<header className="card-head">
					{title ? <div className="eyebrow">{title}</div> : <span />}
					{aside ? <span className="item-count">{aside}</span> : null}
				</header>
			) : null}
			{children}
		</section>
	);
}

/**
 * A proportion, drawn once. "10.4 KB of 32 KB", and the bar under it.
 *
 * `value` and `max` are numbers; the words beside them are the caller's, because the unit is
 * theirs. The bar is capped at 100% so an over-budget reading draws full rather than overflowing
 * its track — and the caller is expected to say so in words, because a bar that is merely full
 * cannot express "more than".
 */
export function Meter({ value, max, label = null }) {
	const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
	return (
		<div className="meter" role="img" aria-label={label ?? `${value} of ${max}`}>
			<div className="meter-fill" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
		</div>
	);
}

export const Rule = () => <hr className="rule" />;

/**
 * WHAT THE COLOURS ON A DRAWING MEAN, read from the palette this vault produced.
 *
 * The entity kinds are an OPEN registry — the engine publishes them at run time, this repository
 * writes none of them down, and a real vault carries several times as many as the schema names. So
 * the slots are assigned to the kinds this vault actually uses, most-used first, and everything past
 * the last slot takes the "other" ink and keeps its own name on the node. A legend that named twelve
 * fixed kinds would decode a drawing this app is not making.
 *
 * The count of what is not in the legend is printed rather than omitted: "and 88 more kinds" is the
 * finding that the kind vocabulary has sprawled, and it is the only place on these screens it shows.
 */
export function KindLegend({ palette, limit = 5, otherWord = 'more kinds' }) {
	const named = palette?.named?.slice(0, limit) ?? [];
	const rest = (palette?.named?.length ?? 0) - named.length + (palette?.otherCount ?? 0);
	return (
		<span className="kind-legend">
			{named.map((entry) => (
				<span key={entry.kind} className="kind-legend-item">
					<span className="kind-legend-dot" style={{ background: `var(--k${entry.slot})` }} />
					{entry.kind}
				</span>
			))}
			{rest > 0 ? (
				<span className="kind-legend-item">
					<span className="kind-legend-dot" style={{ background: 'var(--k-other)' }} />
					{rest.toLocaleString()} {otherWord}
				</span>
			) : null}
		</span>
	);
}
