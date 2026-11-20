// A new chat's first message, typed before its agent is up. Used by Composer.
// Nothing unsent leaves the page: Enter marks the box's text to go when that
// one start is up, and anything else (another folder or agent, a failed
// start, a dropped socket, another chat, a reload) leaves it in the box,
// unsent. The text is kept in localStorage so a reload does not lose it.

/**
 * What a send did: went (true), could not go (false, the box keeps it), or
 * waits for the start `pendingOn` to be up, kept in the box until then.
 */
export type PromptResult = boolean | void | { pendingOn: string };

/**
 * What to do with a message waiting on the start `pendingOn`, given the start
 * the page is on now and whether its agent is up.
 */
export function waitingStep(pendingOn: string, current: string | null, ready: boolean): "send" | "wait" | "drop" {
  if (current !== pendingOn) return "drop"; // that start is gone: never send to another
  return ready ? "send" : "wait";
}

const NEW_CHAT_KEY = "corella.newChatDraft";

/** The new chat's unsent words from before a reload. */
export function readNewChat(store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string {
  try {
    return store?.getItem(NEW_CHAT_KEY) ?? "";
  } catch {
    return ""; // storage blocked: the box starts empty, as it would anyway
  }
}

export function keepNewChat(text: string, store: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage): void {
  try {
    if (text) store?.setItem(NEW_CHAT_KEY, text);
    else store?.removeItem(NEW_CHAT_KEY);
  } catch {
    // storage blocked: the words are still in the box, only not across a reload
  }
}
