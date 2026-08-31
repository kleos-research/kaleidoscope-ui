# PRD 0005 — The graph view is a fragmentation report that happens to be drawn

> **Status (2026-08-31).** Not started. There is no graph view today, and no way for a person to
> see the shape of what their agents have written. This document specifies one: a client-side
> reconstruction of the memory graph, drawn with Cytoscape.js, whose default view is a deliberate
> restriction rather than "everything with a zoom control". It asks for a canvas whose primary job
> is to show *disconnection and near-duplication as work to be done*, and which refuses to draw
> rather than draw something illegible. Out of scope: any overlay claiming to explain why something
> was retrieved, any edge the export does not literally contain, any merge executed by the canvas
> itself, and any embedding/semantic-space projection.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** the export-cache PRD (this view issues no door call of its own; it is arithmetic over
the cached export) · the curation-backlog PRD (every finding this canvas surfaces is a row in that
rail) · the editor PRD (every node on the canvas must terminate in a verb)
**Relates to:** the packaging PRD (the licence gate that keeps the two traps in §3.7 out of the tree)
**Supersedes nothing.**

---

## 1. The product claim

**A graph view of a memory vault is not decoration and it is not navigation. It is the only surface
in the product that can show a person that two spellings of one thing became two things, and that
half of what they have written is connected to nothing.**

Everything else in this app is a list. A list is the right encoding for "what does it know?", for
"what landed since Tuesday?", and for "fix this one". A list is a bad encoding for exactly two
questions, and they are the two questions that decide whether a vault is accumulating knowledge or
accumulating sediment:

| question | why a list cannot answer it | what a drawing does |
| --- | --- | --- |
| *Did this thing get written down twice under two names?* | The two rows are alphabetically adjacent at best, and usually not adjacent at all — they are in different memories, with different facts hanging off each. | Two nodes with near-identical labels, each with its own small constellation, side by side. |
| *Is any of this joined up?* | A list of 300 rows looks identical whether those rows share 200 references or zero. | The joined half is a drawing; the unjoined half is a number you can click. |

So the claim is a design constraint, not a feature list: **the canvas earns its place only if the
fragmentation is what you see first.** A graph view that renders a pleasant even mesh, in a vault
that is not an even mesh, is worse than no graph view — it has told the user something false about
their data and it has hidden the entire backlog behind a prettier layout.

## 2. What it costs to get this wrong

There are three concrete ways to get it wrong, and two of them are the *default* behaviour of every
graph library and every graph tutorial.

**Failure 1 — the confetti field.** Take the whole vault, throw every fact endpoint at a
force-directed layout, and press go. What comes back is not a hairball. It is a field of hundreds of
disconnected two-node dyads drifting apart, with one modest clump somewhere in the middle. It renders
at a perfectly good framerate. It teaches nothing. The user closes the tab and correctly concludes
the graph view is a toy. This is not a hypothetical: it is the shape a real working vault has, and it
is what a naive implementation ships.

**Failure 2 — the fix that deletes the product.** The standard remedy for failure 1, recommended by
every large-graph guide, is to suppress degree-1 nodes: they are the great majority of the vertices
and they contribute no topology, so drop them and the picture cleans up beautifully. On a real vault
that instruction deletes roughly three quarters of the nodes, and with them every isolated fact, every
once-used relationship name, and every undeclared endpoint — **which is to say, the entire curation
backlog, which is the most valuable thing the screen could have shown.** The picture gets prettier as
it gets emptier, and nothing on screen says so. This one is worse than failure 1 because it looks
like success.

**Failure 3 — the drawing that lies about its own authority.** The client reconstructs this graph
itself, by exact match on the surface string, because there is no door that returns the engine's own
nodes and edges. Its picture and the engine's do not agree, and neither is a subset of the other. A
UI that titles this screen "the graph" invites a user to look at two adjacent nodes, conclude the
engine sees them as two things, and go and merge them — which the UI must execute as a rewrite across
every memory that names them, with no undo through any door. **The cost of a drawn edge that does not
exist is an irreversible multi-memory rewrite. The cost of a missing edge is a click.** That asymmetry
is total, and it decides several requirements below.

## 3. The mechanism, as designed

### 3.1 One model, three lenses

Build exactly **one** client-side graph from the cached export. Every view is a filter over it, so a
lens switch never rebuilds and selection survives it.

