import { cx } from './cx.mjs';

/**
 * A real `<table>`, because this one is a table.
 *
 * The entity list in GraphEntry is a grid of five columns a reader scans DOWN — name, kind, how
 * connected, in how many memories, and what to do about it. A stack of flex rows would look
 * identical and would be announced by a screen reader as a list of unrelated sentences, would not
 * carry column headers into each cell, and could not be sorted by a header that is a real
 * `<th aria-sort>`.
 *
 * `sticky` headers are on by default: the whole point of this surface is that it is long.
 */

export function Table({ label, children, className }) {
	return (
		<div className={cx('table-frame', className)}>
			<div className="scroll-x">
				<table className="table" aria-label={label}>
					{children}
				</table>
			</div>
		</div>
	);
}

/**
 * A header cell that can order the table.
 *
 * `aria-sort` is set from the same value that draws the arrow, so the announced state and the drawn
 * state cannot disagree. A sortable header with no `aria-sort` is the commonest way a data table is
 * unusable without a screen.
 */
export function Th({ sort = null, onSort = null, numeric = false, width, children }) {
	const label = sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none';
	return (
		<th
			scope="col"
			className={cx(numeric && 'table-numeric')}
			style={width ? { width } : undefined}
			aria-sort={onSort ? label : undefined}
		>
			{onSort ? (
				<button type="button" className="btn btn-quiet" onClick={onSort}>
					{children}
					{sort === 'asc' ? ' ↑' : sort === 'desc' ? ' ↓' : ''}
				</button>
			) : (
				children
			)}
		</th>
	);
}

/**
 * A row.
 *
 * `attention` is a tone, not a colour: it is what a row wearing a "look at this" state gets, and it
 * is drawn as a barely-tinted background rather than a border or an icon so that a table with
 * twelve of them still reads as one table.
 */
export function Tr({ selected = false, attention = false, onClick = null, children, ...rest }) {
	return (
		<tr
			data-selected={selected ? 'true' : undefined}
			data-attention={attention ? 'true' : undefined}
			data-clickable={onClick ? 'true' : undefined}
			onClick={onClick ?? undefined}
			{...rest}
		>
			{children}
		</tr>
	);
}

/** `subject` marks the one column a reader scans; everything else is support and reads quieter. */
export function Td({ subject = false, numeric = false, children, ...rest }) {
	return (
		<td className={cx(subject && 'table-subject', numeric && 'table-numeric')} {...rest}>
			{children}
		</td>
	);
}

/**
 * How connected a name is: discrete ticks and the number, NOT a sparkline.
 *
 * A sparkline needs range. Degree in a vault like this runs from 1 to about 10 and roughly three
 * quarters of the rows are the constant 1 — a sparkline of that is a flat line for most of the
 * table, dressed up as a trend. Ticks say how many, stop there, and stay honest about the
 * resolution they have.
 *
 * `provisional` draws the extra ticks a MERGE WOULD ADD in the warn tint. That is the row that says
 * "retry budget — also 'the retry budget'": the reader is looking at 4 real connections and 2 that
 * are one identity decision away, and the whole argument for merging is visible in the bar.
 */
export function DegreeBar({ count, provisional = 0, max = 10 }) {
	const solid = Math.max(0, Math.min(count, max));
	const extra = Math.max(0, Math.min(provisional, max - solid));
	const label =
		extra > 0
			? `${count} connections, and ${extra} more if this name were merged`
			: `${count} connections`;
	return (
		<span className="degree" title={label}>
			<span className="degree-ticks" aria-hidden="true">
				{Array.from({ length: solid }, (_, index) => (
					<span key={`s${index}`} className="degree-tick" />
				))}
				{Array.from({ length: extra }, (_, index) => (
					<span key={`p${index}`} className="degree-tick degree-tick-provisional" />
				))}
			</span>
			<span className={cx('item-count', extra > 0 && 'warn-text')}>
				{extra > 0 ? `${solid} + ${extra}` : solid}
			</span>
			<span className="sr-only">{label}</span>
		</span>
	);
}
