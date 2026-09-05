// Milestone 3: the editor's arithmetic, driven directly.
//
// `test/editor.test.mjs` asserts the write path against the bytes a browser sends, which is the
// right level for the seam that loses data. It cannot reach the half of the editor that runs BEFORE
// a request exists: the projection that decides what a save carries, the gate that decides whether
// an undeclared endpoint is a warning or a non-question, the matcher that decides which row a
// refusal points at, and the composer that guarantees the body's leading heading.
//
// Every one of those is a pure function over plain values, and every one of them fails silently:
// the payload is still valid, the write still commits, the screen still says the right thing, and
// the memory is worse. So they are asserted here, without a vault, without a server and without
// rendering anything — a property that can only be checked by clicking is a property nobody checks
// twice.
//
// THE CONTRACT IS READ FROM THE ENGINE, NOT WRITTEN DOWN. The projection test needs a field list,
// and a field list typed into this file would keep passing after the engine changed shape — which
// is the exact failure the projection exists to prevent. So one process is spawned to print the
// write contract, and it is parsed by the same parser the app uses. Nothing is written and no vault
// is addressed: `kscope schema remember` resolves none.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	bodyBytes,
	bufferFromRecord,
	compareBuffers,
	composeBody,
	currentVersionFromRefusal,
	driftingFactRows,
	duplicateFactRows,
	emptyBuffer,
	emptyEntityRow,
	headingReading,
	knownName,
	mentionedSurfaces,
	refusalsByRow,
	refusedSurfaces,
	saveBlockers,
	saysTheSameThing,
	splitLeadingHeading,
	toSemanticDelta,
	undeclaredSurfaces,
	validUntilDate,
	vaultVocabulary,
	withValidUntil,
} from '../src/app/editor-model.mjs';
import { RESERVED_RELATION_NAMES, deniedRelations } from '../src/app/reserved-relations.mjs';
import { locateEngine } from '../src/engine/locate.mjs';
import { parseWriteContract } from '../src/engine/preflight.mjs';
import { projectOntoContract } from '../src/shared/contract.mjs';

// ---------------------------------------------------------------------------------------------
// The contract, read once
// ---------------------------------------------------------------------------------------------

let contract = null;

async function writeContract() {
	if (contract) return contract;
	const engine = await locateEngine({});
	const printed = spawnSync(engine.path, ['schema', 'remember'], { encoding: 'utf8', shell: false });
	assert.equal(
		printed.status,
		0,
		`The engine would not print its write contract, so nothing below can be checked against ` +
			`anything but a list typed into this file. It exited ${printed.status} and said:\n` +
			`${(printed.stdout + printed.stderr).trim().slice(0, 400)}`,
	);
	contract = parseWriteContract(printed.stdout);
	assert.ok(
		Object.keys(contract.fields).length > 10,
		`The write contract parsed into ${Object.keys(contract.fields).length} fields. A parser that ` +
			`degrades yields FEWER of them, and every assertion below would then pass against a ` +
			`projection that drops most of a memory.`,
	);
	return contract;
}

const project = (value, fields) => projectOntoContract(value, 'semantic_delta', fields, new Set());

/** A record shaped the way the edit door answers, with every value distinct so a swap is visible. */
function loadedRecord() {
	return {
		memory_id: 'mem_fixture',
		expected_version_id: 'ver_one',
		content_md: '# The heading as written\n\nThe body, unchanged.\n',
		semantic_delta: {
			title: 'A title that is not the heading',
			memory_type: 'note',
			scope: { project: 'kaleidoscope', branch: null, artifact: null },
			entities: [
				{ n: 'the shortlist loop', kind: 'practice', is: 'the loop that scores candidates' },
				{ n: 'decode_block', kind: 'tool', is: 'the decoder that owns a member per scope entry' },
			],
			facts: [
				{
					subject: 'the shortlist loop',
					predicate: 'costs',
					object: 'decode_block',
					about: {},
					basis: null,
					evidence: [],
					from: null,
					mode: null,
					until: null,
				},
			],
			// Two keys the editor renders no control for. They must come back untouched.
			evidence: [{ kind: 'file', reference: 'notes/one-file.txt', digest: null }],
			temporal: { valid_from: null, valid_until: null },
			contradicts: [],
		},
	};
}

