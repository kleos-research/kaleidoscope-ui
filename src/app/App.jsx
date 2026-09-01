import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	fetchHealth,
	fetchMemories,
	fetchPendingMerge,
	fetchSession,
	removeMemories,
	resolvePendingMerge,
} from './api.mjs';
import { BacklogView } from './BacklogView.jsx';
import { Filters } from './Filters.jsx';
import { GraphView } from './GraphView.jsx';
import { MemoryDetail } from './MemoryDetail.jsx';
import { MemoryEditor } from './MemoryEditor.jsx';
import { MemoryList } from './MemoryList.jsx';
import {
	HalfFinishedMerge,
	MergeScreen,
	PromoteMenu,
	ReversibilityTable,
} from './MergeFlow.jsx';
import { RemovalConfirm, RemovalReport } from './RemovalFlow.jsx';
import { RemovalLimits } from './RemovalLimits.jsx';
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

/**
 * `#/`, `#/graph`, `#/backlog`, `#/new`, `#/limits`, `#/m/<memory id>`,
 * `#/m/<memory id>/edit`, `#/m/<memory id>/merge`, or `#/m/<memory id>/limits`.
 *
 * The hash is the route so Back works with no router. The suffixed patterns are tested BEFORE the
 * bare memory one, because `#/m/<id>` matches greedily and would otherwise swallow the suffix into
 * an id that addresses nothing.
 *
 * `limits` is "What removal cannot do", and it is a ROUTE rather than a panel because it is its own
 * screen: a person reached it from a confirmation or from a menu, and they must be able to link to
 * it, come back from it, and press Back out of it like anything else on this list.
 */
