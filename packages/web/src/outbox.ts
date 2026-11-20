// The new chat's first message, when it is sent before the agent is up: the
// browser's copy of what the server is holding for it (`hold_first`).
// Used by useChat. The server owns delivery, so the message survives a switch
// of chat or a reload; this copy is only what to show under "Starting…", and
// what to put back in the box if the server never got it, or the start failed.

export interface Outgoing {
  text: string;
  images: Array<{ mime: string; data: string }>;
  files: string[];
}

const join = (messages: Outgoing[]): Outgoing | null =>
  messages.length === 0
    ? null
    : {
        text: messages.map((m) => m.text).join("\n\n"),
        images: messages.flatMap((m) => m.images),
        files: messages.flatMap((m) => m.files),
      };

export class Outbox {
  private messages: Outgoing[] = [];
  /** How many the server has confirmed. It answers in order, so these are the first ones. */
  private confirmed = 0;

  /** What is waiting, for the page to show. A second message is shown joined to the first. */
  get waiting(): Outgoing | null {
    return join(this.messages);
  }

  /** Sent to the server; shown until the chat's log has it. */
  hold(message: Outgoing): void {
    this.messages.push(message);
  }

  /** The server answered `held` for one more. */
  confirm(): void {
    this.confirmed = Math.min(this.confirmed + 1, this.messages.length);
  }

  /** The start failed: the server sends none of it, so all of it goes back in the box. */
  takeBack(): Outgoing | null {
    const all = join(this.messages);
    this.clear();
    return all;
  }

  /**
   * The socket dropped: what the server confirmed it will still send, so only
   * the rest comes back. Giving back a confirmed one would send it twice.
   */
  takeBackUnconfirmed(): Outgoing | null {
    const lost = join(this.messages.slice(this.confirmed));
    this.messages = this.messages.slice(0, this.confirmed);
    return lost;
  }

  /** Another chat is on screen: whatever was held is the server's to deliver. */
  clear(): void {
    this.messages = [];
    this.confirmed = 0;
  }
}
