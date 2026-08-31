# PRD 0006 — Curation, and the merge the engine does not have

> **Status (2026-08-31).** Not started. Today the app can list, read, edit and remove one memory at a
> time; nothing in it addresses the failures that appear only *between* memories — the same thing
> written twice, one thing written under two spellings, two things written under one name. This
> document specifies that surface, and it leads with the finding that shapes all of it: **`kscope`
> publishes no operation that merges, splits, renames, or moves weight from one memory to another.**
> Every curation action in this product is composed by the client out of `remember mode=update` and
> `remember mode=delete`. Out of scope here: the editor itself, the removal copy, the graph canvas,
> the islands backlog, and any duplicate detection that requires a ranked query.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** the memory-editor PRD (every curation action ends in the editor's save path and
inherits every guard on it) · the removal PRD (every merge ends in a removal, and borrows its copy) ·
the snapshot-and-restore PRD (a curation run is the only place a snapshot is load-bearing)
**Relates to:** the curation-backlog PRD (it generates the candidates this document acts on) · the
reconstructed-graph PRD (it must never merge two names on the client's own initiative)
**Supersedes nothing.**

---

## 1. The product claim

**A memory store that only accumulates degrades, and the curation surface is what makes it a store a
person can keep rather than one they eventually abandon.**

The reasoning is an asymmetry between how memories are written and how they go wrong. They are
written one at a time, by agents, each write locally correct. They go wrong *between* memories, and
no single memory shows it: a duplicate looks fine on its own page, a name split across two spellings
looks fine from either side, and a name carrying two meanings looks fine until you read its facts
together. Every screen that shows one memory is blind to the whole failure class. Only a surface
built to compare memories can see it, and only a person can adjudicate it.

The second half of the claim is harder and it is this document's real content. There is **no engine
operation to wrap**. The published surface offers exactly two writes — create/update and delete — and
one of the operator commands is named as though it merged memories, reports that it applied, and
leaves both memories exactly as they were. So the UI does not *expose* curation; it **implements**
it, as client-side transactions over the two writes that exist, and it owns every failure mode that
follows from having no transaction underneath.

| what a user asks for | what the engine offers | what the UI must do |
| --- | --- | --- |
| "these two are the same, merge them" | nothing | compose the survivor, `update` it, then `delete` the other |
| "this name is spelled two ways" | nothing | rewrite the name in every memory that uses it — N × `update` |
| "this name means two things" | nothing | rename the minority sense in its memories — N × `update` |
| "this one matters more" | nothing — there is no such field | refuse the framing; offer the real edits instead |
| "move the weight from this one to that one" | an operation that reports success and moves nothing | never call it |
| "this was right and is now stale" | `update` — and the corrected claim keeps serving beside its correction | edit the claim in place, then remove the correction: a merge |

## 2. What it costs to get this wrong

**The observed failure, and it is the reason this document exists.** The operator surface publishes
`address_maintenance` with modes including `merge`, `split` and `rollback`. Run on a real vault, its
`merge` returns `status: "applied"`, `canonical_effect: "committed"` and `mass_conserved: true` — and
afterwards both memories are still present, still readable through every other door, and still
served. Its `inspect` returns an empty list on a real vault. A "Merge" button
wired to it ships green: it passes its own tests, returns success, and changes nothing the user can
see. The user watches the list not change and concludes the *app* is broken.

That is the shape of the mistake, and it generalises: **an operation that reports success is not
evidence of an effect.** Hence R1.

Three more, each cheap to write and expensive to ship:

- **Delete-first ordering.** A merge implemented as "remove the duplicate, then update the survivor"
  loses the duplicate's content the moment the second call fails. There is no un-delete operation.
  Recovery is a restore from a snapshot the user has never looked at.
- **Composing facts without composing names.** A merge is the only action that combines two fact sets
  *and* two lists of named things. Fold in the other memory's facts and forget its declarations, and
  the write returns committed with those facts absent from the stored record and nothing in the
  response you were required to read. This is the single most likely way to lose data in this
  product, and merge is where it is most likely to happen.
- **A confirmation that says "this cannot be undone" on every dialog.** It is true of almost
  everything here, which is exactly why a global banner trains the user to dismiss it. Reversibility
  differs per action and must be stated per action (§3.8).

## 3. The mechanism, as designed

### 3.1 The six problems, and what resolves each

| # | Problem | How the user notices | What resolves it |
| --- | --- | --- | --- |
| C1 | **The same thing remembered several times, in different words** | two near-identical rows adjacent in the list; the same claim answered twice in a session | pick a survivor, compose it, `update`, then `delete` the other — §3.3 |
| C2 | **One thing split across two spellings**, so half its facts are invisible to the other half | two nodes that are obviously one thing; a name's page shows fewer facts than the user knows exist | rewrite the losing spelling in every memory that uses it — N × `update`, §3.6 |
| C3 | **Two different things sharing one name** | a name's facts do not cohere; its "what this is" glosses disagree with each other | rename the minority sense and give it a distinguishing gloss — N × `update`, §3.6 |
| C4 | **A memory that was right and is now stale** | the user knows the world moved | either set the stop-serving date, or — far more often — fold the correction into the original and remove the correction, which is a merge (§3.3) |
| C5 | **A memory scoped wrong**, leaking into projects it should not or hiding from the one it should | a project-specific claim turns up somewhere unrelated, or a general truth never appears | `update` the scope, behind the preview in §3.10 |
| C6 | **Noise from one bad batch** | a burst of low-value rows sharing a write position | sort by write order, select the range, preview every title, then serial removals — §3.10 |

Two things worth stating plainly about C3 and C4.

**C3 has no engine help at all.** Identity between two names is decided by the exact characters of the
name as the facts spell it. The store can record that two names are the same thing, or are not, or
might be — it has no way to say *this name covers two things*. Splitting is therefore authoring, not
an operation: the user renames the minority sense, memory by memory, and the only detector available
is that one name is carrying two materially different "what this is" glosses. That detector is free
and it comes out of the listing door.

**C4 is the common one and it is not what people expect.** The validity fields exist and, on a real
vault, nothing has ever set one — so time-based staleness is not how a vault goes stale. It goes
stale by correction: a later memory corrects an earlier one, no published write names a predecessor,
and both keep serving. The honest fix is to edit the earlier claim in place and remove the now
redundant correction. That is a merge, which is why merge is the centre of this document rather than
a duplicate-cleanup nicety.

### 3.2 There is no engine merge. Lead with it.

Stated as an observable contract, because that is what a client can rely on:

1. `remember` accepts `mode` create, update and delete. Update and delete each require the memory's
   current `expected_version_id`. Delete must omit the body. The batch field on the write door
   accepts creates only — **there is no batch update and no batch delete.**
2. No published operation takes two memory ids and returns one memory.
3. No published operation renames a name across memories, or splits one.
4. `address_maintenance` names modes that read like curation. Its merge reports success and leaves
   both memories readable, present in exports, and served. **The UI does not route it in any mode.**
5. `duplicate_of` is a real field on the exact-id read, and the store follows it through chains —
   but no operation the CLI publishes sets it, and it comes back null on memories written through
   `remember`. It is a marking the client can *read* and cannot *write* (§3.5).

Therefore every curation action in this product is a client-side transaction. The UI owns the
ordering, the intermediate states, and the recovery, and it must be honest that it does.

### 3.3 The merge sequence, exactly

Inputs: a survivor `S` and a duplicate `D`, chosen by the user from a preview that shows them side by
side. Output: one memory, and one memory removed from what agents can see.

```
 0.  Load  S and D  through the door that returns declarations       (never through the exact-id read:
     that door does not return named things, and a payload rebuilt    from it drops every declaration)

 1.  COMPOSE the survivor's payload in the editor, with the user:
       body        = S's body, with anything unique from D's body merged in by hand
       facts       = union of S.facts and D.facts, de-duplicated on the triple + qualifiers
       named things= union of S's and D's declarations, de-duplicated on the exact name
       evidence    = union
       everything else = S's, unless the user changes it
     The composition is EDITABLE. The UI never presents a machine-composed payload as final.

 2.  CHECK, client-side, before any call:
       a. if the composed memory declares >= 1 named thing, every fact endpoint must be declared.
          If it declares none, this check does not run.                              (§3.4, cliff)
       b. composed counts against the per-memory caps the write contract publishes, and against the
          per-call budget for newly introduced names and relations. Read both at runtime.
       c. no fact uses a relation name the contract lists as reserved.
       Any failure here is refused in the client. The call is not made.

 3.  SNAPSHOT.  One export, to the app's own snapshot store, labelled with this merge.

 4.  RECORD the pending merge to disk BEFORE the first call:
       { survivor_id, survivor_version, survivor_payload_before, survivor_payload_after,
         duplicate_id, duplicate_version, state: "pending" }

 5.  WRITE 1 — re-read S's current version, then
       remember { mode: "update", memory_id: S, expected_version_id: <just read>, ... }
     Require a committed effect. Read `refused_facts` and compare the response's claim count against
     the number of facts submitted. Any shortfall is a hard stop: the merge does not proceed to 6.

 6.  Mark the pending record  state: "survivor_written".

 7.  WRITE 2 — re-read D's current version, then
       remember { mode: "delete", memory_id: D, expected_version_id: <just read> }   (no body)
     Require a committed effect.

 8.  Clear the pending record. Show the receipt: what the survivor now holds, and which id was removed.
```

**Ordering is not a preference.** Update-then-delete leaves, on failure, two memories where the user
asked for one — redundant, visible, and repaired by retrying one call. Delete-then-update leaves, on
failure, content that is no longer served and never reached the survivor — lost, invisible, and
repaired only by a restore. The failure states are asymmetric and the safe one costs a retry.

**Never write from the snapshot's version ids.** A vault under agent writes moves while a person
reads; the version read at step 0 can be stale by step 7. Each write re-reads its own target's
version one call before issuing (an exact-id read is cheap, flat with vault size, and writes
nothing).

### 3.4 When the second write fails after the first succeeded

This is the state the design exists to handle, and it must be survivable across a crash, not merely
across an exception.

**The intermediate state, named for the user:** *"Half-finished merge — the survivor has both
memories' content; the other memory is still here."* Not an error toast. A persistent banner, rebuilt
at launch from the pending record on disk, that does not go away until the user resolves it.

Two actions, both one click, each stating what it will do:

- **Finish the merge** — re-read `D`'s version and retry the removal. The ordinary case: the removal
  was refused for a stale version or a busy vault, both of which are correctable refusals rather than
  outages.
- **Undo the merge** — write `survivor_payload_before` back to `S` with a fresh version read. This is
  possible only because step 4 stored it; without the pending record there is nothing to write back
  and the user is sent to the snapshot store instead.

Three cases the banner distinguishes, because they need different answers:

| failure at step 7 | what it means | what the UI offers |
| --- | --- | --- |
| stale version on `D` | someone wrote `D` while the user was merging; `D`'s new content may not be in `S` | show `D`'s diff since step 0. Finish, re-merge, or abandon — never a blind retry |
| a contended / busy refusal | another process holds the vault | retry with backoff, three attempts, then *"another process is writing to this vault"* — not *"save failed"* |
| anything else, including a crash | unknown | the banner, both actions, and the snapshot named |

**The rule underneath:** a merge is complete only when both writes have returned a committed effect.
Until then the UI says so, in the list as well as the banner — the survivor and the duplicate both
carry a "merge in progress" marker so the user cannot meet either of them without context.

### 3.5 The duplicate view

The store carries a `duplicate_of` marking on a memory, returned by the exact-id read, and it follows
that marking through chains: A marks B, B marks C. A marked memory stops being retrieved only when
its chain ends on a memory that is itself being served — so a chain that terminates on a removed
memory does not hide anything.

Three consequences for the design, all observable:

1. **The marking is not in the listing payload.** It comes back only from the exact-id read, one
   memory at a time. Those reads are cheap, flat with vault size, and write nothing, so the sidecar
   fetches them lazily behind the list and caches them. There is no door that lists duplicate
   clusters.
2. **No operation the client can call sets it.** On a vault written through the published doors it is
   null everywhere. The view is therefore *correct and empty*, and that must be designed for rather
   than discovered.
3. **A chain can dangle.** The UI resolves the chain to its endpoint and flags an endpoint that is
   not being served, because that is a marked memory that is still visible to agents.

**The screen.** One list of *clusters*, each cluster a survivor and the memories pointing at it, each
row labelled with **where the claim came from** — never blended into one confidence number:

| source of the claim | strength | writes anything? |
| --- | --- | --- |
| the store's own `duplicate_of` chain | strongest — the store already treats it this way | no |
| the consolidation sweep's candidate lists (§3.9) | strong, and narrow (§5) | no |
| the client's own overlap over the cached listing — same fact set, same title, same scope | weak, and the only one that fires today | no |

Per cluster, three actions and no others:

- **Compare** — the two memories side by side, body against body, facts as sets with the difference
  highlighted, named things as sets, scope and timing beside each other. This is the screen that does
  the work; the merge is the small part.
- **Merge** — §3.3, with the survivor pre-selected as the one with more facts and the choice editable.
- **Not a duplicate** — dismisses the candidate. **Stored in the app's own store, not in the vault**,
  and the UI says so: *"only changes what this app shows you."* Inventing a vault-side dismissal the
  store cannot see would be a mechanism that reports a state nothing holds.

**Empty state, since it is the state every real vault is in:** *"Nothing here is marked as a duplicate
of anything else. The store has a place to record that; nothing writes it yet. Candidates found by
comparing your memories appear below."* Never a nav badge that always reads zero.

### 3.6 Split names and conflated names

Both are N × `update` across the memories that use a name, and they share one hazard that is worth
more than the feature: **rewrite a name in the facts and forget it in the declarations — or the
reverse — and every fact naming it is dropped from the stored record while the write reports
committed.** Rename is a loop, so one bug does that across N memories and reports N successes.

The flow, identical for C2 and C3:

1. The candidate arrives from the backlog surface (near-miss spellings, or one name carrying two
   materially different glosses). A candidate is a *suggestion for a person*, never a verdict.
2. The preview lists **every memory that will be written**, with its title, id, and the facts that
   will change — in the order they will be written.
3. Snapshot, then serially: re-read version → `update` → verify. **Stop at the first refusal.**
4. The receipt names exactly which ids landed and which were not attempted, and offers to resume.

Rules that make it safe:

- The rewrite is applied to `facts[].subject`, `facts[].object` **and** the declaration's name in one
  composed payload per memory. They are never two passes.
- Every write re-runs the client-side endpoint check from §3.3 step 2a, under the same condition:
  only when that memory declares at least one named thing.
- Two names are **never** merged automatically on a normalised key. A normalised collision is a
  candidate; a leading dot or a hyphen can be a real distinction, and a wrong unification is an
  N-memory rewrite with no undo. The clusterer feeds the list and never rewrites the graph.

### 3.7 What "promote" can honestly mean

The word came from the owner and it does not map to a field. Worked out against what the write
contract actually accepts:

| candidate meaning | real? | what it is |
| --- | --- | --- |
| **widen where it applies** — clear a scope axis so it matches everywhere | **yes** — the most useful one | an `update` to scope. An omitted axis matches every request; a set axis matches only that value |
| **narrow where it applies** | yes | the same edit, inverted. The honest opposite of promote |
| **extend or remove a stop-serving date** | yes | an `update` to the validity window — and the UI would be the first thing in the system to write one |
| **strengthen how a fact is known** | yes | an `update` to the fact's basis, from the closed list the write contract publishes. Read the values at runtime |
| **change what kind of claim a fact makes** | yes, and it has consequences the contract describes | an `update`. The UI names the field and does not narrate the engine |
| **reclassify the memory's type** | yes, with a side effect worth stating | duplicate comparison happens within a type, so reclassifying moves which memories it is ever compared against |
| **raise its confidence** | **no** | confidence is derived, absent from the write contract, and read-only in this product |
| **pin it / prioritise it / boost it** | **no field exists** | there is nothing to write |

So: **"Promote" is not a button. It is a small menu of named intents over one call**, each labelled
with the thing it changes and previewed like everything else in §3.10. And the negative half is a
requirement, not a note: **no affordance in this product may imply a ranking the store does not have**
— no pin, no star, no priority, no importance, no boost, no "make this more important". The only
per-memory quantity the operator surface exposes is one the client cannot make non-zero and cannot
observe changing, which is not a ranking lever; it is a field the UI does not touch.

### 3.8 Reversibility, per operation, honestly

The engine publishes a rollback. It belongs to the operation whose effect the UI never observed —
so **it does not undo a merge, an edit, a rename, or a removal.** It is a true row in the table and
it is not a recovery path for anything in this document.

`R` = reversible through the engine's own published doors. "Snapshot" means the app's own pre-write
export plus the import door — coarse, and the only undo that exists.

| operation | R | what actually recovers it | what the confirmation must say |
| --- | --- | --- | --- |
| Edit one memory | **No** | snapshot | "This replaces the current version. There is no undo inside kscope; we saved a snapshot first." |
| Remove one memory | **No** | snapshot | "Agents stop retrieving it. The text stays on your disk. Nothing un-removes it." |
| **UI merge (update + delete)** | **No, twice** | snapshot; and, between the two writes, the pending record | "Two writes: we update this one, then remove that one. If the second fails we will tell you and offer to finish it." |
| Rename a name across N memories | **No** | snapshot, and only for the memories the run actually wrote | "This writes N memories. It stops at the first refusal and tells you which ones landed." |
| Split a conflated name | **No** | same | same |
| Rescope / retime / restrengthen ("promote") | **No** | snapshot | "This changes where it applies. Nothing serves differently until you save." |
| Bulk removal after a bad batch | **No** | snapshot | names the count and every title |
| Adding the first declaration to a memory that had none | **No** — and it can drop facts | snapshot, or re-authoring the dropped facts | the modal in §3.3 step 2a, before the call |
| Consolidation sweep | **No** | snapshot | "This is housekeeping over derived data. It is not undoable and it does not merge anything." |
| Restore from a snapshot | n/a | it *is* the recovery | names what it will overwrite |
| Roll back an address transition | *yes* | — | **not offered.** It reverses an operation with no observable effect |

The requirement that falls out: **reversibility is stated in the confirmation for that action, in
words, in the dialog** — not in the docs, not in a global banner. A single "this cannot be undone"
repeated everywhere is dismissed everywhere, and then the one dialog that needed reading is not read.

### 3.9 The consolidation sweep

The operator surface publishes a bounded consolidation sweep with two modes: a read that reports what
it would consider, and a run that performs it. What is true of it, observably:

- The **read** is free, writes nothing, and returns a comparison count with two candidate lists — one
  for near-identical memories, one for pairs proposed for review. On a working vault both came back
  empty, including for a pair of memories deliberately written to carry an identical fact. So the
  sweep is real, and it is **not** the paraphrase-duplicate detector a curation screen wants.
- The **run** is bounded and fast; it re-embeds and reclaims. It is housekeeping over derived data.
  **It is not a curation operation and must never be labelled as one.**
- The read also reports a schedule flag that reads as due on vaults that need nothing. It must never
  become a badge, a nag, or a red dot.

**How the UI exposes it.** On the duplicates screen, under its own heading, in this order and no
other: run the read; render its comparison count and both candidate lists (usually empty, and
rendered as *"the store compared N pairs and proposed none"*, never as a blank panel); and only then
offer the run, behind a preview that states what it will and will not do, with the snapshot taken
first. **The run is never offered from a badge, a schedule, or a startup prompt.** A user must have
seen the read's output on screen in the same session before the run button exists.

### 3.10 The shape every curation action shares

One component, reused by all of them, because the failure mode is identical and so is the fix:

```
  PREVIEW                     what will be written, by name, in order
  ├─ the count                "4 memories will be written; 1 will be removed"
  ├─ the list                 every title and id, in write order — never "4 memories" alone
  ├─ the diff                 per memory, what changes: body, facts as a set diff, names as a set diff
  ├─ the checks               endpoint check (when the memory declares at least one name),
  │                           caps and per-call budget, reserved relation names — all before any call
  ├─ reversibility            the row from §3.8, in words, for THIS action
  └─ [ Cancel ]  [ Do it ]    the write is issued from this gesture and no earlier

  RUN                         snapshot → serial writes, each re-reading its own version first
  ├─ stops at the first refusal
  └─ never writes from the snapshot's version ids

  RECEIPT                     exactly which ids landed, which were not attempted, and what to do next
```

Three properties of that component that are requirements and not styling: the preview names the
memories rather than counting them; the write is issued from the preview's own button, so no gesture
both opens a preview and commits; and a run that stops halfway reports the boundary rather than a
failure.

## 4. Requirements

**R1.** The UI never calls an engine operation whose effect it has not observed. Concretely:
`address_maintenance` is not routed by the sidecar in any mode, the client module exports no generic
`call(op, body)`, and a test asserts that no HTTP route on the sidecar can reach that operation.

**R2.** No curation operation is ever applied without a preview. The write is issued from the
preview's own confirm button; no gesture in the product both opens a preview and commits a write.
Test: drive every curation entry point and assert no `remember` invocation occurs before the confirm.

**R3.** A preview names every memory it will write — title and id, in write order — and never states
only a count. Test: a preview over N memories renders N named rows.

**R4.** Merge is ordered survivor-`update` first, duplicate-`delete` second, always. Test: instrument
the client, run a merge, assert the call order and assert that a forced failure of the second call
leaves both memories readable.

**R5.** A merge writes a pending-merge record to the app's own store *before* the first call,
containing both ids, both versions, and the survivor's payload before and after; it clears the record
only after the second call returns a committed effect. Test: kill the process between the two writes
and assert the record survives with `state: "survivor_written"`.

**R6.** An uncleared pending-merge record raises a persistent banner at launch offering exactly two
actions — finish the merge, and undo the merge — each naming what it will do. Test: seed a pending
record, launch, assert the banner and both actions.

**R7.** Every write in a curation run re-reads its target's version immediately beforehand and never
writes with a version taken from the snapshot. A run stops at the first refusal and reports exactly
which ids landed. Test: change a target's version out of band mid-run and assert the run stops and
names the boundary.

**R8.** A composed merge payload carries the union of both memories' declarations. When the composed
memory declares at least one named thing, every composed fact endpoint must be declared before the
call is made; when it declares none, that check does not run. Test both branches, and assert the
zero-declaration case is not blocked.

**R9.** A merge or edit that turns a memory declaring no names into one that declares at least one is
a modal decision, stating that every fact endpoint must then be declared and offering to declare them
all. It is never a silent side effect of composing. Test: compose a zero-declaration memory with a
declaring one and assert the modal fires before any call.

**R10.** Every composed payload is counted client-side against the per-memory caps the write contract
publishes and the per-call budget for newly introduced names and relations, both read at runtime and
never hardcoded. An over-cap merge is refused in the client with the counts shown, before any call.

**R11.** `refused_facts` is read on every curation write and matched against row surfaces by string,
never by the index in the response; and the response's claim count is compared against the number of
facts submitted, with a shortfall raised as a hard error that re-reads the memory and shows what
actually landed. Test both.

**R12.** Every confirmation states the reversibility of that specific action, in words, from the
§3.8 table. There is no global "this cannot be undone" banner. Test: assert every confirmation
component renders a reversibility line, and assert the strings differ per action.

**R13.** No affordance implies a rank the store does not have. Build-time check over user-facing
strings for pin / priority / importance / boost / star / rank / "more important"; a hit outside a
reviewed allowlist fails the build.

**R14.** "Promote" is never a control. Widening scope, changing type, extending validity and
strengthening a fact's basis are separate named intents, each labelled with the field it changes.
Test: assert no user-facing string is the bare word "Promote".

**R15.** The duplicate view reads `duplicate_of` per memory through the exact-id door, follows the
chain to its endpoint, and flags an endpoint that is not being served. It renders an explained empty
state and never a nav badge that reads zero.

**R16.** Every duplicate candidate is labelled with where the claim came from, candidates from
different sources are never blended into one score, and no candidate is ever applied automatically.
"Not a duplicate" is stored by the app and the UI says that it is.

**R17.** The consolidation sweep's run is reachable only after its read has been rendered on screen
in the same session, behind a preview and a snapshot; the sweep's schedule flag never produces a
badge, a nag, or a prompt.

**R18.** Every curation run takes a snapshot before its first write, except the path whose entire
purpose is that no copy exist — removing something secret — which takes none and says so in the
confirmation.

**R19.** The near-miss clusterer is a candidate generator only. No two names are ever unified
automatically on a normalised key, and no client-side clustering ever changes what the graph draws.

**R20.** A curation session writes no exposure rows. Test: count the exposure directories in a
throwaway vault, drive the entire curation surface — duplicates, compare, merge, rename, promote,
sweep read, bulk removal — and assert the count is unchanged.

## 5. What is not delivered, in order of what it costs

1. **A real merge.** What ships is two writes with a client-owned transaction around them. The cost is
   visible: a crash or a refusal between them leaves a half-finished merge the user must resolve.
   Everything in §3.4 exists to make that cost small and honest rather than invisible. It disappears
   entirely the day the engine publishes a merge, and not before.
2. **Undo of a merge.** Nothing in the engine returns a prior version, so recovery is a restore from
   the app's own snapshot — coarse, and further from the user's mental model than an undo. The
   pending record narrows the window to a single merge in flight; outside that window the answer is
   the snapshot store.
3. **Paraphrase-duplicate detection.** The engine's sweep does not find them. The client's own overlap
   detector finds obvious ones — same facts, same title, same scope — and misses the rest. The one
   detector in the system that genuinely finds them is a ranked query's own dropped-as-redundant
   list, and a ranked query writes a permanent row to the vault it is inspecting and costs a full
   query per memory. That is cut, and it belongs behind its own consent screen if it ever ships.
4. **Bulk rename as an operation.** It is N writes with no transaction. Shipped as a serial run that
   stops at the first refusal and names what landed, which is the honest form, not the convenient one.
5. **Splitting a conflated name automatically.** The store can say two names are the same or not the
   same; it cannot say one name covers two things. The UI detects the symptom — one name carrying two
   materially different glosses — and the user does the rest.
6. **Cross-memory supersession as a declared link.** No published write names a predecessor, so a
   correction cannot be attached to what it corrects. The UI's answer is to fold the correction into
   the original and remove it, which is a merge, which is why C4 is not a feature of its own.
7. **Predicate convergence.** There is no stored registry of relation names to reuse from; the
   inventory the UI shows is computed per session from the listing. Converging two relation names is
   N × `update` with no operation behind it, and it lives in the backlog surface, not here.
8. **Any priority.** There is no field. This is not a gap the UI can close and it must not pretend
   otherwise.

## 6. What would falsify this

- **A published merge, split, or rename operation.** Most of §3.3 and §3.4 becomes a wrapper, R4–R6
  become obsolete, and the claim that the client must own the transaction was wrong. This is the most
  likely falsifier and the design should be cheap to retire.
- **A door that returns a prior version.** The reversibility column in §3.8 changes from No to Yes on
  four rows, the snapshot stops being the only undo, and R18 stops being load-bearing.
- **A duplicate detector that finds paraphrases.** The whole candidate ranking in §3.5 collapses to
  one source, and the client-side overlap detector should be deleted rather than kept as a third
  opinion.
- **Users who, given the preview, still merge the wrong pair.** That would say the preview is
  ceremony and the risk sits somewhere else — most likely in the comparison, not the confirmation —
  and R2/R3 are protecting the wrong step.
- **Nobody curates.** If the people whose vaults hold the backlog open this surface less than once
  per session and their vaults keep working, then §1 is wrong: the store degrades and it does not
  matter, and the effort belongs in reading rather than repair.
