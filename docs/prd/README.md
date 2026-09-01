# PRD index — what this repository builds, who owns which requirement, and the order it lands in

> **Status (2026-09-01).** Seven PRDs, all eight milestones landed — see §4 for what that does
> and does not mean. The paragraph below is the editorial pass as written on 2026-08-31 and is kept
> as it stood.
>
> **Status (2026-08-31).** Seven PRDs, none started. They were written in parallel and had not read each
> other; this document is the editorial pass over them. It states the product boundary a newcomer needs
> first, says what each PRD owns and deliberately does not, resolves every overlap and contradiction
> found between them, fixes the delivery order to the dependencies rather than to the demo, and pins the
> vocabulary. **Where this index disagrees with a PRD, this index is the newer decision** — but it does
> not rewrite them: each fix names the requirement id that has to change and which document keeps it.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Covers:** PRDs 0001–0007
**Supersedes nothing.**

---

## 1. Purpose and product boundary

### What this repository is

**A local, single-user browser for one Kaleidoscope memory vault: see everything in it, fix one memory
safely, remove one honestly, and work down the curation backlog.** It ships as one public npm package,
launched with `npx`, and it is an *open-source client for a closed-source engine*.

### What the engine is

`kscope` is a local, filesystem-native memory store for AI agents. It is a separate product, a separate
(private) repository, closed source, separately licensed, and **installed separately by the user**. It is
a command-line program: it takes JSON on stdin, writes JSON on stdout, and reports what it did in its
exit code. There is no server, no daemon, and no network call anywhere in the picture.

### The line between them

```
  BROWSER      a prebuilt page. Knows no path, no process, no command name.
     │         Holds one per-launch bearer token in memory.
     ▼
  SIDECAR      this repository. One local HTTP server on loopback, zero runtime
     │         dependencies, one file that may start a child process.
     ▼
  kscope       NOT this repository. Installed separately. Never modified by this project,
     │         never bundled into it, never downloaded by it, never updated by it.
     ▼
  THE VAULT    a directory on the user's disk. The sidecar never opens a file inside it.
```

Four rules follow from that line, and every PRD is downstream of them:

1. **This project does not change the engine.** Not for a validation rule, not for a missing field, not
   for anything in v1. A capability the engine does not have becomes a filed ask against the engine and
   an honest gap in the product — never a workaround that reaches into the vault directly.
2. **The published CLI is the only door.** No PRD may specify reading a vault file, parsing an on-disk
   layout, or inferring anything the engine does not print.
3. **This repository is public and the engine is not.** It may describe the CLI's published surface and
   the shapes it returns. It may say nothing about how the engine decides anything. A reader should be
   able to build a client and should not be able to reconstruct the engine's ranking, calibration or
   internal structure. The rule and its enforcement are in [`../BOUNDARY.md`](../BOUNDARY.md); PRD 0007
   owns the check.
4. **Reading the vault must not write to it.** The engine has one door that returns everything and writes
   nothing, and one door that ranks and *records that it ran*. Every screen in this product is built on
   the first. This is the sharpest single rule in the set and five PRDs restate it — see §3.

---

## 2. The PRD map

| # | Document | Owns | Deliberately does not own |
| --- | --- | --- | --- |
| [0001](0001-the-sidecar-and-the-door-map.md) | The sidecar and the door map | transport, the call contract, the API surface | any screen |
| [0002](0002-browsing-memory.md) | Browsing memory | the list, the filters, the detail page, refresh | any write |
| [0003](0003-the-memory-editor.md) | The memory editor | the single-memory write path and every guard on it | multi-memory writes |
| [0004](0004-removing-a-memory.md) | Removing a memory | removal, its copy, the escalation, the snapshot store | erasure, which does not exist |
| [0005](0005-the-graph-view.md) | The graph view | the canvas, the reconstruction, the encoding | the curation rail (moved to 0006) |
| [0006](0006-curation.md) | Curation | the backlog rail and every multi-memory transaction | the canvas |
| [0007](0007-packaging-and-distribution.md) | Packaging and distribution | the package, engine discovery, compatibility, the boundary gate | the runtime security posture |

