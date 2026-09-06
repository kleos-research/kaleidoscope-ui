import { Fragment, useMemo, useState } from 'react';

import { buildGraph, emptyState, kindPalette, nearDuplicates } from './graph-model.mjs';
import { HubList } from './HubList.jsx';
import { KindMatrix } from './KindMatrix.jsx';
import { HubLedger, HubRegime } from './HubPanel.jsx';
import { detectRegime, hubNodeId, planView, regimeLine } from './hub-model.mjs';
import {
	DEFAULT_ORDER,
	NAME_ORDERS,
	OVERVIEW_CEILING,
	highlightSet,
	nameRoute,
	nameRows,
	orderCounts,
	orderedRows,
	overviewElements,
	overviewFocus,
	vaultShape,
} from './names-model.mjs';
import { overviewLayout } from './overview-layout.mjs';
import {
	Button,
	Chip,
	DegreeBar,
	DetailRow,
	DetailRows,
	EmptyState,
	FindInput,
	KindLegend,
	PageHead,
	Stat,
	StatNote,
	StatStrip,
	Table,
	Tab,
	Tabs,
	TabsList,
	Td,
	Th,
	TooLargeState,
	Tr,
	VaultCanvas,
} from './ui/index.mjs';

/**
 * THINGS YOUR MEMORIES TALK ABOUT — the entry point to everything about names, and a table.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DEFAULT IS A TABLE AND NOT A PICTURE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every product that ships a whole-graph canvas as its front door has the same review: it is
 * beautiful, and after the first week it is wallpaper. The products that succeed at this size open
 * on a search box over a tabular hit list, or on a summary of categories — never on a rendered
 * graph. And in a controlled study, a team that built a custom interactive graph interface found
 * their users could not make sense of it: "In the end, they preferred a table."
 *
 * So this screen is a table, and it subsumes four of the five things a reader might have come here
 * to do: the most-connected names are the default sort, the newest are one tab away, a name is
 * found by typing it, and the ones that look like duplicates have their own tab and their own chip.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * AND WHY THE PICTURE IS STILL HERE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Because it does one job text cannot: it shows you the SIZE AND SHAPE of what your agent knows in
 * a single glance — one large region, a field of small ones, and a dashed line between two
 * spellings of what is probably one thing sitting on opposite sides of the vault. That is an
 * occasional diagnostic, it is what the owner asked to keep, and it is behind a button rather than
 * in front of the table because it is not how anybody finds anything.
 *
 * THE TWO ARE ONE WORLD. The find box at the top filters the table and highlights the same names in
 * the picture, so a reader who types something sees one answer in two renderings rather than two
 * features that agree until one of them is edited.
 *
 * THIS SCREEN ISSUES NO ENGINE CALL. Everything on it is arithmetic over the listing the browser
 * already holds. The one door that would make it convenient — a ranked query — writes a permanent
 * exposure row into the vault it is inspecting, and it lives on the search screen behind an
 * explicit press.
 */
