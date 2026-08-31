# PRD 0001 — A browser cannot reach the vault, so one small local process spawns the CLI per request

> **Status (2026-08-31).** Not started. Today there is no way to look at a Kaleidoscope vault except by
> typing `kscope` commands and reading JSON. This document specifies the one component every other part
> of the UI stands on: a dependency-free local HTTP server that resolves the `kscope` binary, runs a
> preflight, serves the prebuilt single-page app, and turns each browser request into exactly one
> `kscope` child process. It defines the door map (which command backs which UI need), the call contract
> (exit codes, stdout, stderr), binary discovery and its error texts, the security posture, and the HTTP
> API the browser sees. It does **not** specify any screen, the editor, the graph, or the curation rail —
> those are PRDs 0002 and up. It does not change the `kscope` binary in any way.

**Date:** 2026-08-31
**Repository:** kleos-research/kaleidoscope-ui
**Depends on:** nothing. This is the foundation.
**Relates to:** PRD 0002 (the memory list reads the listing endpoint defined here), PRD 0003 (the editor
reads the edit-record endpoint and branches on the call envelope defined here), PRD 0006 (curation).
**Supersedes nothing.**

---

## 1. The product claim

**A browser cannot open a vault, and it should not learn how. The whole client is one prebuilt page plus a
local process that spawns `kscope` once per request — and per-request spawn is not a compromise, it is the
correct transport.**

The vault is a directory on the user's disk. The only sanctioned way to read or write it is the `kscope`
executable: a CLI that takes JSON on stdin, writes JSON on stdout, and reports what it did in its exit
code. A web page has no access to any of that. Something has to stand between them, and the only real
question is what shape that something takes.

Three shapes were considered. Two lose on capability, not on taste.

| shape | why it is not this |
| --- | --- |
| A long-lived resident process the sidecar connects to | Buys tens of milliseconds per call that this app never spends in a loop, and costs a second process lifecycle, a socket path to manage, a stale-socket failure mode, and a platform restriction. It is a cache in front of something that is already fast. |
| The binary's stdio MCP server | It publishes the two agent verbs and nothing else. The three read doors this UI is built on — listing, edit-record, health — are not reachable through it. Disqualified on capability. |
| **One child process per request** | **Chosen.** No second lifecycle, no socket, no stale state, no partial-failure mode of its own. Every request is an isolated, killable process whose entire contract is four exit codes. |

The measurement that settles it, stated the way it can be published: **a whole-vault listing, including
process spawn, is under a tenth of a second on a vault of a few hundred memories, and the entire startup
sequence — every preflight probe plus the three data loads — is a fraction of a second.** Spawn overhead is
a few milliseconds. There is nothing for a connection to amortise.

The asymmetry that makes this decisive is not speed, it is failure modes. A connection has state: it can be
half-open, stale, wedged, or serving a vault the user has since switched away from, and every one of those
is a bug the user reports as "the app is broken". A process has none of that. If a call goes wrong, the
process is dead and the next call starts clean. **For a tool whose job is to be trusted with someone's
memory, a transport with no state to corrupt is worth more than 35 milliseconds.**

It also keeps the package honest. Spawning a process needs no framework, no client library and no runtime
dependency. The sidecar is three plain files on the platform's own HTTP and process primitives, the SPA is
prebuilt, and the published package declares an empty dependency set. That is what makes `npx` viable, and
a framework runtime dependency would destroy it.

**The second claim, and it is a rule rather than a preference: listing goes through the export door and
never through ranked search.** A ranked search records that it happened. That record is permanent, it
stores the query text, and no published command reads it back or removes one. A UI that listed by searching
would write into the store it is displaying, on every load and every refresh, forever. Export writes
nothing. So the listing endpoint is backed by export, the filter box filters a payload already in memory,
and **v1 contains no caller of ranked search at all** — not disabled, not behind a flag. Absent.

## 2. What it costs to get this wrong

Each of these is a specific, cheap mistake with an expensive outcome. Every one of them is something a
competent implementer does by default.

**A wrapper that treats stderr as failure breaks on every working call.** The CLI prints a short line to
stderr, unprompted, whenever it resolved the vault address rather than being told it — which is the normal
case. It prints this **on success**. The standard convenience wrappers in most runtimes reject when stderr
is non-empty. Wired that way, the app fails on its first call, on a healthy machine, with a healthy vault,
and the failure looks like a broken binary.

