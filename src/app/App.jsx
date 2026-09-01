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
/*
  THE BROWSE SCREEN IS ONE COMPONENT, and that is the point of it.

  What stood here was two: a `Filters` rail this file placed, and a `MemoryList` it placed beside
  it, each computing its own view of the same set from a different helper. That is how the counts in
  the rail and the rows under them came to be able to disagree, and it is the shape the owner was
  reading when he said the last build had "no thinking balance, I just put everything together at
  one place". `BrowseView` owns the facets, the list and the preview together — one filter function,
  one count, three regions — so the arithmetic behind the number in the rail is the arithmetic that
  produced the rows. Both old files are deleted rather than left beside it.
*/
import { BrowseView } from './BrowseView.jsx';
import { nameRoute, surfaceFromRoute } from './names-model.mjs';
import { NameFocus } from './NameFocus.jsx';
import { NamesView } from './NamesView.jsx';
import { MemoryDetail } from './MemoryDetail.jsx';
import { MemoryEditor } from './MemoryEditor.jsx';
import { FocusActionsContext } from './focus-actions.mjs';
import { EMPTY_FILTERS } from './browse-model.mjs';
import {
	HalfFinishedMerge,
	MergeScreen,
	PromoteMenu,
	ReversibilityTable,
} from './MergeFlow.jsx';
import { RemovalConfirm, RemovalReport } from './RemovalFlow.jsx';
import { SearchView } from './SearchView.jsx';
import { RemovalLimits } from './RemovalLimits.jsx';
import {
	DEFAULT_SORT,
	projectOptions,
	relationIndex,
	toRow,
	withinProject,
} from './records.mjs';
import {
	AppShell,
	Button,
	EmptyState,
	Note,
	ErrorState,
	FindOrAsk,
	FocusBar,
	LoadingState,
	MenuItem,
	MenuSeparator,
	Nav,
	OverflowMenu,
	ProjectSwitcher,
	RootBar,
	ToastProvider,
	TooltipProvider,
	VaultName,
} from './ui/index.mjs';

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
 * Which project was last being read. Beside the watermark, and for the same reason: this is a
 * reading preference about a local vault, the vault itself holds no read state, and neither of
 * these is something to write into somebody's memory.
 */
const PROJECT_KEY = 'kaleidoscope-ui.project';

function readProject() {
	try {
		// An absent key and a stored empty string are both "every project"; a stored value is one.
		return window.localStorage.getItem(PROJECT_KEY) || null;
	} catch {
		return null;
	}
}

function writeProject(value) {
	try {
		if (value === null) window.localStorage.removeItem(PROJECT_KEY);
		else window.localStorage.setItem(PROJECT_KEY, value);
	} catch {
		/* a browser with storage disabled loses the preference and keeps everything else */
	}
}