// ---------------------------------------------------------------------------------------------
// 1. THE BODY, AND ITS LEADING HEADING  (PRD 0003 R12)
// ---------------------------------------------------------------------------------------------
//
// The engine refuses a body that does not begin with a Markdown H1. The editor composes the body,
// so it guarantees the heading and the human never meets the rule. The trap in the other direction
// is a composer that keeps the heading and the title in sync: in a meaningful share of real
// memories the heading is authored prose that deliberately differs from the title, and rewriting it
// would silently edit something the user did not touch.

test('the editor composes a leading heading and never rewrites one that is there', () => {
	assert.equal(
		composeBody({ body: 'Just prose.', title: 'A title' }),
		'# A title\n\nJust prose.',
		'a body with no heading did not get one built from the title',
	);

	const already = '# An authored heading\n\nProse.';
	assert.equal(
		composeBody({ body: already, title: 'A completely different title' }),
		already,
		'a body that already begins with a heading was changed. Nothing may be prepended, and the ' +
			'existing heading must not be rewritten to match the title: the two differing is a normal ' +
			'state in real memories and raises no warning anywhere in this product.',
	);

	assert.equal(
		composeBody({ body: '\n\n   \n# A heading after blank lines\n\nProse.', title: 'T' }),
		'# A heading after blank lines\n\nProse.',
		'leading blank lines were not removed, so the engine would refuse a body that does begin ' +
			'with a heading — the requirement is that it BEGINS with one',
	);

	assert.equal(
		composeBody({ body: '', title: 'Only a title' }),
		'# Only a title\n',
		'an empty note did not become a heading-only body',
	);

	// A missing title is blocked by `saveBlockers` before this matters; what must NOT happen is a
	// bare `# ` heading being invented from nothing.
	assert.equal(
		composeBody({ body: 'Prose.', title: '   ' }),
		'Prose.',
		'a blank title produced a heading anyway, which is a heading scraped out of nothing',
	);

	// `é` is two bytes and one character. The ceiling the engine publishes is in BYTES, so a
	// counter that measured length would let a note through that the request limit refuses.
	assert.equal(bodyBytes('# é\n'), 5, 'the byte counter is counting characters rather than bytes');
	assert.equal('# é\n'.length, 4, 'the fixture no longer distinguishes bytes from characters');
});

// ---------------------------------------------------------------------------------------------
// 2. THE PAYLOAD IS A PROJECTION, NOT A SPREAD  (PRD 0003 R2)
// ---------------------------------------------------------------------------------------------

