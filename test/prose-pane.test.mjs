// The editor's words pane: the syntax it dims, and the one property that keeps it in register.
//
// The pane draws the body twice — once as a transparent textarea the browser edits, once as ink
// under it with the Markdown marks in the quieter colour — and the two must wrap at exactly the
// same places. That holds only if the segmenter gives back EVERY character it was handed, so the
// first test is the identity, over bodies shaped like the ones agents write, and the rest check
// that what it calls a mark is what the renderer treats as one and nothing else.
//
// Every body here is invented. Nothing in this file is vault content.

import assert from 'node:assert/strict';
import test from 'node:test';

import { markSyntax } from '../src/app/markdown-syntax.mjs';

const join = (segments) => segments.map((segment) => segment.text).join('');
const marks = (segments) => segments.filter((segment) => segment.mark).map((segment) => segment.text);
const words = (segments) => segments.filter((segment) => !segment.mark).map((segment) => segment.text);

const BODIES = [
	'',
	'One paragraph, no marks.',
	'# A heading\n\nA paragraph with `code`, **bold**, __bold__ and *italic* in it.\n',
	'- a bullet\n- another, with a [link](https://example.invalid/path) in it\n\n1. first\n2) second\n',
	'> a quote\n> continued\n\n---\n\nAfter the rule.',
	'```sh\nkscope --help  # not a heading\n- not a bullet\n```\n\nBack to prose.',
	'~~~\nan unterminated fence runs to the end\n# still not a heading',
	'Trailing spaces   \n\n\n   leading spaces, and a final newline\n',
	'*unbalanced **marks* stay *as typed',
	'   # not a heading: four spaces in',
];

test('the segmenter gives back every character it was handed', () => {
	for (const body of BODIES) {
		assert.equal(
			join(markSyntax(body)),
			body,
			`a character was dropped or changed in ${JSON.stringify(body)} — the ink would drift from the caret`,
		);
	}
	// And adjacent runs of one kind are coalesced, so the pane does not draw a span per character.
	for (const body of BODIES) {
		const segments = markSyntax(body);
		for (let index = 1; index < segments.length; index += 1) {
			assert.notEqual(segments[index].mark, segments[index - 1].mark, 'two adjacent segments share a kind');
		}
	}
});

test('what is dimmed is the mechanism, and the words between the marks are words', () => {
	const segments = markSyntax('# A heading\n\nSay `code`, **bold** and *italic*, then [a link](https://example.invalid/x).');
	assert.deepEqual(marks(segments), ['# ', '`', '`', '**', '**', '*', '*', '[', '](https://example.invalid/x)']);
	assert.ok(words(segments).join('').includes('code'), 'the contents of a code span were dimmed');
	assert.ok(words(segments).join('').includes('a link'), 'the label of a link was dimmed');
	assert.ok(!words(segments).join('').includes('https://'), 'a link target was drawn as words');

	const list = markSyntax('- one\n* two\n+ three\n1. four\n2) five\n> six\n---');
	assert.deepEqual(marks(list), ['- ', '* ', '+ ', '1. ', '2) ', '> ', '---']);
});

test('inside a fence nothing is syntax except the fence', () => {
	const segments = markSyntax('```sh\n# a comment\n- a dash\n**stars**\n```\n**bold**');
	assert.deepEqual(marks(segments), ['```sh', '```', '**', '**']);
	// An unterminated fence dims nothing after its opening line.
	assert.deepEqual(marks(markSyntax('~~~\n# heading\n**bold**')), ['~~~']);
});

test('a heading needs its space, and four spaces in is not a heading', () => {
	assert.deepEqual(marks(markSyntax('#hashtag')), []);
	assert.deepEqual(marks(markSyntax('    # indented')), []);
	assert.deepEqual(marks(markSyntax('###### six')), ['###### ']);
});