/**
 * `#/`, `#/search`, `#/names`, `#/names/<name>`, `#/decide`, `#/new`, `#/limits`, `#/m/<memory id>`,
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
	/*
	  THE NAMES SCREENS. `#/names` is the table and `#/names/<surface>` is one name.

	  The surface is carried VERBATIM, percent-encoded, and is decoded straight back — never
	  normalised, hashed, or reduced to a position in a list. The entire subject of these screens is
	  that two spellings of one thing are two things, so a route key that folded them together would
	  open one name's panel from the other's row, and a positional key would address a different name
	  after the next write. It is tested BEFORE the bare `#/names` pattern, which would otherwise not
	  match at all and drop the reader on the table.
	*/
	const named = surfaceFromRoute(window.location.hash);
	if (named !== null) return { name: 'name', surface: named };
	if (window.location.hash === '#/names') return { name: 'names' };
	if (window.location.hash === '#/decide') return { name: 'backlog' };
	// The search screen. It runs no query on arrival — it carries the words typed in the shell,
	// runs "find these words" over the payload the browser already holds, and waits to be asked
	// before it touches the ranked door. See the note on `FindOrAsk`.
	const searching = window.location.hash.match(/^#\/search(?:\?q=(.*))?$/);
	if (searching) return { name: 'search', query: decodeURIComponent(searching[1] ?? '') };
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
	/*
	  The controls at the right-hand end of the focus bar, handed up by whichever screen is open.

	  It is state here and a node there because the bar is one object on every screen — the owner's
	  diagnosis was that each screen assembled its own header — while what can be DONE to a thing
	  belongs to the screen that owns the thing. See `focus-actions.mjs`.
	*/
	const [focusActions, setFocusActions] = useState(null);
	/*
	  WHICH PROJECT IS BEING READ. `null` is every project.

	  Remembered per browser, like the watermark below and for the same reason: it is a reading
	  preference, the vault holds no read state, and a person who came back to a project should not
	  have to choose it again. It is NOT in the URL, because the project is who you are while you
	  read rather than where you are — a link to a memory should open that memory whatever project
	  the person following it happens to be in.
	*/
	const [project, setProject] = useState(readProject);
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

			// THE RECORDS ARE RETURNED AS WELL AS STORED, and one caller needs them that way. A
			// curation run writes N memories and then has to plan the next rename against what the
			// vault holds NOW — the versions it started with have all moved. Waiting for this state
			// to arrive as a prop would mean re-planning on the render after the one that asked, and
			// a loop that has to yield to React between two writes is a loop with a race in it.
			return body.memories ?? [];
		} catch (error) {
			setPayloadError(error);
			return null;
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

	const allRows = useMemo(() => (payload?.memories ?? []).map(toRow), [payload]);

	/*
	  THE PROJECT IS APPLIED BEFORE ANY FILTER, because it is not one.

	  It is the axis every screen is read along, chosen once in the top bar, and it never appears as
	  a removable chip in the filter column. `withinProject` also carries the honest part: a memory
	  with no project applies EVERYWHERE, so it is included in every project's view rather than
	  hidden by one — see the note in records.mjs.
	*/
	const projects = useMemo(() => projectOptions(allRows), [allRows]);
	const rows = useMemo(() => withinProject(allRows, project), [allRows, project]);

	/*
	  Relations are indexed over the WHOLE payload, not over the project's slice. A memory in one
	  project can correct a memory in another, and an index built on the slice would report that
	  link as unresolved — which is a different claim, and a false one.
	*/
	const relations = useMemo(() => relationIndex(allRows), [allRows]);

	/*
	  THE FACETS, THE NARROWING AND THE SORT ARE NOT COMPUTED HERE ANY MORE.

	  They were, in two `useMemo`s beside this one, and the rail and the list each read one of them.
	  A facet's count and the rows it produced were therefore two answers to the same question with
	  two chances to be different — and once "since I last looked" entered the rail, they were: the
	  count resolved the watermark and the filter did not. `BrowseView` resolves it once and derives
	  both from the same array. What this file still owns is what OUTLIVES the screen: which project
	  is being read, what is ticked for a bulk run, and where the mark sits.
	*/

	const chooseProject = useCallback((next) => {
		setProject(next);
		writeProject(next);
	}, []);

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
		<TooltipProvider>
			<ToastProvider>
				{/*
				  THE BAR'S RIGHT-HAND END BELONGS TO THE SCREEN UNDER IT.

				  Details / Cancel / Save are the editor's controls and only the editor knows whether a
				  save is in flight or what is stopping one. This file holds the node and draws it; it
				  does not decide what is in it. A screen hands its controls up through
				  `useFocusActions` and takes them back when it unmounts, so a Save button cannot
				  outlive the screen that knew what it would write.
				*/}
				<FocusActionsContext.Provider value={setFocusActions}>
				<AppShell
					bar={
						<AppBar
							route={route}
							session={session}
							moved={Boolean(pending)}
							refreshing={loading}
							onRefresh={() => load({ refresh: true })}
							project={project}
							projects={projects.projects}
							everywhereCount={projects.everywhere}
							shown={rows.length}
							total={allRows.length}
							onProject={chooseProject}
							focusActions={focusActions}
						/>
					}
				>
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
							<Button onClick={() => load({ refresh: true })}>Try again</Button>
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
							<Button onClick={() => load({ refresh: true })}>Try again</Button>
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

					  It is NOT wrapped in a page column. The editor is a two-pane screen that fills the
					  region under the bar, and each of its panes scrolls on its own — which is what keeps
					  the facts beside the words rather than under them however long the words get.
					*/
					<>
						{session ? (
							<MemoryEditor
								key={route.name === 'create' ? 'create' : route.memoryId}
								memoryId={route.name === 'create' ? null : route.memoryId}
								session={session}
								rows={rows}
								onSaved={afterSave}
								onOpen={openMemory}
								onCancel={() =>
									route.name === 'create'
										? backToList()
										: openMemory(route.memoryId)
								}
							/>
						) : (
							<LoadingState what="Taking the readings the editor is built from" />
						)}
					</>
				) : route.name === 'reversibility' ? (
					<div className="screen">
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
					<div className="screen">
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
					<div className="screen">
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
					<div className="screen">
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
				) : route.name === 'list' ? (
					/*
					  THE BROWSE SCREEN. It is a DIRECT CHILD OF `.main`, and that is load-bearing rather
					  than tidy: `.browse` is `flex: 1; min-height: 0; overflow: hidden`, so it fills the
					  height it is given and hands each of its three regions its own scrolling. Wrapped in
					  the generic page container the way every other route is, the filter column and the
					  list would size to their content and the whole screen would scroll as one — which is
					  the version of this list that stops being readable somewhere around row two hundred.

					  The removal flow still stands where the screen was, for the reason it always has:
					  after a run the listing door no longer returns those memories, so a page that went
					  straight back to normal would answer "what just happened?" with a row that is simply
					  missing.
					*/
					report ? (
						<div className="screen">
							<RemovalReport
								report={report}
								onBack={backToList}
								onOpen={openMemory}
								onEscalate={() => showLimits(null)}
							/>
						</div>
					) : confirm ? (
						/*
						  HELD TO THE PAGE'S OWN MEASURE. `.prompt` is 620px wide and has no margin of its
						  own, so dropped straight into the scroll region it sat against the window's left
						  edge while every screen it appears over is a centred column — which reads as a
						  panel belonging to something else rather than to the thing being removed.
						*/
						<div className="screen">
							<div className="page page-narrow">
								{/*
								  A run that never got an answer is NOT a run that did nothing, and this is the
								  message that says so. Telling the user it failed would invite them to press
								  it again, and the second run is refused for a stale version only in the good
								  case.
								*/}
								{removalError ? (
									<ErrorState heading="This removal did not finish" error={removalError} />
								) : null}
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
							</div>
						</div>
					) : (
						<BrowseView
							rows={rows}
							relations={relations}
							session={session}
							filters={filters}
							setFilters={setFilters}
							sort={sort}
							setSort={setSort}
							lastLooked={lastLooked}
							strippedFields={payload?.stripped_fields}
							/*
							  The list's own scrolling element, handed up so the restore below still has
							  something to restore. The rows scroll inside `.mlist-rows`, not in a page
							  container, so a ref left on a wrapper would read 0 on the way out and set 0 on
							  the way back — a scroll restore that reports as wired and always lands at the
							  top.
							*/
							scrollRef={listScroll}
							selection={selection}
							onToggle={toggleSelected}
							onToggleMany={selectMany}
							maxSelectable={session?.app?.removal?.max_items ?? null}
							onRemoveSelected={() => askToRemove([...selection.values()])}
							onOpen={openMemory}
							onEdit={editMemory}
							onMerge={(id) => {
								window.location.hash = `#/m/${encodeURIComponent(id)}/merge`;
							}}
							onShowLimits={showLimits}
						/>
					)
				) : (
					<>
						<div
							// AND IT HAS TO SCROLL. `.main` is a flex column that hides its overflow, so a
							// child without `screen` is clipped at the fold — on the curation screen that
							// was every finding past the first group, silently. `screen` is the design
							// system's own answer to "a screen that scrolls as one column".
							//
							// It stood here as `content content-wide screen`, and the first two of those are
							// the deleted stylesheet's names carrying no rules at all. The same pair, WITHOUT
							// `screen`, was on four other routes — the merge composition, "what can be
							// undone", the promote menu and "what removal cannot do" — every one of which was
							// therefore cut off at the window's edge with nothing to scroll.
							className="screen"
						>
							{rows.every((row) => row.fact_count === 0) ? (
								<Note>
									Every memory here is prose with no facts attached. They are still memories and
									still served; nothing is wrong with them.
								</Note>
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
								/* See the note on the other render of this: the prompt is 620px and unmargined. */
								<div className="page page-narrow">
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
								</div>
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
							) : route.name === 'search' ? (
								/*
								  THE SEARCH SCREEN, and the ONE place in this product that can reach the
								  ranked door. It is handed the listing this browser already holds and the
								  relation index built from it; it asks the engine for nothing on arrival.

								  KEYED ON NOTHING, deliberately. A key that changed with the query would
								  remount the screen every time the URL was written back, throwing away the
								  answer the user just paid an exposure row for.
								*/
								<SearchView
									initialQuery={route.query ?? ''}
									rows={rows}
									relations={relations}
									project={project}
									onOpen={openMemory}
									/*
									  The words go into the URL so a search survives a reload and can be
									  linked. `replaceState` rather than a hash assignment: setting the hash
									  fires `hashchange`, which re-reads the route and would remount this
									  screen mid-press. And a link that carries a query still runs NOTHING on
									  arrival — the screen opens on the free search every time.
									*/
									onQueryChange={(text) =>
										window.history.replaceState(
											null,
											'',
											text ? `#/search?q=${encodeURIComponent(text)}` : '#/search',
										)
									}
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
									/*
									  The re-read the merge needs, both DURING a run and after it. During:
									  every rename after the first has to carry versions the writes before
									  it have already moved. After: the clustering is recomputed, so the
									  next pass is over the vault as it is now rather than over the one the
									  page loaded — a review screen still showing pre-merge clusters invites
									  the same merge twice.
									*/
									onReread={() => load({ refresh: true })}
									onShowGraph={() => {
										window.location.hash = '#/names';
									}}
								/>
							) : route.name === 'names' ? (
								/*
								  THE NAMES TABLE. It takes the listing this browser already holds and
								  reaches nothing: every count, order and near-duplicate proposal on it is
								  arithmetic over that payload. The one door that would make it convenient
								  is a ranked query, and a ranked query writes a permanent exposure row
								  into the vault it is inspecting.
								*/
								<NamesView
									records={payload?.memories ?? []}
									onOpenName={(surface) => {
										window.location.hash = nameRoute(surface);
									}}
									/*
									  The claim list behind a collapsed hub ends every row in the memory that
									  wrote it. A list of a hundred thousand facts none of which can be
									  opened is a place those facts go to be unreachable.
									*/
									onOpenMemory={openMemory}
								/>
							) : route.name === 'name' ? (
								<NameFocus
									key={route.surface}
									surface={route.surface}
									records={payload?.memories ?? []}
									health={health}
									model={session?.model ?? null}
									onOpen={openMemory}
									onOpenName={(surface) => {
										window.location.hash = nameRoute(surface);
									}}
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
							) : /*
								  The narrowed-to-nothing and the list itself both moved into `BrowseView`,
								  which owns the filter that produced the emptiness and can therefore say
								  which narrowing to undo. Nothing else routes here.
								*/ null}
						</div>
					</>
				)}
				</AppShell>
				</FocusActionsContext.Provider>
			</ToastProvider>
		</TooltipProvider>
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
					<Button onClick={onBack}>Back to the list</Button>
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

