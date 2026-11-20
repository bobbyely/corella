# Changelog

All notable changes to Corella are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **A `corella` command.** It starts Corella and opens your browser already
  logged in. `corella --app` opens it in its own window (Chrome, Edge, Brave
  or Chromium), `--no-open` just prints the link, and `--port` picks the port.
  `npm link` in a clone puts it on your PATH.

### Changed

- **Starting is quicker.** `npm start` and `corella` build only when the code
  has changed since the last build, rather than every time: about 0.2 seconds
  to a running server instead of about 2.3.
- **A taken port gets a plain message**, saying whether Corella is already
  running there, instead of a stack trace.

## [0.1.0] - 2026-11-20

The first release. Corella is a chat window in your browser for coding agents
that run on your own machine: Kiro CLI, and other agents that speak the
[Agent Client Protocol](https://agentclientprotocol.com). A small local server
starts the agent in your project and streams it to the page. You get streamed
answers, tool calls and diffs you can read, permission prompts you can click,
and every conversation kept, searchable and resumable. It also has schedules,
rooms where agents talk in turns, a Changes and Files pane, and switching agent
mid-conversation.

### Security

- **A login token.** Every page, API call and the live connection now need it.
  Before, any program on the machine could call the API, change an agent's
  command and run it as you. The server prints a login link at start; the
  browser keeps the token as a cookie that page scripts cannot read and other
  sites cannot send. Scripts can send it as `Authorization: Bearer <token>`.
- **No framing.** Every page tells the browser it must not be shown inside
  another site, so a hidden frame cannot trick clicks on "Always allow".
- **Listing an agent's own conversations is a POST.** It starts the agent, and
  a GET can be fired by an image on any website.
- **A file named `x.constructor` no longer blanks the app.** An error catcher
  around the main view also means one broken part shows a message, not a blank
  page.
- The data folder is created private (0700), and the database, its WAL files,
  the token, the process list and traces are private (0600).
- `autoApprove` must be a real `true` or `false`; the text `"false"` used to
  turn it on.
- A permission answer must be one of the options the agent offered.
- Auto-approve only ever picks "allow once". With no such option, it asks you.
- The providers list shows the names of env variables but hides their values.

### Upgrading from KiroChrome

- **The name.** KiroChrome is now Corella. The repository is
  `bobbyely/corella`; clone it fresh, or point your old clone at it with
  `git remote set-url origin https://github.com/bobbyely/corella.git`.
- **Settings.** Environment variables are now `CORELLA_DATA_DIR`,
  `CORELLA_PORT`, `CORELLA_CWD`, `CORELLA_TRACE` and `CORELLA_DEV`. The old
  `KIROCHROME_*` names still work in 0.1.0 and will be dropped in 0.2.0.
- **Your data moves by itself.** On first start, the `kirochrome` data folder
  is renamed to `corella`, and `kirochrome.db` to `corella.db`. Your chats,
  provider config and login token come with it. Nothing is overwritten or
  deleted: if a `corella` folder already exists, the old one is left alone.
- **Log in once.** Open the link the server prints when it starts (it ends in
  `?token=…`). The browser remembers you after that. The theme choice resets
  to the default once.

[0.1.0]: https://github.com/bobbyely/corella/releases/tag/v0.1.0
