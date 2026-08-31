# PRD 0002 — Browsing is the first job, and it is done without ever running a query

> **Status (2026-08-31).** Not started. Today a person who has installed `kscope` has no way to look
> at their own vault: the agent writes into it continuously and there is no surface, at any price,
> that shows what is in there. This document specifies the surface that answers that — a listing, a
> set of filters, and one memory's detail page — built entirely on the export door and the app's own
> index, and specified so that **nothing in the browse path ever issues a ranked query**. Out of
> scope here: editing a memory, removing one, the curation backlog, the reconstructed graph, and any
> retrieval-testing panel. Those are separate documents and each depends on this one for the way a
> user reaches a memory in the first place.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** the sidecar-and-transport PRD (binary resolution, the exit-code protocol, and the
export cache this document filters over)
**Relates to:** the memory-editor PRD (every edit begins on a row here, and the editor deliberately
loads through a different door) · the removal PRD (removal is reached from a row and its result is
visible here as an absence) · the curation PRD (it compares memories; this one shows them) · the
reconstructed-graph PRD (it draws from the same cached records)
**Supersedes nothing.**

---

## 1. The product claim

**The first job of a memory UI is not editing. It is seeing.** A person cannot fix, remove, rescope
or curate a memory they have never read, and today they have read none of them.

The reasoning is an asymmetry in how this store is used. Memories are written by agents, one at a
time, continuously, in sessions the user was not watching — and they are read back by agents, in
sessions the user is also not watching. The user is on neither side of the loop. Every other feature
this product could ship assumes the user already knows which memory is wrong; the store gives them
no way to find out. Browsing is not the easy feature you build first because it is easy. It is the
feature every other one is a special case of.

There is a second reason browsing comes first, and it is about what exists. Of everything a user
might want from this store, exactly one need is served by a door that is complete, fast, and writes
nothing: listing everything. The doors behind "why was this retrieved", "who wrote this", "when was
this last used" and "show me the previous version" are absent, partial, or write to the store while
answering. Building the complete thing first is not a compromise.

| What the user asks | What answers it here | Door |
| --- | --- | --- |
| "What does it actually know?" | the listing | `memory_lifecycle` export, once, cached |
| "What did it learn about *this project*?" | the scope facet | the same cached records |
| "What is this one memory, exactly?" | the detail page | the same cached record |
| "Did that correction land on the thing it corrects?" | the relations panel | the cached record, plus one on-demand per-memory read |
| "Is what I am looking at current?" | the refresh badge | a periodic health read that fetches nothing else |
| "Why did the agent retrieve *that*?" | **not here** | needs a ranked query, which writes |

The third claim, which is the one a reviewer should push on: **the box at the top of the list is a
filter, not a search, and this must be true in the code rather than in the label.** A ranked query
against this store records that it ran. The record is written per distinct query string, in
plaintext, and the published surface offers no way to read those records back and no way to delete
them. A type-ahead is therefore the worst possible caller: it turns a browse into a permanent,
unreadable keystroke log inside the most sensitive local store the user has. A UI that lists by
searching pollutes the thing it is displaying, monotonically, forever.

---

## 2. What it costs to get this wrong

**The listing that searches.** This is the default architecture of every memory UI that exists,
because in every other product the list endpoint is a read. Here it is a write, it is unreadable
afterwards, and it cannot be undone. Six keystrokes in a filter box is six permanent rows. The
failure is invisible in review — the screen looks right, the numbers look right, and the damage is a
directory the user will never open. It is also the failure that gets worse the more the product
succeeds.

**The listing that ships the whole record to the browser.** The export door returns every memory
with every field, and the largest fields in a record are derived — a compact numeric representation
of the memory and a second field of comparable size, neither of which any screen displays and
neither of which a user can act on. Shipping them costs a multiple of the payload for zero rendered
pixels, and it puts data on a page whose only job is to show titles. It also hides the real scaling
problem behind an artificial one.

