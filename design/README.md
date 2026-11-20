# On Air: Corella's design direction

Static comps for review before the real build. No app code here.

## The idea

A radio running sheet. Every step in a chat carries its time from the start
of the turn (`00:04`, `00:11`…) down a ruled left gutter, like a show's running
order. Each chat in the sidebar wears a word tag that says what it is doing.

It is calm on purpose: you work in this window for hours. The playful hardware
touches go on a few controls only.

## Inspirations

- **Whipbird**, the owner's own music app: a cream hardware body, near-black
  ink, a few strong colours, a glowing dark glass screen, small capital labels
  between solid rules, raised keys in thin dark sockets. Corella and Whipbird
  should feel like the same family.
- **Small-studio electronics design, as principles only**: a strict grid, very
  few colours with one hot accent, small monospace labels, playful but exact,
  each control doing one job, lots of empty space. Nothing copied: no layouts,
  logos, typefaces or product looks.

## Where the hardware shows

Only where a press matters:

- **Keys** (a raised cap in a thin dark socket): New chat, Send, and Allow /
  Deny on a permission prompt. Everything else is a plain button.
- **The glass readout** in the chat header: the turn clock in warm amber, and
  how full the agent's memory is as lit segments. It is the one screen in the
  room, and it looks the same in every theme.
- **Section labels between solid rules**: `TODAY`, `EARLIER`, `RECENT FOLDERS`.

## The five sidebar states

Each differs by word and by shape, never by colour alone.

| State | Tag | How it looks |
|---|---|---|
| Needs you | `▲ CUE` | Filled rosella red, with a triangle. The strongest mark. |
| Working | `● ON AIR` | Filled teal, with a lamp dot. |
| New reply | `NEW` | Filled ink (light on dark themes), and the title goes bold. Clears when you open the chat. |
| Stopped | `OFF` | Dashed outline, struck through, greyed title. |
| Ready | none | No mark. Quiet. |

**Red means one thing: you are needed.** Rosella is for CUE and for errors,
nothing else. Working has its own lamp colour (teal), so a busy chat never
looks like a broken one. In the first On Air, red meant "on air"; that was the
known risk, and this fixes it.

## Themes

A theme is one block of tokens: in the app, `packages/web/src/styles.css`; in
the comps, `comps/build.mjs` (`THEMES`). Adding a theme means adding a block; no
component changes. The table is the app's; the comps predate the ink tokens.

| Token | Cream (default, light) | Studio (dark) | Glass (character) |
|---|---|---|---|
| ground | `#ece4d2` | `#141518` | `#0d3433` |
| sidebar | `#e3d9c3` | `#0e0f11` | `#082625` |
| surface | `#f6f0e2` | `#1d1e22` | `#11403f` |
| line | `#cdc2a8` | `#2e3036` | `#1f5856` |
| text | `#1d1c19` | `#ecebe6` | `#dcf6ec` |
| muted | `#5c554a` | `#a3a199` | `#93c6b6` |
| on air (working: fills, lamps, rings) | `#177f83` | `#3cc2b4` | `#8ff0d0` |
| on air as words (`onair-text`) | `#12676a` | `#3cc2b4` | `#8ff0d0` |
| cue (needs you, errors) | `#b22834` | `#ff6b72` | `#ff7a6b` |
| warn | `#825505` | `#ffb36b` | `#ffb36b` |
| new | `#1d1c19` | `#ecebe6` | `#ffb36b` |
| key cap | `#f8edcc` | `#3a3b41` | `#1c5250` |
| hot key (Send, Allow) | `#2a2824` | `#ecebe6` | `#dcf6ec` |
| socket | `#1c1b18` | `#030304` | `#031413` |
| glass / glow / warm | `#0d3433` `#8ff0d0` `#ffb36b` | same | `#051c1b` `#8ff0d0` `#ffb36b` |
| diff added (bg / ink) | `#d5e6dc` `#0d5658` | `#14302c` `#8fe3cf` | `#1b5e4c` `#aef5da` |
| diff removed (bg / ink) | `#f1d4cf` `#8f1f28` | `#3b1b1e` `#ff9ea4` | `#4a2427` `#ffb3aa` |

- **Cream**: Whipbird's body colour, ink text, teal and rosella. The default.
- **Studio**: a dark control room. Charcoal, off-white, the same jobs for the
  same colours, brightened for the dark.
- **Glass**: the whole window is Whipbird's glowing screen. Green glow for
  working, warm amber for new replies.

### Contrast: the ink tokens

Every colour that is read as words passes WCAG AA (4.5:1) on every background
it sits on, in all three themes. `packages/web/src/__tests__/contrast.test.ts`
reads the token blocks out of `styles.css` and checks each pair, so a new theme
or a changed colour fails the tests rather than the reader.

- **Fill and ink are separate tokens.** `onair` is the teal of the lamp, the
  ON AIR tag and the focus ring; it is too light to read as words on Cream
  (3.4–4.2:1). Teal words use `onair-text` (5.8:1 on the surface). The ink *on*
  a fill has its own token too: `onair-ink`, `cue-ink`, `new-ink`, `keyink`,
  `keyhot-ink`.
- **Text on the page:** `text`, `muted`, `onair-text`, `cue`, `ok`, `warn` on
  ground, sidebar and surface.
- **Diffs:** `add-ink` on `add-bg`, `del-ink` on `del-bg`.
- **Code:** each theme has its own `syn-*` set, passing on the surface and on
  the diff's added and removed rows. Studio keeps Tokyo Night; Glass lightens
  it to read on its green glass; Cream has a darker set.
- **Never fade words with opacity.** A disabled button may; a label that is
  merely quieter uses `muted`. The settings check ladder used to fade pending
  and skipped steps to 1.7–3:1; now it says so with its mark and a dashed
  outline.

The cream rosella is darker than Whipbird's `#c8343f`, so red text on the cream
sidebar passes too.

## Type

Both are OFL, so the app can ship and self-host them.

- **Archivo** for everything you read. Normal width for prose (15px), a
  slightly condensed width for titles.
- **Red Hat Mono** for code, paths, times and the small capital labels.

Body text is at least 14px everywhere. Labels are 12px, nothing smaller.

## Kept from the critique

The layout is the decluttered one all three earlier directions shared:

- Header: title, agent and short folder, the readout, Changes, and a "⋯" menu.
- Composer: one row of pickers under the box: agent, model, **effort beside
  the model**, permissions. Stop appears only while the agent is working.
- Sidebar: New chat, Search, chats by day, then Schedules, Rooms, Settings.
- Agent replies are plain text, not boxes. Your messages are a soft tint.
- **New chat is the opening screen**: cursor in the box, everything set to
  what you used last. The folder is a picker of recent folders with "Choose
  another…", never a typed path. The agent starts in the background while you
  type, shown by the lamp under the box.

## The comps

`node design/comps/build.mjs` writes them beside the script.

| File | What |
|---|---|
| `comps/chat-cream.html` | Chat at 1280 × 800: a tool call, a diff, a permission prompt, all five states |
| `comps/chat-studio.html` | The same in Studio |
| `comps/chat-glass.html` | The same in Glass |
| `comps/new-chat.html` | The new-chat screen in Cream, folder picker open |
| `comps/phone-chat.html` | The chat at 390 wide |

The comps load the fonts from Google Fonts for convenience; the app would
self-host them.
