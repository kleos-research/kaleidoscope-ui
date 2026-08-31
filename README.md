# Kaleidoscope UI

A local, single-user browser for one Kaleidoscope memory vault: see everything in it, fix one memory
safely, remove one honestly, and work down the curation backlog. It runs entirely on your own machine
— one process on loopback, no account, no network call — and it talks to the `kscope` memory engine
you already installed, as a child process, through the engine's published command-line surface. It is
an open-source client for a closed-source engine, and it never reads or writes a vault file itself.

## The engine is a separate program

This package does not contain, download, extract, compile, bundle or update `kscope`. You install the
engine yourself, and if it is missing this tool's job is to say so well and stop.

> This package is Apache-2.0, and that covers this package's own source. It does not cover the `kscope` memory engine, which
> you install separately: it is closed source, is not part of this repository, is not shipped inside
> this package, and is not licensed by this repository at all — separate terms apply to it.

## Install and run

Install the engine first:

```
npm install -g @kleos-research/kaleidoscope
```

then check it with `kscope --version`. Then run this:

```
npx @kleos-research/kaleidoscope-ui
```

It looks for the engine in four places, in order: a path you pass with `--kscope`, the
`KALEIDOSCOPE_ENGINE` environment variable, the directory this runtime installs its own executables
into, and each directory on `PATH`. The first two are authoritative — if you name a path and it
cannot be used, the search stops and tells you, rather than quietly running a different program.
Whatever it resolves, it prints: a program earlier on `PATH` than the real engine would receive your
whole vault, and showing you the path is most of the defence a local tool can offer.

## What it does not do yet

**This milestone is headless.** There is no browser, no page and no server. `npx` runs the engine
preflight and prints what it found, which is the one claim worth making before any screen exists:
that the engine was located on a real machine, that it answered, and that its readings are legible.

Nothing below is built yet, and each is deliberate rather than pending: there is no ranked search
anywhere in this client, because the engine's ranked door permanently records that it ran and a UI
that listed by searching would write into the store it displays, on every refresh, forever. There is
no version history, no diff and no real undo. There is no "who wrote this" and no "when was this last
used" — the record does not carry either, and a column full of guesses is worse than no column. There
is no permanent erasure: removal hides a memory, the text stays on disk, and this tool says so.

## Development

```
npm run boundary    # the boundary gate — must be clean before any push
npm test
```

The gate derives every pattern from the tables in [`docs/BOUNDARY.md`](docs/BOUNDARY.md) at run time,
so the document and the check cannot drift apart. It runs on every push and every pull request,
because a public git history cannot be un-pushed. A clean gate is not a clean review.

**The tests run against a real engine and a real vault, and every one of them writes.** So each
clones the vault into a fresh temporary directory first, points the engine at the copy through the
environment, and then makes the engine confirm — through its own address door — that the copy is
what it resolved and the original is not, before the first write. If any step of that fails the run
stops rather than falling back. Name the vault to clone from:

```
KALEIDOSCOPE_TEST_VAULT=<path-to-a-vault> npm test
```

There is no default and no built-in path. A test that quietly ran against the vault a person uses
would be worse than one that did not run at all.

### Why `dependencies` is empty

The published package declares no runtime dependency, and it is meant to stay that way: every UI,
graph and build library this project acquires belongs in `devDependencies`. `npx` re-resolves a
package on a cold machine, so a runtime dependency is a download the user waits through on first
launch, on every machine. The build inputs for the browser app will run to tens of megabytes; the
bundle they produce is a few hundred kilobytes. A tool whose pitch is *local, offline, no network
call* cannot contradict itself at install time.

The plan this is being built against is in [`docs/prd/README.md`](docs/prd/README.md), and what
the first milestone does and does not cover is in [`docs/M1-STATUS.md`](docs/M1-STATUS.md).

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) for the full text and [`NOTICE`](NOTICE) for the attributions,
including the files adapted from other Apache-2.0 projects, each of which carries a per-file note
saying what was changed.

The disclaimer above is part of the licence terms of this package: Apache-2.0 covers this
repository's own source and nothing else.
