// The boundary check that needs a vault, and therefore cannot live in the boundary script.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A TEST AND NOT A RULE IN scripts/check-boundary.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `scripts/check-boundary.mjs` derives every rule from `docs/BOUNDARY.md` and runs on a public CI
// runner where there is no engine and no vault. That is right for what it does: it catches classes
// that are recognisable from their SHAPE — an engine source path, a vault identifier, a home
// directory. Naming one of those literals here would itself be a hit, which is the gate working.
//
// It cannot catch the leak that has no shape. A real entity surface out of somebody's vault is just
// English, and it is indistinguishable — to any scanner — from a phrase an author invented, until
// you have the vault in your hand and can compare.
//
// That is not a hypothetical. It is what this test was written after. Real entity surfaces from the
// vault this product was developed against had been used as ILLUSTRATIONS: in a doc comment
// explaining what the near-duplicate rule catches, in a second one explaining why the finding
// matters, in a fixture, and — at greatest length — in a status document that reported the
// detector's findings "in full" because reporting a finding in full is the habit every other
// paragraph in these documents is written by. Every one of them read as an author's example.
// Nothing flagged them. The boundary gate was green the whole time and was working correctly.
//
// This file quotes NONE of them, which is not squeamishness: the first run of this test failed on
// its own header, because the header had named the very strings it was describing. That is the
// check working, and it is the reason the description above is a description and not a list.
//
// So the instrument has to be the one thing the scanner lacks: THE VAULT ITSELF, on the other side
// of the comparison.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ALLOWANCE LIST, AND WHY IT IS SAFE HERE WHEN AN ALLOW LIST USUALLY IS NOT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// This repository's rule is that a written-down list must be a DENIAL list, because a stale denial
// refuses something newly permitted and the user sees it, where a stale allow list is accepted and
// the damage is silent. This list is the exception, and it is made safe by inverting the staleness
// failure rather than by arguing it away:
//
//   **every allowance must fire.** An entry that no longer matches anything is a FAILURE, not a
//   silent pass. So the list cannot rot into a blanket: it shrinks the moment a phrase leaves the
//   tree, and it never grows on its own.
//
// The entries exist because this particular vault holds memories about building this particular
// repository, so the product's own published vocabulary — the CLI surface, the names of screens,
// the engine version — appears on both sides by construction. A phrase this repository is
// independently entitled to write does not become forbidden because an agent also wrote it down.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS STILL CANNOT SEE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Screenshots. They are binary, they are gitignored, and they are the highest-risk leak in a UI
// repository — PRD 0007 R35 names them as the one class no text scanner can provide a control for.
// The control there is the `.gitignore` entry and the synthetic-vault generator, not this file.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { locateEngine } from '../src/engine/locate.mjs';
import { listMemories } from '../src/engine/memory.mjs';
import { openScratchVault } from './helpers/vault.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Phrases that are on both sides for a reason, each with the reason.
 *
 * Every one of these is either the engine's own published command surface — which
 * `docs/BOUNDARY.md` explicitly permits this repository to describe — or a term this product
 * invented for itself and which the vault contains because agents wrote memories about building
 * this product. None of them is knowledge taken out of a vault and put into the tree.
 */
const ALLOWED = [
	['write contract', "the engine's published contract, named in every document that describes a write"],
	['kscope schema', 'a published command, quoted as the way to read the contract'],
	['kscope schema remember', 'the same command with its argument'],
	['kscope call remember', 'a published command, named in PRD 0001 as the door a write goes through'],
	['kscope 0.0.5', 'the engine version these milestones were run against'],
	['memory_import', 'a published operation name, named where restore is described'],
	['the ontology', "the engine's published operation, and the word for what it returns"],
	['the curation backlog', "this product's own name for a screen, invented in PRD 0006"],
	['a release build', 'ordinary English about building this package'],
	['the whole workspace', 'ordinary English, and the unit the export door returns'],
	['kscope where', 'a published command name'],
	['kscope activate', 'a published command name'],
	// The ranked door's published OUTPUT field. `docs/BOUNDARY.md` permits this repository to
	// describe the engine's published contract, and the search screen cannot read an answer without
	// naming the field the answer arrives in. It is in the vault because agents wrote memories about
	// building this engine, not because anything was copied out of one.
	['selected_hits', "the field name the engine's ranked door returns its served memories in"],
	// Flagged here for human review rather than allowed silently. It names a block
	// in the record the export door returns, which docs/BOUNDARY.md permits a client to describe —
	// but it sits close enough to the engine's own decisions to be a judgement rather than a rule,
	// and a judgement is exactly what "a clean check is not a clean review" reserves for a person.
	['the admission block', 'names a block in the record the export door returns'],
	// The row the retrieval door writes on every search — this product's own name for it since PRD
	// 0001, and the word every screen that reads uses to say that reading is recorded. It reached the
	// vault the way `selected_hits` did: agents building the engine wrote memories about it.
	['exposure row', "this product's own name for the record a search leaves behind, in every PRD since M1"],
	// The two readings the vault picker is built on, and they are published commands: `kscope --help`
	// prints both under OPERATOR. `docs/BOUNDARY.md` permits this repository to describe the engine's
	// published surface, and the picker's whole contract is that it offers what the engine reported —
	// a comment that could not name the command it read would be describing a mechanism the reader
	// cannot check. They are in the vault because agents wrote memories about building the engine.
	['kscope profile list', 'a published command name, and the door the vault picker reads profiles from'],
	// The engine's own word for where it resolves a project's vault, printed in its `--help` and in
	// the refusal it prints when that root is not a vault. The picker's doc comment has to say which
	// directory the default came from, and this is the engine's name for it.
	['main checkout', "the engine's published term for the repository a vault resolves against"],
];

