# What this app does not do

This is the honest list: what the app cannot promise, where it is known to be weak, and which of
its edges you are most likely to meet.

Everything here was measured against a real vault or a generated one, not estimated. Where
something is untested rather than known to be bad, it says *untested* — that is a different claim
and this document keeps them apart.

---

## Removing a memory cannot be undone

**There is no un-remove, anywhere, by any route.** This is the sharpest limitation in the product
and the app says so before you press the button rather than after.

- **Removing hides a memory from your agent. It does not erase it.** The text stays in your vault
  folder on disk, at the version it had before the removal. It stops being served and it stays
  written.
- **Nothing published puts it back.** Four ways in were tried and every one is refused: a copy of a
  single memory cannot be imported at all; a whole-vault copy cannot be imported back over the
  vault it came from; a vault holding anything the package does not carry is refused; and an edit
  against a removed memory is refused. See [`DECISIONS.md`](DECISIONS.md) for how that was
  established.
- **A copy is not an undo.** The app keeps a copy of a memory before every change and every
  removal, and you can read it and save it to a file. There is no button that puts one back,
  because there is nothing to route one to.
- **The one thing that does work is not aimed at a memory.** A whole-vault copy taken *before* a
  removal can be imported into a fresh, empty vault. It cannot be aimed at one memory and it
  cannot be aimed at the vault you are looking at.
- **If a removed memory held a secret, hiding it is not enough.** Rotate the secret first. The app
  will print the command that destroys the vault; it never runs it, and it does not walk you
  through rebuilding afterwards. A removal begun from that screen deliberately keeps **no** copy,
  and the record of it says so.

## The whole-vault picture is an overview, not a way to find something

The picture of every name in your vault is a diagnostic — it shows shape, islands, and spellings
that ought to be one thing. **It is not how you find a memory.** On a vault of around 1,450 names
it is a field of dots. Use the list or the search screen to find something; use the picture to see
what your memories have turned into.

- **It refuses rather than drawing a fraction.** Above 20,000 drawn elements it says so and shows
  the table instead. A picture that silently drew 40% of a vault would look exactly like a vault
  that was 40% the size.
- **Around one name it draws at most 60 names**, growing a whole ring at a time — the ring that
  would cross the cap is not drawn at all, so you never see a half-drawn ring you cannot tell from
  a complete one. Depth goes to three steps.
- **Some relation names are numbered instead of written.** Measured on a real vault, 97.6% of them
  are drawn on their line at one step out and 93.7% at two; the rest are numbered and decoded in a
  legend in the corner. A name longer than the line it has to sit on cannot be drawn on it.
- **There is no path between two names, and there never will be here.** Two names drawn from a real
  vault share a component about 2% of the time, so the feature would answer "no path" in roughly 97
  uses out of 100 — and where a path exists the component is a tree, so the path is the only route
  and says nothing. You can pin one name and open another instead; the app draws both and rings
  what they share.
- **Names join on exact characters and nothing else.** There is no stemmer and no alias table
  underneath, so two spellings of one thing are two things, permanently. Roughly three names in
  four appear in exactly one fact, which means your vault is probably more connected than any
  picture here can show. The app **nominates** near-duplicates and never merges them for you.
- **One name that dominates a vault can be collapsed into a box, and only the busiest one is
  offered.** The bar for that is computed from your own vault's spread (at least 20, or four times
  its 99th-percentile name), so on an ordinary vault nothing clears it and no control appears — the
  caption says that is a measured answer rather than a missing feature. On a vault with two such
  names, the second is in the list of reductions rather than in the offer.

## Asking a question writes to your vault

One screen — *Ask the way your agent does* — reaches the engine's ranked door. **Every press
records a row in your vault carrying the question as you typed it. That row is permanent, and
nothing published reads it back or deletes one.** The screen says so before you press.

Everything else in the app writes nothing: browsing, filtering, the memory page, the pictures and
opening the editor all read. The *find* box narrows rows the browser already holds — it reaches no
server, and it cannot find a memory that means the same thing in different words.

## Reading and finding

- **The list loads the whole vault in one call.** There is no pagination. Above 25,000 memories the
  app names the count it read, names the ceiling, and refuses rather than hanging.
- **It notices a change; it does not act on one.** A background check every 30 seconds raises a
  badge when your vault has moved under you. The list itself refreshes on your word, so a page you
  are reading never rearranges itself.
- **A correction is not a link.** The write contract stores a correction as free text — the writer's
  own words about what they were fixing — with no stored pointer to any memory. The app quotes the
  sentence, marks it *a note, not a link*, and offers to search for the handle. A *contradicts*
  entry is a real stored list of memories and does navigate. See [`DECISIONS.md`](DECISIONS.md).
- **Evidence was never verified when it was written.** A path, a command or a quoted sentence on a
  memory is a pointer the writing agent left, and nothing checked it then or checks it now.
- **The list preview has no version count.** That is a second read this pane does not make; the
  memory's own page has it.

## Editing

- **One memory at a time.** The editor changes the memory you opened and nothing else.
- **A copy is written before the change, and if the copy cannot be written the change does not
  happen.** A safety net that skipped quietly when the disk was full would be worse than none.
- **A save against a memory that moved is refused, not retried.** If an agent wrote to the memory
  while you had it open, the save is refused and the editor shows you what changed, field by field.
  It never retries on your behalf: a retried write is a second write and nobody can tell which one
  landed.
