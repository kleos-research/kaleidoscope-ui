import { useMemo } from 'react';

import { EVERY, RELATION_LABELS, VALIDITY_LABELS } from './records.mjs';

/**
 * The facet rail.
 *
 * EVERY OPTION LIST HERE IS COMPUTED AT RUNTIME. Memory types come from the engine's own
 * vocabulary; scope values, validity buckets and relation states are counted off the loaded
 * records. There is no literal list of type names, entity kinds, relation names or scope values
 * anywhere in this repository, because those are open registries: a value transcribed into a
 * dropdown stops offering something that exists the first time the engine adds one, and it does it
 * silently — the control simply gets quieter.
 *
 * The second rule: A FACET WITH NOTHING IN IT SAYS WHY. An empty list reads as a broken control,
 * and worse, it teaches the reader something false about the vault — a permanently empty
 * "duplicates" facet teaches them the vault has none.
 */

function Option({ id, checked, onChange, label, count, hint = null }) {
	return (
		<label className="option" htmlFor={id}>
			<input id={id} type="checkbox" checked={checked} onChange={onChange} />
			<span className="option-label">
				{label}
				{hint ? <span className="option-hint">{hint}</span> : null}
			</span>
			<span className="option-count">{count}</span>
		</label>
	);
}

function Facet({ title, children, note = null }) {
	return (
		<section className="facet">
			<h2 className="facet-title">{title}</h2>
			{note ? <p className="facet-note">{note}</p> : null}
			{children}
		</section>
	);
}

