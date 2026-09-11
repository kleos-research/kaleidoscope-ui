# Findings that shaped this app

Five properties of the system that explain why parts of this repository look the way they do. Each
one was measured, not assumed, and each is stated here as what is true, how it is known, and what
the code does about it. If you are reading the source and wondering why something takes the long
way round, the answer is probably below.

---

## The engine has no merge, so this app composes one

**What is true.** The operator side of the engine publishes a command whose modes read like
curation. Run against a real vault, its merge reports that it applied, with a committed effect and
mass conserved — and afterwards **both memories are still present, still readable through every
other door, and still served**. Its rollback unwinds a transition nothing observed. There is no
operation to wrap.

**How we know.** It was run against a real vault and the vault was read afterwards through every
other door. A button wired to it ships green: it passes its own tests, returns success, and changes
nothing the user can see, so the user watches the list not change and concludes the app is broken.

**What the code does.** `src/server/merge.mjs` does not route that command in any mode — not behind
a flag, not for inspection — and `test/wiring.test.mjs` asserts its name appears nowhere in the
shipped source. Both curation runs are composed from the two writes whose effects have been
observed: update and delete. That is why this app owns the ordering, the intermediate states and
the recovery a real transaction would have owned — the survivor is written first because
update-then-delete fails into a redundant memory that any screen can see and one retry repairs,
where delete-then-update fails into content that is no longer served and never reached the
survivor.

## A removed memory cannot be restored, and that was tested rather than assumed

**What is true.** No published door returns a removed memory to service in the vault it was removed
from. This is the shape of the import door, not one obstacle a later build might file down.

**How we know.** Four doors were tried against a memory removed from a throwaway vault, and all
four refuse: importing the copy of a single memory is refused outright, because a per-memory export
is not an importable artefact at all; importing the whole-vault copy back over the vault it came
from is refused, because the removed record is still held and holding it is what conflicts;
importing into any vault holding memories the package does not carry is refused; and editing the
removed record is refused because it is tombstoned. The **control** is what makes that a finding
rather than a guess about an error message: the same whole-vault import was tried against a second
vault where the memory is alive and well, and the refusal is byte-identical. Nothing about it is
specific to removal, so nothing about removal is what a caller could work around. One route does
commit — a whole-vault copy taken before the removal, imported into a fresh, empty vault — and it
cannot be aimed at one memory or at the vault the user is looking at.

**What the code does.** `src/server/snapshots.mjs` exposes list, read and the bytes, and exposes no
restore route; there is nothing to route one to. Every screen says removal is one-way, in those
words. `test/restore.test.mjs` asserts all of the refusals above on every run, so the day the
engine changes this the suite goes red — and a red test is what authorises the wording to change,
rather than the reverse.

One constraint falls out of the same run and shapes the store: the export envelope carries a digest
over the payload **as the engine serialised it**, and a JSON round trip through this runtime does
not preserve those bytes. A copy this app had parsed and re-emitted would be refused at exactly the
moment somebody finally needed it, for a reason having nothing to do with what is in it. So the
store keeps the engine's own text verbatim and carries it to the browser as a string.

## A correction is free text, so no link is drawn

**What is true.** A correction on a memory is a handle and a sentence — **free text, with no stored
pointer to any memory**. A *contradicts* entry, by contrast, is a real stored list of memory ids,
and it is rare.

**How we know.** It is the shape of the record the export door returns; the handle is whatever the
writing agent called the thing it was fixing, in its own words.

**What the code does.** `src/app/MemoryDetail.jsx` quotes the writer's sentence, marks it *a note,
not a link*, and offers a search for the handle. An earlier build resolved the handle against every
title it happened to have loaded and rendered a link labelled *matched by title* — a heuristic
wearing a relationship's clothes, and one that would silently point at the wrong memory whenever
two had similar titles. The stored list of contradictions is marked *a real link* and navigates.
Two kinds of thing that are not the same kind of thing are drawn differently, and the screen's main
job is to stop pretending they are one.

## The whole-vault picture is kept, knowing it is a poor way to find anything

**What is true.** The node-link view of every name in a vault is a bad search tool. On a real vault
of around 1,450 names, finding one memory in it is worse than the list and worse than the search
screen, and no amount of drawing fixes that.

**How we know.** It was drawn, at that size, and looked at. The measurements underneath it are in
`src/app/names-model.mjs`: roughly three names in four appear in exactly one fact, and two names
drawn at random share a component about 2% of the time.

**What the code does.** The view is kept anyway, deliberately, as an overview and a diagnostic —
it is the only thing in the product that shows the shape of what agents have built, the islands,
and the spellings that ought to be one thing. Every screen that leads to it says which job it is
for. The consequences are handled rather than hidden: the picture refuses above 20,000 drawn
elements instead of drawing a fraction, a query isolates islands rather than dimming the whole
canvas, and there is no path-between-two-names feature — it was cut on the evidence above, and
`test/names.test.mjs` asserts nothing in the shipped source computes one, so nobody re-derives it.

## The door that displays a memory and the door that loads it for editing disagree

**What is true.** A memory loaded through the display door and written back **commits successfully
and deletes every entity declaration the memory carried**, while leaving the fact count exactly as
it was. Nothing in the response says so, and the next read looks fine.

**How we know.** It was round-tripped both ways against a clone. The lossy write reports that it
committed. The test that guards the correct door also performs the damaging one on every run and
asserts the declarations are gone, so the guard is demonstrated rather than described.

**What the code does.** The editor loads through the door that carries entity declarations and is
never handed the cached listing record; the detail page renders from the cache and never loads for
editing. `test/round-trip.test.mjs` asserts the declared-name **set** — not its size, because a
count survives a wholesale replacement of the names inside it, and replacement is what the wrong
door produces. This is the first thing that was built in this repository and the reason it was
built before any screen: a screen would have let the round trip pass for the wrong reason.
