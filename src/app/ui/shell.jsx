import { Fragment, useEffect, useState } from 'react';

import { IconButton } from './button.jsx';
import { cx } from './cx.mjs';
import { ChevronDown, ChevronLeft, More, Refresh, Search } from './icons.jsx';
import { Dialog, DropdownMenu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from './overlays.jsx';

/**
 * THE SHELL. One 56px bar over one region, and it is the same object on every screen.
 *
 * The owner's diagnosis was that each screen had been assembled from whatever it happened to need.
 * A shell that is identical everywhere is what makes the screens under it comparable, so the two
 * bars below are two MODES of one component rather than two components:
 *
 *   ROOT   wordmark · project · four destinations · find · refresh · more
 *   FOCUS  back · where you are · what you can do here
 *
 * Everything in either mode is reachable without scrolling. That is a direct fix: "I do see a
 * Refresh, but I have to scroll."
 */

export function AppShell({ bar, notices = null, children }) {
	return (
		<div className="app">
			{bar}
			<main className="main">
				{notices}
				{children}
			</main>
		</div>
	);
}

/**
 * The bar every list-level screen wears.
 *
 * `nav` and `project` are given rather than derived here, because this component knows nothing
 * about the session, the routes or the payload — six screens compose it and none of them should
 * have to agree with this file about where the data comes from.
 *
 * It is wordmark · divider · project · the four words, exactly as BrowseB draws it. There is no
 * vault chip and no "of 396 in this vault" beside the project: the first was a label the owner
 * would ask about (on his own install it read "Kaleidoscope  kaleidoscope"), and the second is
 * the same number the filter rail's foot already carries.
 */
export function RootBar({ project, nav, find, onRefresh, refreshing = false, moved = false, menu = null }) {
	return (
		<header className="topbar">
			<div className="topbar-group">
				<a className="wordmark" href="#/">
					Kaleidoscope
				</a>
				<span className="topbar-divider" aria-hidden="true" />
				{project}
				{nav}
			</div>

			<div className="topbar-group topbar-group-right">
				{find}
				{onRefresh ? (
					<Tooltip
						label={
							moved
								? 'This vault has changed since you last read it. Read it again.'
								: 'Read the vault again'
						}
					>
						<span className="refresh-wrap">
							<IconButton
								label={moved ? 'This vault has changed — read it again' : 'Read the vault again'}
								onClick={onRefresh}
								disabled={refreshing}
							>
								<Refresh size={15} />
							</IconButton>
							{/*
							  The dot FETCHES NOTHING. The liveness read said the vault moved; the dot waits
							  to be asked. An accepted refresh is the only thing that re-reads, so the
							  reader decides when a re-read costs them a wait.
							*/}
							{moved ? <span className="refresh-dot" aria-hidden="true" /> : null}
						</span>
					</Tooltip>
				) : null}
				{menu}
			</div>
		</header>
	);
}

/**
 * The bar one memory, the editor and one name in the graph wear.
 *
 * It REPLACES the root bar rather than sitting under it. A second row of chrome is exactly the
 * thing the reader has to scroll past before reaching what they opened, and the mockups for Read,
 * Edit and GraphFocus all draw one bar.
 */
export function FocusBar({ backTo = '#/', backLabel, trail = [], actions = null }) {
	return (
		<header className="topbar">
			<div className="topbar-group">
				<a className="topbar-back" href={backTo}>
					<ChevronLeft size={15} />
					{backLabel}
				</a>
				{trail.length > 0 ? (
					<nav className="breadcrumb" aria-label="Where you are">
						{trail.map((step) => (
							<Fragment key={step}>
								<span className="breadcrumb-sep" aria-hidden="true">
									/
								</span>
								<span className="breadcrumb-current">{step}</span>
							</Fragment>
						))}
					</nav>
				) : null}
			</div>
			<div className="topbar-group topbar-group-right">{actions}</div>
		</header>
	);
}

/**
 * THE FOUR DESTINATIONS — the one thing the approved mockups had not drawn.
 *
 * Every board draws the bar as wordmark · project · find · refresh · more, and nothing that moves
 * between screens; the first build put a row of boxed links back because three of the four were
 * otherwise unreachable, and a row of boxes was the first thing rejected: "I see Kaleidoscope,
 * Memories, Needs a decision, Graph, New memory. I don't know what either of them does."
 *
 * So it is now drawn, in BrowseB.dc.html, as the quietest form that is still self-evident: four
 * words set after the project chip, because everything sits under a project. No boxes, no icons.
 * The screen you are on is the one word in ink with a 2px accent rule under it; the others sit in
 * the muted grey. Each label says what its screen is FOR on its own — MEMORIES is the list; ASK is
 * asking the way the agent does, which is the whole point of that screen and why it is not called
 * "Search"; NAMES is what the memories talk about, said as what is in there rather than what it is
 * drawn as ("Graph" failed that test); NEEDS A DECISION is the queue that waits on a person. "New
 * memory" was never a place — it is an action and lives in the More menu with the other actions.
 *
 * `route` is the name `routeFromHash` gives the screen, and it is what `aria-current` is matched
 * on — so it has to be the route's own name, not the path's. The curation queue is `#/decide` on
 * the URL and `backlog` as a route, and a table that said `decide` here would never light up.
 */
export const DESTINATIONS = [
	{ href: '#/', route: 'list', label: 'Memories', key: '1' },
	{ href: '#/search', route: 'search', label: 'Ask', key: '2' },
	{ href: '#/names', route: 'names', label: 'Names', key: '3' },
	{ href: '#/decide', route: 'backlog', label: 'Needs a decision', key: '4' },
];

/**
 * Whether a keystroke belongs to something else.
 *
 * A digit typed into the find box, the editor, a combobox or an open menu is text or typeahead,
 * never a navigation. The check is on the TARGET rather than on which screen is open, because the
 * screen does not know what is focused and a menu opened from the More button is not a screen.
 */
function keystrokeIsTaken(target) {
	if (!(target instanceof Element)) return false;
	if (target.isContentEditable) return true;
	if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
	return target.closest('[role="menu"], [role="dialog"], [role="listbox"], [role="combobox"]') !== null;
}

export function Nav({ current }) {
	/*
	  1–4 go where the four words go. The listener lives here, with the words, so it is armed
	  exactly where the words are visible — a focus screen wears no nav and gets no shortcuts, which
	  is what keeps a stray digit from carrying a reader out of a half-finished edit.
	*/
	useEffect(() => {
		function onKeyDown(event) {
			if (event.defaultPrevented || event.isComposing) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const entry = DESTINATIONS.find((candidate) => candidate.key === event.key);
			if (!entry || keystrokeIsTaken(event.target)) return;
			event.preventDefault();
			window.location.hash = entry.href;
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<nav className="topbar-nav" aria-label="Sections">
			{DESTINATIONS.map((entry) => (
				<a
					key={entry.route}
					className="nav-link"
					href={entry.href}
					aria-current={entry.route === current ? 'page' : undefined}
					aria-keyshortcuts={entry.key}
					title={`Press ${entry.key}`}
				>
					{entry.label}
				</a>
			))}
		</nav>
	);
}

/**
 * ABOUT THIS VAULT — the readings, behind the last item of the "…" menu.
 *
 * "I don't know why we need to enter the entire folder path. It's too long."
 *
 * The full path and every reading this app took from the machine — which engine answered, from
 * where, which contract it prints and which ones this build was tested against, whether the model
 * is in it, and where this app keeps its copies. Nothing was removed from what the old vault chip
 * held; it stopped being resident in the bar, where no approved mockup draws it. The short name is
 * the sheet's title, so the vault is still called what a person calls it.
 *
 * `readings` is [{ term, value, mono }] so this component holds no opinion about what a session
 * contains.
 */
export function AboutVault({ open, onOpenChange, name, readings = [] }) {
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={name ? `About “${name}”` : 'About this vault'}
			description="Where this vault is, which engine answers for it, and what this app was tested against."
		>
			<dl className="vault-sheet">
				{readings.map((reading) => (
					<div key={reading.term || reading.value} className="vault-reading">
						<dt>{reading.term}</dt>
						<dd className={reading.mono ? 'identifier' : undefined}>{reading.value}</dd>
					</div>
				))}
			</dl>
		</Dialog>
	);
}

/**
 * THE PROJECT SWITCHER — the primary axis of the whole product.
 *
 * "Project management should be a totally different thing. You can select which projects to display
 * together, or you can have a general global view. And projects should be on the top. All of this
 * comes under a project at the end of the day."
 *
 * So: a switcher at the top, never a facet in a filter column, never a chip. One choice that every
 * screen below is read through.
 *
 * AND THE HONEST PART. A memory written with no project APPLIES EVERYWHERE — it is offered to an
 * agent working on anything. It is therefore NOT a project called "none", and it is not an
 * alternative to choosing a project: it is included in every project's view, and the menu says so
 * in a sentence rather than by listing it as a peer. Rendering it as one more row would tell the
 * reader that choosing a project hides it, which is the opposite of what the engine does with an
 * unset scope.
 *
 * THE CHIP IS A NAME ALONE, as BrowseB draws it. The count it used to carry is the same number the
 * filter rail's foot prints ("396 of 396 shown") and the menu still says it per row, so on the chip
 * it was a number twice on one screen — and "kaleidoscope 254 ⌄ of 396 in this vault" is not a
 * control, it is a sentence.
 *
 * @param projects  [{ value, label, count }] computed from the loaded records.
 * @param value     a project value, or `null` for "every project".
 * @param everywhereCount  how many memories carry no project at all.
 */
export function ProjectSwitcher({ projects = [], value = null, onChange, everywhereCount = 0 }) {
	const chosen = projects.find((entry) => entry.value === value) ?? null;

	return (
		<DropdownMenu
			align="start"
			className="project-menu"
			trigger={
				<button type="button" className="project-switcher">
					<span className="project-switcher-name">{chosen ? chosen.label : 'Every project'}</span>
					<ChevronDown size={12} />
				</button>
			}
		>
			<MenuItem onSelect={() => onChange(null)}>Every project</MenuItem>
			<MenuSeparator />
			<MenuLabel>Projects</MenuLabel>
			{projects.map((entry) => (
				<MenuItem key={entry.value} onSelect={() => onChange(entry.value)} hint={entry.count}>
					{entry.label}
				</MenuItem>
			))}
			<MenuSeparator />
			<p className="project-menu-note">
				{everywhereCount === 1
					? '1 memory carries no project. It applies everywhere, so it is in every view above — including the one you are in now.'
					: `${everywhereCount} memories carry no project. They apply everywhere, so they are in every view above — including the one you are in now.`}
			</p>
		</DropdownMenu>
	);
}

/**
 * "FIND IN THESE MEMORIES" — the box BrowseB draws over the list, and it does two things, neither
 * of which is a search.
 *
 * Typing NARROWS THE LIST when the caller hands it `value` and `onChange`: arithmetic over the
 * payload the browser already holds, through the same filter the rail's foot counts. On any other
 * screen the box is uncontrolled and holds the words until Enter, which CARRIES them to the search
 * screen — where "Find these words" runs over the same payload and "Ask the way your agent does"
 * is a separate, deliberate press.
 *
 * That is the whole reason the ranked door can be an explicit, user-initiated action: no keystroke
 * anywhere in this app reaches it, including here, in the box that most looks like it would.
 */
export function FindOrAsk({ onSubmit, value, onChange, placeholder = 'Find in these memories' }) {
	const [held, setHeld] = useState('');
	const controlled = typeof onChange === 'function';
	const text = controlled ? (value ?? '') : held;
	return (
		<form
			className="findbox"
			role="search"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(text);
			}}
		>
			<Search size={14} className="icon findbox-icon" />
			<input
				className="findbox-input"
				type="search"
				value={text}
				placeholder={placeholder}
				aria-label={placeholder}
				onChange={(event) => (controlled ? onChange(event.target.value) : setHeld(event.target.value))}
			/>
		</form>
	);
}

