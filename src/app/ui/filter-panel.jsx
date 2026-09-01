import * as RadixCheckbox from '@radix-ui/react-checkbox';
import * as RadixCollapsible from '@radix-ui/react-collapsible';
import { useMemo, useState } from 'react';

import { Chip } from './badge.jsx';
import { cx } from './cx.mjs';
import { Check, ChevronDown, ChevronRight, Search } from './icons.jsx';

/**
 * BrowseScale's "Narrow to" column.
 *
 * THIS IS THE SURFACE THE OWNER REJECTED, REBUILT. The complaint, verbatim: "TYPE, showing every
 * value at once — why is this? It should be a dropdown. Then you can select and deselect instead of
 * everything seen at once." And: "I had to scroll for ten minutes for each."
 *
 * Five things follow, and each is a rule rather than a style:
 *
 *   1. A FACET IS CLOSED UNTIL IT IS USED. The column is a list of one-line rows, not three columns
 *      of values. Closed, the whole set of facets fits with no scrolling at all.
 *   2. A FACET THAT IS DOING SOMETHING SAYS SO WITHOUT BEING OPENED. It carries a count badge and
 *      its chosen values sit under it as removable chips. The column reads back its own state.
 *   3. EVERY VALUE CARRIES ITS COUNT. Datasette's rule: a facet value without a count is a guess
 *      about whether clicking it does anything. A value whose count is zero is not offered.
 *   4. THE FOOT SAYS HOW MUCH IS LEFT AND HOW TO PUT IT BACK. "71 of 612 shown" plus one control.
 *      A filtered list that cannot explain its own shortness is the reason people reload the page.
 *   5. A FACET WHOSE LABEL NEEDS EXPLAINING EXPLAINS ITSELF WHERE IT IS OPENED. "Applies to branch.
 *      I don't know why we have it, and I don't even know how this works." A `note` is one sentence
 *      inside the open panel — reachable at the moment it matters, resident nowhere.
 *
 * NOTHING HERE FETCHES. Facet values and counts are arithmetic over a payload the browser already
 * has, which is why no keystroke in this column can reach the engine.
 */

export function FilterPanel({
	heading = 'Narrow to',
	shown,
	total,
	onClear,
	clearLabel = 'Clear the filters',
	children,
	className,
}) {
	const filtered = shown !== total;
	return (
		<aside className={cx('filters', className)} aria-label={heading}>
			<div className="eyebrow filters-heading">{heading}</div>
			{children}
			<div className="filters-foot">
				<div>
					<strong>{shown.toLocaleString()}</strong> of {total.toLocaleString()} shown
				</div>
				{filtered && onClear ? (
					<button type="button" className="filters-clear" onClick={onClear}>
						{clearLabel}
					</button>
				) : null}
			</div>
		</aside>
	);
}

/** How many values a facet may list before it grows a box to find one in. */
const SEARCHABLE_AT = 12;

/**
 * One facet.
 *
 * @param label      what it narrows by. Must be evident on its own: "Kind", "When", "Still true",
 *                   "Mentions", "Branch or file". Every one of these replaced a phrase the owner
 *                   said they did not understand.
 * @param values     [{ value, count, label? }] computed from the loaded records. Never a list this
 *                   repository wrote down.
 * @param selected   the chosen values.
 * @param onToggle   (value) => void
 * @param onClear    () => void, for this facet alone.
 * @param note       one sentence, shown inside the open panel, for a label a reader may not know.
 * @param empty      what to say when there is nothing to narrow by. A facet with an empty list
 *                   reads as a broken control, and worse, teaches the reader something false about
 *                   their vault.
 * @param findLabel  placeholder for the find box a long value list grows. The box narrows the
 *                   VALUES IN THIS PANEL and nothing else; it issues no request.
 */
