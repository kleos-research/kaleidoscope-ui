import { useMemo, useState } from 'react';

import { buildGraph, fidelityReading, modelWarning, nearDuplicates } from './graph-model.mjs';
import {
	DEFAULT_DIRECTION,
	EGO_DIRECTIONS,
	EGO_MAX_DEPTH,
	FOCUS_CAPTION,
	egoWithPin,
	nameReading,
} from './names-model.mjs';
import { useFocusActions } from './focus-actions.mjs';
import { ago } from './when.mjs';
import {
	Chip,
	DetailRow,
	DetailRows,
	EgoGraph,
	egoDrawing,
	EmptyState,
	Eyebrow,
	Display,
	glossDefinition,
	KindLegend,
	MenuItem,
	MenuLabel,
	MenuSeparator,
	Note,
	OverflowMenu,
	PaneFoot,
	SegmentedControl,
} from './ui/index.mjs';

/**
 * The direction dial's positions, in plain words. The model's ids are structure and the words are
 * this screen's: "from it" and "to it" were labels the owner would have to ask about.
 */
const DIRECTION_WORDS = { all: 'Both ways', out: 'What it says', in: 'What is said about it' };

/** The strip at the frame's foot that the legend is drawn over, in CSS px. */
const LEGEND_INSET = 44;

/**
 * THE SLOTS ARE ASSIGNED PER DRAWING. The vault-wide palette gives the eight most-used kinds in
 * the whole vault a colour, so on a drawing of nine names twelve of fourteen nodes were grey and
 * the legend listed "practice" while no practice was drawn. Here the kinds present on THIS canvas
 * take the slots, most frequent first, and the legend lists exactly those — GraphFocus's five on
 * bare paper. The hub is left out: it is drawn in the text ink and is named in the heading beside.
 */
function drawingPalette(nodes, focus) {
	const counts = new Map();
	for (const node of nodes) {
		if (node.depth === 0 || node.id === focus || !node.kind) continue;
		counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
	}
	const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
	const assignment = new Map(ordered.slice(0, 8).map(([kind], index) => [kind, index]));
	return {
		size: 8,
		slotOf: (kind) => (kind && assignment.has(kind) ? assignment.get(kind) : -1),
		named: ordered.slice(0, 8).map(([kind, count], index) => ({ kind, count, slot: index })),
		otherCount: Math.max(0, ordered.length - 8),
	};
}

/**
 * ONE NAME: the drawing of what is around it, and the text of what is said about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE PANEL IS THE ANSWER; THE DRAWING IS THE CONTEXT
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A picture of nine circles can tell a reader that nine things are joined to this one. It cannot
 * tell them WHAT IS SAID — and "what do we know about this thing, and where did it come from" is
 * the question a reader actually arrived with. So the right-hand pane is text, in a fixed order:
 * what it is, how much of it there is, what is said about it, and the memories that name it. Every
 * memory in that last list opens the memory, because every operation this app can perform is
 * addressed by memory id and a name that cannot reach one is a name you can only look at.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DRAWING IS SAFE HERE AND NOWHERE ELSE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Max degree in a vault of this shape is about ten. Depth 1 is therefore at most eleven nodes and
 * depth 2 is typically under twenty — comfortably inside the hundred-node limit past which readers
 * are wrong or unsure more than half the time on exactly this kind of task. This canvas never needs
 * pagination, never needs a hub cap and never needs "show 200 more". It is the one node-link
 * drawing in the product and it earns its place easily.
 *
 * BECAUSE DEGREE IS BOUNDED, EVERY LIST IN THE PANE IS COMPLETE. What is deferred behind a closed
 * row is deferred for attention, not because it was too long to render — and the row carries its
 * count, so a reader deciding whether to open it is deciding on a number rather than on a hunch.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THREE DIALS IN THE BAR, AND THE PIN
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * How far to draw, which way to follow the statements, and whether to keep this name on the
 * canvas while another is opened. The first two are the drawing's and live in this screen's own
 * state. The pin outlives this screen — it is the whole point of it — so it lives in the URL, and
 * this component only reads it and asks for it to change.
 */