**0001 — the sidecar and the door map.** The component every other PRD stands on. It owns the transport
decision (one child process per request, chosen on failure modes rather than speed), the door map from
each UI need to the command behind it, the exit-code protocol and the uniform envelope every screen
branches on, the loopback/token/CSP security posture, and the exact list of HTTP routes — including the
generic passthrough endpoint that deliberately does not exist. It owns no screen, no copy and no
user-facing behaviour beyond three launch-failure texts.

**0002 — browsing memory.** The first screen and the answer to "what does it actually know?". It owns the
listing, the filters and facets, the detail page, the refresh policy, and the rule that the box at the top
of the list is a *filter over an already-fetched payload* rather than a query. It owns the shared
hostile-content rendering path and the rule that an absent value renders as words. It owns no write.

**0003 — the memory editor.** The heart of the product and the one screen with no prior art anywhere. It
owns the single-memory write path: the load door that carries entity declarations, the projection onto the
runtime schema, the two-column layout, the entity-declaration switch and its modal, partial success, the
conflict dialog, the leading-heading rule, and hand-creation. Multi-memory operations — merge, rename,
split — are not here; they end here.

**0004 — removing a memory.** Owns the removal flow for one memory and for many, and — the actual
deliverable — the sentences the product says while doing it, because removal hides a memory and does not
erase it. It owns the escalation screen for a leaked secret, the rule that the app prints the
vault-destruction command and never runs it, and (per §3.3 below) **the snapshot store**, which is the
only undo in the product and is itself a plaintext copy outside the vault.

**0005 — the graph view.** Owns the canvas: one client-side model, three lenses, the default that is a
restriction rather than a zoom control, the encoding rules that survive open vocabularies, the scale ladder
and its refusal-as-control-panel, the hub treatment, and the fidelity strip that says permanently that this
drawing is a reconstruction. After the move in §3.3 it does **not** own the curation rail.

**0006 — curation.** Owns everything that happens *between* memories, and leads with the finding that
shapes it: there is no engine operation to wrap. Merge, rename, split and the honest meanings of "promote"
are all client-side transactions over update and delete, with a pending-merge record on disk, a preview
that names every memory it will write, serial application, and stop-on-first-refusal. After the move in
§3.3 it also owns the backlog rail that generates its candidates.

**0007 — packaging and distribution.** Owns the tarball: one Apache-2.0 npm package with an empty runtime
dependency set and no install hook, the four-step engine discovery order asserted against a fixture shared
with the other clients, the digest-keyed compatibility tiers, the licence and third-party notices, and the
boundary check with its falsifiability self-test. It owns the runtime *posture* nowhere — 0001 does.

---

## 3. Overlaps, contradictions and gaps

This section is the reason the index exists. The PRDs are individually good and collectively they claim
the same requirement seven times, disagree about three things, and leave two things unowned.

### 3.1 Requirements claimed twice — who owns, who defers

**(a) The ranked-search prohibition is stated in six documents.**
0001 R6 · 0002 R1, R2, R3, R6 · 0003 R21 · 0004 R15 · 0005 R23 · 0006 R20.

All six say the same true thing and all six specify their own exposure-count test. **0001 R6 owns it** —
it is a transport property, and the enforcement lives where the routing table lives. The other five keep
their assertion and **defer the mechanism**, contributing their flow as a case to one parameterised
harness rather than writing a sixth copy of it.

One real inconsistency inside this overlap: **0001 §3.7 states there is no search endpoint of any kind in
v1**, while **0002 R2 requires "the sidecar refuses a ranked call arriving on any other route"** — which
presupposes a dedicated route exists. **0001 is right for v1.** 0002 R2 should read: the naming convention
and the lint rule land now; the module has no route and the runtime tripwire is an assertion that the
route set contains none. The value of writing the chokepoint before a caller exists is exactly that it is
a constraint rather than a refactor.

**(b) Engine discovery is fully specified twice.**
0001 §3.4 / R10–R14 · 0007 R9–R16.

**0007 owns it.** It is a distribution concern, and it carries the one thing 0001 lacks: R13's assertion
against a *shared fixture* that the other published clients assert against too — two clients that disagree
about where the engine is are two clients that behave differently on the same machine, and reading a
sibling's source is not a verification method. 0001 R10–R14 defer to 0007 and keep only what the sidecar
does with the resolved path.

**(c) The compatibility tiers are specified twice.**
0001 §3.5 / R15–R16 · 0007 R17–R23.

