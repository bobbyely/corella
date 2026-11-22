// A new chat's agent is slow to start, and the reader does not wait: these
// drive the real socket against a mock agent that takes a while to answer,
// then switch folder, close the tab, fail, or resume another chat mid-start.
// The server never holds an unsent message (the page keeps it in the box), so
// what must hold here is that only the start the page still wants is
// answered, an abandoned draft is closed, and a slow resume never takes the
// socket back from the chat on screen.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { WebSocket } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK = join(here, "..", "..", "..", "spike", "mock-agent.mjs");
const DELAY = 700;
const agent = { command: process.execPath, args: [MOCK] };
const providers = [
  { id: "slow", name: "Slow", ...agent, env: { MOCK_SESSION_DELAY_MS: String(DELAY), MOCK_LOAD_DELAY_MS: String(DELAY) } },
  { id: "fast", name: "Fast", ...agent },
  { id: "broken", name: "Broken", command: "/nonexistent/agent", args: [] },
];

let dir, store, sessions, server, url;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "kc-start-race-"));
  process.env.CORELLA_DATA_DIR = dir;
  writeFileSync(join(dir, "config.json"), JSON.stringify({ providers }));
  const { Store } = await import("../dist/store.js");
  const { SessionManager } = await import("../dist/sessionManager.js");
  const { attachWebSocket } = await import("../dist/ws.js");
  store = new Store(join(dir, "test.db"));
  sessions = new SessionManager(store);
  server = createServer();
  attachWebSocket(server, sessions, () => true);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${server.address().port}/ws`;
});
after(async () => {
  sessions?.closeAll();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(25);
  }
  return fn();
}

/** A browser tab: a real socket, and everything the server sent it. */
async function tab() {
  const ws = new WebSocket(url);
  const got = [];
  ws.on("message", (raw) => got.push(JSON.parse(String(raw))));
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  return {
    got,
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => new Promise((r) => (ws.once("close", r), ws.close())),
  };
}

function folder(name) {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return path;
}

/** Live sessions, drafts included: the registry is private, the test reads it anyway. */
const live = () => [...sessions.live.values()];

describe("a new chat whose agent is still starting", () => {
  it("answers only the latest open, and closes the draft of a folder switched away from", async () => {
    const a = folder("a");
    const b = folder("b");
    const t = await tab();
    t.send({ type: "open", requestId: "r-a", providerId: "slow", cwd: a, draft: true });
    await sleep(50);
    t.send({ type: "open", requestId: "r-b", providerId: "slow", cwd: b, draft: true });

    assert.ok(await until(() => t.got.some((m) => m.type === "session_opened")));
    await sleep(DELAY + 300); // long enough for the first start to have come up too
    const opened = t.got.filter((m) => m.type === "session_opened");
    assert.equal(opened.length, 1, "only the current start is answered");
    assert.equal(opened[0].requestId, "r-b");
    assert.equal(opened[0].session.cwd, b);
    assert.ok(!live().some((s) => s.cwd === a), "the superseded draft's agent is closed");
    assert.ok(!t.got.some((m) => m.type === "error"), "and nothing failed");
    await t.close();
  });

  it("closes the draft's agent when the tab closes before it is up", async () => {
    const e = folder("e");
    const t = await tab();
    t.send({ type: "open", requestId: "r-e", providerId: "slow", cwd: e, draft: true });
    await sleep(50);
    await t.close();
    await sleep(DELAY + 500);
    assert.ok(!live().some((s) => s.cwd === e), "no draft is left running");
  });

  it("says which start failed, and says nothing of one the page has left", async () => {
    const t = await tab();
    t.send({ type: "open", requestId: "r-fail", providerId: "broken", cwd: folder("f"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "error")));
    const failed = t.got.find((m) => m.type === "error");
    assert.equal(failed.requestId, "r-fail", "the page can tell it is this start's failure");

    // A failure for a start already superseded must not land on the next one.
    t.got.length = 0;
    t.send({ type: "open", requestId: "r-old", providerId: "broken", cwd: folder("g"), draft: true });
    t.send({ type: "open", requestId: "r-new", providerId: "slow", cwd: folder("h"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "session_opened")));
    assert.ok(!t.got.some((m) => m.type === "error"), "the old start's failure is not reported");
    await t.close();
  });

  it("fails a start for an agent no longer configured like any other, with its request id", async () => {
    const t = await tab();
    t.send({ type: "open", requestId: "r-gone", providerId: "removed-since", cwd: folder("gone"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "error")));
    assert.equal(t.got.find((m) => m.type === "error").requestId, "r-gone");
    await t.close();
  });

  it("fails a start on a broken config.json with its request id too", async () => {
    const config = join(dir, "config.json");
    writeFileSync(config, "{ not json");
    try {
      const t = await tab();
      t.send({ type: "open", requestId: "r-config", providerId: "fast", cwd: folder("config"), draft: true });
      assert.ok(await until(() => t.got.some((m) => m.type === "error")));
      assert.equal(t.got.find((m) => m.type === "error").requestId, "r-config");
      await t.close();
    } finally {
      writeFileSync(config, JSON.stringify({ providers }));
    }
  });

  it("lets go of a ready draft as soon as another start begins, even one that then fails", async () => {
    const t = await tab();
    t.send({ type: "open", requestId: "r-ready", providerId: "fast", cwd: folder("ready"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "session_opened")));
    const ready = t.got.find((m) => m.type === "session_opened").session.id;
    t.send({ type: "open", requestId: "r-broken", providerId: "broken", cwd: folder("broken"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "error")));
    assert.equal(sessions.getLive(ready), null, "the draft left behind is closed");
    await t.close();
  });

  it("never sends anything to the agent by itself", async () => {
    const t = await tab();
    t.send({ type: "open", requestId: "r-q", providerId: "slow", cwd: folder("q"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "session_opened")));
    const id = t.got.find((m) => m.type === "session_opened").session.id;
    await sleep(200);
    const said = sessions.getLive(id).eventsSince(0).filter((e) => e.type === "user_message");
    assert.equal(said.length, 0, "a message is the page's to send, once the agent is up");
    assert.equal(store.getSession(id), null, "and the draft is not saved until it is");
    await t.close();
  });
});

describe("a resume that finishes after the reader moved on", () => {
  it("does not take the socket from the chat now on screen, nor close its draft", async () => {
    // A stored chat on the slow agent, detached, to be resumed.
    const old = await sessions.open(providers[0], folder("old"));
    await old.prompt("kiro-commands");
    sessions.detach(old.id);

    const t = await tab();
    t.send({ type: "resume", sessionId: old.id, sinceSeq: 0 });
    await sleep(50);
    t.send({ type: "open", requestId: "r-new", providerId: "fast", cwd: folder("new"), draft: true });
    assert.ok(await until(() => t.got.some((m) => m.type === "session_opened")));
    const fresh = t.got.find((m) => m.type === "session_opened").session.id;

    assert.ok(await until(() => sessions.getLive(old.id) !== null), "the resume itself completes");
    await sleep(300);
    assert.ok(sessions.getLive(fresh), "the new chat's draft is still open");
    const stale = t.got.filter((m) => (m.type === "events" && m.sessionId === old.id) || (m.type === "session_state" && m.session.id === old.id));
    assert.equal(stale.length, 0, "nothing of the resumed chat is shown on this socket");
    await t.close();
  });
});
