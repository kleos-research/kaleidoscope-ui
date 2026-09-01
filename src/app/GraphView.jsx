import { useCallback, useEffect, useMemo, useState } from 'react';

import { GraphCanvas } from './GraphCanvas.jsx';
import {
	DEFAULT_LENS,
	DRAW_CAP,
	DRAW_TARGET,
	LENSES,
	buildGraph,
	decodeGraphView,
	defaultView,
	emptyState,
	encodeGraphView,
	entityNodeId,
	fidelityReading,
	filterProjection,
	isolatedFacts,
	kindConflicts,
	kindPalette,
	lensById,
	modelWarning,
	nearDuplicates,
	onceUsedPredicates,
	parseNodeId,
	projectLens,
	scopeSurfaces,
} from './graph-model.mjs';
import { HubList } from './HubList.jsx';
import { HubLedger, HubRegime } from './HubPanel.jsx';
import { detectRegime, hubNodeId, hubScope, planView, reductionOptions } from './hub-model.mjs';
import { Chip, Disclosure, EmptyState, NotRecorded } from './ui.jsx';

/** Above this many edges the edge labels are a grey smear, so they come off and the legend says so. */
const EDGE_LABEL_CEILING = 220;

/** A relationship name used this many times or more draws solid. Below it, pale and dashed. */
const COMMON_PREDICATE_USES = 5;

const nodeSize = (degree) => Math.max(12, Math.min(48, 11 + Math.sqrt(degree) * 9));

/**
 * How much of a memory's title fits on a node before the drawing becomes a wall of text.
 *
 * A memory node is as wide as its label, so an untrimmed title is a box several times the size of
 * the thing it is joined to, and thirty of them overlap into something nobody can read.
 */
const LABEL_LIMIT = 52;

