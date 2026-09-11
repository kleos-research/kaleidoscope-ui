// Vault fixtures for every milestone's tests.
//
// One rule shapes this file: a test that writes must never write to the vault a
// person actually uses. Every helper here exists to make that mechanical rather
// than a promise — the source is resolved and censused, the clone is made
// somewhere disposable, and the engine is asked, through its own door, which
// vault it resolved before a single write is attempted.
//
// This helper spawns processes directly. That is deliberate and does not
// contradict the one-spawner rule, which governs shipped source: `cp` is not the
// engine, and the clone has to exist before there is a client to talk through.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const SOURCE_ENV = 'KALEIDOSCOPE_TEST_VAULT';
const ROOT_ENV = 'KSCOPE_ROOT';

// No published door reads the search-exposure store back, so a filesystem census
// of the clone is the only instrument that can count these records. It is used
// on a clone the test made and never as a way to learn anything about a vault's
// contents.
const EXPOSURE_STORE = 'exposure';

function run(binary, args, env, input) {
  const child = spawnSync(binary, args, {
    encoding: 'utf8',
    shell: false,
    input,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (child.error) throw child.error;
  return { code: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

function samePath(a, b) {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Ask the engine which vault a given root resolves to, through its own door.
 * Returns the reading; throws if the engine will not resolve that root at all.
 */
export function readVaultAddress({ enginePath, root }) {
  const { code, stdout, stderr } = run(enginePath, ['where'], root ? { [ROOT_ENV]: root } : {});
  if (code !== 0) {
    throw new Error(
      `The engine would not resolve a vault${root ? ' at the requested root' : ''}. ` +
        `It exited ${code} and said:\n${(stdout + stderr).trim()}`,
    );
  }
  return JSON.parse(stdout);
}

/**
 * Where to clone from.
 *
 * Steps 1 and 2 mirror the engine's own resolution order: an explicitly named
 * source is authoritative and terminal, because "I used a different vault
 * instead" is the failure nobody can debug from the outside.
 *
 *   1. the `KALEIDOSCOPE_TEST_VAULT` environment variable;
 *   2. whatever the engine resolves from the current directory.
 *
 * There is no third step and no built-in default. A path written into this
 * repository would be both a machine trace and a standing invitation to run a
 * write against whatever happens to sit there.
 */
export function resolveSourceVault({ enginePath }) {
  const named = process.env[SOURCE_ENV];
  if (named !== undefined && named !== '') {
    const reading = readVaultAddress({ enginePath, root: named });
    return { root: reading.root, resolved_by: SOURCE_ENV };
  }

  let reading;
  try {
    reading = readVaultAddress({ enginePath, root: undefined });
  } catch (cause) {
    throw new Error(
      `No source vault to clone. ${SOURCE_ENV} is not set, and the engine resolved ` +
        `no vault from this directory.\n\n${cause.message}\n\n` +
        `Set ${SOURCE_ENV} to the vault to clone, or run from a directory that has one. ` +
        `Nothing was read, written or changed.`,
      { cause },
    );
  }
  return { root: reading.root, resolved_by: reading.root_source ?? 'engine' };
}

/**
 * Clone a vault into a fresh temporary directory and return the copy.
 *
 * The destination is created by `mkdtemp` and the vault is copied *beside* the
 * name that does not exist yet, because `cp` into an existing directory copies
 * into it rather than over it, which would produce a nested vault that resolves
 * to nothing.
 *
 * `cp -Rc` asks the filesystem for a copy-on-write clone: instant, and it costs
 * no disk. Where the filesystem cannot do that, the copy is made the slow way.
 * That fallback changes what the copy costs and never where it lands.
 */
export function cloneVault({ source, label = 'kaleidoscope-ui' }) {
  const stats = statSync(source);
  if (!stats.isDirectory()) throw new Error(`The source vault is not a directory: it is a file.`);

  const holder = mkdtempSync(join(tmpdir(), `${label}-`));
  const root = join(holder, 'vault');

  let copy = run('cp', ['-Rc', source, root], {});
  if (copy.code !== 0) copy = run('cp', ['-R', source, root], {});
  if (copy.code !== 0) {
    rmSync(holder, { recursive: true, force: true });
    throw new Error(
      `Could not clone the vault, so no test ran. cp exited ${copy.code}: ${copy.stderr.trim()}\n` +
        `Refusing to continue against the source vault. Nothing was written.`,
    );
  }

  let entries;
  try {
    entries = readdirSync(root);
  } catch (cause) {
    rmSync(holder, { recursive: true, force: true });
    throw new Error(`The clone was reported as made and is not readable.`, { cause });
  }
  if (entries.length === 0) {
    rmSync(holder, { recursive: true, force: true });
    throw new Error(`The clone was reported as made and is empty. Refusing to continue.`);
  }

  return {
    root,
    remove() {
      // Only ever the directory this function created.
      // Retried, because teardown can race a kscope call the test's own server is still finishing:
      // the child writes its journal into the clone while this deletes it, the recursive remove sees
      // the directory refill, and it throws ENOTEMPTY. Measured: a call that has RETURNED writes
      // nothing afterwards (1,672 files before, after and 3s later), so this is a child still in
      // flight, never an engine that keeps writing. It surfaced only once calls slowed under a loaded,
      // parallel run; the assertions had already passed and the failure was the cleanup.
      rmSync(holder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

/**
 * Point this APP's own state directory somewhere disposable, and hand back the
 * undo.
 *
 * The vault is not the only thing a test can write to by accident. The snapshot
 * spine keeps a copy of every memory it is about to change, outside the vault,
 * under the platform's state directory for this app — so a suite that started a
 * sidecar with default options would file the contents of a cloned vault into
 * the developer's own home, every run, and prune it against a retention rule
 * nobody asked for. That is the same class of mistake as writing to the source
 * vault, one directory over, and it is fixed in the same place: here, so no test
 * file has to remember.
 */
export function useAppStateDir(directory) {
  const KEY = 'KALEIDOSCOPE_UI_STATE_DIR';
  const previous = process.env[KEY];
  process.env[KEY] = directory;
  return function restore() {
    if (previous === undefined) delete process.env[KEY];
    else process.env[KEY] = previous;
  };
}

/**
 * Point the engine at a vault for the duration of a test, and hand back the
 * undo. The engine reads this from the environment, so the restore matters:
 * leaking it into a later test is how a test writes somewhere nobody meant.
 */
export function useVaultRoot(root) {
  const previous = process.env[ROOT_ENV];
  process.env[ROOT_ENV] = root;
  return function restore() {
    if (previous === undefined) delete process.env[ROOT_ENV];
    else process.env[ROOT_ENV] = previous;
  };
}

/**
 * Every file in a vault as `relative path → size@mtime`.
 *
 * The same reading `fingerprintVault` digests, kept open so a caller can ask WHICH path moved
 * rather than only whether the whole tree did. Metadata rather than content, for the same reason
 * as the digest: a vault's contents are the one thing this repository may not read into a test.
 */
export function stampVault(root) {
  const stamps = new Map();
  walk(root, (entry, path) => {
    if (!entry.isFile()) return;
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }
    stamps.set(path.slice(root.length), `${stats.size}\0${stats.mtimeMs}`);
  });
  return stamps;
}

/**
 * Open the vault's runtime state once, and hand back what that cost.
 *
 * WHY THIS EXISTS, because it looks like a test being made to pass. The engine keeps derived
 * runtime state beside the records. The FIRST call that opens that state on a given copy of a
 * vault rewrites one file — a checkpoint, and it happens on a call that reads, on a call that
 * refuses, and on a call that does nothing else at all. Every call after it leaves that file
 * alone. It is one-time and it converges.
 *
 * That single write is enough to move a whole-vault fingerprint, so "looking at a vault does not
 * change it" was being measured across the moment the store is opened for the first time — which
 * is the one moment at which it is not true, and never true again. Fingerprinting from there
 * measures the clone's age rather than the read path, and a suite that did it inconsistently would
 * go red or green according to how the SOURCE vault was last left rather than according to
 * anything this repository did.
 *
 * So the ritual absorbs it, deliberately and in one place. The property that matters is untouched
 * and is in fact now sharper: a door that writes on EVERY call still moves the fingerprint on the
 * second call, and that is what every later test measures. Only a strictly-once convergence is
 * absorbed here, and `test/call-contract.test.mjs` demonstrates that it IS strictly once, that it
 * touches no memory record, and that the engine's own export is byte-identical either side of it.
 * An absorbed phenomenon nobody asserts is an excuse; this one is asserted.
 *
 * The call used is the health reading the app already polls on every screen: ungated by the
 * licence check, and not the ranked door, so it records no search exposure.
 */
export function warmVault({ enginePath, root }) {
  const before = stampVault(root);
  const { code, stdout, stderr } = run(enginePath, ['call', 'doctor'], { [ROOT_ENV]: root }, '{"mode":"inspect"}');
  if (code !== 0) {
    throw new Error(
      `The engine would not open the clone's runtime state: it exited ${code} and said:\n` +
        `${(stdout + stderr).trim()}\n` +
        `Refusing to continue: every later assertion about what a call wrote would be measured ` +
        `across a state this one never reached.`,
    );
  }
  const moved = movedBetween(before, stampVault(root));
  return { moved, count: moved.length };
}

/**
 * Which paths differ between two `stampVault` readings.
 *
 * Separate from `warmVault` so a test can drive the SAME comparison over a change it made itself.
 * That is the only way to show that a `warmVault` result of "nothing moved" is a reading rather
 * than a blind spot: an instrument that reports nothing is indistinguishable from one that cannot
 * see, until it is shown reporting something.
 */
export function movedBetween(before, after) {
  const moved = [];
  for (const [path, stamp] of after) if (before.get(path) !== stamp) moved.push(path);
  for (const path of before.keys()) if (!after.has(path)) moved.push(path);
  return moved.sort();
}

/**
 * Refuse to go on unless the engine resolves the vault we cloned, from the
 * environment. This is the gate that turns "the test writes to a clone" from an
 * intention into an assertion, and it runs before the first write.
 */
export function requireEngineResolves({ enginePath, root, forbidden }) {
  const reading = readVaultAddress({ enginePath, root: undefined });

  if (forbidden !== undefined && samePath(reading.root, forbidden)) {
    throw new Error(
      `The engine resolved the vault this test must never write to. Refusing to run.`,
    );
  }
  if (!samePath(reading.root, root)) {
    throw new Error(
      `The engine did not resolve the clone. Refusing to run: a write from here would ` +
        `land somewhere this test did not create.`,
    );
  }
  if (reading.root_source !== 'environment') {
    throw new Error(
      `The engine resolved the right path from the wrong place (${reading.root_source}). ` +
        `Refusing to run: the address must come from the environment this test set.`,
    );
  }
  return reading;
}

function walk(root, visit) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      visit(entry, path, dir);
    }
  }
}

/**
 * A census of a vault directory: enough to prove afterwards that nothing in it
 * moved. Counting files alone would miss an edit in place, so the newest
 * modification time travels with the count.
 */
export function censusVault(root) {
  let files = 0;
  let bytes = 0;
  let newestMs = 0;
  walk(root, (entry, path) => {
    if (!entry.isFile()) return;
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }
    files += 1;
    bytes += stats.size;
    if (stats.mtimeMs > newestMs) newestMs = stats.mtimeMs;
  });
  return { files, bytes, newestMs };
}

/**
 * A digest over every file in a vault: relative path, size and modification time.
 *
 * This is what "the call wrote nothing" is asserted against, and it is strictly stronger than the
 * census above — a file replaced by another of the same length on the same second moves the digest
 * and does not move the count or the byte total. The digest is over metadata rather than content
 * because a vault's contents are the one thing this repository may not read into a test.
 */
export function fingerprintVault(root) {
  const lines = [];
  walk(root, (entry, path) => {
    if (!entry.isFile()) return;
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }
    lines.push(`${path.slice(root.length)}\0${stats.size}\0${stats.mtimeMs}`);
  });
  lines.sort();
  return {
    files: lines.length,
    digest: createHash('sha256').update(lines.join('\n')).digest('hex'),
  };
}

/**
 * Count the vault's search-exposure records.
 *
 * `stores` is reported beside `records` on purpose. A census that found nowhere
 * to look reports zero records, and zero compared against zero passes — which is
 * a check that is loudest exactly when it is broken. A caller asserts that at
 * least one store was found before it believes the count.
 */
export function countExposureRecords(root) {
  const found = [];
  walk(root, (entry, path) => {
    if (entry.isDirectory() && entry.name.toLowerCase().includes(EXPOSURE_STORE)) found.push(path);
  });
  // A store nested inside another store would have its records counted twice.
  const stores = found.filter((path) => !found.some((other) => path.startsWith(other + sep)));

  let records = 0;
  for (const store of stores) {
    walk(store, (entry) => {
      if (entry.isFile()) records += 1;
    });
  }
  return { stores: stores.length, records };
}

/**
 * The whole safety ritual, in one call, so no later milestone has to remember
 * the order: resolve the source, clone it, point the environment at the clone,
 * and make the engine say — through its own door — that the clone is what it
 * resolved and the source is not.
 *
 * Every failure in here throws. There is deliberately no fallback: a test that
 * quietly runs against the vault a person uses is worse than a test that does
 * not run at all.
 *
 * The ritual also WARMS the clone — see `warmVault` for why, and for the test that keeps that from
 * being a way of making a red test green. `warm: false` opts out, and exists so the one test that
 * measures the warming itself can see the cold state.
 */
export function openScratchVault({ enginePath, label = 'kaleidoscope-ui', warm = true }) {
  const source = resolveSourceVault({ enginePath });
  const clone = cloneVault({ source: source.root, label });

  // The app's own state, redirected beside the clone rather than into the
  // developer's home. See useAppStateDir: the snapshot spine writes a copy of
  // every memory a test changes, and by default it writes it there.
  const state = mkdtempSync(join(tmpdir(), `${label}-state-`));

  let restore;
  let restoreState;
  try {
    restore = useVaultRoot(clone.root);
    restoreState = useAppStateDir(state);
    const reading = requireEngineResolves({
      enginePath,
      root: clone.root,
      forbidden: source.root,
    });
    // After the address gate, never before it: this is the first call that touches the clone's
    // runtime state, and it must not run until the engine has said which vault it resolved.
    const warming = warm ? warmVault({ enginePath, root: clone.root }) : null;
    return {
      root: clone.root,
      source: source.root,
      state_dir: state,
      reading,
      warming,
      close() {
        restore();
        restoreState();
        clone.remove();
        rmSync(state, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (restore) restore();
    if (restoreState) restoreState();
    clone.remove();
    rmSync(state, { recursive: true, force: true });
    throw error;
  }
}
