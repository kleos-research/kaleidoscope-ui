import * as RadixDialog from '@radix-ui/react-dialog';
import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import * as RadixPopover from '@radix-ui/react-popover';
import * as RadixTooltip from '@radix-ui/react-tooltip';

import { cx } from './cx.mjs';

/**
 * The four floating things, all four from Radix.
 *
 * WHY NOT HAND-ROLLED. This is the part of "can't we reuse something from outside?" that actually
 * costs a week to get right and is invisible when it is wrong: a focus trap that lets Tab escape, a
 * menu that does not return focus to the control that opened it, an overlay that does not restore
 * body scroll, a tooltip that opens on touch and never closes, `aria-expanded` on the wrong node.
 * Radix ships all of that, is MIT, and is a devDependency bundled at build — so the published
 * package's `dependencies` stays `{}` and the user downloads nothing extra.
 *
 * What is written here is paint and copy. If something below is trying to make an overlay BEHAVE,
 * it is in the wrong file.
 */

/* ------------------------------------------------------------------ dialog */

/**
 * A modal.
 *
 * `title` and `description` are separate arguments rather than children because Radix wires them to
 * `aria-labelledby` and `aria-describedby`, and a dialog whose heading is just a styled div is a
 * dialog a screen reader announces as "dialog". Every confirmation in this product is a decision
 * about somebody's memory, so it says what it is before it says what the buttons do.
 */
export function Dialog({
	open,
	onOpenChange,
	title,
	description = null,
	footer = null,
	wide = false,
	children,
	className,
}) {
	return (
		<RadixDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className="dialog-overlay" />
				<RadixDialog.Content className={cx('dialog-content', wide && 'dialog-wide', className)}>
					<RadixDialog.Title className="dialog-title">{title}</RadixDialog.Title>
					{description ? (
						<RadixDialog.Description className="dialog-description">
							{description}
						</RadixDialog.Description>
					) : (
						// Radix warns when a dialog has no description. An explicitly absent one is a
						// decision; a missing one is a console message nobody reads.
						<RadixDialog.Description className="sr-only">
							{typeof title === 'string' ? title : 'A dialog'}
						</RadixDialog.Description>
					)}
					{children}
					{footer ? <div className="dialog-footer">{footer}</div> : null}
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}

export const DialogClose = RadixDialog.Close;

/* ------------------------------------------------------------------ popover */

/**
 * A panel hung off a control: the vault's full path, "why these four", a facet's values.
 *
 * The rule for choosing this over a dialog: a popover holds something the reader can IGNORE and
 * carry on, a dialog holds something they must answer. Nothing that writes goes in a popover.
 */
export function Popover({ trigger, open, onOpenChange, align = 'start', children, className }) {
	return (
		<RadixPopover.Root open={open} onOpenChange={onOpenChange}>
			<RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					align={align}
					sideOffset={6}
					collisionPadding={12}
					className={cx('surface-float', 'popover-content', className)}
				>
					{children}
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

/* ------------------------------------------------------------------ dropdown menu */

/**
 * A list of ACTIONS. Not a filter, not a chooser — those are `Select` and `FilterPanel`.
 *
 * The "…" in the top bar and on a memory. It is where the actions that are not the one primary
 * button live, which is what stops a screen growing the row of five equal controls the owner said
 * was "not aligned correctly" with "not enough padding".
 */
export function DropdownMenu({ trigger, align = 'end', children, className }) {
	return (
		<RadixDropdown.Root>
			<RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
			<RadixDropdown.Portal>
				<RadixDropdown.Content
					align={align}
					sideOffset={6}
					collisionPadding={12}
					className={cx('surface-float', 'menu-content', className)}
				>
					{children}
				</RadixDropdown.Content>
			</RadixDropdown.Portal>
		</RadixDropdown.Root>
	);
}

export function MenuItem({ onSelect, disabled = false, hint = null, children }) {
	return (
		<RadixDropdown.Item className="menu-item" onSelect={onSelect} disabled={disabled}>
			<span>{children}</span>
			{hint ? <span className="item-count">{hint}</span> : null}
		</RadixDropdown.Item>
	);
}

export function MenuLabel({ children }) {
	return <RadixDropdown.Label className="menu-label">{children}</RadixDropdown.Label>;
}

export const MenuSeparator = () => <RadixDropdown.Separator className="menu-separator" />;

/* ------------------------------------------------------------------ tooltip */

/**
 * Mounted once, around the whole app. Radix needs a provider for the shared open/close delays that
 * stop a row of controls flickering tooltips as the pointer crosses it.
 */
export function TooltipProvider({ children }) {
	return (
		<RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
			{children}
		</RadixTooltip.Provider>
	);
}

/**
 * A tooltip may only ever REPEAT or AMPLIFY — never carry the only copy of something.
 *
 * "Every label must be self-evident or gone." A control whose meaning lives in a tooltip fails that
 * test on a touch screen, in a screen reader, and for anyone who does not hover. Where the last
 * design would have put an explanation in a tooltip, this one either renames the control or puts
 * the sentence on the page.
 */
export function Tooltip({ label, children, side = 'bottom' }) {
	return (
		<RadixTooltip.Root>
			<RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
			<RadixTooltip.Portal>
				<RadixTooltip.Content side={side} sideOffset={6} className="tooltip-content">
					{label}
					<RadixTooltip.Arrow className="tooltip-arrow" width={10} height={5} />
				</RadixTooltip.Content>
			</RadixTooltip.Portal>
		</RadixTooltip.Root>
	);
}