const shorten = (value) => {
	const text = String(value ?? '');
	if (text.length <= LABEL_LIMIT) return text;
	const cut = text.slice(0, LABEL_LIMIT);
	const boundary = cut.lastIndexOf(' ');
	return `${(boundary > LABEL_LIMIT / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
};

/**
 * The reconstructed graph.
 *
 * This screen is not navigation and it is not decoration. It is the only surface in the product
 * that can show a person that two spellings of one thing became two things, and that half of what
 * they have written is joined to nothing.
 *
 * ONE MODEL, THREE LENSES. `buildGraph` runs once per payload; a lens is `projectLens` over that
 * same result, so switching lens rebuilds nothing and cannot produce a second model that disagrees
 * with the first. See the lens section of `graph-model.mjs` for the measured reason C is the
 * default and E — the lens that shipped first, and the only one with no memory node on it — is not.
 *
 * IT ISSUES NO DOOR CALL OF ITS OWN (PRD R2). The engine's own health reading arrives as a prop
 * from the poll the app already runs for every screen; this screen never fetches, which is what
 * keeps the fidelity strip's second set of counts from costing an engine process per visit.
 *
 * @param {object} props
 * @param {Array<object>} props.records the cached export
 * @param {object|null} [props.health]  the engine's last health reading, as `/api/health` serves it
 * @param {object|null} [props.model]   the engine's embedding-model reading from the launch preflight
 * @param {string} [props.view]         the view state, from the URL fragment. INITIAL STATE ONLY —
 *        this screen owns the fragment after it mounts and writes it with `replaceState`.
 */
export function GraphView({ records, onOpen, onBack, health = null, model = null, view = '' }) {
	const graph = useMemo(() => buildGraph(records), [records]);
	const palette = useMemo(() => kindPalette(graph), [graph]);
	const duplicates = useMemo(() => nearDuplicates(graph), [graph]);
	const conflicts = useMemo(() => kindConflicts(graph), [graph]);
	const conflictSet = useMemo(() => new Set(conflicts.map((entry) => entry.surface)), [conflicts]);
	const islands = useMemo(() => isolatedFacts(graph), [graph]);
	const onceUsed = useMemo(() => onceUsedPredicates(graph), [graph]);

	// The whole view, decoded from the fragment ONCE. A reload, a Back out of a memory and a pasted
	// link all arrive here; after that this component is the owner and the URL follows it.
	const restored = useMemo(() => decodeGraphView(view), [view]);

	const [lens, setLens] = useState(restored.lens);
	// `null` means "whatever the ladder chooses for this lens", which is not the same as any
	// particular scope: it is what lets a lens change re-derive its own default while an explicit
	// scope survives one. The URL carries the same distinction by omitting the parameter.
	const [scope, setScope] = useState(restored.scope);
	const [kindFilter, setKindFilter] = useState(restored.kindFilter);
	const [typeFilter, setTypeFilter] = useState(restored.typeFilter);
	const [selected, setSelected] = useState(restored.selected);
	const [showLoners, setShowLoners] = useState(restored.showUnconnectedMemories);
	const [focus, setFocus] = useState(null);
	const [query, setQuery] = useState('');
	const [hover, setHover] = useState(null);

	/**
	 * THE HUB REDUCTIONS, as three collections rather than as a boolean per node.
	 *
	 * Held together in one state object because they are read together by one pure function, and
	 * because "reversible" then means removing a key from one of them — which is `applyUndo`, a
	 * function a test can drive. Split across three `useState` calls the reversal would live in the
	 * component, where the only way to check it is to click.
	 */
	const [hubState, setHubState] = useState(() => ({
		collapsed: new Set(restored.collapsed),
		absorbed: new Set(restored.absorbed),
		expanded: new Map(restored.expanded),
	}));
	const [openList, setOpenList] = useState(null);

	const initial = useMemo(() => defaultView(graph, { lens }), [graph, lens]);
	const activeScope = scope ?? initial.scope;

	/**
	 * THE VIEW, WRITTEN BACK INTO THE FRAGMENT.
	 *
	 * `replaceState`, never a push: ticking a filter is not a navigation, and forty history entries
	 * for one screen make Back useless — which matters more here than usual, because Back is how a
	 * user returns from a memory they clicked to the drawing they clicked it from.
	 *
	 * THE FRAGMENT IS COMPOSED FROM THE STATE AND FROM NOTHING ELSE. The launch token arrives in
	 * this same fragment (`#token=…`) and is erased after one read, so the tempting implementation —
	 * read the fragment, set one parameter, write it back — would copy that credential into a
	 * history entry, where it outlives the tab. `encodeGraphView` takes state and returns a string;
	 * it never reads `location`. And this screen cannot even run before the capture: it only mounts
	 * on the `#/graph` route, which the fragment cannot be while it still holds a token.
	 *
	 * What this buys and what it does not: a reload restores the VIEW and cannot restore the
	 * SESSION. The token is minted per launch, held in one variable, and deliberately not persisted
	 * anywhere — so a reloaded tab has no credential and the sidecar answers 401 with the sentence
	 * that says to relaunch. Making reload work would mean storing a credential with total
	 * read/write authority over the vault, which is a worse product than an honest 401.
	 */
	useEffect(() => {
		const search = encodeGraphView({
			lens,
			scope,
			kindFilter,
			typeFilter,
			selected,
			showUnconnectedMemories: showLoners,
			// A REDUCTION IS THE ONE PIECE OF VIEW STATE THAT TAKES THINGS AWAY, so it is the one that
			// most needs to travel with the link. Sending someone a URL that carried the lens and the
			// scope but not the collapse would show them a different picture from the one being
			// described, with nothing on either screen able to say so.
			collapsed: hubState.collapsed,
			absorbed: hubState.absorbed,
			expanded: hubState.expanded,
		});
		const next = `#/graph${search ? `?${search}` : ''}`;
		if (window.location.hash !== next) {
			window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
		}
	}, [lens, scope, kindFilter, typeFilter, selected, showLoners, hubState]);

	const memoryTypes = useMemo(() => {
		const counts = new Map();
		for (const edge of graph.edges) {
			if (edge.memory_type) counts.set(edge.memory_type, (counts.get(edge.memory_type) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
	}, [graph]);

	const predicateUses = useMemo(
		() => new Map(graph.predicates.map((entry) => [entry.predicate, entry.count])),
		[graph],
	);

	/** The surfaces the current scope asks for, before any filter. One rule for all three lenses. */
	const scoped = useMemo(() => scopeSurfaces(graph, activeScope), [graph, activeScope]);

	/**
	 * Scope, then lens, then filters — and the element count computed BEFORE anything is drawn, so
	 * a refusal names its own number and every reduction button carries its own.
	 */
	const projection = useMemo(
		() => projectLens(graph, { lens, surfaces: scoped, showUnconnectedMemories: showLoners }),
		[graph, lens, scoped, showLoners],
	);
	const drawn = useMemo(
		() => filterProjection(projection, { kindFilter, typeFilter, keep: selected }),
		[projection, kindFilter, typeFilter, selected],
	);

	/**
	 * REGIME DETECTION, at load, before anything is drawn — PRD 0005 R16.
	 *
	 * One pass over the degree distribution of the reconstruction, which is where it belongs: the
	 * reading is about what the agents wrote, not about which lens is selected. `projectedElements`
	 * is the second half of it, and it is lens-dependent — whether a hub FORCES a treatment is a
	 * statement about the drawing about to happen, and the same vault is over the cap in one lens and
	 * comfortable in another.
	 */
	const regime = useMemo(
		() => detectRegime(graph, { projectedElements: projection.elementCount }),
		[graph, projection],
	);

	/**
	 * The plan: the drawn elements after the reductions the user has asked for, plus the ledger of
	 * exactly what each one took away. With nothing asked for this returns `drawn` unchanged, which
	 * is the property that makes "nothing narrows silently" true by construction rather than by
	 * inspection.
	 *
	 * The selection is PINNED. A node the user has open must not vanish into a box because they then
	 * collapsed its neighbour — the panel beside it would be describing something that is no longer
	 * anywhere on screen.
	 */
	const plan = useMemo(
		() => planView(drawn, { ...hubState, pinned: selected }),
		[drawn, hubState, selected],
	);

	const overCap = plan.elementCount > DRAW_CAP;
	const vacant = useMemo(() => emptyState(graph, { lens }), [graph, lens]);

	// The undeclared marker's polarity is computed from this vault, never hardcoded. It is a useful
	// exception marker while undeclared endpoints are rare; where they are the majority it must
	// invert and mark the declared ones instead, or it marks nearly every node and says nothing.
	const markUndeclared = graph.counts.undeclaredNodeCount * 2 <= graph.counts.nodeCount;

	const elements = useMemo(() => {
		if (overCap || vacant || drawn.refusal) return { nodes: [], edges: [] };
		return {
			nodes: [
				// THE META-NODES FIRST. A compound parent has to exist before the children that name
				// it, and Cytoscape adds a collection in order — a child whose parent is later in the
				// array is added with no parent at all, which draws a plausible picture with the boxes
				// silently missing.
				...plan.metaNodes.map((meta) => ({
					id: meta.id,
					kind: 'meta',
					label: `${meta.label}\n${meta.hiddenNodes.toLocaleString()} more inside`,
					slot: -1,
					size: 0,
					marked: false,
					conflict: false,
					degree: meta.drawnDegree,
				})),
				...plan.nodes.map((entry) => {
					if (entry.kind === 'memory') {
						return {
							id: entry.id,
							kind: 'memory',
							// The title, and what the memory is. A memory node is a different SHAPE from an
							// entity node as well as a different colour, so the two are told apart without
							// colour — the encoding rule this screen holds everywhere.
							//
							// Shortened at a WORD boundary with an ellipsis the reader can see, and never
							// clipped: a title cut mid-word reads as a different title, which is the exact
							// defect this canvas shipped with once already. The hover card carries the whole
							// title, and the memory is one click away.
							label: shorten(entry.title ?? entry.memory_id),
							slot: -1,
							size: nodeSize(Math.max(1, entry.memory.factCount)),
							marked: false,
							conflict: false,
							degree: entry.degree,
							parent: entry.parent ?? undefined,
							badges: entry.badges.length > 0 ? entry.badges.length : undefined,
						};
					}
					const node = entry.node;
					const kind = [...node.kinds.keys()][0] ?? null;
					return {
						id: entry.id,
						kind: 'entity',
						label: kind ? `${node.surface}\n${kind}` : node.surface,
						slot: palette.slotOf(kind),
						size: nodeSize(node.degree),
						marked: markUndeclared ? !node.declared : node.declared,
						conflict: conflictSet.has(node.surface),
						degree: node.degree,
						parent: entry.parent ?? undefined,
						// The badges an absorbed name left behind. On the node, in text, because that is
						// what "it became an attribute of its neighbours" has to mean on screen.
						badges: entry.badges.length > 0 ? entry.badges.length : undefined,
					};
				}),
			],
			edges: plan.edges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				label: edge.label ?? '',
				kind: edge.kind,
				band:
					edge.kind === 'claim'
						? (predicateUses.get(edge.predicate) ?? 0) >= COMMON_PREDICATE_USES
							? 'common'
							: 'rare'
						: 'common',
			})),
		};
	}, [drawn, plan, overCap, vacant, palette, conflictSet, predicateUses, markUndeclared]);

	/**
	 * A CLICK ON A MEMORY NODE OPENS THAT MEMORY. That is the point of drawing memories at all: in
	 * the lens that shipped first there was no memory on the canvas, so a node's only route into a
	 * verb was a link in a side panel. Opening is safe to do on a single click precisely because the
	 * view is in the URL — Back returns to this exact drawing, same lens, same scope, same filters.
	 */
	const onNode = useCallback(
		(id) => {
			const parsed = id ? parseNodeId(id) : null;
			if (parsed?.kind === 'memory') {
				onOpen(parsed.memory_id);
				return;
			}
			setSelected(id);
		},
		[onOpen],
	);

	const selectedNode = useMemo(() => {
		const parsed = selected ? parseNodeId(selected) : null;
		return parsed?.kind === 'entity' ? (graph.nodes.get(parsed.surface) ?? null) : null;
	}, [graph, selected]);

	const railFullWidth = vacant?.railFullWidth ?? false;

	// THE HEADER AND THE STRIP COUNT THE PLAN, NOT THE PROJECTION.
	//
	// This was the one defect the two halves of this screen left between them, and no test could see
	// it because it is a join rather than a value. The lens half computes `drawn` — the projection
	// after the facet filters — and wrote the header and the fidelity strip against it. The hub half
	// then computes `plan`, which is `drawn` after the reductions, and draws the canvas from that.
	// So after a collapse the canvas held a few dozen elements, the ledger beside it said "this view
	// draws N of M", and the header above them both said M were drawn. Two numbers about one picture
	// disagreeing on one screen — and the wrong one was the LARGER, which is the exact direction the
	// hub programme exists to prevent: a reduced view reading as a complete one.

	return (
		<div className="graph">
			<GraphHeader
				graph={graph}
				lens={lens}
				setLens={setLens}
				scope={activeScope}
				explicitScope={scope}
				setScope={setScope}
				initial={initial}
				projection={projection}
				drawn={plan}
				memoryTypes={memoryTypes}
				kindFilter={kindFilter}
				setKindFilter={setKindFilter}
				typeFilter={typeFilter}
				setTypeFilter={setTypeFilter}
				palette={palette}
				query={query}
				setQuery={setQuery}
				showLoners={showLoners}
				setShowLoners={setShowLoners}
				onFocus={(surface) => {
					setFocus(entityNodeId(surface));
					setSelected(entityNodeId(surface));
				}}
				onBack={onBack}
			/>

			<div className={`graph-body${railFullWidth ? ' graph-body-rail-only' : ''}`}>
				{/*
				  THE SENTENCE HAS NOWHERE ELSE TO GO IN THIS LAYOUT. The rail-full-width state does not
				  render the stage at all, and the stage is where every other empty state's words live —
				  so without this the screen shows a bare list under a header and reads as a canvas that
				  failed to load, which is the single reading this state exists to prevent. The model was
				  right and nothing rendered it, which is a join, and a join is what no test over
				  `emptyState` can see.
				*/}
				{railFullWidth ? (
					<EmptyState
						heading={vacant.heading}
						action={
							<button type="button" className="button" onClick={() => setLens('E')}>
								Show it as claims instead
							</button>
						}
					>
						<p>{vacant.body}</p>
					</EmptyState>
				) : null}
				{railFullWidth ? null : (
					<div className="graph-stage">
						{vacant ? (
							<EmptyState heading={vacant.heading}>
								<p>{vacant.body}</p>
							</EmptyState>
						) : drawn.refusal ? (
							<div className="state state-empty graph-refusal">
								<h2>This lens will not compute this view</h2>
								<p>{drawn.refusal.reason}</p>
							</div>
						) : overCap ? (
							<TooLarge
								graph={graph}
								lens={lens}
								drawn={plan}
								regime={regime}
								setScope={setScope}
								setHubState={setHubState}
								memoryTypes={memoryTypes}
								clearFilters={() => {
									setKindFilter([]);
									setTypeFilter([]);
								}}
							/>
						) : drawn.elementCount === 0 ? (
							<EmptyState
								heading={
									projection.emptyReason === 'no-connectors'
										? 'Nothing in this scope joins two memories'
										: 'Nothing matches this combination'
								}
								action={
									<button
										type="button"
										className="button"
										onClick={() => {
											setKindFilter([]);
											setTypeFilter([]);
											if (projection.emptyReason === 'no-connectors') setLens('E');
										}}
									>
										{projection.emptyReason === 'no-connectors'
											? 'Show it as claims instead'
											: 'Clear the filters'}
									</button>
								}
							>
								{/*
								  THE SCOPE LADDER SURVIVES A LENS CHANGE, AND THIS IS WHERE IT STOPS MEANING
								  SOMETHING. Every scope is a statement about names, so all six carry across; a
								  scope whose names are each touched by one memory still draws in Claims and
								  draws nothing here, because nothing in it joins two memories. Saying which
								  lens would show it is the difference between an answer and a blank stage.
								*/}
								<p>
									{projection.emptyReason === 'no-connectors'
										? `The ${scoped.size.toLocaleString()} names in this scope are each mentioned by exactly one memory, so at the memory level nothing in it connects. The facts are still there — the Claims lens draws them.`
										: 'The scope and the filters do not overlap. Nothing has been hidden by this screen.'}
								</p>
							</EmptyState>
						) : (
							<>
								<GraphCanvas
									elements={elements}
									onSelect={onNode}
									onHover={(id, position) => setHover(id ? { id, position } : null)}
									focus={focus}
									showEdgeLabels={drawn.edges.length <= EDGE_LABEL_CEILING}
								/>
								{hover ? <HoverCard graph={graph} hover={hover} /> : null}
							</>
						)}
						{openList ? (
							<HubList
								graph={graph}
								surface={openList}
								onOpen={onOpen}
								onClose={() => setOpenList(null)}
							/>
						) : null}
					</div>
				)}

				<aside className={`graph-rail${railFullWidth ? ' graph-rail-wide' : ''}`}>
					{/*
					  THE REGIME AND THE RECEIPT, above everything else in the rail, because a reader
					  who does not know the view has been reduced reads the drawing as the vault.
					*/}
					<HubRegime
						regime={regime}
						lens={lens}
						collapsed={regime.hubs[0] ? hubState.collapsed.has(hubNodeId(regime.hubs[0])) : false}
						absorbed={regime.hubs[0] ? hubState.absorbed.has(hubNodeId(regime.hubs[0])) : false}
						onCollapse={(hub) => {
							setScope(hubScope(hub));
							setHubState((state) => ({
								...state,
								collapsed: new Set([...state.collapsed, hubNodeId(hub)]),
							}));
						}}
						onAbsorb={(hub) => {
							setScope(hubScope(hub));
							setHubState((state) => ({
								...state,
								absorbed: new Set([...state.absorbed, hubNodeId(hub)]),
							}));
						}}
					/>

					<HubLedger
						plan={plan}
						state={hubState}
						setState={setHubState}
						lens={lens}
						onOpenList={(entry) => {
							const parsed = parseNodeId(entry.id);
							setOpenList(parsed?.kind === 'entity' ? parsed.surface : null);
						}}
					/>

					{selectedNode ? (
						<Selection
							graph={graph}
							node={selectedNode}
							onOpen={onOpen}
							onClose={() => setSelected(null)}
							onExpand={() =>
								setScope({ kind: 'ego', seed: selectedNode.surface, depth: 2 })
							}
						/>
					) : null}

					<Unconnected
						projection={projection}
						showLoners={showLoners}
						setShowLoners={setShowLoners}
						onOpen={onOpen}
						lens={lens}
					/>

					<Fragmentation
						graph={graph}
						duplicates={duplicates}
						conflicts={conflicts}
						islands={islands}
						onceUsed={onceUsed}
						onOpen={onOpen}
						onShowComponent={(componentId) => setScope({ kind: 'component', componentId })}
						onFocusSurface={(surface) => {
							setScope({ kind: 'ego', seed: surface, depth: 2 });
							setSelected(entityNodeId(surface));
							setFocus(entityNodeId(surface));
						}}
					/>
				</aside>
			</div>

			<Fidelity
				graph={graph}
				drawn={plan}
				palette={palette}
				markUndeclared={markUndeclared}
				lens={lens}
				health={health}
				model={model}
			/>
		</div>
	);
}

