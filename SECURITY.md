# Security

## Reporting a problem

Please report security problems privately: open the **Security** tab of this
repository and press **Report a vulnerability**. Do not open a public issue
for them.

This is a personal project, maintained in spare time. Replies are
best-effort, but every report gets read.

## How Corella is meant to be run

Corella is local-only by design:

- The server listens on `127.0.0.1` only, never on a network address.
- Every page, API call and the live connection need a login token. The server
  prints a link with it at start; the token lives in a private file in the
  data folder.
- The live connection checks where a page came from, so another website open
  in your browser cannot drive it.

The agents it starts run as you, with your files. That is the point of a
coding agent, so treat Corella like a terminal: do not put it on a network.

## In scope

- Another website, or a page in your browser, reaching the API or the live
  connection.
- Another user on the same machine using Corella without the token.
- Getting past the login token, the Origin check, or the framing block.
- An agent's permission prompt being answered without you, beyond what you
  set it to auto-approve.
- Corella leaking the token, conversations or provider settings.

## Out of scope

- Anything that needs Corella exposed to a network, against the advice above.
- A program already running as your user. It can read the token file and your
  files anyway.
- What an agent does once you allow it. Its own safety is the agent's job.
- Bugs in the agents themselves (Kiro CLI, Claude Code, and so on).
