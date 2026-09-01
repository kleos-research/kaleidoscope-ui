/**
 * The snapshot spine: a local copy of what a memory was, written immediately BEFORE every write.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS NOT, AND THE EXPERIMENT THAT DECIDED IT
 * ---------------------------------------------------------------------------------------------
 *
 * **A snapshot is not an undo, and nothing in this module restores one.** That is a measured
 * finding, not caution: `docs/RESTORE-EXPERIMENT.md` records the run, and `test/restore.test.mjs`
 * asserts it on every suite, so the day the engine changes it, the suite says so.
 *
 * Four doors were tried against a memory that had been removed, and all four are closed:
 *
 *   - the import door refuses a per-memory export outright — and a per-memory export is exactly
 *     what a snapshot is;
 *   - it refuses a whole-workspace export back over the vault it came from, because the removed
 *     record is still held and holding it is what conflicts. That refusal is not about removal:
 *     the same import is refused identically against a vault where the memory is alive and well;
 *   - it refuses any destination holding memories the package does not carry;
 *   - and the write door refuses an update against a tombstoned record.
 *
 * So this module exposes **list**, **read** and the bytes themselves, and exposes **no restore**.
 * There is nothing to route one to. A restore button here would be the same lie PRD 0004 exists to
 * prevent, one screen over.
 *
 * What a snapshot IS worth, given all that:
 *
 *   - it is the only readable copy of a memory that survives this app's own writes. The vault keeps
 *     the bytes after a removal and stops serving them, and no published door hands them back;
 *   - it answers "what did that edit throw away?" and "what was in the memory I just removed?",
 *     which are the two questions a curation tool has to be able to answer about itself;
 *   - a whole-vault export taken before a destructive session is the only thing that makes the one
 *     recovery route that DOES exist — importing into a fresh, empty vault — an option rather than
 *     a hypothetical.
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE IT LIVES, AND WHY NOT IN THE VAULT
 * ---------------------------------------------------------------------------------------------
 *
 * Outside the vault, under this app's own state directory, keyed by vault identity.
 *
 * Writing app state into the vault would pollute the store this app exists to curate: the snapshots
 * would appear in the user's own memory list, be carried by the export door, be retrieved by their
 * agents, and be counted in every number the product reports about their memory. A tool whose
 * safety net is indistinguishable from the user's data has no safety net, it has a second corpus.
 *
 * Keyed by vault identity, so two vaults never share a store. The key is a digest over the resolved
 * root and the workspace id rather than the path spelled out, so the store is not itself a listing
 * of where somebody keeps their memory.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FILE PAIR, AND WHY THE HEADER IS WRITTEN LAST
 * ---------------------------------------------------------------------------------------------
 *
 * Each snapshot is two files: `<id>.export.json` carries the export payload, `<id>.snapshot.json`
 * carries the header — what memory, what version, when, what operation was about to happen, and the
 * digest of the payload beside it.
 *
 * The payload is written and renamed into place FIRST, the header second. A header therefore always
 * implies a complete payload, which is what lets `list()` read only the small files and still make
 * a true statement. The reverse order would produce a header naming a payload that is not there yet
 * — a listing that promises bytes it cannot serve, which is the failure this whole module is a
 * defence against. Deletion runs in the opposite order for the same reason.
 *
 * ---------------------------------------------------------------------------------------------
 * IT BLOCKS THE WRITE
 * ---------------------------------------------------------------------------------------------
 *
 * `take()` throws. The write path treats that as a stop and the engine is never called.
 *
 * A spine that skipped quietly when the disk was full would be worse than no spine at all: the
 * screen would keep saying a copy was kept, the user would keep believing there was something to go
 * back to, and the first time either mattered would be the first time anybody found out. The cost
 * of the guarantee is one extra engine call per write, and that is the price.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * THE RETENTION RULE, IN ONE PLACE, AND IT IS PUBLISHED.
 *
 * Two bounds, because one of them cannot do the job alone. The per-memory bound is what protects
 * the user — the last few states of the memory they are actually editing are the ones they might
 * want back — and on its own it is not a bound at all, because a vault has as many memories as it
 * likes. The per-vault bound is what makes the store finite, and on its own it lets one heavily
 * edited memory evict every other memory's only copy.
 *
 * Both are enforced on every write, per-memory first, and both are reported: the take result names
 * what it pruned, and `/api/snapshots` names the rule beside the count, so a person can see the
 * ceiling they are near rather than discovering it by loss.
 */
