// Agents are checked without anyone pressing Check: once per provider as the
// server sees it, and again when its command changes.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK = join(here, "..", "..", "..", "spike", "mock-agent.mjs");

let AutoCheck, store, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "kc-autocheck-"));
  process.env.CORELLA_DATA_DIR = dir;
  ({ AutoCheck } = await import("../dist/autoCheck.js"));
  const { Store } = await import("../dist/store.js");
  store = new Store(join(dir, "test.db"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function until(fn, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !fn()) await new Promise((r) => setTimeout(r, 25));
  return fn();
}

it("checks a provider once in each form it takes, and records the result", async () => {
  const checks = new AutoCheck(store);
  const broken = { id: "p", name: "P", command: "/nonexistent/agent", args: [] };
  checks.run([broken]);
  assert.equal(checks.checking("p"), true);
  assert.ok(await until(() => !checks.checking("p")));
  assert.equal(store.lastCheck("p")?.status, "failed");

  checks.run([broken]);
  assert.equal(checks.checking("p"), false, "the same command is not checked twice");

  checks.run([{ ...broken, command: process.execPath, args: [MOCK] }]);
  assert.equal(checks.checking("p"), true, "a changed command is checked again");
  assert.ok(await until(() => !checks.checking("p")));
  assert.equal(store.lastCheck("p")?.status, "ok");
});

it("keeps only the latest form's result when a provider changes while its check runs", async () => {
  const checks = new AutoCheck(store);
  const slow = { id: "q", name: "Q", command: process.execPath, args: [MOCK], env: { MOCK_SESSION_DELAY_MS: "1500" } };
  const broken = { ...slow, command: "/nonexistent/agent", args: [] };

  // An old, slow check that would pass, overtaken by a fast one that fails.
  checks.run([slow]);
  checks.run([broken]);
  assert.ok(await until(() => !checks.checking("q")));
  assert.equal(store.lastCheck("q")?.status, "failed");
  await new Promise((r) => setTimeout(r, 2_500)); // the slow one has finished by now
  assert.equal(store.lastCheck("q")?.status, "failed", "the superseded check does not overwrite the current one");

  // And the other way: the old check ending must not say the new one is done.
  checks.run([{ ...broken, args: ["x"] }]);
  checks.run([slow]);
  await new Promise((r) => setTimeout(r, 300)); // the broken one has failed by now
  assert.equal(checks.checking("q"), true, "still checking the current form");
  assert.ok(await until(() => !checks.checking("q")));
  assert.equal(store.lastCheck("q")?.status, "ok");
});
