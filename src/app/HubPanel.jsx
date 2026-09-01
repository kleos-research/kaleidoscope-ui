import { DRAW_CAP } from './graph-model.mjs';
import { applyUndo } from './hub-model.mjs';

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

/** The regime, its threshold, and where the threshold came from. */
export function HubRegime({ regime, lens, onCollapse, onAbsorb, collapsed, absorbed }) {
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
			<p className="graph-note">
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
					<button
						type="button"
						className="button"
						disabled={collapsed}
						onClick={() => onCollapse(hub)}
					>
						{collapsed ? '“' + hub.surface + '” is collapsed' : `Collapse “${hub.surface}”`}
						<span className="graph-reduction-count">
							{hub.leafNeighbours.toLocaleString()} names that appear in no other fact go in the box;{' '}
							{hub.connectorNeighbours.toLocaleString()} stay drawn
						</span>
					</button>
					<button type="button" className="button" disabled={absorbed} onClick={() => onAbsorb(hub)}>
						{absorbed ? '“' + hub.surface + '” is in the background' : 'Absorb it into the background'}
						<span className="graph-reduction-count">
							off the canvas, onto its neighbours as a badge each — reversible, and never keyed to
							the name
						</span>
					</button>
				</div>
			) : null}

			{regime.regime === 'hub' && lens === 'C' ? (
				<p className="graph-note">
					This reading is over the names and the facts, before a lens. In Connections the same name
					is joined to the memories that mention it rather than to the names it appears with, so the
					count on the box below is the one for this lens and the count above is the one for the
					vault.
				</p>
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
export function HubLedger({ plan, state, setState, onOpenList, lens }) {
	if (!plan || plan.ledger.length === 0) return null;

	const revealMore = (id, by) => {
		const expanded = new Map(state.expanded);
		expanded.set(id, Math.max(0, (expanded.get(id) ?? 0) + by));
		setState({ ...state, expanded });
	};

	return (
		<section className="hub-ledger">
			<h3>
				What is not on the canvas
				<span className="graph-tag-count">
					{plan.hidden.nodes.toLocaleString()} names · {plan.hidden.edges.toLocaleString()} links
				</span>
			</h3>
			<p className="graph-note">
				This view draws {plan.elementCount.toLocaleString()} of the{' '}
				{plan.unreduced.elementCount.toLocaleString()} elements this scope holds in the{' '}
				{lens} lens. Everything missing is listed here with the way to bring it back. Nothing on this
				screen narrows without saying so.
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
									<button type="button" className="button" onClick={() => onOpenList(entry)}>
										{entry.list.label}
									</button>
								) : null}

								{entry.kind === 'collapsed' ? (
									<>
										<button
											type="button"
											className="button"
											disabled={entry.hiddenNodes === 0}
											onClick={() => revealMore(entry.id, 50)}
										>
											Draw 50 more of them
											{meta ? (
												<span className="graph-reduction-count">
													showing {meta.shownChildren.toLocaleString()} of{' '}
													{(meta.shownChildren + meta.hiddenNodes).toLocaleString()}, busiest first
												</span>
											) : null}
										</button>
										{entry.capReached ? (
											<span className="hub-ledger-capped">
												The box stopped adding at {DRAW_CAP.toLocaleString()} elements. It is not
												done — the rest are in the list.
											</span>
										) : null}
									</>
								) : null}

								{/* THE UNDO, with its consequence stated before it is taken. */}
								<button
									type="button"
									className="button button-quiet"
									onClick={() => setState(applyUndo(state, entry))}
								>
									{entry.undo.label}
									{entry.undo.elementsAfter ? (
										<span className="graph-reduction-count">
											{entry.undo.elementsAfter.toLocaleString()} elements
											{entry.undo.elementsAfter > DRAW_CAP
												? ` — past the ${DRAW_CAP.toLocaleString()} this view draws, so it will ask again`
												: ''}
										</span>
									) : null}
								</button>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
