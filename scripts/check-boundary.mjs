#!/usr/bin/env node
//
// The boundary gate.
//
// This repository is public and the engine it drives is not. A public git history cannot be
// un-pushed, so this runs before every push rather than before every release.
//
// Every rule is DERIVED from the tables in docs/BOUNDARY.md at run time. Nothing is transcribed.
// That is the whole design: a class added to that document with no rule behind it fails as a
// gate-integrity error, and a class removed from it takes its rule away with it, so the document
// and the gate cannot drift apart in either direction without going red.
//
// docs/BOUNDARY.md is the one exempt file. It has to spell out what it forbids.
//
// Exit 0 clean; 1 one or more hits; 2 the gate itself could not run. A gate that skips when it
// cannot see the tree passes hardest at the moment it is most broken, so there is no skip path.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOUNDARY_DOC = 'docs/BOUNDARY.md';

// Sibling public repositories in the same namespace. Everything else under it is a private crate
// until someone publishes it, so this list is deny-by-default and short on purpose.
const PUBLIC_SIBLINGS = ['sdk', 'docs', 'benchmarks'];

// A documentation example is not a machine trace. These stand in for a real account name.
const PLACEHOLDER_NAMES = new Set(['you', 'your-name', 'user', 'username', 'name', 'me', 'someone', 'runner']);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fail(message) {
  process.stderr.write(`boundary: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------- the document

function readClasses() {
  const path = join(ROOT, BOUNDARY_DOC);
  if (!existsSync(path)) fail(`${BOUNDARY_DOC} is missing; there is nothing to derive rules from.`);

  const section = readFileSync(path, 'utf8')
    .split(/^## /m)
    .find((s) => s.startsWith('Never lands here'));
  if (!section) fail(`${BOUNDARY_DOC} has no "Never lands here" section.`);

  const classes = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 2) continue;
    if (/^-+$/.test(cells[0]) || cells[0].toLowerCase() === 'class') continue;
    classes.push({
      name: cells[0],
      key: cells[0].toLowerCase(),
      tokens: [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]),
    });
  }
  if (classes.length === 0) fail(`${BOUNDARY_DOC}'s table yielded no classes.`);
  return classes;
}

// The project's own namespace, taken from the manifest so the gate holds no project literal.
function namespace() {
  const name = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name || '';
  const bare = name.split('/').pop();
  const cut = bare.indexOf('-');
  if (cut < 1) fail('package.json name has no namespace prefix to deny by default.');
  return { prefix: bare.slice(0, cut), own: bare.slice(cut + 1) };
}

// ---------------------------------------------------------------------------- rule builders
//
// A rule is { id, class, scope, ... }. scope 'path' judges the file's path; scope 'content'
// judges each line. `allow` lets a rule keep a legitimate case without weakening the pattern.

const REVIEW_ONLY = Symbol('review-only');

function engineSource({ name, tokens }) {
  if (tokens.length === 0) fail(`"${name}" names no literal to match; the gate would pass trivially.`);
  return tokens.flatMap((token) => {
    const id = `engine-source:${token}`;
    const isExtension = token.startsWith('.');
    const isDirectory = token.endsWith('/');
    const pathTest = isExtension
      ? (p) => p.endsWith(token)
      : isDirectory
        ? (p) => p.includes(token)
        : (p) => basename(p) === token;
    const re = new RegExp(escape(token) + (isExtension ? '(?![A-Za-z0-9_])' : ''), 'g');
    return [
      { id, class: name, scope: 'path', test: pathTest, note: `a path naming ${token}` },
      { id, class: name, scope: 'content', re, note: `${token} cited in text` },
    ];
  });
}

function engineInternals({ name }, ns) {
  // Module and symbol names cannot be enumerated without writing them down, which is the thing
  // being prevented. The namespace token is the checkable proxy: everything under it is refused
  // unless it is a repository the public can already read.
  const allowed = new Set([ns.own, ...PUBLIC_SIBLINGS]);
  return [{
    id: 'engine-internal:namespace',
    class: name,
    scope: 'content',
    re: new RegExp(ns.prefix + '[-_]([a-z][a-z0-9_-]*)', 'g'),
    allow: (m) => allowed.has(m[1]),
    note: 'a name under the project namespace that is not a public repository',
  }];
}

function internalDocuments({ name, tokens }, _ns) {
  const trees = tokens.filter((t) => /^docs\/[a-z-]+\/$/.test(t)).map((t) => t.split('/')[1]);
  if (trees.length === 0) fail(`"${name}" names no document tree; the gate would pass trivially.`);
  return [{
    id: 'internal-document:citation',
    class: name,
    scope: 'content',
    re: new RegExp(`docs/(${trees.join('|')})/([^\\s)\\]"'\`,;]*)`, 'g'),
    // This repository has trees of its own with the same names. A citation that resolves to a file
    // here is a reader following a link; one that does not is a disclosure of a tree they cannot open.
    allow: (m) => existsSync(join(ROOT, `docs/${m[1]}/${m[2].replace(/[.,;:]+$/, '')}`)),
    note: 'a citation into a document tree the reader cannot open',
  }];
}

function vaultContents({ name, tokens }) {
  const prefixes = tokens.filter((t) => /^[a-z]{2,8}_$/.test(t)).map((t) => t.slice(0, -1));
  const directories = tokens.filter((t) => /^\.[a-z][a-z0-9-]*\/$/.test(t));
  if (prefixes.length === 0 && directories.length === 0) {
    fail(`"${name}" names no identifier shape or directory; the gate would pass trivially.`);
  }
  const rules = directories.map((dir) => ({
    id: `vault-content:${dir}`,
    class: name,
    scope: 'path',
    test: (p) => (p + '/').includes('/' + dir),
    note: `a committed ${dir} directory`,
  }));
  if (prefixes.length > 0) {
    rules.push({
      id: 'vault-content:identifier',
      class: name,
      scope: 'content',
      re: new RegExp(`\\b(${prefixes.join('|')})_[0-9a-f]{8,}`, 'g'),
      note: 'an identifier minted inside a vault',
    });
  }
  return rules;
}

function machineTraces({ name, tokens }) {
  const roots = tokens
    .filter((t) => /^\/[A-Za-z]+\/<[a-z]+>\/$/.test(t))
    .map((t) => t.split('/')[1]);
  if (roots.length === 0) fail(`"${name}" names no home-directory root; the gate would pass trivially.`);
  return [{
    id: 'machine-trace:home',
    class: name,
    // The lookbehind keeps a URL path out of it: the leak is an absolute path, not example.com/home/x.
    re: new RegExp(`(?<![^\\s"'\`(=,:])/(${roots.join('|')})/([A-Za-z0-9._<>-]+)/`, 'g'),
    scope: 'content',
    allow: (m) => PLACEHOLDER_NAMES.has(m[2].toLowerCase()) || /^<.*>$/.test(m[2]),
    note: 'an absolute path under a real home directory',
  }];
}

const BUILDERS = {
  'engine source': engineSource,
  'engine internals by name': engineInternals,
  'internal documents': internalDocuments,
  'vault contents': vaultContents,
  'machine and build traces': machineTraces,
  'measured internals': REVIEW_ONLY,
};

// ---------------------------------------------------------------------------- the files
//
// Tracked files, plus files staged for a first commit that git does not track yet — the first push
// is the irreversible moment this gate exists for, and until it happens nothing here is tracked.

function publishableFiles() {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    fail('git could not list this tree. The gate does not guess at a file set; fix git and re-run.');
  }
  return out.split('\0').filter(Boolean);
}