export function NameFocus({
	surface,
	records,
	health = null,
	model = null,
	pinned = null,
	onPin = () => {},
	onOpen,
	onOpenName,
}) {
	const graph = useMemo(() => buildGraph(records), [records]);
	const duplicates = useMemo(() => nearDuplicates(graph), [graph]);
	const reading = useMemo(() => nameReading(graph, surface, duplicates), [graph, surface, duplicates]);

	const [depth, setDepth] = useState(1);
	const [direction, setDirection] = useState(DEFAULT_DIRECTION);
	const [allStatements, setAllStatements] = useState(false);
	const [allMemories, setAllMemories] = useState(false);
	const walked = useMemo(
		() => (reading ? egoWithPin(graph, surface, pinned, { depth, direction }) : null),
		[reading, graph, surface, pinned, depth, direction],
	);
	// The colours are this drawing's own — see `drawingPalette` — and the nodes carry them.
	const palette = useMemo(() => (walked ? drawingPalette(walked.nodes, surface) : null), [walked, surface]);
	const ego = useMemo(
		() =>
			walked
				? { ...walked, nodes: walked.nodes.map((node) => ({ ...node, slot: palette.slotOf(node.kind) })) }
				: null,
		[walked, palette],
	);

	/*
	  WHERE EVERYTHING SITS, computed once here rather than inside the drawing, because two things
	  read the answer: the canvas draws it, and the legend in the canvas's corner lists the relations
	  the arithmetic could not place on their lines. One computation, so the two cannot disagree
	  about which those are.
	*/
	const drawing = useMemo(() => (ego ? egoDrawing(ego, ego.centres) : null), [ego]);
	const shared = useMemo(() => new Set((ego?.shared ?? []).map((entry) => entry.id)), [ego]);
	// "+n" is printed at two steps, where opening a neighbour is the question it answers.
	const anyBeyond = useMemo(
		() => depth >= 2 && (ego?.nodes ?? []).some((node) => node.beyond > 0),
		[ego, depth],
	);
	// The relation names the drawing numbered, keyed by edge, so the panel can print the number
	// beside the statement it belongs to.
	const numbered = useMemo(
		() => new Map((drawing?.markers ?? []).map((marker) => [marker.id, marker.number])),
		[drawing],
	);

	/*
	  THE BAR IS GraphFocus's: one two-position control, Direct / Two steps. The direction and the
	  pin are real and stay, behind one quiet "…" with plain words — "From it", "To it" and "Pin"
	  resident in the bar were three boxed controls no mockup draws and labels the owner would ask
	  about. A pinned name still reads back as a chip, because it is a choice the reader made and
	  the way to undo it belongs where it is shown. The third step is not offered: nothing draws it.
	*/
	useFocusActions(
		() =>
			reading ? (
				<>
					{pinned ? (
						<Chip tone="accent" onRemove={() => onPin(null)} removeLabel={`Unpin “${pinned}”`}>
							<span className="pin-chip-text">pinned “{pinned}”</span>
						</Chip>
					) : null}
					<SegmentedControl
						label="How far from this name to draw"
						value={String(depth)}
						onValueChange={(next) => setDepth(Number(next))}
						/*
						  Two positions, capped by the model's own limit so the control cannot offer a
						  depth the walk refuses to grow to.
						*/
						options={DEPTH_STEPS.slice(0, Math.min(2, EGO_MAX_DEPTH))}
					/>
					<OverflowMenu label="More ways to draw this">
						<MenuLabel>Follow the statements</MenuLabel>
						{/*
						  The positions are the model's own list, so the menu cannot offer a direction the
						  walk does not know; the words are this screen's. A statement has a subject and an
						  object: "what it says" draws the statements this name makes, "what is said about
						  it" the ones made about it.
						*/}
						{EGO_DIRECTIONS.map((entry) => (
							<MenuItem
								key={entry.id}
								onSelect={() => setDirection(entry.id)}
								hint={entry.id === direction ? 'now' : null}
							>
								{DIRECTION_WORDS[entry.id] ?? entry.label}
							</MenuItem>
						))}
						<MenuSeparator />
						{pinned === surface ? (
							<MenuItem onSelect={() => onPin(null)}>Unpin this name</MenuItem>
						) : (
							<MenuItem onSelect={() => onPin(surface)}>
								{pinned ? 'Pin this name instead' : 'Keep this name on the canvas while opening another'}
							</MenuItem>
						)}
					</OverflowMenu>
				</>
			) : null,
		[reading, depth, direction, surface, pinned],
	);

	if (!reading) {
		return (
			<div className="screen">
				<div className="page page-narrow">
					<EmptyState heading="No name in this vault is spelled that way">
						This link addresses “{surface}”, and nothing in the memories this browser holds names
						it. Names are matched on exact spelling, so a name that has been re-spelled since the
						link was made is a different name — the list of what is here is one press of Back away.
					</EmptyState>
				</div>
			</div>
		);
	}

	const following = DIRECTION_WORDS[direction] ?? direction;

	/*
	  TWO PANES INSIDE THE SCROLL REGION `App` ALREADY OPENED, and therefore a height of its own
	  rather than `flex: 1` — a flex grow term inside a block scroll container is inert, and the
	  drawing would collapse to nothing while looking like a styling accident.
	*/
	return (
		<div className="name-split">
			<div className="pane name-canvas">
				<EgoGraph
					elements={ego}
					focus={surface}
					drawing={drawing}
					pinned={ego.pinned?.found ? ego.pinned.surface : null}
					shared={shared}
					selected={surface}
					inset={LEGEND_INSET}
					beyondMarks={depth >= 2}
					onSelect={(id) => {
						if (id && id !== surface) onOpenName(id);
					}}
					label={
						`What is around “${surface}”` +
						(ego.pinned?.found ? ` and “${ego.pinned.surface}”` : '') +
						`, following statements ${following.toLowerCase()}`
					}
				/>

				<div className="name-canvas-legend">
					<KindLegend palette={palette} limit={8} otherWord="other" />
					<span className="overview-legend-sep" aria-hidden="true">
						|
					</span>
					<span>circle size = how often it is named</span>
					{anyBeyond ? (
						<>
							<span className="overview-legend-sep" aria-hidden="true">
								|
							</span>
							{/*
							  The count at a node's shoulder, decoded once. It is what lets a reader decide
							  whether opening a neighbour is worth it before they do.
							*/}
							<span>+n = more beyond it, not drawn</span>
						</>
					) : null}
					{ego.pinned?.found ? (
						<>
							<span className="overview-legend-sep" aria-hidden="true">
								|
							</span>
							<span className="name-legend-item">
								<span className="name-legend-mark name-legend-mark-pinned" aria-hidden="true" />
								pinned
							</span>
							{shared.size > 0 ? (
								<span className="name-legend-item">
									<span className="name-legend-mark name-legend-mark-shared" aria-hidden="true" />
									joined to both
								</span>
							) : null}
						</>
					) : null}
				</div>

				<div className="name-canvas-notes">
					{/*
					  WHAT THE DRAWING DID NOT DRAW, AS AN EXACT COUNT.

					  The neighbourhood grows a whole ring at a time and a ring that would cross the node cap
					  is refused entire, so this sentence is a fact rather than an estimate. A drawing that
					  stopped part-way through a ring would look identical to a complete one.
					*/}
					{ego.capped ? (
						<Note tone="warn" className="name-canvas-note">
							Drawn to {ego.reachedDepth === 1 ? 'one step' : `${ego.reachedDepth} steps`}. The next
							step would add {ego.hidden.toLocaleString()} more names, which is past what this drawing
							will put in front of you at once — so it is not drawn at all rather than drawn in part.
						</Note>
					) : null}

					{/*
					  THE COMPARISON, IN WORDS. Two neighbourhoods side by side answer "what do these two
					  have in common" only if the reader finds the common names by eye; here they are
					  listed. There is no path between the two, on evidence — see `egoWithPin` — and this
					  sentence is what a reader gets instead of one.
					*/}
					{pinned && pinned !== surface ? (
						<Note className="name-canvas-note">
							<PinReading ego={ego} onOpenName={onOpenName} />
						</Note>
					) : null}
				</div>
			</div>

			<aside className="pane pane-surface name-panel">
				<div className="name-panel-scroll">
					<header className="name-panel-head">
						<Display level={1} size="sm">
							{reading.surface}
						</Display>
						{/*
						  "tool · the shared dependency cache used by CI". A vault stores a gloss as
						  `surface | kind | definition`, which drawn whole here printed the name and the
						  kind twice with pipes; `glossDefinition` keeps the clause that says something new.
						*/}
						<div className="name-panel-what">
							{reading.kind ? <span>{reading.kind}</span> : <span className="faint">kind not declared</span>}
							{glossDefinition(reading.gloss, reading.surface, reading.kind) ? (
								<>
									<span className="faint"> · </span>
									{glossDefinition(reading.gloss, reading.surface, reading.kind)}
								</>
							) : null}
						</div>

						{/*
						  THREE COUNTS, and each is a different question. How joined it is, how much of
						  your writing touches it, and how many different things are said about it — a
						  name with nine connections and one relation is a very different object from
						  one with nine of each.
						*/}
						<dl className="name-counts">
							<div>
								<dt>{reading.degree}</dt>
								<dd>connections</dd>
							</div>
							<div>
								<dt>{reading.memoryCount}</dt>
								<dd>{reading.memoryCount === 1 ? 'memory' : 'memories'}</dd>
							</div>
							<div>
								<dt>{reading.relationCount}</dt>
								<dd>relations used</dd>
							</div>
						</dl>

						{reading.alsoSpelled.length > 0 ? (
							<div className="name-panel-dupes">
								{/*
								  THE OTHER SPELLING IS A LINK, not a label. A reader looking at "also 'the
								  retry budget'" is deciding whether the two are one thing, and that decision
								  needs the other one's facts — which are one press away and were, in the
								  version that drew this as a static chip, a search away.
								*/}
								{reading.alsoSpelled.map((other) => (
									<button
										key={other}
										type="button"
										className="chip chip-warn name-dupe"
										onClick={() => onOpenName(other)}
									>
										also “{other}”
									</button>
								))}
							</div>
						) : null}
					</header>

					<section className="name-panel-block">
						<Eyebrow>What is said about it</Eyebrow>
						<ul className="statements">
							{reading.statements.slice(0, allStatements ? undefined : VISIBLE_STATEMENTS).map((statement) => (
								<Statement
									key={statement.id}
									statement={statement}
									number={numbered.get(statement.id) ?? null}
									onOpenName={onOpenName}
								/>
							))}
						</ul>
						{/*
						  GraphFocus's own disclosure: one accent line — "5 more" — that opens the rest in
						  place, not a chevron row with hairlines.
						*/}
						{reading.statements.length > VISIBLE_STATEMENTS ? (
							<button
								type="button"
								className="link-more"
								aria-expanded={allStatements}
								onClick={() => setAllStatements(!allStatements)}
							>
								{allStatements ? 'Fewer' : `${reading.statements.length - VISIBLE_STATEMENTS} more`}
							</button>
						) : null}
						{/*
						  THE RELATIONS THE DRAWING COULD NOT PLACE, BY NUMBER — decoded here, beside the
						  statements they belong to, rather than in a box over the drawing that covered
						  nodes at two steps. The count comes first: a drawing that dropped three relation
						  names without saying so would look exactly like one whose relations were all drawn.
						*/}
						{drawing && drawing.counts.numbered > 0 ? (
							<div className="ego-fallbacks" role="note">
								<div className="ego-fallbacks-head">
									{drawing.counts.numbered === 1
										? '1 relation had no room for its name on the drawing and wears a number there.'
										: `${drawing.counts.numbered} relations had no room for their names on the drawing and wear numbers there.`}
								</div>
								<ol className="ego-fallbacks-list">
									{drawing.markers.map((marker) => (
										<li key={marker.id} className="ego-fallbacks-row">
											<span className="ego-fallbacks-number">{marker.number}</span>
											<span>{marker.text}</span>
										</li>
									))}
								</ol>
							</div>
						) : null}
					</section>

					<section className="name-panel-block">
						<div className="name-panel-block-head">
							<Eyebrow>Memories that name it</Eyebrow>
							<span className="item-count">{reading.memoryCount}</span>
						</div>
						<ul className="name-memories">
							{reading.memories.slice(0, allMemories ? undefined : VISIBLE_MEMORIES).map((memory) => (
								<MemoryLine key={memory.memory_id} memory={memory} onOpen={onOpen} />
							))}
						</ul>
						{reading.memories.length > VISIBLE_MEMORIES ? (
							<button
								type="button"
								className="link-more"
								aria-expanded={allMemories}
								onClick={() => setAllMemories(!allMemories)}
							>
								{allMemories ? 'Fewer' : `See all ${reading.memories.length}`}
							</button>
						) : null}
					</section>

					{/*
					  THE FULL FIDELITY STATEMENT, REACHABLE AND NOT RESIDENT.

					  The previous design carried four paragraphs of caveat on the screen at all times and
					  the owner's word for the result was information overload — a page showing everything
					  it knows is not more honest, it is less usable. The one line that is always true of
					  the drawing is in the foot below; the counts, the comparison with the engine's own
					  reading, and the four ways this reconstruction is wrong are one press away, which is
					  where a reader who is checking something will look for them.
					*/}
					<Fidelity graph={graph} health={health} model={model} />
				</div>

				<PaneFoot>{FOCUS_CAPTION}</PaneFoot>
			</aside>
		</div>
	);
}

