import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchHealth, fetchMemories, fetchSession } from './api.mjs';
import { Filters } from './Filters.jsx';
import { MemoryDetail } from './MemoryDetail.jsx';
import { MemoryList } from './MemoryList.jsx';
import {
	DEFAULT_SORT,
	EMPTY_FILTERS,
	SORTS,
	applyFilters,
	buildFacets,
	isFiltered,
	relationIndex,
	toRow,
} from './records.mjs';
import { EmptyState, ErrorState, LoadingState } from './ui.jsx';

/** How often the cheap liveness read runs. It fetches no memory and writes nothing. */
const LIVENESS_INTERVAL_MS = 30_000;

/**
 * THE OVERSIZED-VAULT CEILING IS THE SERVER'S, AND THIS FILE NO LONGER GUESSES AT ONE.
 *
 * There was a threshold here. It read `session.listing.threshold` and `session.vault.memory_count`,
 * fell back to a number of its own, and neither field is one the sidecar sends — so the branch it
 * guarded could not fire, on any vault, at any size. The screen it protects is real: the export
 * door has no pagination, so above some size the load stops being a wait and becomes a stall.
 *
 * What actually holds that line is the SERVER, which takes the count from the cheap health read
 * before it attempts an export and answers `outcome: "refused"` carrying the count and the ceiling
 * it compared against. That refusal is rendered below. An unwired guard beside a wired one is
 * worse than no guard: it reads as covered.
 */

/** Where the "since I last looked" mark lives. The vault holds no read state and this is not one. */
const WATERMARK_KEY = 'kaleidoscope-ui.watermark';

function readWatermark() {
	try {
		const raw = window.localStorage.getItem(WATERMARK_KEY);
		return raw === null ? null : Number(raw);
	} catch {
		// A browser with storage disabled loses the preset and keeps everything else.
		return null;
	}
}

function writeWatermark(value) {
	try {
		window.localStorage.setItem(WATERMARK_KEY, String(value));
	} catch {
		/* nothing to do, and nothing that depends on it */
	}
}

