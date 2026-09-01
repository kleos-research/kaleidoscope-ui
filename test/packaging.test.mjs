// M8: the app makes no network call, and the notices file says what actually shipped.
//
// Two claims that are cheap to make and expensive to check, so both are checked here mechanically
// rather than asserted in a README.
//
// **Offline.** The product's whole pitch is that it runs on one machine and calls nothing. A CDN
// script tag, a webfont, an analytics beacon or an update check would each break that, and none of
// them breaks anything a person would notice while they had a network — which is why this is a test
// and not a code review. The instrument is a grep over the BUILT bundle, and its interesting half
// is what it does with the URLs that remain: a page may legitimately contain an absolute URL that
// nothing loads (an XML namespace, a documentation link a reader may click), so "no absolute URL"
// is the wrong assertion — it would either be false or force the removal of harmless text. The
// assertion is that every remaining URL is INERT, and inert is defined as: not the argument of any
// construct that fetches.
//
// The scanner has a planted-fixture self-test below, because a scanner that has never been watched
// to fail is a sentiment with a filename — and a negative check like this one passes hardest at the
// moment it is most broken.
//
// **Notices.** `THIRD_PARTY_NOTICES.md` is generated from what the bundler actually put into
// `dist/`. This asserts the committed file is what the generator would write today, so a
// dependency bump that changes a version or adds a library turns this red instead of shipping an
// attribution file that is quietly a version out of date.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { generateNotices } from '../scripts/third-party-notices.mjs';
import { packageNameFor } from '../vite.config.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'dist');

// ---------------------------------------------------------------------------------------------
// The scanner, as pure functions
// ---------------------------------------------------------------------------------------------