**0007 owns it** — R19's table, R20's never-fall-back-to-a-bundled-vocabulary, R21's limits-read-at-runtime
and R22's perturbed-fixture test are all stronger. 0001 keeps the preflight batch that produces the
readings. See §3.2(b) for the contradiction between them.

**(d) `address_maintenance` is not routed.** 0001 R28 owns the routing test; 0006 R1 keeps the product
claim (there is no engine merge, so the UI implements one) and drops its duplicate route assertion.

**(e) One file may spawn a process; no endpoint may name a vault root.** 0001 R1 and R20 own these;
0007 R38 and R39 restate them from the hosted-mode angle and should cite rather than re-specify.

**(f) The gate on undeclared-endpoint findings** — that the check runs only when a memory declares at
least one named thing — is stated identically in 0002 R13, 0003 R11, 0005 R4 and 0006 R8. **0003 owns it**
as the write-path invariant; the other three cite it. All four are correct and consistent, which is worth
saying, because a check written without the gate blocks every legitimate memory that declares nothing.

**(g) Hostile-content rendering.** 0002 R18, 0003 R22 and 0005 R24 each require raw HTML disabled at the
tokenizer *and* sanitisation after. 0005 R24 refers to "the app's shared escaping path" — which no
document defines. **0002 owns the shared module and the hostile fixture**; 0003 and 0005 register their
surfaces as cases in the same CI run.

**(h) Build-time copy checks are specified six times** — 0002 R7 and R17, 0004 R1, 0005 R14 and R26,
0006 R13 and R14 — each with its own word list and its own allowlist. An exception granted in one check is
invisible to the others. **0007 owns one harness with one rule table and one allowlist**, in the CI job it
already owns; each PRD contributes rules. 0004 R1 already anticipates this and says so.

**(i) Serialised writes.** 0001 R9 caps write-class child processes at one per sidecar; 0006's runs are
serial by design. These agree, and 0006 should not build a second lock — it should assert against 0001 R9.

### 3.2 Contradictions — which one is right

**(a) The install-prefix allowlist.** 0001 R14 requires refusing a resolved binary outside a small
allowlist of install prefixes unless `--kscope` was passed. 0007 §5 states, under *what is not delivered*,
that "the only mitigation shipped is R16" — naming every candidate found and the one chosen. **Both
controls ship, and 0007 §5 is wrong as written.** They defend different halves: R16 makes a wrong choice
visible to the user, R14 makes the most likely wrong choice impossible. Neither closes the hole; that
needs a per-release digest to pin against, which is an engine ask. 0007 §5 should name two mitigations.

**(b) What Tier A does.** 0001 R15 makes an unrecognised contract a **full-stop screen that refuses to
launch**, alongside the licence gate and the missing model. 0007 R19 makes Tier A **read-only: readings
shown, every write refused, nothing guessed**. **0007 is right.** The reads — listing, per-memory load,
health, vocabulary — return stable shapes and stay usable; refusing to launch throws away the whole
product to protect the write path, which the tier already refuses. 0001 R15 keeps the licence gate and the
model check as launch stops and moves Tier A to read-only.

This has a third rung that must be written into the same ladder rather than as a separate policy: **0003
R6 says that if a vocabulary cannot be loaded, the editor does not open.** That is not a fourth tier — it
is the editor's behaviour when the parse yields nothing at all, which is distinct from Tier B, where the
parse degrades and closed controls become marked free text with writes still allowed. State three rungs
once, in 0007 R19, and have 0003 R6 name the rung it is a leaf of.

**(c) Who may call the exact-id read door.** 0002 R14 requires a test asserting that **"no source file
calls the exact-id read door"**. Three other requirements need exactly that door:

- 0004 §3.4 step 1 and R5 — re-read each memory's current version immediately before its removal call;
- 0004 §3.4 step 4 and R7 — verify after the call that the body is absent;
- 0006 R15 — read the duplicate marking, which the listing payload does not carry.

**0002 R14 is right in intent and wrong in scope.** Its real requirement is that no *rendering* path uses
that door, because it does not return entity declarations and a detail page built on it would disagree
with the editor. Restate it as: the detail page renders from the cached listing record, and the exact-id
read has exactly three permitted callers, enumerated by name — version re-reads before a write,
post-removal verification, and the duplicate marking.

