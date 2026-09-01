import * as RadixTabs from '@radix-ui/react-tabs';
import * as RadixToggleGroup from '@radix-ui/react-toggle-group';

import { cx } from './cx.mjs';

/**
 * Two switches that look similar and are not the same object.
 *
 * `Tabs` is N independent views of one thing, each of which may carry its own count — GraphEntry's
 * "Most connected / Recently mentioned / Possible duplicates 12 / Named once 799". The count is the
 * whole reason a reader picks one, so it is part of the control rather than a subtitle under it.
 *
 * `SegmentedControl` is ONE axis with two or three positions — GraphFocus's "Direct / Two steps".
 * It is drawn joined because the positions are steps along a single dial, and separate because
 * drawing it like the tabs above would say there were two independent views.
 */

export function Tabs({ value, onValueChange, children, className }) {
	return (
		<RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
			{children}
		</RadixTabs.Root>
	);
}

export function TabsList({ label, children, className }) {
	return (
		<RadixTabs.List aria-label={label} className={cx('tabs-list', className)}>
			{children}
		</RadixTabs.List>
	);
}

export function Tab({ value, count = null, tone = 'neutral', children }) {
	return (
		<RadixTabs.Trigger value={value} className="tab">
			<span>{children}</span>
			{count === null ? null : (
				<span className={cx('tab-count', tone === 'warn' && 'tab-count-warn')}>{count}</span>
			)}
		</RadixTabs.Trigger>
	);
}

export function TabPanel({ value, children, className }) {
	return (
		<RadixTabs.Content value={value} className={className}>
			{children}
		</RadixTabs.Content>
	);
}

/**
 * One axis, two or three positions.
 *
 * `type="single"` with no `null` value: this is a dial, and a dial with nothing selected is a state
 * the screen behind it cannot render. Radix would allow deselecting the active item; the handler
 * below refuses an empty value rather than letting the drawing go blank.
 */
export function SegmentedControl({ value, onValueChange, label, options, className }) {
	return (
		<RadixToggleGroup.Root
			type="single"
			value={value}
			onValueChange={(next) => {
				if (next) onValueChange(next);
			}}
			aria-label={label}
			className={cx('segmented', className)}
		>
			{options.map((option) => (
				<RadixToggleGroup.Item key={option.value} value={option.value} className="segmented-item">
					{option.label}
				</RadixToggleGroup.Item>
			))}
		</RadixToggleGroup.Root>
	);
}