/**
 * What each step of the depth dial is called. Words, not numbers: "Direct" and "Two steps" say what
 * the reader will be looking at, where "1" and "2" name a parameter of the drawing.
 */
const DEPTH_STEPS = [
	{ value: '1', label: 'Direct' },
	{ value: '2', label: 'Two steps' },
	{ value: '3', label: 'Three steps' },
];

/** How many statements and memories the panel shows before the rest goes behind a count. */
const VISIBLE_STATEMENTS = 4;
const VISIBLE_MEMORIES = 3;

/**
 * The comparison, as a sentence with links in it.
 *
 * Three cases, three sentences: the pinned name is not in this vault any more, the two share
 * nothing at this depth, or they share these. The shared names are links, because the reader's
 * next question is "what is that", and it is one press away.
 */
function PinReading({ ego, onOpenName }) {
	const pin = ego.pinned;
	if (!pin) return null;
	if (!pin.found) {
		return (
			<>
				“{pin.surface}” is pinned, and no name in the memories this browser holds is spelled that way
				any more — so only this name is drawn.
			</>
		);
	}
	const capped = pin.capped ? (
		<>
			{' '}
			Its next step would add {pin.hidden.toLocaleString()} more names and is not drawn.
		</>
	) : null;
	if (ego.shared.length === 0) {
		return (
			<>
				“{pin.surface}” is pinned. At this depth nothing is joined to both, so the two are drawn apart.
				{capped}
			</>
		);
	}
	return (
		<>
			“{pin.surface}” is pinned. Joined to both:{' '}
			{ego.shared.map((entry, index) => (
				<span key={entry.id}>
					{index > 0 ? ', ' : null}
					<button type="button" className="statement-other" onClick={() => onOpenName(entry.id)}>
						{entry.id}
					</button>
				</span>
			))}
			.{capped}
		</>
	);
}