And a straight gap falls out of the same contradiction: **0001 §3.7's route table has no endpoint for the
exact-id read at all.** 0004 and 0006 have no way to make the calls they require. 0001 adds
`GET /api/memories/:memory_id` and updates R19's route-set test.

**(d) The standing declaration versus the zero-declaration regime.** 0003 §3.5 states that the write door
supplies one standing declaration for a particular surface unless the payload declares it, and that the
editor must render it as a pre-declared, non-removable chip. 0003 §3.7 — and 0002 R13, 0005 R4 and
0006 R8 — all design for memories that declare **zero** named things, which is a real and legitimate
regime that a large share of agent-written memories are in.

Read together, those say a memory can never be in the zero-declaration regime, and an implementer who
notices will delete the gate that four PRDs depend on. **The reconciliation is that the standing
declaration does not move a memory across the switch** — the strict check applies to what the writer
declared. That sentence is not in any PRD and must be, in 0003 §3.5, with a regression test asserting a
memory that declares nothing still commits facts naming undeclared surfaces. This is the single most
load-bearing unwritten sentence in the set.

**(e) The oversized-vault refusal versus the call timeout.** 0002 R24 requires that above a configured
threshold the app names the vault size and does not attempt the load. 0001 §3.3 gives every call a
timeout, after which the request returns 504. If the count is only learned *from the export the app is
refusing to perform*, the user gets 0001's timeout instead of 0002's honest message. **0002 R24 must
source the count from the cheap health read**, which is already polled and already flat with vault size.

**(f) The licence gate: launch-time or per-call?** 0001 R15 and 0007 R15 both make it a launch-time full
stop, and 0007 R15 says explicitly it is "detected in the handshake, not discovered halfway through the
user's first edit". But 0004 R8 requires the bulk-run report to distinguish a licence refusal from a moved
version and a busy vault, per item. **Both are needed**, and the reason is worth stating rather than
leaving as an apparent inconsistency: an alpha key can lapse while the app is open. The gate is checked at
launch *and* handled as one of the four outcomes on every call. 0001 §3.5 should say so.

**(g) Two different lists both called "the four empty states."** 0002 R25 (no memories · memories but no
facts · a vault the app cannot read · a vault too large) and 0005 R8 (no memories · memories but no facts ·
facts but no connectors · the model is not bundled). They share two entries and differ on two. Rename them
per screen; an implementer reading both will assume one list and ship two of the six.

**(h) One relation, three words.** 0003 says "relation", 0005 says "relationship name", 0006 says
"relation name" — for the same field, in user-facing copy. §5 picks one.

**(i) 0002 R7 instructs a boundary violation.** It requires the exported-record type to be "generated from
a real export in CI, never hand-written". 0007 R31 forbids vault contents in fixtures and test snapshots,
and 0007 R35/R36 supply the mechanism: a synthetic-vault generator, and fixtures generated at test time
and git-ignored. **0007 wins.** 0002 R7 should read: generated at test time from the synthetic vault's own
export. The requirement's point — that nobody hand-writes a type and thereby invents a field — survives
intact.

**(j) 0004 R13 is self-defeating as written.** It requires a test that "greps the built server and client
for any invocation of `kscope vault-delete`" — but 0004 §3.3 *renders that exact command as text on
screen*, so the grep hits the feature it is protecting. It must match an invocation shape (the command
name reaching the process-spawning module), not the string.

### 3.3 Gaps — nobody owns it, and who should

**(a) The snapshot store is unowned, and three PRDs depend on it.** 0003 R20 requires a snapshot before
every write the editor performs and cites "the snapshot PRD". 0006 R18 requires one before every curation
run and cites "the snapshot-and-restore PRD". 0004 R12 requires that one path takes *none*. 0001 §3.7
already routes `/api/snapshots` and the restore door. **No document specifies where snapshots live, what
permissions they carry, how long they are kept, how many, what the screen listing them looks like, or what
a restore actually does.** The two PRDs that cite it cite a document that does not exist.

