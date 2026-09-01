# Kaleidoscope UI

A local browser for one Kaleidoscope memory vault.

Your agents write memory. This is the window onto it: read everything they have written, fix one
memory safely, remove one honestly, see the graph they have actually built, and work down the list
of things in it that need a person's decision.

It runs entirely on your own machine — one process, bound to loopback, no account, no server, no
network call of any kind. It talks to the `kscope` memory engine you already installed, as a child
process, through the engine's published command-line surface. It never opens a vault file itself.

## The engine is a separate program

This package does not contain, download, extract, compile, bundle or update `kscope`. You install
the engine yourself, and if it is missing this tool's job is to say so well and stop.

> This package is Apache-2.0, and that covers this package's own source. It does not cover the `kscope` memory engine, which
> you install separately: it is closed source, is not part of this repository, is not shipped inside
> this package, and is not licensed by this repository at all — separate terms apply to it.

## Install and run

Install the engine first:

```
npm install -g @kleos-research/kaleidoscope
```

Check it answers, and check it carries its model:

```
kscope --version
kscope model        # must say "bundled"
```

Then run this, from the directory whose vault you want to look at:

```
npx @kleos-research/kaleidoscope-ui
```

It prints one URL with a token after the `#`. Open it. The token never leaves your browser — a URL
fragment is not sent to any server, including this one.

```
  --kscope <path>   use this engine instead of searching for one
  --port <n>        ask for this port; a busy one falls back to a free one
  --preflight       take the readings, print them, and stop without starting a server
  --json            print the readings as JSON
  --version         --help
```

There is no `--host` flag. The server binds loopback, because the vault is your memory and there is
no authentication layer to put in front of it.

### How it finds the engine

Four places, in order: a path you pass with `--kscope`, the `KALEIDOSCOPE_ENGINE` environment
variable, the directory this runtime installs its own executables into, and each directory on
`PATH`. The first two are authoritative — if you name a path and it cannot be used, the search stops
and tells you rather than quietly running a different program.

Whatever it resolves, it prints. A program earlier on `PATH` than the real engine would receive your
whole vault on its standard input, and showing you the path is most of the defence a local tool can
offer against that.

## What it does

**Read your whole vault.** Every memory, with its facts, its named things, its scope and what it
declares it contradicts. The listing is built from the engine's export door and never from ranked
search — see below for why that matters.

**Edit one memory.** Title, body, facts, entity declarations and the qualifiers on each fact. Every
control's options are read from the engine at launch, never written down here. Before every write it
keeps a copy of the memory as it was, outside your vault, and tells you where.

**Remove a memory, honestly.** It re-reads the version, keeps a copy, calls the engine, and then
pays one extra read to check the body actually came back absent. "The call succeeded" and "the
memory is gone" are different claims and only the second is reported as success. It also says, in
words, what removal does not do.

**See the graph.** Entities and the facts between them, reconstructed from the memories themselves —
components, islands, near-duplicate names, and names glossed two different ways.

**Work down a backlog.** The graph's findings turned into a list a person can act on, with the
denominators beside every count, and a way to say "these two really are different things" that
sticks.

**Curate across memories.** Unify a spelling everywhere it is used, or merge two memories into one.
Neither is an engine operation, so this app owns the ordering, shows you every fact as *before →
after* before anything is written, and names every memory it is about to change.

## What it does not do

**No ranked search. Anywhere.** The engine's ranked door permanently records that it ran, storing
the query text, and nothing published reads those records back or removes one. A UI that listed by
searching would write into the store it displays, on every load and every refresh, forever. There
are zero callers of that door in this app — not disabled, not behind a flag, absent — and a test
enforces it across the whole HTTP surface.

**No un-remove.** Removal hides a memory from the doors that serve it; the text stays on disk. The
copy kept before each write is readable and savable and is *not* an undo: a removed memory cannot be
put back into the vault it was removed from, and `docs/RESTORE-EXPERIMENT.md` is the run that
establishes it, with the four refusals and the control.

**No version history, no diff, no "who wrote this", no "when was this last used".** The record does
not carry the last two, and a column full of guesses is worse than no column.

**No network, no telemetry, no update check.** An update check is a network call in a product whose
claim is that it makes none. On `npx` you get the latest by default; if you pin a version you stay
pinned, silently.

**No Windows.** The engine publishes for macOS and Linux, so there is nothing to talk to.

**It never verifies the binary it found.** It checks that the candidate is an executable file. It
does not check a signature or a digest, so a hostile program earlier on `PATH` named `kscope` would
receive your vault. The only defence shipped is showing you the resolved path.

## When the engine is not the one this build was tested against

The vocabularies — memory types, entity kinds, relation names, the qualifier scales, the request-byte
ceiling — are all read from the engine at launch and none of them is written down here. That is what
keeps them from drifting, and it is also what makes an engine upgrade something this app has to
notice.

