// THE READINGS THE SEARCH SCREEN PRINTS, checked as arithmetic.
//
// Every number and every sentence on that screen is a claim about what the user's agent would have
// been given, and the screen's whole value is that the claim is true. So the readings are computed
// in `src/app/search-model.mjs`, away from the DOM, and asserted here against engine-shaped
// answers — including the two shapes that would make the screen lie:
//
//   * a result that sits well under the budget AND dropped a memory for size, which is the case an
//     honest-looking sentence inferred from the bar gets exactly backwards; and
//   * a served memory that a later memory corrects, which must be dimmed rather than dropped.
//
// Nothing here starts a server, reads a vault or spawns an engine. Every fixture below is INVENTED:
// this repository is public, and a real entity surface copied out of a vault is a leak the boundary
// gate cannot see.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { relationIndex, toRow } from '../src/app/records.mjs';
import {
	answerIsStale,
	budgetReading,
	bytesLabel,
	findTheseWords,
	isRankedAnswer,
	omittedRows,
	omissionWords,
	rankedRows,
	rankingControls,
	servedCaption,
	whyThese,
	controlWords,
} from '../src/app/search-model.mjs';

/** A listing record, in the shape the listing door serves. Invented content throughout. */
function record({ id, title, type = 'procedure', on = '2031-04-02', body = '', corrections = [] }) {
	return {
		memory_id: id,
		version_id: `ver_${id}`,
		content_md: body || `# ${title}\n\n${title}.\n`,
		semantic: {
			title,
			memory_type: type,
			created_on: on,
			sequence: 1,
			scope: {},
			facts: [],
			entities: [],
			evidence: [],
			corrections,
			contradicts: [],
		},
	};
}

/** A served hit, in the shape the ranked door serves one. */
function hit({ id, type = 'procedure', on = '2031-04-02', body = 'x' }) {
	return { memory_id: id, memory_type: type, created_on: on, content_md: body };
}

test('the free search finds words in the loaded rows and reaches nothing', () => {
	const rows = [
		record({ id: 'mem_a', title: 'Kettle descaling runs on the first Monday' }),
		record({ id: 'mem_b', title: 'The greenhouse thermostat is set by hand' }),
	].map(toRow);

	// Every typed word must appear. AND, not OR — the box is used to narrow.
	assert.deepEqual(
		findTheseWords(rows, 'kettle monday').map((row) => row.memory_id),
		['mem_a'],
	);
	assert.deepEqual(findTheseWords(rows, 'kettle greenhouse'), []);
	// An empty query finds nothing rather than everything: "no words typed" and "every memory
	// matches" are different answers, and the screen says different things about them.
	assert.deepEqual(findTheseWords(rows, '   '), []);
});

test('the served rows keep the engine’s order and are never re-sorted or dropped', () => {
	const result = {
		selected_hits: [hit({ id: 'mem_c' }), hit({ id: 'mem_a' }), hit({ id: 'mem_b' })],
	};
	const served = rankedRows(result, { rows: [], relations: null });
	assert.deepEqual(
		served.map((row) => [row.rank, row.memory_id]),
		[
			[1, 'mem_c'],
			[2, 'mem_a'],
			[3, 'mem_b'],
		],
		'The order the engine served IS the rank. A row re-sorted or removed on the way through ' +
			'would break the only claim this screen makes.',
	);
});

test('a served memory a later one corrects is dimmed and named, never dropped', () => {
	const records = [
		record({ id: 'mem_old', title: 'Deliveries are left at the side gate' }),
		record({
			id: 'mem_new',
			title: 'Deliveries now go to the porch',
			corrections: [{ handle: 'mem_old', says: 'the side gate was locked' }],
		}),
	];
	const rows = records.map(toRow);
	const relations = relationIndex(rows);

	const served = rankedRows({ selected_hits: [hit({ id: 'mem_old' })] }, { rows, relations });

	assert.equal(served.length, 1, 'a corrected memory that WAS served must still be shown');
	assert.equal(served[0].superseded, true);
	assert.deepEqual(served[0].answered_by, [
		{ memory_id: 'mem_new', title: 'Deliveries now go to the porch' },
	]);
	// The title comes from the listing, not from re-parsing the served prose, so the screen has one
	// spelling of every title rather than two.
	assert.equal(served[0].title, 'Deliveries are left at the side gate');
	assert.equal(served[0].in_listing, true);
});