test('a prose-only save re-sends the loaded structure, key for key', async (t) => {
	const { fields } = await writeContract();
	const record = loadedRecord();

	const buffer = bufferFromRecord(record);
	buffer.body = `${record.content_md}\nOne more line.`;

	const { delta } = toSemanticDelta(buffer, fields, projectOntoContract);
	const loaded = project(record.semantic_delta, fields);

	await t.test('it is deep-equal to what was loaded', () => {
		assert.deepEqual(
			delta,
			loaded,
			'a prose-only edit sent a structure that differs from the one it loaded. Every difference ' +
				'here is a change the user did not make to a memory they believed they were fixing a ' +
				'typo in.',
		);
	});

	await t.test('the fields the editor renders no control for came back untouched', () => {
		assert.deepEqual(delta.evidence, record.semantic_delta.evidence);
		assert.deepEqual(delta.temporal, record.semantic_delta.temporal);
	});

	await t.test('a key the record did not carry is ABSENT rather than defaulted', () => {
		const thin = loadedRecord();
		delete thin.semantic_delta.evidence;
		delete thin.semantic_delta.temporal;
		const { delta: sparse } = toSemanticDelta(bufferFromRecord(thin), fields, projectOntoContract);
		assert.ok(
			!('evidence' in sparse) && !('temporal' in sparse),
			`A key the loaded record did not carry was invented on the way out: ` +
				`${Object.keys(sparse).join(', ')}. Carrying is not the same as defaulting — an ` +
				`invented empty list is a claim the memory never made.`,
		);
	});

	await t.test('a field the contract does not name is dropped and REPORTED', () => {
		const withJunk = loadedRecord();
		withJunk.semantic_delta.confidence_millionths = 990_000;
		withJunk.semantic_delta.embedding = [0.1, 0.2];
		const buffered = bufferFromRecord(withJunk);
		const { delta: cleaned, dropped } = toSemanticDelta(buffered, fields, projectOntoContract);
		assert.ok(
			!('embedding' in cleaned) && !('confidence_millionths' in cleaned),
			'a derived field survived into the payload. The engine refuses an unknown field by ' +
				'failing deserialization, which costs the WHOLE call before anything is written.',
		);
		assert.ok(
			dropped.includes('semantic_delta.embedding'),
			`what was dropped was not reported by name; it reported ${JSON.stringify(dropped)}`,
		);
	});

	await t.test('an empty declaration list is SENT rather than omitted', () => {
		const none = loadedRecord();
		none.semantic_delta.entities = [];
		const { delta: sent } = toSemanticDelta(bufferFromRecord(none), fields, projectOntoContract);
		assert.deepEqual(
			sent.entities,
			[],
			'declaring nothing is a REGIME, not an absence: with zero declarations every fact commits ' +
				'and every name is matched loosely, and with one or more an undeclared endpoint drops ' +
				'its fact. Omitting the key leaves the engine to decide which side of that switch the ' +
				'memory is on.',
		);
	});
});

// ---------------------------------------------------------------------------------------------
// 3. THE ENTITY-DECLARATION SWITCH IS GATED  (PRD 0003 R11)
// ---------------------------------------------------------------------------------------------

test('the undeclared-endpoint check does not run on a memory that declares nothing', () => {
	const record = loadedRecord();
	record.semantic_delta.entities = [];
	record.semantic_delta.facts = [
		{ subject: 'something', predicate: 'uses', object: 'something else' },
		{ subject: 'a third thing', predicate: 'uses', object: 'a fourth' },
	];

	const buffer = bufferFromRecord(record);
	assert.equal(
		undeclaredSurfaces(buffer),
		null,
		'the check ran on a memory that declares nothing. `null` is not zero: zero means the check ' +
			'ran and found nothing, and null means the question does not apply. Running it here would ' +
			'flag every honest memory in a young vault, which is an outage rather than a guard.',
	);

	const blockers = saveBlockers(buffer);
	assert.ok(
		!blockers.some((entry) => entry.field.startsWith('entity:')),
		'a memory declaring nothing was blocked from saving',
	);

	// One declaration, and the same facts are now in a different regime.
	buffer.entities = [emptyEntityRow('something')];
	buffer.entities[0].kind = 'concept';
	buffer.entities[0].is = 'a thing';
	const undeclared = undeclaredSurfaces(buffer);
	assert.deepEqual(
		undeclared,
		['something else', 'a third thing', 'a fourth'],
		'declaring one thing did not put the other three names on the wrong side of the switch',
	);

	assert.deepEqual(mentionedSurfaces(buffer.facts), [
		'something',
		'something else',
		'a third thing',
		'a fourth',
	]);
});

// ---------------------------------------------------------------------------------------------
// 4. A REFUSAL IS MATCHED BY SURFACE, NEVER BY ITS INDEX  (PRD 0003 R15)
// ---------------------------------------------------------------------------------------------