/**
 * One thing said about this name.
 *
 * The relation is grey and the other endpoint is the link, which puts the reader's eye on the noun
 * rather than on the verb — and the direction is carried in the word order rather than by an arrow
 * glyph, because "is keyed on lockfile hash" and "lockfile hash keys" are a sentence and a puzzle.
 */
function Statement({ statement, number = null, onOpenName }) {
	const other = (
		<button type="button" className="statement-other" onClick={() => onOpenName(statement.other)}>
			{statement.other}
		</button>
	);
	const relation = (
		<span className="statement-relation">
			{statement.predicate ?? <span className="faint">relation not recorded</span>}
		</span>
	);

	/*
	  DIRECTION IS CARRIED BY WORD ORDER, not by an arrow glyph.

	  A fact has two ends and this name is one of them. Read out, the two cases are genuinely
	  different sentences — "is keyed on the lockfile hash" and "the build cache is keyed on this" —
	  and printing both as "→ lockfile hash" makes the reader supply the direction from context. An
	  earlier version prefixed the incoming case with "is what", which put the relation before the
	  thing doing it and read as a fragment with a real relation name in the middle of it.
	*/
	/*
	  No mode badge on the row: the mockup draws these as plain text, and the mode belongs to the
	  memory, which is one press away. A column of grey chips beside every line was chrome.
	*/
	return (
		<li className="statement">
			{number !== null ? <span className="statement-number">{number}</span> : null}
			{statement.outgoing ? (
				<>
					{relation} {other}
				</>
			) : (
				<>
					{other} {relation} <span className="statement-relation">this</span>
				</>
			)}
		</li>
	);
}

