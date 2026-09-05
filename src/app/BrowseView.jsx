import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	EMPTY_FILTERS,
	GROUPED_SORTS,
	activeFacetCount,
	applyBrowseFilters,
	browseFacets,
	flattenGroups,
	groupRows,
	isFiltered,
	markWatermark,
	rowMarks,
	wordFor,
} from './browse-model.mjs';
import { Markdown } from './markdown.jsx';
import { axisCopy, shortenScope, SORTS } from './records.mjs';
import { ago, written } from './when.mjs';
import {
	BulkBar,
	Button,
	DetailRow,
	DetailRows,
	Display,
	Evidence,
	Facet,
	FactList,
	FactSentence,
	FilterPanel,
	Identifier,
	ListBar,
	MemoryRow,
	MemoryRows,
	MenuItem,
	MenuSeparator,
	NamedThing,
	NotRecorded,
	OverflowMenu,
	Preview,
	PreviewBlock,
	ScopeValue,
	PreviewHead,
	ReadingPair,
	Readings,
	Section,
	Select,
	SelectItem,
	TimeHeading,
} from './ui/index.mjs';

/**
 * BROWSE — the screen the owner approved by name: "Browse B yeah super cool, build all of it."
 *
 * Three regions and one story. The facets say what you are looking at, the list says which ones
 * there are, the preview says what one of them is. A reader can name the screen in one sentence,
 * which is the test the last version failed: "no thinking balance, I just put everything together
 * at one place."
 *
 * WHAT MAKES IT WORK AT 612 AND AT SEVERAL THOUSAND — three things, and none of them is a spinner:
 *
 *   TIME DOES THE GROUPING. The list is headed "Today", "Earlier this week", "August", each with
 *   its own count, and the headings stick. A reader in the middle of August always knows it.
 *
 *   THE FACETS ARE CLOSED UNTIL USED and read back their own state as chips. "I had to scroll for
 *   ten minutes for each" was a column three facets deep in always-open value lists; this one fits
 *   with the honest count under it and nothing below the fold.
 *
 *   THE ROWS ARE A WINDOW OVER AN ARRAY. A fixed number are in the DOM, the next window arrives
 *   when a sentinel scrolls into view, and every row that is in the DOM sets `content-visibility`
 *   so the ones off screen are neither laid out nor painted.
 *
 * NOTHING ON THIS SCREEN REACHES THE ENGINE. Every facet value, every count, every group and the
 * find box are arithmetic over a payload the browser already holds. That is not a promise about
 * this file, it is a property of it: `browse-model.mjs` imports no fetch helper, and the one door
 * that ranks — which records every distinct query string it is ever given, permanently, in a store
 * nothing published reads back — is reachable only from the search screen, only on an explicit
 * press. The box in the top bar carries words to that screen and runs nothing on the way.
 */

/** How many list items — headings and rows together — enter the DOM at a time. */
const WINDOW = 150;

/** How close the keyboard selection may get to the end of the window before the next one is asked for. */
const LOOKAHEAD = 25;