/**
 * THE ONE BAR, IN ITS TWO MODES.
 *
 * Root on the list-level screens; focus on a memory, the editor and one name in the graph. It is
 * one component because the alternative — each screen assembling its own header — is precisely the
 * thing the owner named: "no thinking balance, I just put everything together at one place".
 *
 * Everything in it is reachable without scrolling, which fixes "I do see a Refresh, but I have to
 * scroll" directly rather than by moving the Refresh somewhere else.
 */
function AppBar({
	route,
	session,
	moved,
	refreshing,
	onRefresh,
	project,
	projects,
	everywhereCount,
	shown,
	total,
	onProject,
	focusActions = null,
}) {
	/*
	  THE FOCUS MODE. A screen that is about ONE thing replaces the root bar rather than adding a
	  second row under it — a second row is exactly the chrome a reader has to scroll past before
	  reaching what they opened.

	  The actions are deliberately NOT here: the screen that owns the thing owns what can be done to
	  it, and it renders its own controls into `actions`. This file would otherwise have to know
	  about editing, removal and merging, which is how a shell becomes an application.
	*/
	if (FOCUS_ROUTES[route.name]) {
		const focus = FOCUS_ROUTES[route.name];
		return (
			<FocusBar
				backTo={focus.backTo}
				backLabel={focus.backLabel}
				trail={focus.trail ? focus.trail(route) : []}
				actions={focusActions}
			/>
		);
	}

	const vaultRoot = session?.vault?.root ?? null;

	return (
		<RootBar
			vault={
				<VaultName
					name={shortVaultName(vaultRoot)}
					readings={[
						{ term: 'this vault', value: vaultRoot ?? 'resolving…', mono: true },
						{ term: 'engine', value: session?.engine?.version ?? 'not recorded' },
						{ term: 'engine binary', value: session?.engine?.path ?? 'not recorded', mono: true },
						{ term: 'embedding model', value: session?.model?.status ?? 'not recorded' },
						{
							term: 'write contract',
							value: `${(session?.contract?.digest ?? '').slice(0, 12) || 'not recorded'} · tier ${
								session?.compatibility?.tier ?? '—'
							}`,
							mono: true,
						},
						{
							term: 'copies kept before a write',
							value: session?.snapshots?.directory ?? 'not recorded',
							mono: true,
						},
						{ term: '', value: 'Nothing here leaves this machine.' },
					]}
				/>
			}
			project={
				<ProjectSwitcher
					projects={projects}
					value={project}
					onChange={onProject}
					shown={shown}
					everywhereCount={everywhereCount}
				/>
			}
			context={
				project === null || total === shown ? null : `of ${total} in this vault`
			}
			nav={<Nav current={route.name} />}
			/*
			  NOT ON THE SEARCH SCREEN. Search.dc.html draws that screen's top bar as the wordmark and
			  the project chip and nothing else, because the screen's own box is the search box —
			  two of them, one 220px wide in the chrome and one 940px wide six lines below it, is the
			  same control twice and a reader has to work out which one is live.
			*/
			find={
				route.name === 'search' ? null : (
				<FindOrAsk
					onSubmit={(text) => {
						const typed = text.trim();
						// A NAVIGATION, NOT A QUERY. Nothing here runs a search; the search screen
						// decides what to do with the words, and it too waits to be asked before it
						// touches the ranked door.
						window.location.hash = typed ? `#/search?q=${encodeURIComponent(typed)}` : '#/search';
					}}
				/>
				)
			}
			onRefresh={onRefresh}
			refreshing={refreshing}
			moved={moved}
			menu={
				<OverflowMenu>
					<MenuItem onSelect={() => (window.location.hash = '#/new')}>Write a memory</MenuItem>
					<MenuSeparator />
					<MenuItem onSelect={() => (window.location.hash = '#/reversibility')}>
						What can be undone
					</MenuItem>
					<MenuItem onSelect={() => (window.location.hash = '#/limits')}>
						What removal cannot do
					</MenuItem>
				</OverflowMenu>
			}
		/>
	);
}