**A wrapper that parses stdout as JSON mis-reports a licence problem as a crash.** When the licence gate is
shut, the exit code is 4, **stdout is empty**, and the reason is on stderr. A client that parses stdout
reports "empty response" or "unexpected end of JSON input". The user sees a broken app instead of the one
sentence that fixes it: run the activation command.

**A UI that lists by searching pollutes the store it displays.** Not once — on every load, every refresh,
every keystroke of a type-ahead. Each distinct query string is another permanent record. There is no
command to read them back and none to remove one. This is the single most plausible way to turn a
read-only browser into the largest writer the vault has.

**A missing Host check turns any page the user visits into a full read/write client of their vault.** A
remote page can point a name at the loopback address and then talk to a local server as same-origin. The
browser sends no `Origin` header on a same-origin request, so an `Origin` check does not stop it. The
`Host` header still names the attacker. Checking `Origin` and not `Host` is the exact shape of a defence
that looks complete and stops nothing.

**A token in the query string leaks through three channels at once.** Browser history, the `Referer` of any
outbound link, and every screenshot the user pastes into a bug report.

**A generic passthrough endpoint hands all of the above back.** `POST /api/call {op, payload}` is the
obvious design, takes twenty lines, and makes every rule in this document advisory: any page that gets a
token, and every future feature that finds the endpoint convenient, can reach ranked search and every
command this app deliberately does not route.

## 3. The mechanism, as designed

### 3.1 Three processes and one direction of trust

```
  BROWSER            prebuilt SPA, loaded from loopback, offline-capable.
     |               Holds a bearer token in memory. Knows no filesystem path,
     |               no process, no command name.
     |  fetch(), Authorization: Bearer <token>
     v
  SIDECAR            one local HTTP server, loopback only, ephemeral port,
     |               zero runtime dependencies. Owns the resolved binary path,
     |               the resolved vault address, the export cache, the snapshot
     |               directory, and the only code in the repository that starts
     |               a child process.
     |  spawn(binary, argv, {shell:false}); JSON payload on stdin
     v
  kscope             installed separately. Not modified by this project.
     |
     v
  THE VAULT          the sidecar never opens a file inside it.
```

Trust flows one way. The browser can ask for a named operation; it can never name a command, an argument,
a path, or a vault. The vault address is resolved once at launch and is not a parameter of any endpoint.

### 3.2 The door map

Every UI need, the command behind it, and whether it writes.

| UI need | command | writes? |
| --- | --- | --- |
| List every memory (the listing door) | `kscope call memory_lifecycle` with `{"mode":"export"}` | no |
| Load one memory **for editing** | `kscope call memory_lifecycle` with `{"mode":"lineage","memory_id":…}` | no |
| Display one memory | the record already in the listing payload | no |
| Create / edit / remove a memory | `kscope call remember` with `mode` `create` / `update` / `delete` | **yes** |
| Restore a snapshot | `kscope call memory_import` | **yes** |
| Vault health and fold state | `kscope call doctor` with `{"mode":"inspect"}` | no |
| The workspace `memory_type` vocabulary | `kscope call ontology` with `{"mode":"read"}` | no |
| The write contract and its closed vocabularies | `kscope schema remember` | no |
| Which operations this build has | `kscope schema` | no |
| Limits, error codes, retired operations | `kscope public-contract` | no |
| Is `call` licensed on this machine | `kscope gate` | no |
| Which vault is resolved, and from where | `kscope where` | no |
| Is the embedding model present | `kscope model` | no |
| **Ranked search** | `kscope call search` with `{"query":…}` | **YES — not routed in v1** |

**Listing goes through the export door and never through ranked search.** Export returns the whole vault,
unpaginated, and returns it fast enough to do on load at the sizes this app is for. Ranked search returns a
ranked subset and *records that it happened*: the record is permanent, it stores the query verbatim, and
`ledger:false` is refused, so there is no read-only mode of it. Filtering, sorting and counting are done in
the browser against a payload already fetched. The distinction is enforced in code, not in copy — see R6.

Two further notes the implementer needs and will otherwise rediscover expensively:

- **The listing door is a superset of the exact-read door, and the exact-read door is not sufficient for
  the editor.** The record needed to write an update includes the memory's entity declarations, and the
  edit-record door is the one that carries them. A client that round-trips what the exact-read door returned
  would silently drop them on save. The editor loads through `lineage`, every time, uncached. PRD 0003 owns
  the consequences; this PRD owns the endpoint that makes the wrong door unreachable.
- **The address-maintenance command is not a curation surface and is not routed at all, in any mode.** Its
  write modes report success and leave the memory they name unchanged. Any merge this product offers, it
  implements itself out of an update and a removal, and says so.

**Not routed, deliberately:** ranked search; address maintenance in any mode; the ontology write modes; the
consolidation sweep; vault destruction; feedback. Vault destruction is *printed* for the user to run
themselves and never executed by a button.

### 3.3 The call contract

This is the part of the document with the highest cost of being wrong, so it is stated as a protocol rather
than as advice.

**Exit codes are the protocol. There are four, and they are the only thing the client branches on.**

| exit | meaning | stdout | stderr |
| --- | --- | --- | --- |
| **0** | **applied** | the result envelope, JSON | may carry the address-resolution line |
| **2** | **refused** | a **JSON refusal envelope** — `status`, `code`, `message`, and usually `next` | may carry the address-resolution line |
| **3** | **applied in part** | an envelope carrying **per-item `results`** | may carry the address-resolution line |
| **4** | **refused for licensing** | **EMPTY** | the human message, ending in a machine-readable refusal trailer |

Four rules follow, and all four are non-negotiable:

1. **Branch on the exit code, never on stderr.** Every command that *resolved* the vault address rather
   than being told it prints the resolution to stderr, unprompted, **on success**. Non-empty stderr is the
   normal case for a working call. stderr is captured, attached to the envelope for display in the app's
   own diagnostics, and consulted for exactly one decision: nothing.
2. **Exit 2 is data, not an outage.** A refusal is a JSON envelope on **stdout**, it names what to fix, and
   it frequently says so in as many words. The UI renders it. It is not an error dialog and it is not a
   log line.
3. **Exit 3 is not success.** Per-item `results` must be surfaced per item. A client that collapses a
   partial batch into "Saved" tells the user their work landed when some of it did not. The same principle
   applies inside a single successful write: **a write can report that it applied and still name work it
   declined to store**, in a key that is *omitted entirely when it declined nothing*. Reading that key on
   every write is PRD 0003's requirement; this PRD's requirement is that the sidecar passes the engine's
   response through **whole**, so PRD 0003 can.
4. **Exit 4 must never be parsed as JSON.** stdout is empty by design. Parse the reason out of stderr,
   classify it by the trailer, and route it to the licence screen. A "malformed response" error here is a
   support ticket about the wrong thing.

**Any exit code that is not 0, 2, 3 or 4 is a hard error.** It is never mapped onto the nearest known one,
never treated as a refusal, and never treated as success. It surfaces as an engine fault naming the code.

**The uniform envelope.** Every routed operation returns the same JSON shape to the browser, so no screen
invents its own branching:

```json
{
  "outcome": "applied",
  "exit_code": 0,
  "data":     { "…": "the engine's response, passed through whole" },
  "results":  null,
  "refusal":  null,
  "reason":   null,
  "provenance": "the address-resolution line, if the call printed one",
  "duration_ms": 84
}
```

`outcome` takes exactly `applied` (0), `refused` (2), `applied_in_part` (3), `unlicensed` (4). `data` is
populated on 0 and 3; `results` on 3; `refusal` on 2; `reason` on 4. **`data` is never reshaped, filtered
or renamed** — the one exception is the listing endpoint, which strips the large derived fields (§3.7).

**HTTP status describes the sidecar; the envelope describes the engine.** A refused call is a completed
call, so it is HTTP 200 with `outcome: "refused"`. Non-200 is reserved for the sidecar's own failures:
authentication, an unknown route, a binary that could not be spawned, a call that exceeded its timeout.
This is deliberate — a UI that has to distinguish "the engine said no" from "the app is broken" should not
have to do it by reading a status code that conflates them.