**The column that is a comforting lie.** "Created by" is the first column anyone would add and the
easiest one to fill with plausible-looking values. There is no per-memory writer on an exported
record: no principal, no client, no app, no session, no device. The nearest fields — the scope axes
and the first-written date — look like provenance and are not. A column full of "unknown" is worse
than no column, because the next person to look at it treats the blank as a bug and fills it with a
guess, and from then on the product asserts something the store never recorded.

**The list that moves while you read it.** This vault genuinely gains memories mid-session, written
by agents nobody in the room is running. A list that re-sorts under a reading user, or a detail page
that swaps its contents, makes the product feel unreliable at exactly the moment its job is to make
the store feel reliable.

---

## 3. The mechanism, as designed

### 3.1 One door, one cache, one index

```
  kscope call memory_lifecycle   {"mode":"export"}      ← once per refresh, writes nothing
            │
            │  whole vault · no filter · no pagination · tombstoned memories excluded
            ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ SIDECAR                                                          │
  │   1. parse                                                       │
  │   2. STRIP the large derived fields from every record            │
  │   3. build indexes: by type · by scope axis · by write order ·   │
  │      by relation · a lowercased text index over the displayable  │
  │      fields                                                      │
  │   4. hold as the single shared cache                             │
  └──────────────────────────────────────────────────────────────────┘
            │  GET /api/memories?type=…&project=…&sort=…&offset=…&limit=…
            │  a page of rows. No child process is spawned to serve it.
            ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ BROWSER — virtualized table, detail page, filter controls        │
  └──────────────────────────────────────────────────────────────────┘
```

Three properties of the export door shape this and none of them are negotiable from the client side:
it returns the **whole vault every time**, it accepts **no filter and no offset**, and it **writes
nothing**. So the client's only lever is what it does after the bytes arrive, and it must do three
things there: strip, index, and serve slices.

**Stripping is not an optimisation, it is the contract with the browser.** The stripped fields are
derived from the memory rather than authored, no screen renders them, and hand-editing one would be
silently recomputed on the next write. They are removed in the sidecar, before serialization, so a
browser tab never holds them. The raw-record disclosure on the detail page (§3.5) serves the
*stripped* record and states, in the panel, which fields were removed and why — a disclosure that
silently omits fields is a worse disclosure than none.

**Everything else is kept**, because the detail page renders nearly all of it and the curation and
graph surfaces read the same cache. The cache is the only copy: the list, the detail page, the
review surface and the graph all read it, so they cannot disagree about what a memory says.

### 3.2 What a row shows

| Column | Source | Notes |
| --- | --- | --- |
| Title | the record's declared title | never scraped out of the note body |
| Type | the record's type field | rendered as its literal value, whatever that value is |
| Applies to | the three scope axes | a null axis renders as words, never as blank — see below |
| Facts | count of the record's facts | a plain integer, not a badge |
| Written | write order, with the first-written date beside it | ordering is by write order |

**A null scope axis renders as an explicit phrase — "every project", "every branch", "every file" —
never as an empty cell or a dash.** The semantics invert intuition: an axis the writer left out
matches *everything*, so a blank cell reads as "less" when it means "more". This is the single most
likely misreading on the screen and a rendered word is the whole fix.

**Ordering is by the record's monotonic write-order field, and the date is shown beside it rather
than used as the key.** The first-written value has day granularity and ties heavily on a vault
written by agents in bursts; sorting on it produces an order that changes between loads for no
reason a user can see. The date is what a human recognises, so it is displayed; the write order is
what actually orders, so it sorts.

**A state badge appears only when the memory is not in the ordinary state.** An ordinary memory gets
no badge, because a column of identical badges is furniture.

**One warning line may appear under a row:** *"N facts name things this memory does not declare."*
It appears **only when the memory declares at least one named thing.** A memory that declares none
is in a different and entirely legitimate regime, and rendering the same warning there would flag
almost every honest memory in a young vault as defective. Where a memory declares nothing, the
detail page says so neutrally and the row says nothing at all.

**What must not appear, in any column, tooltip, or export of this table:**

