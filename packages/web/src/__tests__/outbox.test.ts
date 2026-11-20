import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Outbox, type Outgoing } from "../outbox.ts";

const message = (text: string): Outgoing => ({ text, images: [], files: [] });

describe("Outbox", () => {
  it("shows two messages sent while waiting joined, so neither is lost from view", () => {
    const box = new Outbox();
    box.hold(message("one"));
    box.hold({ text: "two", images: [{ mime: "image/png", data: "x" }], files: ["a.ts"] });
    assert.equal(box.waiting?.text, "one\n\ntwo");
    assert.equal(box.waiting?.images.length, 1);
    assert.deepEqual(box.waiting?.files, ["a.ts"]);
  });

  it("gives everything back when the agent fails to start, and then holds nothing", () => {
    const box = new Outbox();
    box.hold(message("keep me"));
    box.confirm();
    assert.equal(box.takeBack()?.text, "keep me");
    assert.equal(box.waiting, null);
    assert.equal(box.takeBack(), null);
  });

  it("gives back only what the server never confirmed when the socket drops, so nothing is sent twice", () => {
    const box = new Outbox();
    box.hold(message("confirmed"));
    box.hold(message("in flight"));
    box.confirm();
    assert.equal(box.takeBackUnconfirmed()?.text, "in flight");
    assert.equal(box.waiting?.text, "confirmed", "still shown: the server will send it");
    assert.equal(box.takeBackUnconfirmed(), null);
  });

  it("forgets what it held when another chat is opened: the server delivers it", () => {
    const box = new Outbox();
    box.hold(message("theirs now"));
    box.clear();
    assert.equal(box.waiting, null);
    assert.equal(box.takeBack(), null);
  });
});
