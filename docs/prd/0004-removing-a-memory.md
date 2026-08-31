# PRD 0004 — Removal hides a memory from everything that reads; it does not erase it, and the UI says so

> **Status (2026-08-31).** Not started. Today there is no UI, so there is no removal flow and no wording
> to be wrong. This document specifies the flow for one memory and for many, and — more importantly —
> the sentences the product says while doing it. `remember` in delete mode is a *logical* delete: the
> record is marked removed, the read and export doors stop serving it, and the text of it stays on disk
> inside the vault folder. There is no purge command in the CLI and this app cannot add one. Out of
> scope: hard delete, redaction of one field inside a memory, restoring a removed memory (no door
> returns one), and any list of what has been removed beyond the report of the run that removed it.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** PRD 0001 (the sidecar's one-process-per-call transport, and the rule that a client
branches on the exit code and never on stderr) · PRD 0002 (the memory list, which supplies the rows,
the multi-select model, and the cached listing this flow invalidates)
**Relates to:** the editor PRD — an edit and a removal are the only two writes in v1 and they share the
stale-version handling; the packaging PRD — the build-time string check specified here runs in the same
CI job as the rest of the release gate.
**Supersedes nothing.**

---

## 1. The product claim

**Removal hides a memory from everything that reads. It does not erase it from disk. The UI must say
that in the moment, in words a non-engineer understands, and must never use the word "permanently".**

The obvious implementation ships a lie. A trash icon, a red "Delete permanently" button, and a toast
reading "Deleted" would all be built in an afternoon, would test green, and would each be false. The
engine's own contract calls this mode *"logically delete one memory"*. A user who reads "permanently
deleted" and believes it will make a decision — about a leaked key, about a name that should never have
been written — on a promise the product cannot keep.

The asymmetry decides the design:

| if the copy over-promises | if the copy under-promises |
| --- | --- |
| A user stops looking for a secret that is still on disk. The damage is silent, arrives later, and is discovered by someone else. | A user does one extra thing they did not strictly need to do — rotates a key, destroys a vault. Cost: minutes. |

There is no symmetric risk here, so there is no case for softening. This is the one flow in the product
where under-promising is mandatory, and the one whose copy needs the owner's signature rather than a
reviewer's approval.

The claim has a second half that is easy to miss: **honesty is not a disclaimer, it is a shape.** An
honest removal flow has a different button label, a different confirmation, a different after-state, a
separate escalation screen, and a per-item report for bulk runs — five structural differences from the
dishonest one. A warning bolted onto the dishonest flow does not produce the honest flow.

---

## 2. What it costs to get this wrong

The concrete failure, in order of how bad it is.

**A user believes a secret is gone.** They remove the memory containing a live credential, see
"Permanently deleted", and do not rotate it. The credential is still readable in the vault folder by
anything with filesystem access, and it is still in whatever agent transcript put it there. The product
converted a recoverable incident into an unnoticed one.

**A user destroys their vault to solve a problem removal already solved.** The inverse error, from copy
that is vague rather than false. Told nothing about what removal does, a cautious user takes the only
action they are sure of. Destroying a vault to hide one memory from an agent is a total loss to avoid a
minor one.

**A bulk run reports success and did half the work.** There is no batch delete. `items` batches creates
only, so removing twelve memories is twelve separate calls, each carrying its own expected version. A
vault that agents are writing to concurrently — the normal case for this product, not the edge case —
will invalidate some of those versions while the run is in flight. A single "Removed 12 memories" toast
over a run where four were refused is a false statement about the user's own data, and the user has no
other instrument to catch it with.

**The removal flow is where a trust failure is permanent.** A user who catches the product being wrong
about deletion does not file a bug; they stop believing the rest of the interface, including the parts
that are accurate. This is the flow the product's credibility is staked on, and it is about two hundred
lines of code.

---

## 3. The mechanism, as designed

### 3.1 What removal actually does

Measured against a released build. Every row is an observable property of a published door, and every
row is user-visible somewhere in this flow:

| after `remember` in delete mode | what a client observes |
| --- | --- |
| the call itself | exit `0`, `canonical_effect: "committed"` |
| the exact-id read door (`search` with `memory_id`) | the record is still returned, its `status` reports it removed, and **`content_md` is absent** — the body is withheld, not blanked |
| the export door (`memory_lifecycle` export) | the memory is **omitted entirely**; it is not in the payload at any position |
| the lineage door (`memory_lifecycle` lineage) | still reads it, and still reports it as found |
| the vault directory on disk | **the text is still there.** Removal marks a record; it does not rewrite files, and it does not touch the copies that other files inside the vault folder hold |
| any earlier ranked search | the rows those searches wrote are untouched. `search` with a `query` writes an exposure row by contract, `ledger:false` is refused, and nothing removes those rows |

Two consequences fall straight out of that table and shape everything below.

**Removal is real where it matters.** Agents retrieve through the ranked door and the listing surface
reads through export. Both stop serving the memory immediately. "It is still on disk" is not a way of
saying removal does not work — it works, at exactly the layer the user cares about most of the time.

**Removal is not erasure, and the difference is checkable.** The user can open the vault folder and find
the text. That is precisely why the copy must say so: a claim the user can falsify in Finder is the one
kind of claim that earns trust when it holds.

### 3.2 The wording — a recommendation for the owner to sign

**Recommendation: "Remove from memory". The alternative is "Delete permanently", and it is a lie.**

The recommendation is not a euphemism, and the distinction matters enough to state. "Delete" and a trash
icon are pictures of incineration; they promise the bytes are gone. "Remove from memory" promises
something narrower and *true*: the memory leaves the set of things agents can retrieve. It names the
thing that actually happens rather than the thing the user assumes happens, and it leaves the product
somewhere to stand when the user later finds the text on disk — which they can, and eventually someone
will.

The counter-argument, stated fairly: "Remove from memory" is softer, and a softer word may make users
less careful about an action they cannot undo. That is real, and it is answered by structure rather than
by vocabulary — the confirmation says one-way in plain words, and the after-state says it again. Buying
caution with a false promise about erasure is not a trade this product may make.

**The button, everywhere it appears:** `Remove from memory` (in a crowded row: `Remove…`). No trash
icon. No "Delete". Same string in the overflow menu, the bulk action bar, the tooltip and the
accessible label.

**The confirmation, single memory, verbatim:**

```
┌ Remove this memory? ───────────────────────────────────────────────────────┐
│                                                                            │
│   Deploy runs from the release branch                                      │
│                                                                            │
│   This hides it from every agent and from exports; the text itself stays    │
│   on disk in your vault folder, because kscope has no command that erases   │
│   a memory.                                                                │
│                                                                            │
│   There is no un-remove.                                                    │
│                                                                            │
│                                     [ Cancel ]  [ Remove from memory ]     │
│                                                                            │
│   Need it genuinely gone?  →  What removal cannot do                        │
└────────────────────────────────────────────────────────────────────────────┘
```

**The one sentence, which is the load-bearing string in this PRD and must ship verbatim:**

> This hides it from every agent and from exports; the text itself stays on disk in your vault folder,
> because kscope has no command that erases a memory.

Three properties make that sentence the right one, and any replacement the owner prefers must keep all
three. It states the benefit first, so it does not read as a warning to be dismissed. It names a
mechanism the user can check ("on disk in your vault folder") rather than a euphemism. And it attributes
the absence to the product rather than to this app — *kscope has no command that erases a memory* — so
the user does not go looking for a better tool that does not exist.

**The after-state.** Once the call lands: the row leaves the list (the listing door no longer returns
it) and a receipt appears, which is not a toast that vanishes but a line the user can read:

> **Removed.** Hidden from agents and from exports. Still on disk. `mem_…`

The id is shown in mono and is selectable, because it is the only handle that still reaches the record
and the user may want it. In a bulk run the receipt is the run report of §3.4 instead.

**The word list.** `permanently`, `erase`, `erased`, `wipe`, `wiped`, `shred`, `destroy` — none of them
appear anywhere in the removal flow. The single allowed exception is the vault-destruction sentence on
the escalation screen, where "destroy the whole vault" is accurate. This is enforced by a build-time
check over user-facing strings, not by review, because copy drifts and a check does not (R1).

### 3.3 The escalation — "This contains a secret"

Some users need something genuinely gone: a key pasted into a note, a person's name that should never
have been written down. They deserve an answer, and the honest answer is uncomfortable.

