// Synthetic vaults, generated in code, so the hub programme has something to fire on.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Four features of the graph screen — regime detection, the collapse threshold, the compound
// meta-node and "absorb into context" — cannot be exercised on a working vault, because on one the
// maximum degree is single digits and the collapse threshold never fires. A guard whose null result
// is indistinguishable from success is not evidence, so **four features that have never run are
// four features that do not exist**. The same is true one floor down: the reduction ladder above
// DRAW_CAP has never fired either, because a working vault draws a few hundred elements against a
// cap of two thousand, and from there an inert knob and a robust result look identical.
//
// So the fixtures are the deliverable, not the scaffolding. Three of them, one per regime.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THREE RULES THIS FILE OBEYS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. **Generated, never stored.** A hundred thousand edges on disk is a repository nobody wants to
//    clone and a diff nobody can read. Everything here is built from a seed at call time; the cost
//    is a few hundred milliseconds and it is measured rather than assumed (see hub.test.mjs).
//
// 2. **Deterministic.** One seeded PRNG, no `Math.random`, no clock, no environment. A fixture whose
//    shape moves between runs turns a threshold assertion into a flake, and a flaky threshold is
//    worse than no threshold: it teaches the reader to re-run rather than to look.
//
// 3. **Every surface, gloss, kind and relationship name in here is INVENTED.** This repository is
//    public and the vault it drives is not. Nothing below was read from a vault, and nothing below
//    is a vocabulary read from the engine — the kinds and relationship names are nonsense words on
//    purpose, because these fixtures assert TOPOLOGY and topology does not care what a kind is
//    called. Inventing them is also what keeps them from drifting: a fixture that transcribed the
//    engine's registry would go stale silently the day the registry moved.
//
// The record shape is the shape the export door returns and `buildGraph` consumes:
// `{ memory_id, semantic: { title, memory_type, entities: [{ n, kind, is }], facts: [...] } }`.

// ------------------------------------------------------------------------------------------------
// determinism
// ------------------------------------------------------------------------------------------------

/**
 * mulberry32: a 32-bit PRNG, chosen because it is eight lines and has no state anyone has to reason
 * about. Statistical quality is irrelevant here — what matters is that the same seed gives the same
 * graph on every machine, in every Node version, forever.
 */