// ---------------------------------------------------------------------------- the run

const ns = namespace();
const classes = readClasses();
const rules = [];
const reviewOnly = [];

for (const cls of classes) {
  const builder = BUILDERS[cls.key];
  if (!builder) {
    fail(
      `${BOUNDARY_DOC} names a class the gate does not implement: "${cls.name}".\n` +
      '        Add a rule for it in scripts/check-boundary.mjs, or the document forbids ' +
      'something nothing checks.',
    );
  }
  if (builder === REVIEW_ONLY) reviewOnly.push(cls.name);
  else rules.push(...builder(cls, ns));
}

const pathRules = rules.filter((r) => r.scope === 'path');
const contentRules = rules.filter((r) => r.scope === 'content');
const hits = [];
let scanned = 0;

for (const file of publishableFiles()) {
  if (file === BOUNDARY_DOC) continue;

  let stat;
  try {
    stat = statSync(join(ROOT, file));
  } catch {
    continue; // deleted between the listing and the read
  }
  if (!stat.isFile()) continue;

  for (const rule of pathRules) {
    if (rule.test(file)) hits.push({ file, line: 0, rule, excerpt: file });
  }

  const buffer = readFileSync(join(ROOT, file));
  if (buffer.includes(0)) continue; // not text; a text scanner has nothing to say about it
  scanned += 1;

  const lines = buffer.toString('utf8').split('\n');
  for (const rule of contentRules) {
    for (let i = 0; i < lines.length; i += 1) {
      for (const m of lines[i].matchAll(rule.re)) {
        if (rule.allow && rule.allow(m, file)) continue;
        hits.push({ file, line: i + 1, rule, excerpt: lines[i].trim().slice(0, 140), match: m[0] });
      }
    }
  }
}

const say = (s) => process.stdout.write(s + '\n');

if (hits.length > 0) {
  say('');
  for (const h of hits) {
    say(`${h.file}:${h.line}  ${h.rule.id}`);
    say(`    ${h.rule.class} — ${h.rule.note}`);
    say(`    ${h.excerpt}`);
  }
  say('');
  say(`boundary: ${hits.length} hit${hits.length === 1 ? '' : 's'} in ${new Set(hits.map((h) => h.file)).size} file${new Set(hits.map((h) => h.file)).size === 1 ? '' : 's'}.`);
  say(`This repository is public. Nothing above may be pushed. See ${BOUNDARY_DOC}.`);
  process.exit(1);
}

say(`boundary: clean — ${scanned} text files, ${rules.length} rules derived from ${BOUNDARY_DOC}.`);
if (reviewOnly.length > 0) {
  say(`No mechanical rule covers: ${reviewOnly.join(', ')}. A clean check is not a clean review.`);
}