test('a dropped fact is matched to its row by name, and the index would pick a different one', () => {
	const facts = [
		{ id: 'row-a', subject: 'alpha', predicate: 'uses', object: 'beta' },
		{ id: 'row-b', subject: 'gamma', predicate: 'uses', object: 'delta' },
		{ id: 'row-c', subject: 'epsilon', predicate: 'uses', object: 'zeta' },
	];

	// The refusal names the SURFACES it could not resolve, and carries an index that does not
	// correspond to the position of that fact in the payload that was sent. Measured. This fixture
	// makes the two disagree on purpose: index 0 is row-a, and the surface is on row-c.
	const refused = [{ index: 0, undeclared: ['Zeta'], reason: 'no entity declared this surface' }];

	const byRow = refusalsByRow(refused, facts);
	assert.deepEqual([...byRow.keys()], ['row-c'], 'the wrong row was marked');
	assert.notEqual(
		[...byRow.keys()][0],
		facts[refused[0].index].id,
		'the surface match and the index agree in this fixture, so it cannot tell them apart and ' +
			'proves nothing. Rebuild the fixture so they differ.',
	);
	assert.deepEqual(byRow.get('row-c').surfaces, ['Zeta'], 'the surface was not carried for display');

	assert.deepEqual(
		refusedSurfaces(refused),
		['Zeta'],
		'the declare-and-resend action would offer nothing to declare',
	);

	assert.equal(
		refusalsByRow(null, facts).size,
		0,
		'an ABSENT refusal list was read as something. Absence means nothing was refused; it is ' +
			'never a failure signal.',
	);
});

// ---------------------------------------------------------------------------------------------
// 5. WHAT THE FORM KNOWS BEFORE IT CALLS
// ---------------------------------------------------------------------------------------------

test('the form blocks exactly the three conditions the door refuses on, plus the gloss', () => {
	const empty = emptyBuffer(['project']);
	const fields = saveBlockers(empty).map((entry) => entry.field);
	assert.deepEqual(
		fields.sort(),
		['facts', 'memory_type', 'title'],
		'the empty create form does not block on precisely title, type and one complete fact',
	);

	const ready = emptyBuffer(['project']);
	ready.title = 'A title';
	ready.memory_type = 'note';
	ready.facts[0] = { ...ready.facts[0], subject: 'a', predicate: 'uses', object: 'b' };
	assert.deepEqual(saveBlockers(ready), [], 'a complete form was still blocked');

	// The gloss is required by the door, and the form must not be gentler than the door.
	ready.entities = [emptyEntityRow('a')];
	const glossBlockers = saveBlockers(ready);
	assert.equal(glossBlockers.length, 2, 'a declaration with no gloss and no kind was accepted');
	assert.ok(
		glossBlockers.some((entry) => /what this is/i.test(entry.message)),
		`the missing-gloss message does not name the field the way the form labels it: ` +
			`${JSON.stringify(glossBlockers.map((entry) => entry.message))}`,
	);
});

test('rows that state the same triple are flagged before the save, not after it', () => {
	const facts = [
		{ id: '1', subject: 'A', predicate: 'uses', object: 'B' },
		{ id: '2', subject: 'a', predicate: 'USES', object: ' b ' },
		{ id: '3', subject: 'A', predicate: 'uses', object: 'C' },
		{ id: '4', subject: '', predicate: 'uses', object: 'C' },
	];
	assert.deepEqual(
		[...duplicateFactRows(facts)].sort(),
		['1', '2'],
		'two rows stating the same triple were not both flagged. Unnumbered duplicates are silently ' +
			'collapsed and numbered ones are refused: the same authoring mistake with two different ' +
			'endings, and neither is one to discover from a receipt.',
	);
});

// ---------------------------------------------------------------------------------------------
// 6. WHAT THIS VAULT ALREADY HOLDS  (PRD 0003 R9)
// ---------------------------------------------------------------------------------------------

