import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { useRef, useState } from 'react';

import { cx } from './cx.mjs';
import { Plus } from './icons.jsx';

/**
 * THE CONTROL THE VOCABULARY RULE FORCES. EditValues.dc.html is its specification.
 *
 * Every option list in this product is built from what the engine published a moment ago and from
 * what the loaded records actually contain. Nothing is written down here. That means every such
 * field has to do three things at once, and doing only the first two is the failure:
 *
 *   1. OFFER WHAT THE VAULT ALREADY USES, each with how often. "already in 4 memories" is not
 *      decoration — names join only when they match character for character, so picking the
 *      existing one is the single act that keeps two mentions one thing. The counts are what make
 *      that choice obvious rather than lucky.
 *   2. ACCEPT SOMETHING NEW, always, on any input — not only when the list comes back empty. The
 *      vocabulary grows and this app must never be the thing that stops it.
 *   3. SAY WHAT ACCEPTING SOMETHING NEW COSTS, at the moment of accepting it. "accepted, but splits
 *      the facts of a relation" is the whole sentence, and it belongs on the row that does it.
 *
 * The create row is LAST, under the existing values, on purpose. Offering it first would make
 * fragmentation the default gesture.
 *
 * Filtering is ours (`shouldFilter={false}`), because cmdk's default is a fuzzy score and this is a
 * field where exactness is the point: a fuzzy match that floats "lockfile hash prefix" above
 * "lockfile hash" is arguing for the wrong choice. See `matchOptions`.
 */

/**
 * Which options a typed string offers, in the order they are offered.
 *
 * Exact first, then prefix, then substring — and never a fuzzy or edit-distance match. This is the
 * ranking a person would do by eye, and it is deterministic, which matters because the reader is
 * being asked to make an identity decision from it.
 */
export function matchOptions(options, query) {
	const needle = query.trim().toLowerCase();
	if (needle === '') return options;
	const rank = (label) => {
		const value = String(label).toLowerCase();
		if (value === needle) return 0;
		if (value.startsWith(needle)) return 1;
		if (value.includes(needle)) return 2;
		return 3;
	};
	return options
		.map((option) => ({ option, rank: rank(option.value) }))
		.filter((entry) => entry.rank < 3)
		.sort((a, b) => a.rank - b.rank || (b.option.count ?? 0) - (a.option.count ?? 0))
		.map((entry) => entry.option);
}

/** Whether what was typed is genuinely new, so the create row can say so honestly. */
export function isNewValue(options, query) {
	const needle = query.trim();
	if (needle === '') return false;
	return !options.some((option) => option.value === needle);
}