- **The drift warning only catches an exact wording that left.** A fact row turns amber when one of
  its endpoints was spelled in the note when you opened the editor and is not spelled there now. If
  you reword a paragraph entirely, no card turns amber. This is deliberate — flagging every fact
  whose endpoints are not spelled out in the prose would put a warning on most rows of most
  memories, which is a warning nobody reads — but it means the check is narrower than it sounds.
- **The prose pane is a text box with the Markdown marks dimmed, not a document editor.** A blank
  line between paragraphs is a full blank line, as it is in any text box. Closing that gap needs a
  real editor, which would mean giving up writing a memory nobody edited back byte for byte.

## Changing several memories at once

There is no engine transaction underneath any of this. **Unifying a spelling is N separate writes
and merging two memories is two**, and this app owns the ordering, the half-finished states and the
recovery a real transaction would have owned.

- **Runs are serial and stop at the first refusal.** A refusal usually means somebody else is
  writing to this vault right now, so the remaining items are the ones most likely to be wrong. A
  stopped run reports the boundary — what was written, what was refused and why, what was never
  attempted — and hands back a resume that does not redo what landed.
- **One run carries at most 100 memories.**
- **A rename rewrites facts and declarations, not prose.** A name mentioned in the words of a
  memory is left as it was; the preview says which mentions it will not touch.
- **Nothing nominates a pair of memories to merge.** The app finds duplicate *names*; it has no
  notion of two memories that say the same thing. So merging is a feature for someone who has
  already found the duplicate, which is not the person who most needs it.
- **A half-finished merge is recorded on disk before the first write** and raises a banner over
  every screen until it is settled. It offers exactly two ways out, because there is no third
  operation to route one to.
- **Only one kind of finding has a run behind it.** Of the five things the curation screen finds,
  near-duplicate names can be reviewed and unified in one place. The other four end in *open this
  memory in the editor*, and on a real vault they are most of the list — which means the top of the
  list gets worked and the bottom does not.
- **Saying "these are really different things" is this app's note, not your vault's.** It is kept
  outside the vault, it is reversible from the same screen, and it is keyed to what the finding is
  about. A third spelling joining a group makes a *new* finding, which has not been dismissed. The
  store holds 10,000 answers and refuses at that ceiling rather than quietly forgetting the oldest.

## The copies this app keeps

- **They live outside your vault**, in this app's own state directory, keyed by which vault they
  came from. Putting them in the vault would pollute the store the app exists to curate: they would
  show up in your memory list and be handed to your agents.
- **They are plain text**, and they hold whatever the memory held — including anything you would
  rather was not lying around twice. The exception is deliberate: a removal begun from *what
  removal cannot do* keeps no copy at all.
- **The newest 20 copies of each memory are kept, and the newest 500 in a vault's store.**
  Whichever bites first, the oldest go. Nothing expires by age. Outside a test, no store has ever
  been near either bound, so the pruning is arithmetic that has been asserted rather than watched.
- **There is no screen listing every copy of one memory.** Receipts link to the copies a run made,
  and a copy can be saved to a file from there.

## The engine, and versions of it

`kscope` is a separate, closed-source program that you install yourself. This app never modifies
it, never bundles it, never downloads it and never updates it, and it never opens a file inside
your vault — everything goes through the published command line.

- **An engine this build was not tested against still reads.** The app compares the engine's write
  contract against the ones it knows. If it does not recognise it, reading is unaffected and the
  menus of fixed choices become free text boxes; if something the app needs is missing or retired,
  it refuses to write at all and says so. Both of those states have only ever been driven from
  perturbed fixtures — **no real engine has produced one**, so whether that machinery is
  load-bearing is untested.
- **Two builds of the same engine version can differ**, and a vault written by a newer one can hold
  records an older one refuses to read. The app prints the engine it resolved, which is most of the
  defence a local tool can offer.
- **A reload restores your view and cannot restore your session.** The launch link carries a
  one-time key that the page reads once and erases, so a reloaded tab holds no credential and the
  app says so. Persisting the key would fix the reload and would be a materially worse product.

## Where the testing stops

379 tests cover the pure arithmetic, the engine client and the HTTP surface. What they do not cover
is worth knowing:

- **Nothing renders in a test.** There is no browser, no DOM assertion and no component test. Every
  visual defect in this project's history was found by a person looking at the screen, and none was
  visible to a green suite. Two static guards narrow the worst shapes — every class a screen uses
  has a rule in the stylesheet, and every screen has a route that reaches it — but a component
  mounted behind a condition that is never true would still pass.
- **Hostile content is argued, not asserted.** Raw HTML is disabled at the Markdown tokeniser and
  the framework escapes by default; no test drives a script payload through a screen.
- **Timeouts, a binary that cannot be executed and an unexpected exit code** are all handled in
  code and none is exercised.
- **The very large graph has never been in a browser.** A generated 100,000-edge case runs in tests
  and holds about 590 MB in Node; what that costs in a tab, and what the first paint after a
  collapse looks like there, is unmeasured.
- **The setup screen can only be reached by not having an engine**, so on a working machine nobody
  sees it again until it is already failing.
- **Two checks cannot run on a public CI runner.** The one that compares this repository against a
  real vault needs a vault, and the one that installs the packed package and runs it needs the
  engine. Both run only where somebody remembers to run them.
- **Nothing has been tested against a second machine, a second browser, or a vault being written by
  someone else in another room.**
