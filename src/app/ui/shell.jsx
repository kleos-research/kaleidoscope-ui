import { Fragment, useState } from 'react';

import { IconButton } from './button.jsx';
import { cx } from './cx.mjs';
import { ChevronDown, ChevronLeft, More, Refresh, Search } from './icons.jsx';
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from './overlays.jsx';

/**
 * THE SHELL. One 56px bar over one region, and it is the same object on every screen.
 *
 * The owner's diagnosis was that each screen had been assembled from whatever it happened to need.
 * A shell that is identical everywhere is what makes the screens under it comparable, so the two
 * bars below are two MODES of one component rather than two components:
 *
 *   ROOT   wordmark · vault · project · four destinations · find-or-ask · refresh · more
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
 * `nav`, `project` and `vault` are given rather than derived here, because this component knows
 * nothing about the session, the routes or the payload — six screens compose it and none of them
 * should have to agree with this file about where the data comes from.
 */
export function RootBar({ vault, project, context = null, nav, find, onRefresh, refreshing = false, moved = false, menu = null }) {
	return (
		<header className="topbar">
			<div className="topbar-group">
				<a className="wordmark" href="#/">
					Kaleidoscope
				</a>
				{vault}
				<span className="topbar-divider" aria-hidden="true" />
				{project}
				{context ? <span className="topbar-context">{context}</span> : null}
			</div>

			{nav}

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
 * The four destinations.
 *
 * "I see Kaleidoscope, Memories, Needs a decision, Graph, New memory. I don't know what either of
 * them does." Two of the five are gone: "Graph" is now NAMES, which says what is in there rather
 * than what it is drawn as, and "New memory" was never a place — it is an action and it lives in
 * the More menu with the other actions.
 *
 * Every remaining label is a plain noun a reader can act on without being told what it means, which
 * is the test the old set failed.
 */
export const DESTINATIONS = [
	{ href: '#/', route: 'list', label: 'Memories' },
	{ href: '#/search', route: 'search', label: 'Search' },
	{ href: '#/names', route: 'names', label: 'Names' },
	{ href: '#/decide', route: 'decide', label: 'Needs a decision' },
];

export function Nav({ current }) {
	return (
		<nav className="topbar-nav" aria-label="Sections">
			{DESTINATIONS.map((entry) => (
				<a
					key={entry.route}
					className="nav-link"
					href={entry.href}
					aria-current={entry.route === current ? 'page' : undefined}
				>
					{entry.label}
				</a>
			))}
		</nav>
	);
}

/**
 * THE VAULT, AS A SHORT NAME.
 *
 * "I don't know why we need to enter the entire folder path. It's too long."
 *
 * The button shows the last segment of the resolved root. The popover carries the full path and
 * every reading this app took from the machine — which engine answered, from where, which contract
 * it prints, whether the model is in it, and where this app keeps its copies. Nothing was removed;
 * a fingerprint stopped being a headline.
 *
 * `readings` is [{ term, value }] so this component holds no opinion about what a session contains.
 */
export function VaultName({ name, readings = [] }) {
	return (
		<Popover
			trigger={
				<button type="button" className="vault-name">
					<span className="vault-name-text">{name ?? 'resolving…'}</span>
					<ChevronDown size={11} />
				</button>
			}
		>
			<dl className="vault-sheet">
				{readings.map((reading) => (
					<div key={reading.term} className="vault-reading">
						<dt>{reading.term}</dt>
						<dd className={reading.mono ? 'identifier' : undefined}>{reading.value}</dd>
					</div>
				))}
			</dl>
		</Popover>
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
 * @param projects  [{ value, label, count }] computed from the loaded records.
 * @param value     a project value, or `null` for "every project".
 * @param everywhereCount  how many memories carry no project at all.
 */
export function ProjectSwitcher({
	projects = [],
	value = null,
	onChange,
	shown = null,
	everywhereCount = 0,
}) {
	const chosen = projects.find((entry) => entry.value === value) ?? null;

	return (
		<DropdownMenu
			align="start"
			className="project-menu"
			trigger={
				<button type="button" className="project-switcher">
					<span className="project-switcher-name">{chosen ? chosen.label : 'Every project'}</span>
					{shown === null ? null : <span className="project-switcher-count">{shown}</span>}
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
 * ONE BOX, TWO JOBS, AND IT RUNS NEITHER OF THEM.
 *
 * This control is a NAVIGATION. Typing here filters nothing and asks nothing; pressing Enter
 * carries the words to the search screen, where "Find these words" runs over the payload the
 * browser already holds and "Ask the way your agent does" is a separate, deliberate press.
 *
 * That is the whole reason the ranked door can be an explicit, user-initiated action: no keystroke
 * anywhere in this app reaches it, including here, in the box that most looks like it would.
 */
export function FindOrAsk({ onSubmit, placeholder = 'Find or ask' }) {
	const [text, setText] = useState('');
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
				onChange={(event) => setText(event.target.value)}
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
export function Page({ narrow = false, children }) {
	return (
		<div className="screen">
			<div className={cx('page', narrow && 'page-narrow')}>{children}</div>
		</div>
	);
}
