/**
 * WHICH VAULTS THE ENGINE SAYS EXIST. Three readings, taken once, and nothing derived from them.
 *
 * The picker offers what the engine reports. That sentence is the whole design, and it costs three
 * child processes:
 *
 *   `kscope where`                 in the directory the app was started in — the vault the engine
 *                                  would open on its own, which is the default and stays the default
 *   `kscope profile list`          every named pointer the engine already holds
 *   `kscope where` from $HOME      what the engine resolves when no project decides it — offered
 *                                  only if the engine says a vault is there
 *
 * THE HOME DIRECTORY IS A PLACE TO STAND, NOT A PATH THIS APP CLAIMS. It is handed to the engine as
 * a working directory and the engine answers with a root, exactly as it does for the first reading.
 * The alternative — joining `$HOME` to the conventional directory name ourselves — is a second
 * resolver: it would offer a path on a machine where the engine resolves something else, and the
 * user would open a vault the engine has never heard of.
 *
 * ALL THREE ARE ALLOWED TO REFUSE, and a refusal is carried verbatim rather than turned into
 * silence. "That directory is not a vault" and "one stale profile has wedged the store" are both
 * ordinary, both correctable, and both already say what to do in the engine's own words.
 */

import { homedir } from 'node:os';

import { run } from './call.mjs';
import { offeredVaults } from '../shared/vaults.mjs';

/** These are three single reads with no vault work behind them; the default 10 s is generous. */
const READING_TIMEOUT_MS = 10_000;

/**
 * One reading, reduced to "what it said" or "why it would not say".
 *
 * A non-zero exit is a refusal, and so is a zero exit whose body is not the JSON this client reads
 * it as — the second is rarer and worse, and folding it into `null` would leave the picker quietly
 * short of an option with nothing on screen to explain the absence.
 */
async function reading(args, options) {
	try {
		const raw = await run(args, { ...options, timeoutMs: options.timeoutMs ?? READING_TIMEOUT_MS });
		if (raw.exitCode !== 0) {
			return { value: null, refusal: (raw.stderr || raw.stdout).trim() || `kscope ${args.join(' ')} exited ${raw.exitCode}.` };
		}
		try {
			return { value: JSON.parse(raw.stdout), refusal: null };
		} catch {
			return {
				value: null,
				refusal:
					`\`kscope ${args.join(' ')}\` exited 0 and printed something that is not the JSON ` +
					`this app reads it as. It printed:\n\n${raw.stdout.trim().slice(0, 400)}`,
			};
		}
	} catch (error) {
		// A licensing stop, a timeout, a child that could not be spawned. Each already carries a
		// message written for a person; nothing is added around it.
		return { value: null, refusal: String(error?.message ?? error) };
	}
}

/**
 * Take the three readings.
 *
 * @param {object} options
 * @param {string} options.enginePath  the canonical path from `locateEngine`
 * @param {string} [options.cwd]       where the app was started; defaults to this process's own
 * @param {string} [options.home]      where to stand for the global reading; defaults to the OS's
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} the shape `offeredVaults` reads, and the raw bodies beside it
 *
 * TAKEN ONCE AND CARRIED. A switch restarts the sidecar with a root pinned, and a reading taken
 * after that would resolve THAT vault as "where the app was started" — the default would follow the
 * user around instead of naming where they came in. So the launcher takes these before the first
 * server starts and hands the same set to every server after it.
 */
export async function readVaultOfferings({ enginePath, cwd, home, timeoutMs } = {}) {
	const where = { enginePath, timeoutMs };
	const startedIn = cwd ?? process.cwd();
	const outside = home ?? homedir();

	const [started, profiles, global] = await Promise.all([
		reading(['where'], { ...where, cwd: startedIn }),
		reading(['profile', 'list'], where),
		// Skipped entirely when the app was started in the home directory: the answer would be the
		// first reading again, and a second spawn to learn nothing is a second spawn.
		startedIn === outside
			? Promise.resolve({ value: null, refusal: null })
			: reading(['where'], { ...where, cwd: outside }),
	]);

	return {
		started: { where: started.value, refusal: started.refusal },
		profiles: { list: profiles.value, refusal: profiles.refusal },
		global: { where: global.value, refusal: global.refusal },
		// What was asked, so a reader of the JSON can see that neither directory was invented.
		looked: { started_in: startedIn, outside_any_project: outside },
	};
}

/**
 * The offer, and the lookup that turns a key back into a root.
 *
 * Built here rather than in the browser because the key→root direction must never leave this
 * process: the page names one of the things it was offered and the process that read the engine
 * decides what that means. Every endpoint refuses a `root`, `vault`, `path` or `profile` parameter,
 * and this is what lets a switch exist without weakening that.
 *
 * @param {object} reported  what `readVaultOfferings` returned
 * @param {string|null} current  the root this app currently has open
 */
export function buildOffer(reported, current = null) {
	const { offers, refusals } = offeredVaults({ ...reported, current });
	const byKey = new Map(offers.map((offer) => [offer.key, offer]));
	return {
		offers,
		refusals,
		looked: reported?.looked ?? null,
		/** @returns {object|null} the offer, or null — never a root assembled from the key. */
		resolve: (key) => byKey.get(String(key ?? '')) ?? null,
	};
}