function mulberry32(seed) {
	let state = seed >>> 0;
	return function next() {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** An integer in [0, bound). */
const pick = (random, bound) => Math.floor(random() * bound) % Math.max(1, bound);

// ------------------------------------------------------------------------------------------------
// invented vocabulary
// ------------------------------------------------------------------------------------------------
//
// Nonsense syllables, combined positionally. Two syllables plus an index gives a hundred thousand
// distinct strings that read like names without being names, which matters when a screenshot of a
// fixture ends up in a bug report: `vandrel-quorix 40213` is obviously a fixture and `the alpha
// window` is obviously somebody's data.

const SYLLABLES = [
	'van', 'quo', 'mir', 'tesh', 'dral', 'pex', 'onu', 'kesh', 'yaro', 'brim',
	'lune', 'thav', 'sil', 'ozar', 'nub', 'faid', 'wex', 'gorm', 'ilex', 'radu',
];

const TAILS = [
	'rix', 'del', 'oth', 'ane', 'usk', 'ipt', 'ovar', 'ell', 'ynth', 'arb',
];

/**
 * A distinct invented surface for every index, with no collisions by construction: the numeric
 * suffix is the index itself. Uniqueness has to be structural rather than checked, because at a
 * hundred thousand names a collision-retry loop is where the generator's time goes.
 */
function surfaceFor(index) {
	const a = SYLLABLES[index % SYLLABLES.length];
	const b = TAILS[Math.floor(index / SYLLABLES.length) % TAILS.length];
	return `${a}${b} ${index}`;
}

/** Invented entity kinds. Nine of them, so the eight-slot palette also has an "other" bucket. */
const KINDS = ['beacon', 'trellis', 'quarry', 'lantern', 'ferry', 'pylon', 'anthem', 'cistern', 'orrery'];

/** Invented relationship names. Deliberately more of them than any one fixture uses. */
const PREDICATES = [
	'girds', 'nestles_in', 'overtakes', 'answers_to', 'buttresses', 'shadows',
	'ferries', 'annotates', 'quarries', 'threads_through', 'kindles', 'moors_at',
];

/** Invented memory types. Three, because the type facet needs more than one value to be a filter. */
const MEMORY_TYPES = ['ledger_note', 'field_report', 'bench_reading'];

// ------------------------------------------------------------------------------------------------
// assembling records
// ------------------------------------------------------------------------------------------------

/**
 * Pack a flat list of facts into memories.
 *
 * Facts arrive as a list because every shape below is easier to reason about as an edge list; a
 * memory is the container the export door happens to hand them back in. Which facts share a memory
 * changes what the memory-type filter selects and nothing else about the topology, so the packing
 * is a plain chunk rather than anything clever.
 *
 * `declare` decides which endpoints are also declared as named things. It is a function rather than
 * a flag because the undeclared RATE is itself a thing the screen reads at load — it picks the
 * polarity of the undeclared marker — so a fixture has to be able to set it.
 */
function packMemories({ facts, perMemory, prefix, declare, glossFor, random }) {
	const records = [];
	for (let start = 0; start < facts.length; start += perMemory) {
		const slice = facts.slice(start, start + perMemory);
		const index = records.length;
		const declared = new Map();
		for (const fact of slice) {
			for (const surface of [fact.subject, fact.object]) {
				if (declared.has(surface)) continue;
				if (!declare(surface, index)) continue;
				declared.set(surface, {
					n: surface,
					kind: KINDS[pick(random, KINDS.length)],
					is: glossFor ? glossFor(surface) : `a ${KINDS[pick(random, KINDS.length)]} in the fixture`,
				});
			}
		}
		records.push({
			// Not a vault identifier. A fixture id is minted here and never resembles one the store
			// mints, because an identifier shaped like a real one invites somebody to paste it
			// somewhere that would go looking for it.
			memory_id: `${prefix}-memory-${String(index).padStart(5, '0')}`,
			semantic: {
				title: `${prefix} memory ${index}`,
				memory_type: MEMORY_TYPES[index % MEMORY_TYPES.length],
				entities: [...declared.values()],
				facts: slice,
			},
		});
	}
	return records;
}

const factOf = (subject, predicate, object) => ({ subject, predicate, object });

// ------------------------------------------------------------------------------------------------
// FIXTURE 1 — the working regime
// ------------------------------------------------------------------------------------------------

/**
 * A small, fragmented vault: the shape a real working vault has, and the one regime where the
 * canvas draws what it was given without reducing anything.
 *
 * Its job in the test suite is to be the NEGATIVE case. Regime detection that reports "hub" on
 * everything separates nothing, and a collapse threshold that fires here would be the exact defect
 * the percentile-relative formula exists to avoid.
 */
export function workingVault({ seed = 1, memories = 140 } = {}) {
	const random = mulberry32(seed);
	const pool = 420;
	const facts = [];

	// Two draws, mixed. A squared uniform prefers low indices, so a handful of surfaces reach degree
	// eight or so; a flat uniform reaches deep into the tail, where both endpoints of a fact are rare
	// and the fact becomes an island. The mixture is what produces the shape a working vault has —
	// one modest clump and a field of dyads — and it needs no table.
	const preferred = () => (random() < 0.55 ? pick(random, pool) : Math.floor(random() * random() * pool));

	for (let index = 0; index < memories; index += 1) {
		const count = 1 + pick(random, 4);
		for (let n = 0; n < count; n += 1) {
			const subject = surfaceFor(preferred());
			let object = surfaceFor(preferred());
			if (object === subject) object = surfaceFor((preferred() + 1) % pool);
			facts.push(factOf(subject, PREDICATES[pick(random, PREDICATES.length)], object));
		}
	}

	return {
		name: 'working',
		records: packMemories({
			facts,
			perMemory: 4,
			prefix: 'wk',
			// Most endpoints declared: this is the polarity where the undeclared marker is a useful
			// exception marker rather than a mark on nearly every node.
			declare: () => random() < 0.7,
			random,
		}),
	};
}

// ------------------------------------------------------------------------------------------------
// FIXTURE 2 — over the draw cap, with no hub
// ------------------------------------------------------------------------------------------------

/**
 * A connected graph big enough that the default view cannot be drawn, and flat enough that no node
 * comes near the collapse threshold. That combination is the point: it separates "too much to draw"
 * from "one name is eating the picture", which are two different problems with two different
 * treatments, and a fixture that had both would prove neither.
 *
 * The shape is communities joined by a few bridges — dense inside, sparse between — because that is
 * what makes the ladder's second rung meaningful: an ego network at depth two lands inside one
 * community and is legible, which is exactly the reduction the ladder is claiming to offer.
 *
 * @param {number} communitySize  bigger communities push the depth-2 ego over the cap too, which is
 *                                how the ladder's THIRD rung is reached. Both settings are used.
 */
export function overCapVault({ seed = 2, communities = 12, communitySize = 100, intraDegree = 10 } = {}) {
	const random = mulberry32(seed);
	const facts = [];
	const surfaceAt = (community, member) => surfaceFor(community * 1000 + member);

	for (let community = 0; community < communities; community += 1) {
		for (let member = 0; member < communitySize; member += 1) {
			const subject = surfaceAt(community, member);
			// A ring first, so the community is connected whatever the random chords do. A fixture
			// that is USUALLY connected is a fixture whose component assertions fail one run in ten.
			facts.push(
				factOf(subject, PREDICATES[pick(random, PREDICATES.length)], surfaceAt(community, (member + 1) % communitySize)),
			);
			for (let chord = 0; chord < intraDegree / 2; chord += 1) {
				const other = pick(random, communitySize);
				if (other === member) continue;
				facts.push(factOf(subject, PREDICATES[pick(random, PREDICATES.length)], surfaceAt(community, other)));
			}
		}
		// One bridge to the next community, so the whole thing is one component and the largest
		// component IS the graph. Otherwise the ladder's first rung would reduce it for free and the
		// rungs above it would still never run.
		if (community > 0) {
			facts.push(factOf(surfaceAt(community, 0), PREDICATES[0], surfaceAt(community - 1, 1)));
		}
	}

	return {
		name: 'over-cap',
		records: packMemories({
			facts,
			perMemory: 12,
			prefix: 'oc',
			declare: () => random() < 0.5,
			random,
		}),
	};
}

// ------------------------------------------------------------------------------------------------
// FIXTURE 3 — one node with a hundred thousand edges
// ------------------------------------------------------------------------------------------------

/**
 * The insurance clause, made real: PRD 0005 R19 asks for a CI fixture carrying one node with
 * 100,000 edges, and this is it.
 *
 * The star alone would not be a fair test. A pure star collapses to a single element and any
 * implementation passes; what makes the collapse hard is the LONG TAIL AROUND IT — a minority of the
 * hub's neighbours that are also joined to each other, because those are the ones a collapse must
 * KEEP DRAWN while it absorbs the rest. So the neighbours come in two kinds:
 *
 *   * **leaves** — touched by the hub and by nothing else. These are what a collapse absorbs, and
 *     the count of them is what the meta-node must report exactly.
 *   * **connectors** — touched by the hub and by the tail. These are the topology. They stay.
 *
 * The tail behind the connectors is an ordinary fragmented vault of the shape fixture 1 has, so the
 * picture behind the collapse is a real picture and not a ring of orphans.
 *
 * @param {number} hubDegree      how many facts name the hub. 100,000 is the requirement.
 * @param {number} connectors     how many of those neighbours are also joined to the tail.
 */
export function hubVault({ seed = 3, hubDegree = 100000, connectors = 200, tail = 1500 } = {}) {
	const random = mulberry32(seed);
	const facts = [];

	// The hub's own surface is generated by the same function as everything else. It carries no
	// special string and nothing in the app may recognise it — a suppression keyed to a literal
	// surface is a transcribed vocabulary, and this project forbids those outright. The hub is found
	// by its DEGREE, at load, or it is not found at all.
	const hub = surfaceFor(0);
	const leafBase = 1000;
	const connectorBase = 900000;
	const tailBase = 950000;

	// Leaves: one fact each, hub → leaf. This is the mass.
	const leaves = hubDegree - connectors;
	for (let index = 0; index < leaves; index += 1) {
		facts.push(factOf(hub, PREDICATES[index % PREDICATES.length], surfaceFor(leafBase + index)));
	}

	// Connectors: hub → connector, and connector → somewhere in the tail.
	for (let index = 0; index < connectors; index += 1) {
		const connector = surfaceFor(connectorBase + index);
		facts.push(factOf(hub, PREDICATES[index % PREDICATES.length], connector));
		facts.push(
			factOf(connector, PREDICATES[pick(random, PREDICATES.length)], surfaceFor(tailBase + pick(random, tail))),
		);
	}

	// The tail: an ordinary fragmented graph, so what survives the collapse is worth looking at.
	for (let index = 0; index < tail; index += 1) {
		const subject = surfaceFor(tailBase + index);
		const object = surfaceFor(tailBase + pick(random, tail));
		if (object === subject) continue;
		facts.push(factOf(subject, PREDICATES[pick(random, PREDICATES.length)], object));
	}

	return {
		name: 'hub',
		hub,
		hubDegree,
		connectorCount: connectors,
		leafCount: leaves,
		records: packMemories({
			facts,
			perMemory: 50,
			prefix: 'hb',
			// Declaring a hundred thousand leaves would double the generator's cost and change
			// nothing this fixture is for. Only the tail and the connectors are declared, which also
			// puts the vault in the OTHER marker polarity from fixture 1 — undeclared endpoints are
			// the overwhelming majority here, so the marker must invert.
			declare: (surface) => surface === hub || random() < 0.02,
			random,
		}),
	};
}

/** The three fixtures by name, for a test that wants to walk all of them. */
export const FIXTURES = {
	working: workingVault,
	'over-cap': overCapVault,
	hub: hubVault,
};
