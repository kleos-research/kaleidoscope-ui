/**
 * "These two really are different things" — kept beside the snapshot store, never in the vault.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT WRITTEN TO THE VAULT, AND WHY THE SCREEN SAYS SO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The store has no notion of "a person looked at these two names and decided they are not the same
 * thing". It can hold that two names ARE the same, or that they are NOT, through a resolver this
 * client cannot address, and no published operation writes either from here. So a dismissal has
 * exactly one honest home: this app's own state, and the screen says the words — *this only
 * changes what this app shows you.* Inventing a vault-side dismissal would be a mechanism that
 * reports a state nothing holds, which is the failure PRD 0006 §3.5 names outright.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHERE, AND WHY BESIDE THE SNAPSHOTS RATHER THAN IN THE BROWSER
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `<state>/dismissals/<vault key>.json`, a sibling of `<state>/snapshots/<vault key>/`, keyed by
 * the same digest over the resolved root and the workspace id. Two vaults never share a file, and
 * the file is not itself a listing of where somebody keeps their memory.
 *
 * `localStorage` was the cheaper option and it is the wrong one. It is keyed by ORIGIN, and this
 * app's origin is `127.0.0.1:<whatever port was free>` — so the same vault gets a different store
 * on most launches, and two different vaults opened on the same port share one. Dismissals would
 * appear to work in a session and be gone or wrong on the next, which is indistinguishable from
 * "the feature is broken" and is worse than not having it: a user who dismisses twelve pairs and
 * meets them again next week stops trusting every other count on the screen too.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It does not prune, expire, or bound itself by age. A dismissal is a decision a person made, and
 * a decision that quietly evaporated on a clock would be re-asked at exactly the moment they had
 * stopped expecting it. There IS a ceiling — see `MAX_DISMISSALS` — and it REFUSES rather than
 * dropping the oldest, because silently forgetting the answer you were given is the one behaviour
 * this file exists to prevent.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { resolveStateDirectory, vaultKey } from './snapshots.mjs';

/** The store format, so a later reader can tell a shape it understands from one it does not. */
export const STORE_VERSION = 1;

/**
 * The ceiling, and it refuses at the top rather than pruning at the bottom.
 *
 * The number is high enough that no real curation session reaches it — the development vault
 * produces about four hundred findings in total — and finite because this file is written by an
 * HTTP route and an unbounded file written by a route is a disk-filling loop waiting for a stuck
 * client. When it is hit the user is told, with the number, and nothing is lost.
 */
export const MAX_DISMISSALS = 10_000;

/** The longest key, label or reason this store will hold. A key is a joined list of names. */
const MAX_FIELD_BYTES = 4_000;

export class DismissalStoreError extends Error {
	constructor(message, { kind = 'dismissal-store-failed', cause = null } = {}) {
		super(message, cause ? { cause } : undefined);
		this.name = 'DismissalStoreError';
		this.kind = kind;
	}
}

const text = (value) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

/**
 * What this store will accept, checked here rather than at the route.
 *
 * The route reads a JSON body from a local browser, which is the same thing as saying the shapes
 * arriving here are whatever anything on this machine can post. Every field is bounded and every
 * unknown field is DROPPED rather than stored: a record this file did not shape is a record a later
 * reader would treat as one it wrote.
 */
export function normaliseRecord(input, { now = new Date() } = {}) {
	const key = text(input?.key);
	if (!key) {
		throw new DismissalStoreError(
			'A dismissal must carry the key of the finding it dismisses. Without one there is ' +
				'nothing to match against next time and nothing was stored.',
			{ kind: 'missing-key' },
		);
	}
	for (const [field, value] of [
		['key', key],
		['label', text(input?.label)],
		['reason', text(input?.reason)],
	]) {
		if (value !== null && Buffer.byteLength(value, 'utf8') > MAX_FIELD_BYTES) {
			throw new DismissalStoreError(
				`A dismissal's ${field} is longer than ${MAX_FIELD_BYTES.toLocaleString('en')} bytes. ` +
					'Nothing was stored.',
				{ kind: 'field-too-long' },
			);
		}
	}

	const names = Array.isArray(input?.names)
		? input.names.map((name) => text(name)).filter(Boolean).slice(0, 64)
		: [];

	return {
		key,
		kind: text(input?.kind),
		label: text(input?.label),
		names,
		reason: text(input?.reason),
		dismissed_at: now.toISOString(),
	};
}

