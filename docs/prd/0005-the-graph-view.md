# PRD 0005 — The names in a vault are a table, and the picture is a diagnostic beside it

> **Status (2026-09-02).** Landed, and this document was rewritten to describe what shipped rather
> than what was designed. The screen is now a **faceted table of names** with a selection panel and
> two node-link drawings: a bounded ego view around one chosen name, and a whole-vault overview that
> is a diagnostic rather than a way to find anything. The three-lens canvas, the hub-collapse ladder
> and the resident four-line fidelity strip that the previous version of this document specified were
> **built, shipped and removed**; the reasons are in §5. **A path between two names was specified
> here and is not built, will not be built, and a test now fails if anybody adds one** — see §5.1.

**Date:** 2026-09-02
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** PRD 0002 (the listing this screen is arithmetic over, and the shared escaping path)
**Relates to:** PRD 0006 (curation — it owns the merge, and this screen routes to it)
**Supersedes** the version of this document dated 2026-08-31.

---

## 1. The product claim

**A vault's names are a table. The picture is worth keeping for the one question a table cannot
answer, and it is worth keeping out of the way for every other one.**

Two facts about a vault of this kind decide the whole design, and both are visible to a client:

1. **Names join on exact character identity and on nothing else.** There is no stemmer, no alias
   table and no fuzzy match under a fact. `retry budget` and `the retry budget` are two things,
   permanently, and each looks complete from where it is standing.
2. **Most names appear in exactly one statement.** A working vault is therefore one modest region
   and a few hundred small ones, and it is very likely **more connected than any screen can
   currently show**.

**Synthetic illustration.** The vault below is constructed for this document so the arithmetic in the
rest of it is checkable. It is not a measurement of anyone's vault; it is a shape chosen to resemble
the one a working vault has, and it is what §4's fixtures are generated to match.

> 350 memories · 950 statements · 1,200 distinct endpoint surfaces · 880 of them appear in exactly one
> statement · 380 separate groups, the largest 200 names · maximum degree 10 · one name in fifty
> carries a second spelling of itself somewhere else in the vault.

From (2) follows the arithmetic that settles the picture. A readable label chip is about 120 × 20 px.
A thousand of them want roughly twice the ink of the whole canvas, so a fully-labelled whole-vault
drawing is not a design decision — it is a thing that cannot be done. What such a drawing *can* say
is its own summary: *this many names, in this many groups, this share of them named once, the largest
group this big.* Four numbers and a sentence, which are legible in a header and estimated by eye in a
picture.

From (1) follows the thing worth acting on. Every pair of spellings a reader merges turns two loose
ends into one junction. That is the only surface in this product that improves the **data** rather
than the picture, and it is what the table's third tab is for.

So: the table is the entry point, the selection panel is the answer, and the drawings are two, small,
and honest about their jobs.

| surface | the question it answers | what it hides |
| --- | --- | --- |
| **The names table** | what is in here, what is central, what is new, what looks duplicated | all topology — two well-connected names look identical whether they are adjacent or on opposite sides |
| **The selection panel** | what do we know about this thing, and where did it come from | scale — you cannot tell from it whether this neighbourhood is rich or ordinary |
| **The ego drawing** | what surrounds this name, and how is it braided | everything outside one neighbourhood |
| **The whole-vault overview** | how big and what shape is what my agent knows; where are the loose ends | every detail; it is a picture of shape and says so |

## 2. What it costs to get this wrong

The previous version of this screen opened on a whole-vault canvas. The owner's review of it named
the cost directly — *"too much information overload on any page"*, *"I just don't know what to do"* —
and the failure is not aesthetic. A screen whose default is a picture of a thousand unlabelled dots
gives a reader nothing to do next, so they leave; and the one action that would actually improve
their vault, merging two spellings of one thing, was reachable only by noticing two dots in a field
of a thousand.

The second cost is a claim nobody can check. A canvas that quietly drew part of a vault looks exactly
like a vault of that size, and a drawing that stopped part-way through a ring of neighbours looks
exactly like a complete one. Both are refusals spelled as answers. Every ceiling in §3 therefore
refuses a whole unit and reports the exact number it did not draw.

