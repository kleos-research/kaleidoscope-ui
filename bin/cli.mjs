#!/usr/bin/env node
//
// M1 has no server and no browser in it. This runs the preflight and prints what it found, which
// is the only claim a scaffold can make on a real machine: that the engine was located, that it
// answered, and that what it answered is legible before a single screen is built on it.
//
// The failure texts are a deliverable, not an afterthought — this is the most-read screen in the
// product's first five minutes — so this file prints the engine's own `message` verbatim and adds
// nothing around it.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBlockers, preflight } from '../src/engine/preflight.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Beyond this many entries, a nested reading is a document rather than a row. See `print`. */
const ENTRIES_PER_READING = 12;

const version = () => JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

const USAGE = `kaleidoscope-ui — a local browser for one Kaleidoscope memory vault.

  kaleidoscope-ui [options]

  --kscope <path>   use this engine instead of searching for one
  --json            print the preflight readings as JSON
  --version         print the version of this package
  --help            print this

This milestone runs the preflight and stops. There is no server and no page yet.
`;

function parse(argv) {
  const options = { enginePath: null, json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--kscope') {
      options.enginePath = argv[i + 1];
      i += 1;
      if (!options.enginePath || options.enginePath.startsWith('--')) {
        throw new Error('--kscope needs a path. Nothing was read, written or changed.');
      }
      options.enginePath = resolve(options.enginePath);
    } else throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
  }
  return options;
}

// Readings are printed as one flat, aligned table rather than as JSON, because their whole purpose
// is to be read by a person deciding whether to trust what comes next.
//
// Two readings are documents rather than values — the operation index is a screen of prose, and the
// write contract's field list is fifty-odd glosses — and enumerating either turns the table into
// something nobody reads. They are counted here and printed whole by --json, which is the record.
// The rule is on SIZE rather than on a list of names, so a reading that grows later is collapsed
// without anyone having to remember to add it, and one that shrinks starts printing again.
function print(readings) {
  const rows = [];

  const render = (value) => {
    if (value === null || value === undefined) return 'not recorded';
    if (Array.isArray(value)) return value.length === 0 ? 'none' : value.join(', ');
    const lines = String(value).split('\n');
    return lines.length > 1 ? `${lines.length} lines — see --json` : lines[0];
  };

  const walk = (value, prefix) => {
    for (const [key, child] of Object.entries(value)) {
      const label = prefix ? `${prefix}.${key}` : key;
      const isGroup = child !== null && typeof child === 'object' && !Array.isArray(child);
      if (!isGroup) {
        rows.push([label, render(child)]);
      } else if (Object.keys(child).length > ENTRIES_PER_READING) {
        rows.push([label, `${Object.keys(child).length} entries — see --json`]);
      } else {
        walk(child, label);
      }
    }
  };
  walk(readings, '');

  const width = rows.reduce((w, [label]) => Math.max(w, label.length), 0);
  process.stdout.write('\n');
  for (const [label, value] of rows) process.stdout.write(`  ${label.padEnd(width)}  ${value}\n`);
  process.stdout.write('\n');
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) return process.stdout.write(USAGE);
  if (options.version) return process.stdout.write(`${version()}\n`);

  const readings = await preflight({ explicit: options.enginePath });
  const blockers = launchBlockers(readings);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...readings, launch_blockers: blockers }, null, 2)}\n`);
  } else print(readings);

  // The readings all arrived; what stops the launch is a condition on this machine. It is a full
  // stop rather than a warning because `call` is the only door this product has: a shut gate or a
  // model-less build leaves nothing to list and nothing to edit, and an app that starts anyway is
  // one whose first useful action fails for a reason it already knew at launch.
  if (blockers.length > 0) {
    for (const blocker of blockers) process.stderr.write(`${blocker.message}\n\n`);
    // The licence stop keeps the engine's own code. It is the same refusal either way — caught in
    // the handshake here instead of halfway through the user's first edit — and reporting it as
    // something else would make the two look like different problems.
    process.exit(blockers.some((blocker) => blocker.code === 'unlicensed') ? 4 : 1);
  }
}

main().catch((error) => {
  // The engine's own refusals arrive here already written for a person. Printing anything around
  // them buries the sentence that fixes the machine.
  process.stderr.write(`${error.message}\n`);
  process.exit(Number.isInteger(error.exitCode) ? error.exitCode : 1);
});