/** Every absolute http(s) URL in a text, with the 48 characters that precede it. */
export function absoluteUrls(text) {
	const found = [];
	const pattern = /https?:\/\/[^\s"'`\\)<>,;]{2,}/g;
	for (const match of text.matchAll(pattern)) {
		found.push({
			url: match[0],
			index: match.index,
			before: text.slice(Math.max(0, match.index - 48), match.index),
		});
	}
	return found;
}

/**
 * The constructs that turn a URL into a request.
 *
 * Deliberately broader than what this app uses. The question is not "does the code I wrote fetch
 * something" — it is "could anything in a 950 kB bundle I did not write". Each entry matches the
 * text immediately BEFORE a URL, which is where every one of these puts it.
 */
const LOADS = [
	{ name: 'fetch', re: /\bfetch\s*\(\s*["'`]$/ },
	{ name: 'XMLHttpRequest.open', re: /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["'`]$/ },
	{ name: 'a WebSocket', re: /\bWebSocket\s*\(\s*["'`]$/ },
	{ name: 'an EventSource', re: /\bEventSource\s*\(\s*["'`]$/ },
	{ name: 'sendBeacon', re: /\bsendBeacon\s*\(\s*["'`]$/ },
	{ name: 'importScripts', re: /\bimportScripts\s*\(\s*["'`]$/ },
	{ name: 'a dynamic import', re: /\bimport\s*\(\s*["'`]$/ },
	{ name: 'an element src', re: /\bsrc\s*=\s*["'`]?$/ },
	{ name: 'a stylesheet or preconnect href', re: /\bhref\s*=\s*["'`]?$/ },
	{ name: 'a CSS url()', re: /\burl\s*\(\s*["']?$/ },
	{ name: 'a CSS @import', re: /@import\s+["']$/ },
];

/** The absolute URLs in a text that something would actually load. Empty means offline-safe. */
export function loadedUrls(text) {
	const loaded = [];
	for (const hit of absoluteUrls(text)) {
		const construct = LOADS.find((candidate) => candidate.re.test(hit.before));
		if (construct) loaded.push({ url: hit.url, construct: construct.name });
	}
	return loaded;
}

/**
 * The absolute URLs a build may contain, each with the reason it is inert.
 *
 * This is a small allow list and it is safe to be one BECAUSE the inertness test above runs
 * independently of it: a URL on this list that something starts loading is caught by `loadedUrls`,
 * not by this table. What this table is for is the second question — whether a new outbound-looking
 * string arrived that nobody has looked at.
 */
const INERT_URLS = [
	{
		prefix: 'http://www.w3.org/',
		why: 'an XML namespace identifier. It is compared as a string by createElementNS and is never dereferenced.',
	},
	{
		prefix: 'https://react.dev/errors/',
		why: 'the text of a console message explaining a minified React error. A person may click it; nothing on the page does.',
	},
];

// ---------------------------------------------------------------------------------------------
// The scanner can fail
// ---------------------------------------------------------------------------------------------

test('the offline scanner catches what it claims to', () => {
	// A gate nobody has watched fail is a sentiment. One planted fixture per construct.
	const planted = [
		'fetch("https://cdn.example.com/x.js")',
		'new WebSocket("https://telemetry.example.com/s")',
		'navigator.sendBeacon("https://analytics.example.com/hit")',
		'<script src="https://cdn.example.com/react.js"></script>',
		'<link rel="stylesheet" href="https://fonts.example.com/css2?family=X">',
		'@import "https://fonts.example.com/css2";',
		'@font-face{src:url(https://fonts.example.com/x.woff2)}',
		'x.open("GET", "https://update.example.com/latest")',
		'await import("https://cdn.example.com/late.js")',
	];
	for (const fixture of planted) {
		const loaded = loadedUrls(fixture);
		assert.equal(loaded.length, 1, `The scanner did not see the request in: ${fixture}`);
	}

	// And the other direction: an inert URL must NOT be reported, or the check is unusable and
	// would be silenced rather than fixed.
	for (const fixture of [
		'const NS = "http://www.w3.org/2000/svg";',
		'throw Error("see https://react.dev/errors/418 for the full message")',
		'// documented at https://example.com/why',
	]) {
		assert.deepEqual(loadedUrls(fixture), [], `The scanner reported an inert URL in: ${fixture}`);
	}
});

test('the bundled-package name reader handles the shapes it meets', () => {
	assert.equal(packageNameFor('/a/node_modules/react/index.js'), 'react');
	assert.equal(packageNameFor('/a/node_modules/@scope/name/lib/x.js'), '@scope/name');
	// Nested installs: the LAST node_modules is the one that owns the file.
	assert.equal(packageNameFor('/a/node_modules/x/node_modules/y/i.js'), 'y');
	assert.equal(packageNameFor('/repo/src/app/App.jsx'), null);
});

// ---------------------------------------------------------------------------------------------
// The built app
// ---------------------------------------------------------------------------------------------

/**
 * `dist/` is a precondition, and its absence is a FAILURE rather than a skip.
 *
 * A test that skips when the thing it guards is missing reports green for a build nobody scanned,
 * and this is the check for a class of defect — an added CDN tag — that a developer with a working
 * network never sees.
 */
function builtFiles() {
	assert.ok(
		existsSync(join(DIST, 'index.html')),
		'There is no built page in dist/. Run `npm run build` — this test does not scan what it cannot see.',
	);
	const files = ['index.html'];
	for (const entry of readdirSync(join(DIST, 'assets'))) files.push(`assets/${entry}`);
	return files;
}

test('the built app loads nothing over the network', () => {
	const files = builtFiles();
	// The bundle is not small and an assertion that scanned an empty list would pass. Say what was
	// read, and require that it was something.
	assert.ok(files.length >= 2, `dist/ holds only ${files.join(', ')}.`);

	let bytes = 0;
	for (const file of files) {
		const text = readFileSync(join(DIST, file), 'utf8');
		bytes += text.length;

		const loaded = loadedUrls(text);
		assert.deepEqual(
			loaded.map((hit) => `${hit.construct} → ${hit.url}`),
			[],
			`dist/${file} loads something over the network.`,
		);

		for (const hit of absoluteUrls(text)) {
			const inert = INERT_URLS.find((entry) => hit.url.startsWith(entry.prefix));
			assert.ok(
				inert,
				`dist/${file} contains ${hit.url}, which is not on the inert list. If nothing loads ` +
					`it, add it there with the reason; if something does, the previous assertion would ` +
					`have caught it and this one is telling you it is new.`,
			);
		}
	}
	assert.ok(bytes > 100_000, `Only ${bytes} bytes of built output were scanned; that is not the app.`);
});

test('the page pulls every asset from its own origin', () => {
	const html = readFileSync(join(DIST, 'index.html'), 'utf8');
	const references = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)].map((match) => match[1]);
	assert.ok(references.length > 0, 'The built page references no assets at all.');
	for (const reference of references) {
		assert.ok(
			reference.startsWith('/') || reference.startsWith('./') || reference.startsWith('data:'),
			`The built page references ${reference}, which is not same-origin.`,
		);
	}
	// A webfont is the commonest accidental network call in a local app, and it is invisible to
	// anyone who has the font cached. There is no font file in the tarball and no font host in it.
	assert.equal(
		/fonts\.(googleapis|gstatic|bunny|adobe)\.com|typekit|@font-face/i.test(html),
		false,
		'The built page reaches for a webfont.',
	);
});

test('the shipped server contains no network client and no update check', () => {
	// The browser half is covered above, by scanning what it compiled to. This is the other half:
	// the Node process. It runs an HTTP SERVER on loopback and must never be an HTTP client.
	const shipped = [];
	for (const directory of ['src/engine', 'src/server', 'src/shared', 'bin']) {
		for (const entry of readdirSync(join(REPO, directory), { withFileTypes: true })) {
			if (entry.isFile()) shipped.push(`${directory}/${entry.name}`);
		}
	}
	assert.ok(shipped.length > 10, `Only ${shipped.length} shipped files were scanned.`);

	// A URL LITERAL is not the instrument here, and using one would be the wrong test: these files
	// legitimately print a loopback URL and legitimately discuss one in prose, and a pattern that
	// tries to tell those apart from an outbound call ends up being silenced rather than fixed.
	// A URL cannot make a request without one of these constructs, so these are what is denied.
	const clients = [
		{ name: 'fetch()', re: /(?<![.\w])fetch\s*\(/ },
		{ name: 'node:https', re: /node:https/ },
		{ name: 'node:dns', re: /node:dns/ },
		{ name: 'an outbound http request', re: /\b(?:https?|axios|got|undici)\s*\.\s*(?:request|get)\s*\(/ },
		{ name: 'a WebSocket or EventSource', re: /\b(?:WebSocket|EventSource)\s*\(/ },
		// The update check that is not there. Named explicitly because its absence is a decision —
		// a product whose claim is that it makes no network call cannot phone home to ask whether
		// it is current — and an absence nobody asserts is an absence that gets filled in.
		{ name: 'a package-registry host', re: /registry\.npmjs\.org|api\.github\.com/ },
	];

	for (const file of shipped) {
		const text = readFileSync(join(REPO, file), 'utf8');
		for (const client of clients) {
			assert.equal(
				client.re.test(text),
				false,
				`${file} contains ${client.name}. Nothing this package ships may make a network call.`,
			);
		}
	}
});

test('the shipped server imports nothing but node builtins and its own files', () => {
	// The source-side half of `"dependencies": {}`. The release test asserts the INSTALL adds one
	// package; this asserts the code could not use a second one if it were there. Two instruments,
	// because the failure they cover arrives from two directions: a manifest edit, and an import
	// added months before anyone thinks about the manifest.
	const shipped = [];
	for (const directory of ['src/engine', 'src/server', 'src/shared', 'bin']) {
		for (const entry of readdirSync(join(REPO, directory), { withFileTypes: true })) {
			if (entry.isFile()) shipped.push(`${directory}/${entry.name}`);
		}
	}

	const specifiers = [];
	for (const file of shipped) {
		const text = readFileSync(join(REPO, file), 'utf8');
		for (const match of text.matchAll(/^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gm)) {
			specifiers.push({ file, specifier: match[1] });
		}
		for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) {
			specifiers.push({ file, specifier: match[1] });
		}
	}
	assert.ok(specifiers.length > 20, `Only ${specifiers.length} imports were found; that is not the tree.`);

	for (const { file, specifier } of specifiers) {
		assert.ok(
			specifier.startsWith('node:') || specifier.startsWith('.'),
			`${file} imports "${specifier}", which is neither a node: builtin nor a file in this ` +
				'package. A runtime dependency is a download the user waits through on first launch, ' +
				'on every machine.',
		);
	}
});

// ---------------------------------------------------------------------------------------------
// The notices file
// ---------------------------------------------------------------------------------------------

test('THIRD_PARTY_NOTICES.md is what the build says it should be', () => {
	const path = join(REPO, 'THIRD_PARTY_NOTICES.md');
	assert.ok(existsSync(path), 'THIRD_PARTY_NOTICES.md is missing and the tarball declares it.');

	const wanted = generateNotices();
	const current = readFileSync(path, 'utf8');

	if (current !== wanted) {
		// Name the first difference. "They differ" over a 200-line generated file is a failure
		// nobody can act on without running the generator by hand to find out what changed.
		const before = current.split('\n');
		const after = wanted.split('\n');
		const at = before.findIndex((line, index) => line !== after[index]);
		assert.fail(
			`THIRD_PARTY_NOTICES.md is stale from line ${at + 1}.\n` +
				`  on disk:   ${before[at] ?? '(end of file)'}\n` +
				`  generated: ${after[at] ?? '(end of file)'}\n` +
				'  Run `npm run build && npm run notices` and commit the result.',
		);
	}

	// And the file is about something. A generator whose input went empty would produce a valid,
	// current, useless document, and the diff above would pass on it.
	const attributed = [...wanted.matchAll(/^## (\S+) (\S+)$/gm)];
	assert.ok(
		attributed.length >= 4,
		`Only ${attributed.length} packages are attributed. The bundle carries a graph library, its ` +
			'layout, and a UI runtime, so a list this short means the generator read the wrong input.',
	);
	for (const [, name, version] of attributed) {
		assert.match(version, /^\d+\.\d+\.\d+/, `${name} is attributed without a real version.`);
	}
});
