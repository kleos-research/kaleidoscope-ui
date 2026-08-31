# PRD 0007 — The UI ships as its own npm package and never carries the engine

> **Status (2026-08-31).** Not started. Today there is no published UI package of any kind: the only
> way to look at a vault is the `kscope` CLI. This document asks for one new public npm package,
> `@kleos-research/kaleidoscope-ui`, launched with `npx`, containing zero engine code and zero
> runtime dependencies, which locates an already-installed `kscope` on the user's machine and talks
> to it as a subprocess. It also fixes the three things that decide whether that package is safe to
> publish: how it finds the engine, what it does when it meets an engine it was not built against,
> and what may never appear in a public repository that drives a closed one. **Out of scope:** the
> hosted multi-user version (§7 says only what to do now so it stays cheap), any change to the
> engine binary, and shipping the engine itself through this channel.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** PRD 0001 (the two-process architecture — a prebuilt browser app, a local sidecar, and
the engine as a child process — that this document puts in a tarball).
**Relates to:** the sidecar/security PRD (loopback binding, per-launch token, CSP), which owns the
runtime posture this document only packages; and the vocabulary and editor PRDs, which consume the
startup handshake specified in §3.2.
**Supersedes nothing.**

---

## 1. The product claim

**The UI is a separate, Apache-2.0, npm package that contains no engine code, declares no runtime
dependencies, and treats the engine as something the user already installed.** It is a client, not a
distribution channel: it never downloads, extracts, compiles, bundles or updates `kscope`, and if the
engine is missing the UI's job is to say so well and stop.

Three asymmetries force this.

| asymmetry | consequence |
| --- | --- |
| The engine is closed source and separately licensed; the UI is public and Apache-2.0. | They cannot share a tarball without shipping one artefact under two licences, and cannot share a repository at all. |
| `npx` re-resolves the package on a cold machine. A runtime dependency is a download the user waits for, every first run, on every machine. | The browser app is a few hundred kilobytes; its build inputs are tens of megabytes. Every UI and graph library must therefore be a build-time dependency, and the published tarball must declare none. |
| A public git history cannot be un-pushed. | The boundary is not a review convention; it is a CI check that runs before the irreversible moment, with a self-test proving it can fail. |

The claim someone could disagree with: **that this belongs in a second package rather than as
`kscope ui`, or as an added `bin` on the engine's existing npm package.**

### Why not a subcommand of the engine's package

**The licences differ.** The published engine package is proprietary; this one is Apache-2.0. One
tarball carrying two licences is bookkeeping that never gets simpler, and it makes the public
repository's `LICENSE` a document about something it does not govern.

**That package has a stated invariant the UI would break.** It declares itself a locator for the
engine binary and nothing else: no download, no extraction, no postinstall, no compilation — stated
as a requirement rather than as a simplification, because it is what makes a package that installs a
proprietary executable auditable at a glance. A prebuilt browser application and a local HTTP server
are not that.

**Its own packaging check would reject a UI build tree.** The engine package is guarded by a
forbidden-members check that denies source directories, script files and tooling trees. A UI build
tree trips the gate that exists to protect the engine package — which is the gate working, not
failing.

**And the release cadences are opposite.** The locator must be boring and near-frozen; the UI will
ship often and early. Coupling them means every UI fix republishes the thing users install to get the
engine.

The one thing that must not be duplicated is the engine-discovery order, and §4's R13 keeps that
single by binding both packages to one shared fixture rather than to each other's source.

## 2. What it costs to get this wrong

Four concrete failures, three of which are observations rather than imaginings.

**A dependency-carrying package.** With runtime dependencies declared, `npx` fetches the whole build
tree to serve a browser bundle a fraction of its size. Measured from the public registry, the three
largest build inputs alone unpack to roughly 22 MB; the vendor half of the shipped bundle is about
250 KB gzipped. The user pays the 22 MB on first launch, on every machine, and the product's own
pitch — local, offline, no network call — is contradicted by its install.

**A discovery order that disagrees with its siblings.** Two published clients already exist and one of them
had drifted: it resolved the engine by a route the other did not, pinned to a single platform while
the engine publishes several. Two clients that disagree about where the engine is are two clients
that behave differently on the same machine, and "it found something else" is the failure that is
impossible to debug from outside. The order must therefore be asserted against a shared fixture, not
transcribed from a sibling's source.

