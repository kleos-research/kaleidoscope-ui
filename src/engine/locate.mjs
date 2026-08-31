/**
 * Where the engine is.
 *
 * This order is not invented here and must not be improved here. Other published clients locate the
 * same program, and two clients that disagree about where the engine is are two clients that behave
 * differently on the same machine — which the user experiences as one of them being broken.
 */

import { constants as fsConstants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_ENV_VAR, EngineNotFoundError, PROGRAM } from './errors.mjs';

/**
 * Canonicalise first, then check, then hand back the canonical path as the thing to execute.
 *
 * `npm install -g` installs every bin entry as a symlink, so a client that refuses symlinks
 * refuses the documented install channel. But a client that checks the link and then runs the link
 * has never described what it actually ran — and "it found something else" is the failure that
 * cannot be debugged from outside. So: realpath, then stat, then X_OK, and return the realpath.
 */
async function inspect(candidate) {
	let canonical;
	try {
		canonical = await realpath(candidate);
	} catch (error) {
		return { ok: false, reason: error.code === 'ENOENT' ? 'no such file' : error.message };
	}

	try {
		const stats = await stat(canonical);
		if (!stats.isFile()) return { ok: false, canonical, reason: 'not a regular file' };
	} catch (error) {
		return { ok: false, canonical, reason: error.message };
	}

	try {
		await access(canonical, fsConstants.X_OK);
	} catch {
		return { ok: false, canonical, reason: 'not executable by this user' };
	}

	return { ok: true, canonical };
}

/**
 * Step 3 in three parts. The published order names "the directory this client installs its own
 * executables into", which for Node is more than one place depending on how the two programs were
 * installed: side by side under one project, or globally beside the running script or runtime. All
 * three are searched here so an install that has both the UI and the engine works without anyone
 * touching PATH, and each is reported separately so the not-found message stays honest about which
 * ones were actually read.
 */
function packageDirectories() {
	const here = dirname(fileURLToPath(import.meta.url));
	const packageRoot = resolve(here, '..', '..');
	const places = [
		{ dir: join(packageRoot, 'node_modules', '.bin'), note: "this package's own bin directory" },
	];

	if (process.argv[1]) {
		places.push({ dir: dirname(resolve(process.argv[1])), note: 'beside the script running this' });
	}
	places.push({ dir: dirname(process.execPath), note: 'beside the Node running this' });

	const seen = new Set();
	return places.filter((place) => !seen.has(place.dir) && seen.add(place.dir));
}

/**
 * Locate the engine.
 *
 * @param {object}  [options]
 * @param {string}  [options.explicit]  a path passed by the caller, e.g. from `--kscope`
 * @param {object}  [options.env]       the environment to read; defaults to this process's
 * @returns {Promise<{path: string, source: string, canonical: string, found: string, directory: string|null, looked: Array<object>}>}
 *
 * `path` and `canonical` are the same string: the canonical, executable path, which is what must be
 * spawned. `found` is the candidate before symlinks were followed, and exists only so the launcher
 * can show the user both — the path they configured and the program it actually reaches.
 *
 * @throws {EngineNotFoundError}
 */
export async function locateEngine({ explicit, env = process.env } = {}) {
	const looked = [];

	// Steps 1 and 2 are AUTHORITATIVE and TERMINAL. A caller who named a path and got it wrong is
	// told exactly that. The search must never fall through and serve a different program.
	const named = [
		explicit ? { path: explicit, namedBy: `--${PROGRAM}`, source: 'explicit' } : null,
		// Set-but-empty is not a choice, it is an unset variable spelled with an `=`.
		env[ENGINE_ENV_VAR]?.trim()
			? { path: env[ENGINE_ENV_VAR].trim(), namedBy: ENGINE_ENV_VAR, source: ENGINE_ENV_VAR }
			: null,
	].filter(Boolean)[0];

	if (named) {
		const verdict = await inspect(named.path);
		looked.push(
			named.source === 'explicit'
				? { kind: 'explicit', path: named.path, reason: verdict.ok ? null : verdict.reason }
				: {
						kind: 'env',
						name: ENGINE_ENV_VAR,
						value: named.path,
						reason: verdict.ok ? null : verdict.reason,
					},
		);
		if (verdict.ok) {
			return {
				path: verdict.canonical,
				canonical: verdict.canonical,
				found: named.path,
				source: named.source,
				directory: dirname(verdict.canonical),
				looked,
			};
		}
		throw new EngineNotFoundError({
			kind: 'named-unusable',
			looked,
			path: named.path,
			namedBy: named.namedBy,
			reason: verdict.reason,
		});
	}

	// Reaching here means neither step 1 nor step 2 named anything. Record the setting anyway, so the
	// message can say it was consulted and was empty rather than leaving the user to wonder.
	looked.push({ kind: 'env', name: ENGINE_ENV_VAR, value: null, reason: 'not set' });

	const searched = [
		...packageDirectories().map((place) => ({ kind: 'package', ...place })),
		...(env.PATH ?? '')
			.split(delimiter)
			.filter(Boolean)
			.map((dir) => ({ kind: 'path', dir })),
	];

	for (const place of searched) {
		const verdict = await inspect(join(place.dir, PROGRAM));
		looked.push({ ...place, reason: verdict.ok ? null : verdict.reason });
		if (verdict.ok) {
			return {
				path: verdict.canonical,
				canonical: verdict.canonical,
				found: join(place.dir, PROGRAM),
				source: place.kind === 'package' ? 'package' : 'PATH',
				directory: place.dir,
				looked,
			};
		}
	}

	throw new EngineNotFoundError({ kind: 'nothing-found', looked });
}
