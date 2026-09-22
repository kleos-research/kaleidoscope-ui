# Kaleidoscope UI

Read, fix and remove what your coding agent remembers, in your browser.

Your coding agent remembers things: decisions you made, mistakes it already paid for, how your
project actually works. With [Kaleidoscope](https://memory.kleosresearch.xyz), those memories
live in a vault on your own machine. Kaleidoscope UI opens that vault in your browser, so you
can read what your agent knows, correct what is wrong, and remove what should never have been
written. It runs locally, and nothing leaves your computer.

---

## Before you start

You need three things:

- **Node.js** 20.19 or a later 20.x release, or 22.12 or later.
- **The Kaleidoscope engine, `kscope`**, installed and activated with a key. Kaleidoscope is in
  early access: email [contact@kleosresearch.xyz](mailto:contact@kleosresearch.xyz) and we will
  send you one.
- **A vault.** Run `kscope init` once in your project.

```
npm install -g @kleos-research/kaleidoscope
kscope activate <your-key>
cd your-project
kscope init
```

The app is a window onto your memories. It reads and writes only through `kscope`, so it cannot
open a vault that `kscope` cannot.

---

## Run it

From your project folder:

```
npx @kleos-research/kaleidoscope-ui
```

It prints a link. Open the link in your browser. Press Ctrl-C in the terminal to stop the app.

If something is missing, such as the engine, the key or a vault, the app tells you which one
and shows the command that fixes it.

---

## What you can do

**Read what your agent knows.** Every memory, grouped by when it was written, and filtered by
project.

**Ask a question the way your agent does.** Type a question and see exactly which memories your
agent would be handed for it. This is the fastest way to find something worth fixing: if the
answer looks wrong, you have just found the memory to correct.

**Fix a memory.** Change the wording, correct a fact, or narrow where it applies. The app keeps
a copy before every change.

**Remove a memory.** Your agent stops seeing it. Read the notes on removal below first.

**See what your memories talk about.** The names and ideas that come up across your memories,
and which of them look like the same thing spelled two ways.

The app shows which vault it opened. If you have more than one, switch between them from the top
of the screen.

---

## Good to know

**Nothing is uploaded.** The app runs on your machine and talks only to the `kscope` program on
the same machine. The package has no runtime dependencies, so installing it installs nothing
else.

**Nobody else on your network can open it.** It listens only on `127.0.0.1`, and the link it
prints carries a one-time key that stays in your browser.

**It changes nothing on its own.** It writes only when you press a button, and it never creates
a vault.

**Asking is recorded.** Browsing and reading change nothing. **Ask** uses the same search your
agent does, so each question you ask is recorded in the vault, including the words you typed.

**Removing cannot be undone.** Removing hides a memory from your agent for good, and the app
says so before you press the button. The text stays in your vault folder, and a copy is kept
outside it.

**To remove a secret, use the other screen.** Before every change, including a removal, the app
keeps a copy of the memory in your operating system's application-data folder, outside the
vault. Deleting the vault does not delete those copies. So an ordinary Remove is the wrong tool
for a leaked password or key. Use the app's **What removal cannot do** screen, which removes the
memory without keeping a copy, and then rotate the secret. The app prints where it keeps copies
each time it starts.

The full list of what the app cannot do is in [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

---

## Options

```
npx @kleos-research/kaleidoscope-ui [options]

  --kscope <path>   use this engine instead of searching for one
  --port <n>        ask for this port; if it is busy, a free one is used
  --preflight       check the setup, print what was found, and stop
  --json            print the --preflight report as JSON
  --version         print the version of this package
  --help            print this list
```

Without `--kscope`, the app looks for the engine in the `KALEIDOSCOPE_ENGINE` environment
variable, then in the folder of the `node` that is running the app, then on your `PATH`. It
prints the path it chose.

---

## More

- [Kaleidoscope documentation](https://memory.kleosresearch.xyz/docs/ui/), including installing
  and activating the engine.
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md): what the app does not do, and what it cannot
  promise.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): building
  and changing the app.
- [`SECURITY.md`](SECURITY.md): how to report a vulnerability.

---

## Licence

Apache-2.0 for this package's own source ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). It does not
cover the `kscope` engine, which is closed source, installed separately, not part of this
repository or package, and not licensed by it: separate terms apply. Notices for the bundled
MIT and 0BSD libraries are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