**Compatibility keyed on the version string.** Two released builds one patch apart render the
engine's write contract differently — different structure, an added field, a changed limit — on a
version string that never moved past its patch digit. Semver would have said "compatible". That text
is where the engine's closed vocabularies are read from at runtime, so a parser written against one
layout does not fail against the other; it silently yields *fewer* values. The user then sees a
dropdown missing entries and, helpfully, types a new one — minting fresh vocabulary where a good
value already existed. That is precisely the failure that reading the vocabulary at runtime exists to
prevent, arriving through the back door.

**A leak gate that cannot go red.** A boundary scanner that skips when the engine is absent, or that
has no planted-fixture self-test, passes hardest at exactly the moment it is most broken. The same
goes for a serious scanner wired to no workflow: a checker that has never had the opportunity to fail
is a sentiment with a filename. And in a *UI* repository the likeliest leak is not text at all — it
is a screenshot of a real vault in a README, which no text scanner catches.

## 3. The mechanism, as designed

### 3.1 The package

```
@kleos-research/kaleidoscope-ui          Apache-2.0
  bin: { "kaleidoscope-ui": "bin/cli.js" }

  bin/cli.js                  argument parsing, engine resolution, startup handshake,
                              server start, browser open
  server/                     three plain-Node files: static handler, the /api door,
                              and the single engine client. node: builtins only.
  dist/                       the prebuilt browser app
  LICENSE  NOTICE  THIRD_PARTY_NOTICES.md  README.md

  "files":        ["bin", "dist", "server", "README.md", "LICENSE", "NOTICE",
                   "THIRD_PARTY_NOTICES.md"]
  "dependencies": {}
  "optionalDependencies": { "<engine locator package>": "*" }
  "engines":      { "node": "^20.19.0 || >=22.12.0" }
  no preinstall, install or postinstall script — ever
```

The browser app is built with **Vite**; the server is **`node:http`**. There is deliberately no
web framework: a framework runtime dependency is exactly the thing this package's shape forbids, and
it would buy nothing, because the app renders from one JSON payload and the server is three files.

The optional dependency is the engine's own npm locator package, and it is present for one reason
only: when the user installed the engine through npm, that package exports the path of the real
executable, which lets the UI skip a Node trampoline on every call (R12). It is **never** the way
the engine is obtained. Installing the UI with optional dependencies omitted must work completely.

`bin/cli.js` accepts `--kscope <path>`, `--profile <name>`, `--port`, `--no-open`,
`--browser <name>`, `--file <out.html>`, `--version`, `--help`. Binding, port selection and the
security posture belong to the sidecar PRD; this document only requires that the flags exist in the
published bin and are covered by the tarball smoke test.

### 3.2 The startup handshake

Before serving anything, `bin/cli.js` runs one batch of short child processes against the resolved
engine, using only commands that are ungated by the engine's licence check:

```
version   →  displayed; never a compatibility gate
gate      →  is the UI's data door licensed on this machine
contract  →  the public seed: schema version, limits, retired operations, capabilities
index     →  which operations this build has at all
write     →  the write contract's raw bytes  →  digest = sha256(those bytes)
model     →  the engine's embedding status
address   →  which vault this is
```

Everything the UI later needs to know about compatibility is decided from those readings, and every
reading is displayed permanently in the app's footer. The handshake is a pure function of captured
stdout, so it can be driven from a fixture in tests.

### 3.3 Failure shapes

The engine's exit codes are the protocol, not its stderr: a successful call may write to stderr, so a
client that treats non-empty stderr as failure fails on success. One code in particular — the
licence-refusal code — comes back with an **empty stdout** and its message on stderr, so a client
that parses stdout as JSON reports "empty response" and mis-labels a licence problem as a crash.

Three distinct launch failures, three distinct messages, three distinct exit codes: nothing found ·
an explicitly named engine that cannot be used · an engine found but not licensed for the door the UI
needs. Each names what it looked for, everywhere it looked, the single install command, the override,
and the sentence *"your vault is untouched."*

## 4. Requirements

### The package shape

**R1.** The package is published as `@kleos-research/kaleidoscope-ui` with a single `bin` entry
`kaleidoscope-ui` → `bin/cli.js`, and launches under `npx` with no additional arguments.

**R2.** Every UI, graph and build dependency is declared under `devDependencies`. The published
`package.json` declares `"dependencies": {}`. **Checkable against a published tarball:** unpack it and
assert the `dependencies` field is absent or empty.

**R3.** Installing the published tarball into an empty directory with optional dependencies omitted
and install scripts disabled produces a `node_modules` containing exactly one package — this one —
and no transitive packages. This is the test that R2 is about; reading the source tree's manifest is
not.