## 3. The mechanism, as designed

### 3.1 One reconstruction, and it is named as one

Every surface here is arithmetic over the listing the browser already holds. Facts are grouped on the
exact spelling of each endpoint, which is sound in principle — identity in this store is exact match,
a property a client can see — and is still not the engine's own graph. It over-fragments where the
engine already holds two spellings as one thing, it cannot see a class of link the export does not
carry, and it draws a superseded claim and its successor as two equal lines.

That statement is on the screen in one line under the drawing, and in full behind a closed row on
the selection panel, beside this app's counts and the engine's own where the two can be compared. It
is **not** four resident paragraphs. Honesty about a property and displaying it permanently are
different requirements, and a page showing everything it knows is not more honest — it is less
usable.

### 3.2 The table

Header: `<N> names across <M> statements`. Then four readings, of which the fourth is not a number:

- `<N>` named once and never again
- `<N>` separate clusters, largest is `<N>`
- `<N>` look like the same thing, spelled twice
- *Names join only when they match character for character, so this is more connected than it looks.
  Every pair you merge turns two loose ends into one junction.*

Then four orders. Two are sorts and two are filters, and each filter carries its count in the control
because it changes what is in the table rather than what order it is in: **Most connected**,
**Recently mentioned**, **Possible duplicates `<N>`**, **Named once `<N>`**.

Columns: name, kind, connected to, in memories, and what to do about it. "Connected to" is **discrete
ticks and an integer, not a sparkline**. A sparkline needs range; degree here runs from one to about
ten and most rows are the constant 1, so a sparkline of that is a flat line for most of the table
dressed up as a trend. Where a merge is proposed, the ticks it *would* add are drawn in the
warn tint beside the real ones and the cell reads `4 + 2` — the whole argument for merging, visible
in the bar.

A row with another spelling proposed against it carries a chip naming that spelling verbatim, and its
action is `Merge?`, which routes to the curation screen (PRD 0006). The chip names the other spelling
rather than saying "duplicate", because a reader deciding whether two names are one thing needs to see
both of them.

### 3.3 The selection panel

Reached by opening a name. Ordered top to bottom, and the ordering is the design:

1. The name verbatim, its kind and its gloss.
2. Three counts: connections, memories, relations used. A name with nine connections and one relation
   is a different object from one with nine of each.
3. **What is said about it** — every incident statement, with the other end as a link. Direction is
   carried by word order rather than by an arrow glyph, because the two cases are genuinely different
   sentences.
4. **Memories that name it** — every one opening the memory. Every operation this app performs is
   addressed by memory id, and a name that reaches none is a name you can only look at.
5. **How this drawing was made** — closed, carrying the counts and the reconstruction statement.

Because degree is bounded and small, **every list in this panel is complete**. What is behind a
closed row is deferred for attention and carries its count; nothing is truncated.

### 3.4 The ego drawing

The neighbourhood around one chosen name, at depth one, two or three, with the chosen name at the
centre in the text ink and its neighbours coloured by kind and sized by how often each is named.
Edges carry the relation. The layout is deterministic — breadth-first rings from the centre, no
physics, no settling animation — so the same neighbourhood is the same picture on every reload.

**Hard node cap of 60.** A working vault's maximum degree is small — ten in §1's illustration — so
depth 1 is at most eleven nodes and the cap is almost never reached — which is exactly why it is cheap to keep. It is
grown a whole ring at a time and a ring that would cross the cap **is not drawn at all**, with the
exact number it would have added stated on the drawing.

### 3.5 The whole-vault overview

Behind a control on the table, never the default. It is a diagnostic and an overview: you open it to
feel the size and shape of what your agent knows, to see the one large region against the field of
small ones, and to see that two spellings of what is probably one thing are sitting on opposite sides
of the vault.

- **Colour is kind, size is how often a name is used**, and the palette is muted so structure reads.
  The slots are assigned at run time to the kinds *this* vault uses, most-used first; everything past
  the last slot takes the neutral ink and keeps its own name. No kind vocabulary is written down.