| element | one per | carries |
| --- | --- | --- |
| **memory node** | exported memory | `memory_id`, `title`, `memory_type`, `scope`, `sequence`, `version_id` |
| **entity node** | distinct surface string appearing as a fact `subject` or `object` | the surface, its declared kinds (a multiset — see §3.7), its glosses in use |
| **incidence edge** | fact endpoint | memory → surface, with the predicate, the direction, and the fact's qualifier fields |
| **claim edge** | fact | subject → object, a derived overlay on the same model |
| **contradiction edge** | entry in a memory's `contradicts` field | memory → memory; the only cross-memory relation any read door hands a client directly |

Three lenses project it:

- **C — Connections (the default).** Memory nodes, plus only those entity surfaces touched by **two or
  more memories**, plus the incidences between them.
- **M — Memories.** Memory nodes only, joined where they share a surface.
- **E — Claims.** Entity nodes and subject→object claim edges. The "true" knowledge graph.

**C is the default, and here is the defence.**

*Why not E, the obvious choice.* Two reasons, and the second is fatal. First, on a real vault E is
the confetti field of §2 — most surfaces appear in exactly one fact, so most of E is disconnected
dyads. Second and decisively, **E discards the memory.** Every operation this UI can perform is
addressed by `memory_id`. A view with no memory nodes in it is a view with no verbs: you can look at
a fact and you cannot click it into anything that edits it.

*Why not M.* M is legible — but it discards the reason for every edge it draws. Two memories are
joined *because they share a surface*, and that surface is the thing a user would act on. Drawing the
edge without the entity in the middle means the user cannot see whether the join is meaningful or an
artefact of a name so generic that everything touches it. M is in budget and mute.

*Why C.* C is the bipartite model restricted to its connectors. A surface touched by exactly one
memory carries no connective information at the memory level — it is a *property of that memory*, and
it belongs on that memory's node as a chip, not in the layout as a vertex. Folding those in takes the
drawing down by roughly a factor of six, loses nothing (the chips are on the node and the surfaces are
still filterable), and leaves behind exactly the structure the user is trying to see: which memories
are joined, and by what.

**This is relocation, not suppression, and the distinction is the whole design.** The memories that
fall out of C entirely — the ones connected to nothing — are not hidden. They become first-class rows
in the curation rail, with a counter on the canvas header that is a filter. Suppression hides them.
Relocation moves them to the surface where they can be acted on, which is a list.

### 3.2 Every distinct surface gets a node

A node exists for every distinct surface that appears as a fact endpoint. **Whether that surface was
also declared as a named thing is an attribute of the node, never an admission test.**

Building the graph from declared entities only is the tempting filter, and it is a defect: on a vault
where most fact endpoints are undeclared it draws almost nothing and reports success. Two independent
implementations have reached for it. Do not build it.

**The undeclared marker inverts on the data.** An undeclared endpoint renders with a dashed outline
and a badge whose action opens the editor to declare it. That is a useful *exception* marker when
undeclared endpoints are rare. When they are the overwhelming majority it marks nearly every node and
conveys nothing, and the marker must invert to flag the *declared* ones instead. Compute the rate at
load and pick the polarity from the data. Never hardcode which one is the exception.

**And the finding is gated on the memory declaring something.** A memory that declares no named things
at all is in a different regime from one that declares three and omits a fourth: in the first case
nothing was omitted. A memory declaring zero entities therefore produces **no** undeclared-endpoint
findings — its endpoints render neutrally, and the rail says "declares no named things" rather than
raising one finding per endpoint. Without this gate every legitimate memory that declares nothing
becomes a wall of false defects.

Surfaces that were *declared* but appear in no fact have no edge and no position; they are not drawn.
They appear in the rail as "declared, never asserted", which is itself a finding — the declaration is
doing nothing.

### 3.3 The default view, the empty states, and the too-big state

**Default:** lens C, whole vault, no seed, force layout, labels on, curation rail docked to the right
carrying three counters — islands, memories connected to nothing, relationship names used exactly once
— each of which is a filter.

A seeded ego network is the standard recommendation for a cold-start graph view and it is wrong here:
it makes the user choose a starting point before they know what is in the vault. That is the wrong
first question. The whole-vault C view opens with headroom on a real vault today, so we can afford to
answer "what shape is this?" before "where do I start?".

**The fallback ladder is automatic and named.** If C exceeds the cap, fall back to the largest
connected component. If that also exceeds it, fall back to the ego network of the highest-degree node
at depth 2. Three rules, evaluated in order, each drawing a banner that says which one fired and why.