**R4.** The published tarball contains no lifecycle script of any kind (`preinstall`, `install`,
`postinstall`). **Checkable:** the unpacked `package.json`'s `scripts` object contains none of those
keys.

**R5.** The tarball contains exactly the paths in the `files` allowlist and nothing else — no source
tree, no test tree, no configuration, no `node_modules`, and no executable image of any kind.

**R6.** Packed size ≤ 700 KB and unpacked size ≤ 2.5 MB; CI fails the release on either. (Projected
at ~350–450 KB packed from the measured gzipped size of the vendor bundle; the cap leaves headroom
without hiding a regression.)

**R7.** A release test installs the packed tarball into a scratch directory, runs the bin against a
vault this repository generated itself, and asserts a rendered page. This is the only test that
catches a wrong `files` array, and a wrong `files` array is the most common way a prebuilt package
ships broken.

**R8.** With the network unavailable after one cold install, the app launches and every screen
renders. No CDN, no font host, no update check, no telemetry. **Checkable:** the built `dist/`
contains no absolute `http(s)` URL outside an explicit allowlist, and the offline launch is a CI job.

### Engine discovery

**R9.** The UI resolves the engine in exactly four steps, in this order: (1) an explicit `--kscope`
path; (2) the `KALEIDOSCOPE_ENGINE` environment variable, ignored when set but empty; (3) the
directory this runtime installs its own executables into — for Node, the directory of the running
`node`; (4) each `$PATH` directory, in order.

**R10.** Steps 1 and 2 are terminal. If either names something unusable, the search stops and reports
that; it must never fall through and run a different program.

**R11.** A candidate is canonicalised first, then validated (regular file, executable), then executed
by its canonical path. Symlinks are accepted: global npm installs place bin entries as symlinks, and
refusing them refuses the documented install channel. **Regression test:** a symlink to a stub
executable resolves and runs.

**R12.** If the resolved file is a Node trampoline for the engine's own npm package, the UI resolves
past it to the real executable via that package's exported path. Measured on a released build: the
trampoline shape costs roughly 45 ms per invocation against roughly 4 ms for the executable directly,
and the UI spawns one child process per request.

**R13.** The resolution order is asserted in CI against a **shared golden fixture** listing the step
names, their order, the environment-variable name, and the terminal-or-fallthrough flag per step —
the same fixture the other published clients assert against. The test fails on any difference, and
fails (not skips) if the fixture is unavailable. **Reading another client's source is not a
verification method**; a shared fixture is, because it is what makes the clients' agreement
falsifiable.

**R14.** The missing-engine failure raises the error type named by the family's shared error-category
fixture, so a caller catching it by name catches it in every client.

**R15.** Three launch failure messages exist and are distinguishable by exit code: nothing found · an
explicitly named engine that cannot be used · found but not licensed. Each message names what was
looked for, every location searched (capped, with an "and N more" tail), the one install command, the
override, and that the vault is untouched. The licence case is detected in the handshake, not
discovered halfway through the user's first edit.

**R16.** The resolved absolute path, the step that resolved it, and the engine version are printed at
launch and displayed permanently in the app. If the search found more than one candidate, the
launcher names every candidate it found and which it chose — a program earlier on `$PATH` than the
real engine receives the user's whole vault on stdout, and the only defence a local tool can offer is
to show the user which program it is talking to.

### Version compatibility

**R17.** The UI reads the engine's vocabularies and limits at runtime and ships none of them. The
source tree contains **zero** transcribed vocabulary literals, with one allowlisted exception: a
single *denial* list, whose header states why the exception is safe — a stale denial list fails safe
by refusing something newly permitted, where a stale allow list fails open — and which a test asserts
is a subset of the set parsed from the live engine.

**R18.** Compatibility keys on `sha256` of the raw bytes of the engine's write-contract output. The
version string is displayed and never gates anything.

**R19.** Three tiers, and the UI is always in exactly one of them:

| tier | condition | behaviour |
| --- | --- | --- |
| **C** | digest is one the UI ships a tested parser for | full function; the parse is cached **keyed by the digest**, so upgrading the engine invalidates the cache automatically and staleness is impossible |
| **B** | digest unknown | reads stay fully functional; every closed-value control becomes free text with an inline hint listing whatever could still be extracted, marked unverified, under a persistent banner naming both digests; writes still allowed, because the engine's refusals are correctable and name the field to fix |
| **A** | an unrecognised schema version, or a required operation missing from the operation index or listed as retired | hard stop: readings shown, every write refused, nothing guessed |