export function BrowseView({
	rows,
	relations,
	session,
	filters,
	setFilters,
	sort,
	setSort,
	lastLooked,
	selection,
	onToggle,
	onToggleMany,
	onRemoveSelected,
	maxSelectable = null,
	onOpen,
	onEdit,
	onMerge,
	onShowLimits,
	strippedFields = null,
	scrollRef = null,
}) {
	/*
	  THE WATERMARK IS RESOLVED ONCE, HERE, into a flag on each row.

	  "Since I last looked" is a claim about a sequence number, and the facet's count and the list
	  under it have to be the same claim. Resolving it inside the filter would let the two disagree
	  the moment the mark moved mid-session, and the reader would be looking at "12" over eleven rows
	  with no way to tell which was wrong.
	*/
	const marked = useMemo(() => markWatermark(rows, lastLooked), [rows, lastLooked]);
	const facets = useMemo(
		() => browseFacets(marked, { vocabulary: session?.vocabulary, relations, lastLooked }),
		[marked, session, relations, lastLooked],
	);

	const filtered = useMemo(() => {
		const matched = applyBrowseFilters(marked, filters, relations);
		return [...matched].sort(SORTS[sort].compare);
	}, [marked, filters, relations, sort]);

	const items = useMemo(
		() => flattenGroups(groupRows(filtered, { sort })),
		[filtered, sort],
	);
	const rowItems = useMemo(() => items.filter((item) => item.kind === 'row'), [items]);

	/* ---------------------------------------------------------------- which memory is on the right */

	const [chosen, setChosen] = useState(null);

	/*
	  THE ROWS SCROLL, AND THE CALLER MAY HOLD THE HANDLE.

	  The scrolling element is `.mlist-rows` — not this component's root, and not any page container
	  above it. App restores the reader's place when they come back from a memory, and it can only do
	  that against the element that actually moved; a ref on a wrapper reads 0 on the way out and
	  sets 0 on the way back, which is a restore that reports as wired and always lands at the top.
	  Own ref when nobody asks for it, so this screen still works standalone in a test.
	*/
	const ownScroller = useRef(null);
	const scroller = scrollRef ?? ownScroller;

	// The selected memory follows the list rather than the list following it. When a narrowing drops
	// the memory that was on the right, the pane shows the first of what is left — a preview of a
	// memory that is no longer in the list is a pane describing something the reader cannot see.
	const current = useMemo(() => {
		const held = rowItems.find((item) => item.row.memory_id === chosen);
		return held?.row ?? rowItems[0]?.row ?? null;
	}, [rowItems, chosen]);

	const position = useMemo(
		() => rowItems.findIndex((item) => item.row.memory_id === current?.memory_id),
		[rowItems, current],
	);

	/* ---------------------------------------------------------------------------- the window */

	const [windowSize, setWindowSize] = useState(WINDOW);
	const sentinel = useRef(null);

	// A narrowed list starts at the top with a fresh window: keeping a deep one open across a filter
	// change leaves the reader looking at rows that are no longer the ones they asked for.
	useEffect(() => {
		setWindowSize(WINDOW);
		if (scroller.current) scroller.current.scrollTop = 0;
	}, [filters, sort]);

	// The next window arrives when the end of this one comes into view. An observer rather than a
	// scroll handler: it fires once per crossing instead of once per frame, and it is correct when
	// the list is short enough that the sentinel is visible from the start.
	useEffect(() => {
		const node = sentinel.current;
		if (!node || windowSize >= items.length) return undefined;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setWindowSize((size) => Math.min(items.length, size + WINDOW));
				}
			},
			{ root: scroller.current, rootMargin: '400px' },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [items.length, windowSize]);

	const visible = useMemo(() => items.slice(0, windowSize), [items, windowSize]);

	/* ------------------------------------------------------------------------------ the keyboard */

	const move = useCallback(
		(delta) => {
			if (rowItems.length === 0) return;
			const next = Math.min(rowItems.length - 1, Math.max(0, (position === -1 ? 0 : position) + delta));
			const item = rowItems[next];
			if (!item) return;
			setChosen(item.row.memory_id);

			// The window has to contain the row before the row can be scrolled to. Grown here rather
			// than waiting for the sentinel, because j held down outruns an observer that only fires
			// when something crosses the viewport.
			const index = items.indexOf(item);
			if (index + LOOKAHEAD >= windowSize) {
				setWindowSize((size) => Math.min(items.length, Math.max(size, index + LOOKAHEAD + WINDOW)));
			}

			// After the render that added it. `block: 'nearest'` so a selection already on screen does
			// not yank the list, which is what makes holding j readable rather than dizzying.
			requestAnimationFrame(() => {
				scroller.current
					?.querySelector(`[data-memory="${cssEscape(item.row.memory_id)}"]`)
					?.scrollIntoView({ block: 'nearest' });
			});
		},
		[rowItems, position, items, windowSize],
	);

	useEffect(() => {
		const onKey = (event) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const active = document.activeElement;
			// Never while somebody is typing. `j` in a filter box that moved the list instead of
			// typing a j is the single most infuriating thing a keyboard shortcut can do.
			if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
				return;
			}
			if (event.key === 'j' || event.key === 'ArrowDown') {
				event.preventDefault();
				move(1);
			} else if (event.key === 'k' || event.key === 'ArrowUp') {
				event.preventDefault();
				move(-1);
			} else if (event.key === 'x' && current) {
				// Ticks the memory under the selection for a bulk run, without leaving the list.
				event.preventDefault();
				onToggle?.(current, !selection.has(current.memory_id));
			} else if (event.key === 'Enter' && current) {
				event.preventDefault();
				onOpen(current.memory_id);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [move, current, onOpen, onToggle, selection]);

	/* --------------------------------------------------------------------------------- the facets */

	const toggle = useCallback(
		(key, value) => {
			setFilters((current) => {
				const held = current[key];
				return {
					...current,
					[key]: held.includes(value) ? held.filter((item) => item !== value) : [...held, value],
				};
			});
		},
		[setFilters],
	);

	const clearFacet = useCallback((key) => setFilters((current) => ({ ...current, [key]: [] })), [setFilters]);

	const narrowed = isFiltered(filters);
	const facetCount = activeFacetCount(filters);

	return (
		<div className="browse">
			<FilterPanel
				shown={filtered.length}
				total={rows.length}
				onClear={narrowed ? () => setFilters(EMPTY_FILTERS) : null}
				clearLabel={facetCount === 1 ? 'Clear the filter' : `Clear all ${facetCount} filters`}
			>
				<Facet
					label="Kind"
					values={facets.kind}
					selected={filters.kind}
					onToggle={(value) => toggle('kind', value)}
					onClear={() => clearFacet('kind')}
					findLabel="Find a kind"
					empty="No memory here records a kind."
				/>

				<Facet
					label="When"
					values={facets.when}
					selected={filters.when}
					onToggle={(value) => toggle('when', value)}
					onClear={() => clearFacet('when')}
					note={
						lastLooked === null
							? 'The vault records nothing about what you have read, so "since I last looked" starts working after your second visit. The mark is kept in this browser.'
							: 'The vault records nothing about what you have read. The mark behind "since I last looked" is kept in this browser and nowhere else.'
					}
					empty="Nothing here carries a date this app can read."
				/>

				<Facet
					label="Still true"
					values={facets.truth}
					selected={filters.truth}
					onToggle={(value) => toggle('truth', value)}
					onClear={() => clearFacet('truth')}
					note="A memory is superseded when a later one says it corrects or contradicts it. There is no flag on a record for this — it is read off what the memories themselves declare."
					empty="No memory here sets a serving window, and none declares that it corrects or contradicts another. This is empty because the vault is, not because it is broken."
				/>

				<Facet
					label="Mentions"
					values={facets.mentions}
					selected={filters.mentions}
					onToggle={(value) => toggle('mentions', value)}
					onClear={() => clearFacet('mentions')}
					findLabel="Find a name"
					note="The things these memories name. A memory that declares none is not missing anything — plenty of honest memories are prose with no names attached."
					empty="No memory here declares a named thing."
				/>

				{/*
				  LAST, AND IT SAYS WHAT IT IS. "Applies to branch. I don't know why we have it, and I
				  don't even know how this works." · "Applies to file. I have no idea. And it's too
				  long — it just goes on and on and on."

				  Demoting it was the answer rather than dropping it: an agent that scoped a memory to
				  one branch meant something by it, and a person looking for why a memory is not being
				  served needs to be able to see that. So it is here, it is last, and the sentence
				  inside it is the explanation the owner did not get.
				*/}
				<Facet
					label="Branch or file"
					values={facets.place}
					selected={filters.place}
					onToggle={(value) => toggle('place', value)}
					onClear={() => clearFacet('place')}
					findLabel="Find a branch or file"
					note="Where an agent has to be for a memory to be offered. Most memories name neither, and one that names neither applies everywhere — which is wider than a branch, not narrower."
					empty="No memory here is scoped to a branch or a file. Every one of them applies wherever your agent is working."
				/>
			</FilterPanel>

			<div className={`mlist${selection.size > 0 ? ' mlist-selecting' : ''}`}>
				<ListBar hint="j / k to move">
					<Select
						value={sort}
						onValueChange={setSort}
						label="Order these memories"
						triggerClassName="select-quiet"
					>
						{Object.entries(SORTS).map(([key, entry]) => (
							<SelectItem key={key} value={key}>
								{entry.label}
							</SelectItem>
						))}
					</Select>
				</ListBar>

				<MemoryRows label="Memories" scrollRef={scroller}>
					{filtered.length === 0 ? (
						<div className="mlist-empty">
							<p>
								{narrowed
									? 'No memory here matches all of these at once.'
									: 'There is nothing in this project.'}
							</p>
							{narrowed ? (
								<>
									<p>
										This narrows the memories already loaded. It finds the words you type; it
										does not find a memory that means the same thing in different words — that
										is a different question, and the search screen is where it is asked.
									</p>
									<Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear the filters</Button>
								</>
							) : null}
						</div>
					) : (
						<>
							{visible.map((item) =>
								item.kind === 'heading' ? (
									<TimeHeading key={item.key} label={item.label} count={item.count} />
								) : (
									<Row
										key={item.key}
										row={item.row}
										relations={relations}
										headed={GROUPED_SORTS.has(sort)}
										selected={item.row.memory_id === current?.memory_id}
										ticked={selection.has(item.row.memory_id)}
										onTick={onToggle ? (on) => onToggle(item.row, on) : null}
										onSelect={() => setChosen(item.row.memory_id)}
										onOpen={() => onOpen(item.row.memory_id)}
									/>
								),
							)}
							{/* Asks for the next window when it scrolls into view. Renders nothing. */}
							{windowSize < items.length ? <div className="mlist-more" ref={sentinel} /> : null}
						</>
					)}
				</MemoryRows>

				{selection.size > 0 ? (
					<BulkBar>
						<span className="mlist-bulk-count">{selection.size} selected</span>
						<Button
							size="sm"
							tone="quiet"
							onClick={() => onToggleMany?.([...selection.values()], false)}
						>
							Clear
						</Button>
						<Button
							size="sm"
							tone="warn"
							onClick={onRemoveSelected}
							disabled={maxSelectable !== null && selection.size > maxSelectable}
						>
							{selection.size === 1
								? 'Remove 1 memory'
								: `Remove these ${selection.size} memories`}
						</Button>
						{maxSelectable !== null && selection.size > maxSelectable ? (
							// The cap is the server's own reading rather than a number written down here, so
							// a control and the thing that enforces it cannot drift apart.
							<p className="mlist-bulk-note">
								One run carries at most {maxSelectable}. Each removal is a separate call, so a
								very long run mostly stops partway — several shorter runs are the same work with
								a report you can read.
							</p>
						) : null}
					</BulkBar>
				) : null}
			</div>

			{current ? (
				<MemoryPreview
					key={current.memory_id}
					row={current}
					relations={relations}
					strippedFields={strippedFields}
					onOpen={onOpen}
					onEdit={onEdit}
					onMerge={onMerge}
					onShowLimits={onShowLimits}
				/>
			) : (
				<div className="preview-idle">
					<p>Nothing is selected. Choose a memory on the left, or press j.</p>
				</div>
			)}
		</div>
	);
}