test('the gloss already in use is offered, and one name glossed two ways is reported', () => {
	const rows = [
		{
			record: {
				semantic: {
					facts: [{ subject: 'opus 5', predicate: 'uses', object: 'a tool' }],
					entities: [{ n: 'opus 5', kind: 'model', is: 'Anthropic language model' }],
				},
			},
		},
		{
			record: {
				semantic: {
					facts: [{ subject: 'opus 5', predicate: 'uses', object: 'a tool' }],
					entities: [{ n: 'opus 5', kind: 'model', is: 'Anthropic language model' }],
				},
			},
		},
		{
			record: {
				semantic: {
					facts: [],
					entities: [{ n: 'opus 5', kind: 'org', is: 'a racing team' }],
				},
			},
		},
	];

	const vocabulary = vaultVocabulary(rows);
	assert.deepEqual(
		vocabulary.predicates,
		[{ value: 'uses', count: 2 }],
		'the relation list is not counted out of the records already in the browser',
	);

	const known = knownName(vocabulary, 'opus 5');
	assert.equal(known.memories, 3, 'the "how widely is this used" count is wrong');
	assert.equal(
		known.glosses[0].gloss,
		'Anthropic language model',
		'the most common gloss in use was not offered first. Matching an existing gloss is how a ' +
			'declaration binds to the thing already in the graph rather than minting a second copy.',
	);
	assert.equal(known.glosses[0].count, 2);
	assert.equal(
		known.conflicted,
		true,
		'one name glossed two materially different ways was not reported. It is the only conflation ' +
			'signal available anywhere in this product, and authoring time is the only moment it can ' +
			'be acted on cheaply.',
	);

	assert.equal(knownName(vocabulary, 'a name nobody has used'), null);
});

// ---------------------------------------------------------------------------------------------
// 7. THE CONFLICT NEVER COSTS TYPING  (PRD 0003 R17)
// ---------------------------------------------------------------------------------------------

test('the current version is recovered from a refusal, and its absence is not a reason to discard', () => {
	assert.equal(
		currentVersionFromRefusal({ write_refusal: { current_version_id: 'ver_two' } }),
		'ver_two',
		'the classification the sidecar already parsed was ignored',
	);

	assert.equal(
		currentVersionFromRefusal({
			refusal: { message: 'expected_version_id ver_one is stale; active version is ver_three.' },
		}),
		'ver_three',
		'the narrow parse of the refusal text did not recover the current version',
	);

	assert.equal(
		currentVersionFromRefusal({ refusal: { message: 'something else entirely' } }),
		null,
		'the parse invented a version. Returning null is what sends the caller to re-read the ' +
			'memory; there is no path in this product from "we could not read a refusal" to "we threw ' +
			'away what you typed".',
	);
});

test('the conflict dialog compares the two versions field by field', () => {
	const mine = bufferFromRecord(loadedRecord());
	const theirsRecord = loadedRecord();
	theirsRecord.semantic_delta.title = 'What they called it';
	theirsRecord.semantic_delta.facts.push({
		subject: 'decode_block',
		predicate: 'uses',
		object: 'the shortlist loop',
	});
	const theirs = bufferFromRecord(theirsRecord);

	const lines = compareBuffers(mine, theirs);
	const byField = Object.fromEntries(lines.map((line) => [line.field, line]));
	assert.equal(byField.Title.same, false);
	assert.equal(byField.Facts.mine, 1);
	assert.equal(byField.Facts.theirs, 2);
	assert.equal(byField.Type.same, true);
	assert.equal(byField['Named things'].same, true);
});

// ---------------------------------------------------------------------------------------------
// 8. THE ONE LIST THAT IS WRITTEN DOWN  (PRD 0003 R6, R8)
// ---------------------------------------------------------------------------------------------

