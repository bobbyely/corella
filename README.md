# Corella

**A chat window in your browser for the coding agent on your machine.**

![Corella in its Cream theme: a chat's running sheet, each step timed from the start of the turn, an edit shown as a diff, and the agent asking before it restarts a container. The sidebar marks each chat Cue, On air, New or Off](docs/screenshot.png)

Your agent runs where it always has: on your computer, in your project.
Corella gives it a proper window. Answers stream in as real Markdown. Tool
calls and file edits are things you can read, not walls of text. Permission
prompts are buttons. Every conversation is kept, searchable and resumable.

It talks to agents over the [Agent Client Protocol](https://agentclientprotocol.com)
(ACP). It was called KiroChrome before 0.1.0.

## Quick start

You need [Node](https://nodejs.org/) 22.16 or newer and git.

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

Corella opens on a new chat, with the cursor in the box. It checks your agents
by itself as it starts, and starts the one you used last in the background
while you type, so just write and press Enter. No agent installed yet? The
built-in mock agent lets you try it anyway. If an agent is missing, the agent
picker says why, and **Settings** shows each check step by step.

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
- **Ready when you are.** A new chat starts with the agent, model, effort and
  folder you used last, and the agent starts while you type. Send before it is
  up and your message simply waits for it.
- **Effort beside the model.** Where an agent has a reasoning-effort setting,
  it is a picker next to the model, even when the agent only offers it as a
  command (Kiro's `/effort`). Changing it never shows up as a chat message.
- **Switch agent mid-chat.** The next agent is handed the conversation so far.
- **Schedules.** Run a saved prompt every hour, or daily at a set time.
- **Rooms.** Two or more agents and you, talking in turns.
- **See every chat at a glance.** Each chat in the sidebar says what it is
  doing: **Cue** when it needs your answer, **On air** while it works, **New**
  when a reply came in that you have not read, **Off** when no agent is
  attached. Unread is kept by the server, so it survives a reload and every tab
  agrees.
- **A running sheet.** Each step in a chat carries its time from the start of
  the turn, and a readout shows the turn's clock and how full the agent's
  memory is.
- **Three themes.** Cream (light), Studio (dark) and Glass, or follow your
  computer's light or dark setting. Pick one in **Settings**.
- **Its own window.** Install it as an app, so it opens without browser tabs
  around it. See below.
- **Works on a phone or tablet.** One column: the list of chats slides in from
  the side, Changes and Files open full screen, and buttons are big enough for
  a finger, and a narrow window works the same way. Corella only listens on
  your own machine, so it does not set up a way in from a phone for you.

## Open it in its own window

Corella can be installed as an app, so it opens in a window of its own.

- **Chrome, Edge or Brave:** open the menu and choose **Install Corella**.
- **Safari on macOS:** **File → Add to Dock**.
- **Firefox:** desktop Firefox mostly cannot install web apps; use it in a tab.

The installed app is the same page on `127.0.0.1`, so the server must be
running.

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