It does not key on the version string. Two builds one patch apart can print the write contract
differently while the version stands still, and the failure that causes is quiet: a parser written
against one layout does not error against another, it yields *fewer* values — a dropdown missing
entries, which a user helpfully fills in by typing a name that already existed. So the check is
`sha256` over the raw bytes of the write contract, which is the text being parsed.

There are three tiers, and the app is always in exactly one. The tier is printed at launch and is in
the footer of every screen.

| tier | when | what changes |
| --- | --- | --- |
| **C** | the contract is one this build has a tested parser for | nothing; everything works |
| **B** | the contract is one this build has not seen | reads are unaffected. Every control that would be a menu becomes a text box, with whatever could still be read out of the contract offered beside it as a suggestion and marked *unverified*. Writes are still allowed — the engine refuses what it cannot accept and names the field to fix, which is a better answer than a menu this app is guessing at |
| **A** | an unrecognised contract envelope, or an operation this app is built on that the engine does not have or has retired | reads still render and every reading is on the screen. Every write is refused, with both digests and the operations it looked for |

It **degrades visibly and never quietly**, and in no tier does it fall back to a vocabulary written
down in this repository. Substituting a transcription for a failed parse is the exact drift that
reading the contract at run time exists to prevent.

## Where it keeps things

Nothing this app records goes into your vault. Before every write it copies the memory as it was
into your platform's state directory for this app, keyed by which vault it is — bounded per memory
and per vault, with the rule printed at launch and in the app. Its own notes ("these two names
really are different things", a half-finished merge) live beside those copies for the same reason:
written into the vault they would be exported, retrieved by your agents, and counted in every number
this product reports about your memory.

## Licence and third-party code

Apache-2.0. [`LICENSE`](LICENSE) is the full text; [`NOTICE`](NOTICE) carries the attributions,
including the files adapted from other Apache-2.0 projects, each of which has a per-file note saying
what was changed.

The published package declares **no runtime dependencies** — `dependencies` is `{}` — so installing
it installs nothing else. The prebuilt browser application in `dist/` is compiled from a handful of
MIT-licensed libraries, and their notices are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), which is generated from what the build actually
put into the bundle rather than written by hand.

The disclaimer above is part of the licence terms of this package: Apache-2.0 covers this
repository's own source and nothing else.

## Development

```
npm install
npm run build       # the browser app -> dist/, plus a record of what landed in it
npm run notices     # regenerate THIRD_PARTY_NOTICES.md from that record
npm run boundary    # the boundary gate — must be clean before any push
```

**This repository is public and the engine it drives is not.** The gate derives every pattern from
the tables in [`docs/BOUNDARY.md`](docs/BOUNDARY.md) at run time, so the document and the check
cannot drift apart. It runs on every push and every pull request, because a public git history
cannot be un-pushed. A clean gate is not a clean review.

### The tests

**They run against a real engine and a real vault, and every one of them writes.** So each clones
the vault into a fresh temporary directory first, points the engine at the copy through the
environment, and then makes the engine confirm — through its own address door — that the copy is
what it resolved and the original is not, before the first write. If any step of that fails the run
stops rather than falling back. There is no default vault and no built-in path.

```
npm run build
KALEIDOSCOPE_TEST_VAULT=<path-to-a-vault> node --test \
  test/round-trip.test.mjs test/call-contract.test.mjs test/server.test.mjs \
  test/editor.test.mjs test/editor-model.test.mjs test/graph-model.test.mjs \
  test/snapshots.test.mjs test/removal.test.mjs test/backlog.test.mjs \
  test/merge.test.mjs test/restore.test.mjs test/wiring.test.mjs \
  test/compatibility.test.mjs test/packaging.test.mjs test/release.test.mjs
```

Name the files explicitly — `node --test test/` does not work on current Node.

Three of those do not need your vault at all:

- **`test/release.test.mjs`** packs this repository, installs the tarball into a scratch directory
  that is not this repository, runs the installed bin from there, and makes it serve a vault it
  generated itself with `scripts/synthetic-vault.mjs`. It is the only test that can see a wrong
  `files` array, which is the commonest way a prebuilt package ships broken.
- **`test/packaging.test.mjs`** greps the built bundle for anything it would fetch, and checks that
  `THIRD_PARTY_NOTICES.md` is what the generator would write today.
- **`test/compatibility.test.mjs`** drives the tier ladder with a perturbed contract until it fires.

### Why `dependencies` is empty

`npx` re-resolves a package on a cold machine, so a runtime dependency is a download the user waits
through on first launch, on every machine. The build inputs here run to tens of megabytes; the
bundle they produce is a few hundred kilobytes. A tool whose pitch is *local, offline, no network
call* cannot contradict itself at install time. Every UI, graph and build library is a
`devDependency`, and the release test asserts the property where it actually matters — that
installing the published tarball adds exactly one package, with the network switched off.

The plan this is built against is in [`docs/prd/README.md`](docs/prd/README.md).
