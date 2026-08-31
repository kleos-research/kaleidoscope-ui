// The call contract: four exit codes, one stderr rule, and the read side that must write nothing.
//
// Every case here is PROVOKED against a real engine and a cloned vault. None of it is asserted
// against a stub, because the whole value of this file is that the four outcomes are what the
// installed binary actually does rather than what a client believes it does — and the three ways
// this goes wrong all look like working code:
//
//   * a wrapper that treats non-empty stderr as failure breaks on every working call, because a
//     call that resolved its own vault address prints that resolution ON SUCCESS;
//   * a client that parses stdout on the licensing refusal reports "unexpected end of JSON input"
//     and sends the user to reinstall a healthy engine;
//   * a client that folds a partial application into "saved" tells the user their batch landed
//     when part of it did not.
//
// The one case not provoked here is named in docs/M1-STATUS.md rather than quietly implied.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { call, run } from '../src/engine/call.mjs';
import {
	EngineCrashedError,
	EngineRefusedError,
	EngineUnlicensedError,
} from '../src/engine/errors.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { listMemories, loadForEdit, readMemory, writeMemory } from '../src/engine/memory.mjs';
import { parseWriteContract } from '../src/engine/preflight.mjs';
import { fingerprintVault, openScratchVault } from './helpers/vault.mjs';

/**
 * A field name the write contract cannot possibly accept.
 *
 * Generated rather than written down. A transcribed "unknown" field is a bet that the contract will
 * never grow that name, and the day it does the test stops provoking a refusal and starts asserting
 * nothing while still passing.
 */
const impossibleFieldName = () => `field_this_contract_cannot_name_${Date.now().toString(36)}`;

/**
 * Run `body` with HOME pointed somewhere empty, and put it back whatever happens.
 *
 * `await body(...)` and not `return body(...)`: a child process reads the environment at the moment
 * it is spawned, so restoring HOME when the callback hands back its promise restores it before every
 * call inside it but the first. That version of this helper passed its own plumbing check — the
 * first reading saw the moved home — and then measured a normal, licensed call.
 */
async function withEmptyHome(body) {
	const holder = mkdtempSync(join(tmpdir(), 'kscope-ui-home-'));
	const previous = process.env.HOME;
	// Any credential the environment supplies directly would defeat the redirection below. Matched
	// by shape rather than by name so this holds for whatever the engine reads, and restored after.
	const cleared = Object.keys(process.env).filter((name) => /_API_KEY$/.test(name));
	const saved = cleared.map((name) => [name, process.env[name]]);

	process.env.HOME = holder;
	for (const name of cleared) delete process.env[name];
	try {
		return await body(holder);
	} finally {
		if (previous === undefined) delete process.env.HOME;
		else process.env.HOME = previous;
		for (const [name, value] of saved) process.env[name] = value;
		rmSync(holder, { recursive: true, force: true });
	}
}

const engine = await locateEngine();

test('exit 0: a successful call writes a provenance line to stderr, and that is not a failure', async (t) => {
	const scratch = openScratchVault({ enginePath: engine.path, label: 'kscope-ui-exit0' });
	const where = { enginePath: engine.path, root: scratch.root };
	try {
		const envelope = await call('memory_lifecycle', { mode: 'export' }, where);

		assert.equal(envelope.outcome, 'applied');
		assert.equal(envelope.exit_code, 0);
		assert.ok(envelope.data !== null, 'a successful call returned no parsed body');

		// The trap, measured. This call succeeded AND printed to stderr, so a client that branches
		// on stderr rather than on the exit code fails here on a healthy machine and a healthy vault.
		assert.ok(
			typeof envelope.provenance === 'string' && envelope.provenance.length > 0,
			`This call succeeded without printing a provenance line, so the case this test exists ` +
				`to pin was not exercised. Either the engine stopped printing it — in which case the ` +
				`comment in src/engine/call.mjs is now describing something that does not happen — or ` +
				`this call is no longer address-resolved and a different one must be used.`,
		);
		t.diagnostic(`provenance on success: ${envelope.provenance.split('\n')[0]}`);
	} finally {
		scratch.close();
	}
});

