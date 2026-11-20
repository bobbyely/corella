# Developing Corella

How to run it from a checkout, work on it, and look under it when an agent
misbehaves. For the rules of the codebase see [AGENTS.md](../AGENTS.md).

## Running from a checkout

Requires **Node 22.5+** (for the built-in `node:sqlite`). See `.nvmrc`.

```bash
git clone https://github.com/bobbyely/corella.git
cd corella
npm install
npm start                 # prints http://127.0.0.1:4711/?token=…
```

`npm start` runs `bin/corella.mjs --no-open`, the same script as the `corella`
command (`npm link` or `npm install -g .` in the checkout puts it on `PATH`;
both link to the checkout, so it runs whatever you have checked out). It builds
only when a package's `dist` is missing or older than anything in its `src`
or the files beside it (`package.json`, `tsconfig.json`, `vite.config.ts`,
`index.html`), and says which file made it build. It does not look at
`node_modules`: after an `npm install` that changes a dependency, run
`npm run build` yourself. Then it imports the server's `dist/index.js` in the
same process, so Ctrl-C reaches the server directly.

| Option | Does |
|---|---|
| (none) | Opens the default browser at the login link (`open`, `xdg-open` or `start`) |
| `--app` | Opens Chrome, Edge, Brave or Chromium in app mode (`--app=<url>`): the usual install folders on macOS and Windows, then `PATH`. None found: the default browser, with a line saying why |
| `--no-open` | Opens nothing |
| `--port <n>` | The port; otherwise `CORELLA_PORT`, otherwise 4711 |
| `--help`, `--version` | What they say |

The browser is started detached, so it stays open after Ctrl-C. A taken port
is reported plainly, saying whether the thing on it is another Corella.

Open the printed link. The token in it is the login: the server trades it for a
cookie (`HttpOnly`, `SameSite=Strict`) and redirects to the plain address, which
then keeps working in that browser. Without it every page and API route answers
401 `AUTH_REQUIRED`. The token is kept in the file `token` in the data directory
(0600), so it survives restarts; delete the file for a new one. A script sends
it as `Authorization: Bearer <token>`.

Then press **Check** on a provider, and once it passes,
**New chat**.

If the agent keeps conversations of its own — Claude Code and Kiro both do — the
new-chat page offers to **browse** them, so a conversation you started in the
terminal can be continued in the browser. It says so where it matters: the
transcript above the seam is whatever the agent replays, and Corella's own
log starts where you opened it.

## Development with hot reload

```bash
npm run dev
```

One command, three watchers: the UI hot-reloads on <http://127.0.0.1:5173>
without losing your place, and the server rebuilds and restarts on change.
Ctrl-C stops all of it.

Vite proxies `/api` and `/ws` through to the server on :4711, so use the 5173
URL — the 4711 one serves the last built bundle, not your edits. To log in,
open the `?token=` link the server prints: in dev mode it sets the cookie and
lands on 5173 (cookies ignore the port, so the proxied calls carry it).

A server restart detaches running agents. Conversations are persisted, so
reopening one and pressing **Resume conversation** picks it back up.

## Working on several features at once

Each change gets its own git worktree, beside the repo rather than inside it:

```bash
npm run wt -- new <topic>     # branch + ../corella-worktrees/<topic> + install
git worktree list             # what is in flight
npm run wt -- prune           # remove everything merged (--yes to go ahead)
```

`prune` asks GitHub whether each PR was merged, because rebase-merging means
`git branch --merged` never says so. It refuses on uncommitted or unpushed work,
and prints what it would remove unless you pass `--yes`.

Everything in between is ordinary git and `gh`; see the pull request section of
[AGENTS.md](../AGENTS.md) for the sequence.

Only run one dev server at a time — worktrees share ports 4711 and 5173, and a
single database.

## On a new machine

