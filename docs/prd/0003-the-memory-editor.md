# PRD 0003 — The memory editor: a person fixes what an agent wrote, without learning the write contract

> **Status (2026-08-31).** Not started. Today the only way to correct a memory an agent got wrong is to
> hand-assemble a complete `remember` payload — a body, a title, a type, every fact as a triple with its
> qualifiers, every named thing with its kind and its gloss, a scope, and the exact version id you expect
> to replace — and send it as JSON on stdin. Nobody does this. This document specifies the one screen that
> makes it a form. It also specifies the one seam that would quietly destroy data if this screen were built
> the obvious way, and the tests that keep it from being built that way. Out of scope: multi-memory
> operations (rename, merge, split — PRD 0006), removal and its copy, the graph canvas, the curation
> backlog, and anything requiring a ranked query.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** the transport PRD (the client that spawns the binary, branches on exit codes, and strips
the large derived fields before a record reaches the browser) · the snapshot PRD (the editor's only undo) ·
the read-path PRD (the list and detail screens this one is entered from)
**Relates to:** PRD 0006 — curation (every curation action ends in this screen's save path and inherits
every guard on it) · the removal PRD (the sibling write, with the harder copy)
**Supersedes nothing.**

---

## 1. The product claim

**A person must be able to fix a memory an agent wrote without knowing that a memory has a structure, and
without a save ever losing something they did not choose to lose.**

Both halves are load-bearing and the second is the hard one.

The engine's write door is deliberately strict: it takes a structured delta, not prose, because the runtime
refuses to infer meaning from sentences. That strictness is the right decision for the agent that writes and
the wrong experience for the human who corrects. A human arrives with one intent — *this sentence is wrong*,
*this name is spelled two ways*, *this should not apply to every project* — and the door asks for a complete
record. The gap between those two is the entire product of this screen.

The asymmetry that sets every requirement below: **an edit made to improve a memory can leave it worse, and
the door reports success either way.** A write can commit having stored fewer facts than it was sent. A
write assembled from what the display door returned can strip every named thing the memory declared. Neither
raises an error, neither returns a non-zero exit code, and neither is visible on the screen the user is
looking at. So this screen is not judged on how pleasant it is to type into. It is judged on whether a save
can ever be a net loss that nobody sees.

| the user's intent | what the door requires | what this screen does |
| --- | --- | --- |
| "this sentence is wrong" | the whole body **and** the whole structure | re-sends the structure it loaded, unchanged, beside the edited body |
| "add a fact" | the fact, and a declaration for anything it names | a triple row, and a one-click declare beside the endpoint that needs one |
| "this name is vague" | a name, a kind, and a required gloss | three fields, the gloss first-class and required |
| "this belongs to one project" | a full delta with a changed scope | three scope controls, everything else carried through |
| "undo that" | nothing — no door returns a prior version | a snapshot taken before the write, and an honest statement that this is the only undo |

## 2. What it costs to get this wrong

**The observed failure, and it is why R1 exists.** There are two doors that return a memory. The one that
displays a memory returns its body, its title, its type, its facts, its scope and its version — and **not
its entity declarations**. The write door requires them. An editor built the obvious way — load through the
door whose response looks exactly like a memory, let the user change one word, send it back — produces a
valid, accepted, committed write in which every named thing the memory declared has been deleted. The exit
code is 0. The response says committed. The screen says saved. Nothing about the memory looks different on
the detail page, because the detail page reads from the same lossy door.

The damage is worse than losing a list. The number of declarations a memory carries decides how the rest of
it is interpreted: with **zero** declarations, every fact is accepted and every name it mentions is matched
loosely; with **one or more**, every name a fact mentions must be declared or that fact is dropped. So a
round-trip through the display door does not only erase the declarations — it moves the memory across a
behavioural switch, and it does it on an edit the user believes was a typo fix.

Three more, each one line of code away:

- **A save that reports success having stored fewer facts than it was sent.** Send a fact naming something
  the memory declares nothing about, in a memory that declares something: that fact is refused on its own,
  the rest commits, and the response carries a list of what it refused — a key that is **absent entirely
  when nothing was refused**. A client that checks the exit code and renders "Saved" has just told the user
  their work landed when a third of it was dropped.
- **Highlighting the wrong row.** The refusal list carries an index. Measured: that index does not
  correspond to the position of the fact in the payload that was sent. An editor that highlights
  `factRows[index]` points confidently at an innocent row, in the one situation where being wrong matters.
- **Losing the user's typing to a conflict.** The vault is written by agents while the tab is open — this is
  the normal case, not the edge case. A save that fails on a stale version and re-loads the screen has
  destroyed work to report a recoverable condition. The refusal is recoverable and it names the version that
  is now current; there is never a reason to discard a buffer.

## 3. The mechanism, as designed

### 3.1 The load path — the seam that must not be got wrong

**The editor loads through `memory_lifecycle {mode:"lineage", memory_id}`.** Not through the display door,
not from the cached listing, not from anything derived from either.

Two reasons, and both are independently sufficient:

1. **It is the door that carries `entities[]`.** The write requires them; the display door does not return
   them; there is no third source. This is not a preference between two equivalent doors.
2. **`expected_version_id` must be current at the moment the form opens.** A cached version id is a
   conflict the user did not cause. The lineage read is cheap and is taken every time the editor opens,
   including when a perfectly good cached record already exists.

The client projects that record onto **exactly** the fields the runtime schema names for `semantic_delta`,
and drops everything else. This is not tidiness: a field the runtime schema does not name causes the whole
call to fail to parse, so an editor that spreads the loaded record into the payload breaks on every field
the engine ever adds. Fields the editor does not expose (a verbatim source excerpt, anything the schema
lists that this version does not render) are carried through **unchanged when the loaded record supplies
them and omitted when it does not** — never invented, never defaulted.

Derived fields never make the round trip in either direction. The write contract has no place for them, and
the large derived fields are stripped in the client layer before the record reaches the browser at all.

### 3.2 What a save actually sends

**There is no body-only write.** `remember` in update mode replaces the body *and* the structure together.
A prose-only edit is therefore not a smaller call — it is the same call, with the loaded structure re-sent
unchanged beside the new body.

Two consequences the design lives with:

- **Editing the body does update how the memory is found.** Measured: changing only the body changes the
  derived representation the engine searches on, so an edited memory becomes findable by its new words. The
  feared "the prose says one thing and retrieval still keys on the old words" failure does not occur.
- **The facts can drift from the prose, and nothing in the engine notices.** This is now the main authoring
  hazard in the product. A user rewrites a paragraph, the body is re-embedded and the memory is found by its
  new words — and the facts, which are what an agent reasons on, still say the old thing. The two halves of
  the memory now disagree, silently, and nothing will ever reconcile them.

The whole answer to that is adjacency, and it is why the layout is fixed rather than a preference.

### 3.3 Layout — facts beside the prose, never behind it

Two columns: the note on the left, facts and named things on the right, **both on screen at all times**.
Not a tab, not an accordion, not a "structure" panel that opens on demand. A hazard you can only see by
navigating is a hazard you create while looking away.

```
┌ Editing ─────────────────────────────────── version ver_… ── [Cancel] [Save] ┐
│ Title *  [                                                                 ] │
│ Type  *  [ ▾ ]     Applies to  [ project ▾ ] [ branch ▾ ] [ file ▾ ]         │
├───────────────────────────────────┬──────────────────────────────────────────┤
│ NOTE                              │ FACTS   3/<cap>            [ + Add fact ]│
│ ┌───────────────────────────────┐ │ ┌──────────────────────────────────────┐ │
│ │ # <title>                     │ │ │ <subject>                            │ │
│ │                               │ │ │   ── <relation> ───────────▸         │ │
│ │ …                             │ │ │ <object>                    ⋯   ✕    │ │
│ │                               │ │ ├──────────────────────────────────────┤ │
│ │  You changed the note but not │ │ │ <subject>                            │ │
│ │  the facts.            [ Why? ]│ │ │   ── <relation> ───────────▸        │ │
│ └───────────────────────────────┘ │ │ <object>   ⚠ not declared   ⋯   ✕    │ │
│  <n> characters                   │ └──────────────────────────────────────┘ │
│                                   │ NAMED THINGS  3/<cap> · 1 new (max <m>)  │
│                                   │ ┌──────────────────────────────────────┐ │
│                                   │ │ <name>   <kind>                  ✕   │ │
│                                   │ │  What this is: …                     │ │
│                                   │ └──────────────────────────────────────┘ │
│                                   │ ▸ Timing   ▸ Evidence   ▸ Corrections    │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

On a narrow viewport the columns stack **facts first**, and the note editor carries a sticky summary bar
showing the fact count and any warning chip, so divergence stays visible while typing.

Three affordances against drift, in increasing intrusiveness, and only the first is always on:

1. **Adjacency.** The facts are on screen. This is most of the fix.
2. **A dirty-prose hint.** When the body has been edited in this session and no fact has, a quiet line under
   the fact list says so. It is a hint. It never blocks a save — many prose edits are genuinely typo fixes,
   and a modal on every one of them is a modal nobody reads.
3. **Unlinked mentions.** Quoted or capitalised phrases in the note that are not any fact's subject or
   object are underlined, with a one-click "add a fact about this". Entirely client-side.

**Deliberately not built: any attempt to derive facts from the prose.** The product's central decision is
that the runtime never infers meaning from sentences; the writer supplies the structure. A UI that ran an
extraction model would reintroduce exactly the thing the product removed, and would need a model it cannot
ship.

### 3.4 Fact editing

A fact is a subject, a relation and an object, plus qualifiers. Rows are added, removed and reordered
freely; the qualifiers live behind a per-row disclosure so the common case is three fields.

- **Subject and object** are plain text with a suggestion list drawn from the names already used in this
  vault, so reuse is easier than coining. Selecting an existing name is what makes a fact join the rest of
  the vault instead of starting a new island.
- **The relation** control is described in §3.6.
- **Qualifiers** — how the claim is known, what kind of claim it is, and the window over which it is true —
  are closed-value controls generated from the runtime schema. The date controls take their precision from
  the grain selector beside them.
- **Confidence is read-only**, rendered disabled and labelled as computed by kscope. It is not in the write
  contract; showing it as an input would be an invitation to edit something that will be overwritten.
- **Two live counters, against two different limits.** The first is the cap the refusal messages name: at
  the cap, Add is disabled and the offered route is *"split this into two memories"*. The second is the
  per-write budget for **new** names and **new** relations, which is much lower than the cap and which the
  write response reports against rather than refusing. They are different numbers with different
  consequences and must not share a counter.
- **Duplicate triples** are flagged client-side before the save: two rows with the same subject, relation,
  object and qualifiers are either silently collapsed or refused depending on whether the rows are
  numbered, and neither outcome is one the user should discover from a receipt.

### 3.5 Named things, and the gloss

Each declaration carries three fields: the name **as the facts spell it**, a kind, and a one-line gloss.

The gloss is not a description and must not be built like one. The write contract, as `kscope schema
remember` prints it, says it is required and that it is not documentation — it is what the matcher probes
with, and a bare name matches on its characters alone. That makes it the field that decides whether this
memory's name joins an existing thing in the graph or starts a second copy of it.

So:

- It is labelled **"What this is"**, it is **not last** in the row, and it is **not** styled as optional.
- The row is **invalid while the gloss is empty**, with the same treatment as a missing title. The door
  requires it; the form must not be gentler than the door.
- Typing a name that already exists in this vault **pre-fills the most common gloss already in use for it**,
  with a note of how many other memories use that gloss. Matching an existing gloss is how a declaration
  binds to the existing thing rather than minting a new one, and the post-save receipt (§3.8) reports
  whether it did.
- Where one name is already glossed two materially different ways in this vault, the editor says so and
  links to that name's page. That is the only conflation signal available and it costs nothing to show at
  the moment of authoring, which is the only moment it can be acted on cheaply.

**One standing declaration is supplied by the contract itself.** The write prepends a declaration for one
surface unless the payload declares it. The editor reads that surface from the runtime vocabulary — it is
never transcribed — and renders it as a pre-declared, non-removable chip, so the editor cannot flag the
vault's most common subject as undeclared and offer to "fix" something already correct.

### 3.6 Vocabularies at runtime, and what happens when the vault disagrees with the schema

Every closed-value control and every suggestion list is generated at launch from what the binary prints:
the write contract for field vocabularies, the ontology read for memory types. **Nothing is compiled in.** A
value transcribed into a dropdown drifts from the engine without anyone noticing, and the records written
through it still look like data.

If a vocabulary cannot be loaded, **the editor does not open**. Falling back to a built-in list is the exact
failure the rule exists to prevent, and it fails silently.

**The vault routinely holds values the schema does not list.** Open registries — relations, entity kinds,
memory types — accumulate values that were coined by writers, and the schema names only what it knows about.
This is the common case, not an anomaly, and the editor's behaviour is fixed:

| situation | behaviour |
| --- | --- |
| an existing value is not in the schema's list | it renders **as itself**, selected, with a quiet "used in this vault" marker. It is never rewritten, never blanked, never silently mapped to a near neighbour. |
| the user wants a value not in either list | free text is permitted where the field is an open registry, and refused where it is closed |
| a **closed** field holds a value the schema does not list | keep the value, mark it unrecognised, allow the save, and surface it in the compatibility banner. The schema is the newer artefact; the record is the truth. |
| the vocabulary parse degrades | closed controls become free text with whatever could still be extracted, marked unverified, under a persistent banner. Reads stay fully functional. |

**Relations have a reserved set.** A small set of relation names is emitted by the engine itself and refused
from a writer, and one of them is the single most natural thing to type when unifying two spellings. Typing
it does not produce a clean refusal — the memory commits and its graph entry fails, reported under its own
error code, and no published operation repairs it. So the relation control **excludes the reserved set and
refuses it on submit**, and for the ones that mean *these two names are the same thing* it redirects to the
rename flow (PRD 0006). The reserved set is read at runtime and unioned with a checked-in denial list whose
header states the reason: a stale **denial** list fails safe by refusing something newly permitted, where a
stale **allow** list fails open. A test asserts the runtime set is a superset of the checked-in one, so
drift is detected rather than assumed away.

**Memory types are append-only in effect.** The type control offers the types already present first, and
states plainly that coining a new one adds it to this vault and no operation takes it back. Reclassifying a memory is not
cosmetic; it moves which memories it will ever be compared against.

### 3.7 The entity-declaration switch, and the guard on it

Measured, and it is a switch rather than a gradient:

- **A memory declaring zero named things**: nothing is checked, every fact commits, and every name a fact
  mentions is matched loosely.
- **A memory declaring one or more**: every name any fact mentions must be declared, or **that fact is
  dropped** while the rest of the write commits.

So the most dangerous single interaction in the product is a user opening a memory that declares nothing,
helpfully adding one named thing, and saving — which destroys every fact naming anything else.

**Adding the first declaration is a modal decision, not a click.** The panel states what changes, lists
every name the memory's facts mention, and offers **"Declare all N and continue"**, which pre-fills a row
per name with the name filled and the gloss empty and required. That turns a cliff into a short chore.
**Removing the last declaration** gets the inverse notice: nothing will be refused, and every name will
match less precisely.

**The client-side precondition — that every name a fact mentions is declared — runs only when the memory
declares at least one named thing.** Running it unconditionally would block every legitimate memory that
declares none, which is a large share of what agents write. This gating is the difference between a guard
and an outage.

There is **no bulk "declare all undeclared endpoints"** action, in this screen or anywhere else. Run across
memories, it would push memories that declare nothing across the switch and start dropping their facts.

### 3.8 The body's leading heading

The write requires the body to begin with a Markdown H1. **The editor composes the body, so it guarantees
the heading, and the human never encounters the rule.**

- On create, the note is seeded with the heading followed by a blank line.
- On save, if the body does not already begin with a heading, the editor prepends one built from the
  required title field. Nothing is scraped and nothing is invented — the title is a declared field already.
- If the body already begins with a heading, **nothing is prepended**. No double headings.
- **The heading and the title are not kept in sync.** In a meaningful minority of real memories the heading
  is authored prose that deliberately differs from the title. Editing the title seeds a new heading; it
  never rewrites an existing one. "They differ" is a normal state and gets no warning.

This is a requirement on the editor, not a request to change the engine. The rule costs nothing to satisfy
from a form that composes the body, and the binary does not change for this product.

### 3.9 Outcomes — three success-ish values, and a receipt

A save's result is **not** binary. The client branches on the exit code first (a resolved call writes to
stderr even on success, so branching on stderr is wrong), and then on the response's `canonical_effect`
with an exhaustive switch:

| outcome | what it means | what the user sees |
| --- | --- | --- |
| committed | it happened | the receipt below, and the editor closes |
| no-write | it did not happen, and that was correct — an equivalent memory already exists | *"No change — a memory with this content already exists."* Never "Saved". |
| the fold-failure code | it half happened and no published operation repairs it | a distinct error naming the one recovery: remove and rewrite, offered as a single action |
| anything else | a value this build does not know | a **loud error**, never rendered as success |

Every successful save renders a small receipt built from the response's own counts:

```
 Saved ver_… · 2 named things created, 3 matched to existing · 5 facts stored
```

The created-versus-matched split is the instrument that makes a graph regression visible on the first save
rather than months later on a graph screen. Editing a memory whose named things already exist elsewhere
should match rather than create; a build where that inverts is broken, and the receipt is where it shows.

### 3.10 Partial success — the outcome the product would otherwise get wrong

When some facts name something the memory does not declare, **the write commits and those facts do not**.
The response carries a list of what it refused; the key is absent entirely when nothing was refused, so
its absence is never a failure signal and its presence is never an error.

The banner says neither "Saved" nor "Save failed", because both are false. It stays on the editor:

```
┌ Saved — but 2 of 5 facts were not stored ─────────────────────────────────┐
│                                                                           │
│ The note, the title and 3 facts were saved as ver_… .                     │
│ These 2 facts were dropped because they name something this memory        │
│ does not declare:                                                         │
│                                                                           │
│   <subject> ── <relation> ──▸ <object>                                    │
│     not declared: <name>                 [ Declare it and re-save ]       │
│                                                                           │
│   <subject> ── <relation> ──▸ <object>                                    │
│     not declared: <name>                 [ Declare it and re-save ]       │
│                                                                           │
│        [ Declare all and re-save ]   [ Leave them out ]                   │
└───────────────────────────────────────────────────────────────────────────┘
```

Three implementation rules, and each has a failure behind it:

1. **Read the refusal list on every write** — creates included, and every item of a batch.
2. **Match by surface string, never by the index.** Each refusal carries the names it could not resolve;
   find the rows whose subject or object is one of them. The index in the refusal does not correspond to the
   position in the payload that was sent, so keying on it mis-highlights confidently.
3. **The re-save is a fresh update against the version the partial write just returned.** The first save
   committed, so the version has already moved; re-sending the old one produces a stale-version refusal for
   a conflict that does not exist.

And one post-condition, independent of all of the above so it holds even if the refusal list is ever
absent: **assert the count of stored claims the response reports equals the number of facts submitted.** A
shortfall is a hard error naming both numbers, followed by an immediate re-read of the record so the user
sees what actually landed. A guard that can only fire when a particular key is present is a guard that fails
open.

### 3.11 Conflicts — the user never loses typing

Writes carry the version they expect to replace. When an agent wrote while the tab was open, the refusal is
exact and names the version that is now current, and it says in its own words that it is correctable rather
than an outage.

```
┌ Someone else changed this memory while you were editing ──────────────────┐
│ You loaded ver_… .  The vault is now on ver_… .                           │
│ Your edits are safe and still on screen.                                  │
│                                                                           │
│      Their version            │        Yours                              │
│   Title  …                    │  …                                        │
│   Facts  5  (+1)              │  4                                        │
│   Note   …                    │  …                                        │
│                                                                           │
│   [ Keep mine, overwrite theirs ]   [ Take theirs, discard mine ]         │
│   [ Merge field by field… ]         [ Keep editing, decide later ]        │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Keep mine** re-sends the identical payload against the current version, after a snapshot. It overwrites
  their change and the button says so.
- **Take theirs** is the only path that discards the buffer, and it is the only one the user chose.
- **Merge field by field** is a three-pane picker per field, with facts and named things merged as sets
  keyed on the triple and on the name.
- **Keep editing** dismisses the dialog and leaves an amber version badge in the header. Saving re-attempts
  and re-shows this dialog.

The current version is recovered with a narrow parse of the refusal text. **If the parse fails, fall back to
re-reading the memory for its current version — never to discarding the buffer.** Ids render in a monospace
face everywhere they appear, because this dialog is where a person compares two of them character by
character.

The open editor is exempt from every refresh mechanism in the app. It never auto-reloads. Reconciliation
happens here, at save time, where the user's typing is protected.

### 3.12 Every other refusal, and what the human sees instead

Each message is inline, beside the control that caused it. Where the door's own text names a repair, that
text is shown rather than paraphrased.

| what the user did | the door's response | what the human sees |
| --- | --- | --- |
| body absent, or missing its leading heading | refusal naming the heading rule and the size bound | **unreachable** — §3.8 guarantees the heading |
| body over the request byte limit | the same refusal | a live byte counter, amber approaching the limit read from the published limits, Save blocked with *"this note is too long to save — split it into two memories"* |
| no facts | refusal requiring at least one fact | Save disabled; the fact panel focused with *"A memory needs at least one fact. What does this say about what?"* |
| no title | refusal requiring a title | inline required-field error on the title input |
| over the facts / evidence / contradictions caps | refusal naming all three caps | live counter; Add disabled at the cap; *"split this into two memories"* offered |
| over the named-things / corrections / proposals caps | refusal naming all three caps | the same treatment |
| more new names or relations than one write may create | **not a refusal** — the response reports it as over budget | the second counter turns amber before the budget, with a line naming how many new things one save creates |
| a malformed type name | refusal naming the naming rule | validated as typed; existing types offered first, with *"types persist — reuse one rather than coining a near-synonym"* |
| **every** fact names something undeclared | whole call refused, and the refusal names the surfaces | the only whole-memory refusal in this class: each named surface becomes a one-click declare row |
| **some** facts name something undeclared | **not a refusal** — a partial success | §3.10 |
| two unnumbered facts state the same triple | silently collapsed | flagged client-side before the save, on both rows |
| two numbered facts state the same triple | refusal naming both | inline on both rows |
| a justification pointing at a fact number this memory does not declare | refusal naming the number | should be unreachable — the picker only offers numbers that exist; if it fires, inline on the row |
| a reserved relation name | commits, and its graph entry fails under its own error code | the control excludes them; the redirect in §3.6; if it ever fires, remove-and-rewrite as one action |
| a stale expected version | refusal naming the current version | §3.11 |
| a field the runtime schema does not name | the whole call fails to parse | a build-time property, not a runtime message: the form is generated from the runtime schema and the payload is a projection, not a spread |
| the licence gate is shut | exit code 4, empty stdout, a trailer on stderr | the app's full-stop screen, not an editor error — the editor is never reached |

### 3.13 Creating a memory by hand

**The same form, with an empty starting state.** There is no second screen and no wizard.

- Title, type and scope start empty; the note is seeded with the heading; one empty fact row is present and
  focused; the named-things panel starts in the zero-declaration state and shows what that means.
- Save is disabled until a title, a type and at least one complete fact exist — the three conditions the
  door refuses on, checked before the call rather than reported after it.
- Because the memory declares nothing at the start, the §3.7 modal fires on the first declaration exactly as
  it does on an edit. A hand-written memory is not a special case; it is a memory that begins on the loose
  side of the switch.
- A create carries no expected version, so it has no conflict path — but it does have a **no-write** path
  when an equivalent memory already exists, and that is reported as such, with a link to the memory that
  already says it. This is the single most common surprise in hand-creation and it is not an error.

---

## 4. Requirements

**R1. The editor loads through the door that returns entity declarations, and a test proves the
declarations survive an edit that did not touch them.** The editor obtains its record from
`memory_lifecycle {mode:"lineage", memory_id}`, on every open, never from the display door and never from
the listing cache. A regression test edits a memory changing only its body, saves, re-reads through the same
door, and asserts the **set** of declared names is byte-identical before and after, that the response
carried no refusal list, and that the stored claim count equals the fact count submitted. **The test is
itself verified: it is run once against a build deliberately wired to the display door and must fail.** A
test for this that has never been red is not evidence.

**R2. The payload is a projection onto the runtime schema's field list, not a spread of the loaded record.**
Fields the editor does not expose are carried through unchanged when the loaded record supplies them and
omitted when it does not. A test asserts a prose-only save's delta is deep-equal to the loaded delta except
for the body.

**R3. Facts are on screen beside the prose whenever the prose is editable.** No route, viewport or state
exists where the note is editable and the fact list is neither visible nor one sticky control away. On
narrow viewports the columns stack facts-first.

**R4. Divergence is hinted, never blocked, and never guessed.** When the body has changed in this session
and no fact has, a non-blocking line says so. The editor performs no extraction of facts from prose, in any
form, under any flag.

**R5. Facts are editable as triples with their qualifiers, against two independent counters** — the caps the
refusals name, and the lower per-write budget for new names and relations. The two are displayed separately
and never combined.

**R6. Every vocabulary is read at runtime; none is compiled in.** If a vocabulary cannot be loaded, the
editor does not open. The single allowlisted exception is a checked-in denial list of the reserved relation
names, unioned with the runtime set, carrying a header that states why a stale denial fails safe; a test
asserts the runtime set is a superset of it.

**R7. A value the schema does not list is preserved, marked, and never rewritten.** An existing value not in
the schema's list renders as itself and stays selected; free text is accepted where the registry is open and
refused where it is closed; a closed field holding an unlisted value keeps the value, is marked
unrecognised, and still saves. No control ever maps a value to a near neighbour.

**R8. The relation control excludes the reserved set and refuses it on submit**, offers the vault's existing
relations with usage counts most-used first, and redirects the "these two names are the same" case to the
rename flow rather than accepting a reserved name.

**R9. The gloss is required and treated as load-bearing.** The entity row is invalid while it is empty; the
field is labelled "What this is", is not last in the row, and is not styled as optional; declaring a name
already present in the vault pre-fills the most common gloss in use for it and says how widely it is used.

**R10. Adding the first declaration to a memory that declares none is a modal decision** that names the
consequence and offers to declare every name the memory's facts mention. Removing the last declaration
carries the inverse notice. No bulk "declare all undeclared endpoints" action exists anywhere in the
product.

**R11. The undeclared-endpoint precondition runs only when the memory declares at least one named thing.** A
test saves a memory that declares none and whose facts name several undeclared things, and asserts the save
is not blocked and the record is unchanged in shape.

**R12. The editor composes the body and guarantees its leading heading.** Tests: a body without a heading
gets one built from the title prepended; a body that already has one gets nothing prepended; the composed
body never exceeds the request byte limit read from the published limits. Editing the title never rewrites
an existing heading, and a title that differs from the heading raises no warning.

**R13. The save branches exhaustively on the outcome value**, with distinct copy for committed, no-write and
the fold-failure code, and a loud error — never "Saved" — on any value this build does not recognise. The
branch is exhaustive at the type level, and a test asserts re-sending identical content renders the
no-write copy.

**R14. A partially successful write is never reported as a failure or as a plain success.** The refusal list
is read on every write. The banner names how many facts landed and how many did not, shows each dropped
fact with the name that caused it, and offers to declare and resend **only** the dropped ones — against the
version the partial write returned, not the version the editor loaded.

**R15. Dropped facts are matched to editor rows by surface string, never by the refusal's index.** A test
constructs a payload whose submission order and the refusal's indices demonstrably differ, and asserts the
correct rows are highlighted.

**R16. Every save asserts the stored claim count equals the submitted fact count**, independently of whether
the refusal list is present. A shortfall is a hard error naming both counts, followed by an immediate
re-read.

**R17. Nothing the user typed is ever discarded except by the user.** On a stale-version refusal the buffer
survives; the current version is parsed from the refusal and, if the parse fails, re-read from the door;
"Take theirs" is the only path that discards, and it is a button the user pressed. A test performs an
out-of-band edit mid-session and asserts every field of the buffer is intact after the dialog appears.

**R18. Every refusal in §3.12 has an inline message beside the control that caused it**, and where the
door's own text names a repair, that text is shown rather than paraphrased. A test drives each reachable
refusal and asserts a message is rendered on the responsible control.

**R19. Create is the same form in an empty state.** Save is disabled until a title, a type and one complete
fact exist; the heading is seeded; the first declaration triggers the R10 modal; a no-write result is
reported as such with a link to the memory that already says it.

**R20. A snapshot is taken before every write this screen performs**, including the conflict dialog's
"Keep mine" and the partial-success resend, and the editor surfaces where that snapshot went.

**R21. The editor never auto-reloads and never issues a ranked query.** No timer, no watcher, no prefetch,
no suggestion lookup reaches the ranked door from this screen; the name suggestion lists are computed from
the cached listing. A test drives a full create-edit-save session and asserts the vault's exposure row count
is unchanged.

**R22. Everything the editor renders is treated as hostile input.** Bodies, titles, names, glosses, relation
names and evidence references are rendered with raw HTML disabled at the tokenizer **and** sanitised after,
both, not either. A fixture memory carrying script-shaped content in every one of those fields is rendered
through the whole editor in CI with an assertion that nothing executes.

---

## 5. What is not delivered, in order of what it costs

**No undo of a save, beyond the snapshot.** No published operation returns a prior version of a memory, so
there is nothing to offer a "revert this edit" button. Cost: the highest of anything here. The snapshot
spine is a whole-vault export the user has to consciously restore, which is a far heavier instrument than
the mistake usually deserves. Mitigation is honesty — the snapshot is visible, it is named for the action it
preceded, and the editor says the snapshot is the undo.

**No version history and no diff against what was there before.** Prior versions exist but no operation
returns them. Cost: the conflict dialog can show *their version* against *yours* only because the refusal
hands us both; it cannot show what the memory looked like an hour ago. A history tab that could only ever
show the current row is worse than no tab.

**No relation authoring.** Proposing a new relation with its meaning, cardinality and inverse is a genuine
ontology task, and a wrong inverse makes every claim readable backwards under a verb the vault never agreed
to. Cost: a user who needs a relation that does not exist coins a bare name instead, which is exactly the
fragmentation PRD 0006 then has to clean up. Deferred, behind its own flow.

**No qualifier-key authoring.** The open key registry for fact qualifiers is not exposed as an editable
control in this version; existing keys are preserved and rendered read-only. Cost: a small class of edits
must go through the CLI.

**No duplicate warning at authoring time.** The best duplicate signal available is inseparable from writing
a ranked query, which this screen may not do. Cost: a user can hand-create something the vault already has —
mitigated only by the no-write result telling them so afterwards.

**No merge, rename or split from this screen.** They are multi-memory operations with no transaction
underneath, and they belong in PRD 0006 where the serial-application and stop-on-first-refusal rules live.
This screen is the thing they all end in.

**No "who wrote this".** No writer is recorded on a memory by any door. Rather than a column full of
"unknown" that invites someone to fill it with a guess, the editor says nothing about authorship at all.

## 6. What would falsify this

The claim in §1 is that a person can fix a memory without knowing the write contract, and that a save is
never a net loss they cannot see. Four observations would show it wrong:

1. **A scripted session on a synthetic vault, driven only through the UI, ends with fewer declared names or
   fewer stored facts than it began with, without the user having removed one.** This is the whole claim.
   It is checked in CI on every PR, not asserted in a review.
2. **The R1 test cannot be made to fail.** If a build wired to the display door still passes it, the test is
   measuring something other than what it claims and the seam is unguarded regardless of the green tick.
3. **A user who has read no documentation cannot complete an edit that adds one fact naming an existing
   thing.** If the entity-declaration switch, the gloss requirement and the two counters together make that
   a task requiring the contract, then the form has merely relocated the contract rather than absorbed it,
   and the answer is fewer required fields on the common path — not more explanation.
4. **The facts-beside-the-prose layout does not reduce divergence.** If memories edited through this screen
   drift between body and facts at the same rate as memories edited any other way, then adjacency was the
   wrong bet and the hint in §3.3 has to become a block — which is a real cost, and would need measuring
   before it is paid.