| Not shown | Why |
| --- | --- |
| Created by / author / source app | no per-memory writer exists on an exported record |
| Last used / used N times | nothing in the published surface reads back what was retrieved |
| Relevance, score, rank, match % | the ranked door returns no score, and the list does not rank anything |
| Priority, pin, importance | there is no such field, and the one per-memory quantity that looks like it does not move |
| Confidence, as an editable or sortable column | it is derived; it appears read-only on the detail page and nowhere else |

**Unknown reads as unknown.** Where a record does not carry a value, the UI renders the absence in
words — "not recorded" — and never a placeholder that could be mistaken for data. The rule has a
build-time check behind it, because the failure mode is a later contributor filling the blank in
good faith.

### 3.3 Filters and sort

Every control below reads its option list at runtime. **No filter anywhere in this repository holds
a literal list of type names, relation names, kinds, or scope values.** Type values come from the
vocabulary door; scope values are computed from the loaded records; relation states are computed
from the loaded records. A transcribed list is wrong the first time the engine adds a value, and it
is wrong silently — the dropdown simply stops offering something that exists.

**Type.** From `kscope call ontology {"mode":"read"}`, which returns two lists that do not contain
the same values: the set a writer may declare, and the set present in this workspace. The control
shows the declarable set first and the remainder under a divider labelled as also present in this
vault. Both are read at launch and after any write this app performs. Neither is ever hardcoded, and
the divider is not cosmetic — it is the difference between what you may write and what you may see.

**Applies to.** Three dependent facets over the scope axes, with values derived from the loaded
records and counts beside them. Each facet carries an explicit **"every project"** bucket for
records whose axis is null, listed first, because it is usually the largest bucket and it is the one
whose meaning is inverted.

**Written.** A range over write order, with the control labelled by the dates at each end. "Since I
last looked" is a preset, backed by a watermark the app stores locally — the store has no read
state, and the app does not pretend otherwise.

**Validity.** Three buckets over the serve-from / stop-serving window: currently serving, not yet,
no longer. The published write surface accepts these fields but very little in an existing vault
sets them, so the control states its own emptiness — *"no memory in this vault sets a validity
window"* — rather than rendering an empty list. A facet whose normal state is empty must say why it
is empty, or it reads as a broken control.

**Relations.** Computed client-side from the cached records, with no extra call: memories that
declare a correction of something else, memories that declare a contradiction, and — by inverting
those declarations across the whole cache — memories that are corrected or contradicted **by**
another memory. This is the honest form of "is this superseded": it is a relation the records
themselves state, and inverting it costs one pass over the cache.

**Marked duplicate is not a listing facet in v1, and the reason is a door limitation, not a
decision.** The duplicate marker is visible on the per-memory exact-id read and is not carried by
the exported record, so a listing facet over it would cost one call per memory per refresh.
Additionally, nothing in the published write surface sets it, so on a normal vault the facet would
be empty for a reason the user could not distinguish from a bug. The marker is therefore rendered on
the **detail page only**, on demand, and only when it is set — labelled "superseded by", with a link
to its target. If it ever becomes populated, promoting it to a facet is a small change; shipping a
permanently empty facet is not recoverable, because it teaches the user the vault has no duplicates.

**Removed memories are absent, not filtered.** The export door excludes them, so there is no "show
removed" toggle and no state to filter on. The app says this once, in the removal receipt, rather
than offering a control that could never work.

**Sort** is offered on write order (default, descending), title, and fact count. It is not offered
on anything the store does not order — there is no relevance sort here, and there will not be one,
because the list has no ranking to sort by.

### 3.4 The filter box

Labelled **Filter**, with a placeholder that names the count it is filtering — *"filter these N
memories"*. It matches, case-insensitively, as a substring, over the fields the user can see: title,
note body, fact subjects/predicates/objects, declared names and their glosses, and evidence
references. It runs against the sidecar's index. It spawns no process. It reaches no door.