test('exit 2: a refusal carrying an envelope is data, not an outage', async (t) => {
	const scratch = openScratchVault({ enginePath: engine.path, label: 'kscope-ui-exit2' });
	const where = { enginePath: engine.path, root: scratch.root };
	const before = fingerprintVault(scratch.root);
	try {
		let refused = null;
		try {
			await call(
				'remember',
				{
					mode: 'create',
					content_md: '# A memory the contract will refuse\n\nIt names a field nothing accepts.',
					semantic_delta: { [impossibleFieldName()]: true },
				},
				where,
			);
		} catch (error) {
			refused = error;
		}

		assert.ok(
			refused instanceof EngineRefusedError,
			`A write naming a field the contract cannot accept was not refused: ` +
				`${refused === null ? 'it was applied' : `it failed as ${refused.constructor.name}`}.`,
		);
		assert.equal(refused.exitCode, 2);
		assert.equal(refused.outcome, 'refused');
		assert.ok(refused.refusal !== null, 'the refusal envelope did not arrive on stdout');
		assert.ok(
			typeof refused.refusal.message === 'string' && refused.refusal.message.length > 0,
			'the refusal envelope carries no message for a screen to render',
		);
		t.diagnostic(`refusal code: ${refused.code}`);

		// The engine says a refusal read nothing and wrote nothing. That is checkable, so it is
		// checked: a refusal that had already written half of something is a different product.
		const after = fingerprintVault(scratch.root);
		assert.equal(after.digest, before.digest, 'a refused write changed the vault');
	} finally {
		scratch.close();
	}
});

test('exit 2: a refusal with no envelope is still a refusal, not a crash', async (t) => {
	// A directory that is not a vault. The engine refuses to address it, exits 2, and prints the
	// whole reason — including what to do about it — on stderr with stdout EMPTY. A client that
	// requires JSON on stdout for every exit 2 reports this as a broken engine, and the user goes
	// looking at their install instead of at the path they mistyped.
	const holder = mkdtempSync(join(tmpdir(), 'kscope-ui-notavault-'));
	try {
		let refused = null;
		try {
			await call('ontology', { mode: 'read' }, { enginePath: engine.path, root: holder });
		} catch (error) {
			refused = error;
		}

		assert.ok(
			refused instanceof EngineRefusedError,
			`An unaddressable vault was reported as ${refused?.constructor?.name ?? 'a success'} ` +
				`rather than as a refusal.`,
		);
		assert.ok(
			!(refused instanceof EngineCrashedError),
			'a correctable refusal was classified as an engine fault',
		);
		assert.equal(refused.exitCode, 2);
		assert.equal(refused.refusal, null, 'this refusal is the one that carries no envelope');
		assert.ok(
			refused.reason.trim().length > 0,
			'the refusal carried neither an envelope nor a reason, so nothing can be shown to a user',
		);
		// The engine's own sentence has to survive to the surface intact; it is the only text that
		// names the remedy.
		assert.ok(refused.message.includes(refused.reason.trim().split('\n')[0]));
		t.diagnostic(`no-envelope refusal: ${refused.reason.trim().split('\n')[0]}`);
	} finally {
		rmSync(holder, { recursive: true, force: true });
	}
});

test('exit 3: a batch applies in part, and the per-item results say which', async (t) => {
	const scratch = openScratchVault({ enginePath: engine.path, label: 'kscope-ui-exit3' });
	const where = { enginePath: engine.path, root: scratch.root };
	try {
		// Both of these are READ from the engine a moment before they are used. A memory type or a
		// relation name transcribed into a test is a bet on one vault's vocabulary: the type list is
		// workspace-scoped and append-only, the relation list grows, and a test that writes either
		// one down keeps passing on this machine while refusing on somebody else's.
		const ontology = await call('ontology', { mode: 'read' }, where);
		const memoryType = ontology.data?.declarable?.memory_types?.[0];
		assert.ok(memoryType, 'the vault declares no memory type this batch may be written under');

		const contract = parseWriteContract((await run(['schema', 'remember'], where)).stdout);
		const predicate = Object.entries(contract.known).find(
			([path]) => path.split('.').at(-1) === 'predicate',
		)?.[1]?.[0];
		assert.ok(predicate, 'the write contract named no relation this batch may use');
		t.diagnostic(`writing as ${memoryType} with the relation ${predicate}`);

		const item = (title, body) => ({
			content_md: body,
			semantic_delta: {
				title,
				memory_type: memoryType,
				facts: [{ subject: title, predicate, object: 'the batch door' }],
			},
		});

		// The second item is refused on its own terms — its body does not open with a heading —
		// which is per-item validation. A field the schema does not name would fail deserialization
		// instead, before any item is written, and cost the whole call rather than part of it.
		const envelope = await writeMemory(
			{
				mode: 'create',
				items: [
					item('A batch item that lands', '# A batch item that lands\n\nIt has its heading.'),
					item('A batch item that does not', 'this body opens with no heading at all'),
				],
			},
			where,
		);

		// Deliberately NOT thrown. The per-item results are what a caller has to act on, and an
		// exception carrying them is still an exception somebody swallows into "Saved".
		assert.equal(envelope.outcome, 'applied_in_part');
		assert.equal(envelope.exit_code, 3);

		assert.ok(Array.isArray(envelope.results), 'a partial application returned no per-item results');
		assert.equal(envelope.results.length, 2, 'the results do not cover every submitted item');

		const refusedItems = envelope.results.filter((entry) => entry.status === 'refused');
		assert.equal(refusedItems.length, 1);
		assert.equal(refusedItems[0].item_index, 1, 'the refusal is not reported at its own index');
		assert.ok(
			typeof refusedItems[0].reason === 'string' && refusedItems[0].reason.length > 0,
			'the refused item carries no reason, so nothing can be repaired and resent',
		);

		const written = envelope.results.filter((entry) => entry.status !== 'refused');
		assert.equal(written.length, 1);
		assert.ok(written[0].memory_id, 'the item that landed is not identified, so it cannot be found');

		// "Applied in part" has to mean the part really applied. Reading the survivor back is what
		// separates a partial application from a refusal wearing a different exit code.
		const survivor = await readMemory(written[0].memory_id, where);
		assert.equal(survivor.memory_id, written[0].memory_id);

		t.diagnostic(`item 0: ${written[0].status} ${written[0].memory_id}`);
		t.diagnostic(`item 1: refused — ${refusedItems[0].reason}`);
	} finally {
		scratch.close();
	}
});

