import { useId, useState } from 'react';

import { axisCopy } from './records.mjs';

/**
 * The pieces every screen shares, and the two states that are usually left blank.
 *
 * The rule this file exists to hold: A VALUE THE RECORD DOES NOT CARRY IS RENDERED IN WORDS. Never
 * a dash, never an empty cell, never a placeholder that could be mistaken for data. The failure
 * mode is not a user misreading a blank — it is the next contributor treating the blank as a bug
 * and filling it in with something plausible, after which the product asserts something the store
 * never recorded.
 */

/** What an absent value looks like. One component, so there is one wording. */
export function NotRecorded({ what = null }) {
	return (
		<span className="not-recorded">
			not recorded{what ? <span className="sr-only"> — {what}</span> : null}
		</span>
	);
}

/**
 * An identifier, in monospace and selectable.
 *
 * Deliberately not truncated in the DOM. These are what a save conflict quotes back, and a user
 * comparing two of them is comparing character by character — an ellipsis in the middle of one is
 * the difference between a comparison and a guess. The CSS may wrap it; nothing shortens it.
 */
export function Identifier({ value, label = null }) {
	if (!value) return <NotRecorded what={label} />;
	return (
		<code className="identifier" title={label ?? undefined}>
			{value}
		</code>
	);
}

/** A short literal value from the vault — a type, a kind, a relation. Rendered as it is spelled. */
export function Chip({ children, tone = 'neutral' }) {
	return <span className={`chip chip-${tone}`}>{children}</span>;
}

/**
 * "Applies to", as words.
 *
 * An omitted axis matches EVERY request, so the phrase is not a nicety — a blank here reads as
 * "narrower" and means "wider", which is the single most likely misreading on the screen.
 */
export function ScopeLine({ scope, axes }) {
	return (
		<span className="scope-line">
			{axes.map((axis, index) => {
				const value = scope?.[axis] ?? null;
				const copy = axisCopy(axis);
				return (
					<span key={axis} className="scope-part">
						{index > 0 ? <span className="scope-sep"> · </span> : null}
						{value === null ? (
							<span className="scope-every">{copy.every}</span>
						) : (
							<>
								<span className="scope-axis">{copy.label}</span>{' '}
								<span className="scope-value">{value}</span>
							</>
						)}
					</span>
				);
			})}
		</span>
	);
}

/** A collapsed panel. Its contents are not fetched or computed until it is opened. */
export function Disclosure({ title, count = null, children, defaultOpen = false, onOpen = null }) {
	const [open, setOpen] = useState(defaultOpen);
	const id = useId();

	return (
		<section className="disclosure">
			<h3>
				<button
					type="button"
					className="disclosure-toggle"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => {
						const next = !open;
						setOpen(next);
						if (next && onOpen) onOpen();
					}}
				>
					<span className="disclosure-marker" aria-hidden="true">
						{open ? '▾' : '▸'}
					</span>
					<span className="disclosure-title">{title}</span>
					{count === null ? null : <span className="disclosure-count">{count}</span>}
				</button>
			</h3>
			{open ? (
				<div className="disclosure-body" id={id}>
					{children}
				</div>
			) : null}
		</section>
	);
}

/**
 * The loading state, which says what is happening and why it happens once.
 *
 * A spinner would be a lie of omission here: this read is the whole vault in one call, because the
 * door behind it accepts no filter and no page. Saying so turns a wait into an explanation, and it
 * is also the sentence that tells a user why nothing after this point ever waits again.
 */
export function LoadingState({ what = 'Reading the vault' }) {
	return (
		<div className="state state-loading" aria-busy="true" aria-live="polite">
			<h2>{what}</h2>
			<p>
				This is one read of the whole vault. The door behind it takes no filter and no page, so
				everything after this — filtering, sorting, opening a memory — happens in this browser
				and costs nothing.
			</p>
			<ul className="skeleton" aria-hidden="true">
				{Array.from({ length: 7 }, (_, index) => (
					<li key={index} style={{ opacity: 1 - index * 0.12 }}>
						<span className="skeleton-title" />
						<span className="skeleton-meta" />
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * An empty state that names its own cause.
 *
 * There are several distinct reasons this screen can have nothing on it and they need different
 * things from the reader: an empty vault is a fact, an unreadable one is a machine to fix, an
 * oversized one is a limit of this version, and an over-narrow filter is one click from being
 * fixed. A shared "no results" would flatten all four into the least useful of them.
 */
export function EmptyState({ heading, children, action = null }) {
	return (
		<div className="state state-empty">
			<h2>{heading}</h2>
			<div className="state-body">{children}</div>
			{action}
		</div>
	);
}

/** A failure, with the words that came back from the thing that failed rather than a summary. */
export function ErrorState({ heading, error, action = null }) {
	return (
		<div className="state state-error" role="alert">
			<h2>{heading}</h2>
			<p>{error?.message ?? String(error)}</p>
			{error?.body ? <pre className="state-detail">{String(error.body).slice(0, 2000)}</pre> : null}
			{action}
		</div>
	);
}
