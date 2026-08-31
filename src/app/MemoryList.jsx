import { useEffect, useRef, useState } from 'react';

import { SORTS, scopeAxes } from './records.mjs';
import { NotRecorded, ScopeLine } from './ui.jsx';

/** How many rows are put in the DOM before the reader asks for more. */
const PAGE = 200;

/**
 * The list.
 *
 * The box at the top is labelled Filter and it is a filter: it narrows an array this browser
 * already holds, by substring, case-insensitively, over the fields on screen. IT ISSUES NO REQUEST,
 * and that is a property of the code rather than of the label — there is no function in this app
 * that would run a ranked query, so there is nothing here to accidentally call. The ranked door
 * records every distinct query string it is given, permanently, in a store nothing published reads
 * back; a type-ahead wired to it turns browsing into a keystroke log inside the user's own vault.
 *
 * The line under the box says the difference out loud, because a user who expects a search and gets
 * a filter will be surprised by exactly one thing: a filter finds the word they typed, and the
 * agent's own retrieval finds memories that do not contain it.
 */
export function MemoryList({
	rows,
	total,
	filters,
	setFilters,
	sort,
	setSort,
	relations,
	onOpen,
}) {
	const [visible, setVisible] = useState(PAGE);
	const axes = scopeAxes(rows.map((row) => row.record));
	const filterInput = useRef(null);

	// A narrowed list starts at the top; keeping a deep window open across a filter change leaves
	// the reader looking at rows that are no longer the ones they asked for.
	useEffect(() => setVisible(PAGE), [filters, sort]);

	// `/` focuses the filter, the one keystroke a reader of a long list reaches for. It is bound
	// here rather than globally so it cannot fire while a text field elsewhere has focus.
	useEffect(() => {
		const onKey = (event) => {
			if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
			const active = document.activeElement;
			if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
			event.preventDefault();
			filterInput.current?.focus();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const shown = rows.slice(0, visible);

	return (
		<div className="list">
			<div className="list-controls">
				<div className="filter-box">
					<label className="sr-only" htmlFor="filter">
						Filter
					</label>
					<input
						id="filter"
						ref={filterInput}
						type="search"
						className="filter-input"
						value={filters.text}
						placeholder={`Filter these ${total} memories`}
						autoComplete="off"
						spellCheck="false"
						onChange={(event) => setFilters({ ...filters, text: event.target.value })}
					/>
					<p className="filter-note">
						This finds the words you type, in this browser, and reaches nothing. The agent's own
						retrieval works differently and is not in this version.
					</p>
				</div>

				<div className="sort-box">
					<label htmlFor="sort">Sort</label>
					<select
						id="sort"
						value={sort}
						onChange={(event) => setSort(event.target.value)}
						className="select"
					>
						{Object.entries(SORTS).map(([key, entry]) => (
							<option key={key} value={key}>
								{entry.label}
							</option>
						))}
					</select>
				</div>
			</div>

			<p className="list-count" aria-live="polite">
				{rows.length === total
					? `${total} memories`
					: `${rows.length} of ${total} memories`}
			</p>

			<div className="rows" role="table" aria-label="Memories">
				<div className="row row-head" role="row">
					<span role="columnheader">Title</span>
					<span role="columnheader">Type</span>
					<span role="columnheader">Applies to</span>
					<span role="columnheader" className="num">
						Facts
					</span>
					<span role="columnheader">Written</span>
				</div>

				{shown.map((row) => (
					<Row key={row.memory_id} row={row} axes={axes} relations={relations} onOpen={onOpen} />
				))}
			</div>

			{rows.length > visible ? (
				<div className="list-more">
					<button type="button" className="button" onClick={() => setVisible(visible + PAGE)}>
						Show {Math.min(PAGE, rows.length - visible)} more
					</button>
					<span className="muted">
						{visible} of {rows.length} in view
					</span>
				</div>
			) : null}
		</div>
	);
}

function Row({ row, axes, relations, onOpen }) {
	const entry = relations.get(row.memory_id);
	const corrected = (entry?.corrected_by ?? []).length;
	const contradicted = (entry?.contradicted_by ?? []).length;

	return (
		<div
			className="row row-memory"
			role="row"
			tabIndex={0}
			onClick={() => onOpen(row.memory_id)}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onOpen(row.memory_id);
				}
			}}
		>
			<span className="cell cell-title" role="cell">
				{row.title ?? <NotRecorded what="title" />}
				{/*
				  The one warning a row may carry, and the gate on it is the requirement. It appears
				  only when the memory declares at least one named thing: a memory that declares none
				  is in a different and entirely legitimate regime, and running the check there would
				  flag almost every honest memory in a young vault as defective.
				*/}
				{row.undeclared_endpoints > 0 ? (
					<span className="row-warning">
						{row.undeclared_endpoints} fact{row.undeclared_endpoints === 1 ? '' : 's'} name
						things this memory does not declare
					</span>
				) : null}
				{corrected > 0 || contradicted > 0 ? (
					<span className="row-note">
						{corrected > 0 ? `corrected by ${corrected}` : null}
						{corrected > 0 && contradicted > 0 ? ' · ' : null}
						{contradicted > 0 ? `contradicted by ${contradicted}` : null}
					</span>
				) : null}
			</span>

			<span className="cell cell-type" role="cell">
				{/* The literal value, whatever it is. This app holds no list of type names. */}
				{row.memory_type ?? <NotRecorded what="type" />}
			</span>

			<span className="cell cell-scope" role="cell">
				<ScopeLine scope={row.scope} axes={axes} />
			</span>

			<span className="cell cell-facts num" role="cell">
				{row.fact_count}
			</span>

			<span className="cell cell-written" role="cell">
				{/*
				  The date is what a person recognises, so it is what is shown; the write order is
				  what actually orders the list, so it is shown beside it rather than hidden. There is
				  no state badge on a row: the listing door excludes removed memories and the record
				  it returns carries no other state, so a badge here would have nothing behind it.
				*/}
				{row.created_on ?? <NotRecorded what="first written" />}
				{row.sequence === null ? null : <span className="written-order">#{row.sequence}</span>}
			</span>
		</div>
	);
}
