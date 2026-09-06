/**
 * WHICH VAULTS MAY BE OFFERED, AND THE RULE THAT NONE OF THEM WAS INVENTED HERE.
 *
 * The engine decides which vault it opens. It reads `KSCOPE_ROOT`, then `.kaleidoscope/` under the
 * repository's main checkout, then a project marker, then the working directory — and it refuses a
 * resolved root that is not a vault rather than creating one. A picker that computed any of that a
 * second time would be a second resolver, and two resolvers that disagree are experienced as one
 * of them being broken: the user picks "the project vault" and gets a different set of memories.
 *
 * So this module NEVER constructs a path. Every root below arrived in the bytes of `kscope where`
 * or `kscope profile list`, and every entry carries `from`, naming the reading it came out of.
 * `test/vault-picker.test.mjs` asserts that property mechanically — each offered root has to appear
 * verbatim in the JSON the engine printed — because "we did not build a path" is exactly the kind
 * of claim that stays true until someone adds one convenient `join`.
 *
 * It is pure, it imports nothing, and it lives in `shared/` because both sides need it: the sidecar
 * builds the offer from the readings it took, and the page renders that same offer without being
 * able to name a vault of its own.
 *
 * WHAT IS DERIVED HERE IS A LABEL, NOT AN ADDRESS. The short name is for the chip in the bar and is
 * never sent anywhere: the browser asks to switch by `key`, and the key resolves back to a root
 * only inside the process that read it.
 */

/**
 * A vault the app may be pointed at, and the reading it came from.
 *
 * `started` is the vault resolved from the directory the app was launched in — the default, and the
 * one the engine would pick on its own. `profile` is a named pointer the engine already holds.
 * `global` is what the engine resolves outside any project, and it is offered only when the engine
 * says one is there.
 *
 * This array IS the order the picker shows, and the order is the argument: the default first
 * because it is what the user already has, the engine's own names next, and the one that belongs to
 * no project last.
 */
export const OFFER_KINDS = ['started', 'profile', 'global'];

/** A path is split on `/` and nothing else: these roots are absolute POSIX paths the engine printed. */
const segmentsOf = (root) => String(root).split('/').filter(Boolean);

/**
 * THE VAULT AS A SHORT NAME.
 *
 * "I don't know why we need to enter the entire folder path. It's too long."
 *
 * The last segment of the root, which is what a person calls the place their work lives. A root
 * ending in a dot-directory takes the segment above it, because `.kaleidoscope` names every vault
 * on the machine and therefore names none of them.
 *
 * The full path is never hidden — it is in the menu, on the row, in the mono face — so what this
 * removes is a path used as a headline, not the path.
 */
export function shortVaultName(root) {
	if (!root) return null;
	const parts = segmentsOf(root);
	if (parts.length === 0) return String(root);
	const last = parts[parts.length - 1];
	if (last.startsWith('.') && parts.length > 1) return parts[parts.length - 2];
	return last;
}

/**
 * The name at a given depth: one segment, then two, then three.
 *
 * `exhausted` says there is nothing further left to qualify with, which is what stops the loop
 * below from spinning on two roots that differ only in a part this rule cannot reach.
 */
function nameAtDepth(root, depth) {
	const parts = segmentsOf(root);
	if (parts.length === 0) return { name: String(root), exhausted: true };
	// The naming segment, and the dot-directory rule from `shortVaultName` applied once here so the
	// two cannot drift: qualification grows leftward FROM the name, never from `.kaleidoscope`.
	let end = parts.length;
	if (end > 1 && parts[end - 1].startsWith('.')) end -= 1;
	const start = Math.max(0, end - depth);
	return { name: parts.slice(start, end).join('/'), exhausted: start === 0 };
}

