import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Outbox, type Outgoing } from "../outbox.ts";

const message = (text: string): Outgoing => ({ text, images: [], files: [] });

describe("Outbox", () => {
  it("holds a message sent before the agent is ready and delivers it exactly once", () => {
    const box = new Outbox();
    const sent: string[] = [];
    box.hold(message("fix the parser"));
    assert.equal(box.waiting?.text, "fix the parser");
    // Ready can be seen more than once: a re-render, a second state update.
    box.deliver((m) => sent.push(m.text));
    box.deliver((m) => sent.push(m.text));
    assert.deepEqual(sent, ["fix the parser"]);
    assert.equal(box.waiting, null);
  });

  it("joins two messages sent while waiting, so neither is lost", () => {
    const box = new Outbox();
    box.hold(message("one"));
    box.hold({ text: "two", images: [{ mime: "image/png", data: "x" }], files: ["a.ts"] });
    const sent: Outgoing[] = [];
    box.deliver((m) => sent.push(m));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.text, "one\n\ntwo");
    assert.equal(sent[0]!.images.length, 1);
    assert.deepEqual(sent[0]!.files, ["a.ts"]);
  });

  it("gives the message back when the agent fails to start, and then has nothing to send", () => {
    const box = new Outbox();
    box.hold(message("keep me"));
    assert.equal(box.takeBack()?.text, "keep me");
    const sent: string[] = [];
    box.deliver((m) => sent.push(m.text));
    assert.deepEqual(sent, []);
  });
});
