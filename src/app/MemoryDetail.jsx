import { useEffect, useRef, useState } from 'react';

import { fetchLineage } from './api.mjs';
import { useFocusActions } from './focus-actions.mjs';
import { Markdown } from './markdown.jsx';
import { axisCopy, scopeAxes, shortenScope } from './records.mjs';
import { ESCALATION_MENU_LABEL, REMOVE_LABEL } from './removal-model.mjs';
import { exact, written } from './when.mjs';
import {
	Badge,
	Button,
	Card,
	DetailRow,
	DetailRows,
	Dialog,
	Display,
	DropdownMenu,
	Evidence,
	FactList,
	FactSentence,
	Icon,
	IconButton,
	Identifier,
	Eyebrow,
	LinkCard,
	MenuItem,
	MenuSeparator,
	NamedThing,
	Note,
	NotRecorded,
	NoteQuote,
	Reading,
	ReadingPair,
	Readings,
	ScopeLine,
	ScopeValue,
	Section,
	Verbatim,
} from './ui/index.mjs';

/**
 * ONE MEMORY, READ — `ReadB` and `ReadEvidence`, which are one screen drawn twice.
 *
 * THE SHAPE IS THE FIX. The owner's complaint about the old page was positional, not aesthetic:
 * "there's a huge note, which I understand; I have to scroll quite a lot below to facts, named
 * things, then some evidence". So the words are a column and the things an agent acts on are a
 * rail beside them that does not scroll away, and everything that is neither becomes a closed row
 * with its count showing.
 *
 * IT RENDERS FROM THE SAME CACHED RECORD AS THE ROW. There is exactly one path to a memory's
 * content in this app, so the list and this page cannot disagree about what a memory says, and
 * NOTHING IS FETCHED WHEN THIS SCREEN OPENS. The one call it can make is the lineage read behind a
 * closed row, it happens only when a reader opens that row, it writes nothing, and it is cached
 * against the memory's version.
 *
 * THE THREE KINDS OF LINK, WHICH ARE NOT THE SAME KIND OF THING, and this file's main job is to
 * stop the screen pretending they are:
 *
 *   EVIDENCE is a pointer the writer left — a path, a command, a sentence somebody said. It is on
 *   most memories and NOTHING WAS VERIFIED WHEN IT WAS WRITTEN, which the footnote says out loud.
 *
 *   A CORRECTION is `{handle, says}` — FREE TEXT, with no stored link to any memory at all. The
 *   previous build resolved the handle against every title it happened to have loaded and rendered
 *   a link "matched by title": a heuristic wearing a relationship's clothes. So this screen quotes
 *   the writer's own sentence, marks it "a note, not a link", and offers a SEARCH for the handle —
 *   which is the honest version of the same help.
 *
 *   CONTRADICTS is a real stored list of memory ids, and it is rare. It appears only when the
 *   record carries one, it is marked "a real link", and it navigates.
 *
 * A note on labels. The KEYS on a record — `basis`, `mode`, `about`, `scope.project` — are the
 * structure of the write contract and are stable, so this file names them. The VALUES in them are
 * open registries and this file names none of them: types, kinds, relation names and qualifier
 * keys are rendered as whatever the record spells them. An `about` key this app has never seen is
 * data, not an error, and appears under its own name.
 */

/** One call per memory version, ever. Re-opening the row is free; closing it costs nothing. */
const lineageCache = new Map();

const listOf = (value) => (Array.isArray(value) ? value : []);

