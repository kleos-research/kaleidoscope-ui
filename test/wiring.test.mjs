// The two failures that 197 tests could not see.
//
// M4, M5 and M6 were built by four agents who largely did not read each other's code, and the
// suite they left behind was green. Both defects below were in it, and neither is a defect in a
// function — each is a defect in the JOIN between two files that are individually correct:
//
//   1. **`MergeMemories` was exported and imported by nothing.** The composition screen, the plan
//      behind it, `runMerge`, and `POST /api/merges` were all written and all tested; the only
//      thing missing was a route into the component, so the merge screen could never appear. A
//      screen with no door is not a feature that is nearly finished — it is a mechanism that
//      reports as built and can never fire, and every test of the parts passes.
//
//   2. **The rename receipt offered every copy it kept as `<a href="/api/snapshots/…">`.** Every
//      route under `/api/` is gated on a bearer token, and a browser navigation carries no
//      Authorization header — so the app's own offer to go and look at a copy answered a bare 401.
//      The link read as wired and was not.
//
// Both are static properties of the shipped source, so both are checked here rather than by
// clicking. Nothing in this file starts a server, reads a vault or spawns an engine.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'src', 'app');

const appFiles = readdirSync(APP).filter((name) => name.endsWith('.jsx') || name.endsWith('.mjs'));
const sources = new Map(appFiles.map((name) => [name, readFileSync(join(APP, name), 'utf8')]));

/**
 * One file's top-level functions, each with the text of its own body.
 *
 * Cut at `function` declarations rather than parsed, which is enough here because every component
 * in this directory is one — and a component declared some other way would simply not be checked,
 * which is why the count is asserted below rather than assumed.
 */
function blocksIn(source) {
	const starts = [...source.matchAll(/^(?:export )?function (\w+)/gm)];
	return starts.map((match, index) => ({
		name: match[1],
		exported: match[0].startsWith('export'),
		body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
	}));
}

test('every screen this app exports has a door into it', () => {
	// REACHABILITY, not merely "somebody mentions the name". A component referenced only by a
	// sibling in its own file is wired if and only if that sibling is; `MergeMemories` is reached
	// through `MergeScreen`, and `MergeScreen` is reached from `App.jsx`. So the test walks each
	// file's own reference graph outwards from the names another file imports, which is exact — no
	// two blocks in one file share a name — and needs no list of screens to maintain.
	//
	// The entry point is named, because the thing that mounts it is outside this directory. It is
	// one name rather than a rule about names, so a second orphan cannot inherit the exemption.
	const MOUNTED_ELSEWHERE = new Set(['App']);
	const mount = readFileSync(join(APP, 'main.jsx'), 'utf8');

	const orphans = [];
	let checked = 0;

	for (const [file, source] of sources) {
		if (!file.endsWith('.jsx')) continue;
		const blocks = blocksIn(source);
		const others = [...sources].filter(([name]) => name !== file);

		// The roots: every block in this file that something else names, plus the mounted one.
		const reached = new Set();
		const queue = [];
		for (const block of blocks) {
			const named =
				MOUNTED_ELSEWHERE.has(block.name) ||
				others.some(([, text]) => new RegExp(`\\b${block.name}\\b`).test(text));
			if (named) {
				reached.add(block.name);
				queue.push(block);
			}
		}
		if (MOUNTED_ELSEWHERE.has('App') && file === 'App.jsx') {
			assert.match(mount, /\bApp\b/, 'App is not mounted by main.jsx');
		}

		// Outwards, one hop at a time, through what each reached block actually names.
		while (queue.length > 0) {
			const block = queue.pop();
			for (const candidate of blocks) {
				if (reached.has(candidate.name)) continue;
				if (new RegExp(`\\b${candidate.name}\\b`).test(block.body)) {
					reached.add(candidate.name);
					queue.push(candidate);
				}
			}
		}

		for (const block of blocks) {
			if (!block.exported || !/^[A-Z]/.test(block.name)) continue;
			checked += 1;
			if (!reached.has(block.name)) orphans.push(`${file}: ${block.name}`);
		}
	}

	// The check has to be capable of finding something. A regex that stopped matching would leave
	// this at zero and every assertion above would pass while checking nothing at all.
	assert.ok(checked > 10, `only ${checked} exported components were found in ${APP}`);

	assert.deepEqual(
		orphans,
		[],
		'these components are exported and reachable from nothing — a screen with no route is a ' +
			`mechanism that reports as built and can never fire:\n${orphans.join('\n')}`,
	);
});

test('nothing in this app offers a token-gated route as a link', () => {
	// A navigation — an `<a href>`, a `window.open`, a form action — is sent by the browser with no
	// Authorization header, and every route under `/api/` is refused without one. So an API path in
	// an href is not a link that needs fixing later; it is a control that answers 401 the first time
	// anybody presses it, and it looks correct in every review.
	//
	// The fetch helpers in `api.mjs` are how an API path is reached, and they are the only place one
	// may be spelled.
	const offenders = [];
	for (const [file, source] of sources) {
		if (file === 'api.mjs') continue;
		for (const [match] of source.matchAll(/href=\{?[^}\n]*['"`]\/api\//g)) {
			offenders.push(`${file}: ${match.trim()}`);
		}
		for (const [match] of source.matchAll(/(?:window\.open|action=)\s*\(?\s*['"`]\/api\//g)) {
			offenders.push(`${file}: ${match.trim()}`);
		}
	}

	assert.deepEqual(
		offenders,
		[],
		'these render an API path as a navigation, which the browser sends with no bearer token:\n' +
			offenders.join('\n'),
	);

	// And the check can fail. A regression that reinstated the snapshot link would look like this.
	const planted = `<a href="/api/snapshots/${'x'}">`;
	assert.equal([...planted.matchAll(/href=\{?[^}\n]*['"`]\/api\//g)].length, 1);
});

test('the one door to an API path carries the token, and it is the only one', () => {
	// The inverse of the test above, so the pair cannot both be satisfied by an app that reaches the
	// API from nowhere at all. `api.mjs` is where `/api/` is spelled, and every function there goes
	// through `get` or `post`, which attach the bearer token.
	const api = sources.get('api.mjs');
	const paths = [...api.matchAll(/['"`]\/api\/[^'"`]*/g)];
	assert.ok(paths.length >= 8, `api.mjs names only ${paths.length} routes`);

	for (const [, name] of api.matchAll(/^export (?:async )?function (\w+)/gm)) {
		if (name === 'captureToken') continue;
		const body = api.slice(api.indexOf(`function ${name}`));
		const stop = body.indexOf('\nexport ');
		const source = stop === -1 ? body : body.slice(0, stop);
		assert.match(
			source,
			/\b(get|post)\(/,
			`${name} reaches the sidecar without going through the two helpers that attach the token`,
		);
	}

	// No caller outside `api.mjs` may spell an API path at all — including through `fetch`, which
	// would bypass the token and the timeout together.
	for (const [file, source] of sources) {
		if (file === 'api.mjs') continue;
		assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} calls fetch directly instead of api.mjs`);
	}
});