**Four empty states, four different sentences**, because only one of them is a defect:

| condition | what the user sees |
| --- | --- |
| no memories | "This vault is empty. Memories arrive when an agent writes one." No canvas. |
| memories, no facts | "N memories, no facts. Facts are what make the graph." Link to the list. |
| facts, but every surface touched by one memory | **Do not draw an empty canvas.** "Nothing here connects yet: every name is mentioned by exactly one memory." Open the rail full-width instead. This is a real, normal state for a young vault, and it is the state where the rail matters most. |
| the engine reports its embedding model is not bundled | An engine warning, not a graph state — but it belongs on the same strip, because a build without the model is a different system. |

**The too-big state is a control panel, not an error, and never a silent truncation.**

```
 This view would draw 4,180 elements. That is past what a person can read.
 Pick a reduction:

   [ One project                     → 612 elements ]
   [ One memory type                 → 431 elements ]
   [ The last 200 memories written   → 508 elements ]
   [ Names used by 3+ memories       → 274 elements ]
   [ Around one thing, 2 steps out   → pick a node… ]
```

Each button carries **its own resulting element count, computed on the client before anything is
drawn**. The user picks the reduction; the UI never picks one silently. A canvas that quietly dropped
60% of itself is a refusal spelled as an answer — and the user cannot tell a sparse vault from a
truncated view.

### 3.4 Fragmentation is the feature

Every structural finding the canvas can compute is also a row in the curation rail, and every row
carries the *nearest existing alternative with its usage count*, because reuse is the only thing that
converges a fragmented vault:

| finding | what the card shows | the action |
| --- | --- | --- |
| **Near-miss surface** | the two spellings side by side, with the fact count and source memory behind each | "Unify spelling" → lists every affected memory → N × update |
| **Once-used relationship name** | the fact as one line, with the nearest existing predicates by edit distance **and their usage counts** | "Reuse `<existing>` (N uses)" → update, one memory |
| **Undeclared endpoint** | the surface, the memory asserting it, how many other memories mention that string | "Declare it" → update, appending a declaration |
| **Declared, never asserted** | the declaration and its memory | "Remove it" or "Add a fact" |
| **Kind conflict** | the same surface declared under two or more kinds, with each memory | "Pick one kind" → N × update |
| **Lone island** | the single fact drawn inline as text, with its memory's title | "Find related" → client-side near-miss and shared-token search over the cache |

Two rules bind this section:

**The rail is where the value is, and it needs no graph library.** Connected components, neighbourhoods
and shortest paths are all core library calls, but the rail is a virtualized list over the components —
it can and should ship before the canvas does. A list is the correct encoding for several hundred
weakly-ordered items; a node-link diagram is not.

**Every "merge" or "unify" the UI offers, the UI implements itself**, as an update to the survivor
followed by a delete of the loser, or as N updates rewriting a surface across every memory that names
it. Present it as one action; execute it as N; snapshot first; apply serially; stop on the first
refusal; report exactly which ids landed. **No button in this product may be wired to an operation
that reports success without changing the memory** — on a graph screen that failure is uniquely bad,
because the user watches the drawing not change and concludes the drawing is broken.

### 3.5 The reconstruction caveat

**There is no door that returns the engine's own graph.** The client rebuilds it from the export by
grouping facts on the surface string. That is sound in principle — entity identity in this system is
exact surface match, a client-visible property — but it is **not faithful**, and the gap is
measurable, because `doctor {mode:"inspect"}` reports its own counts about its own graph and they do
not equal ours.

Four ways the drawing is wrong, and which direction each runs:

1. **Deferred-identity clusters.** The engine may hold two surfaces as a possible single identity. The
   client sees two distinct strings and draws two nodes. → **we over-fragment.**
2. **A class of edge the export does not carry.** `doctor` reports a soft-edge count and a maximum soft
   degree above anything the drawing can reach. No door emits those edges. → **we under-connect.**
3. **Supersession.** The client draws every fact of every live memory with equal weight; it cannot know
   which claim currently serves. A superseded claim and its successor render as two identical edges. →
   **we over-draw.**
4. **Removed memories.** They are excluded from the export while remaining reachable by id. Whether
   their nodes persist in the engine's graph is not answerable through any door. → **unknown, and
   declared as unknown.**