**PRD 0004 absorbs it in full** — store, retention, caps, permissions, the screen, and the copy. Not
because it is the obvious home, but because the snapshot is a full-fidelity plaintext copy of memory
content written *outside* the vault, where the vault-destruction command will never find it, and 0004 is
the document whose entire subject is what a copy on disk means. It already owns the one place a snapshot
must not be taken. 0001 keeps the endpoints; 0003 R20 and 0006 R18 become consumers.

Two things the absorbed section must settle that no PRD currently does: whether restoring a snapshot
returns a *removed* memory to service (0004 R9 already refuses to claim it without a passing test — keep
that discipline), and whether the snapshot screen is reachable before the first write (it must be, or the
write buttons are asking for trust the user cannot check).

**(b) The curation backlog rail is specified in the wrong document.** 0005 §3.4 and R11 specify it in
full — six finding types, each with the nearest existing alternative and its usage count. 0006's own scope
line puts "the islands backlog" **out of scope** and its front matter cites "the curation-backlog PRD" as
a separate document that generates its candidates. 0005 then cites the same non-existent document as a
dependency — for a rail it specifies itself.

This is not just a filing error. The rail is the highest-value genuinely new capability in the product, it
needs **no graph library**, and it is currently specified inside the document that ships last. **0006
absorbs §3.4 and R11.** 0005 keeps the canvas, the encoding and the scale ladder, and its R11 becomes:
every structural finding the canvas computes is emitted to the rail 0006 defines. This also repairs
0006's dangling reference and puts the rail on the delivery path where it belongs (§4, M5).

**(c) The merge procedure exists at two levels of completeness.** 0005 R12 requires that any merge or
rename the UI offers is implemented as update-then-delete or N updates, snapshotted, serial,
stop-on-first-refusal, naming exactly which ids landed. That is correct and it is not enough: it omits the
pending-merge record on disk (0006 R5) and the preview that names every memory (0006 R2/R3). Built from
0005 alone you get a merge with no crash recovery. **0006 R2–R7 own it**; 0005 R12 becomes a routing
requirement — every merge affordance on the canvas opens 0006's flow.

**(d) Two version policies that look like a bug in one of them.** 0004 R5 and 0006 R7 require every write
to re-read its target's version *immediately beforehand* and never to use one from a cache. 0003 does the
opposite by design: the editor uses the version from its own load and resolves staleness at save time
through the conflict dialog, because the user has been typing and their buffer must not be discarded.
**Both are right**, and the distinction is unattended runs versus a human at a keyboard. Write it down in
both, or someone will "fix" the editor to re-read and thereby silently overwrite a concurrent write.

**(e) Cross-references do not resolve.** 0003, 0005 and 0006 cite sibling PRDs by description rather than
number, and four of those descriptions name no existing document. **Every PRD cites by number** from here.

---

## 4. Delivery order

Eight milestones. The rule that sets the order: **the first one proves the seam whose failure is silent
and irreversible, and it has no user interface in it at all.** Everything visible comes after.

> **What has landed (2026-09-01).** All eight milestones are built and passing: **264 tests across 18
> files** against `kscope 0.0.5` and a clone of a 344-memory vault, a clean boundary check, a browser
> bundle of 995.1 kB, and a 411.9 kB tarball that installs into a scratch directory and serves a page
> from there. Each milestone below carries its status and the document that reports it. **A milestone
> marked landed is not a milestone with no gaps** — every status document ends in an honest-gaps
> section, and the requirements those sections name as unbuilt are listed under M8 rather than being
> counted as delivered.
>
> | milestone | status | reported in |
> | --- | --- | --- |
> | M1 The round trip | **landed** | `docs/M1-STATUS.md` |
> | M2 See everything | **landed** | `docs/M2-STATUS.md` |
> | M3 Fix one memory | **landed** | `docs/M3-STATUS.md` |
> | M4 Remove, honestly | **landed** | `docs/M4-M6-STATUS.md` |
> | M5 The backlog | **landed** | `docs/M4-M6-STATUS.md` |
> | M6 Curation transactions | **landed** | `docs/M4-M6-STATUS.md` |
> | M7 The reconstructed graph | **landed**, and photographed in a browser | `docs/M7-HUB-STATUS.md`, `docs/M7-M8-STATUS.md` |
> | M8 Ship it | **landed except three requirements**, named below | `docs/M7-M8-STATUS.md` |