export function NamesView({ records, schemaKinds = null, onOpenName, onOpenMemory = () => {} }) {
	const graph = useMemo(() => buildGraph(records), [records]);
	const duplicates = useMemo(() => nearDuplicates(graph), [graph]);
	const palette = useMemo(() => kindPalette(graph), [graph]);
	const shape = useMemo(() => vaultShape(graph, duplicates), [graph, duplicates]);
	const rows = useMemo(() => nameRows(graph, duplicates), [graph, duplicates]);
	const counts = useMemo(() => orderCounts(rows), [rows]);

	/*
	  THE REGIME, READ OVER THE RECONSTRUCTED GRAPH BEFORE ANY PICTURE IS DRAWN.

	  One pass over the degree distribution plus a sort, on the same payload the table is already
	  built from, and it answers a question the layout cannot: is one name in this vault connected to
	  so much of it that drawing the vault means drawing a black disc? The overview's own ceiling
	  cannot answer that — it counts elements, and a hundred thousand elements in a star and a
	  hundred thousand in a mesh are the same number and two different problems.

	  It is computed HERE, unconditionally, rather than inside the picture's memo. The reading is a
	  statement about the vault and it belongs to the screen whether or not the picture is open; and
	  the cap it is measured against is the ceiling this overview actually enforces, not the hub
	  module's own default — a threshold quoted against a budget nobody drew under is a confident
	  number about a mechanism that did not run.
	*/
	const regime = useMemo(() => detectRegime(graph, { cap: OVERVIEW_CEILING }), [graph]);

	const [order, setOrder] = useState(DEFAULT_ORDER);
	const [query, setQuery] = useState('');
	/*
	  THE NAME THE READER CLICKED ON THE PICTURE. A click isolates the island that name lives on;
	  it does not leave the screen, because "where does this sit" is a question about the picture
	  and the answer is in the picture. Opening the name is a double click or the link in the
	  reading under the picture. Typing clears it: the find box and the picture are one world, and
	  a query is the newer statement of what the reader is looking for.
	*/
	const [selected, setSelected] = useState(null);
	/*
	  THREE RENDERINGS OF ONE SET OF NAMES, and the list is the one it opens on. "Whole shape" is
	  the picture kept by owner decision; "Kind by kind" is the matrix of statements between kinds,
	  which is the only surface that makes the kind vocabulary's drift past the schema visible.
	  Neither is a destination in the top bar: both are diagnostics reached from here.
	*/
	const [view, setView] = useState(VIEWS[0].value);
	const picture = view === 'shape';
	/*
	  WHAT THE READER HAS ASKED TO REDUCE, and it starts empty on purpose. `planView` with nothing
	  asked for returns the projection unchanged, so the collapse is never the state this screen
	  opens in — a graph past the threshold that is still legible is OFFERED a collapse and drawn
	  whole until somebody presses the offer.
	*/
	const [reduction, setReduction] = useState(NOTHING_REDUCED);
	const [listing, setListing] = useState(null);

	const visible = useMemo(() => orderedRows(rows, { query, order }), [rows, query, order]);

	/*
	  THE PICTURE IS BUILT ONLY WHEN IT IS ASKED FOR, and the layout with it. A reader who opens this
	  screen to look up one name pays for a table; the overview's arithmetic is a few tens of
	  milliseconds and it is charged to the press that wanted it.
	*/
	const overview = useMemo(
		() => (picture ? overviewElements(graph, { palette, duplicates }) : null),
		[picture, graph, palette, duplicates],
	);
	/*
	  THE PLAN IS WHAT IS DRAWN — always, reduction or none.

	  Routing the unreduced case around `planView` would leave the reduced case as the only path
	  through it, and the property that makes "nothing narrows silently" checkable is precisely that
	  the two are one function: with nothing asked for it returns every node and every edge the
	  projection held, and the ledger beside it is empty because there is nothing to confess.
	*/
	const plan = useMemo(
		() => (overview ? planView(overview, { ...reduction, cap: OVERVIEW_CEILING }) : null),
		[overview, reduction],
	);
	/*
	  The ceiling is tested against the PLAN, not the projection, and that is the whole collapse path
	  in one line: on a vault whose star puts it over the ceiling, the offer above is the way to a
	  picture rather than a decoration on a refusal. The layout is O(n²) inside a component, so it
	  must not run for a plan that is not going to be drawn.
	*/
	const placement = useMemo(
		() => (plan && plan.elementCount <= OVERVIEW_CEILING ? overviewLayout(plan.nodes, plan.edges) : null),
		[plan],
	);
	const highlight = useMemo(() => (picture ? highlightSet(rows, query) : null), [picture, rows, query]);
	/*
	  WHAT THE PICTURE NARROWS TO: islands, not dots. A selection or a query resolves to the
	  components those names live on, and the canvas lights, labels and fits its view to them. See
	  `overviewFocus` for why a ring on one dot in a field of fourteen hundred was the wrong answer.
	*/
	const focus = useMemo(
		() => (picture && plan ? overviewFocus(plan.nodes, { selected, matches: highlight, placement }) : null),
		[picture, plan, selected, highlight, placement],
	);

	const empty = emptyState(graph);
	if (empty) {
		return (
			<div className="page">
				<EmptyState heading={empty.heading}>{empty.body}</EmptyState>
			</div>
		);
	}

	/*
	  IN WHOLE SHAPE THE STRIP FOLDS INTO THE SUBTITLE. The four cards restate the picture's own
	  payload (stat.jsx says so), and above the picture they pushed the frame's top to y≈337 and its
	  bottom below the fold. One line carries the same three numbers.
	*/
	const head = (
		<>
			<PageHead
				title="Things your memories talk about"
				subtitle={
					picture
						? `${shape.namedOnce.toLocaleString()} named once · ${shape.componentCount.toLocaleString()} clusters, largest ${shape.largestComponent.toLocaleString()} · ${shape.duplicateGroups.toLocaleString()} possible ${shape.duplicateGroups === 1 ? 'duplicate' : 'duplicates'}`
						: `${shape.nameCount.toLocaleString()} names across ${shape.statementCount.toLocaleString()} statements`
				}
				actions={
					<FindInput
						value={query}
						onChange={(next) => {
							setQuery(next);
							setSelected(null);
						}}
						placeholder="Find a name"
						label="Find a name"
					/>
				}
			/>

			{/*
			  THE SHAPE OF THE THING, STATED BEFORE ANYTHING IS DRAWN.

			  These four readings are the entire informational payload of a whole-vault picture, and
			  here they are legible instead of estimated by eye. The fourth card is not a number: it
			  is the sentence the other three add up to, and it is the reason the duplicates tab is
			  worth a reader's afternoon.
			*/}
			{picture ? null : (
				<StatStrip>
					<Stat value={shape.namedOnce.toLocaleString()}>named once and never again</Stat>
					<Stat value={shape.componentCount.toLocaleString()}>
						separate clusters, largest is {shape.largestComponent.toLocaleString()}
					</Stat>
					<Stat value={shape.duplicateGroups.toLocaleString()} tone="warn">
						look like the same thing, spelled twice
					</Stat>
					<StatNote>
						Names join only when they match character for character, so this is{' '}
						<strong>more connected than it looks.</strong> Every pair you merge turns two loose ends
						into one junction.
					</StatNote>
				</StatStrip>
			)}
		</>
	);

	/*
	  THE DIAL BETWEEN THE THREE RENDERINGS, quiet: three words at the tab height with the current
	  one in ink, the way the bar's four words do it. The active tab is the one filled control on
	  this screen; an inverse-filled segment beside it was two, against tokens.css's own rule.
	*/
	const dial = (
		<div className="view-dial" role="group" aria-label="How to show these names">
			{VIEWS.map((entry, index) => (
				<Fragment key={entry.value}>
					{index > 0 ? (
						<span className="view-dial-sep" aria-hidden="true">
							·
						</span>
					) : null}
					<button
						type="button"
						className="view-dial-item"
						aria-current={view === entry.value ? 'true' : undefined}
						onClick={() => setView(entry.value)}
					>
						{entry.label}
					</button>
				</Fragment>
			))}
		</div>
	);

	/*
	  NO SCROLL REGION OF ITS OWN. `App` already renders every non-list route inside one, so a second
	  `.screen` here would be a scroll container inside a scroll container — two scrollbars, and the
	  inner one with no height to be `flex: 1` of.
	*/
	return (
		<div className="page">
			{head}

			{/*
			  THE ORDERING TABS ARE THE LIST'S. In the two pictures they changed nothing and stayed live
			  — four dead controls — so they are drawn only where they order something. The dial that
			  moves between the three renderings stays, at the right, on every one.
			*/}
			<div className="names-bar">
				{view === 'list' ? (
					<Tabs value={order} onValueChange={setOrder}>
						<TabsList label="How to order these names">
							{NAME_ORDERS.map((entry) => (
								<Tab
									key={entry.id}
									value={entry.id}
									/*
									  The duplicates tab counts GROUPS — one row per question — so it agrees
									  with the card beside it and needs no note to reconcile the two.
									*/
									count={
										entry.id === 'duplicates'
											? shape.duplicateGroups
											: entry.only
												? counts[entry.id]
												: null
									}
									tone={entry.id === 'duplicates' ? 'warn' : 'neutral'}
								>
									{entry.label}
								</Tab>
							))}
						</TabsList>
					</Tabs>
				) : (
					<span />
				)}
				{dial}
			</div>

				{view === 'kinds' ? (
					<KindMatrix graph={graph} schemaKinds={schemaKinds} />
				) : picture ? (
					<Overview
						graph={graph}
						overview={overview}
						plan={plan}
						placement={placement}
						regime={regime}
						reduction={reduction}
						setReduction={setReduction}
						listing={listing}
						setListing={setListing}
						focus={focus}
						selected={selected}
						onSelect={setSelected}
						query={query}
						shape={shape}
						palette={palette}
						onOpenName={onOpenName}
						onOpenMemory={onOpenMemory}
					/>
				) : (
					<NameTable
						/*
						  ONE ROW PER GROUP under "Possible duplicates". Each spelling was its own row with
						  its own "Merge?", so twenty questions were forty rows and the tab said 40 where the
						  card said 20. The busiest spelling leads the row and the others ride on it as chips.
						*/
						rows={order === 'duplicates' ? oneRowPerGroup(visible) : visible}
						order={order}
						query={query}
						onOpenName={onOpenName}
					/>
				)}
		</div>
	);
}