test('a served memory the listing does not hold is shown, and marked as unopenable', () => {
	// The listing may be scoped to a project while the question was asked more widely, so a served
	// memory that is not in it is a real state rather than an error — but it cannot be opened, and
	// the screen must know that rather than render a row that does nothing.
	const served = rankedRows({ selected_hits: [hit({ id: 'mem_z', body: '# A tally of jars\n' })] }, {});
	assert.equal(served[0].in_listing, false);
	assert.equal(served[0].title, 'A tally of jars', 'the served prose is the fallback title');
});

test('THE BUDGET SENTENCE IS READ OFF THE OMISSIONS, NEVER OFF THE BAR', () => {
	// This is the assertion the whole file exists for.
	//
	// A result can sit at a third of its budget and still have dropped a memory that would not have
	// fitted whole. A sentence inferred from the fill of the bar says "room to spare, so nothing was
	// dropped for size" about exactly that result — confidently, in the one place in this product
	// whose entire promise is that it reports what the agent really got.
	const roomy = {
		context_bytes: 10_650,
		maximum_context_bytes: 32_768,
		omissions: [{ memory_id: 'mem_a', reason: 'no_positive_marginal_value' }],
	};
	const roomyRead = budgetReading(roomy);
	assert.ok(roomyRead.fraction < 0.4, 'the bar is a third full');
	assert.equal(roomyRead.dropped_for_size, 0);
	assert.equal(roomyRead.sentence, 'Room to spare, so nothing was dropped for size.');

	const tight = {
		context_bytes: 10_650,
		maximum_context_bytes: 32_768,
		omissions: [
			{ memory_id: 'mem_a', reason: 'context_byte_budget' },
			{ memory_id: 'mem_b', reason: 'no_positive_marginal_value' },
		],
	};
	const tightRead = budgetReading(tight);
	assert.equal(
		tightRead.fraction.toFixed(3),
		roomyRead.fraction.toFixed(3),
		'the bar is identical in both results — which is the point',
	);
	assert.equal(tightRead.dropped_for_size, 1);
	assert.equal(tightRead.sentence, 'The budget filled, so one more memory was dropped for size.');
});

test('"room to spare" is not printed under a bar that is full', () => {
	// Measured on a real vault: 31.5 KB of a 32 KB budget, no omission carrying a size reason. Both
	// halves of "Room to spare, so nothing was dropped for size" were defensible and the sentence
	// still contradicted the bar drawn immediately above it.
	const full = { context_bytes: 32_248, maximum_context_bytes: 32_768, omissions: [] };
	const read = budgetReading(full);
	assert.ok(read.fraction > 0.9, 'the bar is drawn full');
	assert.equal(read.dropped_for_size, 0);
	assert.ok(
		!read.sentence.includes('Room to spare'),
		`a full bar still said: ${read.sentence}`,
	);
	assert.ok(
		read.sentence.includes('nothing was dropped for size'),
		'the evidenced half of the sentence must survive the fix',
	);
});

test('a budget that was asked for and not granted is reported, and the bar uses the granted one', () => {
	const read = budgetReading({
		context_bytes: 4_096,
		maximum_context_bytes: 8_192,
		requested_maximum_context_bytes: 32_768,
		omissions: [],
	});
	assert.equal(read.max, 8_192, 'the bar is drawn against what applied');
	assert.equal(read.requested, 32_768, 'and what was asked for is said in words');
	assert.equal(read.fraction, 0.5);

	// When they agree there is nothing to say, and a note that is always on screen is not read.
	const same = budgetReading({
		context_bytes: 10,
		maximum_context_bytes: 100,
		requested_maximum_context_bytes: 100,
		omissions: [],
	});
	assert.equal(same.requested, null);
});