/**
 * Open the dismissal store for one vault.
 *
 * @param {object} deps
 * @param {object} deps.vault      the resolved vault reading — `{root, workspace_id}`
 * @param {string} [deps.directory]  the state root; resolved from the platform when absent
 */
export function createDismissalStore({ vault, directory } = {}) {
	const stateRoot = directory ? resolve(directory) : resolveStateDirectory();
	const key = vaultKey(vault ?? {});
	const dir = join(stateRoot, 'dismissals');
	const file = join(dir, `${key}.json`);

	/** Write a file so that it either exists complete or does not exist at all. */
	async function writeAtomic(path, body) {
		await mkdir(dir, { recursive: true });
		const temporary = `${path}.${randomBytes(6).toString('hex')}.partial`;
		const handle = await open(temporary, 'wx');
		try {
			await handle.writeFile(body, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, path);
	}

	/**
	 * Everything dismissed for this vault.
	 *
	 * A store that has never been written to is EMPTY, not broken — the commonest state there is.
	 * A store that is present and unparseable is a different situation and it throws, because
	 * answering "you have dismissed nothing" over a file that holds a hundred decisions would put
	 * every one of them back on the screen with no indication that anything went wrong.
	 */
	async function list() {
		let raw;
		try {
			raw = await readFile(file, 'utf8');
		} catch (error) {
			if (error?.code === 'ENOENT') {
				return { store_version: STORE_VERSION, dismissals: [], directory: dir, vault_key: key };
			}
			throw new DismissalStoreError(
				`This vault's dismissal store at ${file} could not be read, so what you have already ` +
					'dismissed is unknown. Nothing was changed.',
				{ kind: 'unreadable-store', cause: error },
			);
		}

		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (cause) {
			throw new DismissalStoreError(
				`This vault's dismissal store at ${file} is not readable JSON. It has not been ` +
					'touched — move it aside to start a fresh one.',
				{ kind: 'corrupt-store', cause },
			);
		}

		const dismissals = Array.isArray(parsed?.dismissals) ? parsed.dismissals : [];
		return {
			store_version: parsed?.store_version ?? null,
			// Newest first: the review screen's first question is "what did I just hide?".
			dismissals: [...dismissals].sort((a, b) =>
				String(b?.dismissed_at ?? '').localeCompare(String(a?.dismissed_at ?? '')),
			),
			directory: dir,
			vault_key: key,
		};
	}

	async function save(dismissals) {
		await writeAtomic(
			file,
			`${JSON.stringify(
				{
					store_version: STORE_VERSION,
					vault_key: key,
					updated_at: new Date().toISOString(),
					dismissals,
				},
				null,
				'\t',
			)}\n`,
		);
	}

	/**
	 * Dismiss one finding. Re-dismissing an already-dismissed key REPLACES the record rather than
	 * adding a second, so the file cannot grow by clicking the same button twice.
	 */
	async function dismiss(input, { now = new Date() } = {}) {
		const record = normaliseRecord(input, { now });
		const current = await list();
		const rest = current.dismissals.filter((entry) => entry?.key !== record.key);
		if (rest.length >= MAX_DISMISSALS) {
			throw new DismissalStoreError(
				`This vault's dismissal store already holds ${rest.length.toLocaleString('en')} ` +
					`entries, which is the ceiling. Nothing was stored, and nothing already stored was ` +
					`removed — the file is at ${file} if you want to prune it by hand.`,
				{ kind: 'store-full' },
			);
		}
		await save([record, ...rest]);
		return { outcome: 'dismissed', record, count: rest.length + 1 };
	}

	/** Put one back on the list. The inverse of `dismiss`, and the reason review is safe. */
	async function restore(dismissalKey) {
		const target = text(dismissalKey);
		if (!target) {
			throw new DismissalStoreError('Restoring a dismissal needs the key of the one to restore.', {
				kind: 'missing-key',
			});
		}
		const current = await list();
		const rest = current.dismissals.filter((entry) => entry?.key !== target);
		// Reported rather than silently succeeding: "restored" over a key that was not there means
		// the screen and the store disagree about what is dismissed, and the screen wins forever.
		const found = rest.length !== current.dismissals.length;
		if (found) await save(rest);
		return { outcome: found ? 'restored' : 'not-dismissed', key: target, count: rest.length };
	}

	return { directory: dir, file, vault_key: key, list, dismiss, restore };
}
