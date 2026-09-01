import { cx } from './cx.mjs';
import { Close } from './icons.jsx';

/**
 * The small labelled things. Five of them, and the difference between them is what they mean, not
 * how they look — which is why they are five components and not one with a `variant` string.
 */

/**
 * A short literal from the vault: a memory type, a kind of named thing, a state.
 *
 * Rendered EXACTLY AS IT IS SPELLED. The vocabulary is open and read from the engine at runtime;
 * title-casing or pluralising it here would make the screen disagree with the store about what the
 * value is, and the reader would have no way to tell which one was the record.
 */
export function Badge({ tone = 'neutral', children, className }) {
	return <span className={cx('badge', `badge-${tone}`, className)}>{children}</span>;
}

/**
 * The relation inside a fact: "is keyed on", "stopped using", "powers".
 *
 * Always accent, always this shape, on every screen that draws a fact — the reading view, the
 * editor, the preview, the graph panel. A fact is the thing an agent acts on, and its verb being
 * the same object everywhere is what lets a reader recognise one at a glance in four contexts.
 *
 * `stale` is the editor's "no longer in the words" state and nothing else: a fact the prose stopped
 * supporting. It is warn-tinted rather than struck through, because it is still a live assertion
 * until somebody decides otherwise.
 */
export function RelationBadge({ stale = false, children }) {
	return (
		<span className={cx('badge', 'badge-relation', stale && 'badge-relation-stale')}>{children}</span>
	);
}

/** FILE / RUN / PR / SAID — what KIND of pointer a piece of evidence is, beside the pointer itself. */
export function EvidenceTag({ children }) {
	return <span className="badge badge-tag">{String(children).toUpperCase()}</span>;
}

/**
 * The position the ranked door gave a memory. `dimmed` is a result that is superseded — it was
 * still returned, and saying so is the point of showing the reader exactly what their agent got.
 */
export function RankBadge({ rank, dimmed = false }) {
	return <span className={cx('badge', 'badge-rank', dimmed && 'badge-rank-dimmed')}>{rank}</span>;
}

/**
 * A chip that reads back a choice the user made, with the control that undoes it.
 *
 * The DEFAULT TONE IS NEUTRAL, because most chips in this app read back a value from the vault —
 * a kind, a spelling, a source — and only a filter chip is the accent one. A default of accent
 * would make every literal on the screen look like something the reader had chosen.
 *
 * `onRemove` renders a real `<button>`, never a glyph on a clickable span. A chip is how a filtered
 * list explains why it is short, and taking one off is the fastest way to widen it — on a screen
 * whose list is navigated with j and k, that control has to be reachable from the keyboard.
 */
export function Chip({ tone = 'neutral', onRemove = null, removeLabel, children }) {
	return (
		<span className={cx('chip', tone !== 'accent' && `chip-${tone}`)}>
			{children}
			{onRemove ? (
				<button
					type="button"
					className="chip-remove"
					onClick={onRemove}
					aria-label={removeLabel ?? `Remove ${typeof children === 'string' ? children : 'this filter'}`}
				>
					<Close size={11} />
				</button>
			) : null}
		</span>
	);
}
