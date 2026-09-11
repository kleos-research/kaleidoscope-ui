# Security

## Reporting something

Please report privately rather than in a public issue.

Use GitHub's private vulnerability reporting on this repository — **Security → Report a
vulnerability** — which opens a draft advisory only the maintainers can see.

Email: `<security contact to be filled in by the maintainer>`

Tell us what you did, what happened, and what you expected instead. A proof of concept helps and a
patch is welcome, but neither is required. You will get an acknowledgement, and we will tell you
what we find whether or not it turns out to be a defect.

Please do not include memories, entity names, screenshots or any other content out of a real vault
in a report. Describe the shape of the data instead; if a reproduction genuinely needs a vault, say
so and we will agree a way to handle it.

## The threat model

This is a single-user tool that runs on the machine it serves, and its whole posture follows from
that:

- The server binds to loopback only, so nothing on the network can reach it.
- Every request carries a bearer token minted fresh on each launch and handed over in the URL
  fragment, which a browser never puts on the wire.
- The `Host` header is checked against an allowlist, so a name that resolves to `127.0.0.1` cannot
  be used to reach the server from a page you did not open.
- No CORS header is ever sent, so no other origin's script can read a response.

## Out of scope

**The engine is not this repository.** `kscope` — the program that actually stores and reads your
memories — is a separate, closed-source product that you install yourself. It has its own reporting
path, and **this repository cannot accept, triage or fix reports about it**. If what you found is in
the engine, please report it there; if you cannot tell which side of the line it falls on, report it
here and we will route it.

Also out of scope, because they are the design rather than a defect in it:

- Anyone who already has your user account on the machine. A local tool cannot defend against
  someone who can read the vault directory, the process list, or your browser's memory directly.
- Removing a memory hides it from your agent; the text stays in the vault on disk. The app says so
  before you press. A secret that reached a memory must be rotated, not deleted.