This is **its own screen**, reached from a link in the confirmation and from the memory's overflow menu.
It is not a checkbox on the removal dialog, because it is not a stronger removal — it is a different
activity with a different outcome, and a checkbox would imply the product has a stronger removal to
offer. It does not.

```
What removal cannot do

  Removing a memory hides it. It does not erase it. If a password, a key, or a
  personal detail was written into this vault, removal is not enough.

  If a real credential is in here, rotate it. That is the only action that
  actually helps, and it helps whatever else you decide to do.

  There is no purge command. The only complete answer is to destroy the whole
  vault and start again:

      kscope vault-delete /path/to/your/vault

  That erases every memory you have, not just this one. We will show you the
  command; we will not run it for you.

  Before you run it:
    1. Save a snapshot of what you want to keep    [ Save a snapshot ]
    2. Open the snapshot and remove the secret from it by hand
    3. Run the command above in your own terminal
    4. Restore the cleaned snapshot

  One more thing, and it is the part most tools leave out: a secret that reached
  this vault probably also reached an agent transcript, a log, or a terminal
  history outside it. Removing one copy is not remediation. Rotating is.

  [ Copy the command ]   [ Remove from memory ]   [ Cancel ]
```

Four decisions inside that screen.

**Rotation is named first**, before either removal option, because it is the only step that changes the
attacker's position. Everything else changes where bytes sit.

**The app prints `kscope vault-delete` and never runs it.** The command is rendered with the vault root
this session already resolved and displays in its header, so the user copies something correct rather
than assembling it. Destroying a vault on a button press inside a curation tool is a blast radius no
confirmation dialog earns, and typing it in one's own shell is a meaningful consent step.

**This path takes no snapshot of the memory being removed.** Everywhere else in the product, a write is
preceded by a local snapshot, which is the app's only undo. Here that snapshot would be a fresh
plaintext copy of exactly the secret the user is trying to get rid of, written outside the vault, where
`kscope vault-delete` will never find it. The one operation whose entire purpose is that no copy exist
must not create one. The screen says so, in place, rather than silently behaving differently.

**No third option is offered**, and the screen ends by saying so rather than trailing off. A user who has
read a page about a leaked credential and been given two options will hunt for a third; telling them
there isn't one is faster and more honest than letting them search.

### 3.4 Bulk removal

**Selection.** Checkboxes in the memory list, an indeterminate header checkbox for select-all-on-page,
and an action bar that appears only when the selection is non-empty and carries the count:
`Remove 12 from memory`.

**Confirmation.** The same sentence as §3.2, pluralised, above a scrollable list of **every** title in
the selection — not the first three and a count. The user is authorising each of these, and a list they
cannot see is a list they cannot check.

```
Remove 12 memories?

  · Deploy runs from the release branch
  · Connection pooling settled at the proxy
  · Staging credentials rotated                         (scroll for 9 more)

  This hides them from every agent and from exports; the text itself stays on
  disk in your vault folder, because kscope has no command that erases a memory.

  There is no un-remove. Each one is removed separately, so this can stop
  partway — you will see exactly which ones landed.

                                    [ Cancel ]  [ Remove 12 from memory ]
```

**Execution — and the fact that shapes the whole screen: there is no batch delete.** Each removal is its
own call, carrying its own `memory_id` and its own `expected_version_id`. So:

1. **Per item, immediately before its own removal call**, re-read that memory through the exact-id read
   door to get its current `version_id`. Never carry a version taken from the listing cache, or from the
   top of the run; on a vault being written concurrently, a version read minutes ago is a version that
   may already be stale.
2. Send `remember` with `mode: "delete"`, the `memory_id`, and that `expected_version_id`. **Nothing
   else** — the delete request carries no `content_md` and no `semantic_delta` (R6). A naive
   implementation that echoes back the record it loaded is refused by the contract, which is fortunate,
   because the failure mode of it being accepted would be worse.
3. Branch on the exit code, never on stderr — a resolved call writes to stderr on success, so a wrapper
   that treats stderr as failure fails on every successful call. Exit `0` with
   `canonical_effect: "committed"` is the only outcome counted as removed. Exit `2` is a refusal
   envelope on stdout. Exit `4` is the licence gate with **stdout empty** and the message on stderr, and
   must not be reported as a crash or a parse error.