test('the engine refuses every relation name this repository denies, and more besides', async () => {
	const { denied } = await writeContract();
	const runtime = new Set(Object.values(denied ?? {}).flat());

	assert.ok(
		runtime.size > 0,
		`The engine printed no denied relation names at all. Either the parse degraded or the ` +
			`contract changed shape — and a checked-in list unioned with an empty runtime set is a ` +
			`list nobody is checking.`,
	);

	const missing = RESERVED_RELATION_NAMES.filter((name) => !runtime.has(name));
	assert.deepEqual(
		missing,
		[],
		`This repository denies ${missing.join(', ')} and the engine no longer does. A stale DENIAL ` +
			`list fails safe — it refuses something that has since become permitted — so this is not ` +
			`a data-loss bug. Check whether the name became permitted before deleting the entry.`,
	);

	const union = deniedRelations(denied);
	for (const name of runtime) {
		assert.ok(union.has(name), `the union dropped ${name}, which the engine refuses`);
	}
	for (const name of RESERVED_RELATION_NAMES) {
		assert.ok(union.has(name), `the union dropped ${name}, which this repository refuses`);
	}
});

// ---------------------------------------------------------------------------------------------
// 9. THE DRIFT WARNING IS A DRIFT WARNING  (the approved editor's second mitigation)
// ---------------------------------------------------------------------------------------------
//
// A save replaces the words and the structure together, so the two halves of one memory can be
// edited apart with nothing in the engine noticing. The approved design draws the warning on the
// fact — "No longer in the words. Remove it, or say it in the prose."
//
// The trap is the version of this check that is a COVERAGE check: "this endpoint is nowhere in the
// prose" is true of a large share of perfectly good memories, because the facts are the structured
// half precisely so that the paragraph does not have to spell them out. A warning on most rows of
// most memories is a warning nobody reads, and it would arrive on a screen the owner already
// rejected for saying too much. So the assertion below is that the check fires on a sentence that
// LEFT and stays silent on one that was never there.

test('a fact is flagged when the words stopped saying it, and not merely for being structured', () => {
	const facts = [
		{ id: 'a', subject: 'build cache', predicate: 'is keyed on', object: 'lockfile hash' },
		{ id: 'b', subject: 'build cache', predicate: 'had delay of', object: 'two seconds' },
		{ id: 'c', subject: 'build cache', predicate: 'powers', object: '' },
	];
	const baselineBody = '# Cache keys\n\nThe build cache is keyed on the lockfile hash, and it had a two seconds delay.';

	const untouched = driftingFactRows({ body: baselineBody, baselineBody, facts });
	assert.equal(untouched.size, 0, 'a memory nobody has edited raised a drift warning');

	const edited = driftingFactRows({
		body: '# Cache keys\n\nThe build cache is keyed on the lockfile hash.',
		baselineBody,
		facts,
	});
	assert.deepEqual(
		[...edited.keys()],
		['b'],
		'the row whose object the rewrite deleted was not the one flagged',
	);
	assert.deepEqual(edited.get('b'), ['two seconds'], 'the endpoint that left was not named');

	// The half of the rule that keeps it usable: a fact the prose NEVER spelled out is not drift.
	const neverSaid = driftingFactRows({
		body: 'Nothing here names anything.',
		baselineBody: 'Nothing here names anything.',
		facts,
	});
	assert.equal(
		neverSaid.size,
		0,
		'a fact the words never spelled out was flagged as having left them. That is a coverage ' +
			'check wearing a drift check\'s sentence, and it fires on most rows of most memories.',
	);

	// An incomplete row is being typed, not drifting.
	const incomplete = driftingFactRows({
		body: 'The build cache is keyed on the lockfile hash.',
		baselineBody,
		facts: [facts[2]],
	});
	assert.equal(incomplete.size, 0, 'a half-typed row was flagged');
});