### M1 — The round trip · no browser, no framework · **landed**
**0001** (the engine client and the call contract) · **0007** (discovery + the boundary gate only) ·
**0003 R1** (the assertion, not the screen).

A script that resolves the binary, runs the preflight, loads one memory through the door that carries
entity declarations, changes one character of its body, writes it back, re-reads it, and asserts the
declared-name set and the fact count are **unchanged**, with the fold state reported beside the result so
a pass cannot be lag in disguise. It also counts the vault's search records before and after and asserts
they are identical — 0001 R6's first test, written before any caller exists.

*Why first:* every later milestone is a call, and this is the one claim whose failure produces a
committed, successful-looking write that has quietly deleted data. *Why the boundary gate is in M1:* a
public git history cannot be un-pushed, and the check must exist before the first push, not before the
first release. *Why no browser:* a screen would let the round trip pass for the wrong reason.

### M2 — See everything · **landed**
**0001** (the HTTP server with the complete security posture from the first commit) · **0002**.

*Edge from M1:* the export cache and its index become the single source every later screen reads; building
any screen on a second source creates a disagreement no test will catch. *Why the security posture lands
whole here rather than later:* retrofitting a Host check is how it gets half-done, and the token-holding
origin has total read/write over the user's most sensitive local store.

### M3 — Fix one memory · **landed**
**0004's snapshot store** (from §3.3(a)), then **0003**.

*Edge from M2:* the editor is entered from a row and needs the vocabulary tier from the preflight.
*Edge inside the milestone:* the snapshot is the only undo in the product, so it precedes the first write
button; a Save with no visible snapshot is asking for trust the user has no way to check.

### M4 — Remove, honestly · **landed**
**0004's removal flow**, the escalation screen, the copy check.

*Edge from M3:* removal shares stale-version handling and the receipt shape with the editor's save path
and should reuse them, not re-derive them. *Gate, not a task:* the copy carries legal weight and needs the
owner's signature before merge, not a reviewer's approval.

### M5 — The backlog · **landed**
**0006's rail** (absorbed from 0005 §3.4). No graph library.

*Edge from M3:* every card routes into the editor's save path and inherits every guard on it, so the
editor must exist first. *Why before the canvas:* this is the highest-value capability in the product and
several hundred weakly-ordered findings are a list, not a picture. It is also the first surface anywhere
that lets a writer see which relation names already exist before coining another.

### M6 — Curation transactions · **landed**
**0006's merge, rename, split and named intents**, with the pending-merge record.

*Edge from M4:* every merge ends in a removal and borrows its copy. *Edge from M5:* the candidates come
from the rail; a merge screen with no candidate generator has nothing to act on.

### M7 — The reconstructed graph · **landed**
**0005**: the canvas, three lenses, the encoding, the scale ladder, the fidelity strip, the hub path and
its synthetic hub fixture.

*Edge from M5:* the canvas is a second view over a model the rail already built, which turns the graph
into a rendering job rather than a computation one. *Edge from M3:* every node must terminate in a verb,
and the verb is the editor.

*What landed:* all three lenses as projections of one model with C as the default, the encoding, the
scale ladder, the permanent fidelity strip with both sets of counts, view state in the URL including
the reductions, and the whole hub programme — regime detection, the `max(20, p99 × 4)` threshold, the
compound meta-node, the virtualized claim list and "absorb into context". The hub path runs in CI
against a generated 100,000-edge graph, and `scripts/synthetic-vault.mjs --hub` now writes a **vault**
whose busiest name clears the threshold, so the collapse has also been driven through a browser and
photographed. *Still open:* nothing renders in a test, so PRD 0005 R24 is argued rather than asserted;
the singleton fraction is computed and no screen reads it.

### M8 — Ship it · **landed, with three requirements outstanding**
**0007's packaging half**: the tarball, the files allowlist, the offline launch, the third-party notices,
provenance publication.

*Edge from everything:* the release test installs the packed tarball into a scratch directory and runs it
against the synthetic vault. It is the only test that catches a wrong `files` array, which is the most
common way a prebuilt package ships broken — and it can only run once there is something to pack.

*What landed:* the tarball (411.9 kB packed, 28 files, `dependencies: {}`), the files allowlist and its
denial list, the offline scan over `dist/`, generated third-party notices diffed in CI, the four-step
engine discovery with its three distinguishable launch failures, and the digest-keyed compatibility
tier with Tier A and Tier B driven from perturbed fixtures. The release test runs end to end: pack,
`--offline` install into a scratch directory, launch, serve real data from a vault this repository
generated, and shut down on SIGTERM.