const toggle = (list, value) =>
	list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export function Filters({ facets, filters, setFilters, rows, lastLooked }) {
	/**
	 * The write-order range, as positions in the vault's own ordering rather than as raw numbers.
	 *
	 * The control is labelled by the DATES at each end because that is what a person recognises, and
	 * it moves in WRITE ORDER because that is what actually orders the vault: the date has day
	 * granularity and ties heavily on a store written by agents in bursts.
	 */
	const stops = useMemo(() => {
		const bySequence = new Map();
		for (const row of rows) {
			if (row.sequence === null) continue;
			if (!bySequence.has(row.sequence)) bySequence.set(row.sequence, row.created_on);
		}
		return [...bySequence.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([sequence, date]) => ({ sequence, date }));
	}, [rows]);

	const lowIndex =
		filters.from_sequence === null
			? 0
			: Math.max(0, stops.findIndex((stop) => stop.sequence >= filters.from_sequence));
	const highIndexRaw =
		filters.to_sequence === null
			? stops.length - 1
			: stops.findLastIndex((stop) => stop.sequence <= filters.to_sequence);
	const highIndex = highIndexRaw < 0 ? stops.length - 1 : highIndexRaw;

	const setRange = (low, high) => {
		const lo = Math.min(low, high);
		const hi = Math.max(low, high);
		setFilters({
			...filters,
			from_sequence: lo <= 0 ? null : stops[lo].sequence,
			to_sequence: hi >= stops.length - 1 ? null : stops[hi].sequence,
		});
	};

	const newerThanWatermark =
		lastLooked === null ? null : rows.filter((row) => (row.sequence ?? -1) > lastLooked).length;

	return (
		<aside className="rail" aria-label="Filters">
			<Facet
				title="Type"
				note={
					facets.types.vocabulary_missing
						? 'The engine did not answer with its type vocabulary, so this control lists only the types on the records that loaded.'
						: null
				}
			>
				<div className="option-list">
					{facets.types.declarable.map((option) => (
						<Option
							key={option.value}
							id={`type-${option.value}`}
							checked={filters.types.includes(option.value)}
							onChange={() => setFilters({ ...filters, types: toggle(filters.types, option.value) })}
							label={option.value}
							count={option.count}
						/>
					))}
				</div>

				{/*
				  The divider is not cosmetic. The engine returns two lists that do not hold the same
				  values — what a writer may declare, and what this workspace already contains — and
				  the difference between them is the difference between what you may write and what
				  you may see. A control that merged them would hide a retired type that is still in
				  the vault, or offer one that can no longer be written.
				*/}
				{facets.types.also_present.length > 0 ? (
					<>
						<p className="option-divider">Also present in this vault</p>
						<div className="option-list">
							{facets.types.also_present.map((option) => (
								<Option
									key={option.value}
									id={`type-${option.value}`}
									checked={filters.types.includes(option.value)}
									onChange={() =>
										setFilters({ ...filters, types: toggle(filters.types, option.value) })
									}
									label={option.value}
									count={option.count}
								/>
							))}
						</div>
					</>
				) : null}

				{facets.types.unlisted.length > 0 ? (
					<>
						<p className="option-divider">On a record, in neither list</p>
						<div className="option-list">
							{facets.types.unlisted.map((option) => (
								<Option
									key={option.value}
									id={`type-${option.value}`}
									checked={filters.types.includes(option.value)}
									onChange={() =>
										setFilters({ ...filters, types: toggle(filters.types, option.value) })
									}
									label={option.value}
									count={option.count}
								/>
							))}
						</div>
					</>
				) : null}
			</Facet>

			{facets.scope.map((facet) => {
				const selected = filters.scope[facet.axis] ?? [];
				const change = (value) =>
					setFilters({
						...filters,
						scope: { ...filters.scope, [facet.axis]: toggle(selected, value) },
					});
				return (
					<Facet key={facet.axis} title={`Applies to — ${facet.copy.label}`}>
						<div className="option-list">
							{/* Listed first, because it is usually the largest bucket and it is the one
							    whose meaning is inverted: the writer left the axis out, so the memory
							    applies everywhere rather than nowhere. */}
							<Option
								id={`scope-${facet.axis}-every`}
								checked={selected.includes(EVERY)}
								onChange={() => change(EVERY)}
								label={facet.copy.every}
								hint="the writer left this axis out"
								count={facet.every.count}
							/>
							{facet.options.map((option) => (
								<Option
									key={option.value}
									id={`scope-${facet.axis}-${option.value}`}
									checked={selected.includes(option.value)}
									onChange={() => change(option.value)}
									label={option.value}
									count={option.count}
								/>
							))}
						</div>
						{facet.options.length === 0 ? (
							<p className="facet-empty">
								No memory in this vault names a {facet.copy.label}; every one of them applies to{' '}
								{facet.copy.every}.
							</p>
						) : null}
					</Facet>
				);
			})}

			<Facet title="Written">
				{stops.length < 2 ? (
					<p className="facet-empty">
						There is only one position in this vault's write order, so there is no range to
						narrow.
					</p>
				) : (
					<div className="range">
						<div className="range-ends">
							<span>{stops[lowIndex]?.date ?? '—'}</span>
							<span className="range-arrow" aria-hidden="true">
								→
							</span>
							<span>{stops[highIndex]?.date ?? '—'}</span>
						</div>
						<input
							type="range"
							min={0}
							max={stops.length - 1}
							value={lowIndex}
							aria-label="Earliest write order to include"
							onChange={(event) => setRange(Number(event.target.value), highIndex)}
						/>
						<input
							type="range"
							min={0}
							max={stops.length - 1}
							value={highIndex}
							aria-label="Latest write order to include"
							onChange={(event) => setRange(lowIndex, Number(event.target.value))}
						/>
						<p className="range-note">
							Write order {stops[lowIndex]?.sequence} to {stops[highIndex]?.sequence}. The dates
							label the ends; the write order is what orders.
						</p>
					</div>
				)}

				<div className="range-presets">
					<button
						type="button"
						className="link-button"
						disabled={lastLooked === null}
						onClick={() => setFilters({ ...filters, from_sequence: lastLooked + 1, to_sequence: null })}
					>
						Since I last looked
						{newerThanWatermark === null ? null : <span className="option-count">{newerThanWatermark}</span>}
					</button>
					<button
						type="button"
						className="link-button"
						onClick={() => setFilters({ ...filters, from_sequence: null, to_sequence: null })}
					>
						Whole range
					</button>
				</div>
				<p className="facet-note">
					{lastLooked === null
						? 'The vault records nothing about what you have read, so "since I last looked" starts working after your second visit. The mark is kept in this browser.'
						: 'The vault records nothing about what you have read. This mark is kept in this browser and nowhere else.'}
				</p>
			</Facet>

			<Facet title="Validity">
				{facets.validity.every((option) => option.count === 0) ? (
					<p className="facet-empty">
						No memory in this vault sets a validity window, so there is nothing to narrow here.
						This control is empty because the vault is, not because it is broken.
					</p>
				) : (
					<div className="option-list">
						{facets.validity.map((option) => (
							<Option
								key={option.value}
								id={`validity-${option.value}`}
								checked={filters.validity.includes(option.value)}
								onChange={() =>
									setFilters({ ...filters, validity: toggle(filters.validity, option.value) })
								}
								label={VALIDITY_LABELS[option.value]}
								count={option.count}
							/>
						))}
					</div>
				)}
			</Facet>

			<Facet title="Corrections and contradictions">
				{facets.relations.every((option) => option.count === 0) ? (
					<p className="facet-empty">
						No memory in this vault declares that it corrects or contradicts another one, and so
						none is on the receiving end of one either.
					</p>
				) : (
					<div className="option-list">
						{facets.relations.map((option) => (
							<Option
								key={option.value}
								id={`relation-${option.value}`}
								checked={filters.relations.includes(option.value)}
								onChange={() =>
									setFilters({ ...filters, relations: toggle(filters.relations, option.value) })
								}
								label={RELATION_LABELS[option.value]}
								count={option.count}
							/>
						))}
					</div>
				)}
				{/*
				  Where a reader would reasonably look for "superseded" or "marked duplicate", and the
				  honest answer about both.

				  "Superseded" is not a field on a record. What IS on a record is a declared
				  correction or contradiction, and inverting those across the whole loaded set gives
				  the other direction for free — that is the four options above, and it is the honest
				  form of the question.

				  The duplicate marker is a different thing again: it exists, but the listing door
				  does not carry it, so offering it here would cost one call per memory on every
				  refresh. It is shown on a memory's own page instead, when it is set.
				*/}
				<p className="facet-note">
					There is no "superseded" flag on a memory. These four are computed from what the
					memories themselves declare. A memory marked as a duplicate of another shows that on
					its own page — the listing does not carry the marker.
				</p>
			</Facet>
		</aside>
	);
}