Where a user expects a search and gets a filter, the difference is real and it will surprise
someone: a filter finds the word they typed, a ranked query finds memories that do not contain it.
The control says so in one line beneath it, and the honest answer to "I want the agent's search" is
a separate, deliberate surface that is not in v1.

### 3.5 The detail view

One page, reading from the same cached record as the row, so the two can never disagree. It is
reached by clicking a row, and it is the launch point for editing and removal.

```
‹ Memories                                          [ Edit ]   [ Remove… ]

<title>                                                        <type>
Applies to   project <x> · every branch · every file
Written      <date> · write order <n> · version <ver_…>

┌ Note ─────────────────────────────────────────────────────────────────┐
│ the memory's prose body, rendered as Markdown                         │
└───────────────────────────────────────────────────────────────────────┘

┌ Facts (n) ────────────────────────────────────────────────────────────┐
│ subject ── predicate ──▸ object            <how we know> · <kind>     │
│   true from … until …            qualifiers ▸                         │
└───────────────────────────────────────────────────────────────────────┘

┌ Named things (n) ─────────────────────────────────────────────────────┐
│ name          kind        "what this is"                              │
└───────────────────────────────────────────────────────────────────────┘

▸ Evidence (n)     ▸ Timing     ▸ Corrections & contradictions
▸ Why this was accepted     ▸ Provenance     ▸ Raw record
```

**The note** is the body as written. It is rendered with raw HTML disabled at the tokenizer *and*
sanitized afterwards — both, not either — because the body is agent-authored text from an agent that
read the open web, and script executing on this page runs inside the origin that holds the token to
the whole vault. The same treatment applies to every other field on this page, including the ones
that look inert: titles, names, glosses, fact endpoints, evidence references, and scope values.

**The facts** render as subject · predicate · object, with each fact's qualifiers — how it is known,
what kind of claim it is, its own validity window — beside it rather than hidden. Qualifier keys the
UI does not recognise are rendered as themselves under an advanced disclosure; an unknown key is
data, not an error. The derived per-fact confidence is shown read-only and labelled as computed by
the engine, because it is not a field the write contract accepts and a user who edits it would be
editing nothing.

**Named things** render name, kind, and the gloss. Where the memory declares none, the panel says
*"no named things declared"* as a neutral statement of fact and not as a warning.

**Timing** carries the validity window and the "when this happened" value, kept visually separate
from "when this was written", because they are three different times and the product should not
merge them.

**Corrections and contradictions.** Outbound links — what this memory declares it corrects or
contradicts — come from the cached record and cost nothing. The inbound direction, *what corrects or
contradicts this*, has two sources and the panel uses both: an inversion over the cache, which is
free and complete for declared links, and one on-demand per-memory read through
`kscope call memory_lifecycle {"mode":"lineage", …}`, which writes nothing, is issued **only when
the panel is expanded**, and is cached against the memory's version id so re-expanding it is free.

**Why this was accepted** renders the admission block as it is. When the record shows that nothing
was compared, the panel says so in a sentence — *"Accepted without comparing against anything."* —
rather than presenting an empty structure as an audit trail. When something was compared, it renders
the nearest memory as a link and the associated numbers labelled.

**Provenance** lists the axes that are truthful — the scope axes, the first-written date, the write
order — and closes with one fixed sentence: *"Who wrote this: not recorded. kscope does not store a
writer on a memory."* The sentence is fixed and tested, because its whole job is to stop the next
person from inventing the column.

**Version identity** appears in the header in a monospaced, selectable element, alongside the
memory's own id. It is user-visible on purpose: it is what a save conflict quotes back, and a user
comparing two of them is comparing character by character.

**There is deliberately no version-history tab and no diff.** Prior versions exist, and no published
operation returns one. A tab that could only ever show the current row is worse than no tab, because
it asserts a capability that is not there. The honest surface for "what did this used to say" is the
app's own snapshot, which is a separate document.

### 3.6 Search