**Over-fragmenting is the safe direction and we prefer it deliberately** (§2, failure 3). Therefore:
**never draw an edge the export does not literally contain.** No inferred edges, no similarity edges,
no silent merging of keys that normalise to the same string. The near-miss clusterer of §3.4 runs as a
*candidate generator into the rail*, never as a transform on the model.

Three mechanisms say this on screen, and none of them is a tooltip nobody reads:

1. **The screen is titled "Reconstructed graph."** Never "the graph". The lens switch says
   "reconstructed from your exported memories".
2. **A permanent fidelity strip along the bottom**, not a dismissible notice:
   ```
   Drawn from your export: 1,000 names, 750 claims, matched by exact spelling.
   kscope's own graph reports different counts and holds a kind of link this view
   cannot show. Fold: 0 missing · N events not applicable.         [ What is this? ]
   ```
   *(counts above are the §3.6 illustration; the strip renders whatever the vault and the engine
   actually report.)*
   Two counts side by side, permanently. The discrepancy *is* the message; it needs no warning icon.
3. **Render the gap classification, never a bare status word and never a bare "behind" number.** A
   healthy vault reports a non-`ready` status with nothing missing, and more than one field in the
   response is called "behind" with values that differ by hundreds. A UI that paints a status word red
   cries wolf on every healthy vault in existence.

### 3.6 Scale

Two regimes exist and any design must say which one it is for and what it does when it meets the other.
A working vault has a small maximum degree and is dominated by fragmentation. **A large vault has a
hub: one name — usually the one that means "the owner of this vault" — connected to a large fraction of
everything, with a degree in the tens or hundreds of thousands.** Both are real. The v1 canvas is built
for the first and must not black out on the second.

**The budget is legibility, not framerate.** Cytoscape's own published benchmark puts 1,200 nodes /
16,000 edges at 20 fps on canvas and 100+ on WebGL, and 3,200 / 68,000 at 3 and 10 fps. Our ceiling is
roughly six times below that, because the constraint is a person, not a GPU:

```
DRAW_TARGET =   800 elements   // nodes + edges. Comfortable, labelled, force-laid-out.
DRAW_CAP    = 2,000 elements   // hard. Above this the canvas refuses and offers reductions (§3.3).
WEBGL_FLOOR = 1,200 elements   // above this, switch renderer — and lose edge labels and dashes (§3.7).
```

**Synthetic illustration.** The following vault is constructed for this document to make the arithmetic
checkable. It is not a measurement of anyone's vault; it is a shape chosen to resemble the one a real
working vault has.

> 300 memories · 750 facts · 1,000 distinct endpoint surfaces · 250 distinct relationship names, 200 of
> them used exactly once · 730 surfaces appear in exactly one fact · 910 surfaces are touched by exactly
> one memory, leaving 90 connectors · 280 components, the largest 130 nodes, 165 of them a single fact ·
> at the memory level, 150 of 300 memories have at least one neighbour and 150 have none.

| lens | elements | per memory | crosses DRAW_CAP at |
| --- | --- | --- | --- |
| **C — Connections (default)** | 150 + 90 + 230 = **470** | 1.57 | ≈ 1,270 memories |
| M — Memories | 300 + 235 = **535** | 1.78 | ≈ 1,120 memories |
| E — Claims | 1,000 + 750 = **1,750** | 5.83 | ≈ 343 memories |
| full bipartite | 1,300 + 1,500 = **2,800** | 9.33 | ≈ 214 — **already crossed** |

Read the last row: **on a vault of this shape, "just visualize the whole graph" is already over budget
at a few hundred memories**, and the full bipartite renders at a fine framerate while teaching nothing.
That is why the default is a restriction and not a zoom control.

**The hub treatment, and when it engages.** One primitive covers both regimes: the compound meta-node.

- **Trigger.** A node becomes collapsible when its degree exceeds `max(20, p99_degree × 4)`, computed
  from the loaded graph and shown in the legend. On a working vault this **never fires, and that is
  correct** — a threshold derived from the data is visibly a computed guard, not a magic number.
- **Collapsed.** One hatched parent labelled with the surface and the hidden count. Its edges to
  already-drawn nodes stay drawn — they are the topology and they are cheap. Only edges to nodes drawn
  nowhere else are absorbed.
- **Single click** opens a **virtualized list** of that surface's claims grouped by predicate, each row
  linking to its source memory. This is the load-bearing part: a hundred thousand items is a list, not
  a picture, and the list is the honest encoding.