test('"why these" does not claim a cut that did not happen', () => {
	// The approved drawing reads "…then cut to fit the budget above" beside a card reading "Room to
	// spare, so nothing was dropped for size". Both cannot be true of one result, so the clause is
	// printed for the result it describes and dropped for the one it does not.
	const cut = whyThese({ omissions: [{ memory_id: 'mem_a', reason: 'context_byte_budget' }] });
	assert.match(cut, /cut to fit the budget above\.$/);

	const uncut = whyThese({ omissions: [] });
	assert.doesNotMatch(uncut, /cut to fit/);
	assert.match(uncut, /fitted inside the budget\.$/);
});

test('an omission reason this build has never seen is shown, not swallowed', () => {
	// A memory left out for a reason this build does not recognise is the most interesting row on
	// the screen. Bucketing it into "other" would make a new engine behaviour invisible in exactly
	// the product whose promise is to show what the agent was given.
	assert.equal(omissionWords('context_byte_budget'), 'did not fit the context budget');
	assert.match(omissionWords('a_reason_from_a_later_engine'), /a_reason_from_a_later_engine/);
	assert.match(omissionWords(undefined), /no reason given/);

	const rows = [record({ id: 'mem_a', title: 'The loft hatch sticks in damp weather' })].map(toRow);
	const omitted = omittedRows(
		{
			omissions: [
				{ memory_id: 'mem_a', reason: 'context_byte_budget' },
				{ memory_id: 'mem_gone', reason: 'no_positive_marginal_value' },
			],
		},
		{ rows },
	);
	assert.equal(omitted[0].title, 'The loft hatch sticks in damp weather');
	assert.equal(omitted[1].title, null, 'an id with no row behind it is named as an id');
	assert.equal(omitted[1].in_listing, false);
});

test('AN ANSWER THIS BUILD CANNOT READ IS NOT AN EMPTY ANSWER', () => {
	// THE REGRESSION THIS FILE OWES ITS EXISTENCE TO.
	//
	// The ask route answers with the sidecar's standard envelope and the ranked answer sits in its
	// `data`. The screen read the envelope itself. Nothing threw and nothing logged: every field was
	// `undefined`, every reading turned that into a zero, and the screen rendered "your agent would
	// have been given nothing for this" and "0 bytes of 0 bytes — room to spare, so nothing was
	// dropped for size" over a vault holding 351 memories.
	//
	// A screen whose entire promise is "this is exactly what your agent would have been given" had
	// said it about an object it had never read. So the shape is checked rather than assumed, and the
	// two readings that would spell the absence as a zero refuse instead.
	const envelope = {
		outcome: 'ok',
		exit_code: 0,
		data: { selected_hits: [], maximum_context_bytes: 32_768, context_bytes: 0, omissions: [] },
		results: null,
		provenance: null,
		duration_ms: 812,
	};

	assert.equal(
		isRankedAnswer(envelope),
		false,
		'The envelope must not pass for a ranked answer. It is the exact object that produced a ' +
			'confident and completely false empty result.',
	);
	assert.equal(isRankedAnswer(envelope.data), true, 'the answer inside it is the real one');

	// A refusal envelope carries neither, and a listing carries no budget. Both must be refused too,
	// or the check only catches the one shape that has already burned us.
	assert.equal(isRankedAnswer({ outcome: 'refusal', data: null }), false);
	assert.equal(isRankedAnswer({ memories: [], selected_hits: [] }), false);
	assert.equal(isRankedAnswer(null), false);

	// And the readings themselves refuse rather than answering zero, so a caller that skips the
	// check above still cannot render "0 bytes of 0 bytes" over a vault that returned an answer.
	const read = budgetReading(envelope);
	assert.equal(read.used, null, 'no context_bytes here means NO READING, not a reading of zero');
	assert.equal(read.max, null);
	assert.equal(
		read.sentence,
		null,
		'"Room to spare, so nothing was dropped for size" is the sentence that made an unread ' +
			'answer look like a healthy empty one. There must be no sentence at all.',
	);
});