/* ----------------------------------------------------------------------------------- the rows */

/**
 * One row, and its second line.
 *
 * The meta is composed from `rowMarks` so this component decides nothing about what a mark means —
 * the reading that a memory is superseded is an inversion over what other memories declare, and it
 * belongs beside the rest of the arithmetic rather than in a render function.
 */
function Row({ row, relations, headed, selected, ticked, onTick, onSelect, onOpen }) {
	const marks = rowMarks(row, relations, { headed });
	const parts = [];
	if (marks.when) parts.push(<span key="when">{marks.when.toLowerCase()}</span>);
	parts.push(
		marks.kind ? <span key="kind">{marks.kind}</span> : <NotRecorded key="kind" what="kind" />,
	);
	if (marks.superseded) {
		parts.push(<span key="superseded">superseded</span>);
	} else if (marks.facts > 0) {
		parts.push(
			<span key="facts">
				{marks.facts} fact{marks.facts === 1 ? '' : 's'}
			</span>,
		);
	}
	if (marks.corrects > 0) {
		parts.push(
			<span key="corrects" className="mrow-mark-warn">
				corrects {marks.corrects}
			</span>,
		);
	}
	if (marks.contradicts > 0) {
		parts.push(
			<span key="contradicts" className="mrow-mark-warn">
				contradicts {marks.contradicts}
			</span>,
		);
	}
	// Only where the memory declares at least one named thing. A memory that declares none is in a
	// different and entirely legitimate regime, and the check does not run there at all.
	if (marks.undeclared > 0) {
		parts.push(
			<span key="undeclared" className="mrow-mark-warn">
				{marks.undeclared} name{marks.undeclared === 1 ? 's' : ''} something undeclared
			</span>,
		);
	}

	return (
		<MemoryRow
			id={row.memory_id}
			title={row.title ?? <NotRecorded what="title" />}
			meta={joinDots(parts)}
			selected={selected}
			dimmed={marks.superseded}
			ticked={ticked}
			onTick={onTick}
			onSelect={onSelect}
			onOpen={onOpen}
		/>
	);
}

