import * as RadixSelect from '@radix-ui/react-select';

import { cx } from './cx.mjs';
import { ChevronDown, ChevronRight } from './icons.jsx';

/**
 * A one-of-N choice over a CLOSED set — a set the engine publishes and that cannot be added to
 * here.
 *
 * The distinction from `Combobox` is the whole reason both exist. A `Select` refuses a value it was
 * not given; a `Combobox` accepts one. Entity kinds, relation names and memory types are OPEN
 * registries: the vocabulary grows, and this app must never be the thing that stops it. So those
 * get a combobox, and this is for the genuinely closed choices — a sort order, a lens, a project.
 *
 * Radix owns the behaviour: typeahead, the roving focus, escape, the scroll buttons, and the
 * `aria-activedescendant` bookkeeping that makes a custom listbox announce itself like a native
 * one. Nothing below re-implements any of that.
 */
export function Select({
	value,
	onValueChange,
	placeholder = 'Choose',
	disabled = false,
	label,
	children,
	className,
	triggerClassName,
}) {
	return (
		<RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
			<RadixSelect.Trigger
				className={cx('select-trigger', triggerClassName)}
				aria-label={label}
				data-placeholder={value === undefined || value === null ? '' : undefined}
			>
				<RadixSelect.Value placeholder={placeholder} />
				<RadixSelect.Icon className="select-icon">
					<ChevronDown size={11} />
				</RadixSelect.Icon>
			</RadixSelect.Trigger>
			<RadixSelect.Portal>
				<RadixSelect.Content
					position="popper"
					sideOffset={4}
					className={cx('surface-float', 'select-content', className)}
				>
					<RadixSelect.ScrollUpButton className="select-scroll">
						<ChevronRight size={12} style={{ transform: 'rotate(-90deg)' }} />
					</RadixSelect.ScrollUpButton>
					<RadixSelect.Viewport className="select-viewport">{children}</RadixSelect.Viewport>
					<RadixSelect.ScrollDownButton className="select-scroll">
						<ChevronDown size={12} />
					</RadixSelect.ScrollDownButton>
				</RadixSelect.Content>
			</RadixSelect.Portal>
		</RadixSelect.Root>
	);
}

/**
 * One option, with the count of how many memories already use it.
 *
 * `count` is not decoration and it is not optional in spirit: a value list without counts is a list
 * of guesses about whether choosing one is worth anything. Datasette's facets are the model, and
 * the mockups carry it through — "already in 4 memories", "1 memory", "612".
 */
export function SelectItem({ value, count = null, children, disabled = false }) {
	return (
		<RadixSelect.Item value={value} disabled={disabled} className="select-item">
			<RadixSelect.ItemText>{children}</RadixSelect.ItemText>
			{count === null ? null : <span className="item-count">{count}</span>}
		</RadixSelect.Item>
	);
}

export function SelectGroup({ label, children }) {
	return (
		<RadixSelect.Group>
			{label ? <RadixSelect.Label className="select-label">{label}</RadixSelect.Label> : null}
			{children}
		</RadixSelect.Group>
	);
}

export const SelectSeparator = () => <RadixSelect.Separator className="menu-separator" />;
