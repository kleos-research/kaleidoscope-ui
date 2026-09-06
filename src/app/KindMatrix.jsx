import { useMemo, useState } from 'react';

import { cellShade, foldKinds, kindMatrix, kindMatrixReading } from './kind-matrix.mjs';

/** How many writer-added kinds get a row of their own before the rest fold into one. */
const KINDS_SHOWN = 8;

/**
 * KIND BY KIND — a heatmap of statements between the kinds of things this vault names.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS VIEW EXISTS, AND WHY IT IS NOT A DESTINATION
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The entity kind is an open registry: the engine names a handful, accepts any new value, and a
 * working vault accumulates several times as many as the schema lists. That drift is a write-path
 * quality signal — it says the agents writing memories are coining kinds rather than reusing them
 * — and it is invisible on every other screen, where a kind is one grey word beside a name. Here
 * the kinds the schema names sit on one side of a rule and everything a writer introduced sits on
 * the other, and the size of the second group IS the finding.
 *
 * It is reached from the names screen and is not in the top bar, because it is a diagnostic a
 * reader opens occasionally rather than a place they go. The one question it answers directly —
 * what sorts of things connect to what sorts — is the second thing it is for.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS WRITTEN DOWN HERE: NOTHING
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The rows are the kinds this vault declares, read off the loaded memories. Which of them the
 * schema names is decided against the list parsed out of the engine's own printed contract at
 * launch. This file holds no kind name, no count, and no colour: the ramp is two tokens mixed by
 * the browser, so it follows the theme and never names a hex value.
 *
 * ONE HUE, LIGHT TO DARK. The cell encodes a magnitude and nothing else, so it takes a sequential
 * ramp: more statements is darker, always, and there is no second colour to decode. Identity is
 * carried by the row and column labels, which is where text belongs.
 */
export function KindMatrix({ graph, schemaKinds = null }) {
	const whole = useMemo(() => kindMatrix(graph, { schemaKinds }), [graph, schemaKinds]);
	/*
	  THE LONG TAIL IS FOLDED UNTIL ASKED FOR. The schema's kinds and the eight most-used writer-added
	  ones are rows; the other hundred-odd are one row and one column whose label says how many, and
	  a press opens them. See `foldKinds`.
	*/
	const [unfolded, setUnfolded] = useState(false);
	const matrix = useMemo(
		() => foldKinds(whole, { keepBeyond: unfolded ? Number.POSITIVE_INFINITY : KINDS_SHOWN }),
		[whole, unfolded],
	);
	const [hover, setHover] = useState(null);

	const labelOf = (entry) =>
		entry.fold ? `${matrix.folded.toLocaleString()} more kinds` : entry.kind === null ? 'no kind declared' : entry.kind;

	// Where a group boundary falls: the index of the first row/column of each new group.
	const groupStarts = new Set();
	matrix.kinds.forEach((entry, at) => {
		if (at > 0 && entry.group !== matrix.kinds[at - 1].group) groupStarts.add(at);
	});

	const readout = hover
		? readCell(matrix, hover.row, hover.column, labelOf)
		: 'Point at a cell to read it. The row is the statement’s subject; the column is its object.';

	return (
		<div className="kk">
			{/*
			  WIDE CONTENT SCROLLS INSIDE ITSELF. Fifty kinds at a legible cell pitch is wider than the
			  page column, and the page body must never be what scrolls sideways.
			*/}
			<div className="scroll-x">
				<table className="kk-table" aria-label="Statements between kinds, subject down and object across">
					<thead>
						<tr>
							<th scope="col" className="kk-corner">
								<span className="sr-only">Subject kind down, object kind across</span>
							</th>
							{matrix.kinds.map((entry, column) => (
								<ColumnHead
									key={column}
									entry={entry}
									label={labelOf(entry)}
									gapBefore={groupStarts.has(column)}
								/>
							))}
							<th scope="col" className="kk-total-head">
								statements naming it
							</th>
						</tr>
					</thead>
					<tbody>
						{matrix.kinds.map((entry, row) => (
							<Row
								key={row}
								matrix={matrix}
								row={row}
								label={labelOf(entry)}
												groupStarts={groupStarts}
								gapBefore={groupStarts.has(row)}
								hover={hover}
								setHover={setHover}
							/>
						))}
					</tbody>
				</table>
			</div>

			<p className="kk-readout" aria-live="polite">
				{readout}
			</p>

			{/*
			  THE SENTENCE UNDER THE PICTURE, composed beside the numbers it quotes — see
			  `kindMatrixReading`. It is the finding this view exists for, in words a reader who
			  never decodes the grid still gets.
			*/}
			<p className="overview-caption">
				{kindMatrixReading(whole)}
				{matrix.folded > 0 || unfolded ? (
					<>
						{' '}
						<button type="button" className="kk-fold" onClick={() => setUnfolded(!unfolded)}>
							{unfolded
								? `Fold the least-used kinds back into one row`
								: `Open the ${matrix.folded.toLocaleString()} folded kinds`}
						</button>
					</>
				) : null}
			</p>

			<div className="kk-key">
				<span className="kk-key-ramp" aria-hidden="true">
					{[0.2, 0.4, 0.6, 0.8, 1].map((step) => (
						<span key={step} className="kk-swatch" style={{ background: fill(step) }} />
					))}
				</span>
				<span>darker = more statements, from the row’s kind to the column’s kind</span>
				{matrix.schemaKnown && matrix.groups.schema > 0 && matrix.groups.beyond > 0 ? (
					<>
						<span className="overview-legend-sep" aria-hidden="true">
							|
						</span>
						<span>
							<span className="kk-key-rule" aria-hidden="true" /> before the rule, the kinds the schema
							names; after it, the kinds a writer added
						</span>
					</>
				) : null}
				{matrix.groups.undeclared > 0 ? (
					<>
						<span className="overview-legend-sep" aria-hidden="true">
							|
						</span>
						<span>
							<span className="kk-label-undeclared">no kind declared</span> is the names no memory
							declared as anything
						</span>
					</>
				) : null}
			</div>
		</div>
	);
}