export function Combobox({
	value = '',
	onValueChange,
	onSelect,
	options = [],
	placeholder = '',
	layout = 'list',
	/** What the create row says. A function so it can quote what was typed, as the mockup does. */
	createLabel = (typed) => `Use “${typed}” as a new name`,
	/** What accepting a new value costs, on the create row. Omitted only when it genuinely costs nothing. */
	createCost = null,
	emptyLabel = 'Nothing in this vault matches',
	groupLabel = null,
	disabled = false,
	/** How many matches one panel shows. Past this it has stopped being a list somebody reads. */
	limit = 60,
	id,
	className,
	inputClassName,
}) {
	const [open, setOpen] = useState(false);
	const inputRef = useRef(null);
	/*
	  THE CAP IS APPLIED AFTER THE MATCH, NOT BEFORE IT, and the difference is the whole point of this
	  control.

	  The editor used to hand in `vault.surfaces.slice(0, 60)` — the sixty most-used names in the
	  vault. On a vault carrying 1,274 of them, typing toward any of the other 1,214 offered no
	  match and the create row: "Use “recurrence” as a new name", for a name already in the vault.
	  Accepting it mints a second node for one thing, which is precisely the fragmentation the whole
	  names screen exists to clean up, offered by the control whose own note says "picking the
	  existing one is what keeps them one thing".

	  So the caller passes everything it knows, the ranking runs over all of it, and the cap trims
	  the tail nobody was going to read.
	*/
	const ranked = matchOptions(options, value);
	const matches = ranked.length > limit ? ranked.slice(0, limit) : ranked;
	const hidden = ranked.length - matches.length;
	const isNew = isNewValue(options, value);

	const commit = (next) => {
		onValueChange?.(next);
		onSelect?.(next);
		setOpen(false);
		// Focus goes back to the field the value landed in, not to the body. A combobox that drops
		// focus on select makes the next field unreachable without the mouse.
		inputRef.current?.focus();
	};

	return (
		<Command
			shouldFilter={false}
			loop
			className={cx('combobox', className)}
			// cmdk owns Up/Down/Enter while focus is in its input. Escape is ours, because the input
			// lives in the anchor rather than inside the floating panel, so Radix never sees it.
			onKeyDown={(event) => {
				if (event.key === 'Escape' && open) {
					event.preventDefault();
					setOpen(false);
				}
			}}
		>
			<Popover.Root open={open && !disabled} onOpenChange={setOpen}>
				<Popover.Anchor asChild>
					<Command.Input
						ref={inputRef}
						id={id}
						value={value}
						disabled={disabled}
						placeholder={placeholder}
						className={cx('input', inputClassName)}
						onValueChange={(next) => {
							onValueChange?.(next);
							setOpen(true);
						}}
						onFocus={() => setOpen(true)}
						onMouseDown={() => setOpen(true)}
					/>
				</Popover.Anchor>
				<Popover.Portal>
					<Popover.Content
						align="start"
						sideOffset={4}
						className={cx('surface-float', 'combobox-panel')}
						style={{ width: 'var(--radix-popper-anchor-width)' }}
						// Focus must stay in the input: this is a control you type into while the list
						// updates underneath you, not a menu you tab into.
						onOpenAutoFocus={(event) => event.preventDefault()}
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						<Command.List className="combobox-list">
							{layout === 'cloud' ? (
								<>
									{groupLabel ? <div className="select-label">{groupLabel}</div> : null}
									<div className="combobox-cloud">
										{matches.map((option) => (
											<Command.Item
												key={option.value}
												value={option.value}
												onSelect={() => commit(option.value)}
												className={cx('chip', option.value !== value && 'chip-neutral')}
											>
												{option.value}
											</Command.Item>
										))}
									</div>
								</>
							) : (
								<>
									{groupLabel ? <div className="select-label">{groupLabel}</div> : null}
									{matches.length === 0 && !isNew ? (
										<div className="combobox-empty">{emptyLabel}</div>
									) : null}
									{matches.map((option, index) => (
										<Command.Item
											key={option.value}
											value={option.value}
											onSelect={() => commit(option.value)}
											className="combobox-item"
										>
											<span>{option.value}</span>
											{option.count === null || option.count === undefined ? null : (
												<span className="item-count">{describeCount(option.count, index === 0)}</span>
											)}
										</Command.Item>
									))}
								</>
							)}

							{/*
							  ALWAYS RENDERED when what is typed is not already a value — never conditional
							  on the list above being empty. A field that only offers "new" when it has
							  nothing else to say is a field that quietly refuses new values most of the
							  time, which is the vocabulary rule broken by omission.
							*/}
							{isNew ? (
								<Command.Item
									value={`__create__${value}`}
									onSelect={() => commit(value.trim())}
									className="combobox-create"
								>
									<Plus size={13} />
									<span>{createLabel(value.trim())}</span>
									{createCost ? <span className="item-count">{createCost}</span> : null}
								</Command.Item>
							) : null}

							{/*
							  A LIST THAT WAS CUT SAYS SO. Otherwise the panel is indistinguishable from one
							  showing everything that matched, and a reader who does not see the name they
							  meant concludes the vault does not have it.
							*/}
							{hidden > 0 ? (
								<div className="combobox-more">
									{hidden.toLocaleString()} more match what you have typed. Type more of the name.
								</div>
							) : null}
						</Command.List>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		</Command>
	);
}

/**
 * "already in 4 memories" for the top row; "1 memory" for the rest.
 *
 * The leading row says what the number counts, because a bare "4" beside a name in an identity
 * decision could be four of several things — and "already" is the word that turns a count into the
 * argument for picking this row instead of minting a second spelling. Once the unit is established
 * the rows below it repeat only the number, which is how the mockup reads.
 */
function describeCount(count, leading) {
	const unit = count === 1 ? '1 memory' : `${count} memories`;
	return leading ? `already in ${unit}` : unit;
}