*Outstanding, and not to be counted as delivered:*

- **R33** — the boundary gate has no committed falsifiability self-test. It has been demonstrated to
  fail by hand on all six mechanical classes; that is evidence it is live, not a control.
- **R13** — the engine-discovery order is implemented and tested, and not against the shared golden
  fixture the sibling clients assert against, so their agreement is a claim rather than a falsifiable
  one.
- **R28** — the licence allowlist gate over the **build-time** dependency tree is not wired. Scoping
  it to production dependencies would inspect an empty set and pass trivially, which is the failure
  the requirement itself names.
- **R29** — provenance publication has never been exercised; nothing has been published.

A boundary control the packaging PRD did not ask for was added in its place: `test/boundary-vault.test.mjs`
compares the vault against the tree and catches the leak no text scanner can — a real entity surface
used as an illustration. It found four, in this repository's own source, fixtures and documents.

---

## 5. Shared terms

The vocabulary is a product decision, not a style preference: each word below was chosen because the
obvious alternative asserts something the store does not hold.

### What this repository says

| Term | Means | Instead of |
| --- | --- | --- |
| **memory** | one record in the vault | note, entry, document, fact |
| **named thing** | a name a memory declares, with its kind and its "what this is" | entity (a wire field name, not a user-facing word) |
| **what this is** | the one-line gloss on a named thing | description, definition, notes — it is what the matcher probes with, not documentation |
| **fact** | subject · relation · object, with its qualifiers | triple, claim, statement |
| **relation** | the middle term of a fact | relationship name, predicate — **one word, and this is it** |
| **applies to** | the scope axes | context, tags, labels |
| **every project** / **every branch** / **every file** | an axis the writer left out | a blank cell — an omitted axis matches *everything*, so blank reads as "less" and means "more" |
| **written** / **write order** | the record's monotonic ordering, with the date beside it | created — the date cannot order a list |
| **filter** | narrowing an already-fetched payload in the browser | search — the ranked door records that it ran |
| **remove from memory** | the logical removal that hides a memory from everything that reads | delete, and never a trash icon |
| **reconstructed graph** | the client's own drawing, built from the export by exact spelling | the graph — it is not the engine's picture and does not agree with it |
| **not recorded** | a value the record does not carry | a blank, a dash, or a placeholder |
| **island** | a connected component with no path to the rest | cluster, orphan, group |
| **applied / refused / applied in part / unlicensed** | the four outcomes of a call, from its exit code | error, failure |
| **committed / no-write / the fold-failure code** | what a write actually did, inside a successful call | saved — two of those three are not "saved" |

### What this repository does not say

**"Permanently", "erase", "wipe", "shred".** Removal hides a memory; the text stays on disk. There is no
command that erases one. A build-time check fails on these words with one allowlisted exception, on the
screen where destroying the whole vault is named accurately.

**"Created by", "author", "source app".** No writer is recorded on a memory. A column full of "unknown"
invites the next contributor to fill it with a guess, and from then on the product asserts something the
store never recorded.

**"Last used", "used N times", "relevance", "score", "rank", "match %".** Nothing published reads back
what an agent was served, and a ranked result carries no score. An always-zero bar is worse than no bar.

**"Pin", "priority", "importance", "boost", "star", "more important".** There is no such field. The one
per-memory quantity that looks like one cannot be made to move and cannot be observed changing.

**"Promote"** as a control. It is a small menu of named intents over one call — widen or narrow where a
memory applies, change its type, extend a validity window, strengthen how a fact is known — each labelled
with the field it changes.

**Any engine internal.** No module or symbol names, no calibration or tuning-knob names, no arithmetic that
discloses one without naming it, and no citation into a document tree the reader cannot open.

### The vocabulary rule

**Memory types, relation names and entity kinds are read from the engine at runtime and are never written
down in this repository.** They are open, growing registries; a value transcribed into a dropdown, a
filter, a colour palette, a stop list or a test drifts from the engine without anyone noticing, and the
records written through it still look like data. Every option list in the product is generated at launch
from what the binary prints, and a source scan fails the build on a literal from those lists — and
**fails rather than skips** when the engine is absent on the runner.