- **Labels: the largest few always, everything in view above a zoom threshold, and whatever is under
  the pointer.** A label that would land on a label already drawn is dropped, biggest first, so the
  reader gets the large names legibly rather than every name illegibly.
- **Near-duplicate pairs are drawn as a dashed link in the warn ink with a ring on each end.** It is
  the one relationship position cannot show, because the two spellings are usually in different
  components, and it is the only thing on the canvas a reader can act on.
- **Searching or selecting a name lights it and dims the rest.** The same box narrows the table and
  produces the highlight set, so the two are one world rather than two features that agree until one
  of them is edited.
- One caption, one line: it is this app's drawing, names joined only where spelled identically, and
  what is on screen is shape rather than detail.

**Layout.** Inside a component, position means adjacency and a seeded relaxation is the right tool —
springs with a rest length on the edges, repulsion cut off past a short range, no random term. Between
components, position means **nothing**, and the layout says so by packing them largest-first into rows
rather than by pretending a physics simulation decided. The result is deterministic: a diagnostic run
fortnightly is only useful if what changed between two runs is the vault.

**Renderer.** A canvas, not SVG: a pan changes every element at once, which is a draw call on a canvas
and two thousand live DOM nodes in SVG. The ego drawing next door *is* SVG, deliberately — it has at
most sixty nodes and every one of them is a link.

## 4. Requirements

**R1.** The default surface at `#/names` is the table. No node-link drawing is rendered on arrival.

**R2.** These screens issue **no door call of their own**. Driving every control on them — every
order, every find, the overview, the ego drawing at every depth — spawns no engine process and leaves
the vault's exposure-record count unchanged.

**R3.** A row exists for every distinct surface appearing as a fact endpoint. No code path filters the
table by the declared entity list.

**R4.** Every order is **total**: the same vault, listed twice from inputs in different orders,
produces the same sequence of names.

**R5.** The count on a filtering tab is computed before the find box is applied, and typing in the
find box does not move it.

**R6.** The summary card and the duplicates tab count the **same population**. They may report
different units — groups and names — and where they do, the screen prints the sentence that
reconciles them.

**R7.** The provisional ticks on a degree bar are the real degree of the other spellings proposed
against that name, not a placeholder.

**R8.** No rule in this app merges two surfaces. The near-duplicate detector nominates and the graph
is unchanged by running it.

**R9.** The ego drawing has a hard node cap. A neighbourhood is grown a whole ring at a time and a
ring that would cross the cap is **not drawn at all**; the count reported is the exact size of the
refused ring.

**R10.** No drawing renders an edge the export does not literally contain. The near-duplicate link is
drawn in its own style and is not in the edge set.

**R11.** The whole-vault layout is **deterministic**: the same elements place identically on two
consecutive runs, with no random term anywhere in it.

**R12.** The whole-vault layout is affordable at the size §1's illustration describes. **Measured**,
on a fixture this repository generates to that shape — 1,230 names, 877 statements, 381 groups,
largest 199 — the layout takes **10–28 ms**. A budget test fails above two seconds, which is what
catches the change that makes the relaxation quadratic in the whole vault rather than in each
component.

**R13.** The whole-vault drawing stays inside a 60 fps frame with the whole vault on it. **Measured**
in a browser, drawing about 2,200 elements onto a canvas of 1,996 × 1,116 device pixels with the
drawing forced to flush before the clock is read: **5.8 ms mean, 6.2 ms p95** at the opening fit, and
**4.7 ms mean, 7.0 ms worst** zoomed in past the label threshold, against a 16.7 ms budget. The
element count, not the vault, is what the number is about.

**R14.** Above a stated element ceiling the overview **refuses and says so**, naming the count and the
ceiling. No code path truncates the drawn set silently.

**R15.** The find box produces the highlight set the canvas uses. For any query, the set of names lit
in the picture equals the set of names listed in the table.

**R16.** A query that matches nothing dims the whole canvas. "No highlight" and "nothing matched" are
different states and are visibly different.

**R17.** The route carries a surface **verbatim**, percent-encoded — never normalised, hashed, or
reduced to a position in a list. Two spellings a near-duplicate rule would fold together have
different routes.