**Requirement, stated before the mechanism, because the mechanism is a chokepoint and not a
feature:** a ranked query runs only in response to a deliberate, explicit human action — a click on
a control whose label says it will run a query. Never a keystroke. Never a debounce. Never a poll.
Never a background refresh, a prefetch, a warm-up, an autocomplete, a "did you mean", or a
speculative fetch on hover.

The reason is that the ranked door records that it ran, per distinct query string, in plaintext,
with no published way to read those records back and no published way to remove them. Every one of
the automatic callers above generates records at the rate the user types.

**What the UI does instead for type-ahead:** the filter box (§3.4), over the sidecar's index, which
is exact, instant, and writes nothing. The two are not the same thing and the UI does not pretend
they are — it says, once, under the box, that this finds the words you type and the agent's own
retrieval works differently.

**How the rule is enforced — four ways, all of them, because the label is not enforcement:**

1. The sidecar's engine client exposes **no generic `call(op, body)`**. Each door is a named method,
   and the ranked one is named for what it does and lives in a module whose every export begins with
   the word `writes`.
2. A lint rule forbids importing that module from anywhere except the one surface allowed to reach
   it.
3. A runtime tripwire in the sidecar refuses a ranked call that did not arrive on the dedicated
   route, and logs it as a defect rather than a refusal.
4. A CI test drives the entire browse flow — launch, list, every filter, sort, twenty keystrokes in
   the filter box, ten detail pages, a refresh — against a synthetic vault, and asserts the count of
   exposure records in the vault is **identical** before and after.

**v1 ships zero callers of the ranked door.** That is what makes the rule cheap to enforce now, and
it is precisely why it must be written into the code before a caller exists: a chokepoint added
after the first caller is a refactor, and a chokepoint added before it is a constraint.

### 3.7 Refresh

**The vault changes under the UI whenever an agent writes, and this is the normal case rather than
the edge case.** Two reads of the same vault minutes apart legitimately differ. The policy must
therefore assume drift, and must not resolve it by reloading under the user.

**The policy: detect in the background, fetch on the user's word.**

- A periodic read of `kscope call doctor {"mode":"inspect"}` runs on a fixed 30-second interval. It
  writes nothing, it is inexpensive, and its cost does not grow with the size of the vault — which
  is what makes it safe to run on a timer where re-exporting the vault would not be.
- The app compares the commit position it returns against the last one it saw. When it moves, the
  app shows a **non-modal badge** — *"N new writes — refresh"* — and **fetches nothing else**.
- The export is re-fetched on exactly four triggers: launch; an explicit refresh click; accepting
  the badge; and immediately after any write this app itself performed. Never on a timer.
- **The open editor is exempt from all of it.** It never reloads, its buffer is never touched, and
  reconciliation happens at save time through the conflict path, where the user's typing is
  protected. If the badge fires while an editor is open, the editor shows a line saying this memory
  may have changed and does nothing else.
- An accepted refresh preserves scroll position, selection, and any expanded row. Where the memory
  under the cursor has changed, the app says which one changed rather than silently swapping it.
- If the periodic read fails, the badge is simply absent and manual refresh still works. A failing
  liveness check degrades to the manual policy; it never blocks a read the user asked for.

### 3.8 Scale, and the interface that survives it

Loading the whole vault on launch is the right strategy for a vault a person is actually keeping,
and it stops being the right strategy well before a hundred thousand memories: the door has no
pagination, so the payload and the parse both grow linearly and the export eventually takes long
enough to be a stall rather than a wait.

Two consequences, both in v1:

1. **The listing strategy sits behind one interface from the first commit**, with exactly one
   implementation (fetch-whole-export-and-index). A later strategy — a cached-and-incrementally-
   refreshed index, or a different door if one is published — is a second implementation of the same
   interface, not a rewrite of every screen.
2. **Above a configured threshold the app says so and does not attempt the load.** The message names
   the count and says this version does not handle a vault this large well, and offers the read-only
   things that still work. A spinner that never ends is the failure being avoided; a refusal that
   names the reason is not a degraded product, it is an honest one.

---

## 4. Requirements

