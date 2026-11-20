# Corella

**A chat window in your browser for the coding agent on your machine.**

![Corella: an agent finds a failing test, shows its edit as a diff, and asks before running the suite](docs/screenshot.png)

Your agent runs where it always has: on your computer, in your project.
Corella gives it a proper window. Answers stream in as real Markdown. Tool
calls and file edits are things you can read, not walls of text. Permission
prompts are buttons. Every conversation is kept, searchable and resumable.

It talks to agents over the [Agent Client Protocol](https://agentclientprotocol.com)
(ACP). It was called KiroChrome before 0.1.0.

## Quick start

You need [Node](https://nodejs.org/) 22.5 or newer and git.

```bash
git clone https://github.com/bobbyely/corella.git
cd corella
npm install
npm link          # puts the `corella` command on your PATH
corella
```

`corella` starts the server and opens your browser, already logged in. Run it
from the project you want to work on: new chats start in that folder. It builds
itself the first time, and again only after the code changes, so later starts
take a moment.

- `corella --app` opens it in its own window instead, without tabs or an
  address bar (needs Chrome, Edge, Brave or Chromium; otherwise it says so and
  uses your normal browser).
- `corella --no-open` just prints the login link, `http://127.0.0.1:4711/?token=…`.
- `corella --port 4799` uses another port. `corella --help` lists the rest.

`npm install -g .` works instead of `npm link`. Without either, `npm start`
in the folder runs the same thing without opening a browser. Ctrl-C stops the
server; the browser window stays open.

The other way to get a window of its own: open Corella once, then use your
browser's **Install** (or **Add to Dock**) option for the page.

Go to **Setup**, press **Check** on your agent, then **New chat**. No agent
installed yet? The built-in mock agent lets you try it anyway.

## Which agents

| Agent | Status |
|---|---|
| [Kiro CLI](https://kiro.dev/) | Tested |
| Claude Code, Gemini CLI, Codex | Speak the same protocol and should work. Not tested yet |

Adding another ACP agent is a config entry, not code. See
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## What you get

- **A readable transcript.** Code is highlighted. Edits show as diffs. A
  pane lists every file the agent changed, and another browses the project.
- **Nothing lost.** Close the tab or restart the server, and the conversation
  is still there. Search across all of them. Pick up chats you started in the
  agent's own terminal.
- **Control mid-turn.** Type while the agent works and your message waits its
  turn, or interrupt. Stop really stops it, with no stray processes.
- **Switch agent mid-chat.** The next agent is handed the conversation so far.
- **Schedules.** Run a saved prompt every hour, or daily at a set time.
- **Rooms.** Two or more agents and you, talking in turns.
- **Context meter.** How full the agent's memory is, and what it has cost.

## Is it safe?

Corella is built to run on your own machine, for you alone.

- It listens on `127.0.0.1` only, so other computers cannot reach it.
- Every page and call needs the login link's token, so other programs and
  websites cannot use it.
- **Do not put it on a network.** The agents it starts can read and change your
  files and run commands as you. That is what coding agents do.

Found a security problem? See [SECURITY.md](SECURITY.md).

## Settings

All optional. Set them as environment variables before `corella`.

| Variable | Default | What it does |
|---|---|---|
| `CORELLA_PORT` | `4711` | The port it listens on |
| `CORELLA_DATA_DIR` | see below | Where conversations and settings are kept |
| `CORELLA_CWD` | where you ran `corella` | The folder a new chat starts in |
| `CORELLA_TRACE` | off | `1` logs every message to and from the agent, for debugging |
| `CORELLA_DEV` | off | `1` trusts the hot-reload dev server. `npm run dev` sets it; leave it off otherwise |

The old `KIROCHROME_*` names still work in 0.1.0.

## Where your data lives

| OS | Folder |
|---|---|
| Linux | `~/.local/share/corella/` |
| macOS | `~/Library/Application Support/corella/` |
| Windows | `%APPDATA%\corella\` |

It holds the conversations (`corella.db`), the agent list (`config.json`) and
the login token (`token`). Only your user can read it. Coming from KiroChrome?
The old `kirochrome` folder is moved here on first start, chats included.

Runs on macOS and Linux. Windows works, but stray agent processes are not
cleaned up after a crash there.

## Contributing

Issues and pull requests are welcome. Coding agents are welcome too: start
with [AGENTS.md](AGENTS.md), which has the rules and a map of the code.
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers running from a checkout,
hot reload and tests (`npm test`).

## Licence

[MIT](LICENSE).

A personal project, maintained in spare time.
