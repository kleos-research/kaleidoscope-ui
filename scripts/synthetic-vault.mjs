#!/usr/bin/env node
//
// A vault this repository generated, with nothing in it that came from a person.
//
// Every other test in this suite clones the vault a developer actually uses, which is right for
// them — they assert against real shapes at real sizes — and wrong for the one test that has to run
// on a machine that has never had a vault, and wrong for anything whose output is looked at. This
// repository is public: a screenshot, a fixture or a CI log taken against a real vault carries real
// memory content, and that is the one leak no text scanner catches.
//
// So this builds one from nothing: `kscope init` into a fresh directory, then a handful of `create`
// calls whose entities and facts are about a harbour ferry.
//
// NOTHING HERE IS A TRANSCRIBED VOCABULARY. The entity kinds, the fact predicates, the qualifier
// classes and the memory types are all read out of the running engine — from `schema remember` for
// the open registries and from the ontology door for the workspace's declarable types — and the
// only literals below are the FIELD NAMES the contract publishes and the prose of the invented
// memories themselves. A generator that wrote down a kind would be the same drift this whole
// product is built to avoid, arriving through the fixture.
//
//   node scripts/synthetic-vault.mjs <directory> [--memories N] [--hub N]
//
// Exit 0 created; 2 the engine refused something. It never writes into an existing vault: the
// directory must not already be one.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { locateEngine } from '../src/engine/locate.mjs';
import { parseWriteContract } from '../src/engine/preflight.mjs';

const ROOT_ENV = 'KSCOPE_ROOT';

/** How many memories a default vault gets. Enough that a list, a graph and a backlog are non-empty. */
const DEFAULT_MEMORY_COUNT = 6;

/**
 * How many facts a hub memory carries, and how many such memories one `--hub` unit writes.
 *
 * A hub is a node whose degree clears `max(20, p99_degree × 4)`, and on a small vault the p99 term
 * is tiny so the floor of 20 is the bar. Reaching it takes twenty-one edges on one surface, which
 * is one process per memory and not one per edge — hence facts in batches. Six memories of eight
 * facts is forty-eight edges on the hub: comfortably clear of the floor, and clear of the p99 term
 * as the vault grows around it.
 */
const HUB_FACTS_PER_MEMORY = 8;
const HUB_MEMORIES = 6;

/**
 * The hub's own surface, and the surfaces it is joined to.
 *
 * Invented, like everything else in this file, and deliberately NOT a name that reads like anyone's
 * data: a screenshot of the collapse is going to be looked at, and `the harbour mooring` is
 * obviously a fixture in a way that a plausible project name would not be. It is also generated
 * with an index rather than tabulated, because a hub needs more distinct objects than anybody wants
 * to write out by hand.
 */
const HUB_SURFACE = 'the harbour authority';
const HUB_OBJECT = (index) => `mooring ${String(index + 1).padStart(2, '0')}`;

/**
 * The invented content. Prose and surfaces only — every value that belongs to a registry is chosen
 * from the engine's own contract below, never from this table.
 */
const SUBJECTS = [
	{
		surface: 'the harbour ferry',
		gloss: 'a passenger ferry that crosses the harbour',
		object: 'the winter timetable',
		objectGloss: 'a reduced crossing schedule used out of season',
		title: 'The harbour ferry moved to the winter timetable',
		body: 'Four crossings a day instead of seven, from the first week of November.',
	},
	{
		surface: 'the north jetty',
		gloss: 'the older of the two landing stages',
		object: 'the tide gauge',
		objectGloss: 'an instrument recording the water level at the jetty',
		title: 'The north jetty reads from the tide gauge',
		body: 'The gauge on the north jetty is the one the timetable is checked against.',
	},
	{
		surface: 'the ticket office',
		gloss: 'the booth beside the terminal building',
		object: 'the paper roll printer',
		objectGloss: 'the thermal printer the ticket office issues tickets on',
		title: 'The ticket office still issues tickets on the paper roll printer',
		body: 'The card reader was added beside it rather than replacing it.',
	},
	{
		surface: 'the harbour ferry',
		gloss: 'a passenger ferry that crosses the harbour',
		object: 'the north jetty',
		objectGloss: 'the older of the two landing stages',
		title: 'The harbour ferry lands at the north jetty in winter',
		body: 'The south jetty is exposed to the prevailing wind and is used in summer only.',
	},
	{
		surface: 'the terminal building',
		gloss: 'the waiting room and office at the harbour end',
		object: 'the ticket office',
		objectGloss: 'the booth beside the terminal building',
		title: 'The ticket office is part of the terminal building',
		body: 'One roof, two doors, and the office closes an hour before the last crossing.',
	},
	{
		surface: 'the tide gauge',
		gloss: 'an instrument recording the water level at the jetty',
		object: 'the winter timetable',
		objectGloss: 'a reduced crossing schedule used out of season',
		title: 'The winter timetable depends on the tide gauge',
		body: 'Low water at the north jetty is what sets the gap between the second and third crossing.',
	},
];