test('the caption counts what was served and what was left out', () => {
	assert.equal(servedCaption({ selected_hits: [1, 2, 3, 4], omissions: [] }, { pool: 349 }), '4 of 349 · nothing left out');
	assert.equal(
		servedCaption({ selected_hits: [1], omissions: [{ memory_id: 'm' }] }, { pool: 12 }),
		'1 of 12 · 1 left out',
	);
	// With no pool to compare against, the count stands alone rather than borrowing a denominator
	// from somewhere it does not belong.
	assert.equal(servedCaption({ selected_hits: [1, 2], omissions: [] }), '2 · nothing left out');
});

test('the ranking disclosure shows the controls the engine echoed, and invents no score', () => {
	const controls = rankingControls({ search: { candidate_pool: 200, ledger: true, top_k: 8 } });
	assert.deepEqual(controls, [
		{ name: 'candidate_pool', value: '200', words: 'looked at 200 candidates' },
		{ name: 'ledger', value: 'true', words: 'recorded the read in the vault' },
		{ name: 'top_k', value: '8', words: 'kept up to 8' },
	]);
	// The name and the value stay spelled the way the engine spells them — a renamed control cannot
	// be looked up in the engine's own schema — and the SENTENCE is added beside them, not instead
	// of them. `candidate_pool 200` as a bare label was an identifier the owner would have to ask
	// about; a control this build has no words for is drawn as the engine spells it.
	assert.deepEqual(controlWords('rerank_depth', 3), 'rerank_depth 3');
	assert.deepEqual(controlWords('candidate_pool', 'many'), 'candidate_pool many');
	assert.deepEqual(rankingControls({}), []);
});

test('bytes are drawn the way the mockups draw them', () => {
	assert.equal(bytesLabel(32_768), '32 KB');
	assert.equal(bytesLabel(10_650), '10.4 KB');
	assert.equal(bytesLabel(2_150), '2.1 KB');
	// Below a kilobyte it stays in bytes. "0.0 KB" over a real two-hundred-character memory reads
	// as a failure to load it.
	assert.equal(bytesLabel(240), '240 bytes');
	assert.equal(bytesLabel(null), null);
});

test('a served memory’s size is its own bytes, measured as bytes and not as characters', () => {
	// An emoji or an accented name is more bytes than characters, and the context budget the bar is
	// drawn against is counted in bytes. Measuring the row in characters would make a memory full of
	// them look smaller than the budget it actually spent.
	const served = rankedRows({ selected_hits: [hit({ id: 'mem_a', body: 'café' })] }, {});
	assert.equal(served[0].bytes, 5, '"café" is four characters and five bytes');
});

/* --------------------------------------------------------------------------------------------
 * THE HALF OF THE INVARIANT THE SERVER CANNOT SEE.
 *
 * `test/server.test.mjs` proves that no ROUTE reaches ranked search, and that the one that does
 * moves the exposure count by exactly one when it is pressed. What it cannot see is the BROWSER:
 * a `useEffect` calling the ask endpoint on mount would satisfy every assertion in that file and
 * still record a permanent exposure row every single time the search screen was opened.
 *
 * So the client half is asserted as a property of the shipped source, the way `test/wiring.test.mjs`
 * asserts reachability. Nothing here starts a server or renders anything.
 * ------------------------------------------------------------------------------------------ */

const APP_DIR = new URL('../src/app/', import.meta.url);

/**
 * A file's CODE, with its comments removed.
 *
 * Every check below asks whether the source DOES something, and a comment saying the source must
 * never do that thing contains the same words. Reading the raw text made this file fail on its own
 * subject's documentation — which is the mild version of the failure that matters: a check that
 * matches prose can also be SATISFIED by prose, so a screen could lose its guard and keep passing
 * because the comment describing the guard was still there.
 */