**R18.** No kind, relation name or memory type is written down in this repository. The palette is
assigned at run time from the kinds the loaded vault uses, and the legend prints the count of kinds it
could not give a colour to.

**R19.** The reconstruction statement is present in one line beside every drawing and in full behind a
closed row on the selection panel. It is not four resident paragraphs.

**R20.** **Nothing in the shipped source computes a path between two names.** A test walks the
application source and fails on a function that does.

## 5. What is not delivered, in order of what it costs

### 5.1 A path between two names — removed, and now prevented

The previous version of this document specified it twice and called it "free" and "a two-click UX".
It is not delivered, it will not be, and R20 now fails the build if it returns.

Two names drawn at random from §1's illustration share a group about **2%** of the time — the sum of
each group's squared size over the square of the vault, which for one group of 200 among 1,200 names
is where nearly all of it comes from — so the feature answers "no path" in roughly 97 uses out of 100.
And in the 3 where it succeeds, the group is very nearly a tree, so the path is unique and linear — a
breadcrumb, not a drawing. It is the one task
node-link diagrams are known to win at, and it is degenerate on this data: a beautiful demo with a
near-total failure rate in use.

*Cost of leaving it out:* none that has been observed. The honest version of the same answer — "these
two are in different groups" — is already legible from the component counts in the table.

### 5.2 The three lenses, and the hub-collapse ladder — built, shipped, removed

The previous design carried one model behind three projections, a draw budget, a reduction ladder, a
collapse threshold and an "absorb into context" operation. All of it worked and all of it is gone.

The lenses were three answers to a question the reader had not asked, on a screen whose whole problem
was that it presented its own capabilities rather than a first, a second and a third thing. The hub
machinery was built against a generated hundred-thousand-edge fixture and **never fired on a working
vault**, because a working vault's maximum degree is small — an inert mechanism that looks exactly
like a robust one, and which costs a reader a control they must understand before they can use the screen.

*Cost:* a vault with a genuine hub would now draw a large ego view rather than a collapsed one. The
node cap in R9 bounds what that can put on screen, and the refusal names the number.

### 5.3 Community detection, edge bundling, centrality ranking

Not built, and not for later. The components already *are* the clusters and each is very nearly a
tree, so modularity clustering on one returns the trees; edge bundling needs parallel edges and there
are fewer edges here than nodes; and with a small maximum degree, the whole interesting part of the
ladder is a few dozen rows the table shows in full. Each would be a knob nothing reads, producing
a confident-looking result that carries no information the component id does not already carry.

### 5.4 A kind × kind matrix

Not built. It is the only view that would make the kind vocabulary's sprawl visible in one glance —
a real vault carries several times as many kinds as the schema names. The legend on both drawings
prints the count of kinds past the palette, which is a weaker version of the same finding.

*Cost:* drift in the kind set is a write-path quality signal, and nothing in this product yet shows
its shape.

### 5.5 Nothing renders in a test

Every requirement above except R13 is asserted against the model and the layout, which are pure
functions with no DOM. R13 was measured by hand in a browser against a real vault. There is no
rendering test, so a change that broke the canvas while leaving the model correct would pass.

## 6. What would falsify this

**The claim in §1 is that the table is the entry point and the picture is an occasional diagnostic.**

It is wrong if a reader who is trying to find a particular name reaches for the overview and succeeds
faster than they would have by typing it — which would mean the label arithmetic in §1 is wrong about
what a person can read off a drawing at this density.

It is also wrong if the duplicates tab turns out to be noise: if a reader works through it and
concludes that most proposals are two genuinely different things, then the fragmentation the whole
screen is organised around is not fragmentation, and the ordering of §3.2 should be by recency
instead.

And it is wrong in the other direction if the overview never gets opened at all after the first week.
That is the observation the products this design was reviewed against all report about their own
whole-graph views, and it is the reason this one is behind a control instead of in front of the table.
Keeping it is a bet that a picture with the actionable structure drawn on it — the dashed pairs — is a
different object from a picture without one.