/**
 * The table. Five columns, and the third of them is a bar rather than a number alone.
 *
 * A SPARKLINE WAS THE OBVIOUS CHOICE AND IT WOULD HAVE BEEN A LIE. Degree here runs from 1 to about
 * ten and roughly three rows in four are the constant 1, so a sparkline of that is a flat line for
 * most of the table dressed up as a trend. Discrete ticks say how many, stop there, and are honest
 * about the resolution they have.
 */
function NameTable({ rows, order, query, onOpenName }) {
	/*
	  FORTY ROWS, THEN THE NEXT FORTY ON A PRESS. The table used to draw three hundred — 14,300px of
	  scroll with the sentence that said what was not drawn at the very bottom — under a comment
	  quoting the owner's "scrolled through for ten minutes". The exact remainder is on the button.
	*/
	const [limit, setLimit] = useState(ROW_PAGE);
	if (rows.length === 0) {
		return (
			<EmptyState heading="No name here matches that">
				{query
					? `Nothing in this vault is spelled like “${query}”. Names are matched on the letters you typed and on the same letters with the articles and punctuation dropped, so a near miss is already covered — this is a name your memories have not used.`
					: 'This ordering has nothing in it, which is a statement about the vault rather than about the control.'}
			</EmptyState>
		);
	}

	const drawn = rows.slice(0, limit);

	return (
		<>
		<Table label="Names in this vault" sticky>
			<thead>
				<tr>
					<Th>Name</Th>
					<Th width="130px">Kind</Th>
					<Th width="150px">Connected to</Th>
					<Th width="120px">In memories</Th>
					<Th width="90px">
						<span className="sr-only">What to do about it</span>
					</Th>
				</tr>
			</thead>
			<tbody>
				{drawn.map((row) => (
					<Tr key={row.surface} attention={row.alsoSpelled.length > 0} onClick={() => onOpenName(row.surface)}>
						<Td subject>
							<span className="name-cell">
								{row.surface}
								{/*
								  THE CHIP CARRIES THE OTHER SPELLING, NOT THE WORD "DUPLICATE".
								  A reader deciding whether two names are one thing needs to see both of
								  them; a badge saying "duplicate" sends them somewhere else to find out
								  what it is a duplicate of.
								*/}
								{row.alsoSpelled.map((other) => (
									<Chip key={other} tone="warn">
										also “{other}”
									</Chip>
								))}
							</span>
						</Td>
						<Td>{row.kind ?? <span className="faint">not declared</span>}</Td>
						<Td>
							<DegreeBar count={row.degree} provisional={row.provisional} />
						</Td>
						<Td>{row.memoryCount}</Td>
						<Td>
							<span className="row-action">
								{row.alsoSpelled.length > 0 ? (
									/*
									  The route CARRIES THE NAME, so the queue opens on this pair rather than
									  landing the reader on the whole review to find it among twenty.
									*/
									<a
										className="row-action-warn"
										href={`#/decide?name=${encodeURIComponent(row.surface)}`}
										onClick={(event) => event.stopPropagation()}
									>
										Merge?
									</a>
								) : (
									<span className="row-action-show">Show</span>
								)}
							</span>
						</Td>
					</Tr>
				))}
			</tbody>
		</Table>
		{/*
		  WHAT IS NOT DRAWN, AS AN EXACT NUMBER AND A WAY TO REACH IT. A table that silently stopped
		  at three hundred rows would read as a vault with three hundred names in it.
		*/}
		{rows.length > drawn.length ? (
			<p className="names-more">
				<button type="button" className="link-more" onClick={() => setLimit(limit + ROW_PAGE)}>
					Show the next {Math.min(ROW_PAGE, rows.length - drawn.length).toLocaleString()}
				</button>
				{' · '}
				{(rows.length - drawn.length).toLocaleString()} more in this ordering. The find box above is
				the fast way to one of them.
			</p>
		) : null}
		</>
	);
}