- **Double click / Expand** reveals only the top *k* neighbours by the current sort, with a persistent
  `showing 150 of 100,000 · sorted by degree` chip, re-checking DRAW_CAP before each addition.
- **"Absorb into context"** is the honest form of the stop-list idea: the node leaves the canvas and
  becomes a badge on each of its neighbours, converting a star into a readable forest without deleting
  information. **Per-node, user-initiated, reversible, recorded in the URL, and never keyed to a
  hardcoded string** — a literal surface in a stop list is a transcribed vocabulary, and this project
  forbids those outright.

**Regime detection is v1 and it is one pass.** Compute the maximum degree and the singleton fraction
from the cached export at load. Above threshold, the canvas **refuses and seeds an ego network on the
offending node**, naming it: *"one name here is connected to N others; showing its neighbourhood
instead."* The failure being defended against is not a slow graph. It is a black disc and a user who
concludes the product is broken.

**And the insurance clause, which is the part that makes the rest real.** None of the hub path can be
tested on a working vault, because the threshold never fires there, and a guard whose null result is
indistinguishable from success is not evidence. **Test the collapse path in CI against a synthetic
fixture carrying one node with 100,000 edges, and assert the drawn element count stays under
DRAW_CAP.** Without that test, the hub programme is four features that have never run.

Two commonly-recommended reductions do *not* apply here and should be built cheaply and kept off the
critical path: collapsing parallel edges into one counted bundle (correct at scale, changes a couple of
percent of a working vault's drawing), and merging keys that normalise to the same string (changes
nothing — and per §3.5 it may never be a model transform anyway).

### 3.7 The library: Cytoscape.js

**Cytoscape.js 3.34 (MIT), canvas renderer, with a hand-rolled React binding of roughly eighty lines.**
Four reasons, in order:

1. **Compound nodes are a first-class data-model element**, not a drawing trick. The parent has a real
   id, so selection, layout and the click-into-the-editor path all keep working through a collapse.
   Nothing else MIT-licensed ships them, and it is the one primitive that serves **islands today and
   hubs later**.
2. **Its ceiling brackets our need correctly** — comfortably above everything we should draw and
   comfortably below the whole vault, which is a feature: it stops us shipping a hairball by accident.
3. **Everything the curation rail needs is core and free:** connected components, shortest paths,
   neighbourhoods, filters, and the force / hierarchical / clustered layouts, all MIT.
4. **Editing needs a mutable, element-by-element model with stable ids.** Its collection API is that.
   A GPU vertex buffer is not.

**Do not use `react-cytoscapejs`**: last published 2022, and a class-component wrapper. Write the
binding; a well-known Apache-2.0 graph explorer built on React 19 and this same version of Cytoscape
hand-rolled its own, and is the reference to read.

**Two licence traps a future contributor will otherwise walk into.** Both are one character away from a
correct choice:

- **`@cosmograph/cosmos` is CC-BY-NC-4.0** — non-commercial, and it poisons an Apache-2.0 repository.
  The MIT-licensed engine of the same lineage is **`@cosmos.gl/graph`**, under the OpenJS Foundation.
  The names are nearly identical and the licences are not. Neither is a v1 dependency; the MIT one is
  the right tool if an embedding-space map is ever built.
- **`elkjs` is `EPL-2.0 OR GPL-3.0-or-later`**, and it arrives one layer down as the layout engine
  people reach for when a graph library ships none. It should never enter this tree.

More generally: every forkable graph *application* worth reading — the well-known Gephi, sigma and Neo4j
front-ends, and the big note-taking apps — is GPL or AGPL, and is therefore **reading material only**.
A copyleft licence on a repository that ships as a launcher for a proprietary binary is not a question
anyone wants to be arguing about later, and AGPL's network clause fires precisely at the hosted stage on
the roadmap. A `license-checker` allowlist gate in CI enforces this.

Fallback, if a whole-vault overview map ever becomes a hard requirement rather than a wish: sigma.js
plus graphology, both MIT. Note that graphology is arguably the right *model* even while rendering with
Cytoscape, since every reduction in §3.6 is a graph computation rather than a drawing one.

### 3.8 Encoding: open sets, degrading gracefully

Entity kinds and relationship names are **open registries that are observably growing**. Any encoding
with a fixed palette is a transcription that drifts silently — the same failure as a hardcoded dropdown,
which this project forbids.

