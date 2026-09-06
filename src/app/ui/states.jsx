import { cx } from './cx.mjs';

/**
 * The four things a screen can be instead of itself, as one shape in four tones.
 *
 * ONE SHAPE, so a reader learns it once and can always tell which of the four they are looking at.
 * The failure this prevents is the commonest one in a data app: an empty list and a list that has
 * not arrived yet look identical, so a reader concludes their vault is empty when it is loading.
 *
 * EACH ONE NAMES ITS OWN CAUSE, and the caller supplies the heading rather than the component
 * guessing it. There are several distinct reasons a screen can have nothing on it and they need
 * different things from the reader: an empty vault is a fact, an unreadable one is a machine to
 * fix, an oversized one is a limit of this version, and an over-narrow filter is one click from
 * being fixed. A shared "no results" would flatten all four into the least useful of them.
 */

/**
 * Reading the vault.
 *
 * A SPINNER WOULD BE A LIE OF OMISSION. This read is the whole vault in one call, because the door
 * behind it takes no filter and no page — so saying so turns a wait into an explanation, and it is
 * also the sentence that tells the reader why nothing after this point ever waits again.
 */
export function LoadingState({ what = 'Reading your memories', children = null }) {
	return (
		<section className="state state-loading" aria-busy="true" aria-live="polite">
			<h2 className="state-title">{what}</h2>
			{/*
			  The default sentence is about the one wait this app has, and a caller REPLACES it rather
			  than adding to it. There is a second wait now — opening a different vault, which stops
			  and restarts the local server — and it is a different explanation, not an extra one. Two
			  paragraphs would leave the reader deciding which of them they are in.
			*/}
			<p className="state-body">
				{children ?? (
					<>
						This is one read of the whole vault. The door behind it takes no filter and no page,
						so everything after it — filtering, sorting, opening a memory — happens in this
						window and waits for nothing.
					</>
				)}
			</p>
		</section>
	);
}

/**
 * Nothing to show, with the reason in the heading.
 *
 * `action` is a control, not a sentence. A state with no next move is a dead end, and a dead end in
 * a tool about somebody's own memory reads as data loss.
 */
export function EmptyState({ heading, children = null, action = null }) {
	return (
		<section className="state">
			<h2 className="state-title">{heading}</h2>
			{children ? <div className="state-body">{children}</div> : null}
			{action ? <div className="state-actions">{action}</div> : null}
		</section>
	);
}

/**
 * A failure, carrying THE WORDS THAT CAME BACK from the thing that failed rather than a summary.
 *
 * The engine names the field or the condition it refused on. Paraphrasing that is how a fixable
 * refusal becomes an unfixable one, so the message is printed as given and the body, when there is
 * one, is printed under it.
 */
export function ErrorState({ heading, error, action = null }) {
	return (
		<section className="state state-error" role="alert">
			<h2 className="state-title">{heading}</h2>
			<p className="state-body">{error?.message ?? String(error)}</p>
			{error?.body ? (
				<pre className="state-detail identifier">{String(error.body).slice(0, 2000)}</pre>
			) : null}
			{action ? <div className="state-actions">{action}</div> : null}
		</section>
	);
}

/**
 * The listing was REFUSED because the vault is bigger than one read.
 *
 * A refusal is not an error and not an empty vault. It is the third thing a listing request can
 * come back as, it arrives with HTTP 200, and it gets its own screen because the other two would
 * each say something false. The count and the ceiling are shown because "too large" without a
 * number is a wall, and with the number it is a fact about a specific vault that a reader can act
 * on by narrowing to one project.
 */
export function TooLargeState({
	heading = 'This vault is larger than one read',
	count = null,
	ceiling = null,
	children = null,
	action = null,
}) {
	return (
		<section className={cx('state', 'state-toolarge')}>
			<h2 className="state-title">{heading}</h2>
			<div className="state-body">
				{children ?? (
					<p>
						Nothing is wrong and nothing is lost. The door that returns everything returns it in
						one piece, with no paging, so above a certain size this app declines to ask rather
						than stalling on it.
					</p>
				)}
			</div>
			{count !== null && ceiling !== null ? (
				<p className="state-detail">
					{count} memories, against a ceiling of {ceiling} for a single read.
				</p>
			) : null}
			{action ? <div className="state-actions">{action}</div> : null}
		</section>
	);
}

/** A "still working" that does not take the screen away from what is already on it. */
export function InlineBusy({ children = 'Working…' }) {
	return (
		<span className="inline-busy" aria-live="polite">
			{children}
		</span>
	);
}