function routeFromHash() {
	// The graph carries its whole view in the fragment after a `?` — lens, scope, filters and
	// selection — so a reload, a Back out of a memory and a pasted link all land on the same
	// drawing. Split on the FIRST `?` only: a surface is vault content and may contain one.
	const graph = window.location.hash.match(/^#\/graph(?:\?(.*))?$/);
	if (graph) return { name: 'graph', view: graph[1] ?? '' };
	if (window.location.hash === '#/backlog') return { name: 'backlog' };
	if (window.location.hash === '#/new') return { name: 'create' };
	if (window.location.hash === '#/limits') return { name: 'limits', memoryId: null };
	// What can and cannot be undone, per action. A screen rather than a banner: "this cannot be
	// undone" repeated on every dialog is dismissed on every dialog, and the differences between
	// the rows are the whole content.
	if (window.location.hash === '#/reversibility') return { name: 'reversibility' };
	const promoting = window.location.hash.match(/^#\/m\/(.+)\/promote$/);
	if (promoting) return { name: 'promote', memoryId: decodeURIComponent(promoting[1]) };
	// The door into the merge composition. It was written, tested and imported by nothing; a screen
	// with no route is a mechanism that reports as built and can never fire.
	const merging = window.location.hash.match(/^#\/m\/(.+)\/merge$/);
	if (merging) return { name: 'merge', memoryId: decodeURIComponent(merging[1]) };
	const editing = window.location.hash.match(/^#\/m\/(.+)\/edit$/);
	if (editing) return { name: 'edit', memoryId: decodeURIComponent(editing[1]) };
	const limits = window.location.hash.match(/^#\/m\/(.+)\/limits$/);
	if (limits) return { name: 'limits', memoryId: decodeURIComponent(limits[1]) };
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
	/** The engine's last health reading, whole. Read by the graph's fidelity strip. */
	const [health, setHealth] = useState(null);
	const [lastLooked, setLastLooked] = useState(null);

	/**
	 * THE REMOVAL FLOW'S THREE PIECES OF STATE, and none of them is a route.
	 *
	 * `selection` is what the list has ticked, keyed by memory id and carrying the title and the
	 * version the user was looking at. The version travels because it is not what the write uses —
	 * the server re-reads that immediately before each call — it is how the run refuses to remove
	 * something that changed after the user read it.
	 *
	 * `confirm` is the pending authorisation. `report` is what came back, and it is the deliverable
	 * of a run rather than a toast: it stays on screen until the user leaves it.
	 */
	const [selection, setSelection] = useState(() => new Map());
	const [confirm, setConfirm] = useState(null);
	const [report, setReport] = useState(null);
	const [removing, setRemoving] = useState(false);
	const [removalError, setRemovalError] = useState(null);

	/*
	  THE HALF-FINISHED MERGE, read once at launch from a file this app keeps beside its snapshots.
	
	  A merge is two writes with no transaction underneath, so the window between them is a state
	  the vault can be left in — and it has to survive a crash, not merely an exception, or the
	  recovery is a banner that exists only while the process that needed it is still running. This
	  is why it is read from disk here rather than held in the state of the tab that started it.
	*/
	const [halfFinished, setHalfFinished] = useState(null);
	const [resolving, setResolving] = useState(false);

	const listScroll = useRef(null);
	const savedScroll = useRef(0);

	useEffect(() => {
		const onHash = () => setRoute(routeFromHash());
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	}, []);

	const readPending = useCallback(async () => {
		try {
			const body = await fetchPendingMerge();
			setHalfFinished(body?.pending ?? null);
		} catch {
			// A record that cannot be read is not a reason to stop the app from starting. It is a
			// reason not to claim there is no half-finished merge, which is why nothing here sets
			// the banner to null on a failure.
		}
	}, []);

	useEffect(() => {
		readPending();
	}, [readPending]);

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
				if (stop) return;
				// KEPT, not just read for its position. The graph's fidelity strip renders the engine's
				// own counts beside this app's reconstruction, and the discrepancy between them is the
				// message. Holding this reading here is what lets that screen show it while issuing no
				// door call of its own — it is the poll every screen already pays for, read twice.
				setHealth(body);
				const position = body?.data?.commit_position ?? body?.commit_position ?? null;
				if (position === null) return;
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
		// Once immediately, then on the timer. The first reading is what the fidelity strip needs, and
		// waiting a full interval for it would leave that strip showing one set of counts — which is
		// the state it exists to stop being in.
		tick();
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

	const editMemory = useCallback((id) => {
		window.location.hash = `#/m/${encodeURIComponent(id)}/edit`;
	}, []);

	/**
	 * A write moved the vault, so the listing this browser holds is stale.
	 *
	 * The sidecar already invalidated its own cache on a committed write, so this is a plain read
	 * rather than a forced re-export: `refresh` would make every save pay for a second one.
	 */
	const afterSave = useCallback(
		(id) => {
			load();
			if (id) window.location.hash = `#/m/${encodeURIComponent(id)}`;
			else window.location.hash = '#/';
		},
		[load],
	);

	// ---- removal ------------------------------------------------------------------------------

	const toggleSelected = useCallback((row, on) => {
		setSelection((current) => {
			const next = new Map(current);
			if (on) next.set(row.memory_id, { memory_id: row.memory_id, title: row.title, seen_version_id: row.version_id });
			else next.delete(row.memory_id);
			return next;
		});
	}, []);

	const selectMany = useCallback((rowsToSet, on) => {
		setSelection((current) => {
			const next = new Map(current);
			for (const row of rowsToSet) {
				if (on) next.set(row.memory_id, { memory_id: row.memory_id, title: row.title, seen_version_id: row.version_id });
				else next.delete(row.memory_id);
			}
			return next;
		});
	}, []);

	/** Ask, with the list of what is about to happen. Nothing is sent from here. */
	const askToRemove = useCallback((items) => {
		setRemovalError(null);
		setReport(null);
		setConfirm({ selection: items });
	}, []);

	/**
	 * Run it. ONE CALL TO THE SIDECAR AND IT IS NEVER RETRIED.
	 *
	 * A retried run is a second run: if the first landed, the second is refused for a stale version,
	 * which is the good case — the bad case is that it did not land and nobody can tell which
	 * happened. A request that never got an answer is reported as exactly that, because "it failed"
	 * would invite the user to press it again.
	 *
	 * `escalated` says the run came from "What removal cannot do", where a memory holds a secret. It
	 * suppresses the CAPTURE of the local copy and not the record of it.
	 */
	const runRemoval = useCallback(
		async (items, { escalated = false } = {}) => {
			setRemoving(true);
			setRemovalError(null);
			try {
				const body = await removeMemories(
					items.map(({ memory_id, seen_version_id }) => ({ memory_id, seen_version_id })),
					{ escalated },
				);
				// The titles the run report needs. After a successful removal the listing door no
				// longer returns them, so what the user selected is the only place they still exist —
				// and the server's own title, where it read one, wins over this browser's copy.
				const titles = new Map(items.map((item) => [item.memory_id, item.title]));
				setReport({
					...body,
					items: (body?.items ?? []).map((item) => ({
						...item,
						title: item.title ?? titles.get(item.memory_id) ?? null,
					})),
				});
				setConfirm(null);
				setSelection(new Map());
				// The vault moved, so the listing this browser holds is stale. The sidecar already
				// dropped its own snapshot, so this is a plain read rather than a forced re-export.
				load();
			} catch (error) {
				setRemovalError(error);
			} finally {
				setRemoving(false);
			}
		},
		[load],
	);

	const showLimits = useCallback((memoryId = null) => {
		window.location.hash = memoryId ? `#/m/${encodeURIComponent(memoryId)}/limits` : '#/limits';
	}, []);

	/**
	 * Leaving the flow clears it — except for the escalation screen, which is part of it.
	 *
	 * A report left on screen after the user navigated away would be this app describing a run that
	 * is no longer what they are looking at. The selection deliberately survives: a person who reads
	 * "What removal cannot do" and comes back should find the memories they ticked still ticked.
	 */
	useEffect(() => {
		if (route.name === 'limits') return;
		setConfirm(null);
		setReport(null);
		setRemovalError(null);
	}, [route]);

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
				{/*
				  ABOVE EVERYTHING, ON EVERY SCREEN, until it is resolved. A half-finished merge means
				  the survivor holds both memories' content and the duplicate is still being served, and
				  a user who meets either of them without that context is reading a memory that is not
				  what they think it is. It is not a toast: it does not go away on its own.
				*/}
				{/*
				  ALSO ABOVE EVERYTHING, and for the same reason: it changes what the screens below
				  mean. Every option list in this product is parsed out of the engine's write
				  contract at run time, and when that contract is not one this build was tested
				  against, the lists may be short rather than wrong — which looks identical, and
				  which a user resolves by typing a new value over one that already existed.
				*/}
				<EngineCompatibility compatibility={session?.compatibility ?? null} />

				<HalfFinishedMerge
					pending={halfFinished}
					busy={resolving}
					onFinish={async () => {
						setResolving(true);
						try {
							await resolvePendingMerge('finish');
							await readPending();
							await load({ refresh: true });
						} finally {
							setResolving(false);
						}
					}}
					onUndo={async () => {
						setResolving(true);
						try {
							await resolvePendingMerge('undo');
							await readPending();
							await load({ refresh: true });
						} finally {
							setResolving(false);
						}
					}}
				/>

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
				) : route.name === 'edit' || route.name === 'create' ? (
					/*
					  The editor is branched on BEFORE the empty-vault state, because creating the first
					  memory in a vault that has none is exactly the case that state would swallow — and
					  before the rail, because there is no set on this screen to narrow.
					
					  It is handed the listing for SUGGESTIONS ONLY. Everything a save is assembled from
					  is loaded by the editor itself, through the door that carries the entity
					  declarations this cached shape does not have.
					*/
					<div className="content content-wide">
						{session ? (
							<MemoryEditor
								key={route.name === 'create' ? 'create' : route.memoryId}
								memoryId={route.name === 'create' ? null : route.memoryId}
								session={session}
								rows={rows}
								onSaved={afterSave}
								onOpen={openMemory}
								onReopen={editMemory}
								onCancel={() =>
									route.name === 'create'
										? backToList()
										: openMemory(route.memoryId)
								}
							/>
						) : (
							<LoadingState what="Taking the readings the editor is built from" />
						)}
					</div>
				) : route.name === 'reversibility' ? (
					<div className="content content-wide">
						<ReversibilityTable />
					</div>
				) : route.name === 'merge' ? (
					/*
					  The merge composition, branched here beside the editor and for the same two reasons:
					  it loads both records itself, through the door that carries their entity
					  declarations, and it has no set for the rail to narrow. The listing is handed in for
					  the CHOOSER only — naming the other memory — and nothing a write is assembled from
					  comes from it.
					*/
					<div className="content content-wide">
						<MergeScreen
							key={route.memoryId}
							memoryId={route.memoryId}
							rows={rows}
							onOpen={openMemory}
							// Back to the LIST, not to the memory this started from. Half the time that
							// memory is the one the merge just removed, and a page that cannot resolve is
							// the worst possible answer to "did that work?".
							onDone={() => {
								load();
								readPending();
								backToList();
							}}
						/>
					</div>
				) : route.name === 'promote' ? (
					/*
					  "Promote", which is not a control. The word came from a real request and maps to no
					  field, so what stands here is the small menu of named intents that DO change
					  something — each labelled with the field it changes — and, first, the sentence that
					  says there is no priority, importance or pin in this store at all.
					*/
					<div className="content content-wide">
						<PromoteMenu memoryId={route.memoryId} onEdit={editMemory} />
					</div>
				) : route.name === 'limits' ? (
					/*
					  "What removal cannot do", branched here for the same reason the editor is: it must
					  open on a vault with nothing in it, and it has no set for the rail to narrow.

					  After a removal started FROM this screen, what stands where the screen was is the
					  receipt. Sending the user back to a memory page that no longer resolves would answer
					  "did that work?" with "that memory is not in what was loaded".
					*/
					<div className="content content-wide">
						{report ? (
							<RemovalReport report={report} onBack={backToList} onOpen={openMemory} />
						) : (
							<RemovalLimits
								session={session}
								memory={rows.find((row) => row.memory_id === route.memoryId) ?? null}
								busy={removing}
								onRemove={(memory) =>
									runRemoval(
										[
											{
												memory_id: memory.memory_id,
												title: memory.title,
												seen_version_id: memory.version_id,
											},
										],
										// The one place in this product that sets it. The store still records
										// that a copy was deliberately not kept, and why.
										{ escalated: true },
									)
								}
								onCancel={() =>
									route.memoryId ? openMemory(route.memoryId) : backToList()
								}
							/>
						)}
						{removalError ? (
							<ErrorState heading="This removal did not finish" error={removalError} />
						) : null}
					</div>
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

							{/*
							  A run that never got an answer is NOT a run that did nothing, and this is the
							  message that says so. Telling the user it failed would invite them to press it
							  again, and the second run is refused for a stale version only in the good case.
							*/}
							{removalError ? (
								<ErrorState heading="This removal did not finish" error={removalError} />
							) : null}

							{confirm ? (
								<RemovalConfirm
									selection={confirm.selection}
									busy={removing}
									onCancel={() => setConfirm(null)}
									onConfirm={() => runRemoval(confirm.selection)}
									onEscalate={() =>
										showLimits(
											confirm.selection.length === 1 ? confirm.selection[0].memory_id : null,
										)
									}
								/>
							) : null}

							{/*
							  THE AFTER-STATE. The report stands where the list or the memory was, rather than
							  as a toast over them: after a removal the listing door no longer returns those
							  memories, so a page that went back to normal would answer "what just happened?"
							  with a row that is simply missing.
							*/}
							{report ? (
								<RemovalReport
									report={report}
									onBack={backToList}
									onOpen={openMemory}
									onEscalate={() => showLimits(null)}
								/>
							) : route.name === 'backlog' ? (
								/*
								  The curation backlog. Built from the listing this browser already
								  holds plus one read of this app's own dismissal file — it asks the
								  engine for nothing, which is why the whole screen can be driven as
								  arithmetic in a test.
								*/
								<BacklogView
									records={payload?.memories ?? []}
									onEdit={editMemory}
									onOpen={openMemory}
									onBack={backToList}
									onShowGraph={() => {
										window.location.hash = '#/graph';
									}}
								/>
							) : route.name === 'graph' ? (
								<GraphView
									/*
									  KEYED ON THE VIEW IN THE URL, and the key is the whole reason this
									  works. The graph owns its own state and writes the fragment back with
									  `replaceState`, which fires no `hashchange` — so this key does not
									  change while the user drives the screen. It changes only when the
									  fragment arrives from OUTSIDE: a pasted link, a Back into a graph view,
									  a Forward out of one. Without it the view prop is read once at mount and
									  every later arrival is silently ignored — a restore that reads as wired
									  and is not.
									*/
									key={route.view ?? ''}
									records={payload?.memories ?? []}
									onOpen={openMemory}
									onBack={backToList}
									health={health}
									model={session?.model ?? null}
									view={route.view ?? ''}
								/>
							) : route.name === 'memory' ? (
								<Detail
									memoryId={route.memoryId}
									rows={rows}
									relations={relations}
									strippedFields={payload?.stripped_fields}
									onOpen={openMemory}
									onBack={backToList}
									onEdit={editMemory}
									onRemove={(row) =>
										askToRemove([
											{
												memory_id: row.memory_id,
												title: row.title,
												// What the user was looking at. The write does not carry it; the run uses it
												// to refuse a memory that changed after they read it.
												seen_version_id: row.version_id,
											},
										])
									}
									onShowLimits={showLimits}
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
									selection={selection}
									onToggle={toggleSelected}
									onToggleMany={selectMany}
									maxSelectable={session?.app?.removal?.max_items ?? null}
									onRemoveSelected={() => askToRemove([...selection.values()])}
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

function Detail({
	memoryId,
	rows,
	relations,
	strippedFields,
	onOpen,
	onBack,
	onEdit,
	onRemove,
	onShowLimits,
}) {
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
			onEdit={onEdit}
			onRemove={onRemove}
			onShowLimits={onShowLimits}
		/>
	);
}

function Header({ session, pending, onRefresh, busy }) {
	return (
		<header className="topbar">
			<a className="brand" href="#/">
				Kaleidoscope
			</a>
			<nav className="topbar-nav">
				<a href="#/">Memories</a>
				{/*
				  In the main navigation rather than inside the graph, because it is the highest-value
				  surface in this product and it was previously reachable only by opening a drawing
				  and scrolling a rail beside it. There is deliberately NO COUNT BADGE here: every
				  vault has hundreds of these, the number never reaches zero, and a permanent red
				  number is a nag the reader learns to stop seeing within a day.
				*/}
				<a href="#/backlog">Needs a decision</a>
				<a href="#/graph">Graph</a>
				{/* The only entry point that creates. It is the same form the editor uses, empty. */}
				<a href="#/new">New memory</a>
			</nav>
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
 * What this engine is, relative to the one this build was tested against.
 *
 * SILENT IN TIER C AND ONLY IN TIER C. A banner that is always there is a banner nobody reads, and
 * the whole value of this one is that its appearance is information.
 *
 * It names BOTH digests. "Your engine is not supported" is a sentence a user can do nothing with;
 * the two fingerprints and the tier are what a person can put in a bug report, and they are what
 * distinguishes "this app is a version behind" from "this vault is broken", which is the wrong
 * conclusion and the one a vague banner invites.
 */
function EngineCompatibility({ compatibility }) {
	if (!compatibility || compatibility.tier === 'C') return null;
	const blocked = !compatibility.writes_permitted;
	return (
		<section className={blocked ? 'compat compat-stop' : 'compat'}>
			<h2>
				{blocked
					? 'This app will not write to this engine'
					: 'This engine is newer or older than the one this build was tested against'}
			</h2>
			{compatibility.reasons.map((reason) => (
				<p key={reason.code}>{reason.message}</p>
			))}
			<dl className="compat-readings">
				<div>
					<dt>engine</dt>
					<dd>{compatibility.engine_version ?? 'not recorded'}</dd>
				</div>
				<div>
					<dt>its write contract</dt>
					<dd>
						<code className="identifier">{compatibility.digest ?? 'not recorded'}</code>
					</dd>
				</div>
				<div>
					<dt>tested against</dt>
					<dd>
						{compatibility.tested_digests.length === 0
							? 'nothing'
							: compatibility.tested_digests.map((digest) => (
									<code className="identifier" key={digest}>
										{digest}
									</code>
								))}
					</dd>
				</div>
				<div>
					<dt>operations this app needs</dt>
					<dd>
						{compatibility.operations
							.map((op) => `${op.name} — ${op.retired ? 'retired' : op.present ? 'present' : 'missing'}`)
							.join(' · ')}
					</dd>
				</div>
			</dl>
			{/*
			  Said explicitly, because the first question a person asks at a banner like this one is
			  whether the thing they came for still works.
			*/}
			<p className="compat-effect">
				{blocked
					? 'Reading your memory is unaffected. Every screen renders, nothing is guessed, and every write is refused until you install an engine this build has been tested against.'
					: 'Reading your memory is unaffected. Writes are still allowed: the engine refuses what it cannot accept and names the field to fix, which is a better answer than a menu this app is guessing at.'}
			</p>
		</section>
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
			{/*
			  The digest and the TIER, together. The digest alone is a fingerprint nobody can act on;
			  the tier is what it means for this session, and the pair is what makes the footer's
			  claim checkable rather than decorative. The engine's VERSION is beside it and gates
			  nothing — two builds one patch apart can print this contract differently.
			*/}
			<span title={session?.compatibility?.headline ?? undefined}>
				contract <code className="identifier">{(session?.contract?.digest ?? '').slice(0, 12)}</code>{' '}
				<strong>tier {session?.compatibility?.tier ?? '—'}</strong>
			</span>
			{payload?.fetched_at ? (
				<span>read at {new Date(payload.fetched_at).toLocaleTimeString()}</span>
			) : null}
			{/*
			  Reachable from every screen, because the question "can I undo this?" is asked after the
			  thing has been done. The answer is per action and it is not the same answer twice.
			*/}
			<a href="#/reversibility">what can be undone</a>
			<span className="footer-claim">nothing here leaves this machine</span>
		</footer>
	);
}
