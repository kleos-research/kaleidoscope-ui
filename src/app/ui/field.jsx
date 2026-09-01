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
