import * as RadixCollapsible from '@radix-ui/react-collapsible';
import { useState } from 'react';

import { cx } from './cx.mjs';
import { ChevronRight } from './icons.jsx';

/**
 * "Named things 3." "Evidence 1." "History and identifiers — 2 versions."
 *
 * THE MOST REPEATED OBJECT IN THE APPROVED DESIGN, and the direct answer to "too much information
 * overload on any page". The rule the mockups apply everywhere: a screen shows its first and second
 * thing; everything else becomes one of these rows — closed, one line tall, carrying its own count.
 *
 * THE COUNT IS WHY IT WORKS. A closed row that says only "Evidence" asks the reader to open it to
 * find out whether opening it was worth it. A row that says "Evidence · 4" has already answered the
 * question for most readers, which is what turns hiding something into deferring it. Honesty about
 * a property and displaying it permanently are different requirements; this is the shape of the
 * difference.
 *
 * A ROW WITH A COUNT OF ZERO IS STILL RENDERED. If it vanished, "no evidence was recorded" would be
 * indistinguishable from "evidence I have not scrolled to", and the second is the reading a person
 * defaults to.
 */

/** The container. Its only job is the closing hairline under the last row. */
export function DetailRows({ children, className }) {
	return <div className={cx('rows', className)}>{children}</div>;
}

/**
 * @param label      what is inside. A noun phrase a reader recognises without being told.
 * @param count      a number, or a phrase like "2 versions". Rendered as given.
 * @param tone       'warn' for a count that is the reason to open it — "1 memory" beside "corrects".
 * @param onOpen     called the first time it opens, for a section whose contents are fetched.
 * @param children   rendered only while open, so a closed row costs nothing to have on the page.
 */
export function DetailRow({
	label,
	count = null,
	tone = 'neutral',
	defaultOpen = false,
	onOpen = null,
	children,
}) {
	const [open, setOpen] = useState(defaultOpen);
	const [opened, setOpened] = useState(defaultOpen);

	return (
		<RadixCollapsible.Root
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// Fired once. A section that re-fetched on every open would make a reader's second
				// look cost what their first one did.
				if (next && !opened) {
					setOpened(true);
					onOpen?.();
				}
			}}
		>
			<RadixCollapsible.Trigger className="row-trigger">
				<span className="row-label">
					<ChevronRight size={12} className="icon row-chevron" />
					{label}
				</span>
				{count === null ? null : (
					<span className={cx('row-count', tone === 'warn' && 'row-count-warn')}>{count}</span>
				)}
			</RadixCollapsible.Trigger>
			<RadixCollapsible.Content className="row-body">
				{opened ? children : null}
			</RadixCollapsible.Content>
		</RadixCollapsible.Root>
	);
}
