import { confirmation, ESCALATION_TITLE, summariseRun } from './removal-model.mjs';
import {
	Button,
	Identifier,
	NotRecorded,
	Outcome,
	Outcomes,
	Prompt,
	PromptList,
	PromptNote,
	PromptSentence,
} from './ui/index.mjs';

/**
 * The two halves of a removal a person actually looks at: the confirmation before, and the report
 * after.
 *
 * NOT ONE WORD OF THIS FLOW WAS REWRITTEN FOR THE REDESIGN. The sentences are the deliverable here
 * — they are the only thing standing between a user and a false belief about their own data — so
 * the redesign changed the paint and nothing else. Every string still comes from
 * `removal-model.mjs`, where a test walks the whole copy inventory looking for a word this product
 * may not say; a sentence written in a component is checked by looking at a screen rather than by
 * anything that runs on a commit.
 *
 * The shape is the same for one memory and for many, because the server has one path for both.
 * What differs is what the screen calls it: one row is a receipt, several are a run report.
 */

/**
 * The confirmation.
 *
 * AN INLINE `alertdialog`, NOT AN OVERLAY, and that is a design decision rather than a shortcut:
 * this app never covers what the user was reading with a modal. A confirmation the page can scroll
 * is a confirmation the user can check against the thing they selected.
 *
 * THE LIST IS COMPLETE. For a bulk run it shows every title in the selection rather than the first
 * three and a count — the user is authorising each of these, and a list they cannot see is a list
 * they cannot check. The container scrolls; nothing truncates.
 *
 * The frame is warn-tinted and the fill is not, and the button is `warn` rather than red. A red
 * button says "gone", which is the one thing this action does not mean.
 */
export function RemovalConfirm({
	selection,
	busy = false,
	onCancel,
	onConfirm,
	onEscalate,
	/*
	  OVER THE MEMORY IT IS ABOUT, the list of one is the title already drawn 130px below it. The
	  question keeps every word and drops the repetition; over the list, where the memory is a row
	  among hundreds, the title stays in the prompt.
	*/
	compact = false,
}) {
	const copy = confirmation(selection);
	const listed = compact && selection.length === 1 ? [] : copy.titles;

	return (
		<Prompt
			title={copy.heading}
			tone="warn"
			role="alertdialog"
			label={copy.heading}
			actions={
				<>
					<Button onClick={onCancel} disabled={busy}>
						{copy.cancel}
					</Button>
					<Button tone="warn" onClick={onConfirm} disabled={busy}>
						{busy ? 'Removing…' : copy.confirm}
					</Button>
				</>
			}
			footer={
				/*
				  The way in to the escalation, and it is a LINK to a screen rather than a checkbox
				  here. A checkbox would say the product has a stronger removal to offer if you tick
				  it. It does not: that screen is a different activity with a different outcome.
				*/
				onEscalate ? (
					<>
						{copy.escalation_prompt}{' '}
						<Button tone="quiet" size="sm" onClick={onEscalate}>
							{copy.escalation_link}
						</Button>
					</>
				) : null
			}
		>
			{listed.length > 0 ? (
				<PromptList>
					{listed.map((title, index) => (
						<li key={selection[index]?.memory_id ?? index}>
							{title ?? <NotRecorded what="title" />}
						</li>
					))}
				</PromptList>
			) : null}

			{/*
			  THE LOAD-BEARING SENTENCE, in the body, never truncated, never behind a disclosure,
			  never in a tooltip. It states the benefit first so it does not read as a warning to be
			  dismissed, it names a mechanism the user can check, and it attributes the absence to the
			  engine rather than to this app.
			*/}
			<PromptSentence>{copy.sentence}</PromptSentence>

			{copy.notes.map((note) => (
				<PromptNote key={note}>{note}</PromptNote>
			))}
		</Prompt>
	);
}

/**
 * The report, which is the deliverable of a run rather than a toast.
 *
 * One row per memory the user selected, in the order attempted, each in one of the states the model
 * knows — including the ones the run never reached. A partial run is a normal outcome of a design
 * with no batch delete in it, and this screen treats it as one: the headline and the tone both come
 * from `summariseRun`, which reports `good` only when every selected memory was removed. There is
 * no path through this component that renders "Removed 12 memories" over a run where four were
 * refused.
 *
 * It keeps the titles it removed. After a successful removal the listing door no longer returns
 * them, so this report is the only place the app can still name what it just did.
 */
export function RemovalReport({ report, onBack, onOpen, onEscalate }) {
	const run = summariseRun(report);

	return (
		<Prompt
			title={run.headline}
			tone={run.tone === 'good' ? 'good' : 'warn'}
			label={run.headline}
			aria-live="polite"
			actions={
				<>
					<Button tone="primary" onClick={onBack}>
						Back to the list
					</Button>
					{onEscalate ? (
						<Button tone="quiet" onClick={onEscalate}>
							{ESCALATION_TITLE}
						</Button>
					) : null}
				</>
			}
			footer={
				run.partial ? (
					<>
						Each removal is its own call, so a run stops at the first refusal rather than
						pushing past it. The rows above are every memory you selected and what happened to
						each.
					</>
				) : null
			}
		>
			{/*
			  The honest half of the claim, repeated where the good news is. This is the one place a
			  product like this normally says something false, so it is the one place the sentence has
			  to appear twice.
			*/}
			{run.receipt ? <PromptSentence>{run.receipt}</PromptSentence> : null}

			<Outcomes>
				{run.items.map((item, index) => (
					<Outcome
						key={item.memory_id ?? index}
						title={item.title ?? <NotRecorded what="title" />}
						state={item.label}
						tone={item.removed ? 'good' : 'neutral'}
					>
						{/*
						  The id, in monospace and selectable, on the rows that were removed. It is the
						  only handle that still reaches the record — the listing door no longer returns
						  it and the export door omits it — so a receipt without it leaves the user
						  holding nothing.
						*/}
						{item.removed ? (
							<Identifier value={item.memory_id} label="memory id" />
						) : onOpen && item.memory_id ? (
							<Button tone="quiet" size="sm" onClick={() => onOpen(item.memory_id)}>
								Open it
							</Button>
						) : null}

						{/* The engine's own sentence, beside the state rather than instead of it. */}
						{item.said ? <span>{item.said}</span> : null}
						{item.next ? <span>{item.next}</span> : null}
					</Outcome>
				))}
			</Outcomes>
		</Prompt>
	);
}
