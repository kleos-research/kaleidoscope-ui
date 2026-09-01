import { applyUndo } from './hub-model.mjs';
import { Button } from './ui/index.mjs';

/**
 * What the regime detector read, and what every reduction on this screen has taken away.
 *
 * Two components, and the split is the design: the first says what KIND of graph this is before
 * anything is drawn, and the second is the receipt for every element that is not on screen.
 *
 * **The receipt is not optional and it is not a tooltip.** A view that quietly narrows is the
 * failure the whole hub programme exists to prevent: from the reader's side a sparse vault and a
 * cropped view look identical, and there is nothing on a canvas that would make them suspect the
 * difference. So every reduction states what it hid, how much of it, and the control that brings it
 * back — and the control that brings it back states its own consequence first, because "show me
 * everything" on a hub is two hundred thousand elements and offering it without the number is how a
 * canvas blacks out on a click.
 */

/**
 * The regime, its threshold, and where the threshold came from.
 *
 * **IT OFFERS; IT NEVER APPLIES.** Nothing here reduces anything — every control calls back out and
 * the screen decides. A graph past the threshold that is still legible is offered a collapse and
 * drawn whole until somebody presses one of these, because a view that narrows without asking is
 * the failure this whole programme exists to prevent, arrived at from the other side.
 *
 * It renders nothing at all in the `working` regime. That is deliberate and it is also why the
 * screen carries `regimeLine` in its caption: a panel that appeared only to say "nothing qualifies"
 * would be a resident paragraph of caveat, and the reading still has to be legible when the answer
 * is nothing.
 */
export function HubRegime({ regime, onCollapse, onAbsorb, collapsed, absorbed }) {
	if (!regime || regime.regime === 'working') return null;
	const hub = regime.hubs[0] ?? null;

	return (
		<section className={`hub-regime hub-regime-${regime.regime}`}>
			<h3>
				{regime.regime === 'hub'
					? 'One name here is connected to nearly everything'
					: 'This vault is bigger than this view draws'}
			</h3>
			<p>{regime.reason}</p>

			{/* The threshold is on screen with its arithmetic, because a number a reader cannot
			    reconstruct is a magic number whether or not it was computed. */}
			<p className="hub-note">
				The bar for “too connected to draw” is{' '}
				<strong>max(20, the 99th-percentile name × 4)</strong>, which in this vault is{' '}
				<strong>{regime.threshold.toLocaleString()}</strong> — computed from what you have written,
				not set in this app. On a vault where nothing is an outlier it never fires, and that is the
				correct answer rather than a missing feature.{' '}
				{regime.stats.count.toLocaleString()} names; the median is named by {regime.stats.p50}, the
				99th percentile by {regime.stats.p99}, and the busiest by {regime.stats.max.toLocaleString()}.
			</p>

			{hub ? (
				<div className="hub-regime-actions">
					<Button disabled={collapsed} onClick={() => onCollapse(hub)}>
						{collapsed ? '“' + hub.surface + '” is collapsed' : `Collapse “${hub.surface}”`}
						<span className="hub-consequence">
							{hub.leafNeighbours.toLocaleString()} names that appear in no other fact go in the box;{' '}
							{hub.connectorNeighbours.toLocaleString()} stay drawn
						</span>
					</Button>
					<Button disabled={absorbed} onClick={() => onAbsorb(hub)}>
						{absorbed ? '“' + hub.surface + '” is in the background' : 'Absorb it into the background'}
						<span className="hub-consequence">
							off the canvas, onto its neighbours as a badge each — reversible, and never keyed to
							the name
						</span>
					</Button>
				</div>
			) : null}
		</section>
	);
}

/**
 * One row per reduction: what it hid, exactly how much, and the way back.
 *
 * The counts here are not this component's arithmetic. They come from `planView`, which computes
 * them by removing the elements, and a test cross-checks them against the same view with nothing
 * reduced — two independent computations agreeing, rather than one number quoting itself.
 */
export function HubLedger({ plan, state, setState, onOpenList }) {
	if (!plan || plan.ledger.length === 0) return null;

	// The budget this plan actually ran under, carried on the plan itself. Reading a module default
	// here instead would let the receipt quote a cap the picture was never drawn against.
	const cap = plan.cap;

	const revealMore = (id, by) => {
		const expanded = new Map(state.expanded);
		expanded.set(id, Math.max(0, (expanded.get(id) ?? 0) + by));
		setState({ ...state, expanded });
	};

	return (
		<section className="hub-ledger">
			<h3>
				What is not on the canvas
				<span className="hub-count">
					{plan.hidden.nodes.toLocaleString()} names · {plan.hidden.edges.toLocaleString()} links
				</span>
			</h3>
			<p className="hub-note">
				This picture draws {plan.elementCount.toLocaleString()} of the{' '}
				{plan.unreduced.elementCount.toLocaleString()} elements this vault holds. Everything missing
				is listed here with the way to bring it back. Nothing on this screen narrows without saying
				so.
			</p>

			<ul className="hub-ledger-rows">
				{plan.ledger.map((entry) => {
					const meta = plan.metaNodes.find((node) => node.childId === entry.id);
					return (
						<li key={`${entry.kind}:${entry.id}`}>
							<p className="hub-ledger-sentence">{entry.sentence}</p>

							<div className="hub-ledger-actions">
								{/* THE LIST. A hundred thousand items is a list and a drawing is not, so the
								    honest encoding is one click away from the box that holds them. */}
								{entry.list ? (
									<Button onClick={() => onOpenList(entry)}>{entry.list.label}</Button>
								) : null}

								{entry.kind === 'collapsed' ? (
									<>
										<Button disabled={entry.hiddenNodes === 0} onClick={() => revealMore(entry.id, 50)}>
											Draw 50 more of them
											{meta ? (
												<span className="hub-consequence">
													showing {meta.shownChildren.toLocaleString()} of{' '}
													{(meta.shownChildren + meta.hiddenNodes).toLocaleString()}, busiest first
												</span>
											) : null}
										</Button>
										{entry.capReached ? (
											<span className="hub-ledger-capped">
												The box stopped adding at {cap.toLocaleString()} elements. It is not done —
												the rest are in the list.
											</span>
										) : null}
									</>
								) : null}

								{/* THE UNDO, with its consequence stated before it is taken. */}
								<Button tone="quiet" onClick={() => setState(applyUndo(state, entry))}>
									{entry.undo.label}
									{entry.undo.elementsAfter ? (
										<span className="hub-consequence">
											{entry.undo.elementsAfter.toLocaleString()} elements
											{entry.undo.elementsAfter > cap
												? ` — past the ${cap.toLocaleString()} this picture draws, so it will ask again`
												: ''}
										</span>
									) : null}
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
