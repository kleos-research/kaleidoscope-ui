/**
 * Which engine this build has actually been tested against, and what to do when it meets another.
 *
 * THIS IS THE MODULE THAT EXISTS BECAUSE THE VERSION STRING IS NOT ENOUGH. Every vocabulary in this
 * product is read from the engine at run time — memory types, entity kinds, relation names, the
 * qualifier scales, the request-byte ceiling — and it is read by PARSING the text the engine prints.
 * A parser written against one layout does not fail against a different one. It yields FEWER values.
 * The user then sees a dropdown missing entries and, helpfully, types a new one, minting fresh
 * vocabulary where a good value already existed — which is exactly the failure that reading the
 * vocabulary at run time exists to prevent, arriving through the back door.
 *
 * Two builds one patch apart can print that text differently while the version string stands still,
 * so the version string cannot be the gate. The gate is `sha256` of the raw bytes of the write
 * contract, which is a fingerprint of the thing that is actually being parsed. The version is
 * displayed and gates nothing.
 *
 * Three tiers, and the app is always in exactly one:
 *
 *   C  the digest is one this build ships a tested parser for. Everything works, and the parse is
 *      keyed by the digest, so upgrading the engine invalidates it automatically.
 *   B  the digest is unknown. Reads stay fully functional and writes stay ALLOWED — the engine's
 *      own refusals are correctable and name the field to fix — but nothing parsed out of the
 *      contract is presented as verified: every closed-value control becomes free text with what
 *      could still be extracted offered as a hint, under a banner naming both digests.
 *   A  something structural is wrong: an unrecognised schema version, or an operation this app
 *      needs that the engine does not have or has retired. Reads still render, every write is
 *      refused, and nothing is guessed.
 *
 * IT NEVER FALLS BACK TO A BUNDLED VOCABULARY. Substituting a transcription for a failed parse is
 * the failure the whole runtime-read design exists to prevent, and it would arrive at exactly the
 * moment nobody could check it.
 *
 * This module is a PURE FUNCTION of the readings. It spawns nothing, reads no file and holds no
 * state, so the ladder can be driven from a perturbed fixture in a test — which is the only way a
 * tier machine gets to be a mechanism rather than a diagram.
 */

/**
 * The write-contract digests this build has a tested parser for.
 *
 * A digest is DATA about a published artefact — `sha256` over what `kscope schema remember` prints
 * — and not a transcribed vocabulary: it names nothing, it cannot be used to fill a control, and a
 * stale entry fails SAFE, because an engine whose contract has moved no longer matches and the app
 * drops to Tier B rather than parsing confidently against a layout that changed.
 *
 * Measured, not assumed: this digest is identical across a freshly created vault, a six-memory
 * synthetic one and a clone of a three-hundred-memory real one, which is what makes it a property
 * of the engine build rather than of the vault it was pointed at.
 */
export const TESTED_CONTRACTS = [
	{
		digest: '2f12d07e0e4802951d87e98f0cd778598eb731175baf6e72b3ebbbd2a9470550',
		engine: 'kscope 0.0.5',
		tested_on: '2026-09-01',
	},
	/*
	  The same version string, a different contract. `/opt/homebrew/bin/kscope` was replaced under
	  the tree on 2026-09-05 by a build that still prints 0.0.5 and prints its write contract
	  differently — which is the case the version string cannot see and the digest can. The parser
	  was re-run against it: twelve entity kinds, the predicate list, the memory types and the
	  request ceiling all come out, and the whole suite passes on a clone through it.
	*/
	{
		digest: '62005f249bb0902e0cdd401df1f144d0578515dded59e3a5ded1204feb805b96',
		engine: 'kscope 0.0.5',
		tested_on: '2026-09-05',
	},
	/*
	  A third contract under the same version string, and this one changed what a successful call
	  PRINTS, not only what it accepts: `call search` and `call remember` answer with a text receipt
	  unless `--json` is on the line, and facts whose endpoints were never declared now commit
	  instead of being refused one by one. Neither is visible to the tier logic — a changed success
	  shape is not a refusal — which is why the whole suite, not the parser alone, is what was re-run
	  against it before this line was added: 361 tests on a clone, with the two behaviours above
	  asserted as they now are.
	*/
	{
		digest: '8c5ecdbf3016aa67f2dc29cc0bb07443960a043fa9dbc137c8a6d4e899ab633d',
		engine: 'kscope 0.0.5',
		tested_on: '2026-09-11',
	},
];

/**
 * The public-contract schema versions this build understands.
 *
 * This is the OUTER envelope — the shape of the seed the limits and the retired-operation list
 * arrive in — and an unrecognised one means this app is reading fields by names that may no longer
 * mean what it thinks. That is a Tier A condition rather than a Tier B one: Tier B is "the
 * vocabulary might be incomplete", and this is "the readings might not be the readings".
 */
export const KNOWN_SCHEMA_VERSIONS = ['kaleidoscope.public-seed.v1'];

/**
 * The operations this app calls. Four, and every screen is built on them.
 *
 * These are OPERATION NAMES on the engine's published command surface, not vocabulary: they are
 * what this client depends on, and a client that cannot say what it depends on cannot notice when
 * one of them goes away. `search` is deliberately absent and its absence is the product decision —
 * the ranked door records that it ran, permanently, so a UI that listed by searching would write
 * into the store it displays on every refresh.
 */