/** `#/` or `#/m/<memory id>`. The hash is the route so Back works without a router dependency. */
function routeFromHash() {
	const match = window.location.hash.match(/^#\/m\/(.+)$/);
	return match ? { name: 'memory', memoryId: decodeURIComponent(match[1]) } : { name: 'list' };
}

export function App() {
	const [session, setSession] = useState(null);
	const [sessionError, setSessionError] = useState(null);

	const [payload, setPayload] = useState(null);
	const [payloadError, setPayloadError] = useState(null);
	// A refusal is not an error and not an empty vault. It is the third thing a listing request can
	// come back as, it arrives with HTTP 200, and it is held apart from both because the screen it
	// deserves is different from either.
	const [refusal, setRefusal] = useState(null);
	const [loading, setLoading] = useState(true);

	const [filters, setFilters] = useState(EMPTY_FILTERS);
	const [sort, setSort] = useState(DEFAULT_SORT);
	const [route, setRoute] = useState(routeFromHash);
	const [pending, setPending] = useState(null);
	const [lastLooked, setLastLooked] = useState(null);

	const listScroll = useRef(null);
	const savedScroll = useRef(0);

	useEffect(() => {
		const onHash = () => setRoute(routeFromHash());
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	}, []);

	const load = useCallback(async ({ refresh = false } = {}) => {
		setLoading(true);
		setPayloadError(null);
		try {
			const body = await fetchMemories({ refresh });

			// CHECKED BEFORE THE PAYLOAD IS BELIEVED. A refused listing carries no `memories` key,
			// so a caller that stores it and reads `body.memories ?? []` renders zero rows and the
			// screen says the vault is empty — which is the one sentence that is certainly false
			// about a vault too large to load.
			if (body?.outcome === 'refused') {
				setRefusal(body.error ?? { message: body.reason ?? null });
				setPayload(null);
				return;
			}

			setRefusal(null);
			setPayload(body);
			setPending(null);

			// The mark from the previous visit is read before the new one is written, so "since I
			// last looked" means the last time, not this time.
			const highest = Math.max(
				-1,
				...(body.memories ?? []).map((record) => record?.semantic?.sequence ?? -1),
			);
			setLastLooked((current) => (current === null ? readWatermark() : current));
			if (Number.isFinite(highest) && highest >= 0) writeWatermark(highest);
		} catch (error) {
			setPayloadError(error);
		} finally {
			setLoading(false);
		}
	}, []);

	// Launch: the readings first, because they carry the vocabulary every control is built from and
	// the count that decides whether the whole-vault load is attempted at all.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			let readings = null;
			try {
				readings = await fetchSession();
				if (cancelled) return;
				setSession(readings);
			} catch (error) {
				if (cancelled) return;
				setSessionError(error);
			}

			// The listing is asked for unconditionally, and the size decision is NOT taken here.
			//
			// R24 requires the count to come from a cheap reading rather than from the export a
			// refusal would decline to perform, so that an oversized vault yields a sentence rather
			// than a timeout. That is satisfied — by the sidecar, which reads the count from the
			// health door before it spawns an export and answers `refused` without attempting one.
			// Repeating the test here on fields the sidecar does not publish satisfied nothing.
			if (!cancelled) load();
		})();
		return () => {
			cancelled = true;
		};
	}, [load]);

	/**
	 * Detect in the background; fetch on the user's word.
	 *
	 * This vault genuinely gains memories mid-session, written by agents nobody in the room is
	 * running. A list that re-sorts under a reading user is hostile at exactly the moment the product
	 * is supposed to make the store feel reliable. So the timer reads a cheap position and NOTHING
	 * else, and the export is re-fetched only when the reader asks. If this read fails, the badge is
	 * simply absent and the manual refresh still works.
	 */
	useEffect(() => {
		if (!payload) return undefined;
		let stop = false;
		const tick = async () => {
			try {
				const body = await fetchHealth();
				const position = body?.data?.commit_position ?? body?.commit_position ?? null;
				if (stop || position === null) return;
				// The position the LISTING was taken at, and it lives on the cache reading beside the
				// payload rather than on the payload itself. Read from the wrong place this comparison
				// is always `null !== …`, which is never true, so the badge cannot appear on any
				// vault — and an absent badge is indistinguishable from a vault that has not moved.
				const seen =
					payload.cache?.commit_position ??
					payload.commit_position ??
					payload.source?.canonical_generation ??
					null;
				if (seen !== null && String(position) !== String(seen)) setPending(position);
			} catch {
				// A failing liveness check degrades to the manual policy. It never blocks a read.
			}
		};
		const timer = setInterval(tick, LIVENESS_INTERVAL_MS);
		return () => {
			stop = true;
			clearInterval(timer);
		};
	}, [payload]);

	const rows = useMemo(() => (payload?.memories ?? []).map(toRow), [payload]);
	const relations = useMemo(() => relationIndex(rows), [rows]);
	const facets = useMemo(
		() => buildFacets(rows, session?.vocabulary, relations),
		[rows, session, relations],
	);

	const filtered = useMemo(() => {
		const matched = applyFilters(rows, filters, relations);
		return [...matched].sort(SORTS[sort].compare);
	}, [rows, filters, relations, sort]);

	const openMemory = useCallback((memoryId) => {
		savedScroll.current = listScroll.current?.scrollTop ?? 0;
		window.location.hash = `#/m/${encodeURIComponent(memoryId)}`;
	}, []);

	const backToList = useCallback(() => {
		window.location.hash = '#/';
	}, []);

	// Coming back to the list puts the reader where they left it. A list that jumps to the top after
	// every memory makes a vault feel unreadable long before it is actually large.
	useEffect(() => {
		if (route.name === 'list' && listScroll.current) {
			listScroll.current.scrollTop = savedScroll.current;
		}
	}, [route]);

	return (
		<div className="app">
			<Header
				session={session}
				pending={pending}
				onRefresh={() => load({ refresh: true })}
				busy={loading}
			/>

			<main className="main">
				{refusal ? (
					<EmptyState
						heading={
							refusal.kind === 'vault-too-large'
								? 'This vault is larger than this version handles'
								: 'This vault was not listed'
						}
						action={
							<button type="button" className="button" onClick={() => load({ refresh: true })}>
								Try again
							</button>
						}
					>
						{/*
						  The server's own sentence, whole. It names the count it read and the ceiling it
						  compared against, and both came from the vault a moment ago — a number this
						  screen made up would be a guess about the machine the user is actually on.
						*/}
						<p>{refusal.message ?? 'The local server declined to list this vault.'}</p>
						{typeof refusal.memory_count === 'number' && typeof refusal.ceiling === 'number' ? (
							<p>
								{refusal.memory_count.toLocaleString()} memories against a ceiling of{' '}
								{refusal.ceiling.toLocaleString()}. This version loads the whole vault in one
								read — the door behind it accepts no filter and no page — so above that a load
								stops being a wait and becomes a stall.
							</p>
						) : null}
						<p>
							Nothing was read and nothing was changed. The readings in the footer still work, and
							so does everything the agent does with this vault.
						</p>
					</EmptyState>
				) : sessionError && !payload ? (
					<ErrorState heading="This app could not take its readings" error={sessionError} />
				) : payloadError ? (
					<ErrorState
						heading="This vault could not be read"
						error={payloadError}
						action={
							<button type="button" className="button" onClick={() => load({ refresh: true })}>
								Try again
							</button>
						}
					/>
				) : loading && !payload ? (
					<LoadingState />
				) : rows.length === 0 ? (
					<EmptyState heading="This vault has no memories yet">
						<p>
							Nothing has been written to it. Memories arrive when an agent working with this
							vault records something — this app shows them; it does not create them.
						</p>
					</EmptyState>
				) : (
					<>
						{/*
						  The rail belongs to the list and to nothing else. A memory's own page is one
						  record: there is no set on it to narrow, and a facet control beside it invites
						  a click that silently changes the list behind the page rather than anything on
						  it. The filter state survives the trip either way — it lives here, not in the
						  rail — so coming back finds the list exactly as it was left.
						*/}
						{route.name === 'list' ? (
							<Filters
								facets={facets}
								filters={filters}
								setFilters={setFilters}
								rows={rows}
								lastLooked={lastLooked}
							/>
						) : null}

						<div
							// The layout is two columns and the rail is the first of them, so a page with
							// no rail has to be told to span both or it renders inside the rail's width.
							className={route.name === 'list' ? 'content' : 'content content-wide'}
							ref={listScroll}
						>
							{rows.every((row) => row.fact_count === 0) ? (
								<p className="banner">
									Every memory here is prose with no facts attached. They are still memories and
									still served; nothing is wrong with them.
								</p>
							) : null}

							{route.name === 'memory' ? (
								<Detail
									memoryId={route.memoryId}
									rows={rows}
									relations={relations}
									strippedFields={payload?.stripped_fields}
									onOpen={openMemory}
									onBack={backToList}
								/>
							) : filtered.length === 0 && isFiltered(filters) ? (
								<EmptyState
									heading="No memory matches these filters"
									action={
										<button
											type="button"
											className="button"
											onClick={() => setFilters(EMPTY_FILTERS)}
										>
											Clear the filters
										</button>
									}
								>
									<p>
										This filter finds the words you type. It does not rank, and it does not find
										a memory that means the same thing in different words — that is a different
										kind of question and this version does not ask it.
									</p>
								</EmptyState>
							) : (
								<MemoryList
									rows={filtered}
									total={rows.length}
									filters={filters}
									setFilters={setFilters}
									sort={sort}
									setSort={setSort}
									relations={relations}
									onOpen={openMemory}
								/>
							)}
						</div>
					</>
				)}
			</main>

			<Footer session={session} payload={payload} />
		</div>
	);
}