/** A memory that names this thing. Its title in the serif, its type and when it was written under. */
function MemoryLine({ memory, onOpen }) {
	const when = ago(memory.created_on);
	return (
		<li>
			<button type="button" className="name-memory" onClick={() => onOpen(memory.memory_id)}>
				<span className="name-memory-title">{memory.title ?? memory.memory_id}</span>
				<span className="name-memory-meta">
					{memory.memory_type ?? 'type not recorded'}
					{when ? ` · ${when}` : null}
				</span>
			</button>
		</li>
	);
}

/**
 * The reconstruction, examined. Closed, and it carries what it costs to open in its own label.
 *
 * Two sets of counts and the difference between them, plus the engine's own reading of its
 * embedding model when that reading is anything other than bundled — because a build without the
 * model is a different system rather than a slower one, and what it holds about these memories is
 * not what a full build would hold.
 */
function Fidelity({ graph, health, model }) {
	const strip = useMemo(() => fidelityReading(graph, health), [graph, health]);
	const warning = useMemo(() => modelWarning(model), [model]);

	return (
		<DetailRows className="name-panel-block">
			<DetailRow label="How this drawing was made">
				<p className="fidelity-lede">
					Nothing here is the engine’s own graph. This app groups the statements of the memories it
					has loaded on the exact spelling of each end, which is how identity works in this store
					and is a property a client can see — but it over-fragments where the engine already holds
					two spellings as one thing, it cannot see the class of link the export does not carry, and
					it draws a superseded claim and its successor as two equal lines.
				</p>

				<dl className="fidelity-rows">
					{strip.rows.map((row) => (
						<div key={row.key}>
							<dt>{row.label}</dt>
							<dd>
								<span className="fidelity-count">{row.client.toLocaleString()}</span>
								{row.comparable ? (
									<span className="faint"> here · {row.engine.toLocaleString()} in the engine</span>
								) : (
									<span className="faint"> here · nothing comparable published</span>
								)}
								{row.meaning ? <span className="fidelity-meaning">{row.meaning}</span> : null}
							</dd>
						</div>
					))}
				</dl>

				{strip.notes.map((note) => (
					<Note key={note.key}>{note.text}</Note>
				))}

				{warning ? <Note tone="warn">{warning.text}</Note> : null}
			</DetailRow>
		</DetailRows>
	);
}
