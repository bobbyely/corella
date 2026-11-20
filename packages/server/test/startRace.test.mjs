// A new chat's agent is slow to start, and the reader does not wait: these
// drive the real socket against a mock agent that takes a while to answer
// `session/new`, then switch folder, send, leave or close the tab mid-start.
// What must hold: the first message is never lost, never sent twice, never
// sent to the wrong chat, and no draft agent outlives the page that asked.
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
const provider = {
  id: "slow",
  name: "Slow",
  command: process.execPath,
  args: [MOCK],
  env: { MOCK_SESSION_DELAY_MS: String(DELAY) },
};

let dir, store, sessions, server, url;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "kc-start-race-"));
  process.env.CORELLA_DATA_DIR = dir;
  writeFileSync(join(dir, "config.json"), JSON.stringify({ providers: [provider] }));
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
const said = (id) => store.eventsSince(id, 0).filter((e) => e.type === "user_message").map((e) => e.text);

describe("a new chat whose agent is still starting", () => {
  it("answers only the latest open: a folder switched away from mid-start is closed, and the message goes to the new folder", async () => {
    const a = folder("a");
    const b = folder("b");
    const t = await tab();
    t.send({ type: "open", requestId: "r-a", providerId: "slow", cwd: a, draft: true });
    await sleep(50);
    t.send({ type: "open", requestId: "r-b", providerId: "slow", cwd: b, draft: true });
    t.send({ type: "hold_first", requestId: "r-b", text: "edit folder b" });

    assert.ok(await until(() => t.got.some((m) => m.type === "session_opened")));
    await sleep(DELAY + 300); // long enough for the first start to have answered too
    const opened = t.got.filter((m) => m.type === "session_opened");
    assert.equal(opened.length, 1, "only the current start is answered");
    assert.equal(opened[0].session.cwd, b);
    assert.equal(opened[0].requestId, "r-b");
    assert.ok(t.got.some((m) => m.type === "held" && m.requestId === "r-b"), "the message was acknowledged");

    const id = opened[0].session.id;
    assert.ok(await until(() => said(id).length === 1));
    assert.deepEqual(said(id), ["edit folder b"]);
    assert.ok(!live().some((s) => s.cwd === a), "the superseded draft's agent is closed");
    await t.close();
  });

  it("keeps a message sent mid-start when the tab reloads: it arrives once, in its own chat", async () => {
    const c = folder("c");
    const t = await tab();
    t.send({ type: "open", requestId: "r-c", providerId: "slow", cwd: c, draft: true });
    t.send({ type: "hold_first", requestId: "r-c", text: "survive the reload" });
    assert.ok(await until(() => t.got.some((m) => m.type === "held")));
    await t.close(); // the reload

    assert.ok(await until(() => live().some((s) => s.cwd === c && said(s.id).length > 0)));
    const chat = live().find((s) => s.cwd === c);
    await sleep(300);
    assert.deepEqual(said(chat.id), ["survive the reload"], "exactly once");
    assert.ok(sessions.list().some((s) => s.id === chat.id), "and listed, so the reloaded page finds it");
  });

  it("keeps a message sent mid-start when another chat is opened, without showing it there", async () => {
    const d = folder("d");
    const other = await sessions.open({ ...provider, env: {} }, folder("other"));
    await other.prompt("kiro-commands"); // a quick turn: the default one asks permission
    const t = await tab();
    t.send({ type: "open", requestId: "r-d", providerId: "slow", cwd: d, draft: true });
    t.send({ type: "hold_first", requestId: "r-d", text: "keep me" });
    t.send({ type: "subscribe", sessionId: other.id, sinceSeq: 0 });

    assert.ok(await until(() => live().some((s) => s.cwd === d && said(s.id).length > 0)));
    const chat = live().find((s) => s.cwd === d);
    await sleep(300);
    assert.deepEqual(said(chat.id), ["keep me"]);
    assert.deepEqual(said(other.id), ["kiro-commands"], "nothing landed in the chat on screen");
    assert.ok(!t.got.some((m) => m.type === "session_opened"), "the tab was not switched back");
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
});
