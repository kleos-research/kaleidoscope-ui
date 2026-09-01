import { useMemo, useState } from 'react';

import { buildGraph, fidelityReading, kindPalette, modelWarning, nearDuplicates } from './graph-model.mjs';
import {
	EGO_MAX_DEPTH,
	FOCUS_CAPTION,
	egoElements,
	nameReading,
} from './names-model.mjs';
import { useFocusActions } from './focus-actions.mjs';
import { ago } from './when.mjs';
import {
	Badge,
	DetailRow,
	DetailRows,
	EgoGraph,
	edgeLabelsFit,
	EmptyState,
	Eyebrow,
	Display,
	KindLegend,
	Note,
	PaneFoot,
	SegmentedControl,
} from './ui/index.mjs';

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
 */
export function NameFocus({ surface, records, health = null, model = null, onOpen, onOpenName }) {
	const graph = useMemo(() => buildGraph(records), [records]);
	const duplicates = useMemo(() => nearDuplicates(graph), [graph]);
	const palette = useMemo(() => kindPalette(graph), [graph]);
	const reading = useMemo(() => nameReading(graph, surface, duplicates), [graph, surface, duplicates]);

	const [depth, setDepth] = useState(1);
	const ego = useMemo(
		() => (reading ? egoElements(graph, surface, { depth, palette }) : null),
		[reading, graph, surface, depth, palette],
	);

	const labelsFit = useMemo(() => edgeLabelsFit(ego?.edges ?? []), [ego]);

	/*
	  THE DEPTH DIAL GOES IN THE ONE BAR, not above the drawing. A second row of chrome under the
	  bar is exactly the thing a reader has to scroll past before reaching what they opened, and
	  every approved mockup for a focused screen draws one bar.
	*/
	useFocusActions(
		() =>
			reading ? (
				<SegmentedControl
					label="How far from this name to draw"
					value={String(depth)}
					onValueChange={(next) => setDepth(Number(next))}
					/*
					  The steps come from the cap rather than from three literals here. A control that
					  offered a depth the model refuses to grow to is a control that does nothing, and it
					  would look identical to one that worked on a vault where that depth was empty.
					*/
					options={DEPTH_STEPS.slice(0, EGO_MAX_DEPTH)}
				/>
			) : null,
		[reading, depth],
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
					selected={surface}
					onSelect={(id) => {
						if (id && id !== surface) onOpenName(id);
					}}
					/*
					  MEASURED, not counted. `edgeLabelsFit` compares the longest relation name against
					  the arc each spoke actually has; a count cannot see that ten forty-character
					  snake_case names on one hub overprint each other and the hub. See `ego-graph.jsx`.
					*/
					showEdgeLabels={labelsFit}
					label={`What is around “${surface}”`}
				/>

				<div className="name-canvas-legend">
					<KindLegend palette={palette} />
					<span className="overview-legend-sep" aria-hidden="true">
						|
					</span>
					<span>circle size = how often it is named</span>
					{labelsFit ? null : (
						<>
							<span className="overview-legend-sep" aria-hidden="true">
								|
							</span>
							{/*
							  SAID, not silently omitted. A drawing with no relation names looks exactly like
							  a drawing whose relations are unknown, and they are all listed beside it.
							*/}
							<span>relations are named in the panel</span>
						</>
					)}
				</div>

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
			</div>

			<aside className="pane pane-surface name-panel">
				<div className="name-panel-scroll">
					<header className="name-panel-head">
						<Display level={1} size="sm">
							{reading.surface}
						</Display>
						<div className="name-panel-what">
							{reading.kind ? <span>{reading.kind}</span> : <span className="faint">kind not declared</span>}
							{reading.gloss ? (
								<>
									<span className="faint"> · </span>
									{reading.gloss}
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
							{reading.statements.slice(0, VISIBLE_STATEMENTS).map((statement) => (
								<Statement key={statement.id} statement={statement} onOpenName={onOpenName} />
							))}
						</ul>
						{reading.statements.length > VISIBLE_STATEMENTS ? (
							<DetailRows>
								<DetailRow
									label="The rest of what is said about it"
									count={reading.statements.length - VISIBLE_STATEMENTS}
								>
									<ul className="statements">
										{reading.statements.slice(VISIBLE_STATEMENTS).map((statement) => (
											<Statement key={statement.id} statement={statement} onOpenName={onOpenName} />
										))}
									</ul>
								</DetailRow>
							</DetailRows>
						) : null}
					</section>

					<section className="name-panel-block">
						<div className="name-panel-block-head">
							<Eyebrow>Memories that name it</Eyebrow>
							<span className="item-count">{reading.memoryCount}</span>
						</div>
						<ul className="name-memories">
							{reading.memories.slice(0, VISIBLE_MEMORIES).map((memory) => (
								<MemoryLine key={memory.memory_id} memory={memory} onOpen={onOpen} />
							))}
						</ul>
						{reading.memories.length > VISIBLE_MEMORIES ? (
							<DetailRows>
								<DetailRow
									label="The rest of the memories that name it"
									count={reading.memories.length - VISIBLE_MEMORIES}
								>
									<ul className="name-memories">
										{reading.memories.slice(VISIBLE_MEMORIES).map((memory) => (
											<MemoryLine key={memory.memory_id} memory={memory} onOpen={onOpen} />
										))}
									</ul>
								</DetailRow>
							</DetailRows>
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
 * One thing said about this name.
 *
 * The relation is grey and the other endpoint is the link, which puts the reader's eye on the noun
 * rather than on the verb — and the direction is carried in the word order rather than by an arrow
 * glyph, because "is keyed on lockfile hash" and "lockfile hash keys" are a sentence and a puzzle.
 */
function Statement({ statement, onOpenName }) {
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
	return (
		<li className="statement">
			{statement.outgoing ? (
				<>
					{relation} {other}
				</>
			) : (
				<>
					{other} {relation} <span className="statement-relation">this</span>
				</>
			)}
			{statement.mode ? <Badge>{statement.mode}</Badge> : null}
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