> **The rule: colour never carries meaning alone, and colour never carries an open set.**

| channel | carries | why it is safe |
| --- | --- | --- |
| **shape** | node **role**: memory / entity / undeclared endpoint / collapsed parent | four values, closed *by construction*; it cannot grow |
| **label** | the kind and the predicate, as text | text degrades perfectly over an unbounded set — an unknown kind renders as itself |
| **colour** | the **top 8 kinds by count in this vault, computed at load**, plus one "other" bucket | recomputed per vault, never transcribed; kinds 9..N are grey-with-label |
| **border dash** | provenance quality: dashed = undeclared endpoint, dotted = kind conflict | redundant with the badge, so colour-blind safe |
| **edge dash + opacity** | predicate **frequency band**: solid at five or more uses, pale-dashed for a once-used name | most relationship names are used once — **the pale edges *are* the fragmentation**, visible without reading a label |
| **node size** | degree, `sqrt` scale, clamped 12–48 px | honest at small spreads and at large ones |
| **edge colour** | **never** the predicate | one neutral, one selection accent, one distinct treatment for contradictions |

`memory_type` is the one axis with few enough values to colour memory nodes by — and its values are read
at runtime from the ontology door, never written down. Even there, keep the label.

**The renderer is part of this decision, not a separate one.** Cytoscape's WebGL renderer drops dashed
edges and edge labels — which is precisely the encoding above. So: **default to the canvas renderer, and
switch to WebGL only above WEBGL_FLOOR**, where labels are already off and the dash encoding is already
illegible, with a banner saying so.

**Kind conflict is a feature, not noise.** A surface can be declared under more than one kind, so a
node's kind is a **multiset, not a function**. Render the modal kind, badge the conflict, and put the
surface in the rail. The naive `node.kind = declaration.kind` assignment silently keeps whichever
declaration was parsed last and hides every one of those findings.

### 3.9 Interactions: free from the library versus built

| interaction | free / built | note |
| --- | --- | --- |
| pan, zoom, box-select, drag | **free** | core |
| click / hover / tap events | **free** | core |
| connected components | **free** | the curation rail is a list over this, not an algorithm we write |
| shortest path between two nodes | **free** | two-click UX. **Most pairs have no path** — the empty result is the common case and must read *"no path — these are in different islands"*, which is a finding, not a failure |
| neighbourhood / ego selection | **free** | core |
| layouts (force, hierarchical, clustered) | **free** | all MIT |
| filter by kind / type / scope / date | **free-ish** | the filter call is core; **we build the chrome and the URL persistence** |
| expand / collapse | **built** (extension) | MIT, stale — budget for vendoring it |
| context menu, tooltips | **built** (extensions) | MIT, stale |
| React binding | **built**, ~80 lines | see §3.7 |
| **search-and-focus** | **built** | client-side substring over the cached export's surfaces, titles and predicates. **Never the ranked search door** — that door writes to the store it is inspecting |
| **click a node into a verb** | **built** — the whole point | entity node → its memories → memory detail → editor, loading through the door that returns entity declarations |
| **sequence-range filter** | **built** | the cheapest possible "what did the last session write" |
| **URL-encoded view state** | **built** | lens, filters, absorbed nodes and seed. A view must survive a reload and be shareable as a link |

**One interaction to refuse outright: any "why was this retrieved" or score overlay on the canvas.**
Ranked results carry no score, no rank and no channel breakdown; there is no door that reads back what
an agent was served; and the engine's own graph traversal is not what decides what is retrieved. **This
drawing explains the data, not the retrieval.** An always-zero channel bar is worse than no bar.

## 4. Requirements

**R1.** One client-side model; the three lenses are filters over it. Switching lens rebuilds nothing,
and a selected element that exists in the target lens stays selected.

**R2.** The graph view issues **no door call of its own**. Driving every interaction on this screen —
every lens, filter, expansion and path query — spawns no additional engine process and leaves the
vault's exposure-record count unchanged.

**R3.** A node exists for every distinct surface appearing as a fact endpoint. A fixture whose fact
names an undeclared surface renders that node, badged. No code path filters the graph by the declared
entity list.

**R4.** Undeclared-endpoint findings are raised **only for memories that declare at least one named
thing**. A fixture memory declaring none produces zero such findings and renders a neutral "declares no
named things" note instead.