/**
 * HOW MANY ROWS ARE RENDERED AT ONCE, and how many more each press adds.
 *
 * The interesting part of the degree ladder is a few dozen rows and the table is meant to be
 * scanned, not scrolled through for ten minutes — which is a complaint this design already has on
 * the record. Past this the reader is told the exact number that is not drawn, given the control
 * that draws the next page, and reminded of the box that narrows — which is a different thing from
 * a list that silently stops.
 */
const ROW_PAGE = 40;

/**
 * The duplicates ordering, one row per GROUP. Rows arrive busiest first, so the first spelling of a
 * group seen is the one that leads it; every spelling it is "also" is then a chip on that row and
 * not a row of its own.
 */
function oneRowPerGroup(rows) {
	const seen = new Set();
	const out = [];
	for (const row of rows) {
		if (seen.has(row.surface)) continue;
		seen.add(row.surface);
		for (const other of row.alsoSpelled) seen.add(other);
		out.push(row);
	}
	return out;
}

/**
 * The three renderings, as the dial offers them. Words for what each is for, in the order a reader
 * needs them: the list is where names are found, the shape is the occasional diagnostic the owner
 * kept, and kind by kind is the one that shows whether the kind vocabulary has sprawled.
 */
const VIEWS = [
	{ value: 'list', label: 'List' },
	{ value: 'shape', label: 'Whole shape' },
	{ value: 'kinds', label: 'Kind by kind' },
];

