# The public boundary

This repository is **public**. The `kscope` memory engine is **not**: it is closed source,
developed in a separate private repository, and installed separately by the user.

## The rule, in one sentence

> This repository may describe the CLI's **published surface** and the **shapes it returns**.
> It may say nothing about **how the engine decides anything**.

A reader of this repo should be able to build a client. They should not be able to reconstruct
the engine's ranking, calibration, thresholds, or internal structure.

## Never lands here

| class | concretely |
| --- | --- |
| Engine source | any `.rs` file, any `crates/` path, `Cargo.toml`, `Cargo.lock` |
| Engine internals by name | crate names, internal module or symbol names, calibration constant names, tuning-knob names, and any derived arithmetic that discloses one without naming it |
| Internal documents | citations into the private repo's `docs/adr/`, `docs/prd/`, `docs/architecture/`, `docs/specs/`, `docs/audit/`, `docs/evaluation/` or `docs/product/`. A citation into a tree the reader cannot open is itself a disclosure of what exists and what was decided. |
| Vault contents | real memories, real entity surfaces, real embeddings, or screenshots containing any of them — in tests, fixtures, docs or issues; a committed `.kaleidoscope/` directory at any depth; identifiers minted inside a vault (`mem_`, `ver_`, `wsp_`, `usr_`) |
| Measured internals | benchmark numbers, retrieval scores, weights, or corpus statistics from the private evaluation work |
| Machine and build traces | an absolute path under a real home directory — `/Users/<name>/`, `/home/<name>/` — a worktree path, or a CI checkout root |

## Always allowed

- The published CLI surface: command names, their documented arguments, and their exit codes.
- The JSON shapes those commands accept and return, as a client must know them to be written.
- Anything printed by `kscope --help`, `kscope schema`, or `kscope public-contract` on a released build.
- Synthetic fixtures this repository generates itself.

## How it is enforced

A CI check reads every file this repository would publish and fails the build on a hit.
See `.github/workflows/boundary.yml` and `scripts/check-boundary.mjs`.

**The check derives its patterns from the tables above, at run time.** Nothing in it is transcribed,
so the document and the gate cannot drift apart: a class added to the table with no rule behind it
fails the check as a gate-integrity error, and a class removed from the table takes its rule with it.
One class — *measured internals* — carries no mechanical rule and the check names it as review-only
rather than pretending to cover it.

**This file is the only file the check exempts**, because it has to spell out what it forbids.

A clean boundary check is **not** the same as a clean review. The check catches the mechanical
cases; a human still reads anything that describes engine behaviour.
