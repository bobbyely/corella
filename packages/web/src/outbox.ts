// The new chat's first message, when it is sent before the agent is up.
// Used by Chat.tsx: the agent starts in the background as soon as a new chat
// opens, and Enter must not wait for it. The message is held here, shown under
// "Starting <agent>…", and handed over exactly once when the chat is ready.
// Browser-side on purpose: there is no conversation on the server to hold it
// until the agent has started.

export interface Outgoing {
  text: string;
  images: Array<{ mime: string; data: string }>;
  files: string[];
}

export class Outbox {
  private held: Outgoing | null = null;

  /** What is waiting, for the page to show. */
  get waiting(): Outgoing | null {
    return this.held;
  }

  /** Keeps the message until `deliver` is called. A second hold adds to the first. */
  hold(message: Outgoing): void {
    this.held = this.held
      ? {
          text: `${this.held.text}\n\n${message.text}`,
          images: [...this.held.images, ...message.images],
          files: [...this.held.files, ...message.files],
        }
      : message;
  }

  /** Sends what is held, if anything. Calling it again sends nothing. */
  deliver(send: (message: Outgoing) => void): void {
    const message = this.held;
    if (!message) return;
    this.held = null;
    send(message);
  }

  /** The start failed: gives the message back, to put in the box again. */
  takeBack(): Outgoing | null {
    const message = this.held;
    this.held = null;
    return message;
  }
}
