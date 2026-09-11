# Contributing

Bug reports, questions and patches are all welcome. This file is the short version of what a
change has to satisfy; [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) is the longer one.

## Running the tests

The tests run against a real engine and a real vault, and **every one of them writes**. So each
clones the vault into a fresh temporary directory first, points the engine at the copy, and then
makes the engine confirm — through its own address door — that the copy is what it resolved and the
original is not, before the first write. Nothing writes to the vault you name.

Name that vault in `KALEIDOSCOPE_TEST_VAULT`. There is no default and no built-in path: if the
variable is unset the tests stop rather than reaching for a vault nobody offered them.

```
npm install
npm run build
KALEIDOSCOPE_TEST_VAULT=<path-to-a-vault> node --test test/*.test.mjs
```

The glob is the shell listing the files for you, which is deliberate — `node --test test/` does not
work on current Node, so the files have to arrive named. `docs/DEVELOPMENT.md` spells the list out,
and says which three tests need no vault at all.

## The two controls

Every change must pass both.

```
npm run boundary                                   # the pattern gate
node --test test/boundary-vault.test.mjs           # the vault comparison
```

**The gate** derives every rule from the tables in [`docs/BOUNDARY.md`](docs/BOUNDARY.md) at run
time, so the document and the check cannot drift apart. It catches a leak with a recognisable
*shape*: an engine source path, a vault identifier, an absolute path under someone's home
directory.

**The vault comparison** exists because the most dangerous leak has no shape. A real entity surface
copied out of somebody's vault is just English, and no scanner can separate it from a phrase an
author invented — not until you have a vault in your hand and can compare the two. That is not
hypothetical: real names out of the vault this product was built against had been used as
illustrations in two doc comments, a fixture and a status document, and every one of them read as
an author's example. The gate was green the whole time and was working correctly. The only
instrument that could see it was the vault itself, on the other side of the comparison.

So: **invent your examples.** Fixtures, placeholder paths, sample names, the memories in a
screenshot — all of it made up, none of it lifted from a vault you happen to have open. Screenshots
are gitignored for the same reason, because no text scanner can offer a control for them.

A clean pair of controls is still not a clean review. A human reads anything that describes how the
engine behaves.

## Why `dependencies` stays empty

`npx` re-resolves a package on a cold machine, so a runtime dependency is a download the user waits
through on first launch, on every machine. A tool whose whole pitch is *local, offline, no network
call* cannot contradict itself at install time. Every UI and build library is a `devDependency`,
and `test/release.test.mjs` asserts the property where it actually matters: installing the published
tarball adds exactly one package, with the network switched off. Please keep it that way — a change
that needs a runtime dependency needs that conversation first.

## Style

British-leaning plain English, in the voice the existing documents use. Comments and commit
messages explain **why**; the code already says what. Say what a thing cannot do as plainly as what
it can — under-promising is a product requirement here, not a habit.
