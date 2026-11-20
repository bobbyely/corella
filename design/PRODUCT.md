# Product

What Corella is, for design work. A draft: the owner confirms it before the
build. Lines marked *(inferred)* come from the README and the code, not from
the owner.

## Platform

Web.

## Stack

React and Vite single-page app (`packages/web`), served by a local Node server
on 127.0.0.1. No CSS framework: one `styles.css` built on custom-property
tokens.

## Users

- The owner: a developer who runs command-line coding agents on his own
  machine and works in this window for hours. Desktop now, phone later.
- Other developers who clone the public repo and point it at their own agents
  *(inferred)*.

## Product purpose

Give command-line coding agents a proper window: streamed answers, tool calls
and diffs you can read, permission prompts you can click, and every
conversation kept, searchable and resumable. Any agent that speaks the Agent
Client Protocol (ACP).

## Positioning

The feel of the desktop coding-agent apps, in a browser tab, for any agent,
running locally. Named after the corella, a chatty Australian cockatoo: several
agents, one window, lots of talk. Called KiroChrome before 0.1.0.

## Operating context

Long working sessions. Several chats run at once. The person switches between
them, answers permission prompts, reads diffs, and queues the next message
while an agent works. They glance at the sidebar to see which agent needs them.
Mostly a laptop or desktop screen; a phone later for checking in and answering
prompts.

## Capabilities and constraints

- Shows whatever models, modes and settings the agent advertises; never a
  hard-coded list.
- Chats, schedules (saved prompts on a timer), rooms (agents talking in
  turns), a Changes pane and a read-only Files pane.
- Starting a real agent takes seconds. The new-chat flow hides that wait.
- Fonts must be free to ship and self-hosted (OFL or similar). No outside
  scripts, no trackers.
- Themes are per-browser preferences; each theme is a token set only.

## Brand commitments

- The name is Corella.
- The On Air direction, with Whipbird as its sibling: cream hardware body,
  few strong colours, a glowing glass readout, raised keys only where a press
  matters.
- More than light and dark: at least three themes, named plainly.
- Red means "you are needed" (and errors). Nothing else is red.
- No AI-service dependency, no telemetry.

## Product principles

- The agent's work is the content; the chrome stays out of its way.
- Never make the person guess state: who is working, who is waiting, what
  changed.
- One click to a routine start. The app opens ready to type.

## Accessibility and inclusion

WCAG AA contrast in every theme. State never shown by colour alone: every
state has a word and a shape. Body text 14px or larger. Respects reduced
motion and the browser's font size.