export function MemoryDetail({
	row,
	relations,
	rows,
	strippedFields,
	confirming = false,
	onOpen,
	onEdit,
	onRemove,
	onShowLimits,
}) {
	const record = row.record;
	const semantic = record?.semantic ?? {};
	const axes = scopeAxes([record]);

	const facts = listOf(semantic.facts);
	const entities = listOf(semantic.entities);
	const evidence = listOf(semantic.evidence);
	const corrections = listOf(semantic.corrections);

	const links = relations.get(row.memory_id) ?? {
		corrects: [],
		contradicts: [],
		corrected_by: [],
		contradicted_by: [],
	};
	const rowOf = (memoryId) => rows.find((candidate) => candidate.memory_id === memoryId) ?? null;
	const titleOf = (memoryId) => rowOf(memoryId)?.title ?? memoryId;

	/*
	  THE TWO SHEETS BEHIND THE "…" MENU. The record as it arrived and what the vault itself records
	  about this memory were closed rows under the prose; both are reference rather than reading —
	  raw JSON with digests in it, and the one call this page can make — so they are one press
	  further away, in the menu where ReadB keeps every secondary action.
	*/
	const [sheet, setSheet] = useState(null);

	/*
	  THE CONTROLS GO UP INTO THE ONE BAR. Every approved reading mockup draws Edit and an overflow
	  in the 56px bar and nothing else above the title; a second row of chrome is exactly what a
	  reader has to scroll past before reaching what they opened. The handlers are held in a ref so
	  the bar is rebuilt when the MEMORY changes and not when this component re-renders for a row
	  somebody opened.
	*/
	const actions = useRef(null);
	actions.current = { onEdit, onRemove, onShowLimits, onSheet: setSheet };
	useFocusActions(
		() => (
			<MemoryActions
				row={row}
				quiet={confirming}
				onEdit={actions.current.onEdit}
				onRemove={actions.current.onRemove}
				onShowLimits={actions.current.onShowLimits}
				onSheet={(which) => actions.current.onSheet(which)}
			/>
		),
		[row.memory_id, row.version_id, confirming],
	);

	/*
	  WHICH SECOND CARD THE RAIL CARRIES. Evidence leads whenever there is any: it is the most common
	  thing on a memory — half of a real vault carries some — and it is what a reader checks a claim
	  against. The rule used to be "whichever is the bigger list", which put evidence in the rail on
	  6% of memories while 52% had some. Named things become the closed row, because a name has a
	  whole screen of its own one press away and evidence does not.
	*/
	const evidenceLeads = evidence.length > 0;

	/*
	  WHAT THIS CORRECTS — ReadB's warn row, in the rail. A correction memory's quote used to sit
	  under the prose at y≈1,000 and the one real stored link at y≈1,300: on the memory whose badge
	  says "correction", neither was visible without scrolling. The count is the reason to open it.
	*/
	const outbound = links.contradicts.filter((link) => link.how === 'by_id' && link.target);
	const inbound = links.contradicted_by.filter((link) => link.how === 'by_id' && link.from);
	const correctionCount = corrections.length + outbound.length + inbound.length;

	const project = row.scope?.project ?? null;

	return (
		<>
		<Reading
			rail={
				<>
					<Card title="What your agent acts on">
						{facts.length === 0 ? (
							/*
							  A statement of fact, not a warning. A memory that is only prose is a legitimate
							  and common regime: it is still served, and nothing about it is wrong.
							*/
							<Note>
								This memory states no facts. Its words are still served; an agent reads them as
								they are written.
							</Note>
						) : (
							<FactList rail>
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
					</Card>

					{evidenceLeads ? (
						<EvidenceCard items={evidence} />
					) : (
						<NamedThingsCard entities={entities} undeclared={row.undeclared_endpoints} />
					)}

					{/*
					  THE CLOSED ROWS, IN THE RAIL UNDER THE TWO CARDS — exactly where ReadB and ReadEvidence
					  draw them. They stood in the reading column under the prose, and the median body is
					  about 1,200 characters, so the count a row exists to show was never above the fold.
					*/}
					<DetailRows>
						{evidenceLeads ? (
							<DetailRow label="Named things" count={entities.length}>
								<NamedThingsList entities={entities} undeclared={row.undeclared_endpoints} />
							</DetailRow>
						) : (
							<DetailRow label="Evidence" count={evidence.length}>
								<EvidenceList items={evidence} />
							</DetailRow>
						)}

						{correctionCount > 0 ? (
							<DetailRow
								label="What this corrects"
								count={`${correctionCount} ${correctionCount === 1 ? 'memory' : 'memories'}`}
								tone="warn"
							>
								<Corrections corrections={corrections} />
								<Disagreements
									outbound={outbound}
									inbound={inbound}
									rowOf={rowOf}
									titleOf={titleOf}
									onOpen={onOpen}
								/>
							</DetailRow>
						) : null}

						{/*
						  One row for everything about the record rather than the memory: when it applies
						  and until when, when it was written, the two identifiers, and why it was accepted.
						  "How long this applies" was a row of its own and read as an inventory.
						*/}
						<DetailRow label="History and identifiers">
							<Timing semantic={semantic} row={row} axes={axes} />
							<Identity row={row} semantic={semantic} titleOf={titleOf} onOpen={onOpen} />
						</DetailRow>

						{listOf(semantic.propose).length > 0 ? (
							<DetailRow label="Relations this memory proposed" count={semantic.propose.length}>
								<Note>
									Relations the writer believed it was inventing, with the meaning it supplied.
								</Note>
								<Readings>
									{semantic.propose.map((proposal, index) => (
										<ReadingPair key={index} term={proposal?.rel}>
											{proposal?.means ?? <NotRecorded what="what the relation means" />}
											{proposal?.inverse ? ` · inverse ${proposal.inverse}` : ''}
											{proposal?.over_time ? ` · ${proposal.over_time}` : ''}
											{proposal?.many === true ? ' · many' : ''}
										</ReadingPair>
									))}
								</Readings>
							</DetailRow>
						) : null}

						{semantic.context ? (
							<DetailRow label="The text this was taken from">
								<Note>
									Stored word for word, so a reader can check the extraction against what was
									actually said.
								</Note>
								<Verbatim scroll>{semantic.context}</Verbatim>
							</DetailRow>
						) : null}
					</DetailRows>
				</>
			}
		>
			<header className="reading-head">
				<Display level={1} size="2xl">
					{row.title ?? <NotRecorded what="title" />}
				</Display>
				<div className="reading-meta">
					{row.memory_type ? <Badge>{row.memory_type}</Badge> : <NotRecorded what="type" />}
					<span title={exact(row.created_on) ?? undefined}>
						{written(row.created_on) ?? 'written, date not recorded'}
					</span>
					{/*
					  ONE SCOPE PHRASE, AND IT IS THE PROJECT. ReadB's meta is three short facts on one
					  line; the file axis — "I have no idea. And it's too long" — does not belong on the
					  first line of a memory. Branch and file are read in full under "Where it applies"
					  in the editor and in the History row beside. The separator travels WITH the phrase
					  it separates, so a wrap never leaves a bare "·" at the end of a line.
					*/}
					<span className="reading-meta-scope">
						<span aria-hidden="true">·</span>{' '}
						{project ? (
							<>
								<span className="faint">project </span>
								<ScopeValue value={project} short={shortenScope(project)} />
							</>
						) : (
							<span className="faint">applies to every project</span>
						)}
					</span>
				</div>
			</header>

			{/*
			  A MEMORY THAT CORRECTS SOMETHING SAYS SO BEFORE ITS WORDS. The rail's warn row carries
			  the count on every memory; on a memory whose badge says "correction" the quote and the
			  one real stored link are the reason it exists, and under a five-fact rail they sat at
			  y≈1,000. So the first correction and every stored outbound link are drawn here,
			  compactly, whenever this memory corrects anything — and the row in the rail still opens
			  the whole set, including what disagrees with this one.
			*/}
			{corrections.length > 0 || outbound.length > 0 ? (
				<CorrectionLead
					corrections={corrections}
					outbound={outbound}
					rowOf={rowOf}
					titleOf={titleOf}
					onOpen={onOpen}
				/>
			) : null}

			{record?.content_md ? (
				<Markdown source={record.content_md} size="lg" title={row.title} />
			) : (
				<p className="prose prose-lg">
					<NotRecorded what="note body" />
				</p>
			)}
		</Reading>

		<Dialog
			open={sheet === 'record'}
			onOpenChange={(open) => setSheet(open ? 'record' : null)}
			wide
			title="The record as it arrived"
			description="What the browser received for this memory, as JSON."
		>
			<RawRecord record={record} strippedFields={strippedFields} />
		</Dialog>

		<Dialog
			open={sheet === 'lineage'}
			onOpenChange={(open) => setSheet(open ? 'lineage' : null)}
			title="What the vault records about this memory"
			description="The vault's own answer, read now. It can differ from what the loaded memories imply."
		>
			{sheet === 'lineage' ? (
				<LineageReading
					memoryId={row.memory_id}
					versionId={row.version_id}
					titleOf={titleOf}
					onOpen={onOpen}
				/>
			) : null}
		</Dialog>
		</>
	);
}

/**
 * THE ACTIONS, WHICH LIVE IN THE ONE BAR AND NOT IN A SECOND ROW UNDER IT.
 *
 * Every approved reading mockup draws exactly two controls up there: a filled `Edit` and an
 * overflow. A second row of chrome is precisely the thing a reader has to scroll past before
 * reaching what they opened, so this is handed to the shell's focus bar and the screen below it
 * begins with the memory's own title.
 *
 * Removal is in the OVERFLOW rather than beside Edit, and it is called the same thing here as in
 * the list, the confirmation and the report — the word is what carries the difference between
 * hiding a memory and ending it, so a second spelling is a second promise. There is no trash glyph
 * anywhere in this product: that is a picture of incineration and this action is not one.
 */
export function MemoryActions({ row, quiet = false, onEdit, onRemove, onShowLimits, onSheet = null }) {
	const id = encodeURIComponent(row.memory_id);
	return (
		<>
			{/*
			  THE ONLY WAY IN TO THE EDITOR. What is on this page came from the door that displays a
			  memory, which does not carry its entity declarations — so nothing here is handed onwards
			  as the thing a save is built from. The editor re-loads the memory through the door that
			  does, on every open.

			  `quiet` is set while a removal is being confirmed over this memory: the page is asking
			  "Remove?" and a filled Edit beside that question is the loudest control on a screen
			  that is about something else.
			*/}
			{onEdit ? (
				<Button tone={quiet ? 'default' : 'primary'} onClick={() => onEdit(row.memory_id)}>
					Edit
				</Button>
			) : null}

			<DropdownMenu
				trigger={
					<IconButton label="More about this memory">
						<Icon.More size={15} />
					</IconButton>
				}
			>
				{onRemove ? <MenuItem onSelect={() => onRemove(row)}>{REMOVE_LABEL}</MenuItem> : null}
				<MenuSeparator />
				{/*
				  A two-memory action started from a one-memory page, so it opens a screen where the
				  other memory is named before anything is composed. Nothing is written from this click.
				*/}
				<MenuItem onSelect={() => (window.location.hash = `#/m/${id}/merge`)}>
					Merge this into another memory…
				</MenuItem>
				{/*
				  NAMED FOR THE EDITS IT OPENS. "Make this count for more" was the owner's exact rejected
				  label ("No idea what it means"). The screen behind it offers the edits that DO change
				  where and how long a memory applies, each named for the field it changes, and says the
				  negative half first: there is no priority, importance or pin in this store.
				*/}
				<MenuItem onSelect={() => (window.location.hash = `#/m/${id}/promote`)}>
					Where and how long it applies…
				</MenuItem>
				{onSheet ? (
					<>
						<MenuSeparator />
						<MenuItem onSelect={() => onSheet('lineage')}>What the vault records about it</MenuItem>
						<MenuItem onSelect={() => onSheet('record')}>The record as it arrived</MenuItem>
					</>
				) : null}
				{onShowLimits ? (
					<>
						<MenuSeparator />
						<MenuItem onSelect={() => onShowLimits(row.memory_id)}>{ESCALATION_MENU_LABEL}</MenuItem>
					</>
				) : null}
			</DropdownMenu>
		</>
	);
}

/* ------------------------------------------------------------------------------- the evidence */

/**
 * The one sentence this app says about what evidence IS, and it is attached to every rendering of
 * it. A list of paths under a heading reads as a citation list; these are pointers somebody left.
 */
const EVIDENCE_FOOTNOTE =
	'Pointers the writer left so you can check the claim. Nothing here was verified when it was written.';

function EvidenceList({ items }) {
	if (items.length === 0) {
		return <Note>This memory points at nothing outside itself.</Note>;
	}
	return <Evidence items={items} footnote={EVIDENCE_FOOTNOTE} />;
}

function EvidenceCard({ items }) {
	return (
		<Card title="Where this came from" aside={items.length}>
			<EvidenceList items={items} />
		</Card>
	);
}

/* ---------------------------------------------------------------------------- the named things */

function NamedThingsList({ entities, undeclared, compact = false }) {
	if (entities.length === 0) {
		// Neutral, and deliberately so: a large share of agent-written memories declare nothing, and
		// their facts still stand.
		return (
			<Note>
				This memory declares no named things. Its facts still stand; nothing about it is wrong.
			</Note>
		);
	}
	return (
		<>
			{undeclared > 0 ? (
				<Note tone="warn">
					{undeclared} fact{undeclared === 1 ? '' : 's'} here name something this memory does not
					declare.
				</Note>
			) : null}
			{entities.map((entity, index) => (
				<NamedThing key={index} name={entity?.n} kind={entity?.kind} gloss={entity?.is} compact={compact} />
			))}
		</>
	);
}

/*
 * THE RAIL'S SECOND CARD, WHEN THERE IS NO EVIDENCE: name and kind on one line each, the gloss on
 * a press. Ten three-line glosses made the card taller than the rail beside it and pushed the
 * closed rows — the count of what this corrects among them — to y≈1,500. A name has a screen of its
 * own one press away; the glosses are reference, not the reason a reader opened this memory.
 */
function NamedThingsCard({ entities, undeclared }) {
	return (
		<Card title="Named things" aside={entities.length > 0 ? entities.length : null}>
			<NamedThingsList entities={entities} undeclared={undeclared} compact />
		</Card>
	);
}

/* ------------------------------------------------------------------ a note, and a real link */

/**
 * The lead on a correction: the writer's own words about what they were fixing, and the memories
 * this one is stored as disagreeing with — each a real link with a chevron, as ReadB draws them.
 * One quote at most; the rail's row holds the rest and says how many there are.
 */
function CorrectionLead({ corrections, outbound, rowOf, titleOf, onOpen }) {
	const first = corrections[0] ?? null;
	const handle = first ? String(first?.handle ?? '').trim() : '';
	return (
		<div className="correction-lead">
			<Eyebrow>What this corrects</Eyebrow>
			{first ? (
				<NoteQuote handle={handle || 'no handle recorded'} says={first?.says}>
					{handle ? (
						<>
							The writer’s own words, not a stored link —{' '}
							<a href={`#/search?q=${encodeURIComponent(handle)}`}>search for “{handle}”</a> to find
							what they meant.
						</>
					) : (
						'The writer’s own words, not a stored link.'
					)}
				</NoteQuote>
			) : null}
			{outbound.map((link, index) => {
				const other = rowOf(link.target);
				return (
					<LinkCard
						key={index}
						title={titleOf(link.target)}
						meta={
							other
								? [other.memory_type, written(other.created_on)].filter(Boolean).join(' · ') || null
								: null
						}
						onClick={() => onOpen(link.target)}
					/>
				);
			})}
		</div>
	);
}

/**
 * WHAT THE WRITER SAID THEY WERE FIXING. Prose, in their words, under the handle they chose.
 *
 * There is NO STORED LINK behind any of this. The field is free text and most handles in a real
 * vault name nothing that exists, so the screen offers the search a reader would run anyway rather
 * than a link that resolves by coincidence of title. The badge says which of the two this is
 * before the reader has read a word of it.
 */
function Corrections({ corrections }) {
	if (corrections.length === 0) return null;

	return (
		<Section title="What this was fixing" mark={<Badge tone="warn">a note, not a link</Badge>}>
			{corrections.map((correction, index) => {
				const handle = String(correction?.handle ?? '').trim();
				return (
					<NoteQuote key={index} handle={handle || 'no handle recorded'} says={correction?.says}>
						The writer named what they were correcting in their own words. Nothing in the vault
						ties that to a particular memory, so this app will not pretend it does —{' '}
						{handle ? (
							<a href={`#/search?q=${encodeURIComponent(handle)}`}>search for “{handle}”</a>
						) : (
							'and the handle they used was left empty'
						)}{' '}
						to find what they meant.
					</NoteQuote>
				);
			})}
		</Section>
	);
}

/**
 * THE STORED LINK, IN BOTH DIRECTIONS, and it appears only when there is one.
 *
 * `contradicts` carries memory ids, so a resolution `by_id` is the vault's own statement and
 * nothing else counts here: a handle that merely matches some title is a guess, and a guess with a
 * chevron on it is indistinguishable on screen from a fact. Rare by design — a few memories in a
 * few hundred — which is why an empty section is no section at all rather than an empty one.
 */
function Disagreements({ outbound, inbound, rowOf, titleOf, onOpen }) {
	if (outbound.length === 0 && inbound.length === 0) return null;

	const card = (memoryId, key) => {
		const other = rowOf(memoryId);
		return (
			<LinkCard
				key={key}
				title={titleOf(memoryId)}
				meta={
					other
						? [other.memory_type, written(other.created_on)].filter(Boolean).join(' · ') || null
						: null
				}
				onClick={() => onOpen(memoryId)}
			/>
		);
	};

	return (
		<>
			{outbound.length > 0 ? (
				<Section title="Disagrees with" mark={<Badge tone="accent">a real link</Badge>}>
					{outbound.map((link, index) => card(link.target, index))}
				</Section>
			) : null}
			{inbound.length > 0 ? (
				<Section title="Disagreed with by" mark={<Badge tone="accent">a real link</Badge>}>
					{inbound.map((link, index) => card(link.from, index))}
				</Section>
			) : null}
		</>
	);
}

/* ------------------------------------------------------------------------------ the closed rows */

function timeText(value) {
	if (!value) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value.t) {
		return value.grain ? `${value.t} (${value.grain})` : String(value.t);
	}
	return null;
}

/**
 * Three different times, kept apart on purpose.
 *
 * When the facts are about, when the memory stops being served, and when the record was written are
 * not the same thing, and merging them is how a reader concludes a memory is stale because it was
 * written a while ago.
 */
function Timing({ semantic, row, axes }) {
	const occurred = timeText(semantic?.occurred_at);
	const from = semantic?.temporal?.valid_from ?? null;
	const until = semantic?.temporal?.valid_until ?? null;

	return (
		<>
			<Readings>
				<ReadingPair term="applies to">
					<ScopeLine scope={row.scope} axes={axes} phrase={axisCopy} />
				</ReadingPair>
				<ReadingPair term="what this is about">
					{occurred ?? <NotRecorded what="when the facts are about" />}
				</ReadingPair>
				<ReadingPair term="served from">
					{from ?? <NotRecorded what="start of the validity window" />}
				</ReadingPair>
				<ReadingPair term="stops being served">
					{until ?? <NotRecorded what="end of the validity window" />}
				</ReadingPair>
			</Readings>
			{!from && !until ? (
				<Note>This memory sets no window, so nothing about it expires on its own.</Note>
			) : null}
		</>
	);
}

/**
 * The identifiers, in full, and the one sentence that stops the next contributor inventing a
 * writer column.
 *
 * The version identity is what a save conflict quotes back and a person comparing two of them is
 * comparing character by character, so nothing here is shortened — not on screen and not in the
 * DOM. "Created by" is the first column anyone would add to a memory browser and the easiest one
 * to fill with plausible-looking values; there is no per-memory writer on an exported record, and
 * saying so in words once is what keeps it from being invented.
 */
function Identity({ row, semantic, titleOf, onOpen }) {
	const admission = semantic?.admission ?? null;
	const compared = admission?.compared ?? 0;

	return (
		<>
			<Readings>
				<ReadingPair term="written">
					{exact(row.created_on) ?? <NotRecorded what="first written" />}
				</ReadingPair>
				<ReadingPair term="write order">
					{row.sequence ?? <NotRecorded what="write order" />}
				</ReadingPair>
				<ReadingPair term="version">
					<Identifier value={row.version_id} label="version identity" />
				</ReadingPair>
				<ReadingPair term="memory">
					<Identifier value={row.memory_id} label="memory id" />
				</ReadingPair>
				<ReadingPair term="why it was accepted">
					{!admission ? (
						'This record carries nothing about how it was accepted.'
					) : compared === 0 ? (
						'Accepted without comparing against anything.'
					) : (
						<>
							Compared against {compared} of {admission.scanned ?? compared}
							{admission.disposition ? ` · ${admission.disposition}` : ''}
							{admission.nearest_memory_id ? (
								<>
									{' · nearest '}
									<Button
										tone="quiet"
										size="sm"
										onClick={() => onOpen(admission.nearest_memory_id)}
									>
										{titleOf(admission.nearest_memory_id)}
									</Button>
								</>
							) : null}
						</>
					)}
				</ReadingPair>
			</Readings>
			<Note>Who wrote this is not recorded: kscope stores no writer on a memory.</Note>
		</>
	);
}

/**
 * What the store itself records pointing at this memory. The one thing on this page that costs a
 * call, and it happens only when a reader opens the sheet it is in.
 */
function LineageReading({ memoryId, versionId, titleOf, onOpen }) {
	const cacheKey = `${memoryId}@${versionId}`;
	const [lineage, setLineage] = useState(() => lineageCache.get(cacheKey) ?? null);
	const [error, setError] = useState(null);

	const load = () => {
		if (lineageCache.has(cacheKey)) return;
		// Marked before the request so a double-click on the row cannot start a second one.
		lineageCache.set(cacheKey, { pending: true });
		fetchLineage(memoryId)
			.then((body) => {
				const data = body?.data ?? body;
				lineageCache.set(cacheKey, data);
				setLineage(data);
			})
			.catch((failure) => {
				lineageCache.delete(cacheKey);
				setError(failure);
			});
	};

	// Once, on open. The sheet mounts this only while it is open, so mounting is the press.
	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cacheKey]);

	const marked = lineage?.duplicate_of ?? lineage?.superseded_by ?? null;
	const pointing = listOf(lineage?.contradicted_by);

	return (
		<div className="sheet-reading">
			{error ? (
				<Note tone="warn">
					The vault's own answer could not be read: {error.message}. What is on this page is
					computed from the memories already loaded.
				</Note>
			) : !lineage || lineage.pending ? (
				<Note>Reading what the vault records…</Note>
			) : (
				<>
					{marked ? (
						<LinkCard
							title={titleOf(marked)}
							meta="the vault marks this memory as superseded by it"
							onClick={() => onOpen(marked)}
						/>
					) : null}
					{pointing.map((item, index) => {
						const id = typeof item === 'string' ? item : item?.memory_id;
						if (!id) return null;
						return (
							<LinkCard
								key={index}
								title={titleOf(id)}
								meta="the vault records this memory as contradicted by it"
								onClick={() => onOpen(id)}
							/>
						);
					})}
					{!marked && pointing.length === 0 ? (
						<Note>
							Nothing else in the vault points at this memory, and it is not marked as a
							duplicate of another.
						</Note>
					) : null}
				</>
			)}
		</div>
	);
}

/**
 * The record as the browser received it — which is not quite as the engine produced it.
 *
 * A disclosure that quietly omitted fields would be a worse disclosure than none, so it names what
 * was removed. The list comes from what the server reported it actually dropped, not from a list
 * written here, so a field that stops being emitted stops being claimed.
 */
function RawRecord({ record, strippedFields }) {
	const stripped = strippedFields ?? [];
	return (
		<>
			<Note>
				{stripped.length === 0
					? 'This is the record as the server received it from the engine.'
					: `This is the record with ${stripped.length} field${
							stripped.length === 1 ? '' : 's'
						} removed before it reached this browser: ${stripped.join(', ')}. They are derived from the memory rather than written by anyone, no screen renders them, and together they are a large share of the bytes.`}
			</Note>
			<Verbatim scroll>{JSON.stringify(record, null, 2)}</Verbatim>
		</>
	);
}
