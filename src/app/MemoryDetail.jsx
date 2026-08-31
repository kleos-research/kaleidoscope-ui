import { useState } from 'react';

import { fetchLineage } from './api.mjs';
import { Markdown } from './markdown.jsx';
import { scopeAxes } from './records.mjs';
import { Chip, Disclosure, Identifier, NotRecorded, ScopeLine } from './ui.jsx';

/**
 * One memory, in full.
 *
 * It renders from THE SAME CACHED RECORD AS THE ROW. There is exactly one path to a memory's
 * content in this app, so the list and this page cannot disagree about what a memory says. The one
 * call this page can make is the lineage read behind the corrections panel, it happens only when a
 * reader expands that panel, it writes nothing, and it is cached against the memory's version.
 *
 * A note on labels. The KEYS on a record — `basis`, `mode`, `about`, `scope.project` — are the
 * structure of the write contract and are stable, so this file names them. The VALUES in them are
 * open registries and this file names none of them: types, kinds, relation names and qualifier keys
 * are rendered as whatever the record spells them. An `about` key this app has never seen is data,
 * not an error, and appears under its own name.
 *
 * The engine's contract also carries a one-line gloss for each field. They are deliberately NOT
 * used as the labels here: they are written for the agent doing the writing, and several of them
 * describe how the engine decides things, which is not what a person reading their own memory needs
 * on the screen.
 */

/** One call per memory version, ever. Re-expanding the panel is free; collapsing costs nothing. */
const lineageCache = new Map();

const has = (list) => Array.isArray(list) && list.length > 0;