export const RETENTION = Object.freeze({
	per_memory: 20,
	per_vault: 500,
	rule:
		'The newest 20 snapshots of each memory are kept, and the newest 500 in this vault’s ' +
		'store. Whichever bound bites first, the oldest are deleted. Nothing here expires by age: a ' +
		'store nobody has written to for a year still holds everything it held, because a snapshot ' +
		'that vanished on a clock would be missing at exactly the moment somebody finally looked ' +
		'for it.',
});

/** The store format, so a later reader can tell a shape it understands from one it does not. */
export const STORE_VERSION = 1;

const HEADER_SUFFIX = '.snapshot.json';
const PAYLOAD_SUFFIX = '.export.json';

/**
 * A snapshot id, and the ONLY shape this module will resolve to a path.
 *
 * `YYYYMMDDThhmmssmmmZ-<12 hex>`: sortable by time as a plain string, unique by the random tail,
 * and — the reason it is a regular expression rather than a comment — free of `.` and `/`, checked
 * before anything is joined to a directory. An id arrives from a URL. A path built from an
 * unvalidated one reads whatever the caller can spell, and this store sits in the user's home.
 */
const SNAPSHOT_ID = /^\d{8}T\d{9}Z-[0-9a-f]{12}$/;

export const isSnapshotId = (value) => typeof value === 'string' && SNAPSHOT_ID.test(value);

/** What was about to happen. Named by this app, about its own routes; no engine vocabulary here. */
export const OPERATIONS = Object.freeze(['create', 'update', 'remove']);

export class SnapshotFailedError extends Error {
	constructor(message, { directory = null, cause = null } = {}) {
		super(message, cause ? { cause } : undefined);
		this.name = 'SnapshotFailedError';
		this.kind = 'snapshot-failed';
		this.directory = directory;
	}
}

// ---------------------------------------------------------------------------------------------
// Where the store goes
// ---------------------------------------------------------------------------------------------

/**
 * This app's state directory, by the platform's own convention.
 *
 * State rather than cache: a cache directory is one the operating system is entitled to empty
 * without asking, and the one thing this store must not do is disappear between the write it
 * guarded and the moment somebody goes looking for it.
 *
 * The environment override exists so a test — and a user with an opinion — can put it somewhere
 * else. It is read here and nowhere else.
 */
export function resolveStateDirectory(env = process.env, platform = process.platform) {
	const named = env.KALEIDOSCOPE_UI_STATE_DIR;
	if (typeof named === 'string' && named.trim().length > 0) return resolve(named);

	const home = (() => {
		try {
			return homedir();
		} catch {
			return null;
		}
	})();

	if (platform === 'darwin' && home) {
		return join(home, 'Library', 'Application Support', 'kaleidoscope-ui');
	}
	if (platform === 'win32') {
		const local = env.LOCALAPPDATA;
		if (typeof local === 'string' && local.length > 0) return join(local, 'kaleidoscope-ui');
	}
	const xdg = env.XDG_STATE_HOME;
	if (typeof xdg === 'string' && xdg.trim().length > 0) return join(resolve(xdg), 'kaleidoscope-ui');
	if (home) return join(home, '.local', 'state', 'kaleidoscope-ui');

	// No home to put it under. A temporary directory is a poor place for a safety net and it is
	// still better than refusing to launch, so it is used and it is REPORTED — `/api/snapshots`
	// publishes the directory, so "my snapshots keep vanishing" is answerable.
	return join(tmpdir(), 'kaleidoscope-ui');
}

/**
 * The key for one vault's store.
 *
 * A digest rather than the path, for two reasons that both matter: a directory named after a path
 * is a listing of where people keep their memory, readable by anything that can see the home
 * directory; and a path is not a bounded filename. The workspace is in the digest because one root
 * can hold more than one workspace, and two workspaces are two vaults for every purpose this app
 * has.
 */
