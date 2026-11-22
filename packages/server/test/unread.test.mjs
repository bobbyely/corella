// Unread chats: a chat is unread when the agent finished a reply while nobody
// had it open, and opening it clears that. Kept in the database, so it
// survives a reload and every tab sees the same. Runs against dist.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";

let Store, SessionManager, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "corella-unread-"));
  process.env.CORELLA_DATA_DIR = dir;
  ({ Store } = await import("../dist/store.js"));
  ({ SessionManager } = await import("../dist/sessionManager.js"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const record = (id) => ({
  id, agentSessionId: null, providerId: "p", providerName: "P", cwd: "/tmp",
  title: id, status: "active", createdAt: 1, updatedAt: 1, titleLocked: false,
});

function setup(file, ...ids) {
  const store = new Store(join(dir, file));
  for (const id of ids) store.upsertSession(record(id));
  return { store, sessions: new SessionManager(store) };
}

const unread = (sessions, id) => sessions.list().find((s) => s.id === id).unread;

describe("unread chats", () => {
  it("starts read, and a reply with nobody watching makes it unread", () => {
    const { sessions } = setup("a.db", "c1");
    assert.equal(unread(sessions, "c1"), false);
    sessions.noteTurnEnd("c1", "end_turn");
    assert.equal(unread(sessions, "c1"), true);
    assert.equal(sessions.summary("c1").unread, true);
  });

  it("opening the chat clears it, and a reply while it is open stays read", () => {
    const { sessions } = setup("b.db", "c1");
    sessions.noteTurnEnd("c1", "end_turn");
    const close = sessions.view("c1");
    assert.equal(unread(sessions, "c1"), false);
    sessions.noteTurnEnd("c1", "end_turn");
    assert.equal(unread(sessions, "c1"), false);
    close();
    sessions.noteTurnEnd("c1", "end_turn");
    assert.equal(unread(sessions, "c1"), true);
  });

  it("stays read while any of two tabs has it open, and a double close is harmless", () => {
    const { sessions } = setup("c.db", "c1");
    const tabA = sessions.view("c1");
    const tabB = sessions.view("c1");
    tabA();
    tabA();
    sessions.noteTurnEnd("c1", "end_turn");
    assert.equal(unread(sessions, "c1"), false, "tab B still has it open");
    tabB();
    sessions.noteTurnEnd("c1", "end_turn");
    assert.equal(unread(sessions, "c1"), true);
  });

  it("does not count a turn ended only because the session was closing", () => {
    const { sessions } = setup("d.db", "c1");
    sessions.noteTurnEnd("c1", "closed");
    assert.equal(unread(sessions, "c1"), false);
    sessions.noteTurnEnd("c1", "error");
    assert.equal(unread(sessions, "c1"), true, "a failed turn is still something to look at");
  });

  it("marks only the chat that replied, and tells the lists", () => {
    const { sessions } = setup("e.db", "c1", "c2");
    let told = 0;
    sessions.onChange(() => told++);
    sessions.noteTurnEnd("c2", "end_turn");
    assert.equal(unread(sessions, "c1"), false);
    assert.equal(unread(sessions, "c2"), true);
    assert.equal(told, 1);
  });

  it("survives a restart", () => {
    const first = setup("f.db", "c1");
    first.sessions.noteTurnEnd("c1", "end_turn");
    const again = new SessionManager(new Store(join(dir, "f.db")));
    assert.equal(unread(again, "c1"), true);
  });

  it("adds the column to a database from 0.1.0, with every old chat read", () => {
    const file = join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, agent_session_id TEXT, provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    old.exec(`INSERT INTO sessions VALUES ('old', NULL, 'p', 'P', '/tmp', 'Old', 'active', 1, 1)`);
    old.close();
    const sessions = new SessionManager(new Store(file));
    assert.equal(unread(sessions, "old"), false);
    sessions.noteTurnEnd("old", "end_turn");
    assert.equal(unread(sessions, "old"), true);
  });
});
