// The new-chat draft and the quiet effort command, against the mock agent:
// a draft is not saved until something is said, a message sent while it is
// still settling arrives once, and `/effort` never shows as something said.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK = join(here, "..", "..", "..", "spike", "mock-agent.mjs");
const provider = { id: "mock", name: "Mock", command: process.execPath, args: [MOCK] };

let Store, SessionManager, handleFrame, dir, store, sessions;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "kc-draft-"));
  process.env.CORELLA_DATA_DIR = dir;
  writeFileSync(join(dir, "config.json"), JSON.stringify({ providers: [provider] }));
  ({ Store } = await import("../dist/store.js"));
  ({ SessionManager } = await import("../dist/sessionManager.js"));
  ({ handleFrame } = await import("../dist/ws.js"));
  store = new Store(join(dir, "test.db"));
  sessions = new SessionManager(store);
});
after(() => {
  sessions?.closeAll();
  rmSync(dir, { recursive: true, force: true });
});

async function until(fn, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

/** A socket's worth of state: what was sent to it, and the chat it watches. */
function socket() {
  const sent = [];
  let release = () => {};
  const watch = (id) => {
    const next = sessions.view(id);
    release();
    release = next;
  };
  const frame = (msg) => handleFrame(JSON.stringify(msg), sessions, (m) => sent.push(m), watch, { includeArchived: false });
  return { sent, frame, leave: () => release() };
}

describe("a new chat's draft", () => {
  it("is not saved or listed until a message is sent, and a message sent while the opening settles arrives once", async () => {
    const tab = socket();
    await tab.frame({ type: "open", providerId: "mock", cwd: dir, start: { opening: "/effort high" }, draft: true });
    const opened = tab.sent.find((m) => m.type === "session_opened");
    assert.ok(opened, "the draft opens");
    const id = opened.session.id;
    const live = sessions.getLive(id);

    assert.equal(store.getSession(id), null, "nothing written before a message is sent");
    assert.ok(!sessions.list().some((s) => s.id === id), "nor listed");

    // Sent at once, while the quiet opening is still the turn in flight, and
    // the socket closed straight after, as a page navigating away would.
    const prompting = tab.frame({ type: "prompt", sessionId: id, text: "kiro-commands" });
    tab.leave();
    await prompting;

    const said = live.eventsSince(0).filter((e) => e.type === "user_message");
    assert.deepEqual(
      said.map((e) => [e.text, e.quiet === true]),
      [["/effort high", true], ["kiro-commands", false]],
      "the opening ran quietly, then the message, exactly once",
    );
    assert.ok(store.getSession(id), "a message makes it a chat");
    assert.ok(sessions.list().some((s) => s.id === id), "and lists it");
    assert.equal(
      store.eventsSince(id, 0).length,
      live.eventsSince(0).length,
      "everything held in memory was written, quiet turn included",
    );
    assert.equal(store.getSession(id).title, "Kiro-commands", "named by what was said, not by /effort");
    assert.ok(sessions.getLive(id), "a real chat stays open when you look away");
  });

  it("is closed, leaving nothing behind, when it is left before anything is said", async () => {
    const tab = socket();
    await tab.frame({ type: "open", providerId: "mock", cwd: dir, draft: true });
    const id = tab.sent.find((m) => m.type === "session_opened").session.id;
    assert.ok(sessions.getLive(id));
    tab.leave();
    assert.equal(sessions.getLive(id), null, "the agent is let go");
    assert.equal(store.getSession(id), null);
    assert.equal(store.eventsSince(id, 0).length, 0);
  });

  it("survives being watched again by the same socket", async () => {
    const tab = socket();
    await tab.frame({ type: "open", providerId: "mock", cwd: dir, draft: true });
    const id = tab.sent.find((m) => m.type === "session_opened").session.id;
    await tab.frame({ type: "subscribe", sessionId: id, sinceSeq: 0 });
    assert.ok(sessions.getLive(id), "the browser's own subscribe must not close it");
    tab.leave();
  });
});

describe("a quiet command", () => {
  it("runs as a turn but is marked quiet, does not show as working, and does not name the chat", async () => {
    const session = await sessions.open(provider, dir);
    const busy = [];
    session.onStateChange(() => busy.push(session.summary().busy));
    await session.prompt("/effort max", [], [], true);
    const said = session.eventsSince(0).filter((e) => e.type === "user_message");
    assert.equal(said.length, 1);
    assert.equal(said[0].quiet, true);
    assert.ok(session.eventsSince(0).some((e) => e.type === "agent_text" && /Effort set to max/.test(e.text)));
    assert.ok(!busy.includes(true), "a setting being applied is not the agent at work");
    assert.equal(session.summary().title, null);
    await until(() => !session.summary().busy);
    await session.prompt("kiro-commands");
    assert.equal(session.summary().title, "Kiro-commands");
  });
});
