import * as RadixCheckbox from '@radix-ui/react-checkbox';

import { cx } from './cx.mjs';
import { Check } from './icons.jsx';

/**
 * THE TWO CONTROLS A REVIEW SCREEN IS MADE OF: tick this one, and keep that spelling.
 *
 * They are here rather than inlined into the screen that uses them because the cluster review needs
 * both of them once per row, forty rows down a table, and a control whose markup is repeated forty
 * times is a control that drifts. The filter rail grew its own checkbox before this file existed;
 * that one is Radix too and wears the same class, so the two are the same object drawn twice rather
 * than two objects — which is the distinction the previous design lost.
 */

/**
 * A tick.
 *
 * `label` is REQUIRED and is not optional in spirit either. A bare checkbox in a table row is
 * announced as "checkbox, not checked" and the row it belongs to is announced as nothing at all, so
 * every one of these carries the sentence a person would say — usually naming the thing being
 * ticked, because forty rows of "select" tell a reader which control they are on and nothing else.
 */
export function Checkbox({ checked, onCheckedChange, label, disabled = false, className }) {
	return (
		<RadixCheckbox.Root
			className={cx('checkbox', className)}
			checked={checked}
			disabled={disabled}
			onCheckedChange={onCheckedChange}
			aria-label={label}
		>
			<RadixCheckbox.Indicator>
				<Check size={10} />
			</RadixCheckbox.Indicator>
		</RadixCheckbox.Root>
	);
}

/**
 * A choice among the spellings of one name — and it is a NATIVE RADIO GROUP on purpose.
 *
 * Radix has a radio primitive and this does not use it. The choice here is one of two to five short
 * strings, rendered as a row of labels that must stay readable when the strings are long, and the
 * platform control already carries roving arrow-key navigation, the group semantics, and the
 * grouping a screen reader announces as "1 of 3". Reaching for a library part to re-implement that
 * would add a dependency to the bundle in exchange for behaviour the browser ships.
 *
 * `name` must be unique per group on the page — the caller passes the cluster's key, because two
 * groups sharing a name are one group and the second cluster's choice would silently clear the
 * first's.
 *
 * @param options  [{ value, label, note }] — `note` is the evidence beside the option, and it is
 *                 beside it rather than in a tooltip because choosing a spelling is also choosing
 *                 a kind, and that is the fact the choice actually turns on.
 */
export function ChoiceRow({ name, value, onChange, options, legend, className }) {
	return (
		<fieldset className={cx('choice', className)}>
			<legend className="sr-only">{legend}</legend>
			{options.map((option) => (
				<label
					key={option.value}
					className="choice-option"
					data-chosen={option.value === value ? 'true' : undefined}
				>
					<input
						type="radio"
						className="choice-input"
						name={name}
						value={option.value}
						checked={option.value === value}
						onChange={() => onChange(option.value)}
					/>
					<span className="choice-label">{option.label ?? option.value}</span>
					{option.note ? <span className="choice-note">{option.note}</span> : null}
				</label>
			))}
		</fieldset>
	);
}