/** " · " between the marks, composed once so no two rows can space it differently. */
function joinDots(parts) {
	return parts.flatMap((part, index) =>
		index === 0
			? [part]
			: [
					<span key={`sep-${index}`} aria-hidden="true">
						{' · '}
					</span>,
					part,
				],
	);
}

/* -------------------------------------------------------------------------------- the preview */

/**
 * READING A MEMORY WITHOUT LEAVING THE LIST — the half of BrowseB the owner reacted to.
 *
 * Its order is the order of the drawing and it is an argument, not a layout: the title, the words,
 * and then WHAT YOUR AGENT ACTS ON. Everything else this record carries — the names it declares,
 * where it says it came from, its identifiers — is a closed row with its own count. That is the
 * whole answer to "too much information overload on any page": nothing was removed, and the second
 * and third things stopped competing with the first.
 */
function MemoryPreview({ row, relations, strippedFields, onOpen, onEdit, onMerge, onShowLimits }) {
	const semantic = row.record?.semantic ?? {};
	const facts = semantic.facts ?? [];
	const entities = semantic.entities ?? [];
	const evidence = semantic.evidence ?? [];
	const entry = relations?.get(row.memory_id);
	const inbound = (entry?.corrected_by ?? []).length + (entry?.contradicted_by ?? []).length;

	// "correction · today · every branch" — the type, when it was written, and the honest reading of
	// its scope. An omitted axis matches everything, so it is a phrase and never a blank.
	// A VALUE IS AN ELEMENT, NOT A STRING, so a repository path can be cut short. Joined as text, a
	// scope line reading `file infra/staging/restore.nightly.yaml` pushed the type and the date off
	// the line — which is the reading the owner gave of the rejected build: "it's too long, it just
	// goes on and on and on". `shortenScope` keeps the end that names the file, and `ScopeValue`
	// draws the cut form as a control that shows the whole value on a press — not on hover, which a
	// touch screen does not have.
	const scopeWords = Object.keys(semantic.scope ?? {})
		.filter((axis) => axis !== 'project')
		.map((axis) => {
			const value = semantic.scope[axis];
			return value ? (
				<span key={axis}>
					{wordFor(axis)} <ScopeValue value={value} short={shortenScope(value)} />
				</span>
			) : (
				<span key={axis}>{axisCopy(axis).every}</span>
			);
		});

	return (
		<Preview>
			<PreviewHead
				actions={
					<>
						<Button tone="primary" onClick={() => onEdit(row.memory_id)}>
							Edit
						</Button>
						<OverflowMenu label="More for this memory">
							<MenuItem onSelect={() => onOpen(row.memory_id)}>Open this memory</MenuItem>
							{onMerge ? (
								<MenuItem onSelect={() => onMerge(row.memory_id)}>
									Find one this repeats
								</MenuItem>
							) : null}
							<MenuSeparator />
							<MenuItem onSelect={() => onShowLimits?.(row.memory_id)}>
								What removal cannot do
							</MenuItem>
						</OverflowMenu>
					</>
				}
			>
				<Display level={2} size="md">
					{row.title ?? <NotRecorded what="title" />}
				</Display>
				<div className="preview-meta">
					{[
						row.memory_type,
						written(row.created_on) ?? 'written on a date not recorded',
						...scopeWords,
					]
						.filter(Boolean)
						.map((part, index) => (
							<span key={index} className="preview-meta-part">
								{index > 0 ? <span aria-hidden="true"> · </span> : null}
								{part}
							</span>
						))}
				</div>
			</PreviewHead>

			{row.record?.content_md ? (
				<PreviewBlock className="preview-words">
					<Markdown source={row.record.content_md} headingOffset={2} title={row.title} />
				</PreviewBlock>
			) : null}

			<PreviewBlock>
				<Section title="What your agent acts on">
					{facts.length === 0 ? (
						<p className="copy">
							This memory is prose with no facts attached. It is still a memory and still served;
							nothing is wrong with it.
						</p>
					) : (
						<FactList>
							{facts.map((fact, index) => (
								<FactSentence
									key={index}
									subject={fact?.subject}
									predicate={fact?.predicate}
									object={fact?.object}
								/>
							))}
						</FactList>
					)}
				</Section>
			</PreviewBlock>

			{/*
			  Everything that is not this memory's first or second thing, closed, each carrying its
			  own count. A row with a count of zero is still rendered: if it vanished, "no evidence
			  was recorded" would be indistinguishable from "evidence I have not scrolled to".
			*/}
			<PreviewBlock>
				<DetailRows>
					<DetailRow label="Named things" count={entities.length}>
						{entities.length === 0 ? (
							<p className="copy">This memory declares no named things.</p>
						) : (
							entities.map((entity, index) => (
								<NamedThing key={index} name={entity?.n} kind={entity?.kind} gloss={entity?.is} />
							))
						)}
					</DetailRow>

					<DetailRow label="Where this came from" count={evidence.length}>
						{evidence.length === 0 ? (
							<p className="copy">The writer recorded no evidence for this memory.</p>
						) : (
							<Evidence
								items={evidence}
								footnote="A pointer the writer left, not a citation anything verified."
							/>
						)}
					</DetailRow>

					<DetailRow
						label="Corrections and contradictions"
						count={inbound + (entry?.corrects ?? []).length + (entry?.contradicts ?? []).length}
						tone={inbound > 0 ? 'warn' : 'neutral'}
					>
						<Relations entry={entry} onOpen={onOpen} />
					</DetailRow>

					<DetailRow label="History and identifiers" count={ago(row.created_on) ?? 'not dated'}>
						<Readings>
							<ReadingPair term="first written">
								{row.created_on ?? <NotRecorded what="first written" />}
							</ReadingPair>
							<ReadingPair term="write order">
								{row.sequence === null ? <NotRecorded what="write order" /> : `#${row.sequence}`}
							</ReadingPair>
							<ReadingPair term="memory">
								<Identifier value={row.memory_id} label="memory id" />
							</ReadingPair>
							<ReadingPair term="version">
								<Identifier value={row.version_id} label="version id" />
							</ReadingPair>
							{/*
							  Fixed, and it is the whole reason this row exists. The nearest fields on a
							  record look like provenance and are not, and a blank invites the next
							  contributor to fill it with a guess.
							*/}
							<ReadingPair term="who wrote this">
								not recorded. kscope does not store a writer on a memory.
							</ReadingPair>
							{Array.isArray(strippedFields) && strippedFields.length > 0 ? (
								<ReadingPair term="not sent to this page">
									{strippedFields.join(', ')} — derived from the memory rather than written, and
									recomputed on the next write.
								</ReadingPair>
							) : null}
						</Readings>
					</DetailRow>
				</DetailRows>
			</PreviewBlock>
		</Preview>
	);
}