// ---------------------------------------------------------------------------------------------
// 10. THE VALIDITY WINDOW, AND THE SHAPE THE ENGINE ACTUALLY ACCEPTS
// ---------------------------------------------------------------------------------------------
//
// `temporal.valid_until` is the gentler alternative to removal: an ended memory stops being served
// and stays readable. The editor sets exactly this one key inside an object it otherwise CARRIES,
// so two things have to hold at once — the value must be the shape the engine takes, and a record
// that carried no window must still send none.
//
// THE SHAPE WAS MEASURED, NOT ASSUMED. Against kscope 0.0.5 on a clone: `"2027-01-01"` is refused
// as `InvalidTimestamp`, `{t, grain}` is refused as `invalid type: map, expected a string`, and
// `"2027-01-01T00:00:00Z"` commits. A date control cannot produce the third on its own, which is
// why the composing happens in the model and is pinned here.

test('an end date is composed as a timestamp, and an absent window is never invented', async () => {
	const { fields } = await writeContract();

	const record = loadedRecord();
	const buffer = bufferFromRecord(record);
	assert.equal(validUntilDate(buffer), null, 'a memory with an open window read as ended');

	const ended = withValidUntil(buffer, '2027-01-01');
	assert.equal(
		ended.carried.temporal.valid_until,
		'2027-01-01T00:00:00Z',
		'the end date was not composed up to the RFC 3339 timestamp the engine accepts. A plain ' +
			'date is refused as InvalidTimestamp, which the user meets as a failed save.',
	);
	assert.equal(validUntilDate(ended), '2027-01-01', 'the date control could not read its own value back');
	assert.equal(
		ended.carried.temporal.valid_from,
		record.semantic_delta.temporal.valid_from,
		'setting the end of a memory changed when it began',
	);

	const { delta } = toSemanticDelta(ended, fields, projectOntoContract);
	assert.equal(delta.temporal.valid_until, '2027-01-01T00:00:00Z', 'the window was lost on the way out');

	// Cleared, it goes back to what the record carried — and a record that carried nothing still
	// carries nothing, because an invented `{valid_from: null, valid_until: null}` is a claim about
	// a window the memory never had.
	assert.deepEqual(
		withValidUntil(ended, null).carried.temporal,
		record.semantic_delta.temporal,
		'clearing the end date did not restore the window the record arrived with',
	);

	const thin = loadedRecord();
	delete thin.semantic_delta.temporal;
	const bare = bufferFromRecord(thin);
	assert.equal(validUntilDate(bare), null);
	assert.equal(
		'temporal' in withValidUntil(bare, null).carried,
		false,
		'clearing an end date on a memory that never had a window invented one',
	);
	assert.equal(withValidUntil(bare, '2027-01-01').carried.temporal.valid_until, '2027-01-01T00:00:00Z');
});

// ---------------------------------------------------------------------------------------------
// 11. THE TITLE IS NOT SHOWN TWICE, AND NOTHING IS REWRITTEN TO ACHIEVE THAT
// ---------------------------------------------------------------------------------------------
//
// The approved editor draws the title as an H1 across the top of both panes, so a body that opens

// ---------------------------------------------------------------------------------------------
// 9. THE HEADING NEVER REACHES THE PANE, AND THE ROUND TRIP IS BYTE-IDENTICAL
// ---------------------------------------------------------------------------------------------
//
// The editor draws the title as an H1 across the top of both panes. A body that opens with `# ` and
// a sentence used to print that sentence twice — the second time as raw Markdown, in the pane that
// is meant to hold the prose — whenever the heading was not the title character for character,
// which on a real vault is most of the time: a backtick around a name is enough.
//
// So the heading is split off WHATEVER it says, kept as the exact bytes it came as, and put back at
// save. The two properties that make that safe: a memory nobody edited is written back byte for
// byte, and a heading the writer authored to differ from the title is never rewritten — in a
// meaningful share of real memories that difference is deliberate. The one thing that moves is a
// heading that WAS the title, when the title changes: it follows.

