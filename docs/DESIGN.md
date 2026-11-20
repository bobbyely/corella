# Corella — Design

**Status:** implemented, and amended where reality disagreed
**Last updated:** 2026-09-10

This is the *why*. It has been amended in place where building it proved a
detail wrong — the `events` primary key is the clearest case. Protocol facts
learned since have moved to [PROTOCOL.md](PROTOCOL.md); the rules that came out
of all this are in [AGENTS.md](../AGENTS.md).

## Goal

A browser chat UI with the ergonomics of Claude Code / Codex desktop apps —
streaming output, real markdown and code rendering, tool-call and diff views,
and every past session searchable — driven by Kiro CLI and, ideally, any other
CLI coding agent.

## Constraints

1. **Kiro is only on a work machine.** Development happens on a personal Linux
   box without it. The app must be buildable and testable against a different
   agent, and switch to Kiro by configuration, not code.
2. **macOS and Linux first-class**, Windows best-effort.
3. **Localhost only** in v1. This process spawns things that execute commands.

## The key finding: ACP

There is an emerging standard for exactly this problem — the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP), deliberately
"LSP, but for coding agents". **JSON-RPC 2.0 over stdio** to a subprocess.

**[Kiro CLI speaks it natively](https://kiro.dev/docs/cli/acp/):** `kiro-cli acp`.

This removes the largest risk in the project. We do not parse CLI output, strip
ANSI, or wrap a PTY. We speak a documented protocol and get structured
streaming, tool calls, permission requests and session loading for free.

It also answers "can this work with any agent?" — Gemini CLI is native, Claude
Code and Codex have adapters. Supporting a new agent is a config entry naming
a command, not a new parser.

```
 browser (React + Vite)
        │  WebSocket — our own small message set
        ▼
 server (Node + TypeScript)          ← implements the ACP *Client* role
   ├─ SessionManager ── Session ── SQLite (append-only events)
   │                       │
   │                       │  JSON-RPC 2.0 over stdio
   │                       ▼
   │                  agent subprocess  (`kiro-cli acp`)
   │
   └─ TerminalRegistry ── child processes the agent asked us to run
```

Note the server is the **ACP client**. Normally that role is played by an
editor; here it is played by a web server, and the browser is its front end.
That mapping is what makes tool-approval UX fall out of the protocol instead of
being invented.

## Key decision 1 — the event log is the source of truth

Every session is an **append-only log of typed events**. The server appends;
the browser is a pure renderer of the log plus a live tail.

Everything good falls out of this one choice: refresh mid-turn and lose
nothing, restart the server and resume, two tabs on one session, scrollback
search, replay for debugging. The alternative — holding authoritative state in
React — makes each of those a separate feature bolted on later, badly.

**Append-only is a discipline, not a file format.** We store it in SQLite.

## Key decision 2 — SQLite, built into Node

Node 22 ships `node:sqlite` with no flag and no native module, with FTS5
compiled in (verified on the dev machine). That removes the usual reason to
reach for flat files, and one store beats two stores that must be kept in sync.

```
Linux   $XDG_DATA_HOME/corella/corella.db  (~/.local/share/…)
macOS   ~/Library/Application Support/corella/corella.db
```

```sql
CREATE TABLE sessions (
  id               TEXT PRIMARY KEY,   -- ours
  agent_session_id TEXT,               -- the agent's, for session/load
  provider         TEXT NOT NULL,      -- 'kiro' | 'claude-code' | …
  cwd              TEXT NOT NULL,
  title            TEXT,
  status           TEXT NOT NULL,      -- 'draft' | 'active' | 'closed'
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- seq is per-session, not global: it is what the wire protocol resumes from,
-- so it is the key rather than a rowid we would have to translate.
CREATE TABLE events (
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL   -- JSON: the ACP update or our own event
  , PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;
```

`events` is INSERT-only — never UPDATE, never DELETE. `sessions` is a derived
index that could be rebuilt by replaying `events`, which means a corrupt or
schema-changed index is a rebuild, not a migration.

`seq` is the resume mechanism: the browser reconnects saying "I have up to
412", the server runs one query for everything after. That is the whole of
reconnect.

**Do not write a row per token.** A turn emits thousands of
`AgentMessageChunk` deltas; buffer in memory and flush a coalesced row every
~250ms.

**Two stores exist, and that is fine.** The agent keeps its own conversation
state where we cannot see it; we persist its `sessionId` so `session/load` can
re-hydrate it. Ours is the UI's truth, the agent's is the model's.

## Key decision 3 — never hardcode providers or models

`session/new` returns the agent's available models and modes. Newer ACP
generalises this to `configOptions`: a list of `{id, name, category, type,
currentValue, options[]}` that the client renders as selectors, changeable at
any point in a session.

So the composer's pickers are **data-driven**. We render whatever the agent
advertises and send back `session/set_config_option` (falling back to
`session/set_model` / `session/set_mode` for agents on the older API, which is
what Kiro currently documents). One agent exposes models, another exposes
reasoning level — same UI code, no per-agent branching.

*Provider* is the exception: it is which binary to spawn, which is our config,
not the protocol's.

## Key decision 4 — a provider switch is a handoff, in place

There is no ACP session transfer, so moving a conversation to another
provider means a new agent with the transcript as context. Two choices fell
out of the invariants:

- **The `Session` object survives; the agent under it changes.** Sockets and
  the room and schedule code subscribe to the object, so replacing it would
  leave every watcher on a corpse. `switchProvider` brings the replacement
  all the way up — spawn, `initialize`, `session/new` — before the old agent
  is touched, and puts the old one back if that fails. The retired process
  exits *after* the switch, so the exit handler must check the process is
  still the session's.
- **The handoff text is derived, not stored.** The log holds a
  `provider_switched { from, to, throughSeq }`; `handoffText` in `shared`
  turns the events up to `throughSeq` into the prose sent, and the browser
  runs the same function to show it under the divider. Storing the text would
  be a second copy of the transcript; hiding it would be a prompt nobody can
  debug. It goes with the person's next message rather than as a turn of its
  own, which would cost a reply of filler.

The budget is a character count with the oldest messages dropped whole and
said so. Corella has no model of its own to summarise with, and a hidden
summary would be the browser-state mistake in another form.

## Session lifecycle

Only providers that passed their setup check (below) are offered.

```
new chat
  → pick provider           → spawn subprocess, `initialize`
                            → `session/new {cwd, mcpServers}`
                            → returns sessionId + config options
  → composer shows pickers  → `session/set_config_option` on change
  → first message sent      → session promoted draft → active, persisted
  → `session/prompt`        → stream session/update → append events → WS
  → later: reopen           → `session/load` re-hydrates the agent
```

**The other way in: adoption.** Where an agent keeps conversations of its own,
`session/list` offers them and choosing one calls `session/load` against a
freshly minted Corella conversation. Listing is an HTTP endpoint rather than
a socket message because it happens before any conversation exists — there is
nothing to stream, and it needs its own short-lived probe agent, which is
exactly the shape of the check ladder. Adopting *is* a socket message, because
it produces a live session and those belong to `SessionManager`.

This is the one place `session/load`'s replay is appended rather than
discarded: our log is empty, so the replay is the transcript. An `adopted`
event marks the seam, and every later reopen is an ordinary resume, so the
history is captured exactly once. See
[PROTOCOL.md](PROTOCOL.md#an-adopted-conversation-is-the-one-case-where-the-replay-is-kept).

**The wrinkle:** models are only known *after* `session/new`, so the picker
cannot be populated before a session exists. Hence **draft sessions**. The app
opens on a new chat with the agent, folder and settings last used, and starts
that agent at once (`open` with `draft: true`), so the pickers fill and the
first message goes without a wait. A draft writes nothing: its events are held
in memory and it is not listed. The first message sent promotes it — the held
log is written, then the row — at the moment the message is queued, not when
its turn runs, so a page that sends and closes its socket at once cannot lose
it. A draft nobody is viewing any more (another chat opened, the tab closed)
is closed by `SessionManager.view`, leaving no trace.

Each `open` carries a `requestId`. A socket has a view generation
(`SocketView.generation` in `ws.ts`), bumped by every `open`, `adopt`,
`subscribe` and `resume`; a handler that awaits takes it first and checks it,
and the socket's `closed`, before it watches or answers. So a slow start or
resume the reader has left is never shown: a superseded draft is closed when
it comes up, and a late resume cannot take the socket from the chat on screen.
A start's failure carries its `requestId`, and the page acts only on the start
it is waiting for; a failure ends that start, and the next Enter begins a new
one.

**The server never holds an unsent message.** Enter before the agent is up
leaves the text in the box, read-only, under "Sends when <agent> is ready"
with a Cancel, and records the start it waits on (`firstMessage.ts`). When
that exact start's `session_opened` arrives, the composer sends it as an
ordinary prompt and clears the box. Anything else — a new folder or agent, a
failed start, a dropped socket (the page reopens with a new id), another
chat, a reload — sends nothing and leaves the words in the box; the new
chat's text is kept in `localStorage`, so a reload brings it back. An earlier
version held the message on the server; every way that could go wrong (a lost
acknowledgement sending it twice, a failure with nobody to give it back to)
came from there being two copies, so now there is one.

**Settings the agent offers only as a slash command** (Kiro's `/effort`) are
sent as *quiet* turns: a prompt with `quiet: true` runs as an ordinary turn,
and its `user_message` carries `quiet`. The browser hides that turn and the
agent's answer; it does not name the chat, does not count as working, and does
not promote a draft. Errors, permission prompts and questions are the
exception: they stay visible, and a quiet turn waiting on one counts as working,
so it can be answered or stopped. An opening that is only a slash command is sent quietly
the same way, which is how the effort picker's last choice reaches every new
chat. The log still holds it — nothing is hidden from the record, only from the
transcript.

## Schedules: a timer over ordinary sessions

A schedule is a saved prompt, a provider, a directory and an interval (or a
clock time, optionally weekdays only). Nothing about it is a new kind of
conversation: a run is `open` → `prompt` → wait for the turn → `detach`, the
same calls the socket makes on a person's behalf, and the transcript is an
ordinary session tagged with the schedule's id so the sidebar can group it.
That follows from invariant 4 — the server owns turns, so nothing here needs
a browser — and it means every feature a conversation has (resume, export,
search, the Changes pane) works on a run for free.

What the scheduler adds is the **record of what happened when a run could not
become a conversation.** A provider that failed its check, a spawn that
failed, a run skipped because the previous one was still going: none of those
has a transcript to be found in, so `schedule_runs` holds one row per firing
with an outcome and a typed error. Runs are unattended, so they auto-approve
tool calls — `allow_once` never `allow_always`, since nobody saw the grant; a
prompt with no `allow_once` waits for the user like any other —
and are capped at an hour, after which the turn is cancelled and the run
recorded as timed out (invariant 10).

The timer is a one-minute tick that fires whatever is due without awaiting it
and records an overlap once. It lives in the process and nowhere else: a
restart recomputes the next run from the last row, and a run that was in
flight is closed as failed with a reason, since its agent died with the
server.

## Rooms: a round-robin router over sessions

A room is two to six participants, each an ordinary session on its own
provider with its own model and opening command, plus the person. There is no
protocol for agents addressing each other, and no way to inject into a running
turn, so a room is exactly what that leaves: **prompts built from a transcript,
and `session/cancel` to cut in.** The room keeps its own append-only message
log; a round prompts each participant in turn with a preamble (who it is, who
else is there, the topic, the rules) and everything said since its last turn,
records the reply, and moves on until the turn budget is spent, everyone
passes, or the credit cap is hit.

The person's keystrokes hold the room — the turn in flight finishes, nobody
else is prompted — and sending or clearing the box releases it; Cmd+Enter
cancels whoever is speaking and drops what they were saying. Both act on the
*running* round loop rather than starting another: `round()` is single-flight,
and the two bugs in this area were both a second caller assuming it could
start one.

What an agent hears is untrusted input to the next agent. Messages are
quoted between tags the prompt says only the room writes, so a reply cannot
put words in the person's mouth; this is prompting, not sandboxing, and is
labelled as such. A turn is capped like a scheduled run — a participant
raising a permission prompt in a room has nobody to answer it, and the view
says so while it waits — and a participant that cannot answer stops the room
with its name in the message rather than being skipped in silence.

## Unread chats: read state beside the log

A chat is unread when the agent finished a reply while no browser had it open.
That is not something the event log can say, because "open" is a fact about
sockets, not about the conversation. So it is a column on `sessions`
(`unread`), set and cleared by `SessionManager`, the same way a schedule run's
`unread` is kept on `schedule_runs`.

- **Who is looking:** each socket that subscribes to a chat counts as a viewer
  (`SessionManager.view`), released when it switches away or disconnects.
  Counted, not a flag, because two tabs can hold the same chat.
- **Set:** on every `turn_end` while the viewer count is zero, except a turn
  closed only because the session was shutting down.
- **Cleared:** when a socket subscribes, which is what opening a chat does.
- **Sent:** with the session list, so a reload and every tab agree. A summary
  sent for the chat being watched always says read.

This bends invariant 2 the way `schedule_runs.unread` already did: the
column is read state, not derived from `events`. A `sessions` table rebuilt
from the log starts with every chat read, which is the safe way to be wrong.

## The look: On Air

The visual system is "On Air" (approved comps and reasoning in
`design/README.md`). What the code relies on:

- **A theme is one block of tokens** in `styles.css`. `theme.ts` names the
  themes and resolves System to Cream or Studio, so `data-theme` on `<html>`
  always names a real block; no theme is written twice. Every other colour in
  the stylesheet is derived from those tokens. Adding a theme is a block there
  and a line in `THEMES`.
- **Fill and ink are separate tokens.** A colour read as words gets its own
  token where the fill colour is too light (`--onair` for the lamp,
  `--onair-text` for teal words), and each theme has its own code colours.
  `contrast.test.ts` reads the blocks and fails any text pair under 4.5:1, so
  the rule holds for a theme added later. Words are never faded with opacity.
- **Sizes that hold text are in rem,** including the running sheet's time
  column and gutter, so a reader's larger browser text widens them too.
- **Fonts are self-hosted** (Archivo and Red Hat Mono, both OFL, licences in
  `packages/web/src/fonts/`). Corella is local-first: the page fetches nothing
  from anywhere but its own server.
- **Raised keys only where a press matters:** New chat, Send, and the answers
  to a permission prompt. Their socket and drop are 1 to 1.5px; thicker reads
  as a cartoon.
- **State is a word and a shape, never colour alone.** Red (`--cue`) means one
  thing: you are needed, or something failed. Working has its own teal lamp.
- **The running sheet's times are derived from the log** (`turnTimes` in
  `timeline.ts`): each event's time since its turn began. A short run of tool
  steps shows one line each with its time; more than `FOLD_AFTER` fold into one
  line.
- **Narrow screens are one column** (below 860px: a phone, a tablet, a small
  window). The sidebar is a list that slides over the page, opened by the back
  key in each header; going anywhere closes it. The Changes and Files pane is a
  full-screen sheet, and Changes moves into the ··· menu. The composer row and
  header give up words before they wrap — by container queries on the chat
  column, so the same happens beside an open pane at 1280 — and on a phone the
  row scrolls sideways, with the folder menu as a sheet at the foot (a menu
  inside a scrolling row would be clipped). Auto-approve sits with Stop and
  Send, outside that row, because a safety state must not scroll out of
  sight; the word games' sheet closes when the agent asks, for the same
  reason. Main controls are 44px on narrow
  or touch screens. Pure CSS plus one boolean in `App`; nothing about a chat
  changes with the width. Open, the list acts as a dialog: focus moves in,
  the page behind is `inert`, and Escape gives focus back to the back key.

## App-wide settings

Switches that should be the same in every tab live in the store's `settings`
table (one row per key, a JSON value), behind `GET` and `PATCH /api/settings`;
a key never written reads as its default. The one so far is **Auto-approve new
chats**, off by default. The server applies it when the composer opens a chat
(`withNewChatDefaults`), only where the start options do not already say;
schedules and rooms carry their own setting. The chat's own checkbox then
overrides it for that chat. Display preferences that are one person's taste
(the theme, raw payloads) stay in the browser's `localStorage`.

## Robustness: hanging processes

Because we advertise `terminal: true`, the agent delegates command execution to
us via `terminal/create` / `output` / `wait_for_exit` / `kill` / `release`.
Process lifecycle is therefore **our** responsibility. Four distinct hazards,
each needing its own answer:

| Hazard | Answer |
|---|---|
| A command the agent asked us to run never exits | `TerminalRegistry` tracks every terminal with a wall-clock cap; on expiry `kill`, capture final output, mark it timed-out. Independent of the agent's own timeout. |
| A command produces unbounded output | Honour `outputByteLimit`; truncate from the start at a character boundary and set `truncated`. Never buffer without a cap. |
| Killing a shell leaves orphaned children | Spawn POSIX children `detached: true` and kill the **process group** (`process.kill(-pid, …)`), SIGTERM then SIGKILL after a grace period. Windows uses `taskkill /T /F`. This is the classic bug and the reason "it hangs" survives a naive kill. |
| The agent subprocess wedges, crashes, or never answers | Timeout every JSON-RPC request. Surface `agent_exited` as an event so the UI shows a dead session instead of a spinner forever. Offer restart + `session/load`. |

Two more rules that matter:

- **A turn is owned by the server, not the socket.** If the browser
  disconnects mid-turn the turn keeps running and keeps appending; this is the
  main practical payoff of the event log.
- **Every child PID is recorded**, agents included, in a ledger under the data
  directory. On startup — *once*, before anything spawns — process groups left
  by a previous server are killed. Doing this per-session would kill processes
  belonging to sessions that are still alive.
- **PIDs are recycled by the OS**, so a stale ledger entry could name an
  unrelated process. Every entry is verified against the live process's command
  line before anything is killed.

What each kind of shutdown guarantees:

| How the server ends | Agents | Commands the agent started itself |
|---|---|---|
| Ctrl-C / SIGTERM | killed, as a group | killed with the group |
| `kill -9` | exit on stdin EOF, if well-behaved | **leak** — nothing can run at that moment |
| next startup | — | reaped from the ledger |
- Stop in the UI maps to `session/cancel`, and must remain responsive even
  when the agent is busy.

## Setup and preflight checks

Failures must surface on a **setup page**, not as a mysterious hang inside a
chat. Configuration is verified up front; once a provider passes, the chat flow
trusts it and does not re-diagnose.

### The check ladder

A provider check is a **staged probe that reports which rung it fell off**, not
a boolean. Each stage has its own error code and its own remediation:

| # | Stage | Verifies | Failure code |
|---|---|---|---|
| 1 | `resolve` | binary exists at the configured path or on `PATH` | `AGENT_NOT_FOUND` |
| 2 | `spawn` | the process actually starts | `AGENT_SPAWN_FAILED` |
| 3 | `initialize` | handshake completes within a timeout | `AGENT_HANDSHAKE_TIMEOUT` |
| 4 | `version` | agent's `protocolVersion` is one we support | `AGENT_PROTOCOL_MISMATCH` |
| 5 | `authenticate` | `authMethods` satisfied, if the agent requires it | `AGENT_AUTH_REQUIRED` |
| 6 | `session` | `session/new` succeeds | `AGENT_SESSION_FAILED` |
| 7 | `capabilities` | record `loadSession`, prompt capabilities, config options | — |

Then tear the probe session down. Stage 6 is what makes "assume the draft will
work" safe — it exercises the exact call the draft flow depends on, and returns
the model list as a side effect, so the setup page can show *which* models a
provider offers.

Stage 5 matters more than it looks: agents advertise `authMethods` in the
`initialize` response and return JSON-RPC error **`-32000` (auth required)** if
the client never calls `authenticate`. Skipping that step is a known way to
break ACP clients against agents that require login. Catching it at setup turns
"the chat silently does nothing" into "click Authenticate".

### Persisting results

```sql
CREATE TABLE provider_checks (
  provider_id TEXT PRIMARY KEY,
  status      TEXT NOT NULL,   -- 'ok' | 'failed' | 'stale'
  stage       TEXT,            -- rung reached
  error_code  TEXT,
  detail      TEXT,            -- JSON: capabilities, models, stderr tail
  checked_at  INTEGER NOT NULL
);
```

**Checks run by themselves.** `autoCheck.ts` checks every provider when the
server starts, and again whenever one is added or its command, arguments,
environment or folder change — noticed when the providers list is read, since
`config.json` is read afresh each time. Checks run in the background; the list
marks a provider `checking`, and the page asks again until none are. Check in
Settings remains, for seeing why one fails.

A provider must be `ok` before it can be chosen for a new chat. If a
runtime failure happens anyway — the binary was removed, a token expired — the
provider is marked `stale` and the error links back to the setup page. Verified
is a cached fact with a timestamp, not a permanent guarantee.

A provider that is not `ok` is still listed in the new chat's agent picker,
greyed, with its check's message, so a missing agent is not a mystery.

## Errors and debugging

The dominant failure mode of a project like this is an opaque hang. The design
treats diagnosability as a feature, not an afterthought.

### Typed errors, never strings

```ts
type KcError = {
  code: KcErrorCode      // closed enum in packages/shared
  stage?: CheckStage     // where in the ladder, if applicable
  message: string        // what happened
  remediation?: string   // what the user should do about it
  detail?: unknown       // structured context
  cause?: string         // underlying error, preserved
}
```

Every code maps to a remediation string. `AGENT_NOT_FOUND` says which path was
tried and notes that GUI apps often do not inherit shell `PATH` — the exact
caveat [Kiro's own docs call out](https://kiro.dev/docs/cli/acp/).

### Errors are events

Failures are appended to the event log like any other event. They persist, they
appear inline in the transcript where they happened, and they are still there
after a restart. This follows from the log being the source of truth: an error
the UI renders but never records is an error you cannot debug tomorrow.

### Capture the agent's stderr

**This is the single highest-value debugging lever.** The agent's stdout is the
JSON-RPC channel and carries nothing human-readable; when it crashes, the stack
trace goes to **stderr**. Keep a per-session ring buffer of the last ~64KB of
stderr, attach its tail to any error report, and show it behind a details
toggle on the setup page.

### Optional protocol trace

`CORELLA_TRACE=1` writes every JSON-RPC frame, both directions, to a JSONL
file. Off by default, trivial to implement, and the difference between guessing
and knowing when an agent misbehaves.

### Rules

- No empty `catch`. No generic "something went wrong".
- Every RPC has a timeout; a hung request must become an error, never a
  permanent spinner.
- Preserve `cause` when wrapping. Never discard the underlying error.
- Redact `env` from anything logged.

## Security

- Bind `127.0.0.1` explicitly, never `0.0.0.0`.
- **Check the WebSocket `Origin` header even on localhost** — any page in your
  browser can otherwise open a socket to a local server.
- **A login token, because Origin only stops web pages.** Another program on
  the machine sends no `Origin` and the right `Host`, and `PATCH
  /api/providers/:id` plus its check runs any command. So every route and the
  socket need the token, Jupyter-style: printed in the start-up link, traded for
  an `HttpOnly`, `SameSite=Strict` cookie, or sent as a Bearer header. It is
  kept in the data folder rather than made fresh each start, so a restart
  (`node --watch` in dev, or a reboot) does not log the browser out. It does not
  protect against a process running as the same user, which can read the file;
  it protects against everything else on the machine.
- **Six files skip the login: the web app manifest and its icons**
  (`PUBLIC_FILES` in `http.ts`). Browsers fetch a manifest without
  credentials, so behind the login the page could not be installed as an app.
  They hold only the name, colours and icon. Exact paths, GET only, and a
  missing one is a 404 rather than the SPA fallback, so nothing else is served
  without the token.
- The data folder is 0700 and its files 0600 (the database and its WAL files,
  the token, the config, the process ledger, traces): they hold work
  conversations, source code and provider `env` values.
- Never log environment variables when logging spawns.
- **Two file readers, two trust boundaries.** `fs.ts` answers the *agent's*
  `fs/read_text_file` and is deliberately unsandboxed: the agent is a local
  process that can already read anything the user can, and a false boundary
  would suggest a guarantee we cannot make. `files.ts` answers the *browser*,
  and any page the user has open can attempt a request to localhost — the
  Origin check is one control, not a boundary — so it is confined to the
  conversation's roots, compared on real paths after symlinks are followed.
  The roots are the working directory plus `root_added` events, so the
  allowlist is replayed from the log rather than trusted from a request.
  Raw bytes (images, PDFs) go out with `nosniff` and a `sandbox` CSP, so a
  file in a cloned repository cannot run as our origin; SVG is served as text
  for the same reason.

## Portability

- `spawn` with an **args array**, never a shell string.
- **No native modules.** `node:sqlite` is built in; `node-pty` is not needed
  because ACP removed the PTY requirement entirely.
- Paths via `node:path`; data dir resolved per-OS.
- `node:sqlite` prints an `ExperimentalWarning` on Node 22 and is stable on 24.
  Pin via `.nvmrc`; `better-sqlite3` is a near drop-in escape hatch.

## Rejected alternatives

- **Parsing CLI output / PTY wrapping** — obsolete once ACP exists. Was the
  original plan; the research killed it.
- **JSONL files for the event log** — one store beats two. SQLite is free here.
- **SSE + POST instead of WebSocket** — traffic is genuinely bidirectional
  (interrupts, approvals, config changes mid-turn).
- **Python/FastAPI backend** — fine on merit, but a TS server shares event
  types with the React client and removes a class of drift bugs.
- **Browser talks to the CLI directly** — impossible; a page cannot spawn
  processes.
- **Electron wrapper** — the browser is the point.