export const REQUIRED_OPERATIONS = [
	{ name: 'remember', why: 'every write in this app — create, update, delete — is this operation' },
	{ name: 'memory_lifecycle', why: 'the whole-vault export the listing is built from, plus lineage and per-memory export' },
	{ name: 'ontology', why: 'the workspace memory types every editor control offers' },
	{ name: 'doctor', why: 'the vault health reading the app shows and polls' },
];

/** Every operation the engine's contract says is retired, from the nested lists it publishes. */
function retiredOperations(seed) {
	const retired = seed?.retired_operations;
	if (!retired) return [];
	if (Array.isArray(retired)) return retired.map(String);
	return Object.values(retired)
		.filter(Array.isArray)
		.flat()
		.map(String);
}

/**
 * Is this operation in the engine's own index?
 *
 * The index is the prose `kscope schema` prints, so the test is a word-boundary match rather than a
 * parse. A parse of that screen would be a second contract nobody published, and it would fail in
 * the direction that matters — reporting an operation absent because a heading moved.
 */
function inIndex(index, name) {
	if (typeof index !== 'string' || index.length === 0) return false;
	return new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`).test(index);
}

/**
 * Which tier this machine is in, and everything a screen needs to say why.
 *
 * @param {object} readings  what `preflight()` returned
 * @returns {{
 *   tier: 'A'|'B'|'C',
 *   digest: string|null,
 *   tested_digests: string[],
 *   engine_version: string|null,
 *   schema_version: string|null,
 *   schema_version_known: boolean,
 *   operations: Array<{name: string, present: boolean, retired: boolean, why: string}>,
 *   missing_operations: string[],
 *   retired_operations: string[],
 *   writes_permitted: boolean,
 *   vocabulary_verified: boolean,
 *   reasons: Array<{code: string, message: string}>,
 *   headline: string
 * }}
 */
export function assessCompatibility(readings) {
	const digest = readings?.contract?.digest ?? null;
	const engineVersion = readings?.engine?.version ?? null;
	const schemaVersion = readings?.contract?.schema_version ?? null;
	const index = readings?.contract?.operations ?? '';
	const retired = new Set(retiredOperations(readings?.contract));

	const operations = REQUIRED_OPERATIONS.map((operation) => ({
		name: operation.name,
		why: operation.why,
		present: inIndex(index, operation.name),
		retired: retired.has(operation.name),
	}));

	const missing = operations.filter((operation) => !operation.present).map((o) => o.name);
	const withdrawn = operations.filter((operation) => operation.retired).map((o) => o.name);
	const schemaKnown = schemaVersion !== null && KNOWN_SCHEMA_VERSIONS.includes(schemaVersion);
	const tested = TESTED_CONTRACTS.map((entry) => entry.digest);

	const reasons = [];

	// ---- Tier A: the readings might not be the readings ---------------------------------------
	if (!schemaKnown) {
		reasons.push({
			code: 'unknown-schema-version',
			message:
				`This engine publishes its contract as ${schemaVersion ?? '(nothing at all)'}, and this ` +
				`build of the app has been written against ${KNOWN_SCHEMA_VERSIONS.join(', ')}. Every ` +
				`limit and every list it reads is read out of that envelope by field name, so it will ` +
				`not guess at one it does not recognise.`,
		});
	}
	if (missing.length > 0) {
		reasons.push({
			code: 'operation-missing',
			message:
				`This app needs ${missing.join(', ')}, and the engine's own operation index does not ` +
				`list ${missing.length === 1 ? 'it' : 'them'}.`,
		});
	}
	if (withdrawn.length > 0) {
		reasons.push({
			code: 'operation-retired',
			message:
				`The engine lists ${withdrawn.join(', ')} as retired, and this app is built on ` +
				`${withdrawn.length === 1 ? 'it' : 'them'}.`,
		});
	}

	const tier = reasons.length > 0 ? 'A' : tested.includes(digest) ? 'C' : 'B';

	// ---- Tier B: the vocabulary might be incomplete ---------------------------------------------
	if (tier === 'B') {
		reasons.push({
			code: 'contract-not-tested',
			message:
				`This engine's write contract is ${digest ?? '(not recorded)'}, and this build has a ` +
				`tested parser for ${tested.join(', ') || '(nothing)'}. Reading your memory is ` +
				`unaffected. What changes is that no list this app extracted from the contract is ` +
				`presented as complete: every field that would have been a menu is a text box, with ` +
				`whatever could still be read out of the contract offered beside it as a suggestion. ` +
				`Writes are still allowed — the engine refuses what it cannot accept and names the ` +
				`field to fix, which is a better answer than a menu this app is guessing at.`,
		});
	}

	const headline =
		tier === 'C'
			? `Tested against this engine (${engineVersion ?? 'version not recorded'}).`
			: tier === 'B'
				? `This engine's write contract is not one this build was tested against.`
				: `This app cannot safely write to this engine.`;

	return {
		tier,
		digest,
		tested_digests: tested,
		engine_version: engineVersion,
		schema_version: schemaVersion,
		schema_version_known: schemaKnown,
		operations,
		missing_operations: missing,
		retired_operations: withdrawn,
		// Tier A refuses writes. Tier B allows them, deliberately: the engine's refusals are
		// correctable and name the field to fix, and refusing here would mean this app deciding a
		// write is wrong on the strength of a parse it has just admitted it cannot verify.
		writes_permitted: tier !== 'A',
		// True in exactly one tier. Every control that would present a closed list reads this, so
		// there is one switch rather than a judgement call per control.
		vocabulary_verified: tier === 'C',
		reasons,
		headline,
	};
}
