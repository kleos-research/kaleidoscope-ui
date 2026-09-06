import { useState } from 'react';

import { bulkBarLabel, ESCALATION, REMOVE_LABEL, vaultDeleteCommand } from './removal-model.mjs';
import { Button, DetailRow, DetailRows, Note, Page, PageHead, PageSection, Verbatim } from './ui/index.mjs';

/**
 * "What removal cannot do" — its own screen, and that is the design rather than a layout choice.
 *
 * It is reached from a link in the removal confirmation and from a memory's overflow menu. It is
 * NOT a checkbox on the removal dialog, because a checkbox would say the product has a stronger
 * removal to offer if you tick it. It does not. This is a different activity with a different
 * outcome, and the outcome is mostly "rotate the credential".
 *
 * THE REDESIGN CHANGED THE PAINT AND NOT ONE WORD. Every sentence still comes from
 * `removal-model.mjs`, in the same order, and a test walks them for the vocabulary this product may
 * not use. Four things about what is on it:
 *
 * **Rotation is named first**, before either removal option, because it is the only step that
 * changes the attacker's position. Everything else changes where bytes sit. It is the one tinted
 * block on the screen, so a reader who reads nothing else reads that.
 *
 * **The command is printed and never run.** It is rendered with the vault root this session already
 * resolved, so the user copies something correct rather than assembling it — and assembling it
 * wrong is how somebody ends the wrong vault. It is set in `Verbatim` rather than in an input for
 * the same reason: a command in a text field looks like something the app is about to run, and this
 * is exactly the command this app will not run for anybody.
 *
 * **A removal started here keeps no copy**, and the screen says so in place rather than behaving
 * differently in silence. Everywhere else a copy is written before a change; here that copy would
 * be a fresh plaintext copy of exactly the thing being removed, in a folder the command below will
 * never reach.
 *
 * **There is no third option**, said out loud. A user who has read a page about a leaked credential
 * and been given two options will hunt for a third; telling them there isn't one is faster and more
 * honest than letting them search.
 */
export function RemovalLimits({ session, memories = [], busy = false, onRemove, onCancel }) {
	const [copied, setCopied] = useState(false);

	const root = session?.vault?.root ?? null;
	const command = vaultDeleteCommand(root);
	const listed = Array.isArray(memories) ? memories : [];

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
		/*
		  THE READING COLUMN'S MEASURE, and the decision in the head. This screen was 381 words in
		  twelve blocks at 130 characters a line, with Cancel and Remove 250px under the sentence that
		  makes that Remove different — below the fold on the engine the owner has installed. The
		  buttons now sit where the merge chooser and the editor keep theirs, beside the title, and
		  the one sentence about them is beside the buttons rather than three notes above.
		*/
		<Page narrow column="read">
			<PageHead
				title={ESCALATION.title}
				subtitle={
					listed.length === 1 ? (
						<>
							About <strong>{listed[0].title ?? 'this memory'}</strong>
						</>
					) : listed.length > 1 ? (
						<>
							About <strong>{listed.length} memories</strong>:{' '}
							{listed.map((memory) => memory.title ?? memory.memory_id).join(' · ')}
						</>
					) : null
				}
				actions={
					<div className="head-actions-stack">
						<div className="head-actions">
							<Button onClick={onCancel} disabled={busy}>
								Cancel
							</Button>
							{/*
							  The same label as everywhere else, and the same action — with one difference
							  the note under it names: this run keeps no local copy. It is offered here
							  because a user who has read this page and decided to remove the memory anyway
							  should not have to go back to find the button. A bulk selection is handed
							  through whole, so the no-copy path is open to it too.
							*/}
							{listed.length > 0 && onRemove ? (
								<Button tone="warn" onClick={() => onRemove(listed)} disabled={busy}>
									{busy ? 'Removing…' : listed.length > 1 ? bulkBarLabel(listed.length) : REMOVE_LABEL}
								</Button>
							) : null}
						</div>
						{listed.length > 0 && onRemove ? (
							<p className="head-actions-note">{ESCALATION.no_snapshot_here}</p>
						) : null}
					</div>
				}
			/>

			<PageSection>
				<p className="copy">{ESCALATION.opening}</p>
				{/*
				  FIRST, and the one tinted block on the screen. Every other paragraph here moves bytes
				  around; this is the only advice that changes anything.
				*/}
				<Note tone="warn">
					<strong>{ESCALATION.rotate}</strong>
				</Note>
			</PageSection>

			<PageSection>
				<p className="copy">{ESCALATION.vault_destruction_lead}</p>
				{command ? (
					<>
						{/* The resolved root, not a placeholder with a hole in it. */}
						<Verbatim>{command}</Verbatim>
						<div>
							<Button onClick={copy}>{copied ? 'Copied' : 'Copy the command'}</Button>
						</div>
					</>
				) : (
					<Note>
						This app has not resolved a vault path this session, so it will not print a command
						with a hole in it. The vault readings in the top bar say what it did resolve.
					</Note>
				)}
				<p className="copy">{ESCALATION.vault_destruction_after}</p>
			</PageSection>

			<PageSection>
				<p className="copy">{ESCALATION.steps_lead}</p>
				<ol className="steps">
					{ESCALATION.steps.map((step) => (
						<li key={step}>{step}</li>
					))}
				</ol>
				<p className="copy">{ESCALATION.elsewhere}</p>
				<p className="copy">{ESCALATION.no_third_option}</p>
			</PageSection>

			{/*
			  WHAT THIS APP KEEPS, AND WHAT NOTHING REACHES — closed, because both are true of every
			  removal and neither changes what a reader does next. The copies' folder is named in the
			  terminal at launch and in the vault readings; an absolute path across this page was the
			  owner's first complaint about the last design, drawn again.
			*/}
			<DetailRows>
				<DetailRow label="What this app keeps, and what nothing reaches">
					<p className="copy">{ESCALATION.steps_note}</p>
					<p className="copy">{ESCALATION.exposure_rows}</p>
				</DetailRow>
			</DetailRows>
		</Page>
	);
}
