import { useMemo, useRef, useState } from 'react';

import { hubIndex, hubWindow } from './hub-model.mjs';

/**
 * The claims behind a collapsed hub, as a virtualized list.
 *
 * **This is the load-bearing half of the collapse, and it is a list on purpose.** A hundred
 * thousand items is a list; a node-link diagram is not, and no amount of layout tuning changes
 * that. The picture stops trying to show the mass, the box says exactly how much of it there is,
 * and this is where the reader goes to see it — grouped by relationship name, every row linking to
 * the memory that asserts it, so nothing inside a collapse is unreachable.
 *
 * VIRTUALIZED means the DOM holds a window and not the list. A hundred thousand rows in the
 * document is somewhere between several seconds of layout and a tab that stops responding, and the
 * failure looks exactly like the black disc this whole programme exists to prevent — a user who
 * clicked something and got a hang concludes the product is broken, whatever the canvas is doing.
 * So the scroller is one tall spacer, one absolutely-positioned window of rows, and an offset
 * computed from `scrollTop`. `hubWindow` is a pure function over a prebuilt index, which is what
 * makes the slicing checkable in a test rather than by scrolling.
 */

/** Fixed, because a virtualized list needs to know where row N is without measuring rows 0..N-1. */
const ROW_HEIGHT = 30;

/** How many rows are kept above and below the visible window, so a fast scroll does not flash. */
const OVERSCAN = 8;

/** The height of the scroller, in rows. Held here so the spacer and the window agree. */
const VIEWPORT_ROWS = 16;

export function HubList({ graph, surface, onOpen, onClose }) {
	// Built once per surface. On the largest case this is a single pass over a hundred thousand
	// edges — measured at a few milliseconds — and it must not be rebuilt per scroll event.
	const index = useMemo(() => hubIndex(graph, surface), [graph, surface]);
	const [offset, setOffset] = useState(0);
	const scroller = useRef(null);

	const start = Math.max(0, Math.floor(offset / ROW_HEIGHT) - OVERSCAN);
	const window = hubWindow(index, start, VIEWPORT_ROWS + OVERSCAN * 2);

	return (
		<section className="hub-list">
			<div className="hub-list-head">
				<h3>
					Everything that names “{surface}”
					<span className="graph-tag-count">{index.total.toLocaleString()}</span>
				</h3>
				<button type="button" className="button button-quiet" onClick={onClose}>
					Close
				</button>
			</div>

			<p className="graph-note">
				Grouped by relationship name, commonest first. This list holds every one of them — the
				drawing does not, and the box on the canvas says so. Every row opens the memory that wrote
				it.
			</p>

			<ul className="hub-list-groups">
				{index.byPredicate.slice(0, 12).map((group) => (
					<li key={group.predicate ?? '(none)'}>
						<button
							type="button"
							className="linklike"
							onClick={() => {
								// Jumping to a group is a scroll, not a filter. A filter would make the
								// count on the box stop matching what the list is showing, which is the one
								// thing this list exists to guarantee.
								setOffset(group.offset * ROW_HEIGHT);
								if (scroller.current) scroller.current.scrollTop = group.offset * ROW_HEIGHT;
							}}
						>
							{group.predicate ?? 'no relationship name'}
						</button>
						<span className="graph-tag-count">{group.count.toLocaleString()}</span>
					</li>
				))}
				{index.byPredicate.length > 12 ? (
					<li className="graph-note">…and {index.byPredicate.length - 12} more relationship names.</li>
				) : null}
			</ul>

			<div
				className="hub-list-scroller"
				ref={scroller}
				style={{ height: `${VIEWPORT_ROWS * ROW_HEIGHT}px` }}
				onScroll={(event) => setOffset(event.currentTarget.scrollTop)}
			>
				{/* The spacer is the whole list's height. It is what makes the scrollbar honest about
				    how much there is, which is the only thing telling the reader this is 100,000 rows
				    and not the twenty they can see. */}
				<div className="hub-list-spacer" style={{ height: `${index.total * ROW_HEIGHT}px` }}>
					<ul
						className="hub-list-rows"
						style={{ transform: `translateY(${window.offset * ROW_HEIGHT}px)` }}
					>
						{window.rows.map((row) => (
							<li key={row.edge.id} style={{ height: `${ROW_HEIGHT}px` }}>
								<span className="hub-list-position">{(row.position + 1).toLocaleString()}</span>
								<span className="hub-list-claim">
									{row.direction === 'from' ? (
										<>
											<em>{row.edge.predicate ?? '—'}</em> {row.other}
										</>
									) : (
										<>
											{row.other} <em>{row.edge.predicate ?? '—'}</em>
										</>
									)}
								</span>
								{row.edge.memory_id ? (
									<button type="button" className="linklike" onClick={() => onOpen(row.edge.memory_id)}>
										{row.edge.memory_title ?? row.edge.memory_id}
									</button>
								) : null}
							</li>
						))}
					</ul>
				</div>
			</div>

			<p className="graph-note">
				Showing rows {(window.offset + 1).toLocaleString()}–
				{(window.offset + window.rows.length).toLocaleString()} of {index.total.toLocaleString()}. The rest
				are in the list, not hidden from it — scroll.
			</p>
		</section>
	);
}