/**
 * A vault string distinctive enough to be evidence.
 *
 * Short single words are not: a vault containing `memory` does not make the word `memory` a
 * disclosure, and a check that said so would be unusable and would be turned off. The bar is a
 * length and a separator — a multi-word or snake_cased name — which is the shape an entity surface
 * actually has and the shape a coincidence rarely has.
 */
const distinctive = (value) => value.length >= 12 && /[\s_-]/.test(value);

function publishableFiles() {
	return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
		cwd: REPO,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	})
		.split('\0')
		.filter(Boolean)
		// `dist/` is generated from `src/`, so a hit there is a duplicate of a hit that is already
		// reported against the file a person can fix.
		.filter((file) => !file.startsWith('dist/') && !file.startsWith('node_modules/'));
}

const engine = await locateEngine();

test('no string out of the vault appears anywhere in this repository', async (t) => {
	// There is no skip path. A boundary check that passes when it cannot see the thing it compares
	// against passes hardest at the moment it is most broken, so the absence of a vault has to be
	// a failure — which is what `openScratchVault` does when there is nothing to clone.
	const scratch = openScratchVault({ enginePath: engine.path, label: 'boundary-vault' });
	try {
		const listing = await listMemories({ enginePath: engine.path, root: scratch.root });
		assert.ok(
			listing.memory_count > 0,
			'The cloned vault holds no memories, so this test has nothing to compare the tree ' +
				'against and would pass without checking anything.',
		);

		const strings = new Set();
		for (const record of listing.memories) {
			const semantic = record.semantic ?? {};
			if (semantic.title) strings.add(String(semantic.title));
			for (const entity of semantic.entities ?? []) if (entity?.n) strings.add(String(entity.n));
			for (const fact of semantic.facts ?? []) {
				for (const key of ['subject', 'predicate', 'object']) {
					if (fact?.[key]) strings.add(String(fact[key]));
				}
			}
		}
		const needles = [...strings].filter(distinctive);
		assert.ok(
			needles.length > 100,
			`Only ${needles.length} vault strings were distinctive enough to search for. This test ` +
				`is measuring almost nothing; check the export shape before believing a pass.`,
		);

		const allowed = new Map(ALLOWED);
		const fired = new Set();
		const hits = [];
		let scanned = 0;

		for (const file of publishableFiles()) {
			let text;
			try {
				const buffer = readFileSync(join(REPO, file));
				if (buffer.includes(0)) continue; // binary; a text comparison has nothing to say
				text = buffer.toString('utf8');
			} catch {
				continue;
			}
			scanned += 1;
			for (const needle of needles) {
				if (!text.includes(needle)) continue;
				if (allowed.has(needle)) {
					fired.add(needle);
					continue;
				}
				hits.push({ file, needle });
			}
		}

		t.diagnostic(
			`compared ${needles.length} distinctive vault strings against ${scanned} text files; ` +
				`${fired.size} of ${ALLOWED.length} allowances fired`,
		);

		assert.deepEqual(
			hits.map((hit) => `${hit.file}  <-  ${JSON.stringify(hit.needle)}`),
			[],
			'A string from the vault appears in this public repository. Replace it with an invented ' +
				'one that makes the same point; if it is genuinely this product\'s own vocabulary and ' +
				'the overlap is a coincidence, add it to ALLOWED with the reason.',
		);

		// THE ALLOWANCE LIST SHRINKS OR GOES RED. This is what stops it becoming the silent kind of
		// allow list: an entry that stopped matching is dead weight that would quietly permit its
		// phrase forever, so it fails here and gets deleted.
		assert.deepEqual(
			ALLOWED.map(([phrase]) => phrase).filter((phrase) => !fired.has(phrase)),
			[],
			'An allowance no longer matches anything. Delete it: an allowance that fires on nothing ' +
				'is a permission nobody is reading, and it is how an allow list rots into a blanket.',
		);
	} finally {
		scratch.close();
	}
});