/**
 * The lens switch.
 *
 * Three buttons rather than a dropdown, because which lens is on is the single most load-bearing
 * fact about what the user is looking at: the same vault as memories, as memories-plus-names, and
 * as names is three different pictures with three different sizes, and a picture whose lens is
 * hidden behind a closed control is a picture nobody can interpret. Each button says what it draws.
 */
function LensSwitch({ lens, setLens, counts }) {
	return (
		<div className="graph-lenses" role="group" aria-label="Lens">
			{LENSES.map((entry) => (
				<button
					key={entry.id}
					type="button"
					className={`graph-lens${entry.id === lens ? ' is-on' : ''}`}
					aria-pressed={entry.id === lens}
					onClick={() => setLens(entry.id)}
					title={entry.summary}
				>
					<strong>{entry.name}</strong>
					<span className="graph-lens-what">{entry.summary}</span>
					<span className="graph-tag-count">{counts[entry.id]?.toLocaleString() ?? '—'} elements</span>
				</button>
			))}
		</div>
	);
}

function GraphHeader({
	graph,
	lens,
	setLens,
	scope,
	explicitScope,
	setScope,
	initial,
	projection,
	drawn,
	memoryTypes,
	kindFilter,
	setKindFilter,
	typeFilter,
	setTypeFilter,
	palette,
	query,
	setQuery,
	showLoners,
	setShowLoners,
	onFocus,
	onBack,
}) {
	const toggle = (list, setList, value) =>
		setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

	// Each lens's size in THIS scope, computed before any of them is drawn, so the switch is a
	// choice with its cost on it rather than a surprise.
	const lensCounts = useMemo(() => {
		const surfaces = scopeSurfaces(graph, scope);
		const counts = {};
		for (const entry of LENSES) {
			const size = projectLens(graph, { lens: entry.id, surfaces });
			counts[entry.id] = size.refusal ? null : size.elementCount;
		}
		return counts;
	}, [graph, scope]);

	const memoryNodes = drawn.nodes.filter((node) => node.kind === 'memory').length;
	const entityNodes = drawn.nodes.length - memoryNodes;
	// `drawn` here is the PLAN, so it carries its own ledger. Zero on an unreduced view.
	const hiddenTotal = (drawn.hidden?.nodes ?? 0) + (drawn.hidden?.edges ?? 0);

	return (
		<div className="graph-header">
			<div className="graph-header-row">
				<button type="button" className="button" onClick={onBack}>
					← The list
				</button>
				<h1>Reconstructed graph</h1>
				<span className="graph-count">
					{memoryNodes > 0 ? `${memoryNodes.toLocaleString()} memories · ` : ''}
					{entityNodes > 0 ? `${entityNodes.toLocaleString()} names · ` : ''}
					{drawn.edges.length.toLocaleString()} {lens === 'E' ? 'facts' : 'joins'} drawn
					{drawn.elementCount > DRAW_TARGET ? <em> — past comfortable, still drawn</em> : null}
					{/* The reduction, named in the same breath as the count it changed. The count above
					    is the plan's, so it is already the true one; without this clause it would be a
					    true number that reads as the whole vault. */}
					{hiddenTotal > 0 ? (
						<em>
							{' '}
							— {hiddenTotal.toLocaleString()} more hidden by a reduction you asked for, itemised in
							the rail
						</em>
					) : null}
				</span>
			</div>

			<LensSwitch lens={lens} setLens={setLens} counts={lensCounts} />

			{/* The banner names which rule chose what is on screen. A reduction the user was not told
			    about is a truncation, and a truncation is a refusal spelled as an answer. */}
			<p className="graph-banner">
				{explicitScope === null
					? initial.reason
					: scope.kind === 'all'
						? lens === 'E'
							? `Everything: ${graph.counts.componentCount} separate groups. This is the shape, and it is mostly islands.`
							: `Every memory that shares a name with another one.`
						: scope.kind === 'component'
							? `One group: ${graph.components.find((c) => c.id === scope.componentId)?.size ?? 0} names${lens === 'E' ? '' : ', and the memories that touch them'}.`
							: scope.kind === 'ego'
								? `${scope.depth ?? 2} steps around “${scope.seed}”.`
								: scope.kind === 'degree'
									? `Names used by ${scope.minDegree ?? 3} facts or more.`
									: scope.kind === 'memory_type'
										? `Facts asserted by memories of type “${scope.memoryType}”.`
										: initial.reason}
			</p>

			<div className="graph-controls">
				<label className="graph-control">
					<span>Show</span>
					<select
						value={
							explicitScope === null
								? 'default'
								: scope.kind === 'component'
									? `component:${scope.componentId}`
									: scope.kind
						}
						onChange={(event) => {
							const value = event.target.value;
							if (value.startsWith('component:')) setScope({ kind: 'component', componentId: value.slice(10) });
							else if (value === 'all') setScope({ kind: 'all' });
							// Back to "whatever this lens's ladder picks", which is not the same as any one
							// scope: it is the state the URL encodes by omitting the parameter.
							else setScope(null);
						}}
					>
						<option value="default">{initial.rule === 'whole-vault' ? 'Everything (the default)' : 'The default view'}</option>
						{graph.components.slice(0, 25).map((component) => (
							<option key={component.id} value={`component:${component.id}`}>
								{component.size} names · {component.label}
							</option>
						))}
						<option value="all">
							Everything — {(graph.counts.nodeCount + graph.counts.edgeCount).toLocaleString()} names and facts
						</option>
					</select>
				</label>

				<label className="graph-control graph-search">
					<span>Find a name</span>
					<input
						type="search"
						list="graph-surfaces"
						value={query}
						placeholder="type a name…"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== 'Enter') return;
							const needle = query.trim().toLowerCase();
							const match =
								graph.nodes.get(query.trim()) ??
								[...graph.nodes.values()].find((node) => node.surface.toLowerCase().includes(needle));
							if (match) onFocus(match.surface);
						}}
					/>
					<datalist id="graph-surfaces">
						{[...graph.nodes.keys()].slice(0, 1000).map((surface) => (
							<option key={surface} value={surface} />
						))}
					</datalist>
				</label>

				{lens === 'E' ? null : (
					<label className="graph-control graph-toggle">
						<input
							type="checkbox"
							checked={showLoners}
							onChange={(event) => setShowLoners(event.target.checked)}
						/>
						<span>
							Draw the {projection.unconnected.length.toLocaleString()} memories that share no name
						</span>
					</label>
				)}
			</div>

			<div className="graph-facets">
				<div className="graph-facet">
					<span className="graph-facet-label">Kind</span>
					{palette.named.map((entry) => (
						<button
							key={entry.kind}
							type="button"
							className={`graph-tag${kindFilter.includes(entry.kind) ? ' is-on' : ''}`}
							onClick={() => toggle(kindFilter, setKindFilter, entry.kind)}
						>
							<span className={`graph-swatch k${entry.slot}`} aria-hidden="true" />
							{entry.kind} <span className="graph-tag-count">{entry.count}</span>
						</button>
					))}
					{palette.otherCount > 0 ? (
						<span className="graph-facet-more">+{palette.otherCount} more kinds, drawn grey and labelled</span>
					) : null}
				</div>

				<div className="graph-facet">
					<span className="graph-facet-label">Memory type</span>
					{memoryTypes.map((entry) => (
						<button
							key={entry.value}
							type="button"
							className={`graph-tag${typeFilter.includes(entry.value) ? ' is-on' : ''}`}
							onClick={() => toggle(typeFilter, setTypeFilter, entry.value)}
						>
							{entry.value} <span className="graph-tag-count">{entry.count}</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * The memories that share no name with any other memory.
 *
 * RELOCATION, NOT SUPPRESSION, and this list is the whole difference between the two. Lens C draws
 * the connectors, so a memory whose every name is its own alone has no edge and would be a floating
 * dot — dozens of them, telling the reader nothing and costing the layout everything. They are not
 * dropped: they are counted here, listed here, opened from here, and the checkbox in the header
 * draws them anyway for anyone who wants to see the shape with them in it.
 */
function Unconnected({ projection, showLoners, setShowLoners, onOpen, lens }) {
	if (lens === 'E' || projection.unconnected.length === 0) return null;
	return (
		<section className="graph-findings">
			<Disclosure
				title="Memories that share no name with another"
				count={projection.unconnected.length}
			>
				<p className="graph-note">
					Each of these names things no other memory names, so nothing joins it to the rest of the
					vault at the memory level. They are not drawn by default — {projection.unconnected.length}{' '}
					unattached dots teach nothing — and they are not hidden either.{' '}
					<button type="button" className="linklike" onClick={() => setShowLoners(!showLoners)}>
						{showLoners ? 'Stop drawing them' : 'Draw them anyway'}
					</button>
				</p>
				<ul className="graph-memories">
					{projection.unconnected.slice(0, 60).map((memory) => (
						<li key={memory.memory_id}>
							<button type="button" className="linklike" onClick={() => onOpen(memory.memory_id)}>
								{memory.title ?? memory.memory_id}
							</button>
							{memory.memory_type ? <Chip>{memory.memory_type}</Chip> : null}
							<span className="graph-tag-count">{memory.surfaces.length} names</span>
						</li>
					))}
				</ul>
				{projection.unconnected.length > 60 ? (
					<p className="graph-note">…and {projection.unconnected.length - 60} more.</p>
				) : null}
			</Disclosure>
		</section>
	);
}

/**
 * The too-large state is a control panel, never a silent truncation.
 *
 * Every button carries the element count it would produce, computed here before anything is drawn.
 * The user picks the reduction. If this screen picked one quietly the reader could not tell a
 * sparse vault from a cropped view, and would have no reason to suspect the difference.
 */
function TooLarge({ graph, lens, drawn, regime, setScope, setHubState, memoryTypes, clearFilters }) {
	// EVERY BUTTON'S COUNT IS COMPUTED IN THE LENS THAT IS ON, by `reductionOptions`. The same
	// reduction is a different size in each lens — the whole point of the C projection is that it is
	// several times smaller — so a panel that counted in one lens and drew in another would offer
	// numbers that are simply not what happens when the button is pressed.
	//
	// It is a pure function in the model rather than arithmetic in this component for one reason:
	// until there was a fixture that crossed the cap, none of it had ever run. The first fixture that
	// did found the panel offering five reductions and no way out — every rung was still over the
	// cap, and the only escape was a sentence pointing at the search box, which is the one control
	// here with no number on it. The ego rungs and the collapse rung exist because that ran.
	const options = reductionOptions(graph, { lens, memoryTypes, hubs: regime?.hubs ?? [] });

	return (
		<div className="state state-empty graph-refusal">
			<h2>This view would draw {drawn.elementCount.toLocaleString()} elements</h2>
			<p>
				That is past what a person can read, not past what the browser can render — the machine
				would draw it at a fine framerate and it would teach you nothing. This version draws up to{' '}
				{DRAW_CAP.toLocaleString()} and is comfortable at {DRAW_TARGET.toLocaleString()}. Nothing has
				been dropped: pick a reduction and it will say which one is on screen.
			</p>
			<ul className="graph-reductions">
				{options.map((option) => (
					<li key={option.key}>
						<button
							type="button"
							className="button"
							onClick={() => {
								clearFilters();
								setScope(option.scope);
								// The collapse rung is the only one that changes what is drawn rather than
								// what is selected, so it carries its reduction with it. Everywhere else on
								// this screen a scope change leaves the reductions alone.
								if (option.collapse) {
									setHubState((state) => ({
										...state,
										collapsed: new Set([...state.collapsed, option.collapse]),
									}));
								}
							}}
							disabled={!option.fits}
						>
							{option.label}
							<span className="graph-reduction-count">
								{option.elements.toLocaleString()} elements
								{option.fits ? '' : ' — still too many'}
							</span>
						</button>
					</li>
				))}
			</ul>
			<p className="graph-refusal-note">
				Or use the search box above to pick one name and look at its surroundings.
			</p>
		</div>
	);
}

/**
 * The gloss on hover, which is the one thing a label has no room for.
 *
 * A memory node gets its own card rather than falling through to nothing: it is the node a click
 * ACTS on, so the card is where the user reads what they are about to open.
 */
function HoverCard({ graph, hover }) {
	const parsed = hover.id ? parseNodeId(hover.id) : null;
	if (!parsed || !hover.position) return null;

	if (parsed.kind === 'memory') {
		const memory = graph.memories.get(parsed.memory_id);
		if (!memory) return null;
		return (
			<div className="graph-hover" style={{ left: hover.position.x + 14, top: hover.position.y + 14 }}>
				<strong>{memory.title ?? memory.memory_id}</strong>
				<div className="graph-hover-kinds">
					{memory.memory_type ? <Chip>{memory.memory_type}</Chip> : <NotRecorded what="memory type" />}
				</div>
				<span className="graph-hover-degree">
					{memory.factCount} fact{memory.factCount === 1 ? '' : 's'} ·{' '}
					{memory.surfaces.length} name{memory.surfaces.length === 1 ? '' : 's'} · click to open it
				</span>
			</div>
		);
	}

	const node = graph.nodes.get(parsed.surface);
	if (!node) return null;
	return (
		<div className="graph-hover" style={{ left: hover.position.x + 14, top: hover.position.y + 14 }}>
			<strong>{node.surface}</strong>
			<div className="graph-hover-kinds">
				{node.kinds.size === 0 ? (
					<NotRecorded what="entity kind" />
				) : (
					[...node.kinds.keys()].map((kind) => <Chip key={kind}>{kind}</Chip>)
				)}
			</div>
			{node.glosses.length > 0 ? <p>{node.glosses[0]}</p> : <p className="graph-hover-none">No description recorded.</p>}
			<span className="graph-hover-degree">
				{node.degree} fact{node.degree === 1 ? '' : 's'} · {node.memories.length} memor
				{node.memories.length === 1 ? 'y' : 'ies'}
			</span>
		</div>
	);
}

/** A clicked node: what it is, what is said about it, and the memories that say it. */
function Selection({ graph, node, onOpen, onClose, onExpand }) {
	const incident = graph.incident.get(node.surface) ?? [];
	return (
		<section className="graph-selection">
			<div className="graph-selection-head">
				<h2>{node.surface}</h2>
				<button type="button" className="button button-quiet" onClick={onClose}>
					Close
				</button>
			</div>

			<p className="graph-selection-kinds">
				{node.kinds.size === 0 ? (
					<NotRecorded what="entity kind" />
				) : (
					[...node.kinds.entries()].map(([kind, uses]) => (
						<Chip key={kind} tone={node.kinds.size > 1 ? 'warn' : 'neutral'}>
							{kind}
							{node.kinds.size > 1 ? ` ×${uses}` : ''}
						</Chip>
					))
				)}
				{!node.declared ? <Chip tone="warn">named in a fact, never declared</Chip> : null}
			</p>

			{node.glosses.map((gloss) => (
				<p key={gloss} className="graph-selection-gloss">
					{gloss}
				</p>
			))}

			<Disclosure title="Facts naming it" count={incident.length} defaultOpen>
				<ul className="graph-facts">
					{incident.map((edge) => (
						<li key={edge.id}>
							<span className={edge.source === node.surface ? 'graph-fact-self' : ''}>{edge.source}</span>{' '}
							<em>{edge.predicate ?? '—'}</em>{' '}
							<span className={edge.target === node.surface ? 'graph-fact-self' : ''}>{edge.target}</span>
							{edge.memory_id ? (
								<button type="button" className="linklike" onClick={() => onOpen(edge.memory_id)}>
									{edge.memory_title ?? edge.memory_id}
								</button>
							) : null}
						</li>
					))}
				</ul>
			</Disclosure>

			<Disclosure title="Memories that mention it" count={node.memories.length}>
				<ul className="graph-memories">
					{node.memories.map((memory) => (
						<li key={memory.memory_id}>
							<button type="button" className="linklike" onClick={() => onOpen(memory.memory_id)}>
								{memory.title ?? memory.memory_id}
							</button>
							{memory.memory_type ? <Chip>{memory.memory_type}</Chip> : null}
						</li>
					))}
				</ul>
			</Disclosure>

			<button type="button" className="button" onClick={onExpand}>
				Show its neighbours, 2 steps out
			</button>
		</section>
	);
}

/**
 * The fragmentation panel. THIS IS THE PRODUCT, and the drawing is the illustration beside it.
 *
 * The standard fix for a picture like this one is to suppress degree-1 nodes. On this vault that
 * deletes about three quarters of the names and with them every island, every once-used
 * relationship name, and every near-miss spelling — which is to say the entire curation backlog.
 * The picture gets prettier as it gets emptier and nothing on screen says so. So the fragments are
 * RELOCATED here, into a list, which is the correct encoding for several hundred weakly-ordered
 * items, and every row is a click back into the memory that would have to change.
 */
function Fragmentation({ graph, duplicates, conflicts, islands, onceUsed, onOpen, onShowComponent, onFocusSurface }) {
	return (
		<section className="graph-findings">
			<h2>What the shape says</h2>
			<p className="graph-findings-lede">
				{graph.counts.nodeCount.toLocaleString()} names, {graph.counts.edgeCount.toLocaleString()} facts,
				in <strong>{graph.counts.componentCount.toLocaleString()} separate groups</strong>. The largest
				holds {graph.counts.largestComponent.toLocaleString()};{' '}
				{graph.counts.degreeOneCount.toLocaleString()} names appear in exactly one fact. That is not a
				fault in the drawing. It is what is in the vault.
			</p>

			<Disclosure
				title="Nearly the same name, and not the same thing"
				count={duplicates.length}
				defaultOpen={duplicates.length > 0}
			>
				<p className="graph-note">
					Two things are one thing here only when their names match character for character. These
					spellings differ, so the vault holds each as its own thing with its own facts. Nothing on this
					screen merges them — that is a rewrite of every memory that names them, and it is a decision.
				</p>
				<ul className="graph-dupes">
					{duplicates.map((group) => (
						<li key={group.key}>
							<div className="graph-dupe-pair">
								{group.surfaces.map((entry) => (
									<button
										key={entry.surface}
										type="button"
										className="linklike graph-dupe-surface"
										onClick={() => onFocusSurface(entry.surface)}
									>
										{entry.surface} <span className="graph-tag-count">{entry.degree}</span>
									</button>
								))}
							</div>
							<span className="graph-dupe-why">
								{group.rule === 'punctuation-and-case'
									? 'differs only in punctuation or case'
									: 'same words, different order or article'}
								{group.sameComponent ? ' · already joined' : ' · in separate groups'}
							</span>
						</li>
					))}
					{duplicates.length === 0 ? <li className="graph-note">No two names normalise together.</li> : null}
				</ul>
			</Disclosure>

			<Disclosure title="The biggest groups" count={graph.counts.componentCount}>
				<ul className="graph-components">
					{graph.components.slice(0, 30).map((component) => (
						<li key={component.id}>
							<button type="button" className="linklike" onClick={() => onShowComponent(component.id)}>
								{component.label}
							</button>
							<span className="graph-tag-count">
								{component.size} names · {component.edgeCount} facts · {component.memoryIds.length} memories
							</span>
						</li>
					))}
				</ul>
			</Disclosure>

			<Disclosure title="Facts joined to nothing else" count={islands.length}>
				<p className="graph-note">
					One fact, standing alone. Each one is true and each one is unreachable from anything else
					written here.
				</p>
				<ul className="graph-islands">
					{islands.slice(0, 60).map(({ component, edge }) =>
						edge ? (
							<li key={component.id}>
								<span>
									{edge.source} <em>{edge.predicate ?? '—'}</em> {edge.target}
								</span>
								{edge.memory_id ? (
									<button type="button" className="linklike" onClick={() => onOpen(edge.memory_id)}>
										{edge.memory_title ?? edge.memory_id}
									</button>
								) : null}
							</li>
						) : null,
					)}
				</ul>
				{islands.length > 60 ? <p className="graph-note">…and {islands.length - 60} more.</p> : null}
			</Disclosure>

			<Disclosure title="One name, two kinds" count={conflicts.length}>
				<ul className="graph-conflicts">
					{conflicts.slice(0, 40).map((entry) => (
						<li key={entry.surface}>
							<button type="button" className="linklike" onClick={() => onFocusSurface(entry.surface)}>
								{entry.surface}
							</button>
							{entry.kinds.map((kind) => (
								<Chip key={kind.kind} tone="warn">
									{kind.kind}
								</Chip>
							))}
						</li>
					))}
				</ul>
			</Disclosure>

			<Disclosure title="Relationship names used exactly once" count={onceUsed.length}>
				<p className="graph-note">
					{onceUsed.length} of {graph.counts.distinctPredicates} relationship names are used once. These
					are the pale dashed edges on the canvas: the fragmentation, visible before any label is read.
				</p>
				<ul className="graph-predicates">
					{onceUsed.slice(0, 80).map((entry) => (
						<li key={entry.predicate}>{entry.predicate}</li>
					))}
				</ul>
			</Disclosure>

			<Disclosure title="Declared, never used in a fact" count={graph.declaredNeverAsserted.length}>
				<p className="graph-note">
					These names were declared by a memory and then never appear in one of its facts. They have no
					edge and no position, so they are not drawn — the declaration is doing nothing.
				</p>
				<ul className="graph-unused">
					{graph.declaredNeverAsserted.slice(0, 60).map((entry) => (
						<li key={entry.surface}>
							{entry.surface}
							{entry.declarations[0]?.memory_id ? (
								<button
									type="button"
									className="linklike"
									onClick={() => onOpen(entry.declarations[0].memory_id)}
								>
									{entry.declarations[0].memory_title ?? entry.declarations[0].memory_id}
								</button>
							) : null}
						</li>
					))}
				</ul>
			</Disclosure>
		</section>
	);
}

/**
 * The fidelity strip: permanent, not dismissible, and not a warning icon.
 *
 * THE DISCREPANCY IS THE MESSAGE, WHICH IS WHY THERE ARE TWO COLUMNS OF NUMBERS AND NOT ONE. This
 * drawing is grouped by exact spelling out of the export; the engine holds its own graph and does
 * not agree with it, in both directions. One set of counts is a claim about the vault. Two sets,
 * with the difference named, is a statement about how far this picture can be trusted — which is
 * the only thing this strip is for.
 *
 * Where the engine publishes no comparable number, the row SAYS SO in those words rather than
 * showing a blank or borrowing a number that counts something else. An invented comparison is
 * worse than an absent one: it is checkable, and it is wrong.
 *
 * The model warning lives here too, and not only in the footer. A graph drawn against a build
 * without the embedding model is a different graph, not a slower one, and by the time a reader has
 * reached the footer they have already believed the picture.
 */
function Fidelity({ graph, drawn, palette, markUndeclared, lens, health, model }) {
	const reading = fidelityReading(graph, health);
	// The engine's own reading first, because it is current; the launch preflight is the fallback
	// for the seconds before the first health answer arrives.
	const warning = modelWarning(health?.data?.embedding ?? health?.embedding ?? model);
	const active = lensById(lens);

	return (
		<footer className="graph-fidelity">
			{warning ? (
				<p className="graph-fidelity-model" role="status">
					<strong>This drawing was made against an engine with no embedding model.</strong>{' '}
					{warning.text}
				</p>
			) : null}

			<span>
				<strong>This drawing is this app’s own reconstruction.</strong> Built from your exported
				memories by matching names character for character, then projected as{' '}
				<em>{active.name.toLowerCase()}</em> — {drawn.elementCount.toLocaleString()} elements on
				screen
				{/* `drawn` is the plan, so the strip's headline number is what the canvas holds. When a
				    reduction is on, the number this app counted and the number it drew are different,
				    and a strip whose whole subject is fidelity is the wrong place to print one of them
				    alone. */}
				{drawn.unreduced && drawn.unreduced.elementCount !== drawn.elementCount
					? ` of the ${drawn.unreduced.elementCount.toLocaleString()} this scope holds — the difference is itemised in the rail, not dropped`
					: ''}
				.
			</span>

			<table className="graph-fidelity-counts">
				<caption>What this app counted, and what the engine says about itself</caption>
				<thead>
					<tr>
						<th scope="col">&nbsp;</th>
						<th scope="col">this drawing</th>
						<th scope="col">the engine</th>
						<th scope="col">what the difference means</th>
					</tr>
				</thead>
				<tbody>
					{reading.rows.map((row) => (
						<tr key={row.key}>
							<th scope="row">{row.label}</th>
							<td>{row.client.toLocaleString()}</td>
							<td>
								{row.comparable ? (
									row.engine.toLocaleString()
								) : (
									<span className="not-recorded">no comparable count</span>
								)}
							</td>
							<td>{row.meaning ?? '—'}</td>
						</tr>
					))}
				</tbody>
			</table>

			{reading.notes.map((note) => (
				<span key={note.key} className="graph-fidelity-note">
					{note.text}
				</span>
			))}

			<span className="graph-fidelity-limits">
				It cannot show: two spellings the engine already holds as one thing (so it draws too many
				separate names); a kind of link no door hands out (so it draws too few edges); which of two
				competing claims currently serves (both are drawn the same); or anything about a memory that
				has been removed.
			</span>
			<span className="graph-legend">
				<span className="graph-legend-item">
					<span className="graph-legend-mark graph-legend-memory" /> a memory — click it to open it
				</span>
				<span className="graph-legend-item">
					<span className="graph-legend-mark graph-legend-node" /> a name; size = how many facts name it
				</span>
				<span className="graph-legend-item">
					<span className="graph-legend-mark graph-legend-diamond" />{' '}
					{markUndeclared ? 'named in a fact, never declared' : 'declared as a named thing'}
				</span>
				<span className="graph-legend-item">
					<span className="graph-legend-mark graph-legend-dashed" /> relationship name used fewer than{' '}
					{COMMON_PREDICATE_USES} times
				</span>
				<span className="graph-legend-item">
					colour = the {palette.named.length} commonest kinds in this vault, counted at load;{' '}
					{palette.otherCount} others are grey. Every kind is also written on the node.
				</span>
			</span>
		</footer>
	);
}