function run(binary, args, { root, input } = {}) {
	const child = spawnSync(binary, args, {
		encoding: 'utf8',
		shell: false,
		input,
		env: root ? { ...process.env, [ROOT_ENV]: root } : process.env,
	});
	if (child.error) throw child.error;
	// Branch on the exit code, never on stderr: this engine writes an informational line about the
	// vault it resolved to stderr on a successful call, so "stderr is non-empty" is a failure test
	// that fires on success.
	return { code: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

function refuse(message, reading) {
	const detail = reading ? `\n\nThe engine exited ${reading.code} and said:\n${(reading.stderr || reading.stdout).trim()}` : '';
	throw new Error(`${message}${detail}`);
}

/**
 * Pick a value from a registry the engine published, skipping anything it publishes as refused.
 *
 * `denied` is the one list this repository acts on without asking, and it is a DENIAL list: a stale
 * denial fails safe by refusing something newly permitted, where a stale allow list fails open.
 */
function pick(parsed, path, index = 0) {
	const known = parsed.known?.[path] ?? parsed.closed?.[path] ?? [];
	const denied = new Set(parsed.denied?.[path] ?? []);
	const usable = known.filter((value) => !denied.has(value));
	if (usable.length === 0) {
		refuse(
			`The write contract published no usable value at ${path}, so this generator cannot ` +
				`compose a memory without writing one down. Nothing was created.`,
		);
	}
	return usable[index % usable.length];
}

/**
 * Build one `remember` payload from the contract's own field list.
 *
 * The field NAMES here are structure, not vocabulary — they are what the published contract calls
 * its own keys — and each is checked against the parse, so a renamed field stops this loudly rather
 * than writing a memory whose facts the engine silently drops.
 */
function composeMemory(parsed, memoryType, subject, index) {
	for (const path of [
		'semantic_delta.title',
		'semantic_delta.memory_type',
		'semantic_delta.entities.n',
		'semantic_delta.entities.kind',
		'semantic_delta.entities.is',
		'semantic_delta.facts.subject',
		'semantic_delta.facts.predicate',
		'semantic_delta.facts.object',
	]) {
		if (!parsed.fields[path]) {
			refuse(`The write contract has no ${path}. This generator is written against a contract shape that no longer exists.`);
		}
	}

	const entity = (n, is, kindIndex) => ({
		n,
		kind: pick(parsed, 'semantic_delta.entities.kind', kindIndex),
		is: `${n} | ${pick(parsed, 'semantic_delta.entities.kind', kindIndex)} | ${is}`,
	});

	return {
		mode: 'create',
		content_md: `# ${subject.title}\n\n${subject.body}\n`,
		semantic_delta: {
			title: subject.title,
			memory_type: memoryType,
			entities: [
				entity(subject.surface, subject.gloss, index),
				entity(subject.object, subject.objectGloss, index + 1),
			],
			facts: [
				{
					subject: subject.surface,
					predicate: pick(parsed, 'semantic_delta.facts.predicate', index),
					object: subject.object,
					mode: pick(parsed, 'semantic_delta.facts.mode', index),
					basis: pick(parsed, 'semantic_delta.facts.basis', index),
				},
			],
		},
	};
}

/**
 * A memory whose facts all hang off one surface.
 *
 * WHY THE GENERATOR NEEDS THIS. The hub programme — regime detection, the collapse threshold, the
 * compound meta-node, the list behind it — cannot fire on a vault whose busiest name touches a
 * handful of facts, and the table above tops out at one fact per memory. Four features that have
 * never been seen on a screen are four features nobody can photograph, and a status document that
 * described them instead would be describing code rather than a product.
 *
 * The facts differ only in their object, which is the point: what makes a hub hard to draw is a
 * ring of neighbours that carry no topology of their own, and what makes a collapse worth having is
 * that it can say exactly how many of them it absorbed.
 */
function composeHubMemory(parsed, memoryType, batch) {
	const objects = Array.from({ length: HUB_FACTS_PER_MEMORY }, (_, n) =>
		HUB_OBJECT(batch * HUB_FACTS_PER_MEMORY + n),
	);
	const entity = (n, is, kindIndex) => ({
		n,
		kind: pick(parsed, 'semantic_delta.entities.kind', kindIndex),
		is: `${n} | ${pick(parsed, 'semantic_delta.entities.kind', kindIndex)} | ${is}`,
	});

	return {
		mode: 'create',
		content_md:
			`# Moorings the harbour authority holds, part ${batch + 1}\n\n` +
			`${objects.length} more moorings on the authority's register.\n`,
		semantic_delta: {
			title: `Moorings the harbour authority holds, part ${batch + 1}`,
			memory_type: memoryType,
			entities: [
				entity(HUB_SURFACE, 'the body that licenses every mooring in the harbour', batch),
				...objects.map((object, n) => entity(object, 'a numbered berth on the register', batch + n + 1)),
			],
			facts: objects.map((object, n) => ({
				subject: HUB_SURFACE,
				predicate: pick(parsed, 'semantic_delta.facts.predicate', batch + n),
				object,
				mode: pick(parsed, 'semantic_delta.facts.mode', batch + n),
				basis: pick(parsed, 'semantic_delta.facts.basis', batch + n),
			})),
		},
	};
}

/**
 * Create a synthetic vault and write memories into it.
 *
 * @param {object} options
 * @param {string} options.directory   must not already be a vault
 * @param {string} [options.enginePath]
 * @param {number} [options.memories]
 * @param {boolean} [options.hub]  also write the memories that put one surface past the collapse
 *        threshold, so the hub programme has something to fire on. Off by default: the release test
 *        wants the small vault, and a caller that did not ask for a hub must not silently get one.
 * @returns {Promise<{root: string, memories: number, hub: string|null, workspace_id: string, engine: string}>}
 */
export async function createSyntheticVault({ directory, enginePath, memories = DEFAULT_MEMORY_COUNT, hub = false } = {}) {
	const root = resolve(directory);
	if (existsSync(root) && readdirSync(root).length > 0) {
		refuse(`${root} already has something in it. This generator only ever creates a vault in an empty directory.`);
	}
	mkdirSync(root, { recursive: true });

	const engine = enginePath ? { path: enginePath } : await locateEngine({});

	// `kscope init` takes the durability class as an argument and refuses one this build does not
	// carry. Rather than naming a class, the default is taken — the form with no class argument is
	// the one the engine's own help calls the plain case.
	const created = run(engine.path, ['init', root, new Date().toISOString()], {});
	if (created.code !== 0) refuse(`Could not create a vault at ${root}.`, created);

	const contract = run(engine.path, ['schema', 'remember'], { root });
	if (contract.code !== 0) refuse('The engine would not print the write contract.', contract);
	const parsed = parseWriteContract(contract.stdout);

	// The workspace's own declarable memory types, from the vault rather than from this file.
	const ontology = run(engine.path, ['call', 'ontology'], { root, input: JSON.stringify({ mode: 'read' }) });
	if (ontology.code !== 0) refuse('The engine would not read the new vault\'s ontology.', ontology);
	const declarable = JSON.parse(ontology.stdout)?.declarable?.memory_types ?? [];
	if (declarable.length === 0) {
		refuse('The new vault declares no memory types, so this generator would have to coin one.');
	}

	const written = [];
	for (let index = 0; index < Math.min(memories, SUBJECTS.length); index += 1) {
		const payload = composeMemory(parsed, declarable[index % declarable.length], SUBJECTS[index], index);
		const reading = run(engine.path, ['call', 'remember'], { root, input: JSON.stringify(payload) });
		if (reading.code !== 0) refuse(`The engine refused synthetic memory ${index + 1}.`, reading);
		written.push(JSON.parse(reading.stdout).memory_id);
	}

	for (let batch = 0; hub && batch < HUB_MEMORIES; batch += 1) {
		const payload = composeHubMemory(parsed, declarable[batch % declarable.length], batch);
		const reading = run(engine.path, ['call', 'remember'], { root, input: JSON.stringify(payload) });
		if (reading.code !== 0) refuse(`The engine refused hub memory ${batch + 1}.`, reading);
		written.push(JSON.parse(reading.stdout).memory_id);
	}

	const where = run(engine.path, ['where'], { root });
	if (where.code !== 0) refuse('The engine would not resolve the vault it had just created.', where);

	return {
		root,
		memories: written.length,
		hub: hub ? HUB_SURFACE : null,
		workspace_id: JSON.parse(where.stdout).workspace_id,
		engine: engine.path,
	};
}

const isMain = process.argv[1]?.endsWith('synthetic-vault.mjs');

if (isMain) {
	const args = process.argv.slice(2);
	const directory = args.find((arg) => !arg.startsWith('--'));
	const at = args.indexOf('--memories');
	const memories = at === -1 ? undefined : Number.parseInt(args[at + 1] ?? '', 10);
	const hub = args.includes('--hub');

	if (!directory) {
		process.stderr.write('usage: node scripts/synthetic-vault.mjs <directory> [--memories N] [--hub]\n');
		process.exit(2);
	}

	try {
		const made = await createSyntheticVault({ directory, memories, hub });
		// The workspace id is NOT printed. It is minted inside a vault, and identifiers minted
		// inside a vault are one of the classes this repository may not publish — including in a
		// CI log, which is a public artefact of a public repository.
		process.stdout.write(
			`synthetic-vault: ${made.memories} memories at ${made.root}` +
				`${made.hub ? ` (hub: ${made.hub})` : ''}\n`,
		);
	} catch (error) {
		process.stderr.write(`synthetic-vault: ${error.message}\n`);
		process.exit(2);
	}
}
