# Review log

One row per review, newest first. The point is the **range**: the next review
starts where the last one ended, so nothing is silently skipped and nothing is
re-read for free.

Record a review whether or not it found anything — "reviewed, nothing found" is
a useful fact, and an absent row is indistinguishable from a skipped review.

| Date | Reviewed through | Range since previous | Findings | Notes |
|---|---|---|---|---|
| 2026-11-20 | `c267bcb` | `530c370..c267bcb` (2 commits), the redesign and its first fixes | 3 — two high, one medium; two fixed, one recorded | Codex again. Fixed: Interrupt & send still cleared the box on a closed socket; a broken `config.json` failed a start without its request id. Recorded, not fixed: a frame written to an open socket that dies before the server reads it is lost while the box clears. Every ordinary send in Corella has had that window; closing it means prompt ids and server acknowledgements, a protocol change for its own pull request. No problems found in the view generation or the game sheet's cue. |
| 2026-11-20 | `a1b2e02` | `530c370..a1b2e02` (1 commit), the replacement first-message design | 5 — two high, three medium; all fixed | Codex, run on the redesign. High: a ready draft whose socket dropped was closed by the server while the page still sent to it; a send on a closed socket cleared the box. Medium: a sent first message stayed saved as unsent; a provider no longer configured failed without its request id, leaving the page on "Starting…"; a draft replaced by a start that then failed kept running. No problems found in the view generation's post-await checks or the game sheet's cue. |
| 2026-11-20 | `530c370` | `b6abdef..530c370` (7 commits), the fixes for the two rows below | 7 — the startup-delivery design unsafe in five ways, plus two; all fixed by replacing it | Codex re-reviewed the fixes. The quiet-turn, build-input, auto-check and UI fixes held. The server-held first message did not: a lost `held` sent it twice, a reconnect started a second draft, a failed start after the page left lost it, an unrelated error gave back a confirmed message, and a failed start left the page on "Starting…". Also a late resume could take the socket from the chat on screen, and the game sheet's cue missed drafts and second askers. Replaced rather than patched: the server never holds an unsent message (the page keeps it in the box until that start is up), startup errors carry their request id, a failed start ends, every view change bumps a per-socket generation, and the chat on screen reports its open questions to the sheet. |
| 2026-11-20 | `b6abdef` | `aa353a9..b6abdef` (5 commits), a re-audit of the same UI | 5 design findings (two P2, three P3); all fixed | The impeccable design audit again, after the first round's fixes (17/20, up from 15). P2: on a phone the word-game sheet covered a permission prompt's keys (it now closes when the agent asks, and "Agent needs you" is a button to the question); Auto-approve scrolled out of sight in the composer row beside an open pane (now beside Send). P3: the sidebar's shortcuts never showed at the default width; at 200% text chat titles collapsed to "L…"; the effort and mode selects were 22px in 44px pills. Each checked in Chromium by hit tests and measurements. |
| 2026-11-20 | `b6abdef` | `aa353a9..b6abdef`, read as the whole 0.2.0 branch (PR #10) | 6 — two high, four medium; all fixed | A Codex code review. High: a new chat's slow start could answer after a folder switch and take the next message to the wrong folder; a message sent mid-start lived only in the page and was lost on a reload or a switch of chat (now held on the server, `hold_first`). Medium: a tab closed mid-start left the draft agent running; a quiet turn hid its own permission prompts and Stop; edits to `packages/web/public` did not trigger a rebuild; an overtaken automatic check could overwrite the current result. Each fixed with a test that fails without it (`startRace.test.mjs` drives the real socket with a slow mock start). The first-message fix was later replaced; see the next row up. |
| 2026-11-20 | `aa353a9` | the 0.2.0 branch (PR #10) | 15 design findings (P1: contrast; P2: focus, labels, phone layout, 200% text; P3: three small) plus 2 from the owner; all fixed | A design and accessibility audit of the On Air UI (impeccable, 15/20), not a code read. Fixed: teal text below AA on Cream (a separate `onair-text` ink), Glass borrowing Studio's code colours, the faded check ladder, the games opening off screen on a phone, the phone chat list's focus, the clipped sidebar footer, unlabelled room and schedule fields, the message box's weak focus mark, focus lost after Choose another…, small touching Rename/Archive keys, px type that broke at 200% text, the side pane squeezing the chat at 1024, the Glass shortcut hint, the missing ⇧ glyph, and no cue from another tab; raw payloads hidden, Send live while a turn runs. `contrast.test.ts` now guards the token blocks. |
| 2026-11-20 | `e5fb883` | `bdc58c9..e5fb883` (15 commits) | 4 — one medium, three low; all fixed | A whole-repo security audit rather than a range read. Medium: no login on the local API, so any program on the machine could change a provider's command and run it (now a token, `auth.ts`). Low: the app could be framed; listing an agent's sessions was a spawning GET; a file named `x.constructor` blanked the app. Hardening in the same pass: private data folder, `autoApprove` type-checked, permission answers checked against the offer, auto-approve never takes a standing grant, `env` values masked. |
| 2026-09-14 | `bdc58c9` | `dbf75c0..bdc58c9` (1 commit) | 0 new; **the 7 remaining findings closed** | The rooms and scheduler batch from both earlier reviews, fixed together because they share the code: a room turn is capped (`withTimeout`, then cancel) and the view says when a participant is waiting on a permission answer; a released hold and a cut-in now act on the running round instead of trying to start a second one; messages are quoted so a reply cannot speak as the user; a failed participant spawn closes the ones before it; the scheduler's tick no longer awaits each run and records an overlap once. Fixing the cap turned up that `cancel()` never answered pending permission requests, which the spec says it MUST — that is fixed and noted in PROTOCOL.md. Windows reaping is not fixed: it says it is unsupported instead of silently doing nothing, and is recorded as debt. Each fix has its test and its gotcha. |
| 2026-09-14 | `dbf75c0` | `dedc8bc..dbf75c0` (3 commits) | 0 new; **14 of the 21 open findings fixed** | A fix pass over both earlier reviews rather than a fresh read — the range is only PR #27 (the Origin allowlist and `strictPort`), read while closing the `Host` hole beside it. Fixed, each with a test and a gotcha: `prompt()` resolving early (which broke scheduled runs with an opening message and corrupted room turns), no `turn_end` on a killed or closed turn, the missing `Host` check, auto-approve granting `allow_always`, the static-file read crash, `updateProvider` erasing dropped entries, `persistMeta` un-archiving, `outputByteLimit`, the export path, the schedule status literal, the empty `catch` in rooms, `oldText` absent-vs-empty, and `setAutoApprove` landing after the opening turn. Still open, under *Bugs to fix* in [PLAN.md](PLAN.md): the rooms batch (turn cap, hold/cut-in, message fencing, participant leak), the scheduler's per-minute `skipped` rows and serial tick, and Windows reaping. |
| 2026-09-14 | `dedc8bc` | `cd32fd1..dedc8bc` (33 commits) | 14 bugs — one serious (a scheduled run with an opening message records *ok* having done nothing), one widening a pre-existing hole (no `Host` check) | Two passes by sub-agents over the rooms, schedules, start options, command pickers, Changes pane and games: one adversarial, one against PLAN.md and the definition of done. All seven bugs from the first review confirmed still open (line refs drifted). Everything recorded under *Bugs to fix* and *Smaller, still open* in [PLAN.md](PLAN.md); nothing fixed here. Checked and clean: SQL parameterisation in the new tables, `DiffView`'s escaping, localStorage handling, body validation on the new routes, process lifetime for runs and participants, Origin coverage of the new routes. |
| 2026-09-10 | `cd32fd1` | `f7274a5..cd32fd1` (82 commits) | 10 — one serious, two breaking an invariant | Security-focused pass over `packages/`. Three fixed here; the rest are recorded under *Bugs to fix* in [PLAN.md](PLAN.md) rather than left in a review comment. Checked and clean: static-file path traversal, the export filename, FTS5 quoting, markdown sanitisation. |

## How to record one

After reviewing, add a row and commit it with the fixes:

```bash
git log -1 --format='%h  %ad' --date=short          # what you reviewed through
git log --oneline <previous>..HEAD | wc -l          # how many commits the range covered
```

- **Reviewed through** — the commit the review ended at, short hash.
- **Range since previous** — `<previous>..<this>`, so the next reviewer can
  replay exactly what was covered.
- **Findings** — a count, and a word on severity. Zero is a valid entry.
- **Notes** — anything deferred, and why. A deferred finding with no note is
  just a forgotten one.

## What to look for

See the *Periodic code review* section in [PLAN.md](PLAN.md). It lists the four
failure shapes this codebase has actually produced, which is more useful than a
generic checklist.

## When a review finds something

Fix it, add the test, and add the gotcha to [GOTCHAS.md](GOTCHAS.md). Every
entry in there exists because something was once wrong; a fix without one
invites the same bug from the next person who does not know.