/**
 * THE STATE OF HAVING ASKED FOR NOTHING.
 *
 * One frozen value rather than a fresh object per render, so `planView`'s memo does not recompute a
 * plan over a hundred thousand elements every time this screen re-renders for an unrelated reason.
 */
const NOTHING_REDUCED = Object.freeze({
	collapsed: new Set(),
	absorbed: new Set(),
	expanded: new Map(),
});

/**
 * THE WHOLE-VAULT OVERVIEW: the picture, its legend, and two lines of caption.
 *
 * Five things are on this surface and no more. The picture, the legend that decodes it, the sentence
 * that says what it is, the READING that says what the hub guard made of this vault, and — when the
 * reader has typed something — the count of what is lit. The previous design's answer to honesty was
 * four resident paragraphs of caveat, which readers scrolled past; this one is two lines, and the
 * fuller statement is on the panel of any name you open.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE READING IS ON SCREEN WHEN IT SAYS NOTHING QUALIFIES
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The collapse below is keyed to a threshold computed from this vault's own degree distribution, so
 * on a vault where nothing is an outlier it correctly never fires. But **a guard whose null result
 * is invisible is indistinguishable from an absent guard**: from the reader's side "this app cannot
 * hide a name that is eating the picture" and "this app measured your vault and found nothing that
 * needs hiding" are the same empty screen. So the reading is a line in the caption — the busiest
 * name, the bar its own spread sets, and the verdict that follows — and the panel that carries the
 * offer stays absent until there is something to offer.
 */