**R5.** The polarity of the undeclared marker is computed at load. Two fixtures — one where undeclared
endpoints are rare, one where they are the large majority — produce opposite markers, and neither
polarity is hardcoded.

**R6.** No degree-1 suppression, by default or otherwise. Every surface present in the export is
reachable from this screen as a drawn node, as a chip on a memory node, or as a rail row; a coverage
test asserts the union is complete.

**R7.** The default view is lens C over the whole vault with no seed. Above the cap, the fallback ladder
runs largest-component → ego-network-of-highest-degree-node-at-depth-2, and the banner names which rule
fired.

**R8.** Four empty states, four distinct messages, driven by four fixtures. The "facts but no
connectors" fixture opens the rail full-width and draws no canvas.

**R9.** Above `DRAW_CAP` the canvas refuses and renders the reduction panel. Each reduction button
displays its own resulting element count, computed before drawing. **No code path truncates the element
set silently**; a test asserts that the drawn set is either complete for the active lens or the refusal
panel is showing.

**R10.** `DRAW_TARGET`, `DRAW_CAP` and `WEBGL_FLOOR` are named constants with a comment stating that the
budget is legibility. WebGL engages only above `WEBGL_FLOOR`, and when it does a banner names what the
renderer drops.

**R11.** Every structural finding the canvas computes is a rail row; every counter in the canvas header
is a filter; every rail row carries the nearest existing alternative **with its usage count**; every row
routes into the editor with the change pre-filled.

**R12.** Any merge, unify or rename the UI offers is implemented by the UI as update-then-delete, or as
N updates. **No button is wired to an operation that reports success without changing the memory.** The
multi-memory path snapshots first, applies serially, stops on the first refusal, and names exactly which
ids landed.

**R13.** No edge is drawn that the export does not literally contain. A fixture carrying two surfaces
that differ only by a hyphen renders **two** nodes on the canvas and **one** card in the rail.

**R14.** The screen is titled "Reconstructed graph". A build-time check fails if the bare title
"The graph" appears in user-facing strings for this screen.

**R15.** A permanent fidelity strip renders the client's own counts beside the counts the engine reports
about its own graph, names the class of link this view cannot show, and renders the fold gap
classification. **No screen renders a bare status word or a bare "behind" number.**

**R16.** Regime detection runs at load in one pass over the cached export (maximum degree and singleton
fraction). Above threshold the canvas refuses and seeds an ego network on the offending node, naming it
and its degree.

**R17.** The collapse threshold is `max(20, p99_degree × 4)`, computed from the loaded graph and shown
in the legend. **No hardcoded surface string appears in any suppression, stop-list or absorption path**,
enforced by a lint rule.

**R18.** A collapsed hub opens a virtualized claim list on single click; double click expands top-*k*
only, shows a persistent `showing k of N` chip, and re-checks `DRAW_CAP` before each addition.
"Absorb into context" is per-node, reversible, banner-announced, and recorded in the URL.

**R19.** A CI fixture containing one node with 100,000 edges drives the collapse path and asserts the
drawn element count stays under `DRAW_CAP` and the page remains interactive.

**R20.** The encoding table in §3.8 is implemented as written: shape carries role, label carries kind and
predicate as text, colour carries the top-N kinds computed at load plus an "other" bucket, edge colour is
never the predicate. A test asserts every visual distinction is recoverable without colour.

**R21.** A node's kind is a multiset. A fixture surface declared under two kinds renders the modal kind,
carries the conflict badge, and appears in the rail. No assignment overwrites a node's kind with the
last declaration parsed.

**R22.** Every node terminates in a verb: memory node → detail → editor; entity node → its memories →
detail → editor. The editor loads through the door that returns entity declarations, never through one
that omits them.

**R23.** Search-and-focus is client-side over the cached export. This screen contains **zero** callers of
the ranked search door, asserted by a lint rule and by an exposure-count test across the whole flow.

**R24.** Every string this screen renders — node labels, edge labels, tooltips and context-menu entries —
passes through the app's shared escaping path. A hostile fixture (markup and script payloads in a title,
a gloss and a fact endpoint) renders on the canvas with nothing executing and no attribute surviving.

**R25.** Lens, filters, absorbed nodes and seed are encoded in the URL; a reload restores the same view.

**R26.** No score, rank, channel breakdown or "why retrieved" affordance appears anywhere on this screen,
asserted by a build-time check over its user-facing strings.

## 5. What is not delivered, in order of what it costs