function appCode(name) {
	return readFileSync(new URL(name, APP_DIR), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('exactly one file calls the ranked door, and it is the search screen', () => {
	const callers = readdirSync(APP_DIR)
		.filter((name) => name.endsWith('.jsx') || name.endsWith('.mjs'))
		// `api.mjs` DEFINES it; a definition is not a call site.
		.filter((name) => name !== 'api.mjs')
		.filter((name) => /\baskRanked\b/.test(appCode(name)));

	assert.deepEqual(
		callers,
		['SearchView.jsx'],
		'"Never from any other screen" is this assertion. A second file naming the ranked door is a ' +
			'second place a permanent exposure row can be written into the user\'s vault, and every ' +
			'server-side test in this suite would still pass.',
	);
});

test('the ranked door is not called on load, on a poll, on a keystroke or on a refresh', () => {
	const source = appCode('SearchView.jsx');

	// One call site. Not two, and not one plus a retry.
	const calls = [...source.matchAll(/\baskRanked\s*\(/g)];
	assert.equal(
		calls.length,
		1,
		`The search screen calls the ranked door ${calls.length} times. Each call is a permanent ` +
			`record of a read the user did not perform; the press is one.`,
	);

	// NEVER ON LOAD. An effect is by definition a call that happens because the component
	// rendered, which is exactly what "on load" means. This screen has no effects at all, so the
	// check is the strong one rather than a search for the call inside them.
	assert.equal(
		/\buseEffect\b/.test(source),
		false,
		'The search screen has an effect. An effect runs because the component rendered — that is ' +
			'"on load" — so the ranked door and effects must not share a file.',
	);

	// NEVER ON A POLL. Nothing on this screen is on a timer.
	for (const timer of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
		assert.equal(
			source.includes(timer),
			false,
			`The search screen uses ${timer}. A ranked search on a timer is a poll, and a poll is ` +
				`an exposure row per tick.`,
		);
	}

	// NEVER ON A KEYSTROKE. The box's `onChange` sets state and nothing else; the only call sits
	// in `onAsk`, which is reached from a click on a real button.
	const askHandler = source.slice(source.indexOf('const onAsk'), source.indexOf('}, [query, project'));
	assert.ok(
		askHandler.includes('askRanked('),
		'the one call must be inside onAsk, which is what the button presses',
	);
	assert.equal(
		/onChange[^\n]*askRanked/.test(source),
		false,
		'A keystroke reaches the ranked door.',
	);

	// AND THE FORM SUBMITS THE FREE SEARCH. Enter in a text field is a keystroke, so the box that
	// most looks like it would ask is wired to the search that writes nothing.
	const box = appCode('ui/search.jsx');
	const submit = box.slice(box.indexOf('onSubmit={'), box.indexOf('<Search size={16}'));
	assert.ok(submit.includes('onFind?.()'), 'the form submits the free search');
	assert.equal(submit.includes('onAsk'), false, 'pressing Enter must not reach the ranked door');
});

/*
  THE SCREEN STOPS CLAIMING CURRENCY WHEN THE QUESTION MOVES.

  Found by driving the built app: type a follow-up over the question, and the box showed the new
  words while the panel below still showed the old answer — under a banner asserting it was
  "exactly what it would have been given for this question". The input updated, the count did not,
  and nothing on screen was dimmed or disabled. The one screen whose purpose is not misdescribing
  what the agent sees was stating the only false thing available to it.

  These assert the property rather than the mechanism: whether the answer on screen still answers
  the question in the box.
*/
test('is not stale while the question is the one that produced it', () => {
	assert.equal(answerIsStale({ asked_for: 'why is the cache cold' }, 'why is the cache cold'), false);
	});

test('is stale the moment the question in the box differs', () => {
	assert.equal(answerIsStale({ asked_for: 'why is the cache cold' }, 'retention policy'), true);
	});

test('treats trailing space as the same question, because it is', () => {
	assert.equal(answerIsStale({ asked_for: 'why is the cache cold' }, 'why is the cache cold  '), false);
	});

test('an empty screen is never stale — there is nothing on it to be wrong about', () => {
	assert.equal(answerIsStale(null, 'anything at all'), false);
	});

test('an answer that never recorded its question reads as stale rather than as current', () => {
		// Failing closed: an answer we cannot prove is current must not claim to be.
		assert.equal(answerIsStale({}, 'why is the cache cold'), true);
	});
