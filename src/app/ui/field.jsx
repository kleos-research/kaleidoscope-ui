import { useId } from 'react';

import { cx } from './cx.mjs';
import { Search } from './icons.jsx';

/**
 * A labelled field, its control, and the sentence that says what the value does.
 *
 * THE NOTE IS NOT A TOOLTIP. Every explanatory sentence in EditValues is drawn on the page, under
 * the field it explains — "Left empty, a line matches every request", "This sentence is what finds
 * the thing later". The owner's complaint about the old design was information overload, and the
 * fix for that is deferring whole SECTIONS. It is not deferring the one sentence that stops a field
 * being filled in wrongly: a note on the field somebody is typing into is the moment it matters.
 */
export function Field({ label, note, tone = 'neutral', children, className }) {
	const id = useId();
	return (
		<div className={cx('field', className)}>
			{label ? (
				<label className="field-label" htmlFor={id}>
					{label}
				</label>
			) : null}
			{typeof children === 'function' ? children(id) : children}
			{note ? (
				<p className={cx('field-note', tone === 'warn' && 'field-note-warn')}>{note}</p>
			) : null}
		</div>
	);
}

export function Input({ className, ...rest }) {
	return <input className={cx('input', className)} {...rest} />;
}

export function Textarea({ prose = false, className, ...rest }) {
	return <textarea className={cx('textarea', prose && 'textarea-prose', className)} {...rest} />;
}

/**
 * The memory's title, which spans both panes of the editor because it belongs to the memory rather
 * than to a column. Serif and underlined rather than boxed: it is the first line of a document.
 */
export function TitleInput({ className, ...rest }) {
	return <input className={cx('input', 'input-title', className)} {...rest} />;
}

/**
 * A field whose emptiness is the value: "every branch", "every file", "still true".
 *
 * AN OMITTED SCOPE AXIS MATCHES EVERY REQUEST, so a blank box reads as "narrower" and means
 * "wider" — the single most likely misreading in the editor. This renders the phrase, dashed, as a
 * button that opens the real control. It is a component rather than a convention because the last
 * design spelled the same idea four ways.
 */
export function UnsetField({ phrase, onSet = null, className }) {
	if (!onSet) {
		return <div className={cx('input', 'input-unset', className)}>{phrase}</div>;
	}
	return (
		<button type="button" className={cx('input', 'input-unset', className)} onClick={onSet}>
			{phrase}
		</button>
	);
}

/**
 * A FIND BOX THAT NARROWS WHAT IS ALREADY ON THE PAGE. It issues no request, ever.
 *
 * GraphEntry draws one beside its heading and Search draws a much larger one in the middle of its
 * own screen, and the difference between them is the whole of this app's search story: this control
 * filters rows the browser already holds, and the other one can reach the engine's ranked door,
 * which writes a permanent row into the vault it is reading. Two jobs, two controls, two shapes —
 * a single box that sometimes did the second would make every keystroke a write.
 *
 * `type="search"` so a browser offers the clear affordance its user already knows.
 */
export function FindInput({ value, onChange, placeholder = 'Find', label = null, width = null }) {
	return (
		<div className="find-input" style={width ? { width } : undefined}>
			<Search size={14} className="icon find-input-icon" />
			<input
				className="find-input-control"
				type="search"
				value={value}
				placeholder={placeholder}
				aria-label={label ?? placeholder}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

/**
 * A MEMORY'S WORDS, BEING WRITTEN — a textarea that reads as the document it will become.
 *
 * `EditB` draws the left pane as paragraphs with a caret in them, not as a form control. A textarea
 * cannot draw a paragraph gap, and a rich editor is a dependency this package has decided not to
 * carry, so this is the shape between the two: the textarea is still the thing being typed into —
 * every key, the caret, the selection, the spellchecker and undo are the browser's own — and its
 * text is transparent. Under it, in the same face at the same size with the same padding, the same
 * words are drawn again with the characters that are Markdown syntax dimmed, so `**`, backticks and
 * `- ` read as marks on a page rather than as the page. Prose reads as prose; the mechanism stays
 * visible, which is what a writer who is about to save a Markdown document needs.
 *
 * THE TWO LAYERS SHARE ONE GRID CELL, and that is what keeps them in register. The drawn copy sizes
 * the cell, so the field is as tall as its words and the pane scrolls rather than the control; the
 * textarea is stretched to the same cell and clips nothing. Every property that moves a glyph —
 * family, size, leading, padding, wrapping — is set once on the field and inherited by both, and
 * the trailing space on the drawn copy is what gives a final empty line its height.
 *
 * `segments` is the caller's reading of which characters are syntax: `[{ text, mark }]` whose text
 * concatenates to exactly the value. This component knows nothing about Markdown; it draws what it
 * is handed, in two strengths.
 */
export function ProseField({ value, segments, className, ...rest }) {
	return (
		<div className={cx('prose-field', className)}>
			<textarea className="prose-field-input" value={value} rows={1} {...rest} />
			<div className="prose-field-ink" aria-hidden="true">
				{segments.map((segment, index) =>
					segment.mark ? (
						<span key={index} className="md-mark">
							{segment.text}
						</span>
					) : (
						segment.text
					),
				)}{' '}
			</div>
		</div>
	);
}
