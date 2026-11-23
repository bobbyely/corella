# Changelog

All notable changes to Corella are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **Error replies no longer carry stack traces.** An HTTP error's underlying
  cause, which can include a stack trace, now goes to the server's log instead
  of the reply. Chat errors still show their full details.

## [0.2.1] - 2026-11-23

### Fixed

- **An agent error says why.** When the agent failed a turn, the chat said
  "See the details below" with nothing below it. It now shows the agent's own
  reason, such as "You've reached your overage limit", and the full trace
  opens under it.

### Changed

- React and React DOM 19 (from 18), and react-markdown 10 (from 9), moved
  together: the two React packages must always be the same version.

## [0.2.0] - 2026-11-22

**Upgrading:** Corella now needs **Node 22.16 or newer** (it said 22.5). It
always did in practice: before 22.13 the server stops at start, and before
22.16 search is missing. With nvm: `nvm install 22 && nvm use 22`.

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
- **A new chat is the opening screen.** The cursor is in the box, and the
  agent, model, effort and folder are what you used last. The agent starts in
  the background while you type. Press Enter before it is up and the message
  stays in the box, marked "Sends when <agent> is ready" with a Cancel, and
  goes by itself once it is. Switch folder or chat, reload, or have the agent
  fail to start, and nothing is sent: the words stay in the box (a reload
  included) for you to send again. The folder is a list of recent folders, plus
  **Choose another…**. There is one **New chat** button.
- **Agents are checked by themselves,** when Corella starts and when one is
  added or changed. An agent that failed says why in the agent picker. Check in
  Settings is still there, to see the steps.
- **An effort picker beside the model.** It sets the agent's own effort setting
  where there is one, or sends the agent's `/effort` command quietly where that
  is the only way (Kiro). It never shows as a message or names the chat.
- **A phone and tablet layout.** Below 860px wide Corella is one column: the
  list of chats slides over the page, with a back key in every header;
  Changes and Files open as full-screen sheets; the composer row scrolls
  sideways; main buttons are 44px for a finger. Nothing scrolls sideways
  except long code inside its own block.
- **The resize edges answer the keyboard and touch.** Tab to the sidebar's or
  the side pane's edge and use the arrow keys (Shift for bigger steps), or drag
  it with a finger.
- **A permission prompt takes the focus** when it appears, so Tab reaches
  Allow. Not while you are typing, and Enter in the message box never answers
  it.
- **A `corella` command.** It starts Corella and opens your browser already
  logged in. `corella --app` opens it in its own window (Chrome, Edge, Brave
  or Chromium), `--no-open` just prints the link, and `--port` picks the port.
  `npm link` in a clone puts it on your PATH.

- **Auto-approve new chats,** a switch in Settings, off unless you turn it on.
  With it on, every new chat starts with Auto-approve ticked; the checkbox
  under the message box still turns it off for one chat. It only ever answers
  "allow once", and the agent's own questions still wait for you. While a chat
  is auto-approving, a lit lamp and the word sit beside Send, in sight at
  every width.
- **A cue reaches you in another tab.** While any chat needs you, the tab's
  title reads "▲ 2 · Corella", and a screen reader hears "<chat> needs you"
  once per chat.

### Changed

- **Every word passes WCAG AA, in every theme.** Teal text has its own darker
  ink on Cream (the lamp teal read at 3.4 to 4.2:1); each theme has its own
  code colours, so Glass no longer borrows Studio's (3.0 to 3.8:1 on its
  diffs); the Settings check ladder no longer fades its steps (1.7 to 3:1).
  A test checks every theme's text against its backgrounds.
- **Larger browser text works.** At 200% the running sheet's times, the titles
  and the sidebar grow with it instead of overlapping or cutting off Settings.
- **Raw payloads are hidden** under tool steps, unless Settings turns them on.
- **Send stays lit while the agent works,** since what you type then is sent
  when the turn ends; its tooltip says so.
- **The keyboard and screen readers get more.** The message box has the same
  focus ring as everything else; on a phone the chat list takes focus, closes
  on Escape and gives focus back; Escape in "Choose another…" returns to the
  folder key; room and schedule fields and the Remove buttons are named.
- **On a phone the word games open as a sheet** along the foot of the screen
  (they opened off screen). The sheet closes when the agent asks you
  something, so it never covers the prompt's keys, and "Agent needs you" in
  the games is a button that takes you to the question.
- **Large text keeps chat names readable:** at 200% the state tag moves above
  the title, and Rename, Archive and their icons grow with the text. The
  shortcuts beside New chat and Search show at the default sidebar width.
- **The model, mode and effort pickers are tappable over their whole pill,**
  44px tall on a phone (the select inside was 22px).
- **The Changes pane leaves the chat at least 480px,** and Rename and Archive
  are larger and stop short of the chat's title.
- **Shortcuts spell out Shift,** which the self-hosted fonts cannot draw as ⇧.
- **Setup is now Settings,** with the theme choice, the keyboard shortcuts and
  the agents' checks.
- **Conversations your agent already has** moved from the new-chat page into
  Search, filtered by what you type.
- **The Opening field** no longer suggests `/effort high`: effort has its own
  picker.
- **Nothing is smaller than 12px.** Body text is 14 to 15px.
- **The composer row stays on one line beside the Changes pane** at 1280: the
  pane opens at 440px, and the row drops the agent's name (it is in the
  header) and the Stop label before it wraps.
- **Starting is quicker.** `npm start` and `corella` build only when the code
  has changed since the last build, rather than every time: about 0.2 seconds
  to a running server instead of about 2.3.
- **A taken port gets a plain message**, saying whether Corella is already
  running there, instead of a stack trace.

### Security

- **Dependency updates.** `ws` 8.23.0 fixes a memory-exhaustion bug a peer
  could trigger with a flood of pings. Vite, TypeScript and the rest are
  updated too.
- **Vite 8 and its React plugin 6,** now that the minimum Node allows them.

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

[0.2.1]: https://github.com/bobbyely/corella/releases/tag/v0.2.1
[0.2.0]: https://github.com/bobbyely/corella/releases/tag/v0.2.0
[0.1.0]: https://github.com/bobbyely/corella/releases/tag/v0.1.0