| not drawn | why | cost of leaving it | worth closing? |
| --- | --- | --- | --- |
| **The class of link the engine reports and the export does not carry** | No read door emits it. `doctor` tells us how many exist; nothing tells us where. | The single largest piece of the fidelity gap. The engine's most-connected node is meaningfully more connected than anything we can draw. | **Yes — highest value.** Blocked entirely on a graph read door. Filed as an engine ask. |
| **Deferred-identity clusters** | Same door. The client sees two strings and cannot know the engine may hold them as one. | It is also the honest source for *"these two nodes may be one thing"* — which is exactly the near-miss card done properly instead of by edit distance. | **Yes**, same door. |
| **Which claim currently serves** | Not exposed. A superseded claim and its successor draw as two identical edges. | The user cannot tell a live claim from a retired one on the canvas. | Yes, but it is an engine design question, not just a door. |
| **Retrieval provenance / why-retrieved** | No score on a result, no door that reads back what an agent was served. | The most-asked question the product cannot answer. Faking it with an always-zero bar would be worse than absence. | **Yes** — an exposure read door would turn a re-run into an audit log. Entirely engine-side. |
| **Version history on a node** | Prior versions exist; no operation returns one. | The canvas cannot show how a memory's facts changed, and the product has no real undo. | Yes — it is the same door that gives undo. |
| **Writer identity** | No per-memory writer field exists anywhere in the record. | "Who wrote this?" is unanswerable, and colouring by a guess would be worse. | Yes, but **do not fake it.** `scope` looks like an app axis and is not provenance. |
| **A "duplicate of" edge type** | The field is real and readable; nothing writes it. | Nothing today. An always-empty edge type is a lie about the data model. | Draw it the day something writes it. |
| **Temporal validity on edges** | The fields exist and, in practice, nothing sets them. | Nothing today. | Not until something writes them. Bi-temporal edges are the right model with no data behind them yet. |
| **Confidence as a visual channel** | Derived, absent from the write contract, not a simple function of any field the user sets. | None. Encoding a number nobody can act on invites the user to act on it. | **No.** Read-only in the detail panel; never an encoding. |
| **An embedding / semantic-space projection** | A 2-D projection of embeddings is a *different* view, not this one. | None for v1. | Later — and if it happens, the MIT engine of §3.7, never its non-commercial namesake. |
| **Parallel-edge bundling, on the critical path** | It changes a couple of percent of a working vault's drawing. | Negligible now; correct at scale. | Build it cheaply, keep it off the critical path. |

## 6. What would falsify this

**The claim in §1 is falsified if any of the following turns out to be true:**

1. **A real user's vault is a connected web.** If, on vaults other than the ones this design was
   measured against, entity graphs come back mostly connected with a low singleton fraction, then
   fragmentation is not the subject, the curation rail is not the product, and lens C is a restriction
   that hides the actual shape. **The instrument already exists:** the regime detector of R16 computes
   the singleton fraction and maximum degree at load. Log its distribution across the first users and
   check whether the design was built for a shape only one vault has.

2. **Users use the canvas to navigate and never to curate.** If the rail rows are never opened, the
   counters never clicked, and the only interaction is pan-and-zoom, then the graph is decoration after
   all and belongs behind a link rather than in the rail.

3. **The reductions are never reached, or always are.** If the refusal panel of R9 never fires for
   anyone, `DRAW_CAP` is set too high to be a real constraint and the ladder is dead code. If it fires on
   every load, lens C is the wrong default and the cold start should be seeded after all.

4. **Relocation reads as suppression anyway.** If users report that memories "disappeared" from the graph
   despite the counters, then folding single-memory surfaces into chips failed at the only thing it was
   supposed to do over suppression, and the honest answer is to draw the full bipartite behind an
   explicit "show me everything, I accept it will be unreadable" switch.

5. **The fidelity strip does not land.** If users still treat the drawing as the engine's own picture —
   observable the first time someone runs a multi-memory rename off the strength of two adjacent nodes —
   then three passive disclosures were not enough, and the merge affordances need an active confirmation
   naming the reconstruction rather than a strip at the bottom of the screen.

6. **A graph read door ships.** This is the friendly one. If the engine grows a door that returns its own
   nodes and edges, then §3.5 stops being a caveat and becomes a diff: the client's reconstruction
   against the engine's own graph, drawn side by side, with the disagreements as the highest-value rail
   rows in the product. The design survives; the caveat is replaced by a measurement.
