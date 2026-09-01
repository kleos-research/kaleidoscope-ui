/**
 * The half-finished merge, written to disk BEFORE the first call.
 *
 * A merge in this product is two writes with no transaction underneath them — the engine publishes
 * no operation that takes two memories and returns one — so the window between "the survivor now
 * holds both memories' content" and "the duplicate is gone" is a real state the vault can be left
 * in. It is not an exception path: a stale version on the second write is the ORDINARY outcome on a
 * vault an agent is writing to while a person is deciding.
 *
 * The state has to survive a crash, not merely an exception, or the recovery is a screen that only
 * exists while the process that needed it is still running. So this file is written before the
 * first call and cleared after the second, and a record found at launch is a half-finished merge
 * that a person has to resolve.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT HOLDS THE SURVIVOR'S PAYLOAD FROM BEFORE THE WRITE
 * ---------------------------------------------------------------------------------------------
 *
 * "Undo the merge" is only possible because of it. No published door returns a prior version of a
 * memory, so the only thing that can put the survivor back is a payload this app kept. Without it
 * the answer to a half-finished merge is the snapshot store, which is a file the user has to save
 * and hand back to an import door that refuses it — measured, and recorded in the restore
 * experiment. One record makes the common case a button instead.
 *
 * It lives beside the snapshot store and the dismissal file, keyed by the same digest over the
 * resolved root and the workspace id, for the same reasons: two vaults never share a file, and
 * `localStorage` is keyed by an origin that is a different port on most launches.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { resolveStateDirectory, vaultKey } from './snapshots.mjs';

export const STORE_VERSION = 1;

/**
 * The three states a merge can be found in, and there is no fourth.
 *
 * `pending` means nothing has been written and the record is the only thing that exists.
 * `survivor_written` is the state this whole file exists for: one write landed, one did not.
 * A merge that finished has no record at all — the absence IS the third state, and keeping a
 * `done` record would make "is there a half-finished merge?" a question about a field rather than
 * about whether a file exists.
 */
export const STATES = Object.freeze(['pending', 'survivor_written']);

export class PendingMergeError extends Error {
	constructor(message, { kind = 'pending-merge-store-failed', cause = null } = {}) {
		super(message, cause ? { cause } : undefined);
		this.name = 'PendingMergeError';
		this.kind = kind;
	}
}

/**
 * Open the pending-merge store for one vault.
 *
 * @param {object} deps
 * @param {object} deps.vault      the resolved vault reading — `{root, workspace_id}`
 * @param {string} [deps.directory] the state root; resolved from the platform when absent
 */
export function createPendingMergeStore({ vault, directory } = {}) {
	const stateRoot = directory ? resolve(directory) : resolveStateDirectory();
	const key = vaultKey(vault ?? {});
	const dir = join(stateRoot, 'pending-merges');
	const file = join(dir, `${key}.json`);

	/** Write so the file either exists complete or does not exist. A torn record is unreadable. */
	async function writeAtomic(body) {
		await mkdir(dir, { recursive: true });
		const temporary = `${file}.${randomBytes(6).toString('hex')}.partial`;
		const handle = await open(temporary, 'wx');
		try {
			await handle.writeFile(body, 'utf8');
			// Flushed before the rename. A record that reached the directory entry and not the disk
			// is exactly the record a crash would lose, and a crash is the case it is written for.
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, file);
	}

	/**
	 * The half-finished merge, or null.
	 *
	 * A missing file is null — the normal state. A file that is present and unparseable THROWS: a
	 * store that answered "nothing pending" over a record it could not read would take the banner
	 * off the screen at exactly the moment the user needed it, and the survivor would keep both
	 * memories' content with nothing on any screen saying so.
	 */
	async function read() {
		let raw;
		try {
			raw = await readFile(file, 'utf8');
		} catch (error) {
			if (error?.code === 'ENOENT') return null;
			throw new PendingMergeError(
				`This vault's half-finished-merge record at ${file} could not be read, so whether a ` +
					'merge is in flight is unknown. Nothing was changed.',
				{ kind: 'unreadable-store', cause: error },
			);
		}
		try {
			return JSON.parse(raw);
		} catch (cause) {
			throw new PendingMergeError(
				`This vault's half-finished-merge record at ${file} is not readable JSON. It has not ` +
					'been touched — move it aside once you have checked both memories by hand.',
				{ kind: 'corrupt-store', cause },
			);
		}
	}

	/**
	 * Record a merge that is about to start. CALLED BEFORE THE FIRST WRITE.
	 *
	 * It refuses to overwrite an existing record. Two merges in flight at once would leave one of
	 * them with no way back, and the second one's record would silently become the first one's
	 * epitaph.
	 */
	async function begin(record) {
		const held = await read();
		if (held) {
			throw new PendingMergeError(
				`A merge of ${held.duplicate_id} into ${held.survivor_id} is already half-finished ` +
					`(${held.state}). Finish or undo that one before starting another: two at once ` +
					'would leave one of them with no record to go back to. Nothing was written.',
				{ kind: 'merge-already-pending' },
			);
		}
		const started = {
			store_version: STORE_VERSION,
			started_at: new Date().toISOString(),
			state: 'pending',
			...record,
		};
		await writeAtomic(`${JSON.stringify(started, null, '\t')}\n`);
		return started;
	}

	/** Move the record to its next state. The write that lands between the two engine calls. */
	async function advance(state, extra = {}) {
		if (!STATES.includes(state)) {
			throw new PendingMergeError(`"${state}" is not one of: ${STATES.join(', ')}.`, {
				kind: 'unknown-state',
			});
		}
		const held = await read();
		if (!held) {
			throw new PendingMergeError('There is no half-finished merge to advance.', {
				kind: 'no-pending-merge',
			});
		}
		const next = { ...held, ...extra, state, advanced_at: new Date().toISOString() };
		await writeAtomic(`${JSON.stringify(next, null, '\t')}\n`);
		return next;
	}

	/** The merge finished. The record's ABSENCE is the third state; nothing is kept to say so. */
	async function clear() {
		try {
			await unlink(file);
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw new PendingMergeError(
					`The merge finished and its half-finished record at ${file} could not be removed, ` +
						'so this app will keep reporting a merge that is done. Both writes landed.',
					{ kind: 'clear-failed', cause: error },
				);
			}
		}
		return { outcome: 'cleared' };
	}

	return { directory: dir, file, vault_key: key, read, begin, advance, clear };
}
