import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepNewChat, readNewChat, waitingStep } from "../firstMessage.ts";

describe("a message typed before the agent is up", () => {
  it("goes only when the start it waits on is up", () => {
    assert.equal(waitingStep("r1", "r1", false), "wait");
    assert.equal(waitingStep("r1", "r1", true), "send");
  });

  it("is dropped back to the box, never sent, when that start is gone", () => {
    // Superseded by another folder or agent, or reopened after a dropped socket.
    assert.equal(waitingStep("r1", "r2", true), "drop");
    // Failed, or another chat opened.
    assert.equal(waitingStep("r1", null, false), "drop");
  });
});

describe("the new chat's unsent words", () => {
  it("survive a reload, and are forgotten once sent", () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    keepNewChat("fix the parser", store);
    assert.equal(readNewChat(store), "fix the parser");
    keepNewChat("", store);
    assert.equal(readNewChat(store), "");
  });

  it("cost nothing when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    assert.equal(readNewChat(blocked), "");
    assert.doesNotThrow(() => keepNewChat("x", blocked));
  });
});
