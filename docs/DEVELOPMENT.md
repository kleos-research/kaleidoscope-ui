# Developing the Kaleidoscope UI

The user-facing README is deliberately short. Everything an implementer needs is here.

### How it finds the engine

Four places, in order: a path you pass with `--kscope`, the `KALEIDOSCOPE_ENGINE` environment
variable, the directory this runtime installs its own executables into, and each directory on
`PATH`. The first two are authoritative — if you name a path and it cannot be used, the search stops
and tells you rather than quietly running a different program.

Whatever it resolves, it prints. A program earlier on `PATH` than the real engine would receive your
whole vault on its standard input, and showing you the path is most of the defence a local tool can
offer against that.


## Development

```
npm install
npm run build       # the browser app -> dist/, plus a record of what landed in it
npm run notices     # regenerate THIRD_PARTY_NOTICES.md from that record
npm run boundary    # the boundary gate — must be clean before any push
```

**This repository is public and the engine it drives is not.** The gate derives every pattern from
the tables in [`docs/BOUNDARY.md`](BOUNDARY.md) at run time, so the document and the check
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
KALEIDOSCOPE_TEST_VAULT=<path-to-a-vault> node --test test/*.test.mjs
```

Name the files explicitly — `node --test test/` does not work on current Node, so the glob above is
the shell doing the naming. Spelled out, the suite is all twenty-seven of these, and a hand-written
subset is how a run comes to look green while a third of it never ran:

```
test/backlog.test.mjs        test/boundary-vault.test.mjs  test/browse.test.mjs
test/call-contract.test.mjs  test/cluster.test.mjs         test/compatibility.test.mjs
test/editor-model.test.mjs   test/editor.test.mjs          test/ego-layout.test.mjs
test/first-run.test.mjs      test/graph-features.test.mjs  test/graph-model.test.mjs
test/hub.test.mjs            test/merge.test.mjs           test/names.test.mjs
test/overview.test.mjs       test/packaging.test.mjs       test/prose-pane.test.mjs
test/release.test.mjs        test/removal.test.mjs         test/restore.test.mjs
test/round-trip.test.mjs     test/search.test.mjs          test/server.test.mjs
test/snapshots.test.mjs      test/vault-picker.test.mjs    test/wiring.test.mjs
```

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
bundle they produce is about a megabyte, a third of which is the fonts it embeds so the page
renders without reaching a font host. A tool whose pitch is *local, offline, no network
call* cannot contradict itself at install time. Every UI, graph and build library is a
`devDependency`, and the release test asserts the property where it actually matters — that
installing the published tarball adds exactly one package, with the network switched off.

The plan this is built against is in [`docs/prd/README.md`](prd/README.md).

Two documents are worth reading before you change behaviour rather than code:
[`LIMITATIONS.md`](LIMITATIONS.md), which is what this app does not do and what it cannot
promise, and [`DECISIONS.md`](DECISIONS.md), which is the handful of measured
findings that explain why parts of the source take the long way round.