export function vaultKey({ root, workspace_id } = {}) {
	const hasRoot = typeof root === 'string' && root.length > 0;
	const hasWorkspace = typeof workspace_id === 'string' && workspace_id.length > 0;
	if (!hasRoot && !hasWorkspace) {
		throw new SnapshotFailedError(
			'No vault identity was resolved, so a snapshot store cannot be keyed to one. Refusing ' +
				'to write snapshots into a shared directory where two vaults would mix.',
		);
	}
	return createHash('sha256')
		.update(`${root ?? ''} ${workspace_id ?? ''}`)
		.digest('hex')
		.slice(0, 16);
}

const digestOf = (text) => createHash('sha256').update(text).digest('hex');

function mintSnapshotId(now = new Date()) {
	// `20260901T142233123Z` — the ISO string with its separators removed, which sorts the same way
	// the timestamp does, so a plain sort of the filenames is a sort by time.
	const stamp = now.toISOString().replace(/[-:.]/g, '').replace(/Z$/, '');
	return `${stamp}Z-${randomBytes(6).toString('hex')}`;
}

// ---------------------------------------------------------------------------------------------
// Retention, as arithmetic
// ---------------------------------------------------------------------------------------------

/**
 * Which snapshots survive and which are pruned. A PURE FUNCTION over the headers.
 *
 * It is pure because it is the part of this module that decides what is destroyed, and a property
 * you can only check by filling a directory is a property nobody checks twice. Ordering,
 * tie-breaking and the interaction of the two bounds are all decided here and asserted directly.
 *
 * The order is total: `snapshot_id` carries the timestamp and then a random tail, so the same store
 * prunes the same way twice.
 *
 * @param {Array<{snapshot_id: string, memory_id: string|null}>} headers
 * @param {{per_memory: number, per_vault: number}} bounds
 * @returns {{keep: string[], prune: string[], reasons: Record<string, 'per_memory'|'per_vault'>}}
 */
export function applyRetention(headers, bounds = RETENTION) {
	const perMemory = Math.max(0, bounds?.per_memory ?? RETENTION.per_memory);
	const perVault = Math.max(0, bounds?.per_vault ?? RETENTION.per_vault);

	// Newest first. `snapshot_id` begins with the timestamp, so this is chronological.
	const newestFirst = [...headers].sort((a, b) => (a.snapshot_id < b.snapshot_id ? 1 : -1));

	const reasons = {};
	const seen = new Map();
	const survivedPerMemory = [];

	for (const header of newestFirst) {
		// A create has no memory to key on. Each one is its own group, so a run of creates never
		// evicts the other creates' records under a bound that was written about one memory.
		const key = header.memory_id ?? ` create:${header.snapshot_id}`;
		const count = (seen.get(key) ?? 0) + 1;
		seen.set(key, count);
		if (count > perMemory) {
			reasons[header.snapshot_id] = 'per_memory';
			continue;
		}
		survivedPerMemory.push(header);
	}

	const keep = [];
	for (const [index, header] of survivedPerMemory.entries()) {
		if (index < perVault) keep.push(header.snapshot_id);
		else reasons[header.snapshot_id] = 'per_vault';
	}

	return { keep, prune: Object.keys(reasons).sort(), reasons };
}

// ---------------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------------

/**
 * Open the snapshot store for one vault.
 *
 * @param {object} deps
 * @param {object} deps.vault        the resolved vault reading — `{root, workspace_id}`
 * @param {(memoryId: string) => Promise<object>} deps.exportMemory  the export door, injected so
 *        this module spawns nothing itself and a test can drive its failure path without having to
 *        break an engine
 * @param {string} [deps.directory]  the store root; resolved from the platform when absent
 * @param {object} [deps.retention]
 * @param {string|null} [deps.engineVersion]
 */