4. **Verify**, with one more exact-id read: the record's body must be absent. This costs one non-writing
   call per item and converts "the call returned success" into "the memory is actually removed" — the
   difference this PRD exists to insist on.
5. Run **serially** and **stop on the first refusal**. Do not push past a refusal to "get the rest done":
   a stale version usually means someone else is working in this vault right now, and the remaining
   items are the ones most likely to be wrong.

**The report, which is the deliverable of a bulk run, not a toast.** One row per selected memory, in the
order attempted, each in one of four states:

| state | shown as | next step offered |
| --- | --- | --- |
| removed | `Removed` + the id | none |
| refused — version moved | `Not removed — this memory changed while the run was going` | re-read and retry this one |
| refused — vault busy | `Not removed — another process is writing to this vault` | retry with backoff |
| not attempted | `Not attempted — the run stopped above this` | resume from here |

The run report keeps the titles it removed, because after a successful removal the listing door no
longer returns them and the app would otherwise be unable to name what it just did.

A partial run is a normal outcome of this design, not an incident. The screen treats it as one.

### 3.5 Recovery

**Plainly: no published door restores a removed memory.** There is no un-remove, no undelete, no
restore-from-trash. `remember` has three modes and none of them un-marks a record. The bytes are on
disk, and no operation returns them to service.

The app's own snapshot — a local export written just before a write — is the only path back that exists
even in principle, and the restore door takes one verified portable export. **Whether importing such a
snapshot actually returns a *removed* memory to service is not established.** It has never been
demonstrated, in this repository or anywhere else, and this PRD refuses to promise it on the strength of
it seeming likely. So:

- **The removal confirmation does not mention undo, and says "There is no un-remove."**
- If, and only if, a regression test demonstrates end to end that a removed memory can be restored from
  a snapshot and served again, the copy may change — and the test is the thing that authorises the copy
  change (R9).
- Until then, **from the user's point of view removal is one-way, even though the bytes remain.** Those
  two facts are not in tension; they are the whole subject of this document. The text survives, and the
  memory does not come back.

---

## 4. Requirements

**R1 — The word "permanently" appears nowhere in the removal flow.** A build-time check over
user-facing strings fails the build on `permanently`, `erase(d)`, `wipe(d)`, `shred`, or `destroy`,
with exactly one allowlisted exception: the vault-destruction sentence on the escalation screen. The
check runs in CI on every pull request and on push to the default branch.

**R2 — The action is labelled "Remove from memory" in every surface**: button, overflow menu, bulk
action bar, tooltip, accessible label, run report and receipt. No trash icon anywhere in the product. A
test asserts the strings and asserts no trash glyph is rendered on the memory list or detail screens.

**R3 — The confirmation carries the §3.2 sentence verbatim**, in the dialog body, never truncated,
never behind a disclosure triangle, never in a tooltip. A snapshot test pins the string.

**R4 — Every removal is a single-memory call.** The client contains no code path that removes more than
one memory in one call. A bulk run of N memories issues N `remember` delete calls.

**R5 — Each call re-reads its own version immediately beforehand.** No `expected_version_id` used in a
removal may come from the listing cache or from any read older than the call that precedes it. A test
drives a removal against a memory updated out of band and asserts the run reports it as changed rather
than failing opaquely.

**R6 — The delete request carries `mode`, `memory_id` and `expected_version_id` and nothing else.** No
`content_md`, no `semantic_delta`. A test asserts the exact request body.

**R7 — A removal counts as landed only on exit `0` with `canonical_effect: "committed"`, confirmed by a
follow-up exact-id read whose body is absent.** Any other exit code, any other effect value, or a
follow-up read that still returns a body is reported as *not removed*, with the observed value shown.
Branching happens on the exit code; stderr is never used to decide success.

**R8 — The three refusal classes are distinguished and worded differently:** a moved version ("this
memory changed while the run was going"), vault contention ("another process is writing to this vault",
retryable), and the licence gate (exit `4`, stdout empty). None of them is reported as "removal failed".

**R9 — No copy in the removal flow claims the removal can be undone** unless a passing regression test
demonstrates a removed memory restored from a snapshot and served again. The test gates the copy, not
the reverse.