**Timeout and retry.** Every call carries a timeout (default 30 seconds, longer for the listing call on a
large vault). A timed-out child is killed and the request returns HTTP 504. **A write is never retried
automatically.** A retried write is a second write, and the second one will be refused for a stale version
if the first landed — which is the good case; the bad case is that it did not land and the user cannot tell
which happened. Retry is the user's decision, made in front of a message that names the situation.

**Concurrency.** Reads may run concurrently up to a small cap. Writes are serialised: at most one `remember`
or `memory_import` child at a time, per sidecar. The listing call is single-flighted — concurrent requests
for it share one child process rather than starting several.

### 3.4 Binary discovery

The search order is not invented here. It already exists in the other clients that locate this engine, and
two clients that disagree about where the engine is are two clients that behave differently on the same
machine. **This app is the fourth client and copies the order:**

1. an explicit `--kscope <path>` passed on the command line;
2. the `KALEIDOSCOPE_ENGINE` environment variable, ignored when set but empty;
3. the directory this runtime installs its own executables into — for Node, the directory containing the
   running Node executable, which is where a global npm install puts its shims;
4. each directory on `PATH`, in order.

**Steps 1 and 2 are authoritative and terminal.** If either names something unusable, the search *stops and
reports that*. It must never fall through and serve a different program: "I found something else" is the
failure that cannot be debugged from the outside.

**Canonicalise before validating, then execute the canonical path.** Resolve symbolic links, then check it
is a regular file and executable. **Symlinks must be accepted** — a global npm install installs every
executable as a symlink, so a resolver that refuses them refuses the documented install channel.

**See through the launcher.** If the resolved file is a script whose first bytes are `#!` and which names
the engine's npm package, ask that package for the real executable path and spawn *that*. Going through the
script costs a full runtime startup on every single call — an order of magnitude more than the call itself.

**Print the resolved absolute path and the engine version in the app's own header, permanently.** Anything
earlier on `PATH` named `kscope` receives the user's entire vault on stdout and can write whatever it
likes. Showing the path is most of the defence: a user who sees a path in a temporary directory knows.
Beyond showing it, **refuse to run a binary outside a small allowlist of install prefixes unless `--kscope`
was passed explicitly.**

**The three error texts are deliverables, not afterthoughts.** Each names what it looked for, everywhere it
looked, the one install command, the override, and what happened to the user's data.

*Nothing found:*

```
Kaleidoscope is not installed, or is installed somewhere this search did
not reach: the kscope program could not be found.

Install it with:

    npm install -g @kleos-research/kaleidoscope

then check it with `kscope --version`.

If it is already installed elsewhere, set KALEIDOSCOPE_ENGINE to its
full path, or start this with --kscope <path>.

Looked for kscope in:
  - the KALEIDOSCOPE_ENGINE setting, which is not set
  - /Users/you/.nvm/versions/node/v22.14.0/bin (beside the Node running this)
  - /opt/homebrew/bin (on PATH)
  - /usr/local/bin (on PATH)
  - … and 14 more directories on PATH

Nothing was read, written or changed. This tool only reads and edits an
existing vault; it never creates one.
```

There is **one** install command, because both programs come from the same package. Do not invent a second.

*Step 1 or 2 named something unusable* — a different message, because the remedy is the opposite:

```
Kaleidoscope could not use the kscope program at /opt/kaleidoscope/bin/kscope.
It was named by KALEIDOSCOPE_ENGINE, so nothing else was tried.
That path must be an existing file you have permission to run.
Your local vault data is intact and unchanged.
```

*Found, but the licence gate is shut* — the case a one-shot CLI does not have and a long-running app does:

```
kscope 0.0.5 is installed at /opt/homebrew/bin/kscope, but this build
requires an alpha key and none was found.

    kscope activate <KEY>

`kscope call` is the only door this tool has, so nothing can be listed or
edited until that succeeds. Ask the alpha owner for a key if you do not
have one. Your vault is untouched.
```

That state is exit 4 with empty stdout. It is detected in the preflight, in a few milliseconds, rather than
discovered half-way through an edit.

### 3.5 Preflight, and what stops the launch

At startup, one batch of short-lived child processes establishes everything the app needs to know about the
machine it is on: the engine version, whether `call` is licensed here, the operation index, the limits and
retired operations, the raw bytes of the write contract, whether the embedding model is present, and which
vault is resolved and from where.

