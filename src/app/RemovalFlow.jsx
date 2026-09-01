import { confirmation, ESCALATION_TITLE, summariseRun } from './removal-model.mjs';
import { Identifier, NotRecorded } from './ui.jsx';

/**
 * The two halves of a removal that a person actually looks at: the confirmation before, and the
 * report after.
 *
 * Neither one writes a sentence of its own. Every string here comes from `removal-model.mjs`, where
 * a test walks the whole copy inventory looking for a word this product may not say — because the
 * sentences are the deliverable in this flow, and a sentence in a component is checked by looking
 * at a screen rather than by anything that runs on a commit.
 *
 * The shape is the same for one memory and for many, because the server has one path for both. What
 * differs is what the screen calls it: one row is a receipt, several are a run report.
 */

/**
 * The confirmation.
 *
 * An inline `alertdialog` rather than an overlay, matching the editor's conflict panel: this app
 * never covers what the user was reading with a modal, and a confirmation the page can scroll is a
 * confirmation the user can check against the thing they selected.
 *
 * THE LIST IS COMPLETE. For a bulk run it shows every title in the selection rather than the first
 * three and a count — the user is authorising each of these, and a list they cannot see is a list
 * they cannot check. The container scrolls; nothing truncates.
 */
export function RemovalConfirm({ selection, busy = false, onCancel, onConfirm, onEscalate }) {
	const copy = confirmation(selection);

	return (
		<div className="removal-confirm" role="alertdialog" aria-label={copy.heading}>
			<h2>{copy.heading}</h2>

			<ul className="removal-selection">
				{copy.titles.map((title, index) => (
					<li key={selection[index]?.memory_id ?? index}>
						{title ?? <NotRecorded what="title" />}
					</li>
				))}
			</ul>

			{/*
			  THE LOAD-BEARING SENTENCE, in the dialog body, never truncated, never behind a
			  disclosure, never in a tooltip. It states the benefit first so it does not read as a
			  warning to be dismissed, it names a mechanism the user can check, and it attributes the
			  absence to the engine rather than to this app.
			*/}
			<p className="removal-sentence">{copy.sentence}</p>

			{copy.notes.map((note) => (
				<p key={note} className="removal-note">
					{note}
				</p>
			))}

			<div className="removal-actions">
				<button type="button" className="button" onClick={onCancel} disabled={busy}>
					{copy.cancel}
				</button>
				<button type="button" className="button" onClick={onConfirm} disabled={busy}>
					{busy ? 'Removing…' : copy.confirm}
				</button>
			</div>

			{/*
			  The way in to the escalation, and it is a LINK to a screen rather than a checkbox here.
			  A checkbox would imply the product has a stronger removal to offer if you tick it. It
			  does not: that screen is a different activity with a different outcome.
			*/}
			{onEscalate ? (
				<p className="removal-escalate">
					{copy.escalation_prompt}{' '}
					<button type="button" className="link-button inline" onClick={onEscalate}>
						{copy.escalation_title}
					</button>
				</p>
			) : null}
		</div>
	);
}

/**
 * The report, which is the deliverable of a run rather than a toast.
 *
 * One row per memory the user selected, in the order attempted, each in one of the states the model
 * knows — including the ones the run never reached. A partial run is a normal outcome of a design
 * with no batch delete in it, and this screen treats it as one: the headline and the styling both
 * come from `summariseRun`, which reports `good` only when every selected memory was removed. There
 * is no path through this component that renders "Removed 12 memories" over a run where four were
 * refused.
 *
 * It keeps the titles it removed. After a successful removal the listing door no longer returns
 * them, so this report is the only place the app can still name what it just did.
 */
export function RemovalReport({ report, onBack, onOpen, onEscalate }) {
	const run = summariseRun(report);

	return (
		<section className={`removal-report is-${run.tone}`} aria-live="polite">
			<h2>{run.headline}</h2>

			{/*
			  The honest half of the claim, repeated where the good news is. This is the one place a
			  product like this normally says something false, so it is the one place the sentence has
			  to appear twice.
			*/}
			{run.receipt ? <p className="removal-sentence">{run.receipt}</p> : null}

			<ul className="removal-rows">
				{run.items.map((item, index) => (
					<li key={item.memory_id ?? index} className={item.removed ? 'is-removed' : 'is-not'}>
						<span className="removal-row-title">
							{item.title ?? <NotRecorded what="title" />}
						</span>
						<span className="removal-row-state">{item.label}</span>

						{/*
						  The id, in monospace and selectable, on the rows that were removed. It is the
						  only handle that still reaches the record — the listing door no longer returns
						  it and the export door omits it — so a receipt without it leaves the user
						  holding nothing.
						*/}
						{item.removed ? (
							<Identifier value={item.memory_id} label="memory id" />
						) : (
							<span className="removal-row-open">
								{onOpen && item.memory_id ? (
									<button
										type="button"
										className="link-button inline"
										onClick={() => onOpen(item.memory_id)}
									>
										Open it
									</button>
								) : null}
							</span>
						)}

						{/* The engine's own sentence, beside the state rather than instead of it. */}
						{item.said ? <span className="removal-row-said">{item.said}</span> : null}
						{item.next ? <span className="removal-row-next">{item.next}</span> : null}
					</li>
				))}
			</ul>

			{run.partial ? (
				<p className="removal-note">
					Each removal is its own call, so a run stops at the first refusal rather than pushing
					past it. The rows above are every memory you selected and what happened to each.
				</p>
			) : null}

			<div className="removal-actions">
				<button type="button" className="button" onClick={onBack}>
					Back to the list
				</button>
				{onEscalate ? (
					<button type="button" className="link-button" onClick={onEscalate}>
						{ESCALATION_TITLE}
					</button>
				) : null}
			</div>
		</section>
	);
}