/**
 * The "…" in the top bar.
 *
 * Where the actions that are not this screen's one primary button live. Keeping them here is what
 * stops a screen growing the row of five equal controls the owner described as "not aligned
 * correctly" with "not enough padding".
 */
export function OverflowMenu({ children, label = 'More' }) {
	return (
		<DropdownMenu
			trigger={
				<span>
					<IconButton label={label}>
						<More size={15} />
					</IconButton>
				</span>
			}
		>
			{children}
		</DropdownMenu>
	);
}

/**
 * A CENTRED SINGLE-COLUMN SCREEN, and its own scroll region.
 *
 * The shape behind "What removal cannot do", the search screen and the entity table: one column of
 * a readable width, centred under the bar, scrolling on its own so the bar never moves. It carries
 * the scroll region rather than expecting one, because `main` is a flex column with its overflow
 * hidden — a screen that forgets to claim a region is a screen whose bottom half cannot be reached,
 * and that failure looks exactly like a short page.
 *
 * `narrow` is for a screen made of sentences rather than of columns. Prose at 1080px is not a page
 * a person reads; it is a page they lose their place in.
 */
export function Page({ narrow = false, column = null, children }) {
	return (
		<div className="screen">
			<div className={cx('page', narrow && 'page-narrow', column === 'read' && 'page-read')}>{children}</div>
		</div>
	);
}