`.git/config` does not travel with a clone, so set your commit identity before
your first commit — otherwise commits are attributed to whatever global identity
that machine has (a corporate one, on a work laptop). Use your GitHub
username and GitHub's private `noreply` address (Settings → Emails), not a
personal one: the history is public.

```bash
git config user.name  "your-github-username"
git config user.email "12345+your-github-username@users.noreply.github.com"
```

Verify with `git log -1 --format='%an <%ae>'` after committing. Getting it right
at commit time is the only fix that works: a `.mailmap` would canonicalise the
display for git's own tooling, but GitHub ignores it for the contributor graph.

## Providers

Configured in `<dataDir>/config.json`, seeded on first run with Kiro, Claude
Code, Gemini CLI, Codex, and — when running from a checkout — an offline mock
agent that always passes, so you can try the chat with no agent installed.

The mock plays the README screenshot's chat when a message starts with
`Add a /health endpoint`: a read, an edit, a test run and a permission prompt,
at the screenshot's timing (set `MOCK_DEMO_PACE=0.2` for five times faster).
`MOCK_LONG_STEP_MS` stretches its `long` turn, for a chat that stays On air.
`MOCK_SESSION_DELAY_MS` slows its start, to try sending before the agent is up,
and `MOCK_EFFORT_COMMAND=1` makes it offer Kiro's `/effort` command, for the
effort picker.

Adding another is a config entry, not code:
[PROVIDERS.md](PROVIDERS.md) has the recipe and an honest table of
which ones have actually been run.

The file is checked when it is read. An entry with a mistake in it — `args` as
a string, a missing `command`, an id used twice — is skipped with a warning on
the server's output, so the rest of your providers still load and the setup
page still works. Only a file with nothing usable left in it is an error, and
that error names each problem. Delete the file to get the defaults back.

| OS | Data directory |
|---|---|
| macOS | `~/Library/Application Support/corella/` |
| Linux | `~/.local/share/corella/` (or `$XDG_DATA_HOME/corella/`) |
| Windows | `%APPDATA%\corella\` |

`CORELLA_DATA_DIR` overrides it. `CORELLA_PORT` changes the port.
`CORELLA_CWD` sets the directory a new chat starts in (otherwise the directory
`corella` or `npm start` was run from).
`CORELLA_TRACE=1` logs every JSON-RPC frame to a JSONL file in the data
directory. `CORELLA_DEV=1` additionally trusts Vite's origin on port 5173 —
`npm run dev` sets it for you, and a normal run should not: 5173 is Vite's
default port, so trusting it means trusting any project you happen to have
running there. Vite is pinned to that port and refuses to start if it is
taken; a `Port 5173 is already in use` means another dev server is still
running — stop it rather than working around it, since the API would reject
whatever port Vite moved to.

The project was called KiroChrome before 0.1.0. The old `KIROCHROME_*` names
are still read when the new one is not set, until 0.2.0. On first start,
Corella moves an old `kirochrome` data folder to `corella` and renames
`kirochrome.db` to `corella.db`, so your chats come with it. It never
overwrites: if a `corella` folder already exists, the old one is left alone.

If a provider fails, the setup page names the rung it failed on and what to do
about it. Two common ones:

- **`AGENT_NOT_FOUND`** — set an absolute path in `config.json`. Kiro installs
  to `~/.local/bin/kiro-cli`, which a GUI-launched process often cannot see.
- **Claude Code refuses to start** — its ACP adapter will not run nested inside
  an existing Claude Code session. Use a plain terminal.

## What did the agent actually send?

```bash
node scripts/diagnose.mjs
```

Lists every conversation with the ACP updates it received and whether the agent
reported context usage. Counts only — no conversation content is printed. Use it
when something is missing from the UI and you want to know whether the agent
sent it at all.

## Probing an agent directly

To see raw ACP traffic without the UI — useful when a provider misbehaves, or to
check what a new agent advertises:

```bash
cd spike && npm install
node handshake.mjs kiro          # or: claude-code, mock
```
