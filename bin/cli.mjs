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

import { EngineNotFoundError } from '../src/engine/errors.mjs';
import { launchBlockers, preflight } from '../src/engine/preflight.mjs';
import { readVaultOfferings } from '../src/engine/vaults.mjs';
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

/**
 * Ctrl-C, written once so the launch paths cannot disagree about how this process ends.
 *
 * It takes a GETTER rather than a server, because a vault switch replaces the server this process
 * is holding. A handler that closed over the first one would, after a switch, close a socket that
 * is already shut and leave the live one listening — and the terminal would look like it had hung.
 */
const stopOn = (current) => async () => {
  await current()?.close().catch(() => {});
  process.exit(0);
};

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) return process.stdout.write(USAGE);
  if (options.version) return process.stdout.write(`${version()}\n`);

  // THE ONE FAILURE THAT IS NOT A FULL STOP.
  //
  // Everything else this launcher takes a reading of is a condition on a machine that already has
  // the engine. A missing engine is different in kind: the person who typed `npx` is walking to a
  // browser, and a terminal cannot show them a copy button or re-check without being typed again.
  // So the search's own refusal is printed here AND carried into the server, which binds anyway and
  // serves the setup screen. Nothing about the copy changes; only the channel does.
  //
  // `--preflight` and `--json` are excluded on purpose. Both ask for readings and stop; there are
  // no readings, so they fail as they always did rather than printing a table of nothing.
  let readings = null;
  let engineError = null;
  try {
    readings = await preflight({ explicit: options.enginePath });
  } catch (error) {
    const setupScreen =
      error instanceof EngineNotFoundError && !options.preflightOnly && !options.json;
    if (!setupScreen) throw error;
    engineError = error;
  }

  const blockers = readings ? launchBlockers(readings) : [];

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

  // A forgotten tab must not leave a vault-reading server running for a week, and the decision to
  // exit belongs here rather than in the server: the server closes its socket, the launcher owns
  // the process.
  const onIdle = () => {
    process.stderr.write(
      '\nNo browser has talked to this server for a while, so it stopped. ' +
        'Your vault was not changed.\n',
    );
    process.exit(0);
  };

  /**
   * WHICH VAULTS EXIST, ASKED ONCE, BEFORE ANY OF THEM IS OPENED.
   *
   * Three short reads, and their timing is the point. A switch relaunches the server with a root
   * pinned, and `kscope where` taken after that would resolve THAT root as "where the app was
   * started" — the default would follow the user from vault to vault instead of naming where they
   * came in. So they are taken here, once, and the same set is handed to every server after.
   *
   * A failure to read them is not a failure to launch. The picker degrades to the vault this launch
   * opened, which is the one thing the app was asked for.
   */
  let vaultOfferings = null;
  if (readings) {
    vaultOfferings = await readVaultOfferings({ enginePath: readings.engine.path }).catch(() => null);
  }

  /**
   * THE ENGINE ARRIVED AFTER THE SOCKET DID.
   *
   * A launch that found no engine took no readings, so it could not ask which vaults exist — and
   * the answer would have been the same on a restart. `Check again` is the first moment the
   * question can be put, and this is where it is put, for the same reason as above: these are
   * taken BEFORE any vault is pinned, so `where` still answers with the one this terminal came in
   * on rather than one a switch chose.
   *
   * The readings are kept as well, because everything the launcher does afterwards — a switch, its
   * fallback, the message it prints when the new vault will not open — reads them.
   */
  async function onEngineFound(taken) {
    readings = taken;
    // AND THE LAUNCH'S REFUSAL IS SPENT. `launch` passes it to every server it starts, and a server
    // handed one starts on the setup screen — so leaving it set would send the first vault switch
    // after a recovery back to the screen the user just left.
    engineError = null;
    vaultOfferings = await readVaultOfferings({ enginePath: taken.engine.path }).catch(() => null);
    return vaultOfferings;
  }

  let sidecar = null;

  /**
   * Open one vault, from readings taken for it.
   *
   * `root` is pinned, so the preflight resolves exactly that vault rather than the directory this
   * terminal happens to be in. Everything else is the same on every launch, which is the property
   * that matters: the app someone gets after switching is assembled by the same code, in the same
   * order, as the app they would have got had they started there.
   */
  const launch = ({ readings: taken, root, port, token, vaultSwitchFailure = null }) =>
    startSidecar({
      readings: taken ?? undefined,
      engineError: engineError ?? undefined,
      root,
      port,
      token,
      appVersion: version(),
      vaultOfferings,
      vaultSwitchFailure,
      // Always, even on a launch that found no engine. That launch cannot switch anything yet —
      // there is no app to switch from — but `Check again` can end that state in this same process,
      // and a picker wired to nothing is the app a recovered user would otherwise be left with.
      onSwitch: relaunch,
      onEngineFound,
      onIdle,
    });

  /**
   * THE VAULT SWITCH, AND IT IS A RELAUNCH.
   *
   * The vault is resolved once, at launch, and is not a parameter of anything in the server — so
   * pointing the app at a different one means a different server. It comes back on the SAME PORT
   * with the SAME TOKEN, because the tab that asked is still open and still holding both: the page
   * waits for this origin to answer again, and a new address or a new credential would strand it.
   *
   * IF THE NEW VAULT WILL NOT OPEN, THE OLD ONE COMES BACK. The engine refuses a root that is not a
   * vault, naming the path and where the path came from, and that refusal travels back to the page
   * verbatim — the user asked to look somewhere else, not to lose what they were reading.
   */
  async function relaunch(offer) {
    const previous = {
      root: sidecar?.readings?.vault?.root ?? readings?.vault?.root ?? null,
      port: sidecar?.port ?? options.port,
      token: sidecar?.token ?? null,
    };

    process.stdout.write(`\n  Opening ${offer.name} — ${offer.root}\n`);
    await sidecar?.close({ force: true }).catch(() => {});

    try {
      const taken = await preflight({ explicit: options.enginePath, root: offer.root });
      const stops = launchBlockers(taken);
      // The same full stop as at launch, said the same way, but it must not end the process here:
      // the person is inside the app and the vault they came from is still fine.
      if (stops.length > 0) throw new Error(stops.map((stop) => stop.message).join('\n\n'));
      sidecar = await launch({
        readings: taken,
        root: taken.vault?.root,
        port: previous.port,
        token: previous.token,
      });
      process.stdout.write(`  Now reading ${taken.vault?.root}\n\n`);
    } catch (error) {
      process.stderr.write(`\n${error.message}\n`);
      try {
        sidecar = await launch({
          root: previous.root,
          port: previous.port,
          token: previous.token,
          // Carried to the page as the engine wrote it. Nothing is composed around it here: the
          // engine's refusal already names the path, where the path came from, and what to do.
          vaultSwitchFailure: {
            key: offer.key,
            name: offer.name,
            root: offer.root,
            message: error.message,
          },
        });
        process.stdout.write(`  Still reading ${previous.root}\n\n`);
      } catch (fatal) {
        // The vault that was open a second ago will not reopen. There is nothing left to serve and
        // no screen to say so on, so this is the one place a switch can end the process.
        process.stderr.write(`${fatal.message}\n`);
        process.exit(1);
      }
    }
  }

  sidecar = await launch({
    readings: readings ?? undefined,
    root: readings?.vault?.root,
    port: options.port,
  });

  // The token is in the FRAGMENT, which the browser never puts on the wire. It is printed here
  // because this terminal is the one place it legitimately exists outside the tab.
  const built = await sidecar.assets.available();

  // NO ENGINE: the same URL, and the refusal in both channels.
  //
  // The engine client's own message is printed first, whole, because a person who is still looking
  // at this terminal deserves the sentence that fixes the machine without opening anything. The URL
  // follows it because it is the only one of the two that can offer a copy button, a path field and
  // a re-check — and the re-check is the reason the screen exists at all.
  if (engineError) {
    process.stderr.write(`\n${engineError.message}\n`);
    process.stdout.write(
      [
        '',
        '  Kaleidoscope — the memory engine is not here yet',
        '',
        `  ${sidecar.launchUrl}`,
        '',
        built
          ? '  Open that URL to finish setting up. Nothing was read, written or changed,'
          : `  There is no built page in ${sidecar.assets.directory} — run \`npm run build\`.` +
            '\n  The setup routes are up and answering. Nothing was read, written or changed,',
        '  and this tool never creates a vault.',
        '  Ctrl-C to stop.',
        '',
      ].join('\n'),
    );
    process.on('SIGINT', stopOn(() => sidecar));
    process.on('SIGTERM', stopOn(() => sidecar));
    return;
  }

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

  process.on('SIGINT', stopOn(() => sidecar));
  process.on('SIGTERM', stopOn(() => sidecar));
}

main().catch((error) => {
  // The engine's own refusals arrive here already written for a person. Printing anything around
  // them buries the sentence that fixes the machine.
  process.stderr.write(`${error.message}\n`);
  process.exit(Number.isInteger(error.exitCode) ? error.exitCode : 1);
});