function Overview({
	graph,
	overview,
	plan,
	placement,
	regime,
	reduction,
	setReduction,
	listing,
	setListing,
	focus,
	selected,
	onSelect,
	query,
	shape,
	palette,
	onOpenName,
	onOpenMemory,
}) {
	if (!overview || !plan) return null;

	/*
	  THE OFFER. It never applies anything: both controls hand a hub back and this screen puts it in
	  the reduction state, which the plan above reads on the next render. `HubRegime` renders nothing
	  at all in the working regime, which is every vault whose busiest name is not an outlier.
	*/
	const offer = (
		<HubRegime
			regime={regime}
			collapsed={reduction.collapsed.size > 0}
			absorbed={reduction.absorbed.size > 0}
			onCollapse={(hub) =>
				setReduction({ ...reduction, collapsed: new Set([...reduction.collapsed, hubNodeId(hub)]) })
			}
			onAbsorb={(hub) =>
				setReduction({ ...reduction, absorbed: new Set([...reduction.absorbed, hubNodeId(hub)]) })
			}
		/>
	);

	if (!placement) {
		return (
			<div className="overview">
				{/*
				  THE OFFER IS ABOVE THE REFUSAL, not instead of it. On a vault whose one hub puts it past
				  this ceiling, the collapse is the way to a picture — and a refusal that named no way out
				  would be the same dead end the reduction ladder was written to avoid.
				*/}
				{offer}
				<TooLargeState heading="This vault is larger than this picture can carry">
					<p>
						{plan.elementCount.toLocaleString()} drawn elements, against a ceiling of{' '}
						{OVERVIEW_CEILING.toLocaleString()} for one picture. The table above holds every one of
						these names and is not affected — a picture that quietly drew part of a vault would look
						exactly like a vault that was that size.
					</p>
					<p>{regimeLine(regime)}</p>
				</TooLargeState>
			</div>
		);
	}

	return (
		<div className="overview">
			{offer}
			<div className="overview-frame">
				<VaultCanvas
					nodes={plan.nodes}
					edges={plan.edges}
					duplicateLinks={overview.duplicateLinks}
					alwaysLabelled={overview.alwaysLabelled}
					layout={placement}
					focus={focus}
					selected={selected}
					onSelect={onSelect}
					onOpen={onOpenName}
				/>
				{/*
				  WHAT THE PICTURE IS NARROWED TO, said in words INSIDE the frame's top edge, and only
				  while it is narrowed: it names the island and carries the one way off this screen —
				  to the name itself. Under the frame it sat below the fold, so a dimmed canvas read
				  as a broken one and the only way to the name was somewhere the reader could not see.
				*/}
				<FocusReading focus={focus} plan={plan} selected={selected} query={query} shape={shape} />
			</div>
			{/*
			  THE LEGEND, UNDER THE FRAME. Over the picture it covered 18% of the drawn arcs at the
			  opening fit, on a canvas that reaches every edge of its frame.
			*/}
			<div className="overview-legend overview-legend-below">
				<KindLegend palette={palette} />
				<span className="overview-legend-sep" aria-hidden="true">
					|
				</span>
				<span>circle size = how often it is named</span>
				{overview.duplicateLinks.length > 0 ? (
					<>
						<span className="overview-legend-sep" aria-hidden="true">
							|
						</span>
						<span className="overview-legend-pair">
							<span className="overview-dash" aria-hidden="true" /> possible duplicate — point at a
							ringed name to see its pair
						</span>
					</>
				) : null}
			</div>

			{/*
			  THE GUARD'S OWN READING. Its words are built in `hub-model.mjs`, beside the numbers they
			  quote, so this screen cannot describe one verdict while the plan above it acted on
			  another. In the working regime — every vault whose busiest name is not an outlier — it
			  is behind a press: "the bar for hiding one is 28" is a label the owner would ask about,
			  shown when the mechanism did nothing. It is still one press from the picture, so "this
			  app found nothing that needs hiding" stays distinguishable from "this app cannot hide".
			*/}
			{regime?.regime === 'working' ? (
				<DetailRows>
					<DetailRow label="What was checked before drawing">
						<p className="copy">{regimeLine(regime)}</p>
					</DetailRow>
				</DetailRows>
			) : (
				<p className="overview-caption">{regimeLine(regime)}</p>
			)}

			{/*
			  THE RECEIPT, and it is absent exactly when nothing has been reduced. Its counts are not
			  this screen's arithmetic: they come from the plan, which produced them by removing the
			  elements, and they are cross-checked in the test against the same projection with nothing
			  asked for.
			*/}
			<HubLedger
				plan={plan}
				state={reduction}
				setState={setReduction}
				onOpenList={(entry) => setListing(entry.id)}
			/>

			{listing ? (
				<HubList
					graph={graph}
					surface={listing}
					onOpen={onOpenMemory}
					onClose={() => setListing(null)}
				/>
			) : null}

		</div>
	);
}