/**
 * What this memory corrects, and what corrects it.
 *
 * A CORRECTION NAMES ITS TARGET BY A HANDLE, and a handle is whatever the writing agent called the
 * thing. Most of them resolve to no memory at all, so resolution is reported rather than assumed —
 * a link that goes nowhere is worse than the sentence saying it does.
 */
function Relations({ entry, onOpen }) {
	const groups = [
		['This corrects', entry?.corrects ?? []],
		['This contradicts', entry?.contradicts ?? []],
		['Corrected by', entry?.corrected_by ?? []],
		['Contradicted by', entry?.contradicted_by ?? []],
	].filter(([, list]) => list.length > 0);

	if (groups.length === 0) {
		return (
			<p className="copy">
				Nothing here declares that it corrects or contradicts another memory, and nothing declares
				that about this one.
			</p>
		);
	}

	return (
		<Readings>
			{groups.map(([term, list]) => (
				<ReadingPair key={term} term={term.toLowerCase()}>
					{list.map((link, index) => {
						const target = link.target ?? link.from ?? null;
						return (
							<span key={index}>
								{index > 0 ? ' · ' : null}
								{target ? (
									<Button tone="quiet" size="sm" onClick={() => onOpen(target)}>
										{link.says ?? link.handle ?? target}
									</Button>
								) : (
									<span>
										{link.handle ?? 'a handle'} — no memory in this vault answers to that name
									</span>
								)}
							</span>
						);
					})}
				</ReadingPair>
			))}
		</Readings>
	);
}

/**
 * Escape a memory id for use inside an attribute selector.
 *
 * `CSS.escape` where the browser has it, and a conservative quote-and-backslash escape where it
 * does not. A memory id is engine-minted and would not need this today; the selector is built from
 * vault content, and vault content is treated as hostile everywhere else on this screen.
 */
function cssEscape(value) {
	const text = String(value);
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
	return text.replace(/["\\]/g, '\\$&');
}