**R10 — A bulk run is serial, stops at the first refusal, and reports every selected memory in one of
four states** (§3.4). A run that removed some and refused others never renders a single success message.
A test drives a run with a deliberately stale version in the middle and asserts the report names the
landed ids, the refused one and the unattempted remainder.

**R11 — "This contains a secret" is its own screen**, reachable from the confirmation and the overflow
menu, never a checkbox or a toggle on the removal dialog.

**R12 — The escalation path takes no snapshot**, and says so on the screen. A test asserts that
completing a removal from the escalation screen writes nothing into the app's snapshot directory.

**R13 — The app never executes `kscope vault-delete`.** It renders the command with the resolved vault
root and offers a copy button. A test greps the built server and client for any invocation of that
command and fails on a hit.

**R14 — The escalation screen names rotation before it names either removal option**, and states that a
secret in this vault has probably also reached somewhere outside it.

**R15 — The removal flow calls only `remember` in delete mode and the exact-id read door.** It never
issues a ranked search. A test counts the ranked-search rows in a scratch vault before and after driving
the entire removal flow, including the escalation screen, and asserts the count is unchanged.

---

## 5. What is not delivered, in order of what it costs

**A hard delete.** The product cannot erase one memory, and this app cannot add the capability — it is
an engine change. Cost: a user with a real secret has only two options, one of which is total loss.
This is the gap with legal weight, and it becomes urgent the first time a non-engineer keeps a vault.
Everything in this PRD is designed so that a purge, when it exists, slots in as a third option on an
existing screen rather than a redesign.

**Restoring a removed memory.** No door does it, and the snapshot path is unproven for this case (§3.5).
Cost: a mistaken removal is unrecoverable through the product. Accepted for v1 because the alternative
is claiming an undo we have not demonstrated, which is the same failure this PRD exists to prevent, one
screen over.

**Redacting a field.** There is no way to remove a credential from a memory while keeping the rest.
An edit rewrites the current version; earlier versions stay on disk. So editing a secret out of a memory
is not removal of the secret either, and the escalation screen must not imply that it is. Cost: the
narrowest fix a user would want is unavailable; they must remove the whole memory.

**Removing the rows a ranked search left behind.** Those rows record what earlier searches found, and no
published door reads or removes them. A memory can be removed while the rows naming it remain. Cost:
one more copy the escalation screen has to be honest about; it is named there and nowhere else, because
it is not something the user can act on.

**A "show removed" filter on the list.** The listing door omits removed memories, so such a list could
only ever be this app's own recollection of what it did — which is the run report, already built. Cost:
none worth paying; a list sourced from the app's memory but presented as the vault's would be a small
version of the same lie.

**Bulk removal above a few dozen.** The design is serial and stop-on-refusal by choice. A run of several
hundred on a vault under concurrent writes will stop partway more often than not. Cost: a large cleanup
is several runs. Acceptable — the alternative is a run that pushes past refusals, which is how the
highest-blast-radius operation in the product gets a way to be wrong quietly.

---

## 6. What would falsify this

**The claim in §1 is wrong if the bytes do not survive.** The test: write a memory containing a unique
token into a scratch vault, remove it through this UI, then search the vault folder for that token. If
nothing matches, removal *is* erasure, the honest copy is over-cautious, and this PRD should be rewritten
around a plainer "Delete". Run this on every release of the engine, not once — the day it starts coming
back empty is the day the copy is allowed to change, and nobody will otherwise notice.

**The wording recommendation is wrong if users cannot tell what "Remove from memory" did.** The test: a
user removes a memory and is then asked what happened to it. If they cannot say that agents stop seeing
it and the text is still on their disk, the sentence failed and the words need work — not the mechanism.

**The bulk design is wrong if partial runs never happen.** If, across real use, no run is ever
interrupted by a moved version, then serial-and-stop-on-refusal is ceremony and the per-item report is
noise over a case that does not occur. The evidence is in the run reports themselves: count runs that
stopped early. Zero over months means simplify.

**R9 is wrong the moment a passing restore test exists.** That test is the falsification, it is
welcome, and it converts one-way removal into recoverable removal with a copy change of two sentences.
Until it exists, the sentence stands.