/**
 * Which routes wear the focus bar, and what "back" means on each.
 *
 * A table rather than a chain of conditions, so adding a screen is adding a row and a screen with
 * no row gets the root bar — which is the safe default, because the root bar is the one that can
 * navigate anywhere.
 */
const FOCUS_ROUTES = {
	memory: { backTo: '#/', backLabel: 'Memories' },
	edit: { backTo: '#/', backLabel: 'Memories' },
	create: { backTo: '#/', backLabel: 'Memories' },
	merge: { backTo: '#/', backLabel: 'Memories' },
	promote: { backTo: '#/', backLabel: 'Memories' },
	limits: { backTo: '#/', backLabel: 'Memories' },
	reversibility: { backTo: '#/', backLabel: 'Memories' },
	/*
	  One name. Back goes to the table rather than to the memory list, because the table is where the
	  reader chose this name — a Back that leaves the section is a Back that loses the search they
	  typed to get here.
	*/
	name: {
		backTo: '#/names',
		backLabel: 'Things your memories talk about',
		trail: (route) => [route.surface],
	},
};

/**
 * THE VAULT AS A SHORT NAME.
 *
 * "I don't know why we need to enter the entire folder path. It's too long."
 *
 * The last segment of the resolved root, which is what a person calls the place their work lives.
 * The full path is one click away in the popover this feeds, so nothing was hidden — a fingerprint
 * stopped being a headline. A root that ends in a dot-directory takes the segment above it, because
 * ".kaleidoscope" names every vault on the machine and therefore names none of them.
 */
export function shortVaultName(root) {
	if (!root) return null;
	const parts = String(root).split('/').filter(Boolean);
	if (parts.length === 0) return String(root);
	const last = parts[parts.length - 1];
	if (last.startsWith('.') && parts.length > 1) return parts[parts.length - 2];
	return last;
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
		<section className={blocked ? 'notice notice-warn' : 'notice'}>
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