/**
 * TWO VAULTS WITH THE SAME SHORT NAME ARE DIFFERENT DIRECTORIES, AND THE CHIP HAS TO SAY SO.
 *
 * `~/work/kaleidoscope/.kaleidoscope` and `~/archive/kaleidoscope/.kaleidoscope` both shorten to
 * "kaleidoscope". Showing that name twice in one menu is worse than showing the paths: the reader
 * picks one, gets memories they do not recognise, and has no way to tell which of the two they are
 * now in — the chip would read the same either way.
 *
 * So a colliding name grows leftward one directory at a time until the set is distinct. Only the
 * colliding entries grow, so a vault with an unambiguous name keeps its one word.
 *
 * @param {string[]} roots
 * @returns {Map<string, string>} root → the name to show
 */
export function distinctNames(roots) {
	const unique = [...new Set(roots)];
	const depth = new Map(unique.map((root) => [root, 1]));

	// Bounded rather than `while (true)`: `exhausted` already stops it, and a belt on a loop that
	// runs over user paths costs nothing.
	for (let round = 0; round < 32; round += 1) {
		const groups = new Map();
		for (const root of unique) {
			const { name } = nameAtDepth(root, depth.get(root));
			if (!groups.has(name)) groups.set(name, []);
			groups.get(name).push(root);
		}

		let grew = false;
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			for (const root of group) {
				if (nameAtDepth(root, depth.get(root)).exhausted) continue;
				depth.set(root, depth.get(root) + 1);
				grew = true;
			}
		}
		if (!grew) break;
	}

	const names = new Map(unique.map((root) => [root, nameAtDepth(root, depth.get(root)).name]));

	// Anything still identical after the walk is two roots this rule cannot tell apart, and the
	// honest label for those is the whole path. Long and correct beats short and wrong: a reader
	// who cannot distinguish two entries cannot choose between them.
	const counts = new Map();
	for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
	for (const [root, name] of names) if (counts.get(name) > 1) names.set(root, String(root));
	return names;
}

/**
 * A stable, opaque handle for one root.
 *
 * The browser switches vaults by KEY, never by path: `RESERVED_PARAMETERS` in the sidecar refuses
 * `root`, `vault`, `path` and `profile` on every endpoint, and that refusal is the difference
 * between a memory browser and an arbitrary local-file reader. A key keeps the property while still
 * letting the page name one of the things it was offered.
 *
 * Two 32-bit FNV-1a passes with different offsets, because one is short enough that a collision is
 * imaginable and a collision here would mean switching to the wrong vault. `offeredVaults` also
 * asserts uniqueness across the set it builds, so the guarantee does not rest on the arithmetic.
 */
export function vaultKey(root) {
	const text = String(root);
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		a = Math.imul(a ^ code, 0x01000193) >>> 0;
		b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
	}
	return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Only a reading that actually carries a root is a vault; anything else is a refusal or nothing. */
const rootOf = (reading) => {
	const root = reading?.root;
	return typeof root === 'string' && root.length > 0 ? root : null;
};

/**
 * How the engine said it reached the started vault, as a phrase that reads in a sentence.
 *
 * `root_source` is the engine's own word for it and it is passed through rather than translated:
 * the engine prints the same word on stderr beside every call, and a picker that renamed it would
 * make the app and the terminal disagree about the same fact. Underscores become spaces and nothing
 * else changes.
 */
export const describeSource = (source) =>
	typeof source === 'string' && source ? source.replace(/_/g, ' ') : 'the engine';

/**
 * BUILD THE OFFER.
 *
 * @param {object} reported                what the engine printed, parsed, and nothing else
 * @param {object} [reported.started]      `{ where, refusal }` — `kscope where` where the app started
 * @param {object} [reported.profiles]     `{ list, refusal }` — `kscope profile list`
 * @param {object} [reported.global]       `{ where, refusal }` — `kscope where` outside any project
 * @param {string} [reported.current]      the root this app is open on, from its own readings
 * @returns {{offers: Array<object>, refusals: Array<{of: string, message: string}>}}
 *
 * A `refusal` is the engine's own text, verbatim. It is carried rather than rewritten because the
 * two that occur are both correctable by the user and both name the remedy in as many words — "is
 * not a vault (no manifest.json)", and a profile store one stale entry has wedged. A sentence
 * written here instead would be this app guessing at a machine it did not read.
 *
 * ONE ROOT IS ONE OFFER. A profile pointing at the vault the app already resolved is the same
 * directory, and listing it twice would ask the reader to choose between a thing and itself; the
 * name is recorded on the entry that is already there, as an alias, so nothing the engine said is
 * lost.
 */
