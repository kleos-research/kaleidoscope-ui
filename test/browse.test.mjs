// The browse screen's arithmetic: the order the list is in, and the headings written over it.
//
// WHY THIS FILE EXISTS. BrowseScale groups the list under time headings, and a heading is a CLAIM
// about the rows beneath it — "everything under this line was written today". `groupRows` states
// the rule in its own doc comment: a group is a contiguous run, so the claim holds only while the
// list is ordered by the same quantity the heading names. It was not. `SORTS.written` ordered on
// `semantic.sequence`, the vault's journal position, while the heading was computed from
// `semantic.created_on`, a date the writing agent supplies — and on 363 real memories those two
// disagree constantly. The live screen drew:
//
//     TODAY 3 · YESTERDAY 50 · AUGUST 14 · AUGUST 1 · YESTERDAY 1 · AUGUST 1 · YESTERDAY 1 …
//
// one heading per oscillation, most of them with no rows under them at all.
//
// The property below is the one that was missing, and it is stated as an invariant over the
// flattened list rather than as an expected order: NO BUCKET APPEARS TWICE. That is false for every
// ordering the ladder is not monotone in, and it stays true if the tie-break, the label wording or
// the bucket boundaries are ever changed.
//
// Every fixture here is invented. Nothing in this file is vault content.

import assert from 'node:assert/strict';
import test from 'node:test';

import { flattenGroups, groupRows, timeBucket } from '../src/app/browse-model.mjs';
import { SORTS } from '../src/app/records.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-02T12:00:00Z');
const dayBefore = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

/**
 * A row as `toRow` produces one, cut to the three fields the order and the ladder read.
 *
 * `sequence` is deliberately UNCORRELATED with `created_on` here, because that is the real
 * condition: an agent writing this afternoon files a memory dated three weeks ago, and the journal
 * position it lands at says nothing about the date on it.
 */
const row = (memory_id, created_on, sequence) => ({ memory_id, created_on, sequence });

const LIST = [
	row('mem_a', dayBefore(0), 3), // today
	row('mem_b', dayBefore(30), 9), // a month back, but written most recently of all
	row('mem_c', dayBefore(1), 8), // yesterday
	row('mem_d', dayBefore(31), 7),
	row('mem_e', dayBefore(1), 2),
	row('mem_f', dayBefore(4), 6), // earlier this week
	row('mem_g', dayBefore(30), 1),
	row('mem_h', dayBefore(0), 5),
];

const ladder = (rows, sort) =>
	flattenGroups(groupRows([...rows].sort(SORTS[sort].compare), { sort, now: NOW }))
		.filter((item) => item.kind === 'heading')
		.map((item) => item.label);

test('a time heading is written at most once, so it is a claim about every row under it', () => {
	for (const sort of ['written', 'written_asc']) {
		const labels = ladder(LIST, sort);
		assert.deepEqual(
			labels,
			[...new Set(labels)],
			`under "${sort}" the ladder oscillates: ${labels.join(' · ')}`,
		);
	}
});

test('the ladder runs newest to oldest, and reverses under the other direction', () => {
	assert.deepEqual(ladder(LIST, 'written'), ['Today', 'Yesterday', 'Earlier this week', 'August']);
	assert.deepEqual(ladder(LIST, 'written_asc'), [
		'August',
		'Earlier this week',
		'Yesterday',
		'Today',
	]);
});

test("a heading's count is the number of rows the reader can see under it", () => {
	const items = flattenGroups(
		groupRows([...LIST].sort(SORTS.written.compare), { sort: 'written', now: NOW }),
	);
	let heading = null;
	let seen = 0;
	const checked = [];
	for (const item of items) {
		if (item.kind === 'heading') {
			if (heading) checked.push([heading.label, heading.count, seen]);
			heading = item;
			seen = 0;
		} else seen += 1;
	}
	checked.push([heading.label, heading.count, seen]);
	for (const [label, claimed, actual] of checked) {
		assert.equal(claimed, actual, `"${label}" claims ${claimed} rows and has ${actual}`);
	}
});

test('the write order still breaks a tie inside one day, and the id breaks the rest', () => {
	const sameDay = [
		row('mem_z', dayBefore(0), 1),
		row('mem_y', dayBefore(0), 4),
		row('mem_x', dayBefore(0), 4),
	];
	assert.deepEqual(
		[...sameDay].sort(SORTS.written.compare).map((entry) => entry.memory_id),
		['mem_x', 'mem_y', 'mem_z'],
	);
});

test('two rows this app cannot date compare without producing NaN', () => {
	// `Array.prototype.sort` with a comparator that returns NaN is undefined behaviour, and an
	// `-Infinity` sentinel subtracts to exactly that. Both undated rows must fall through to the
	// tie-break instead.
	const undated = [row('mem_q', null, 2), row('mem_p', '', 2)];
	const compared = SORTS.written.compare(undated[0], undated[1]);
	assert.ok(Number.isFinite(compared), 'the comparator returned a non-finite value');
	assert.deepEqual(
		[...undated].sort(SORTS.written.compare).map((entry) => entry.memory_id),
		['mem_p', 'mem_q'],
	);
	assert.equal(timeBucket(null, NOW).key, 'undated');
});

// ---------------------------------------------------------------------------------------------
// The one string the product shortens, and the rule it keeps
// ---------------------------------------------------------------------------------------------
//
// A scope value on a headline used to be cut by a CSS ellipsis with the whole value on hover. It
// is now cut in code — from the front of a path, whole segments at a time, so the part that names
// the file survives — and drawn as a control that shows the whole value on a press. The shortener
// is the half that can be driven here; the control's job is only to draw what it returns.

test('a scope value is cut from the end that says least, and a short one is not cut at all', async () => {
	const { shortenScope } = await import('../src/app/records.mjs');

	assert.equal(shortenScope('ferry-timetable'), null, 'a value that fits was shortened');
	assert.equal(shortenScope('a'.repeat(28)), null, 'a value exactly at the limit was shortened');

	// A path keeps its tail: the file, then as many parent segments as fit under the limit.
	assert.equal(shortenScope('services/harbour/timetable/crossings/winter.yaml'), '…/crossings/winter.yaml');
	assert.equal(shortenScope('services/harbour/timetable/crossings/winter.yaml', 20), '…/winter.yaml');
	assert.equal(shortenScope('services/harbour/timetable/crossings/winter.yaml', 12), '…/winter.yaml');
	assert.equal(
		shortenScope('deploy/a-file-name-longer-than-the-whole-limit.yaml'),
		'…/a-file-name-longer-than-the-whole-limit.yaml',
		'a tail longer than the limit is still the tail — it is the part that names the file',
	);

	// Anything that is not a path is cut from the end, with the cut marked.
	const long = 'the winter timetable for the north jetty crossings';
	const cut = shortenScope(long);
	assert.ok(cut.endsWith('…') && cut.length <= 28, `cut to ${JSON.stringify(cut)}`);
	assert.ok(long.startsWith(cut.slice(0, -1)), 'the kept part is not the start of the value');
});