export function createSnapshotStore({
	vault,
	exportMemory,
	directory,
	retention = RETENTION,
	engineVersion = null,
}) {
	if (typeof exportMemory !== 'function') {
		throw new TypeError('the snapshot store needs the export door to take a snapshot with');
	}

	const stateRoot = directory ? resolve(directory) : resolveStateDirectory();
	const key = vaultKey(vault ?? {});
	const dir = join(stateRoot, 'snapshots', key);

	const headerPath = (id) => join(dir, `${id}${HEADER_SUFFIX}`);
	const payloadPath = (id) => join(dir, `${id}${PAYLOAD_SUFFIX}`);

	/** Write a file so that it either exists complete or does not exist. */
	async function writeAtomic(path, text) {
		const temporary = `${path}.${randomBytes(6).toString('hex')}.partial`;
		const handle = await open(temporary, 'wx');
		try {
			await handle.writeFile(text, 'utf8');
			// Durability of the bytes themselves. The DIRECTORY entry is not fsynced, so a machine
			// that loses power in the millisecond after the rename can come back without the entry.
			// Said plainly rather than implied: this store survives a crashed process, which is what
			// it is for, and it is not a guarantee against a power cut.
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, path);
	}

	/** Every header in the store, parsed. Reads the small files only. */
	async function readHeaders() {
		let entries;
		try {
			entries = await readdir(dir);
		} catch (error) {
			// A store that has never been written to is empty, not broken.
			if (error?.code === 'ENOENT') return { headers: [], unreadable: [] };
			throw new SnapshotFailedError(
				`The snapshot store at ${dir} could not be listed: ${error.message}`,
				{ directory: dir, cause: error },
			);
		}

		const headers = [];
		const unreadable = [];
		for (const entry of entries) {
			if (!entry.endsWith(HEADER_SUFFIX)) continue;
			const id = entry.slice(0, -HEADER_SUFFIX.length);
			if (!isSnapshotId(id)) {
				unreadable.push({ file: entry, why: 'the name is not a snapshot id' });
				continue;
			}
			try {
				headers.push(JSON.parse(await readFile(headerPath(id), 'utf8')));
			} catch (error) {
				// Reported rather than dropped. A header this app cannot parse is a snapshot the
				// user has and cannot see, and a listing that silently omitted it would be a
				// smaller number presented as the truth.
				unreadable.push({ file: entry, why: error.message });
			}
		}
		headers.sort((a, b) => (a.snapshot_id < b.snapshot_id ? 1 : -1));
		return { headers, unreadable };
	}

	/** Delete one snapshot: header first, so a surviving header never names a missing payload. */
	async function destroy(id) {
		await rm(headerPath(id), { force: true });
		await rm(payloadPath(id), { force: true });
	}

	async function prune() {
		const { headers } = await readHeaders();
		const verdict = applyRetention(headers, retention);
		for (const id of verdict.prune) await destroy(id);
		return { pruned: verdict.prune, reasons: verdict.reasons, kept: verdict.keep.length };
	}

	return {
		directory: dir,
		state_directory: stateRoot,
		vault_key: key,
		retention,

		/**
		 * Take one snapshot, and refuse to return without having written it.
		 *
		 * @param {object} what
		 * @param {string|null} what.memory_id   null for a create — there is no prior state, and
		 *        recording the absence is what keeps "every write is preceded by a snapshot" a rule
		 *        with no exception a later reader has to remember
		 * @param {string|null} [what.version_id]  the version the memory was on
		 * @param {string} what.operation        one of OPERATIONS
		 * @param {string|null} [what.suppressed] a reason, when a snapshot must deliberately NOT
		 *        capture the bytes. PRD 0004 §3.3's escalation is the case: a snapshot there would
		 *        be a fresh plaintext copy of the secret the user is trying to get rid of, written
		 *        somewhere vault deletion will never find it. The record is still written, and it
		 *        says the bytes were not captured and why. The spine never skips silently.
		 */
		async take({ memory_id = null, version_id = null, operation, suppressed = null }) {
			if (!OPERATIONS.includes(operation)) {
				throw new SnapshotFailedError(
					`A snapshot must name what was about to happen. "${operation}" is not one of: ` +
						`${OPERATIONS.join(', ')}. Nothing was written.`,
					{ directory: dir },
				);
			}

			const snapshot_id = mintSnapshotId();
			const taken_at = new Date().toISOString();

			let payloadText = null;
			let captured = null;

			if (memory_id !== null && suppressed === null) {
				let taken;
				try {
					taken = await exportMemory(memory_id);
				} catch (error) {
					throw new SnapshotFailedError(
						`No snapshot could be taken of ${memory_id}, so the write was not attempted. ` +
							`The export door said: ${error.message}`,
						{ directory: dir, cause: error },
					);
				}

				const envelope = taken?.envelope ?? null;
				const records = envelope?.payload?.memories ?? [];
				if (!Array.isArray(records) || records.length === 0) {
					// The door answered and carried nothing. That is a refusal spelled as an answer,
					// and treating it as a snapshot would file an empty file under a memory's name.
					throw new SnapshotFailedError(
						`The export door returned no record for ${memory_id}, so there is nothing to ` +
							`keep a copy of and the write was not attempted. A memory that has already ` +
							`been removed is the usual reason.`,
						{ directory: dir },
					);
				}

				// THE ENGINE'S OWN BYTES, NEVER A RE-SERIALISATION.
				//
				// The envelope carries a digest over the payload as the engine wrote it, and the
				// import door checks that digest. A JSON round trip through this runtime does not
				// preserve those bytes — `0.0` comes back as `0` — so a snapshot this app had
				// parsed and re-emitted would be refused with `memory export payload digest does
				// not match`, which is the one thing that would make the file useless at the moment
				// somebody finally needed it. Measured, and asserted in `test/restore.test.mjs`.
				payloadText = taken.text;
				if (typeof payloadText !== 'string' || payloadText.length === 0) {
					throw new SnapshotFailedError(
						`The export door returned a record for ${memory_id} and none of the engine's ` +
							`own bytes, so the only copy this store could keep would be one this app ` +
							`re-serialised — which the import door refuses on its digest. The write ` +
							`was not attempted.`,
						{ directory: dir },
					);
				}
				captured = {
					records: records.length,
					// The engine's own digest of the payload it produced, carried unchanged. It is
					// the only way to check these bytes against the engine rather than against us.
					engine_payload_sha256: envelope?.payload_sha256 ?? null,
					export_kind: envelope?.export_kind ?? null,
					schema_version: envelope?.schema_version ?? null,
				};
			}

			const header = {
				store_version: STORE_VERSION,
				snapshot_id,
				taken_at,
				// What was about to happen, in this app's own words. A snapshot with no operation is
				// a file with a date on it.
				operation,
				memory_id,
				version_id,
				// What state the memory was in when this was taken, said in three values rather than
				// left to be inferred from whether a payload file exists.
				prior: suppressed !== null ? 'not-captured' : memory_id === null ? 'absent' : 'captured',
				suppressed_reason: suppressed,
				payload_file: payloadText === null ? null : `${snapshot_id}${PAYLOAD_SUFFIX}`,
				payload_bytes: payloadText === null ? 0 : Buffer.byteLength(payloadText),
				payload_sha256: payloadText === null ? null : digestOf(payloadText),
				captured,
				engine_version: engineVersion,
				vault: { workspace_id: vault?.workspace_id ?? null },
				// Written INTO the file, so a snapshot copied out of this store still says what it
				// is and what it is not. See docs/RESTORE-EXPERIMENT.md.
				restorable: false,
				note:
					'This is a copy, not an undo. No published operation returns a removed or ' +
					'overwritten memory to service in the vault it came from; see ' +
					'docs/RESTORE-EXPERIMENT.md. Keep this file, read it, or hand it to a person.',
			};

			try {
				await mkdir(dir, { recursive: true });
				// PAYLOAD FIRST. A header always implies a complete payload; see the note at the top.
				if (payloadText !== null) await writeAtomic(payloadPath(snapshot_id), payloadText);
				await writeAtomic(headerPath(snapshot_id), JSON.stringify(header, null, 2));
			} catch (error) {
				if (payloadText !== null) {
					await rm(payloadPath(snapshot_id), { force: true }).catch(() => {});
				}
				throw new SnapshotFailedError(
					`The snapshot could not be written to ${dir}, so the write was not attempted and ` +
						`your vault was not changed: ${error.message}`,
					{ directory: dir, cause: error },
				);
			}

			// Pruning happens after the snapshot is safely on disk, and its failure does not fail
			// the write: a store one over its bound is a tidiness problem, and refusing the user's
			// edit over one would be the tail wagging the dog.
			let pruning;
			try {
				pruning = { ...(await prune()), error: null };
			} catch (error) {
				pruning = { pruned: [], reasons: {}, kept: null, error: error.message };
			}

			return { ...header, directory: dir, pruning };
		},

		/** Every snapshot in this vault's store, newest first. Headers only; no payload is read. */
		async list({ memory_id = null } = {}) {
			const { headers, unreadable } = await readHeaders();
			const selected =
				memory_id === null ? headers : headers.filter((h) => h.memory_id === memory_id);
			return {
				directory: dir,
				state_directory: stateRoot,
				vault_key: key,
				store_version: STORE_VERSION,
				retention,
				// Three numbers rather than one: what the store holds, what this filter matched, and
				// what could not be read. A listing that reported only the second would tell a user
				// their store is the size of one memory's history.
				stored: headers.length,
				matched: selected.length,
				unreadable,
				// The finding, on the door itself, so no screen has to remember to say it.
				restore_available: false,
				restore_note:
					'These are copies. Removal and overwriting are one-way: no published operation ' +
					'returns a memory to service in the vault it left. A snapshot can be read and ' +
					'saved to a file — see docs/RESTORE-EXPERIMENT.md.',
				snapshots: selected,
			};
		},

		/**
		 * One snapshot, whole — the header, and the export payload it names AS TEXT.
		 *
		 * Text rather than a parsed object, all the way to the browser, for the reason `take()`
		 * kept the bytes in the first place: the engine signs its own serialisation, and anything
		 * that parses and re-emits this payload produces a file the import door refuses. A JSON
		 * string survives `JSON.stringify` and `JSON.parse` unchanged, so the bytes reach a `Blob`
		 * on the page exactly as the engine wrote them, and the file a person saves is the file
		 * the engine would accept.
		 *
		 * A screen that wants to READ the record parses this string itself. That is one line there
		 * and the only place where a parsed copy exists.
		 */
		async read(snapshotId) {
			if (!isSnapshotId(snapshotId)) {
				// Refused before anything is joined to a path, and refused as not-found rather than
				// as malformed: a caller probing this route learns nothing about the store's shape
				// from the difference.
				return null;
			}

			let header;
			try {
				header = JSON.parse(await readFile(headerPath(snapshotId), 'utf8'));
			} catch (error) {
				if (error?.code === 'ENOENT') return null;
				throw new SnapshotFailedError(
					`Snapshot ${snapshotId} is in the store and could not be read: ${error.message}`,
					{ directory: dir, cause: error },
				);
			}

			if (header.payload_file === null) return { ...header, directory: dir, export_json: null };

			let text;
			try {
				text = await readFile(payloadPath(snapshotId), 'utf8');
			} catch (error) {
				throw new SnapshotFailedError(
					`Snapshot ${snapshotId} names a payload this store cannot read: ${error.message}. ` +
						`The header survived and the bytes did not, which is the one direction this ` +
						`store's write order was designed to make impossible — treat it as damage.`,
					{ directory: dir, cause: error },
				);
			}

			const digest = digestOf(text);
			if (digest !== header.payload_sha256) {
				// Checked rather than trusted. Serving bytes that do not match the header would be
				// this module telling the user it kept something it did not keep.
				throw new SnapshotFailedError(
					`Snapshot ${snapshotId} does not match its own digest. The header says ` +
						`${header.payload_sha256} and the file on disk is ${digest}. Nothing is served ` +
						`from a snapshot that cannot prove it is the one that was taken.`,
					{ directory: dir },
				);
			}

			return { ...header, directory: dir, export_json: text };
		},

		/** Enforce retention now. Exposed so a test can drive it without taking a snapshot. */
		prune,

		/** Whether the store's directory exists yet. A read never creates it. */
		async exists() {
			try {
				return (await stat(dir)).isDirectory();
			} catch {
				return false;
			}
		},

		/**
		 * Is this store inside the vault it snapshots? It must never be, and the check is a function
		 * rather than a comment because both paths are resolved at runtime.
		 */
		async insideVault(root = vault?.root) {
			if (typeof root !== 'string' || root.length === 0) return false;
			const real = async (path) => {
				try {
					return await realpath(path);
				} catch {
					return resolve(path);
				}
			};
			const [a, b] = await Promise.all([real(dir), real(root)]);
			return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
		},
	};
}