There is exactly one allowlisted exception, and its shape is the reason it is safe: a small **denial** list
of the relation names the engine emits itself and refuses from a writer. A stale denial list fails safe by
refusing something newly permitted; a stale allow list fails open. A test asserts it is a subset of the set
parsed from the live engine, so drift is detected rather than assumed away.

The same rule covers the numbers: the request-byte ceiling and the batch-item cap are read from the
engine's published contract at startup, never hardcoded.

---

## 6. What is not planned, and why

So a reader stops asking. Each of these was considered, and each is absent for a reason that is a property
of the published surface rather than a shortage of time. Several are filed as asks against the engine; none
of them is a workaround this repository may build.

**Ranked search, and with it "why did the agent retrieve this?"** The largest gap and the one users ask for
first. The available answer is a *re-run*, not a record: it re-executes retrieval now and permanently
records that it did, per distinct query string, into a store nothing published reads back or cleans up. v1
therefore contains zero callers — which is the strongest possible position from which to add exactly one
later, behind its own consent screen that names the record before the button is pressed.

**Who wrote a memory.** No writer is carried on the record — no principal, client, app, session or device.
The nearest-looking fields are not provenance. Shown as one fixed sentence on the detail page rather than
as a column.

**When a memory was last used, and how often.** Nothing published reads back what was retrieved. So there
is no way to find the memory quietly steering every session, and no way to find the ones never served.

**Version history, a diff, and a real undo.** Prior versions exist and no published operation returns one.
A history tab that could only ever show the current row is worse than no tab. The app's own snapshot is the
only recovery path in the product, and it is coarse.

**Hard delete, purge, or redacting one field.** The product cannot erase one memory and this app cannot add
the capability. This is the only gap with legal weight. The removal flow is shaped so that a purge, when it
exists, slots in as a third option on an existing screen.

**Restoring a removed memory.** No door does it, and the snapshot path is unproven for this case. The copy
says there is no un-remove, and a passing regression test — not an argument — is what would authorise
changing it.

**Scores on results, rating a result, and any ranking affordance.** Results carry no score; the feedback
door needs a token the published surface does not return; there is no priority field.

**An engine-side merge, rename or split.** None exists. Every one of them is a client-side transaction over
update and delete, with the UI owning the ordering, the intermediate state and the recovery — and saying so.

**Address maintenance, in any mode.** Its write modes report success and leave the memory they name
unchanged. It is not routed by the sidecar at all, and no button in this product is wired to an operation
whose effect the product has not observed.

**Relation authoring and qualifier-key authoring.** Proposing a relation with its meaning and its inverse
is a genuine ontology task, and a wrong inverse makes every claim readable backwards under a verb the vault
never agreed to.

**Server-side filtering and pagination, and saved views.** The listing door offers neither, so the client's
ceiling is what it can hold and index. The listing strategy sits behind one interface from the first
commit so a better door can replace it without touching a screen.

**A multi-vault view.** The vault is fixed at launch. A parameter naming a vault root is the difference
between a memory browser and an arbitrary local-file reader, and there is no version of it safe to expose
to a page. Switching vaults means restarting.

**A semantic-space projection of the vault.** A 2-D projection of the engine's own representation is a
different view from the reconstructed graph, and the library most people reach for it with is
non-commercially licensed. Not in v1, and if ever, not that one.

**Confidence as an editable or encoded value.** It is derived, it is absent from the write contract, and
encoding a number nobody can act on invites the user to act on it. Read-only on the detail page, nowhere
else.

**Windows.** The engine publishes no Windows build to talk to. The launcher must say so plainly rather than
failing as a resolution error, which reads as "you installed it wrong".

**Auto-update, update checks and telemetry.** A network call in a product whose claim is that it makes
none. The content-security policy is what enforces that, rather than a sentence in a README.

**A hosted, multi-user version.** Not built. One requirement buys the option cheaply — every engine
invocation behind one interface in one file — and nothing else in this repository is shaped for it.

**Any change to the `kscope` binary.** Not for the leading-heading rule, not for anything in v1. The editor
composes the body, so it guarantees the heading and the human never meets the rule. Every other capability
gap is a filed ask, not a patch.
