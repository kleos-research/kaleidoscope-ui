import { useState } from 'react';

import { ESCALATION, REMOVE_LABEL, vaultDeleteCommand } from './removal-model.mjs';
import { Identifier } from './ui.jsx';

/**
 * "What removal cannot do" — its own screen, and that is the design rather than a layout choice.
 *
 * It is reached from a link in the removal confirmation and from a memory's overflow menu. It is
 * NOT a checkbox on the removal dialog, because a checkbox would say the product has a stronger
 * removal to offer if you tick it. It does not. This is a different activity with a different
 * outcome, and the outcome is mostly "rotate the credential".
 *
 * Four things about what is on it:
 *
 * **Rotation is named first**, before either removal option, because it is the only step that
 * changes the attacker's position. Everything else changes where bytes sit.
 *
 * **The command is printed and never run.** It is rendered with the vault root this session already
 * resolved, so the user copies something correct rather than assembling it — and assembling it
 * wrong is how somebody ends the wrong vault. Running it on a button press inside a curation tool
 * is a blast radius no confirmation dialog earns; typing it into one's own shell is a real consent
 * step.
 *
 * **A removal started here keeps no copy**, and the screen says so in place rather than behaving
 * differently in silence. Everywhere else a copy is written before a change; here that copy would
 * be a fresh plaintext copy of exactly the thing being removed, in a folder the command below will
 * never reach.
 *
 * **There is no third option**, said out loud. A user who has read a page about a leaked credential
 * and been given two options will hunt for a third; telling them there isn't one is faster and more
 * honest than letting them search.
 *
 * All the sentences come from `removal-model.mjs`, where a test walks them. None of them is written
 * in this file.
 */
export function RemovalLimits({ session, memory = null, busy = false, onRemove, onCancel }) {
	const [copied, setCopied] = useState(false);

	const root = session?.vault?.root ?? null;
	const command = vaultDeleteCommand(root);
	const snapshotDirectory = session?.snapshots?.directory ?? null;

	const copy = async () => {
		if (!command) return;
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
		} catch {
			// A clipboard a browser will not hand over is not a failure worth a dialog: the command
			// is on screen, in monospace, and selectable. The button simply says nothing happened.
			setCopied(false);
		}
	};

	return (
		<article className="removal-limits">
			<nav className="detail-nav">
				<button type="button" className="link-button" onClick={onCancel}>
					‹ Back
				</button>
			</nav>

			<h1>{ESCALATION.title}</h1>

			{memory ? (
				<p className="removal-limits-subject">
					About <strong>{memory.title ?? 'this memory'}</strong>{' '}
					<Identifier value={memory.memory_id} label="memory id" />
				</p>
			) : null}

			<p className="removal-limits-lead">{ESCALATION.opening}</p>

			{/*
			  FIRST, and styled as the answer rather than as an aside. Every other paragraph on this
			  screen moves bytes around; this one is the only advice that changes anything.
			*/}
			<p className="removal-limits-rotate">{ESCALATION.rotate}</p>

			<section className="removal-limits-command">
				<p>{ESCALATION.vault_destruction_lead}</p>
				{command ? (
					<>
						{/*
						  The resolved root, not a placeholder. `<pre>` rather than an input, because
						  nothing on this screen should look like something the app is about to run.
						*/}
						<pre className="verbatim removal-command">{command}</pre>
						<div className="removal-actions">
							<button type="button" className="button" onClick={copy}>
								{copied ? 'Copied' : 'Copy the command'}
							</button>
						</div>
					</>
				) : (
					<p className="warning">
						This app has not resolved a vault path this session, so it will not print a command
						with a hole in it. The readings in the footer say what it did resolve.
					</p>
				)}
				<p>{ESCALATION.vault_destruction_after}</p>
			</section>

			<section className="removal-limits-steps">
				<p>{ESCALATION.steps_lead}</p>
				<ol>
					{ESCALATION.steps.map((step) => (
						<li key={step}>{step}</li>
					))}
				</ol>
				<p className="neutral">
					{ESCALATION.steps_note}
					{snapshotDirectory ? (
						<>
							{' '}
							<code className="identifier">{snapshotDirectory}</code>
						</>
					) : null}
				</p>
			</section>

			{/* The behavioural difference, stated where it applies rather than left to be noticed. */}
			<p className="removal-limits-nocopy">{ESCALATION.no_snapshot_here}</p>

			<p className="removal-limits-elsewhere">{ESCALATION.elsewhere}</p>

			<p className="neutral">{ESCALATION.exposure_rows}</p>

			<p className="removal-limits-nothird">{ESCALATION.no_third_option}</p>

			<div className="removal-actions removal-actions-final">
				<button type="button" className="button" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
				{/*
				  The same label as everywhere else, and the same action — with one difference the
				  paragraph above already named: this run keeps no local copy. It is offered here
				  because a user who has read this page and decided to remove the memory anyway should
				  not have to go back to find the button.
				*/}
				{memory && onRemove ? (
					<button
						type="button"
						className="button"
						onClick={() => onRemove(memory)}
						disabled={busy}
					>
						{busy ? 'Removing…' : REMOVE_LABEL}
					</button>
				) : null}
			</div>
		</article>
	);
}