/**
 * The colour of a cell: two theme tokens, mixed by the browser at the cell's shade.
 *
 * `color-mix` rather than a computed hex, so the ramp reads the same two tokens the rest of the
 * accent does and follows them into dark mode — where the light end and the dark end swap, which
 * is what a sequential ramp on a dark surface is supposed to do.
 */
const fill = (shade) =>
	`color-mix(in oklab, var(--accent-soft), var(--accent-ink) ${Math.round(shade * 100)}%)`;

function readCell(matrix, row, column, labelOf) {
	const count = matrix.counts[row][column];
	const from = labelOf(matrix.kinds[row]);
	const to = labelOf(matrix.kinds[column]);
	if (count === 0) return `No statement runs from ${from} to ${to}.`;
	return `${count.toLocaleString()} ${count === 1 ? 'statement runs' : 'statements run'} from ${from} to ${to}.`;
}

function ColumnHead({ entry, label, gapBefore }) {
	return (
		<>
			{gapBefore ? <th className="kk-gap" aria-hidden="true" /> : null}
			<th scope="col" className="kk-col">
				<span
					className={entry.kind === null && !entry.fold ? 'kk-col-text kk-label-undeclared' : 'kk-col-text'}
					title={label}
				>
					{label}
				</span>
			</th>
		</>
	);
}

function Row({ matrix, row, label, groupStarts, gapBefore, hover, setHover }) {
	const entry = matrix.kinds[row];
	const cells = matrix.counts[row];
	const label_ = (kind) =>
		kind.fold ? `${matrix.folded.toLocaleString()} more kinds` : kind.kind === null ? 'no kind declared' : kind.kind;
	return (
		<>
			{gapBefore ? (
				<tr className="kk-gap-row" aria-hidden="true">
					<td />
					{matrix.kinds.map((_, column) => (
						<Cell key={column} spacerBefore={groupStarts.has(column)} />
					))}
					<td />
				</tr>
			) : null}
			<tr>
				<th
					scope="row"
					className={entry.kind === null && !entry.fold ? 'kk-row kk-label-undeclared' : 'kk-row'}
					title={label}
				>
					{label}
				</th>
				{cells.map((count, column) => {
					const shade = cellShade(count, matrix.max);
					const lit = hover && hover.row === row && hover.column === column;
					return (
						<Cell key={column} spacerBefore={groupStarts.has(column)}>
							<td
								className="kk-cell"
								data-empty={count === 0 ? 'true' : undefined}
								data-lit={lit ? 'true' : undefined}
								style={count > 0 ? { background: fill(shade) } : undefined}
								/*
								  The mark is the hit target, and the reading is repeated in a line under the
								  grid rather than in a floating tip: a stable line can be read without chasing
								  it, and it is the same line the keyboard reaches by tabbing to a cell.

								  THE CELL HAS NO CHILDREN. Its whole reading is the `aria-label`, so a hidden
								  span naming the column would say nothing the label does not — and on a real
								  vault it would be fifteen thousand absolutely-positioned elements whose
								  containing block is the page, not the scroller, so the far columns widened the
								  document past the window while the table itself sat clipped inside its box.
								*/
								tabIndex={count > 0 ? 0 : -1}
								aria-label={readCell(matrix, row, column, label_)}
								onPointerEnter={() => setHover({ row, column })}
								onPointerLeave={() => setHover(null)}
								onFocus={() => setHover({ row, column })}
								onBlur={() => setHover(null)}
							/>
						</Cell>
					);
				})}
				<td className="kk-total">{entry.total.toLocaleString()}</td>
			</tr>
		</>
	);
}

/** A cell, with the spacer that draws the group rule in front of it when it opens a new group. */
function Cell({ spacerBefore, children = null }) {
	return (
		<>
			{spacerBefore ? <td className="kk-gap" aria-hidden="true" /> : null}
			{children ?? <td className="kk-gap-cell" />}
		</>
	);
}
