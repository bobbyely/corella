# Changelog

All notable changes to Corella are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **The On Air look.** A calmer chat in the family of a radio running sheet:
  each step carries its time from the start of the turn down a ruled left
  margin, agent replies are plain text, your messages sit in a light box, and
  each tool step is one line (a short run shows every step; a long one folds).
  The header holds the title, the agent and folder, a readout with the turn's
  clock and how full the agent's memory is, Changes, and a ··· menu with Files,
  Export and the word games. The floating Play button is gone.
- **Three themes:** Cream (light, the default), Studio (dark) and Glass, plus
  System, which follows your computer. A choice made in 0.1.0 carries over:
  Light becomes Cream, Dark becomes Studio.
- **Chat states in the sidebar,** each a word and a shape: Cue (needs your
  answer), On air (working), New (a reply you have not opened) and Off (no
  agent attached). Chats are grouped under Today and Earlier, with their age.
- **Unread chats.** A chat becomes New when the agent finishes a reply while
  nobody has it open; opening it clears that. Kept by the server, so it
  survives a reload and is the same in every tab.
- **Install as an app.** A web app manifest and icons, so Chrome, Edge and
  Brave offer **Install Corella**, and Safari offers **Add to Dock**.
- **Archivo and Red Hat Mono,** served by Corella itself. No fonts or anything
  else are fetched from outside.

### Changed

- **Setup is now Settings,** with the theme choice, the keyboard shortcuts and
  the agents' checks.
- **Nothing is smaller than 12px.** Body text is 14 to 15px.

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
