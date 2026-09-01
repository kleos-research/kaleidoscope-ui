#!/usr/bin/env node
//
// The launcher.
//
// It takes the readings, decides whether this machine can run the product at all, starts the
// sidecar, and prints one URL. Everything it does before the server starts is a full stop rather
// than a warning: `call` is the only door this product has, so a shut licence gate or a
// model-less build leaves nothing to list and nothing to edit, and an app that starts anyway is
// one whose first useful action fails for a reason it already knew at launch.
//
// The failure texts are a deliverable, not an afterthought — this is the most-read screen in the
// product's first five minutes — so this file prints the engine's own `message` verbatim and adds
// nothing around it.
//
// `--preflight` keeps M1's behaviour: take the readings, print them, stop. It is the shape the
// round-trip milestone shipped and the only thing that runs with no built page on disk.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBlockers, preflight } from '../src/engine/preflight.mjs';
import { startSidecar } from '../src/server/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Beyond this many entries, a nested reading is a document rather than a row. See `print`. */
const ENTRIES_PER_READING = 12;

const version = () => JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

const USAGE = `kaleidoscope-ui — a local browser for one Kaleidoscope memory vault.

  kaleidoscope-ui [options]

  --kscope <path>   use this engine instead of searching for one
  --port <n>        ask for this port; a busy one falls back to a free one
  --preflight       take the readings, print them, and stop without starting a server
  --json            print the preflight readings as JSON
  --version         print the version of this package
  --help            print this

There is no --host flag. The server binds loopback, because the vault is your memory
and there is no authentication layer to put in front of it.
`;

function parse(argv) {
  const options = {
    enginePath: null,
    port: 0,
    json: false,
    help: false,
    version: false,
    preflightOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--preflight') options.preflightOnly = true;
    else if (arg === '--port') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10);
      i += 1;
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error('--port needs a number between 0 and 65535. Nothing was read or changed.');
      }
      options.port = value;
    } else if (arg === '--kscope') {
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
  } else if (options.preflightOnly) print(readings);

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

  if (options.preflightOnly || options.json) return;

  const sidecar = await startSidecar({
    readings,
    root: readings.vault?.root,
    port: options.port,
    appVersion: version(),
    // A forgotten tab must not leave a vault-reading server running for a week, and the decision
    // to exit belongs here rather than in the server: the server closes its socket, the launcher
    // owns the process.
    onIdle: () => {
      process.stderr.write(
        '\nNo browser has talked to this server for a while, so it stopped. ' +
          'Your vault was not changed.\n',
      );
      process.exit(0);
    },
  });

  // The token is in the FRAGMENT, which the browser never puts on the wire. It is printed here
  // because this terminal is the one place it legitimately exists outside the tab.
  const built = await sidecar.assets.available();
  process.stdout.write(
    [
      '',
      `  Kaleidoscope — reading ${readings.vault?.root ?? 'the resolved vault'}`,
      `  engine ${readings.engine.version} at ${readings.engine.path} · model ${readings.model?.status}`,
      // What this engine is, relative to the one this build was tested against. It is printed on
      // every launch rather than only on a mismatch, because a line that appears only when
      // something is wrong is a line nobody has learned to read by the time it matters. The tier
      // is not a version comparison: it is a digest over the bytes of the write contract, which is
      // the text every vocabulary in this app is parsed out of.
      `  contract ${sidecar.compatibility.digest?.slice(0, 12) ?? 'not recorded'} · ` +
        `tier ${sidecar.compatibility.tier} — ${sidecar.compatibility.headline}`,
      // Where the copies go, printed once, in the terminal — the one place outside the app that
      // can say it. A user who wants to find what an edit overwrote should not have to guess at a
      // platform convention, and the sentence beside it is the finding: these are copies, and
      // putting one back is not something the engine can do.
      `  copies kept before each write: ${sidecar.snapshots.directory}`,
      `  (${sidecar.snapshots.retention.per_memory} per memory, ` +
        `${sidecar.snapshots.retention.per_vault} in all — readable and savable, not an undo)`,
      '',
      `  ${sidecar.launchUrl}`,
      '',
      built
        ? '  Open that URL. The token after the # never leaves your browser.'
        : `  There is no built page in ${sidecar.assets.directory} — run \`npm run build\`. ` +
          'The API is up and answering.',
      '  Ctrl-C to stop.',
      '',
    ].join('\n'),
  );

  // The degradation, said out loud, in the terminal as well as in the app. It DEGRADES VISIBLY
  // rather than refusing to start: the user asked to look at their memory, the readings are all
  // in hand, and refusing over a digest would be this launcher deciding a machine is broken on
  // the strength of a fingerprint it has never seen before. What it will not do is stay quiet.
  if (sidecar.compatibility.tier !== 'C') {
    for (const reason of sidecar.compatibility.reasons) {
      process.stdout.write(`  ${reason.message.replace(/\n/g, '\n  ')}\n\n`);
    }
  }

  const stop = async () => {
    await sidecar.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  // The engine's own refusals arrive here already written for a person. Printing anything around
  // them buries the sentence that fixes the machine.
  process.stderr.write(`${error.message}\n`);
  process.exit(Number.isInteger(error.exitCode) ? error.exitCode : 1);
});