**R20.** Tier B **never** falls back to a bundled vocabulary. Substituting a transcription for a
failed parse is the failure R17 exists to prevent.

**R21.** The request-byte ceiling and the batch-item cap are read from the engine's public contract at
startup. **Checkable:** a CI grep finds neither value as a literal in the source.

**R22.** Degradation is visible, never quiet. A CI test drives the handshake with a perturbed contract
fixture and asserts: the tier changes, the banner appears with both digests, and the tier's write
policy is enforced. A tier machinery with no test that has seen it fire is not a mechanism.

**R23.** Every handshake reading — version, licence state, contract digest and tier, model status,
resolved engine path, resolved vault, and the engine's own health readings — is displayed permanently
in the footer. A number in this product carries the evidence that the thing it measures was switched
on.

### Licence

**R24.** `LICENSE` is the unmodified Apache-2.0 text; `NOTICE` carries the §4(d) attribution; both
ship in the tarball.

**R25.** `README.md` and the `LICENSE` preamble carry this disclaimer verbatim: *that licence covers
this package's own source. It does not cover the `kscope` memory engine, which you install
separately: it is closed source, is not part of this repository, is not shipped inside this package,
and is not licensed by this repository at all — separate terms apply to it.*

**R26.** `THIRD_PARTY_NOTICES.md` is generated from the set of packages **actually bundled into
`dist/`**, regenerated in CI and diffed; a stale file fails the build.

**R27.** Every file adapted from another project carries an Apache-2.0 header, the upstream
attribution, and a note stating what was changed. A manifest lists the adapted files and a CI check
asserts each carries the header.