export function MemoryDetail({ row, relations, rows, strippedFields, onOpen, onBack }) {
	const record = row.record;
	const semantic = record?.semantic ?? {};
	const axes = scopeAxes([record]);
	const links = relations.get(row.memory_id) ?? {
		corrects: [],
		contradicts: [],
		corrected_by: [],
		contradicted_by: [],
	};
	const titleOf = (memoryId) => rows.find((r) => r.memory_id === memoryId)?.title ?? memoryId;

	return (
		<article className="detail">
			<nav className="detail-nav">
				<button type="button" className="link-button" onClick={onBack}>
					‹ Memories
				</button>
			</nav>

			<header className="detail-head">
				<h1>{row.title ?? <NotRecorded what="title" />}</h1>
				<div className="detail-type">
					{row.memory_type ? <Chip>{row.memory_type}</Chip> : <NotRecorded what="type" />}
				</div>

				<dl className="detail-meta">
					<dt>Applies to</dt>
					<dd>
						<ScopeLine scope={row.scope} axes={axes} />
					</dd>

					<dt>Written</dt>
					<dd>
						{row.created_on ?? <NotRecorded what="first written" />}
						{row.sequence === null ? null : (
							<span className="muted"> · write order {row.sequence}</span>
						)}
					</dd>

					{/*
					  Visible on purpose, in full, and selectable. The version identity is what a save
					  conflict quotes back, and a user comparing two of them is comparing character by
					  character — so nothing here is shortened, in the text or in the DOM.
					*/}
					<dt>Version</dt>
					<dd>
						<Identifier value={row.version_id} label="version identity" />
					</dd>

					<dt>Memory</dt>
					<dd>
						<Identifier value={row.memory_id} label="memory id" />
					</dd>
				</dl>
			</header>

			<section className="panel">
				<h2>Note</h2>
				{record?.content_md ? (
					<Markdown source={record.content_md} />
				) : (
					<p>
						<NotRecorded what="note body" />
					</p>
				)}
			</section>

			<Facts facts={semantic.facts ?? []} />

			<NamedThings entities={semantic.entities ?? []} undeclared={row.undeclared_endpoints} />

			<Disclosure title="Evidence" count={(semantic.evidence ?? []).length}>
				{has(semantic.evidence) ? (
					<ul className="plain">
						{semantic.evidence.map((item, index) => (
							<li key={index}>
								<span className="key">{item?.kind ?? 'evidence'}</span>{' '}
								<span className="evidence-ref">{item?.reference}</span>
								{item?.digest ? (
									<>
										{' '}
										<Identifier value={item.digest} label="digest" />
									</>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="neutral">This memory references no evidence.</p>
				)}
			</Disclosure>

			<Timing semantic={semantic} row={row} />

			<Relations
				memoryId={row.memory_id}
				versionId={row.version_id}
				links={links}
				titleOf={titleOf}
				onOpen={onOpen}
			/>

			<Admission admission={semantic.admission} titleOf={titleOf} onOpen={onOpen} />

			{has(semantic.propose) ? (
				<Disclosure title="Proposed relations" count={semantic.propose.length}>
					<p className="neutral">
						Relations the writer of this memory believed it was inventing, with the meaning it
						supplied.
					</p>
					<ul className="plain">
						{semantic.propose.map((proposal, index) => (
							<li key={index}>
								<span className="key">{proposal?.rel}</span>
								{proposal?.means ? <span className="proposal-means"> — {proposal.means}</span> : null}
								<span className="muted">
									{proposal?.inverse ? ` · inverse ${proposal.inverse}` : ''}
									{proposal?.over_time ? ` · ${proposal.over_time}` : ''}
									{proposal?.many === true ? ' · many' : ''}
								</span>
							</li>
						))}
					</ul>
				</Disclosure>
			) : null}

			{semantic.context ? (
				<Disclosure title="Source text">
					<p className="neutral">
						The text this memory was extracted from, stored verbatim so a reader can check the
						extraction against what was actually said.
					</p>
					<pre className="verbatim">{semantic.context}</pre>
				</Disclosure>
			) : null}

			<Provenance row={row} axes={axes} />

			<RawRecord record={record} strippedFields={strippedFields} />
		</article>
	);
}

/** The keys this app renders in their own place. Everything else on a fact is shown as itself. */
const HANDLED_FACT_KEYS = new Set([
	'subject',
	'predicate',
	'object',
	'basis',
	'mode',
	'from',
	'until',
	'about',
	'evidence',
	'because',
	'confidence_millionths',
]);

function timeText(value) {
	if (!value) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value.t) {
		return value.grain ? `${value.t} (${value.grain})` : String(value.t);
	}
	return null;
}

function qualifierText(value) {
	const asTime = timeText(value);
	if (asTime) return asTime;
	if (value === null || value === undefined) return null;
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function Facts({ facts }) {
	return (
		<section className="panel">
			<h2>
				Facts <span className="panel-count">{facts.length}</span>
			</h2>
			{facts.length === 0 ? (
				<p className="neutral">This memory states no facts.</p>
			) : (
				<ul className="facts">
					{facts.map((fact, index) => {
						const extra = Object.entries(fact ?? {}).filter(
							([key, value]) =>
								!HANDLED_FACT_KEYS.has(key) && value !== null && value !== undefined,
						);
						const about = Object.entries(fact?.about ?? {});
						const from = timeText(fact?.from);
						const until = timeText(fact?.until);
						const confidence =
							typeof fact?.confidence_millionths === 'number'
								? (fact.confidence_millionths / 1_000_000).toFixed(2)
								: null;

						return (
							<li key={index} className="fact">
								<p className="statement">
									<span className="subject">{fact?.subject}</span>
									<span className="predicate">{fact?.predicate}</span>
									<span className="object">{fact?.object}</span>
								</p>

								<p className="fact-qualifiers">
									{fact?.basis ? (
										<span className="qualifier">
											<span className="key">how we know</span> {fact.basis}
										</span>
									) : null}
									{fact?.mode ? (
										<span className="qualifier">
											<span className="key">kind of claim</span> {fact.mode}
										</span>
									) : null}
									{from ? (
										<span className="qualifier">
											<span className="key">true from</span> {from}
										</span>
									) : null}
									{until ? (
										<span className="qualifier">
											<span className="key">until</span> {until}
										</span>
									) : null}
									{about.map(([key, value]) => (
										// A qualifier key this app has never seen renders under its own name.
										// An unknown key is data, not an error.
										<span className="qualifier" key={key}>
											<span className="key">{key}</span> {qualifierText(value)}
										</span>
									))}
									{confidence ? (
										// Read-only, and labelled, because it is derived: the write contract
										// does not accept it, so a user who edited it would be editing nothing.
										<span className="qualifier qualifier-derived" title="computed by kscope">
											<span className="key">confidence</span> {confidence}
										</span>
									) : null}
								</p>

								{extra.length > 0 ? (
									<p className="fact-extra">
										{extra.map(([key, value]) => (
											<span className="qualifier" key={key}>
												<span className="key">{key}</span> {qualifierText(value)}
											</span>
										))}
									</p>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function NamedThings({ entities, undeclared }) {
	return (
		<section className="panel">
			<h2>
				Named things <span className="panel-count">{entities.length}</span>
			</h2>

			{entities.length === 0 ? (
				// A neutral statement of fact, not a warning. A memory that declares nothing is a
				// legitimate regime and a large share of agent-written memories are in it.
				<p className="neutral">
					This memory declares no named things. Its facts still stand; nothing about it is wrong.
				</p>
			) : (
				<>
					{undeclared > 0 ? (
						<p className="warning">
							{undeclared} fact{undeclared === 1 ? '' : 's'} on this memory name something it does
							not declare below.
						</p>
					) : null}
					<ul className="entities">
						{entities.map((entity, index) => (
							<li key={index}>
								<span className="entity-name">{entity?.n}</span>
								<span className="entity-kind">{entity?.kind}</span>
								<span className="entity-is">{entity?.is}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}

/**
 * Three different times, kept apart on purpose.
 *
 * When the facts are about, when the memory stops being served, and when the record was written are
 * not the same thing, and merging them is how a reader concludes a memory is stale because it was
 * written a while ago.
 */
function Timing({ semantic, row }) {
	const occurred = timeText(semantic?.occurred_at);
	const from = semantic?.temporal?.valid_from ?? null;
	const until = semantic?.temporal?.valid_until ?? null;

	return (
		<Disclosure title="Timing">
			<dl className="detail-meta">
				<dt>What this is about</dt>
				<dd>{occurred ?? <NotRecorded what="when the facts are about" />}</dd>

				<dt>Serving from</dt>
				<dd>{from ?? <NotRecorded what="start of the validity window" />}</dd>

				<dt>Stops serving</dt>
				<dd>{until ?? <NotRecorded what="end of the validity window" />}</dd>

				<dt>Written</dt>
				<dd>
					{row.created_on ?? <NotRecorded what="first written" />}
					{row.sequence === null ? null : <span className="muted"> · write order {row.sequence}</span>}
				</dd>
			</dl>
			{!from && !until ? (
				<p className="neutral">
					This memory sets no validity window, so nothing about it expires on its own.
				</p>
			) : null}
		</Disclosure>
	);
}

function LinkToMemory({ target, how, label, onOpen }) {
	if (!target) {
		return (
			<>
				<span className="handle">{label}</span>{' '}
				<span className="muted">— not a memory in this vault</span>
			</>
		);
	}
	return (
		<>
			<button type="button" className="link-button inline" onClick={() => onOpen(target)}>
				{label}
			</button>
			{how === 'by_title' ? <span className="muted"> — matched by title</span> : null}
		</>
	);
}

/**
 * Outbound is free: it is what this record declares. Inbound has two sources and uses both — an
 * inversion over the loaded set, which costs nothing and is complete for declared links, and one
 * per-memory read that happens ONLY when this panel is expanded and is cached against the version.
 */
function Relations({ memoryId, versionId, links, titleOf, onOpen }) {
	const cacheKey = `${memoryId}@${versionId}`;
	const [lineage, setLineage] = useState(() => lineageCache.get(cacheKey) ?? null);
	const [lineageError, setLineageError] = useState(null);

	const load = () => {
		if (lineageCache.has(cacheKey)) return;
		// Marked before the request so a double-click on the toggle cannot start a second one.
		lineageCache.set(cacheKey, { pending: true });
		fetchLineage(memoryId)
			.then((body) => {
				const data = body?.data ?? body;
				lineageCache.set(cacheKey, data);
				setLineage(data);
			})
			.catch((error) => {
				lineageCache.delete(cacheKey);
				setLineageError(error);
			});
	};

	const total =
		links.corrects.length +
		links.contradicts.length +
		links.corrected_by.length +
		links.contradicted_by.length;

	return (
		<Disclosure title="Corrections and contradictions" count={total} onOpen={load}>
			<Direction
				heading="This memory corrects"
				items={links.corrects}
				render={(link, index) => (
					<li key={index}>
						<LinkToMemory
							target={link.target}
							how={link.how}
							label={link.target ? titleOf(link.target) : link.handle}
							onOpen={onOpen}
						/>
						{link.says ? <span className="says"> — {link.says}</span> : null}
					</li>
				)}
				empty="This memory does not declare that it corrects anything."
			/>

			<Direction
				heading="This memory contradicts"
				items={links.contradicts}
				render={(link, index) => (
					<li key={index}>
						<LinkToMemory
							target={link.target}
							how={link.how}
							label={link.target ? titleOf(link.target) : link.handle}
							onOpen={onOpen}
						/>
					</li>
				)}
				empty="This memory does not declare that it contradicts anything."
			/>

			<Direction
				heading="Corrected by"
				items={links.corrected_by}
				render={(link, index) => (
					<li key={index}>
						<LinkToMemory target={link.from} how={link.how} label={titleOf(link.from)} onOpen={onOpen} />
						{link.says ? <span className="says"> — {link.says}</span> : null}
					</li>
				)}
				empty="No loaded memory declares that it corrects this one."
			/>

			<Direction
				heading="Contradicted by"
				items={links.contradicted_by}
				render={(link, index) => (
					<li key={index}>
						<LinkToMemory target={link.from} how={link.how} label={titleOf(link.from)} onOpen={onOpen} />
					</li>
				)}
				empty="No loaded memory declares that it contradicts this one."
			/>

			<LineageReading lineage={lineage} error={lineageError} onOpen={onOpen} titleOf={titleOf} />
		</Disclosure>
	);
}

function Direction({ heading, items, render, empty }) {
	return (
		<div className="direction">
			<h4>{heading}</h4>
			{items.length === 0 ? <p className="neutral">{empty}</p> : <ul className="plain">{items.map(render)}</ul>}
		</div>
	);
}

/**
 * What the vault itself says about the inbound direction, as opposed to what the loaded set implies.
 *
 * The two can differ, and the difference is honest: the inversion above sees only declared links
 * among memories that loaded, and this read is the store's own answer. When the read is unavailable
 * the panel says so — an absent second opinion is not the same as agreement.
 */
function LineageReading({ lineage, error, onOpen, titleOf }) {
	if (error) {
		return (
			<p className="neutral">
				The vault's own answer for this direction could not be read: {error.message}. What is above
				is computed from the memories on this screen.
			</p>
		);
	}
	if (!lineage || lineage.pending) {
		return <p className="neutral">Reading what the vault records for this memory…</p>;
	}

	const marked = lineage.duplicate_of ?? lineage.superseded_by ?? null;
	const contradictedBy = lineage.contradicted_by ?? [];

	return (
		<div className="direction">
			<h4>What the vault records</h4>
			{marked ? (
				<p>
					<span className="key">superseded by</span>{' '}
					<button type="button" className="link-button inline" onClick={() => onOpen(marked)}>
						{titleOf(marked)}
					</button>
				</p>
			) : null}
			{Array.isArray(contradictedBy) && contradictedBy.length > 0 ? (
				<ul className="plain">
					{contradictedBy.map((item, index) => {
						const id = typeof item === 'string' ? item : item?.memory_id;
						return (
							<li key={index}>
								<LinkToMemory target={id} how="by_id" label={titleOf(id)} onOpen={onOpen} />
							</li>
						);
					})}
				</ul>
			) : null}
			{!marked && (!Array.isArray(contradictedBy) || contradictedBy.length === 0) ? (
				<p className="neutral">
					The vault records nothing else pointing at this memory, and it is not marked as a
					duplicate of another.
				</p>
			) : null}
		</div>
	);
}

/**
 * The admission block as it is, and a sentence when it is empty.
 *
 * Presenting a structure full of zeros as an audit trail is worse than saying nothing was compared,
 * because the reader takes the shape of the panel as evidence that a comparison happened.
 */
function Admission({ admission, titleOf, onOpen }) {
	const compared = admission?.compared ?? 0;

	return (
		<Disclosure title="Why this was accepted">
			{!admission ? (
				<p className="neutral">This record carries nothing about how it was accepted.</p>
			) : compared === 0 ? (
				<p className="neutral">Accepted without comparing against anything.</p>
			) : (
				<dl className="detail-meta">
					<dt>Compared against</dt>
					<dd>
						{compared} of {admission.scanned ?? compared} considered
					</dd>
					<dt>Nearest memory</dt>
					<dd>
						{admission.nearest_memory_id ? (
							<button
								type="button"
								className="link-button inline"
								onClick={() => onOpen(admission.nearest_memory_id)}
							>
								{titleOf(admission.nearest_memory_id)}
							</button>
						) : (
							<NotRecorded what="nearest memory" />
						)}
					</dd>
					<dt>Outcome</dt>
					<dd>{admission.disposition ?? <NotRecorded what="disposition" />}</dd>
					{Array.isArray(admission.reasons) && admission.reasons.length > 0 ? (
						<>
							<dt>Reasons</dt>
							<dd>{admission.reasons.join(', ')}</dd>
						</>
					) : null}
				</dl>
			)}
		</Disclosure>
	);
}

/**
 * The axes that are true, and one sentence that is fixed.
 *
 * That sentence is the whole job of this panel. "Created by" is the first column anyone would add
 * to a memory browser and the easiest one to fill with plausible-looking values, and there is no
 * per-memory writer on an exported record — no principal, no client, no app, no session, no device.
 * The scope axes and the first-written date look like provenance and are not. Saying so once, in
 * words, is what stops the next contributor from inventing the column.
 */
function Provenance({ row, axes }) {
	return (
		<Disclosure title="Provenance">
			<dl className="detail-meta">
				<dt>Applies to</dt>
				<dd>
					<ScopeLine scope={row.scope} axes={axes} />
				</dd>
				<dt>First written</dt>
				<dd>{row.created_on ?? <NotRecorded what="first written" />}</dd>
				<dt>Write order</dt>
				<dd>{row.sequence ?? <NotRecorded what="write order" />}</dd>
			</dl>
			<p className="fixed-sentence">
				Who wrote this: not recorded. kscope does not store a writer on a memory.
			</p>
		</Disclosure>
	);
}

/**
 * The record, as the browser received it — which is not quite as the engine produced it.
 *
 * A disclosure that quietly omitted fields would be a worse disclosure than none, so it names what
 * was removed and why. The list comes from what the server reported it actually dropped, not from a
 * list written here, so a field that stops being emitted stops being claimed.
 */
function RawRecord({ record, strippedFields }) {
	const stripped = strippedFields ?? [];
	return (
		<Disclosure title="Raw record">
			<p className="neutral">
				{stripped.length === 0
					? 'This is the record as the server received it from the engine.'
					: `This is the record with ${stripped.length} field${
							stripped.length === 1 ? '' : 's'
						} removed before it reached this browser: ${stripped.join(', ')}. They are derived
						from the memory rather than written by anyone, no screen renders them, and together
						they are a large share of the bytes.`}
			</p>
			<pre className="verbatim">{JSON.stringify(record, null, 2)}</pre>
		</Disclosure>
	);
}