export function Facet({
	label,
	values = [],
	selected = [],
	onToggle,
	onClear = null,
	note = null,
	empty = null,
	findLabel = null,
	children,
}) {
	const chosen = new Set(selected);
	const [open, setOpen] = useState(false);
	const [find, setFind] = useState('');
	const active = chosen.size > 0;

	// A facet with two thousand declared names in it is not a list, it is a wall. The box narrows
	// the values in memory — the counts beside them are already computed — so typing here is
	// arithmetic over an array and reaches nothing at all.
	const searchable = findLabel !== null && values.length > SEARCHABLE_AT;
	const visible = useMemo(() => {
		const needle = find.trim().toLowerCase();
		if (!searchable || needle === '') return values;
		return values.filter((entry) => String(entry.label ?? entry.value).toLowerCase().includes(needle));
	}, [values, find, searchable]);

	// The chip reads back what the reader CHOSE, which is the label they clicked — not the key this
	// app encoded it as. A chip reading "m-2026-7" or "artifact src/pay.mjs" is a chip that cannot
	// be checked against the list it is shortening.
	const wordFor = (value) => values.find((entry) => entry.value === value)?.label ?? value;

	return (
		<RadixCollapsible.Root open={open} onOpenChange={setOpen}>
			<RadixCollapsible.Trigger className="filter-trigger" data-active={active ? 'true' : undefined}>
				<span>{label}</span>
				<span className="filter-trigger-right">
					{active ? <span className="filter-badge">{chosen.size}</span> : null}
					{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
				</span>
			</RadixCollapsible.Trigger>

			{/*
			  THE CHIPS SIT OUTSIDE THE COLLAPSIBLE, so a closed facet still reads back what it is
			  doing. A facet whose state is only visible when opened is a filter a reader forgets is
			  on, and then the list is mysteriously short.
			*/}
			{active ? (
				<div className="filter-chips">
					{selected.map((value) => (
						<Chip
							key={value}
							tone="accent"
							onRemove={() => onToggle(value)}
							removeLabel={`Stop narrowing to ${wordFor(value)}`}
						>
							{wordFor(value)}
						</Chip>
					))}
				</div>
			) : null}

			<RadixCollapsible.Content>
				{note ? <p className="filter-note">{note}</p> : null}
				{/*
				  ABOVE the value list rather than inside it. `.filter-values` is itself a scroll
				  region — that is what stops a two-thousand-name facet pushing the column's own foot
				  off the screen — so a box drawn inside it scrolls away from the reader who is using
				  it, on the one facet long enough to need it.
				*/}
				{children ? null : searchable ? (
					<div className="filter-find">
						<Search size={12} className="icon" />
						<input
							type="search"
							className="filter-find-input"
							value={find}
							placeholder={findLabel}
							aria-label={findLabel}
							autoComplete="off"
							spellCheck="false"
							onChange={(event) => setFind(event.target.value)}
						/>
					</div>
				) : null}
				{children ?? (
					<div className="filter-values">
						{values.length === 0 ? (
							<p className="filter-empty">{empty ?? 'Nothing here carries this.'}</p>
						) : null}
						{values.length > 0 && visible.length === 0 ? (
							<p className="filter-empty">No value here contains those words.</p>
						) : null}

						{visible.map((entry) => (
							<label key={entry.value} className="filter-value">
								<RadixCheckbox.Root
									className="checkbox"
									checked={chosen.has(entry.value)}
									onCheckedChange={() => onToggle(entry.value)}
								>
									<RadixCheckbox.Indicator>
										<Check size={10} />
									</RadixCheckbox.Indicator>
								</RadixCheckbox.Root>
								<span className="filter-value-label">{entry.label ?? entry.value}</span>
								<span className="filter-value-count">{entry.count}</span>
							</label>
						))}

						{active && onClear ? (
							<button type="button" className="btn btn-quiet" onClick={onClear}>
								Clear {label.toLowerCase()}
							</button>
						) : null}
					</div>
				)}
			</RadixCollapsible.Content>
		</RadixCollapsible.Root>
	);
}