test('exit 4: a licensing refusal is reported as licensing, with stdout never parsed', async (t) => {
	const scratch = openScratchVault({ enginePath: engine.path, label: 'kscope-ui-exit4' });
	const where = { enginePath: engine.path, root: scratch.root };
	const before = fingerprintVault(scratch.root);

	try {
		await withEmptyHome(async (holder) => {
			// The probe carries its own proof of plumbing. `gate` is ungated and reports where a key
			// would be read from, so this asserts the redirection actually reached the engine before
			// it believes anything about the refusal that follows. Without this, an engine that
			// ignored the redirection would answer normally and the test would fail for a reason
			// that looks nothing like its cause.
			const gate = JSON.parse((await run(['gate'], where)).stdout);
			assert.ok(
				String(gate.key_file).startsWith(holder),
				`The engine still reads its key from ${gate.key_file}, which this test did not move, ` +
					`so the licensing path was never entered and nothing below is evidence.`,
			);

			let unlicensed = null;
			try {
				await call('ontology', { mode: 'read' }, where);
			} catch (error) {
				unlicensed = error;
			}

			assert.ok(
				unlicensed instanceof EngineUnlicensedError,
				`With no key reachable, the call ` +
					`${unlicensed === null ? 'succeeded' : `failed as ${unlicensed.constructor.name}`} ` +
					`instead of refusing for licensing. If it succeeded, this machine supplies a key by ` +
					`some route this test did not close, and the licensing path is untested here.`,
			);
			// The three wrong answers, each ruled out by name: a crash, an empty response, and a
			// refusal the user is told to correct in their request.
			assert.ok(!(unlicensed instanceof EngineCrashedError), 'reported as an engine fault');
			assert.ok(!(unlicensed instanceof EngineRefusedError), 'reported as a correctable refusal');
			assert.equal(unlicensed.exitCode, 4);
			assert.equal(unlicensed.outcome, 'unlicensed');

			// stdout is empty by design and is never parsed, so the reason comes from stderr whole.
			assert.ok(
				unlicensed.reason.trim().length > 0,
				'the licensing refusal arrived with no reason at all, which is what parsing an empty ' +
					'stdout produces — the reason is on stderr and must be taken from there',
			);
			assert.ok(
				unlicensed.message.includes('kscope'),
				'the message does not name the program whose licence is being refused',
			);
			assert.ok(
				typeof unlicensed.code === 'string' && unlicensed.code.length > 0,
				'the engine classified the refusal and the client did not carry the classification',
			);
			t.diagnostic(`licensing refusal classified as ${unlicensed.code}`);
		});

		// "Your vault is intact" is a claim the engine makes on this path. It is checkable.
		assert.equal(fingerprintVault(scratch.root).digest, before.digest);
	} finally {
		scratch.close();
	}
});

test('the read path leaves the vault byte-identical', async (t) => {
	const scratch = openScratchVault({ enginePath: engine.path, label: 'kscope-ui-readonly' });
	const where = { enginePath: engine.path, root: scratch.root };
	try {
		const before = fingerprintVault(scratch.root);

		const listing = await listMemories(where);
		assert.ok(listing.memory_count > 0, 'the cloned vault holds no memories to read');
		const edit = await loadForEdit(listing.memories[0].memory_id, where);
		const shown = await readMemory(listing.memories[0].memory_id, where);
		assert.equal(shown.memory_id, edit.memory_id);

		const after = fingerprintVault(scratch.root);
		t.diagnostic(`read ${listing.memory_count} memories; ${before.files} files before and after`);

		// Stronger than counting exposure records, and for the same reason: this product's whole
		// claim is that looking at a vault does not change it, and the only honest way to hold that
		// is to measure the vault rather than one store inside it.
		assert.equal(
			after.digest,
			before.digest,
			`A listing, an editor load and a detail read changed the vault. Some door on the read ` +
				`path writes, and every screen in this product is built on those three calls.`,
		);
	} finally {
		scratch.close();
	}
});
