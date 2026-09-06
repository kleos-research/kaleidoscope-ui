import { useCallback, useEffect, useRef, useState } from 'react';

import { recheckEngine } from './api.mjs';
import { Button, DetailRow, DetailRows, Icon, InlineBusy, Input } from './ui/index.mjs';

/**
 * THE FIRST-RUN SCREEN: the app, running, with no engine behind it.
 *
 * It exists because the CHANNEL was wrong, not because the words were. A missing engine used to be
 * a terminal refusal — the copy was already good, and it is reused here rather than rewritten — but
 * a terminal cannot show a copy button and cannot re-check without being typed again. Someone who
 * ran `npx` is walking to a browser, so the browser is where the remedy has to be.
 *
 * ONE STORY: Kaleidoscope needs the engine, here is the command, here is where to say it already
 * exists, and here is the button that looks again. Everything that is evidence rather than message
 * — the whole search trail — is one closed row carrying its own count.
 *
 * IT RE-CHECKS IN PLACE. `Check again` is not a reload: a reload would lose the launch token, which
 * this page read once from the fragment and erased, and the person would be sent back to the
 * terminal they have already left. The server re-runs the search in the process that is already
 * bound, and `onReady` walks straight into the app on the same socket with the same credential.
 */
export function FirstRun({ status, onReady }) {
	const [engine, setEngine] = useState(status);
	const [path, setPath] = useState(status?.named?.path ?? '');
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState(null);

	// The engine arrived. Announced from an effect rather than from inside the click handler so
	// that the transition happens once, on a rendered state, whichever control caused it.
	useEffect(() => {
		if (engine?.present && (engine.launch_blockers ?? []).length === 0) onReady();
	}, [engine, onReady]);

	const check = useCallback(
		async (namedPath) => {
			setBusy(true);
			setFailure(null);
			try {
				setEngine(await recheckEngine({ engine_path: namedPath ?? '' }));
			} catch (error) {
				// The re-check itself did not complete. That is this app failing, not the search
				// coming back empty — the second arrives as an ordinary answer — so it is reported
				// as a separate sentence rather than folded into "still not found".
				setFailure(error);
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	// The engine is there and this machine still cannot use it: a shut licence gate, or a build
	// with no embedding model. The engine's own text says which and what to run, so it is printed
	// whole. This is the one branch that has found something and still cannot go on.
	const blockers = engine?.present ? (engine.launch_blockers ?? []) : [];

	// `named-unusable` and `readings-failed` both already carry a complete written explanation, and
	// for the first of them the explanation is the POINT: a named path is authoritative, so the
	// search stopped there rather than running some other program. Printing it verbatim and adding
	// nothing is the whole handling of that case.
	const verbatim =
		blockers.length > 0
			? blockers.map((blocker) => blocker.message).join('\n\n')
			: engine?.kind === 'named-unusable' || engine?.kind === 'readings-failed'
				? engine.message
				: null;

	const title =
		blockers.length > 0
			? 'The engine is here, and this machine cannot use it yet.'
			: engine?.kind === 'named-unusable'
				? 'Kaleidoscope stopped at the path you named.'
				: engine?.kind === 'readings-failed'
					? 'Kaleidoscope found the engine and could not take its readings.'
					: "Kaleidoscope needs the memory engine, and it isn't here yet.";

	const looked = engine?.looked ?? [];

	return (
		<main className="firstrun">
			<section className="firstrun-panel">
				<p className="firstrun-eyebrow">Setting up</p>
				<h1 className="firstrun-title">{title}</h1>

				{verbatim ? (
					<pre className="firstrun-verbatim">{verbatim}</pre>
				) : (
					<p className="firstrun-lede">
						This app is the browser half of Kaleidoscope. The half that reads and writes your
						vault is a separate program called <span className="identifier">{engine?.program}</span>
						, and it is not on this machine anywhere this search reached.
					</p>
				)}

				{engine?.install_command ? (
					<div className="firstrun-step">
						<h2 className="firstrun-step-title">
							{engine.kind === 'nothing-found' ? 'Install it' : 'Not installed at all?'}
						</h2>
						<CopyLine text={engine.install_command} />
					</div>
				) : null}

				<div className="firstrun-do">
					<Button tone="primary" onClick={() => check('')} disabled={busy}>
						Check again
					</Button>
					{busy ? <InlineBusy>Looking…</InlineBusy> : null}
					{!busy && engine && !engine.present && engine.rechecked ? (
						<span className="firstrun-still">Still not there.</span>
					) : null}
				</div>

				<div className="firstrun-step">
					<h2 className="firstrun-step-title">
						{engine?.kind === 'named-unusable'
							? 'Name a different path'
							: 'Already installed somewhere else?'}
					</h2>
					<form
						className="firstrun-path"
						onSubmit={(event) => {
							event.preventDefault();
							if (path.trim()) check(path.trim());
						}}
					>
						<Input
							value={path}
							onChange={(event) => setPath(event.target.value)}
							placeholder={`the full path to ${engine?.program ?? 'the engine'}`}
							aria-label="The full path to the engine program"
							spellCheck={false}
							className="firstrun-input"
						/>
						<Button type="submit" disabled={busy || !path.trim()}>
							Use this path
						</Button>
					</form>
					{/*
					  THE OTHER TWO WAYS, STATED ONCE. They are the same door as the field above and
					  they outlive this tab, which is the reason to name them at all: the field sets
					  the engine for this run, and a person who will open the app again wants the
					  one that sticks.
					*/}
					<p className="firstrun-note">
						The field sets the engine for this run only. To fix it for every run, set{' '}
						<span className="identifier">{engine?.environment_variable}</span> to that same
						path, or start the app with{' '}
						<span className="identifier">{engine?.flag} &lt;path&gt;</span>.
					</p>
				</div>

				{/*
				  THE EVIDENCE, CLOSED. A person told only "not found" cannot tell a search that
				  never reached PATH from one that read it and came back empty, and those two have
				  opposite remedies — so the trail has to be here. It is not the message, though, and
				  a screen that opens with fourteen directories on it has buried the one command that
				  fixes the machine.

				  Rendered only when there IS a trail. A row reading "Where we looked · 0" would be a
				  claim about a search, and the case with no trail is the case where no search ran.
				*/}
				{looked.length > 0 ? (
					<DetailRows className="firstrun-trail">
						<DetailRow label="Where we looked" count={looked.length}>
							<ul className="firstrun-places">
								{looked.map((place, index) => (
									<li key={`${place.where}-${index}`} className="firstrun-place">
										<span className="identifier">{place.where}</span>
										{place.reason ? (
											<span className="firstrun-reason">{place.reason}</span>
										) : null}
									</li>
								))}
							</ul>
						</DetailRow>
					</DetailRows>
				) : null}

				{failure ? (
					<p className="firstrun-failure" role="alert">
						{failure.message}
					</p>
				) : null}

				<p className="firstrun-quiet">
					Nothing has been read, written or changed. This app only reads and edits a vault that
					already exists; it never creates one.
				</p>
			</section>
		</main>
	);
}

/**
 * A command, in mono, with a copy control beside it.
 *
 * The control that a terminal could not offer, which is a fair part of why this screen exists. The
 * clipboard write can be refused — an unfocused document, a browser that gates it — so the failure
 * selects the text instead of pretending the copy happened. A button that reports "Copied" on a
 * clipboard that is still empty is worse than one that does nothing.
 */
function CopyLine({ text }) {
	const [copied, setCopied] = useState(false);
	const holder = useRef(null);

	useEffect(() => {
		if (!copied) return undefined;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			const node = holder.current;
			if (!node) return;
			const range = document.createRange();
			range.selectNodeContents(node);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
	};

	return (
		<div className="firstrun-command">
			<code className="identifier firstrun-command-text" ref={holder}>
				{text}
			</code>
			<Button size="sm" onClick={copy} aria-label={`Copy: ${text}`}>
				{copied ? <Icon.Check size={12} className="icon" /> : null}
				{copied ? 'Copied' : 'Copy'}
			</Button>
		</div>
	);
}