export function offeredVaults({ started, profiles, global: globalReading, current = null } = {}) {
	const offers = [];
	const refusals = [];
	const byRoot = new Map();

	const add = (entry) => {
		const existing = byRoot.get(entry.root);
		if (existing) {
			// Same directory, second name for it. Recorded, never re-listed.
			if (entry.profile && !existing.aliases.includes(entry.profile)) {
				existing.aliases.push(entry.profile);
			}
			return existing;
		}
		byRoot.set(entry.root, entry);
		offers.push(entry);
		return entry;
	};

	const startedRoot = rootOf(started?.where);
	if (startedRoot) {
		add({
			kind: 'started',
			root: startedRoot,
			from: 'kscope where',
			// Where the ENGINE said this root came from, so the row can say "the vault this
			// directory resolves to" rather than implying the app chose it.
			source: started.where.root_source ?? null,
			repository: started.where.repository ?? null,
			workspace_id: started.where.workspace_id ?? null,
			profile: null,
			aliases: [],
			usable: true,
			unusable_because: null,
		});
	}
	if (started?.refusal) refusals.push({ of: 'started', message: started.refusal });

	for (const entry of profiles?.list?.entries ?? []) {
		const root = rootOf(entry?.profile);
		if (!root) continue;
		add({
			kind: 'profile',
			root,
			from: 'kscope profile list',
			source: null,
			repository: null,
			workspace_id: entry.profile.workspace_id ?? null,
			profile: entry.name ?? entry.profile.name ?? null,
			aliases: [],
			// The engine revalidates every profile against its vault on read and says so per entry.
			// An entry it has already called invalid is shown and NOT offered: hiding it would make
			// a profile the user knows they created look deleted.
			usable: entry.valid !== false,
			unusable_because:
				entry.valid === false ? 'The engine could not validate this profile against its vault.' : null,
		});
	}
	if (profiles?.refusal) refusals.push({ of: 'profiles', message: profiles.refusal });

	const globalRoot = rootOf(globalReading?.where);
	if (globalRoot) {
		add({
			kind: 'global',
			root: globalRoot,
			from: 'kscope where',
			source: globalReading.where.root_source ?? null,
			repository: globalReading.where.repository ?? null,
			workspace_id: globalReading.where.workspace_id ?? null,
			profile: null,
			aliases: [],
			usable: true,
			unusable_because: null,
		});
	}
	// A refused global reading is NOT reported as a problem: "there is no vault outside a project"
	// is the ordinary state of a machine, and a notice about it would be this app complaining that
	// the user has not made one. It is only an absence.

	const names = distinctNames(offers.map((offer) => offer.root));
	const keys = new Set();
	for (const offer of offers) {
		offer.name = names.get(offer.root);
		let key = vaultKey(offer.root);
		// Uniqueness is guaranteed here rather than assumed of the hash, because the consequence of
		// two offers sharing a key is opening the wrong vault — which looks like data loss.
		let suffix = 1;
		while (keys.has(key)) key = `${vaultKey(offer.root)}-${(suffix += 1)}`;
		keys.add(key);
		offer.key = key;
		offer.current = current !== null && offer.root === current;
	}

	return { offers, refusals };
}

/**
 * The offer the app is currently open on, or null.
 *
 * Null is a real state and not a bug: a vault named with `KSCOPE_ROOT` that the engine no longer
 * lists is still open and still readable, and the bar falls back to naming it from the readings.
 */
export const currentOffer = (offers = []) => offers.find((offer) => offer.current) ?? null;
