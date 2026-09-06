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

test('every word in the top bar names a route the router mints, at the hash it links to', () => {
	// THE ROW THAT COULD NEVER LIGHT UP. `Nav` decides `aria-current` by comparing each entry's
	// `route` with the name `routeFromHash` gave the open screen, and that name is minted in one
	// place. The curation queue is `#/decide` on the URL and `backlog` in the router; the table used
	// to say `decide`, so three words lit and the fourth never did — a screen a reader could be on
	// while the bar said they were nowhere. Not an error, not a crash, and nothing red said so.
	//
	// Read from both files rather than transcribed here, so a renamed route or a moved hash fails
	// this test instead of quietly parting the word from its screen again.
	const shell = readFileSync(join(APP, 'ui', 'shell.jsx'), 'utf8');
	const destinations = [
		...shell.matchAll(/\{ href: '([^']+)', route: '(\w+)', label: '([^']+)', key: '(\d)' \}/g),
	].map(([, href, route, label, key]) => ({ href, route, label, key }));
	assert.equal(destinations.length, 4, 'the bar carries four words; a fifth needs a drawing first');
	assert.deepEqual(
		destinations.map((entry) => entry.key),
		['1', '2', '3', '4'],
		'1–4 go where the four words go, in the order the words are read',
	);

	const app = sources.get('App.jsx');
	const router = app.slice(app.indexOf('function routeFromHash'), app.indexOf('export function App'));
	assert.ok(router.length > 0, 'routeFromHash is where every route name is minted');
	// Code only: a comment that mentions a hash reads nothing and mints nothing.
	const code = router.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));
	// The bare list is the router's fallthrough — the `: { name: … }` after the last ternary — rather
	// than a line that tests for `'#/'`, so it is read from that shape.
	const fallthrough = router.match(/\? \{ name: '\w+'[^\n]*: \{ name: '(\w+)' \};/);
	assert.ok(fallthrough, 'the router ends in a fallthrough that names the bare list');

	for (const { href, route, label } of destinations) {
		const escaped = href.replace(/\//g, '\\/');
		const at = code.findIndex((candidate) => candidate.includes(`'${href}'`) || candidate.includes(escaped));
		assert.ok(href === '#/' || at !== -1, `"${label}" links to ${href}, and no line of routeFromHash reads that hash`);
		// The name is minted on the line that reads the hash, or on the one right after it when the
		// read is a match held in a variable first — which is how the search hash is read.
		const line = href === '#/' ? fallthrough[0] : code.slice(at, at + 2).find((candidate) => candidate.includes('name:'));
		assert.ok(line, `"${label}" links to ${href}, and the line that reads it mints no route name`);
		assert.ok(
			line.includes(`name: '${route}'`),
			`"${label}" lights only when the router names ${href} '${route}', and the line that reads it says:\n  ${line.trim()}`,
		);
	}
});

test('the receipt’s way into “What removal cannot do” lets go of the receipt', () => {
	// A receipt's own link routed to #/limits and the route effect keeps `report` on that route on
	// purpose — so the same receipt re-rendered, minus the link, and the press did nothing visible.
	// `showLimits` is the one door to that route from a report, and it has to clear the report.
	const app = sources.get('App.jsx');
	const at = app.indexOf('const showLimits = useCallback(');
	assert.ok(at !== -1, 'showLimits is the callback that opens the escalation route');
	const body = app.slice(at, app.indexOf('}, []);', at));
	assert.ok(body.includes('setReport(null)'), 'showLimits clears the report before changing the route');
	assert.ok(body.includes("'#/limits'"), 'showLimits routes to the escalation screen');
});

test('the escalation screen is handed the memories the app resolved, under the name it reads', () => {
	// `App` passed `memories={…}` and the screen read `memory` — so the Remove it exists to offer,
	// with the no-copy note beside it, never rendered on the installed engine, for one memory or for
	// a bulk selection. Every test of the copy passed, because the copy was right.
	const app = sources.get('App.jsx');
	const limits = sources.get('RemovalLimits.jsx');
	const mount = app.slice(app.indexOf('<RemovalLimits'), app.indexOf('/>', app.indexOf('<RemovalLimits')));
	assert.match(mount, /memories=\{limitsMemories\}/, 'App hands the screen `memories`');
	assert.match(limits, /export function RemovalLimits\(\{[^}]*\bmemories\b/, 'the screen reads `memories`');
	assert.doesNotMatch(limits, /export function RemovalLimits\(\{[^}]*\bmemory\b[^}]*\}/, 'and not a singular `memory`');
	assert.ok(limits.includes('onRemove(listed)'), 'the Remove on it hands the whole selection back');
});

test('a hover on the overview repaints; only the frame and the layout refit the view', () => {
	// SIX WHEEL TICKS IN, CROSS ONE DOT, LEAVE IT: the canvas hashed identical to the opening fit.
	// `paint` is rebuilt on every hover and selection, `schedule` was rebuilt from it, and the fit
	// effect listed `schedule` — so a hover re-ran the fit and threw the reader's zoom and pan away.
	// The draw now lives in a ref the scheduler reads through, and the fit depends on the frame and
	// the layout only. Read from the source, because the property is in the dependency lists.
	const canvas = readFileSync(join(APP, 'ui', 'vault-canvas.jsx'), 'utf8');
	const scheduler = canvas.match(/const schedule = useCallback\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/);
	assert.ok(scheduler, 'the scheduler is a useCallback');
	assert.equal(scheduler[2].trim(), '', 'the scheduler depends on nothing, so it is never rebuilt');
	assert.match(scheduler[1], /paintRef\.current\(\)/, 'and it draws through the ref');
	const fit = canvas.match(/view\.current = \{\s*fit,[\s\S]*?\}, \[([^\]]*)\]\);/);
	assert.ok(fit, 'the fit effect sets view.current');
	const deps = fit[1].split(',').map((entry) => entry.trim()).filter(Boolean);
	assert.deepEqual(deps, ['size', 'layout', 'schedule'], 'the fit refits on the frame and the layout only');
	for (const forbidden of ['paint', 'hovered', 'selected', 'focus']) {
		assert.ok(!deps.includes(forbidden), `a change of ${forbidden} must not refit the view`);
	}
});