**R1.** No code path reachable from the listing, the filters, the detail page, the refresh badge, or
the periodic liveness read issues a ranked query. Test: drive the full browse flow against a
synthetic vault and assert the count of exposure records in the vault is identical before and after.

**R2.** Exactly one module in the repository may issue a ranked query; every export in it begins
with `writes`; a lint rule forbids importing it outside the single surface permitted to call it; and
the sidecar refuses a ranked call arriving on any other route. Test: an import from a forbidden
module fails lint, and a forged request to the wrong route is refused.

**R3.** The filter box issues no request that reaches the engine. Test: type twenty characters and
assert zero child processes were spawned.

**R4.** The sidecar strips the large derived fields from every record before serialization, and no
payload delivered to the browser contains them. Test: assert those field names are absent from every
API response body, on a fixture where they are present in the door's own output.

**R5.** Filtering, sorting and paging are served from the sidecar's index. Test: after the initial
load, changing any filter, sort or page spawns no process.

**R6.** The whole browse flow writes nothing to the vault. Test: capture the vault directory listing
and byte sizes before and after the flow in R1 and assert both are unchanged.

**R7.** No user-facing string, column header, tooltip, or API field claims a writer, an author, a
source application, a usage count, a last-used time, a score, a rank, or a priority. Test: a
build-time check over user-facing strings, plus a test asserting the exported-record type — which is
generated from a real export in CI, never hand-written — carries no such field.

**R8.** A value the record does not carry renders as words stating it is not recorded, never as a
blank, a dash, or a placeholder. A null scope axis renders as its "every …" phrase. Test: a fixture
record with all three scope axes null renders three phrases and zero empty cells.

**R9.** The default sort key is the record's monotonic write-order field, and the first-written date
is displayed beside it and is not the default key. Test: a fixture where several memories share one
date produces a stable, total order across two loads.

**R10.** Every filter's option list is derived at runtime — type values from the vocabulary door,
scope values from the loaded records — and no literal list of type names, kinds, relation names or
scope values exists anywhere in the repository. Test: a source scan for such literals, plus a test
that removing a value from a stubbed vocabulary response removes it from the control.

**R11.** The type control renders both lists the vocabulary door returns, with the declarable set
first and the remainder under a labelled divider. Test: a stubbed response whose two lists differ
produces both groups.

**R12.** A facet whose result set is empty renders a sentence stating why, not an empty list. Test:
with no memory setting a validity window, the validity control renders its explanatory line.

**R13.** The undeclared-endpoint warning appears on a row or detail page only when that memory
declares at least one named thing. Test: two fixtures — one declaring none with an unmatched
endpoint (renders the neutral line, no warning), one declaring at least one with an unmatched
endpoint (renders the warning).

**R14.** The detail page renders from the same cached record as the row; there is exactly one detail
path. Test: no source file calls the exact-id read door, and the fields shown on the detail page are
a superset of the fields shown on the row.

**R15.** The inbound corrections-and-contradictions read is issued only on panel expansion, writes
nothing, and is cached against the memory's version id. Test: expand, collapse and re-expand the
panel; assert exactly one call was made.

**R16.** Version identity and memory id appear on the detail page in a monospaced, selectable
element. Test: both are present in the rendered output and neither is truncated in the DOM.

**R17.** The detail page has no version-history tab, no diff view, and no control implying a prior
version can be retrieved. Test: build-time check over user-facing strings.

**R18.** Every rendered field originating in the vault is treated as hostile: raw HTML disabled at
the tokenizer and sanitized after, applied to the note, title, declared names, glosses, fact
endpoints, evidence references and scope values. Test: one fixture memory carrying script-bearing
markup in each of those fields renders on every screen in this document, and nothing executes.

**R19.** The vault is never re-fetched on a timer. A detected change sets a badge and fetches
nothing. Test: with the app idle and open, write to a clone out of band; assert the badge appears
and that zero export calls occurred until the badge was clicked.

