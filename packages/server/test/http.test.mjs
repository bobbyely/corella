// The HTTP server end to end: who may call it, and what it sends back. The
// Origin check (origin.test.mjs) stops other web pages; the token stops every
// other program on the machine, which sends no Origin at all.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";

let dir, web, server, port, token, base;

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "kc-http-"));
  web = mkdtempSync(join(tmpdir(), "kc-web-"));
  writeFileSync(join(web, "index.html"), "<!doctype html><title>app</title>");
  process.env.CORELLA_DATA_DIR = dir;
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ providers: [{ id: "p", name: "P", command: "/bin/true", args: [], env: { API_KEY: "sk-secret-value" } }] }),
  );
  const { startServer } = await import("../dist/http.js");
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = startServer(port, web);
  await new Promise((resolve) => server.once("listening", resolve));
  token = readFileSync(join(dir, "token"), "utf8").trim();
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
  rmSync(web, { recursive: true, force: true });
});

const cookie = () => ({ cookie: `corella_token_${port}=${token}` });

describe("the login token", () => {
  it("refuses the API, the page and a config change without it", async () => {
    const api = await fetch(`${base}/api/providers`);
    assert.equal(api.status, 401);
    assert.equal((await api.json()).error.code, "AUTH_REQUIRED");

    assert.equal((await fetch(`${base}/`)).status, 401);

    const patch = await fetch(`${base}/api/providers/p`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "/bin/sh", args: ["-c", "echo pwned"] }),
    });
    assert.equal(patch.status, 401);
    assert.match(readFileSync(join(dir, "config.json"), "utf8"), /\/bin\/true/);
  });

  it("refuses a wrong token, and a near miss", async () => {
    assert.equal((await fetch(`${base}/?token=nope`, { redirect: "manual" })).status, 401);
    const near = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    assert.equal((await fetch(`${base}/api/providers`, { headers: { authorization: `Bearer ${near}` } })).status, 401);
  });

  it("trades the link's token for an HttpOnly, SameSite=Strict cookie and a clean URL", async () => {
    const res = await fetch(`${base}/chat/x?token=${token}&keep=1`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/chat/x?keep=1");
    const set = res.headers.get("set-cookie");
    assert.match(set, new RegExp(`^corella_token_${port}=${token};`));
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
  });

  it("shows a provider's env names but never its values", async () => {
    const res = await fetch(`${base}/api/providers`, { headers: cookie() });
    const text = await res.text();
    assert.doesNotMatch(text, /sk-secret-value/);
    assert.deepEqual(JSON.parse(text).providers[0].env, { API_KEY: "(hidden)" });
  });

  it("accepts the cookie, or a Bearer header from a script", async () => {
    assert.equal((await fetch(`${base}/api/providers`, { headers: cookie() })).status, 200);
    assert.equal((await fetch(`${base}/api/providers`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await fetch(`${base}/`, { headers: cookie() })).status, 200);
  });

  it("still applies the Origin check to a logged-in request", async () => {
    const res = await fetch(`${base}/api/providers`, { headers: { ...cookie(), origin: "https://example.com" } });
    assert.equal(res.status, 403);
  });

  it("gates the WebSocket the same way", async () => {
    const open = (headers) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
        ws.on("open", () => {
          ws.close();
          resolve(true);
        });
        ws.on("error", () => resolve(false));
      });
    assert.equal(await open({}), false);
    assert.equal(await open(cookie()), true);
  });
});

describe("what a logged-in browser is sent", () => {
  it("forbids framing the app, so a hidden frame cannot click its prompts", async () => {
    const res = await fetch(`${base}/`, { headers: cookie() });
    assert.equal(res.headers.get("content-security-policy"), "frame-ancestors 'none'");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });

  it("lists an agent's own sessions only on POST, since listing spawns it", async () => {
    // A GET can come from an <img> on any site; it must not start an agent.
    const get = await fetch(`${base}/api/providers/p/sessions`, { headers: cookie() });
    assert.equal(get.status, 404);
  });
});
