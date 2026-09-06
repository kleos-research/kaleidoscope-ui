import { useState } from 'react';

import { cx } from './cx.mjs';
import { ChevronRight } from './icons.jsx';
import { Eyebrow } from './text.jsx';

/**
 * THE SHAPES A MEMORY IS READ IN.
 *
 * `ReadB` and `ReadEvidence` are one screen drawn twice, and everything below is a piece of it:
 * prose on the left at a readable measure, and a rail on the right carrying what an agent would
 * act on. The rail is the whole design decision — the owner's complaint about the old page was
 * "there's a huge note, which I understand; I have to scroll quite a lot below to facts, named
 * things, then some evidence" — so the facts sit BESIDE the words and stay there while the words
 * scroll.
 *
 * WHY A FACT IS DRAWN TWO WAYS IN THIS PRODUCT, and it is not an inconsistency. Every approved
 * READING surface — this rail, the list preview, the scaled list — draws the relation as accent
 * text inside the sentence. Every approved EDITING surface draws it as an accent chip. The chip is
 * a control: it is the thing you click to change the verb. Text that is not a control must not
 * wear a control's shape, so `RelationBadge` belongs to the editor and `FactSentence` belongs
 * here.
 */

/* --------------------------------------------------------------------------------- the layout */

/**
 * The two columns, and the rail that does not scroll away.
 *
 * `rail` is a separate prop rather than a child so no screen can put the prose in the rail or the
 * rail under the prose. The rail sticks: on a long memory the words move under a fixed set of
 * facts, which is the difference between "the facts are on this page" and "the facts are on this
 * screen".
 */
export function Reading({ rail = null, children }) {
	return (
		<div className="reading">
			<div className="reading-inner">
				<div className="reading-column">{children}</div>
				{rail ? <aside className="reading-rail">{rail}</aside> : null}
			</div>
		</div>
	);
}

/** A block in the reading column: its label, and an optional mark saying what kind of thing it is. */
export function Section({ title, mark = null, children }) {
	return (
		<section className="reading-section">
			<header className="reading-section-head">
				<Eyebrow>{title}</Eyebrow>
				{mark}
			</header>
			{children}
		</section>
	);
}

/* ---------------------------------------------------------------------------------- the facts */

/** The rail's list of what this memory asserts. `rail` sets the denser size the mockups draw. */
export function FactList({ rail = false, children }) {
	return <div className={cx('facts', rail && 'facts-rail')}>{children}</div>;
}

/**
 * "build cache — is keyed on — lockfile hash."
 *
 * The endpoints are the page's ink and the relation is accent. A fact with a missing endpoint is
 * still rendered: the record carries what it carries, and a blank in the middle of a sentence is
 * something a reader can see and report, which an omitted row is not.
 */
export function FactSentence({ subject, predicate, object }) {
	return (
		<p className="fact">
			<span>{subject}</span> <span className="fact-relation">{predicate}</span>{' '}
			<span>{object}</span>
		</p>
	);
}

/* ------------------------------------------------------------------------------- the evidence */

/**
 * Where a memory says it came from: a kind badge and a locator, and one sentence about what that
 * is worth.
 *
 * THE KIND SET IS OPEN. `file`, `test`, `user_statement`, `commit`, `pull_request`, `command`,
 * `measurement` and more arrive from whoever wrote the memory, so the badge prints the kind exactly
 * as the record spells it and NOTHING here branches on the value. The face is chosen from the shape
 * of the reference instead — see `looksLikeLocator` — because a rule about a string is a rule this
 * repository is allowed to have, and a list of kind names is one that would drift the moment a
 * writer used a kind nobody here had thought of.
 *
 * `footnote` is the caller's, and the reading view always passes one. It is the only place the app
 * says what evidence on a memory actually is: a pointer the writer left, not a verified citation.
 */
export function Evidence({ items, footnote = null }) {
	return (
		<div className="evidence">
			{items.map((item, index) => {
				const reference = item?.reference ?? null;
				const locator = looksLikeLocator(reference);
				return (
					<div className="evidence-item" key={index}>
						{/*
						  A SPELLING TRANSFORM, NOT A VOCABULARY: underscores become spaces, so `user_statement`
						  reads USER STATEMENT and `pull_request` reads PULL REQUEST. The value is still the
						  record's own, letter for letter; nothing here maps a kind to a word of its own.
						*/}
						<span className="badge badge-tag">
							{String(item?.kind ?? 'evidence').replace(/_/g, ' ').toUpperCase()}
						</span>
						<span className="evidence-body">
							<span className={cx('evidence-ref', locator && 'evidence-ref-mono')}>
								{reference ?? <span className="faint">no locator recorded</span>}
							</span>
							{/*
							  The digest, when the writer left one. It is what makes a piece of evidence
							  checkable rather than merely named, and it is on its own line because it is
							  long, it is compared character by character, and nothing shortens it.
							*/}
							{item?.digest ? <span className="evidence-digest">{item.digest}</span> : null}
						</span>
					</div>
				);
			})}
			{footnote ? <p className="evidence-foot">{footnote}</p> : null}
		</div>
	);
}

/**
 * Whether a reference reads as a path, a command or an identifier — as opposed to a sentence.
 *
 * A locator is set in the mono face because that is what tells a reader they can paste it
 * somewhere. The test is on the STRING and never on the evidence kind: the kinds are an open set
 * published by the engine, and a component that switched on `kind === 'file'` would be this
 * repository writing down a vocabulary it is not allowed to write down.
 *
 * Two shapes count: something with no spaces in it at all (a path, a URL, a digest, an id), and
 * something whose first word is followed by a flag (`psql -c …`, `cargo test --locked`), which is
 * how a command looks and how a sentence does not.
 */