test('the heading is split off whatever it says, and an untouched memory is written back byte for byte', () => {
	const title = 'Cache keys use the lockfile hash';
	const shapes = [
		`# ${title}\n\nA branch-keyed cache started every branch cold.\n`,
		`# ${title}\n`,
		`# ${title}`,
		`# ${title}\nNo blank line under the heading.\n`,
		`# ${title}\n\n\nTwo blank lines under it.\n`,
		// The title again, with the writer's marks on it. This is the common case on a real vault.
		`# Cache keys use the \`lockfile hash\`\n\nProse.\n`,
		// An authored heading that says something the title does not.
		`# What we tried first\n\nAnd why it did not hold.\n`,
		// A near-miss: a heading that merely starts with the title is its own sentence.
		`# ${title}, not the branch name\n\nProse.\n`,
	];

	for (const stored of shapes) {
		const { heading, body } = splitLeadingHeading(stored, title);
		assert.ok(heading, `no heading was split off ${JSON.stringify(stored)}`);
		assert.ok(!body.startsWith('#'), `the heading was still in the words: ${JSON.stringify(body)}`);
		assert.equal(
			composeBody({ body, title, heading }),
			stored,
			`putting the heading back did not reproduce the loaded bytes for ${JSON.stringify(stored)}. ` +
				'A prose-only save would then write a version whose only change is one the user did not make.',
		);
	}

	// A body with no heading is left whole, and the save composes one from the title.
	assert.deepEqual(splitLeadingHeading('Just prose.', title), { heading: null, body: 'Just prose.' });
	assert.equal(composeBody({ body: 'Just prose.', title, heading: null }), `# ${title}\n\nJust prose.`);
});

test('a heading that was the title follows a retitle; a heading the writer authored does not', () => {
	const title = 'Cache keys use the lockfile hash';

	// The title again, marks and all.
	const repeated = splitLeadingHeading(`# Cache keys use the \`lockfile hash\`\n\nProse.\n`, title);
	assert.equal(repeated.heading.repeatsTitle, true, 'a heading that only marks up the title was read as authored');
	assert.equal(
		composeBody({ ...repeated, title: 'Cache keys use the lockfile digest' }),
		'# Cache keys use the lockfile digest\n\nProse.\n',
		'the heading did not follow the new title',
	);
	assert.equal(
		composeBody({ ...repeated, title }),
		`# Cache keys use the \`lockfile hash\`\n\nProse.\n`,
		'an unchanged title rewrote the heading it had been read as',
	);

	// Authored: kept in both directions, whatever the title does.
	const authored = splitLeadingHeading('# What we tried first\n\nAnd why it did not hold.\n', title);
	assert.equal(authored.heading.repeatsTitle, false);
	assert.equal(
		composeBody({ ...authored, title: 'A completely different title' }),
		'# What we tried first\n\nAnd why it did not hold.\n',
		'an authored heading was rewritten to match the title',
	);

	// And the Details sheet's one-word reading of each case.
	assert.equal(headingReading({ ...repeated, title }).kind, 'title');
	assert.equal(headingReading({ ...repeated, title: 'Retitled' }).kind, 'follows');
	assert.equal(headingReading({ ...authored, title }).kind, 'authored');
	assert.equal(headingReading({ heading: null, body: 'Prose.', title }).kind, 'composed');
	assert.equal(headingReading({ ...authored, title }).line, '# What we tried first');
});

test('the one comparison the renderer and the editor share is narrow', () => {
	assert.ok(saysTheSameThing('Cache keys use the `lockfile hash`', 'Cache keys use the lockfile hash'));
	assert.ok(saysTheSameThing('**Cache keys** use the lockfile hash.', 'cache keys use the lockfile hash'));
	assert.ok(!saysTheSameThing('Cache keys use the lockfile hash, not the branch name', 'Cache keys use the lockfile hash'));
	assert.ok(!saysTheSameThing('', ''));
	assert.ok(!saysTheSameThing(null, 'x'));
});