**Compatibility keys on a digest of the write contract's own output, never on the version string.** Two
builds one patch apart can render that contract differently while the version string says "compatible", and
that text is where the closed vocabularies live — so a parser that silently degrades produces a control
missing values, which is how a hardcoded vocabulary sneaks in through the back door. The sidecar computes
`sha256` over the contract bytes and reports it, with a tier:

- **Tier C — known digest.** Full function. Vocabulary parses are cached **keyed by the digest**, so
  upgrading the engine invalidates the cache automatically and staleness is impossible.
- **Tier B — unknown digest.** Reads stay fully functional; closed-value controls degrade to free text with
  an unverified hint, under a persistent banner naming both digests. **It never falls back to a vocabulary
  compiled into this app.** That would be a transcription, and a transcription drifts silently.
- **Tier A — hard stop, read-only.** An unrecognised contract version, or a required operation missing from
  the operation index or listed as retired. Show the readings; refuse every write; never guess.

**Three conditions stop the launch outright** rather than degrading: the licence gate does not permit
`call`; the embedding model is not reported as bundled; the tier is A. The first two are full-stop screens
because a partly-working memory tool is worse than one that says what is wrong.

Everything the preflight needs is outside the licence gate, so the gate check itself always runs.

### 3.6 Security

The sidecar is a local HTTP server with total read and write access to the user's most sensitive local
data. The engine's own resident mode uses an owner-only socket with no TCP listener at all, so **the entire
network attack surface of this product is ours.** All of the following, not a subset.

**Bind.** `127.0.0.1` explicitly. Never `0.0.0.0`, never `::`. An OS-assigned ephemeral port; `--port` to
pin one. There is no `--host` flag: the vault is the user's memory and there is no authentication layer to
put in front of it.

**Host check — first, before routing.** Reject unless the `Host` header is exactly the loopback form for
the port actually bound (`127.0.0.1:<port>` or `localhost:<port>`). Anything else: 403, no body, connection
closed. **This is the rebinding defence, and an `Origin` check is not**, because same-origin requests carry
no `Origin` at all.

**Origin and fetch-metadata — second.** If `Origin` is present it must match; `null` is rejected.
`Sec-Fetch-Site` outside `same-origin` / `none` is rejected. `Sec-Fetch-Mode: no-cors` is rejected — that is
the image-tag and form-post shape.

**Token.** 32 random bytes, base64url, minted per launch, never persisted, never written to a file.
Delivered in the launch URL **as a fragment** — a fragment is never sent to a server, never appears in
`Referer`, and never appears in server logs. The page reads it from the fragment, holds it in memory, and
immediately rewrites the URL to remove it. Every API request carries it in an `Authorization: Bearer`
header. **Header-only, and never a cookie:** a header cannot be set by a form post or an image tag, which
alone defeats simple-request forgery, whereas a cookie is attached automatically and reintroduces it.
Compared in constant time. Missing or wrong: 401, no body.

**No CORS header is ever sent, and `OPTIONS` is rejected.**