/**
 * The reading under a narrowed picture: which island, how big, and the way to the name.
 *
 * Three cases and three sentences. A selection names the island the click landed on with its
 * size in names and statements, and offers to open the name. A query says how many names matched
 * and on how many islands — and, when there were more islands than the picture lights at once,
 * how many it chose. A query that matched nothing says so, because a wholly dimmed canvas with no
 * sentence under it reads as a broken picture rather than as an honest answer.
 */
function FocusReading({ focus, plan, selected, query, shape }) {
	if (!focus) return null;

	if (focus.reason === 'selected' && selected) {
		const componentId = plan.nodes.find((node) => node.id === selected)?.componentId;
		const members = new Set(plan.nodes.filter((node) => node.componentId === componentId).map((node) => node.id));
		const statements = plan.edges.filter((edge) => members.has(edge.source)).length;
		/*
		  "labelled where the names fit" and not "every name on it is labelled": the paint drops a
		  label that would land on another, so a 206-name island shows a few dozen at the fit and the
		  rest as the reader zooms. The old clause was false on the biggest island in the vault.
		*/
		return (
			<p className="overview-reading">
				<strong>“{selected}”</strong> is one of {members.size.toLocaleString()} names on this island, joined by{' '}
				{statements.toLocaleString()} {statements === 1 ? 'statement' : 'statements'}; labelled where the
				names fit — zoom for the rest. <a href={nameRoute(selected)}>Open “{selected}”</a>
			</p>
		);
	}

	const matched = focus.marked.size;
	if (matched === 0) {
		return (
			<p className="overview-reading">
				<strong>Nothing here is spelled like “{query}”.</strong> The picture is dimmed because nothing on
				it matched; clear the box to light it again.
			</p>
		);
	}
	const islands = focus.islands === 1 ? 'one island' : `${focus.islands.toLocaleString()} islands`;
	return (
		<p className="overview-reading">
			<strong>
				{matched.toLocaleString()} of {shape.nameCount.toLocaleString()} names match “{query}”
			</strong>
			{focus.shown === focus.islands
				? ` — on ${islands}, lit and labelled where the names fit.`
				: ` across ${islands}; the ${focus.shown.toLocaleString()} where the most connected matches sit are lit.`}
		</p>
	);
}
