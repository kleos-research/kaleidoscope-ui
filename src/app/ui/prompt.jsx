import { cx } from './cx.mjs';

/**
 * THE SHAPES AN ANSWER IS ASKED FOR AND REPORTED IN.
 *
 * A confirmation, a run report, and a block of text the app is showing rather than saying. Three
 * shapes, one file, because all three exist for the same reason: this app never covers what a
 * person was reading with a modal, so the thing it needs an answer about has to stand ON the page
 * and still read as a question.
 *
 * WHY THE CONFIRMATION IS NOT `Dialog`. A removal confirmation lists every memory in the selection
 * — the user is authorising each one, and a list they cannot see is a list they cannot check. An
 * overlay would put that list over the very rows it names, and dismissing it to go and look would
 * throw the selection away. So it is an inline `alertdialog`: the page still scrolls, the selection
 * is still on it, and Escape is not the only way out.
 */

/**
 * An inline question, or a report of what happened when it was answered.
 *
 * @param tone     'warn' when the outcome was not what was asked for. NEVER a red fill — the tone
 *                 tints the frame, and the words carry the meaning.
 * @param actions  the controls, at the end. One filled button among them, never two.
 * @param footer   the quieter way out: a link to a different activity, not a third button.
 */
export function Prompt({ title, tone = 'neutral', role = 'group', label = null, actions = null, footer = null, children, ...rest }) {
	return (
		<section
			className={cx('prompt', tone !== 'neutral' && `prompt-${tone}`)}
			role={role}
			aria-label={label ?? undefined}
			{...rest}
		>
			<h2 className="prompt-title">{title}</h2>
			{children}
			{actions ? <div className="prompt-actions">{actions}</div> : null}
			{footer ? <div className="prompt-footer">{footer}</div> : null}
		</section>
	);
}

/** The load-bearing sentence in a prompt. One per prompt: a second one is not emphasis, it is two. */
export function PromptSentence({ tone = 'neutral', children }) {
	return <p className={cx('prompt-sentence', tone !== 'neutral' && `prompt-sentence-${tone}`)}>{children}</p>;
}

/** A quieter paragraph beside the sentence: a consequence, a property of the design, a next step. */
export function PromptNote({ children }) {
	return <p className="prompt-note">{children}</p>;
}

/**
 * Everything the answer is about, listed in full.
 *
 * IT SCROLLS RATHER THAN TRUNCATES. "and 9 more" is the one thing a confirmation may not say: the
 * count is not what is being authorised, the memories are.
 */
export function PromptList({ children }) {
	return <ul className="prompt-list">{children}</ul>;
}

/* ---------------------------------------------------------------------------- the run report */

/**
 * One row per thing the run touched, in the order it was attempted.
 *
 * A RUN OF TWELVE IS TWELVE CALLS, so it can stop partway, and a partial run is a normal outcome
 * rather than an error. That makes the per-item state the report — not a headline over it — and it
 * is why this is a list of outcomes and not a success message with an exception count.
 */
export function Outcomes({ children }) {
	return <ul className="outcomes">{children}</ul>;
}

/**
 * @param title  what the row is about, in the user's terms.
 * @param state  what happened to it, as a sentence. Never an icon: "not attempted", "the version
 *               moved" and "removed" are three different things and a tick cannot say which.
 * @param tone   'good' for the one state that is the thing the user asked for.
 */
export function Outcome({ title, state, tone = 'neutral', children = null }) {
	return (
		<li className={cx('outcome', tone !== 'neutral' && `outcome-${tone}`)}>
			<div className="outcome-head">
				<span className="outcome-title">{title}</span>
				<span className="outcome-state">{state}</span>
			</div>
			{children ? <div className="outcome-detail">{children}</div> : null}
		</li>
	);
}

/* --------------------------------------------------------------------------- text, shown as-is */

/**
 * Text the app is SHOWING rather than saying: a command to copy, a record as it arrived.
 *
 * Selectable, wrapped rather than clipped, and never inside an input. A command in a text field
 * looks like something the app is about to run, and the one on the escalation screen is exactly
 * the command this app will not run for anybody.
 */
export function Verbatim({ scroll = false, children }) {
	return <pre className={cx('verbatim', scroll && 'verbatim-scroll')}>{children}</pre>;
}