**Response hygiene.** `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. API responses are
`application/json` and never `text/html`. The CSP is also what *enforces* the offline claim: no CDN, no
remote fonts, no telemetry, no update check — asserted in a header rather than in a README.

**What the sidecar refuses outright:**

- any request whose `Host` is not the loopback form — before routing;
- any request without a valid bearer token — before routing;
- **any request naming a vault root.** There is no `root` parameter on any endpoint. The vault is fixed at
  launch. This is the difference between a memory browser and an arbitrary local-file reader;
- any request that would put user-controlled text into a shell. The engine is spawned with an argument
  vector and `shell: false`, with the payload on **stdin** — never a concatenated command string;
- any command not in the routed set (§3.2), including ranked search;
- any path outside the API surface and the packaged static assets. No directory listing, no serving from a
  user-supplied path.

**Lifetime.** The sidecar exits 60 seconds after the last browser client stops heartbeating, and on an idle
timeout. A forgotten tab must not leave a write-capable server running for a week.

### 3.7 The API the browser sees

Every endpoint requires the bearer token. Every response is JSON. Requests and responses are as follows;
"envelope" means the uniform shape in §3.3.

| method | path | request body | response |
| --- | --- | --- | --- |
| `GET` | `/api/session` | — | the preflight readings (below) |
| `GET` | `/api/memories` | — (`?refresh=1` forces a re-export) | the listing payload (below) |
| `GET` | `/api/memories/:memory_id/lineage` | — | envelope; `data` is the edit record |
| `POST` | `/api/memories` | `{content_md, semantic_delta}` or `{items:[…]}` | envelope |
| `PUT` | `/api/memories/:memory_id` | `{expected_version_id, content_md, semantic_delta}` | envelope |
| `POST` | `/api/memories/:memory_id/removal` | `{expected_version_id}` | envelope |
| `GET` | `/api/health` | — | envelope; `data` is the health reading |
| `GET` | `/api/vocabulary` | — | `{tier, digest, verified, values:{…}}` |
| `GET` | `/api/snapshots` | — | `{snapshots:[{id, label, taken_at, bytes, memory_count}]}` |
| `POST` | `/api/snapshots` | `{label}` | `{id, label, taken_at, bytes, memory_count}` |
| `POST` | `/api/snapshots/:id/restore` | — | envelope |
| `GET` | `/api/heartbeat` | — | `text/event-stream`; keeps the sidecar alive |
| `GET` | `/`, `/assets/*` | — | the packaged SPA, from the package only |

`GET /api/session`:

```json
{
  "engine":   { "path": "/opt/homebrew/bin/kscope", "version": "…", "resolved_by": "PATH" },
  "gate":     { "call_permitted": true },
  "contract": { "digest": "…", "tier": "C", "schema_version": "…",
                "limits": { "…": "read from the engine, never hardcoded" } },
  "model":    { "status": "bundled" },
  "vault":    { "root": "…", "root_source": "…" },
  "app":      { "version": "…", "started_at": "…" }
}
```

Every value here is a *reading*, taken from the engine at launch and displayed permanently in the app's
footer. A number in this product carries the evidence that the thing it measures was switched on.

`GET /api/memories`:

```json
{
  "fetched_at": "…",
  "memory_count": 0,
  "stripped_fields": ["…"],
  "memories": [ { "memory_id": "…", "version_id": "…", "content_md": "…", "semantic": { } } ]
}
```

**The sidecar strips the large derived fields from every record before the payload leaves the process.**
Nothing in the browser reads them, they are a substantial fraction of the bytes, and shipping them across
the loopback interface and into a browser heap costs on every load. Stripping one of them is not enough —
there is more than one field of comparable size — so the sidecar strips the set and **reports the keys it
removed in `stripped_fields`**, computed from what it actually dropped rather than written down. A test
asserts that no stripped key appears anywhere in the response.

The listing payload is cached in the sidecar and re-fetched only on `?refresh=1`. Refresh is a user
decision: `GET /api/health` is cheap and non-writing, so the app polls *that* to notice the vault has
moved, and shows a badge that fetches nothing until the user asks. A list that reorders under a reading
user is hostile, and this store genuinely gains memories mid-session.

**Endpoints that do not exist, and their absence is the design:**

- **no `POST /api/call`** — no generic passthrough. The table above is the allowlist. Adding an operation
  means adding a route, in a diff a reviewer can see;
- **no search endpoint of any kind** in v1;
- **no `root`, `path`, `profile` or `vault` parameter on any endpoint;**
- **no endpoint reaching address maintenance, ontology writes, the consolidation sweep, or vault
  destruction.**

## 4. Requirements

**Transport and the call contract**

- **R1.** All process spawning lives in exactly one module. Nothing else in the repository imports the
  runtime's process module; a lint rule fails the build on a second importer.
- **R2.** The engine is spawned with an argument vector and `shell: false`, with the JSON payload written to
  the child's stdin. No user-supplied text is ever concatenated into a command string.
- **R3.** The client branches on the exit code only. A test drives a successful call that emits an
  address-resolution line on stderr and asserts the call is reported as applied.
- **R4.** Exit 0 → `applied`; 2 → `refused`, with the refusal envelope parsed from **stdout**; 3 →
  `applied_in_part`, with per-item `results` preserved; 4 → `unlicensed`, with **stdout never parsed** and
  the reason taken from stderr. Four tests, one per code.
- **R5.** Any other exit code produces a distinct engine-fault outcome naming the code. It is never mapped
  onto a known outcome. A test asserts this against a stub that exits 1.
- **R6.** The repository contains no caller of ranked search. Enforced three ways: the client module
  exports no generic `call(op, payload)`; a lint rule forbids importing one; and a test drives the entire
  browse, open, edit and remove flow against a scratch vault and asserts the vault's search-record count is
  **identical** before and after.
- **R7.** The engine's response body is passed through whole on every routed operation, with no key
  filtered, renamed or reshaped — except the listing endpoint's declared strip (R17). A test compares the
  endpoint's `data` against the raw stdout of the same call.
- **R8.** No write is ever retried automatically. A test asserts that a timed-out or failed write produces
  exactly one child process.
- **R9.** At most one write-class child process runs at a time per sidecar; the listing call is
  single-flighted across concurrent requests.

**Binary discovery**

- **R10.** Resolution follows the four steps in §3.4, in that order, with steps 1 and 2 terminal. A test
  asserts that an unusable path in step 1 or 2 produces the terminal error and that step 3 is never tried.
- **R11.** The candidate is canonicalised before validation and the canonical path is what is executed.
  **A symlinked executable resolves successfully** — a test asserts it, because refusing symlinks refuses
  the documented install channel.
- **R12.** When the resolved file is a launcher script naming the engine's npm package, the sidecar
  resolves past it to the real executable and spawns that.
- **R13.** The three error texts in §3.4 ship as written, each naming what was looked for, everywhere it
  looked, one install command, the override, and the state of the user's data. Snapshot-tested.
- **R14.** The resolved absolute binary path and the engine version appear in the app's own header for the
  whole session, and a binary outside the install-prefix allowlist is refused unless `--kscope` was passed.

**Preflight and compatibility**

- **R15.** Launch stops with a full-stop screen, not a degraded mode, when `call` is not licensed, when the
  model is not reported as bundled, or when the compatibility tier is A.
- **R16.** Compatibility keys on the digest of the write contract's bytes and never on the version string.
  Vocabulary caches are keyed by that digest. **No vocabulary value is compiled into this app**; a CI check
  fails on any source file containing a literal from the contract's closed lists, and **fails rather than
  skips** when the engine is absent on the runner.

**The API**

- **R17.** `GET /api/memories` strips the large derived fields and reports the removed keys in
  `stripped_fields`. A test asserts no stripped key appears anywhere in the response body.
- **R18.** The editor's load path is `GET /api/memories/:memory_id/lineage`, uncached, and it is the only
  endpoint that can supply a record to an update. A test asserts the entity-declaration count of a memory
  is unchanged after a load-edit-save round trip through the API.
- **R19.** There is no generic passthrough endpoint. A test enumerates the routes and asserts the set
  equals the table in §3.7.
- **R20.** No endpoint accepts a parameter naming a vault, a root, a profile or a path. A test fuzzes every
  endpoint with such parameters and asserts the resolved vault never moves.
- **R21.** HTTP status describes the sidecar; a refused engine call is HTTP 200 with `outcome: "refused"`.
  Non-200 is reserved for auth, unknown routes, spawn failure and timeout.

**Security**

- **R22.** The listener binds `127.0.0.1` on an ephemeral port by default. Test: `test_binds_loopback_only`.
- **R23.** The `Host` header is checked before routing and before authentication; anything but the loopback
  form gets 403 with no body. Test: `test_rejects_foreign_host`.
- **R24.** `Origin`, when present, must match; `null` is rejected; `Sec-Fetch-Site` outside
  `same-origin`/`none` is rejected; `Sec-Fetch-Mode: no-cors` is rejected. Test:
  `test_rejects_origin_null`.
- **R25.** A 32-byte random bearer token is minted per launch, never persisted, delivered in the launch URL
  **fragment**, stripped from the URL by the page on load, sent only in an `Authorization` header, never in
  a cookie or a query string, and compared in constant time. Tests: `test_rejects_no_token`,
  `test_token_never_in_query_or_cookie`.
- **R26.** No `Access-Control-Allow-Origin` header is ever emitted and `OPTIONS` is rejected. Test:
  `test_no_cors_header` asserts absence on every response.
- **R27.** The CSP, `X-Content-Type-Options` and `Referrer-Policy` headers in §3.6 are present on every
  response.
- **R28.** The routed command set is exactly the one in §3.2. Ranked search, address maintenance in any
  mode, ontology writes, the consolidation sweep and vault destruction are unreachable from any request.
  Test: `test_unrouted_commands_are_unreachable`.
- **R29.** The sidecar exits 60 seconds after the last heartbeat stream closes, and on idle timeout.
- **R30.** The published package declares an empty runtime dependency set, ships a prebuilt SPA, and has no
  install hook of any kind. A release test installs the packed tarball into a scratch directory and runs it
  against a synthetic vault — the only test that catches a wrong file allowlist, which is the most common
  way a prebuilt package ships broken.

## 5. What is not delivered, in order of what it costs

**No ranked search, and therefore no way to ask "why did the agent retrieve this?".** This is the largest
gap and it is chosen. The answer available today is a *re-run*, not a record: it re-executes retrieval now
and writes a permanent record of having done so, into a store nothing can read back or clean up. Cost: the
one honest debugging question about retrieval stays unanswerable in v1. Leaving it out makes R6 trivially
enforceable — zero callers — which is the strongest possible position from which to add exactly one caller
later, behind its own consent screen.

**No incremental or filtered listing.** The listing door returns the whole vault every time. That is right
for the sizes this app is for and stops being right well before a vault reaches six figures. Cost: on a
large vault the first load is slow and the sidecar holds a large payload. Mitigation now: the listing lives
behind an interface from the first commit, so a paginated door or a different strategy can replace it
without touching a screen. This PRD does not specify that replacement.

**No connection reuse, so a pathological workload pays spawn cost per call.** The app does not have such a
workload — it makes a handful of calls per user action — but a future feature that calls in a loop would
feel it. Cost: an implementer who writes a loop over per-memory calls will find it slow. That is arguably a
feature; batch shapes exist and the loop should be a review comment.

**No multi-vault view.** The vault is fixed at launch. Switching vaults means restarting the sidecar. Cost:
a user with several vaults restarts. This is deliberate — a `root` parameter is the difference between a
memory browser and an arbitrary local-file reader, and there is no version of it that is safe to expose to
a page.

**No static-file export of a vault view.** Handing someone a self-contained page rendered from one payload
is nearly free given this architecture and is the honest way to share a picture of a vault without sharing
the vault. It is not in this PRD because it is a launcher flag over a rendering concern, and it belongs
with the screens.

**No authentication beyond the per-launch token.** On a shared machine the loopback interface is reachable
by every local user, which is exactly why the token is mandatory rather than belt-and-braces. There is no
password, no account, and no remote access. Cost: none for the intended single-user local case; total for
any other case, which is the intent.

## 6. What would falsify this

**The claim in §1 is that per-request spawn is the correct transport, not merely an adequate one.** These
observations would show it wrong:

1. **A startup that is not fast enough at a size real users hold.** If, on a vault a user actually has, the
   preflight plus the first listing takes long enough to need a progress bar with stages, the argument that
   there is nothing for a connection to amortise has failed. Measure the whole cold start, not one call.
2. **A user action that needs many calls.** The design assumes a handful of calls per action. If a screen
   in a later PRD genuinely needs a call per memory, spawn cost becomes the dominant term and a resident
   connection stops being a cache in front of something fast.
3. **The exit-code protocol turning out not to be stable.** If a build is observed writing a refusal to
   stderr instead of stdout, or returning a non-empty stdout on a licensing refusal, or using an exit code
   outside the four, then §3.3 describes one build rather than a contract, and the client must be re-derived
   against the published surface rather than against this document. R5 exists so that this is discovered
   loudly rather than absorbed silently.
4. **An engine door that makes listing-by-search cheap and non-recording.** If a read-only ranked query ever
   becomes available, the sharpest rule in this document — listing never goes through ranked search — stops
   being about correctness and becomes about performance, and the filter box could become a real search box.
5. **A security control that proves unimplementable in a real browser.** If the fragment-delivered token
   cannot survive the page's own navigation, or if a supported browser omits fetch-metadata headers such
   that a legitimate request is rejected, the posture in §3.6 needs revision — but the direction of any
   revision is "add a control", never "drop one".
