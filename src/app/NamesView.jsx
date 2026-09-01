import { useMemo, useState } from 'react';

import { buildGraph, emptyState, kindPalette, nearDuplicates } from './graph-model.mjs';
import { HubList } from './HubList.jsx';
import { HubLedger, HubRegime } from './HubPanel.jsx';
import { detectRegime, hubNodeId, planView, regimeLine } from './hub-model.mjs';
import {
	DEFAULT_ORDER,
	NAME_ORDERS,
	OVERVIEW_CAPTION,
	OVERVIEW_CEILING,
	highlightSet,
	nameRows,
	orderCounts,
	orderedRows,
	overviewElements,
	vaultShape,
} from './names-model.mjs';
import { overviewLayout } from './overview-layout.mjs';
import {
	Button,
	Chip,
	DegreeBar,
	EmptyState,
	FindInput,
	Note,
	Icon,
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
export function NamesView({ records, onOpenName, onOpenMemory = () => {} }) {
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
	const [picture, setPicture] = useState(false);
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

	const empty = emptyState(graph);
	if (empty) {
		return (
			<div className="page">
				<EmptyState heading={empty.heading}>{empty.body}</EmptyState>
			</div>
		);
	}

	const head = (
		<>
			<PageHead
				title="Things your memories talk about"
				subtitle={`${shape.nameCount.toLocaleString()} names across ${shape.statementCount.toLocaleString()} statements`}
				actions={
					<FindInput
						value={query}
						onChange={setQuery}
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
		</>
	);

	/*
	  NO SCROLL REGION OF ITS OWN. `App` already renders every non-list route inside one, so a second
	  `.screen` here would be a scroll container inside a scroll container — two scrollbars, and the
	  inner one with no height to be `flex: 1` of.
	*/
	return (
		<div className="page">
			{head}

			<Tabs value={order} onValueChange={setOrder}>
					<div className="names-bar">
						<TabsList label="How to order these names">
							{NAME_ORDERS.map((entry) => (
								<Tab
									key={entry.id}
									value={entry.id}
									count={entry.only ? counts[entry.id] : null}
									tone={entry.id === 'duplicates' ? 'warn' : 'neutral'}
								>
									{entry.label}
								</Tab>
							))}
						</TabsList>

						{/*
						  The way into the picture, and it says what the picture is FOR rather than what
						  it is made of. "Whole shape" is a job; "graph view" is a rendering technique,
						  and a reader who presses it expecting to find something will not.
						*/}
						<Button onClick={() => setPicture((on) => !on)} aria-pressed={picture}>
							{picture ? 'Back to the list' : 'Whole shape'}
						</Button>
					</div>
				</Tabs>

				{picture ? (
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
						highlight={highlight}
						query={query}
						shape={shape}
						palette={palette}
						onOpenName={onOpenName}
						onOpenMemory={onOpenMemory}
					/>
				) : (
					<>
						{/*
						  TWO NUMBERS, TWO UNITS, SAID OUT LOUD.

						  The card above counts GROUPS — twelve things that may be one thing each — and this
						  tab counts NAMES, because each spelling is its own row. Both are true and they are
						  different, so the sentence that reconciles them is on the screen rather than left
						  for the reader to work out from a card and a tab that disagree.
						*/}
						{order === 'duplicates' && visible.length > 0 ? (
							<Note tone="warn">
								{visible.length.toLocaleString()} names, in {shape.duplicateGroups.toLocaleString()}{' '}
								groups. Each group is one question — these names did not join because they are not
								spelled identically, and only you can say whether they are the same thing.
							</Note>
						) : null}
						<NameTable rows={visible} order={order} query={query} onOpenName={onOpenName} />
					</>
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
	if (rows.length === 0) {
		return (
			<EmptyState heading="No name here matches that">
				{query
					? `Nothing in this vault is spelled like “${query}”. Names are matched on the letters you typed and on the same letters with the articles and punctuation dropped, so a near miss is already covered — this is a name your memories have not used.`
					: 'This ordering has nothing in it, which is a statement about the vault rather than about the control.'}
			</EmptyState>
		);
	}

	const drawn = rows.slice(0, ROW_LIMIT);

	return (
		<>
		<Table label="Names in this vault">
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
									<a className="row-action-warn" href="#/decide" onClick={(event) => event.stopPropagation()}>
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
				{(rows.length - drawn.length).toLocaleString()} more names in this ordering are not drawn.
				Type in the find box above to narrow to the one you want.
			</p>
		) : null}
		</>
	);
}

/**
 * HOW MANY ROWS ARE RENDERED AT ONCE.
 *
 * The interesting part of the degree ladder is a few dozen rows and the table is meant to be
 * scanned, not scrolled through for ten minutes — which is a complaint this design already has on
 * the record. Above this the reader is told the exact number that is not drawn and given the
 * control that narrows it, which is a different thing from a list that silently stops.
 */
const ROW_LIMIT = 300;

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
	highlight,
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

	const lit = highlight === null ? null : highlight.size;

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
					highlight={highlight}
					onSelect={(id) => {
						if (id) onOpenName(id);
					}}
					onOpen={onOpenName}
				/>
				<div className="overview-legend">
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
							<span className="overview-legend-warn">
								<span className="overview-dash" aria-hidden="true" /> two spellings, one thing?
							</span>
						</>
					) : null}
				</div>
			</div>

			<p className="overview-caption">
				{OVERVIEW_CAPTION}
				{lit === null ? null : (
					<>
						{' '}
						<strong>
							{lit === 0
								? `Nothing here is spelled like “${query}”.`
								: `${lit.toLocaleString()} of ${shape.nameCount.toLocaleString()} names match “${query}”.`}
						</strong>
					</>
				)}
			</p>

			{/*
			  THE GUARD'S OWN READING, IN ONE LINE. Its words are built in `hub-model.mjs`, beside the
			  numbers they quote, so this screen cannot describe one verdict while the plan above it
			  acted on another.
			*/}
			<p className="overview-caption">{regimeLine(regime)}</p>

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

			<p className="overview-hint">
				<Icon.Info size={13} className="icon" />
				Scroll to zoom, drag to move, click a name to open it. Names are labelled once you are close
				enough for the labels to fit.
			</p>
		</div>
	);
}