export function looksLikeLocator(reference) {
	if (typeof reference !== 'string') return false;
	const text = reference.trim();
	if (text.length === 0) return false;
	if (!/\s/.test(text)) return true;
	return /^\S+\s+-{1,2}[A-Za-z]/.test(text);
}

/* ----------------------------------------------------------------------- notes and real links */

/**
 * Somebody's sentence, quoted, under the handle they wrote it about.
 *
 * This is what a correction is: free text with a handle in front of it and NO STORED LINK to
 * anything. The quote rule is the whole reason this is its own shape — it must not be able to grow
 * a chevron, a hover state or an `onOpen`, because the moment it does, the screen is asserting a
 * relationship the vault does not hold.
 */
export function NoteQuote({ handle, says, children = null }) {
	/*
	  TWO BLOCKS, NOT ONE TINTED BOX. ReadEvidence draws the writer's own words on the page itself,
	  marked only by a warn rule down the left, and then the app's explanation of them on the raised
	  tint below. Wrapping both in one `.note` painted the quotation the same colour as the commentary
	  about it, so the reader could not see where the writer stopped speaking and this app started.
	*/
	return (
		<div className="note-quote-block">
			<div className="note-quote">
				<div className="note-handle">{handle}</div>
				{says ? <p className="prose prose-sm note-says">{says}</p> : null}
			</div>
			{children ? <p className="note note-foot">{children}</p> : null}
		</div>
	);
}

/**
 * A row that goes somewhere, with a chevron that says so.
 *
 * The chevron is not decoration and it is the reason this is not the same component as `NoteQuote`:
 * in the approved design the arrow appears on links the vault actually stores and on nothing else.
 * A reader can therefore tell the two apart without reading either label.
 */
export function LinkCard({ title, meta = null, onClick }) {
	return (
		<button type="button" className="link-card" onClick={onClick}>
			<span className="link-card-body">
				<span className="prose prose-sm link-card-title">{title}</span>
				{meta ? <span className="link-card-meta">{meta}</span> : null}
			</span>
			<ChevronRight size={15} className="icon link-card-icon" />
		</button>
	);
}

/* ------------------------------------------------------------------------------- named things */

/**
 * A declared name, its kind and the gloss the writer supplied. The rail's second card in `ReadB`.
 *
 * `compact` draws the name and the kind on one line and keeps the gloss behind a press. It is for a
 * list long enough that fourteen three-line glosses would be taller than the rail beside them —
 * the merge composition's — where the reader is checking WHICH names travel, not what each means.
 *
 * WHAT IS SHOWN OF A GLOSS. A vault stores a gloss as `surface | kind | definition`, and drawn
 * whole under a line that already says the surface and the kind it read "kaleidoscope · artifact ·
 * kaleidoscope | artifact | the local memory runtime" — the two values printed twice with pipes
 * between. `glossDefinition` strips exactly that prefix when it repeats what is already on the
 * line, and otherwise shows the gloss as it is.
 */
export function NamedThing({ name, kind = null, gloss = null, compact = false }) {
	const [open, setOpen] = useState(false);
	const definition = glossDefinition(gloss, name, kind);
	if (compact) {
		return (
			<div className="named named-compact">
				<div className="named-line">
					<span className="named-name">{name}</span>
					{kind ? <span className="named-gloss">{kind}</span> : null}
					{definition ? (
						<button
							type="button"
							className="link-more"
							aria-expanded={open}
							onClick={() => setOpen(!open)}
						>
							{open ? 'less' : 'what it is'}
						</button>
					) : null}
				</div>
				{open && definition ? <div className="named-gloss">{definition}</div> : null}
			</div>
		);
	}
	return (
		<div className="named">
			<div className="named-name">{name}</div>
			{kind || definition ? (
				<div className="named-gloss">
					{kind ? <span>{kind}</span> : null}
					{kind && definition ? <span className="faint"> · </span> : null}
					{definition ? <span>{definition}</span> : null}
				</div>
			) : null}
		</div>
	);
}

/**
 * The definition clause of a stored gloss, when the gloss opens by repeating the surface and the
 * kind that are already drawn beside it. A gloss in any other shape is returned whole: this reads
 * a layout the writer used, it does not know a vocabulary.
 */
export function glossDefinition(gloss, name = null, kind = null) {
	if (typeof gloss !== 'string') return gloss ?? null;
	const parts = gloss.split('|').map((part) => part.trim());
	if (parts.length >= 3) {
		const [first, second, ...rest] = parts;
		const sameName = name ? first.toLowerCase() === String(name).trim().toLowerCase() : false;
		const sameKind = kind ? second.toLowerCase() === String(kind).trim().toLowerCase() : false;
		if (sameName && (sameKind || !kind)) return rest.join(' | ').trim() || null;
	}
	return gloss;
}

/* ------------------------------------------------------------------------- term-and-value list */

/**
 * The term-and-value list the collapsed rows are made of: "Written", "Version", "Applies to".
 *
 * A real `<dl>`, because that is what it is, and because the terms are read by screen readers as
 * the labels of their values rather than as another line of text.
 */
export function Readings({ children }) {
	return <dl className="readings">{children}</dl>;
}

export function ReadingPair({ term, children }) {
	return (
		<div className="reading-pair">
			<dt>{term}</dt>
			<dd>{children}</dd>
		</div>
	);
}