function Detail({ memoryId, rows, relations, strippedFields, onOpen, onBack }) {
	const row = rows.find((candidate) => candidate.memory_id === memoryId);
	if (!row) {
		return (
			<EmptyState
				heading="That memory is not in what was loaded"
				action={
					<button type="button" className="button" onClick={onBack}>
						Back to the list
					</button>
				}
			>
				<p>
					The link names <code className="identifier">{memoryId}</code>, which is not among the
					memories this app read. It may have been removed since, or it may never have been in this
					vault.
				</p>
			</EmptyState>
		);
	}
	return (
		<MemoryDetail
			row={row}
			rows={rows}
			relations={relations}
			strippedFields={strippedFields}
			onOpen={onOpen}
			onBack={onBack}
		/>
	);
}

function Header({ session, pending, onRefresh, busy }) {
	return (
		<header className="topbar">
			<a className="brand" href="#/">
				Kaleidoscope
			</a>
			<span className="topbar-vault" title={session?.vault?.root ?? undefined}>
				{session?.vault?.root ?? 'resolving the vault…'}
			</span>

			<div className="topbar-right">
				{/*
				  The badge fetches nothing. It says the vault moved and waits to be asked — an
				  accepted refresh is the only thing that re-reads the vault, and the reader decides
				  when that happens.
				*/}
				{pending ? (
					<button type="button" className="badge" onClick={onRefresh}>
						This vault has moved — refresh
					</button>
				) : null}
				<button type="button" className="button" onClick={onRefresh} disabled={busy}>
					{busy ? 'Reading…' : 'Refresh'}
				</button>
			</div>
		</header>
	);
}

/**
 * The readings, permanently on screen.
 *
 * Which binary answered, from where, which vault it resolved, and whether the model is actually in
 * it. A tool that reports on a store should say which store, and a reading displayed beside the
 * result is the difference between a number and a number you can check.
 */
function Footer({ session, payload }) {
	return (
		<footer className="footer">
			<span>
				engine <strong>{session?.engine?.version ?? '—'}</strong>
			</span>
			<span className="footer-path">{session?.engine?.path ?? '—'}</span>
			<span>
				model <strong>{session?.model?.status ?? '—'}</strong>
			</span>
			<span>
				contract <code className="identifier">{(session?.contract?.digest ?? '').slice(0, 12)}</code>
			</span>
			{payload?.fetched_at ? (
				<span>read at {new Date(payload.fetched_at).toLocaleTimeString()}</span>
			) : null}
			<span className="footer-claim">nothing here leaves this machine</span>
		</footer>
	);
}