**R20.** The periodic liveness read writes nothing, and its failure leaves the app fully usable with
the badge absent. Test: stub it to fail; assert manual refresh still loads the list.

**R21.** An accepted refresh preserves scroll position, selection and expanded state, and names any
memory currently on screen whose content changed. Test: refresh with a modified fixture and assert
the scroll anchor and selection survive.

**R22.** The raw-record disclosure states which fields were removed before the record reached the
browser. Test: the panel's text names them and the check fails if a field is added to the strip list
without being named.

**R23.** The listing strategy is reached through a single interface with exactly one implementation
in v1. Test: exactly one module implements it and exactly one module constructs it.

**R24.** Above the configured listing threshold the app renders a message naming the vault size and
does not attempt a whole-vault load. Test: a synthetic oversized fixture produces the message and
zero export calls.

**R25.** Each of the four empty states — no memories, memories but no facts, a vault the app cannot
read, and a vault larger than this version handles — renders its own distinct sentence. Test: four
fixtures, four distinct strings, none of them a generic "no results".

---

## 5. What is not delivered, in order of what it costs

**Ranked search, and with it "why did the agent retrieve that".** The largest gap, and the one users
will ask for first. It is cut because the door writes, permanently and unreadably, and because a
browse surface that contains one caller is a browse surface where the next caller is easy to add.
Cost: the user cannot see what their agent would actually be served for a given question, which is
the one question a debugging user most wants answered. It returns as its own surface, behind its own
consent screen, with the record it writes named on that screen before the button is pressed.

**Who wrote a memory.** Not deliverable at any price from the published surface: no exported record
carries a writer. Cost: on a shared or multi-agent setup the user cannot attribute a bad memory to
the run that produced it. The nearest honest axes — scope and first-written date — are displayed and
labelled as what they are.

**When a memory was last used, and how often.** Nothing published reads back what was retrieved.
Cost: no way to find the memory that is quietly steering every session, and no way to find the ones
that have never been served and could be removed.

**Version history and diff.** The prior versions exist; no published operation returns one. Cost:
"what did this used to say" is answerable only from the app's own snapshots, which start when the
app does. This is the single most-requested thing this page will be missing.

**A duplicate facet on the listing.** Costs one per-memory call per refresh to populate, and on a
normal vault would be empty for a reason the user cannot distinguish from a defect. Shown on the
detail page only, when set. Cost: a user cannot sweep the vault for duplicates from this screen —
that is the curation surface's job, and it uses different signals.

**Server-side filtering and pagination.** The door has neither, so the client's ceiling is whatever
it can hold and index. Cost: a hard upper bound on vault size for this version, mitigated by R23 and
R24 rather than hidden.

**Saved views, and filtering by declared name.** Both are cheap and both are deferred to keep the
first version of this screen small. Cost: repeat work for a user who returns to the same slice
daily.

---

## 6. What would falsify this

**The claim in §1 is that seeing comes before editing.** It is wrong if users open the app, look
once, and never return except to write — that is, if the listing turns out to be a curiosity and the
real product is the editor. The observable: the ratio of sessions that end without a write. If
almost every session ends in a write, browsing was the on-ramp and not the product, and the screen
should be built as the editor's file-picker instead of as a destination.

**The claim that the filter is enough** is wrong if users routinely fail to find a memory they know
exists. The observable: a user filters, gets nothing, and reaches for the ranked surface — or worse,
concludes the memory was never written. If that is common, the substring filter is not sufficient
and the answer is a better *local* index in the sidecar, not a ranked query in the browse path.

**The claim that whole-vault loading is the right strategy** is wrong the moment a real user's vault
makes launch feel slow. The observable is launch time on the largest vault we can find. The design
survives that discovery by construction (R23), which is the reason the interface exists before the
second implementation does.

**The refresh policy is wrong** if users report the app showing stale data without knowing it. The
observable: a user edits a memory that changed underneath them, and is surprised by the conflict.
The badge exists precisely to prevent that surprise, and if it is being ignored, the policy needs a
stronger signal — not a shorter timer.