**R28.** A licence allowlist gate (`MIT`, `Apache-2.0`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`,
`CC0-1.0`, `0BSD`) runs over the **build-time** dependency tree, not the production one. This is not a
detail: because R2 makes `dependencies` empty, a gate scoped to production dependencies inspects an
empty set and passes trivially while the entire shipped bundle is built from devDependencies. The
gate must cover what lands in `dist/`. Copyleft is refused outright — a copyleft dependency inside a
launcher for a proprietary binary is an argument nobody wants, and its network clause would fire
exactly at the hosted stage in §7.

**R29.** Publication is `npm publish --provenance` from an OIDC-signed workflow with 2FA, and the
README's first code block shows the pinned form `npx @scope/pkg@x.y.z`.

### The boundary

**R30.** The rule, enforced as written in `docs/BOUNDARY.md`: *this repository may describe the CLI's
published surface and the shapes it returns; it may say nothing about how the engine decides
anything.* A reader must be able to build a client and must not be able to reconstruct the engine's
ranking, calibration, thresholds or internal structure.

**R31.** These classes never land, in source, docs, tests, issues or commit messages: engine source
and engine paths · engine internals by name, including module and symbol names, calibration-constant
and tuning-knob names, and derived arithmetic that discloses one without naming it · citations into
the private repository's internal document trees, because a citation into a tree the reader cannot
open is itself a disclosure · vault contents in any form — real memories, entity surfaces,
identifiers, exports — **including inside screenshots, GIFs and test snapshots** · benchmark numbers,
scores, weights and corpus statistics from private evaluation work · absolute home-directory paths and
machine traces · any credential · any executable image.

**R32.** The check is `scripts/check-boundary.mjs`, run by `.github/workflows/boundary.yml` on
`pull_request` **and** on push to any branch — the push is the irreversible moment, and a check that
only runs on pull requests protects nothing at it. It is a required status check on the default
branch, and it runs as a pre-push hook.

**R33.** The check has a falsifiability self-test: one planted fixture per rule class, each producing
a **distinct non-zero exit**. A rule with no fixture is not a rule, and a gate nobody has watched fail
is a sentiment.

**R34.** The transcribed-vocabulary rule seeds its denylist by running the installed engine **at check
time**, never from a committed list — a committed snapshot of a contract the repository is not allowed
to hold goes stale in silence. **If the engine is absent on the runner, the check fails; it must not
skip.** A skip here is a negative pass condition that fails open.

**R35.** The repository contains a synthetic-vault generator, and every screenshot, demo, fixture and
example is produced by a scripted headless run against it, regenerated and diffed in CI. No screenshot
may be taken by hand. This is the one control for the highest-risk leak in a UI repository, and the
only one a text scanner cannot provide.

**R36.** The vocabulary parser's own fixture is generated at test time from the installed engine and
is git-ignored. Tests that cannot run without it fail loudly or report an explicit, visible skip; they
never report green.

**R37.** A clean boundary check is recorded as *not* a clean review. Anything describing engine
behaviour is read by a human before merge, and the two results are reported separately.

### Keeping the hosted version cheap

**R38.** Exactly one file in the repository may import the process-spawning module, and it exposes one
interface: `call(op, payload) → { status, exitCode, stdout, stderr }`. Enforced by a lint rule and a
test that scans the tree — not by convention.

**R39.** No browser-reachable parameter may name a filesystem path or a vault root. The vault is fixed
at launch from the resolved address. This is the difference between a memory browser and an arbitrary
local-file reader, and it is also what lets the same browser bundle run against a hosted backend
unchanged.

## 5. What is not delivered, in order of what it costs

**No verification of the resolved binary.** The UI checks that a candidate is an executable file; it
does not verify a signature or a digest. A hostile program earlier on `$PATH` named `kscope` receives
the whole vault on stdout. The only mitigation shipped is R16 — naming every candidate found and the
one chosen — which converts an invisible compromise into a visible one. Pinning a digest is the real
fix and it needs a published, per-release digest to pin against; that is an engine ask, not a UI
change. **Cost: a local privilege-escalation path we can show but not close.**

**No Windows support.** The engine publishes platform packages for macOS and Linux; there is no
Windows build to talk to. The launcher must detect this and say so plainly rather than failing as a
resolution error, which reads as "you installed it wrong". **Cost: a whole platform, invisible to us
because nobody on it can install the engine either.**

**No engine-version compatibility matrix.** The tier is computed per build at runtime; there is no
published mapping from an engine version to a tier, so a user cannot know before launching whether
they will land in Tier C. **Cost: the honest answer to "will this work with engine X" is "launch it
and read the footer".** Cheap to add later once more than one engine release has been through the
handshake.

**No auto-update and no update check.** Deliberate — an update check is a network call in a product
whose claim is that it makes none. **Cost: users on `npx` get the latest by default and users who
pinned stay pinned silently.**

**The UI never installs the engine.** No download, no extraction, no postinstall. **Cost: a two-step
install, and a first-run failure for anyone who expected one command.** The failure text in R15 is
therefore a deliverable, not an afterthought — it is the most-read screen in the product's first five
minutes.

**No hosted mode.** §7 buys the option; it does not build it.

## 6. What would falsify this claim

- **The separateness claim fails** if the engine's own package publishes a UI subcommand that the
  market prefers, or if the UI turns out to need engine source to render anything correctly. Either
  observation means the split cost two release pipelines for nothing.
- **The zero-runtime-dependency claim fails** if a published tarball satisfying R2–R4 still cannot
  launch without a network fetch — that would mean the posture bought nothing and the constraint
  should be dropped rather than defended.
- **The digest-keyed tier fails in either direction.** If a year of engine releases never leaves
  Tier C, the write contract was stable, the version string would have been sufficient, and the tier
  machinery is dead weight to delete. If nearly every release lands in Tier B, the text parser is not
  maintainable at this cadence and the right answer is an engine ask for a machine-readable vocabulary
  door, not a better scraper.
- **The discovery order fails** if real users routinely install the engine somewhere none of the four
  steps reach, and the common resolution becomes "pass `--kscope`". That would make the shared fixture
  a description of a path nobody uses.
- **The boundary check fails as a control** the first time a leak lands and the check was green. R33's
  self-test exists so that this is a real, observable event rather than a thing we assume never
  happened.

---

## 7. The later hosted version

Three things change, and **none of them is the browser app.**

The vault stops being on the viewer's disk. Listing the whole vault on every load is a strategy that
works precisely because the store is local and small; against a shared backend it becomes a
server-side index with pagination and per-viewer authorisation, which is a different program behind
the same screens.

The single-user assumptions become an authentication problem. Loopback binding, a per-launch bearer
token and "the vault is whoever launched me" are all correct for a local tool and all meaningless for
a hosted one. In particular, the engine's write-on-read behaviour for ranked queries stops being a
consent question for one user and becomes a multi-tenant isolation question, because one viewer's
query would write into a store other viewers read.

The licence model does not transfer. The engine's entitlement is per machine, keyed to local state.
Hosting is a different authorisation model, not a copied key.

**The one thing to do now that makes all of it cheap is R38**: every engine invocation behind one
interface, in one file, with nothing else in the repository importing the process-spawning module,
enforced by a lint rule. With that in place the hosted version is a second implementation of a
single, small interface. Without it, it is an archaeology project across every screen. The browser
bundle — which already never touches a process, a path or a filesystem — does not change at all.
