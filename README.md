# Kaleidoscope UI

Your coding agent remembers things — decisions you made, mistakes it already paid for, how your
project actually works. Those memories live in a folder on your own machine.

This opens them in your browser so you can read them, fix the ones that are wrong, and delete the
ones that should never have been written.

Nothing leaves your computer.

---

## Run it

```
npx @kleos-research/kaleidoscope-ui
```

It prints a link. Open the link.

That's the whole thing — nothing to configure, no account, no server to set up.

---

## What you can do

**Read what your agent knows.** Every memory, grouped by when it was written, filtered by project.

**Ask a question the way your agent does.** Type a question and see exactly which memories your
agent would have been handed for it. This is the fastest way to find something worth fixing: if the
answer looks wrong, you've just found the memory to correct.

**Fix a memory.** Change the wording, correct a fact, or narrow where it applies. A copy is kept
before every change.

**Remove one.** Hides it from your agent. The text stays in your vault folder — the app says so
plainly rather than promising more than it can do.

**See what your memories talk about.** The names and ideas that come up across your memories, and
which ones look like the same thing spelled two ways.

---

## You also need the engine

This app is a window onto your memories. The program that actually stores and reads them is
`kscope`, and it installs separately:

```
npm install -g @kleos-research/kaleidoscope
```

Check it worked:

```
kscope --version
```

If `kscope` is missing, this app tells you so, shows you that command, and lists everywhere it
looked. It won't guess, and it won't create a vault you didn't ask for.

Already have it somewhere unusual? Point at it directly:

```
npx @kleos-research/kaleidoscope-ui --kscope /path/to/kscope
```

---

## Which memories you're looking at

Your agent keeps memories per project, and may also have a global set. The app shows you which one
it opened, and you can switch between them from the top of the screen.

If you started it inside a project folder, it opens that project's memories.

---

## Questions people ask

**Does anything get uploaded?** No. The app runs on your own machine and talks only to the `kscope`
program on the same machine.

**Can other people on my network see it?** No. It listens only on `127.0.0.1`, and the link carries
a one-time key that stays in your browser.

**Will it change things behind my back?** No. It only writes when you press a button, and it keeps a
copy of a memory before changing it.

**Can I undo a deletion?** No — and the app says so before you delete. Removing hides a memory from
your agent for good.

**Is it safe to try?** Yes. Reading changes nothing.

---

## Licence

Apache-2.0. [`LICENSE`](LICENSE) is the full text; [`NOTICE`](NOTICE) carries the attributions,
including files adapted from other Apache-2.0 projects, each with a per-file note saying what
changed.

That licence covers this package's own source. It does not cover the `kscope` memory engine, which
you install separately: it is closed source, is not part of this repository, is not shipped inside
this package, and is not licensed by this repository at all — separate terms apply to it.

The published package declares **no runtime dependencies**, so installing it installs nothing else.
The browser application in `dist/` is compiled from a handful of MIT-licensed libraries; their
notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), generated from what the build
actually bundled rather than written by hand.

---

Building or contributing? See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
