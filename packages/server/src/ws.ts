import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  causeOf,
  kcError,
  parseClientMessage,
  type ClientMessage,
  type KcError,
  type ServerMessage,
} from "@corella/shared";
import { loadConfig } from "./config.js";
import { defaultCwd, type Session } from "./session.js";
import { SessionManager } from "./sessionManager.js";

/**
 * WebSocket transport for chat.
 *
 * The socket is a view onto sessions, never their owner: subscriptions are torn
 * down on disconnect but the session and any running turn survive, and a
 * returning client catches up by `seq`.
 *
 * It views one conversation at a time. Switching is a `subscribe`, not a new
 * socket — the connection outlives the switch.
 */
const WS_PATH = "/ws";

/**
 * A new chat's agent being started for this socket, and the first message
 * held for it. One per socket: any later open, adopt, subscribe or resume
 * replaces it, which is how a slow start learns it was left.
 */
interface Start {
  requestId: string;
  held: Array<{ text: string; images: Array<{ mime: string; data: string }>; files: string[] }>;
  /** Set once the agent is up; a message held after that goes straight to it. */
  session: Session | null;
}

/** What one socket is doing, as the frame handlers need to know it. */
export interface SocketView {
  /** Shows this chat on the socket, in place of whatever it showed. */
  watch(sessionId: string): void;
  /** The start in flight, if the socket is waiting on one. */
  start: Start | null;
  /** Set when the socket closes, so a start that finishes later is not shown on it. */
  closed: boolean;
}

export function attachWebSocket(
  server: Server,
  sessions: SessionManager,
  originAllowed: (req: IncomingMessage) => boolean,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // Our own path: in development Vite serves the page and owns the root
    // socket for hot reload, so sharing "/" would collide.
    const path = (req.url ?? "/").split("?")[0];
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => handleConnection(ws, sessions));
}

function handleConnection(ws: WebSocket, sessions: SessionManager): void {
  const unsubscribers: Array<() => void> = [];
  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  // Keep every client's conversation list live, so status shows without a refresh.
  // Each socket remembers whether it wants archived rows, so live pushes match
  // what it last asked for.
  const prefs = { includeArchived: false };
  unsubscribers.push(
    sessions.onChange(() => send({ type: "sessions", sessions: sessions.list(100, prefs.includeArchived) })),
  );

  // A socket watches one conversation at a time, so `subscribe` replaces rather
  // than adds. Accumulating them would stream a background session's turn into
  // whichever transcript the reader has since switched to.
  let watching: Array<() => void> = [];
  const watch = (sessionId: string) => {
    // A frame still awaiting when the socket closed must not take a view:
    // nothing would release it, and a draft held open by it never closes.
    if (view.closed) return;
    // Viewing counts for a chat restored from disk too: opening it reads it.
    // Taken before the old view is let go, so watching the same chat again
    // never drops its count to zero, which would close a new chat's draft.
    const viewing = sessions.view(sessionId);
    for (const off of watching) off();
    watching = [viewing];
    const live = sessions.getLive(sessionId);
    if (!live) return; // restored from disk: a transcript, with nothing live to add
    watching.push(live.subscribe((events) => send({ type: "events", sessionId: live.id, events })));
    watching.push(live.onStateChange(() => send({ type: "session_state", session: live.summary() })));
  };
  unsubscribers.push(() => {
    for (const off of watching) off();
    watching = [];
  });
  const view: SocketView = { watch, start: null, closed: false };

  ws.on("message", (raw) => {
    void handleFrame(String(raw), sessions, send, view, prefs);
  });

  ws.on("close", () => {
    view.closed = true;
    // Drop subscriptions only. Sessions and in-flight turns outlive the socket.
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
  });
}

/**
 * Everything one inbound frame does, and the promise that it does not throw.
 *
 * Exported so the suite can drive the door directly: a frame from the browser
 * is untrusted input, and a bad one must become an `error` message to that
 * client rather than an unhandled rejection in a socket listener.
 */
export async function handleFrame(
  raw: string,
  sessions: SessionManager,
  send: (msg: ServerMessage) => void,
  view: SocketView,
  prefs: { includeArchived: boolean },
): Promise<void> {
  const fail = (error: KcError, sessionId?: string) => send({ type: "error", error, sessionId });

  const parsed = parseClientMessage(raw);
  if (!parsed.ok) {
    // Named at the door, with the offending field, rather than surfacing three
    // calls deep as "cannot read properties of undefined".
    return fail(kcError("MESSAGE_INVALID", `Rejected a message: ${parsed.problem}.`, { cause: parsed.cause }));
  }
  const msg = parsed.value;

  try {
    await dispatch(msg, sessions, send, view, prefs);
  } catch (err) {
    const error =
      typeof err === "object" && err !== null && "code" in err
        ? (err as KcError)
        : kcError("INTERNAL", "Unhandled server error.", { cause: causeOf(err) });
    fail(error, "sessionId" in msg ? msg.sessionId : undefined);
  }
}

async function dispatch(
  msg: ClientMessage,
  sessions: SessionManager,
  send: (msg: ServerMessage) => void,
  view: SocketView,
  prefs: { includeArchived: boolean },
): Promise<void> {
  const { watch } = view;
  // Each of these changes which chat the socket shows, so a start still in
  // flight is no longer the one the reader is waiting for.
  if (msg.type === "open" || msg.type === "adopt" || msg.type === "subscribe" || msg.type === "resume") view.start = null;

  switch (msg.type) {
    case "open": {
      const provider = loadConfig().providers.find((p) => p.id === msg.providerId);
      if (!provider) {
        throw kcError("PROVIDER_UNKNOWN", `No provider configured with id '${msg.providerId}'.`);
      }
      const start: Start = { requestId: msg.requestId ?? randomUUID(), held: [], session: null };
      view.start = start;
      const current = () => !view.closed && view.start === start;
      let session: Session;
      try {
        session = await sessions.open(provider, msg.cwd, sessions.withNewChatDefaults(msg.start), msg.draft ?? false);
      } catch (err) {
        // A start the reader has left is not theirs to be told about: the
        // error would land on whatever chat is on screen now.
        if (current()) throw err;
        return;
      }
      // Only once the agent is up: a start that failed is not one to repeat.
      sessions.rememberStart(provider.id, msg.start ?? {});
      start.session = session;
      // Sent whether or not anyone still watches: once said, it is a chat,
      // and the server owns it (invariant 4).
      for (const m of start.held.splice(0)) void session.prompt(m.text, m.images, m.files);
      if (!current()) {
        // Left mid-start, by a folder switch, another chat or a closed tab.
        sessions.closeIfDraft(session.id);
        return;
      }
      // Watched from here rather than from the browser's `subscribe`, so a
      // draft whose socket closes first is still let go, and closed.
      if (msg.draft) watch(session.id);
      send({ type: "session_opened", session: session.summary(), requestId: start.requestId });
      return;
    }

    case "hold_first": {
      const start = view.start;
      if (!start || start.requestId !== msg.requestId) {
        throw kcError("SESSION_UNKNOWN", "That new chat is no longer starting.", {
          remediation: "Send the message again from the chat on screen.",
        });
      }
      const message = { text: msg.text, images: msg.images ?? [], files: msg.files ?? [] };
      if (start.session) void start.session.prompt(message.text, message.images, message.files);
      else start.held.push(message);
      send({ type: "held", requestId: msg.requestId });
      return;
    }

    case "adopt": {
      const provider = loadConfig().providers.find((p) => p.id === msg.providerId);
      if (!provider) {
        throw kcError("PROVIDER_UNKNOWN", `No provider configured with id '${msg.providerId}'.`);
      }
      const start: Start = { requestId: randomUUID(), held: [], session: null };
      view.start = start;
      const session = await sessions.adopt(provider, {
        agentSessionId: msg.agentSessionId,
        cwd: msg.cwd,
        title: msg.title ?? null,
      });
      // Not a draft, so nothing to close; only not to be shown over what the reader moved on to.
      if (view.closed || view.start !== start) return;
      send({ type: "session_opened", session: session.summary() });
      return;
    }

    case "subscribe": {
      // Read the backlog before watching, so the switch away from any previous
      // conversation happens first and its events cannot land in this batch.
      // Both calls are synchronous, so nothing can be appended in between.
      const backlog = sessions.eventsSince(msg.sessionId, msg.sinceSeq);
      watch(msg.sessionId);
      send({ type: "events", sessionId: msg.sessionId, events: backlog });
      send({ type: "session_state", session: sessions.summary(msg.sessionId) });
      return;
    }

    case "rename_session": {
      sessions.rename(msg.sessionId, msg.title);
      send({ type: "sessions", sessions: sessions.list() });
      return;
    }

    case "list_sessions": {
      prefs.includeArchived = msg.includeArchived ?? false;
      send({ type: "sessions", sessions: sessions.list(100, prefs.includeArchived) });
      return;
    }

    case "command_options": {
      const session = sessions.getLive(msg.sessionId);
      const options = session ? await session.commandOptions(msg.command, msg.partial) : [];
      send({ type: "command_options_result", command: msg.command, partial: msg.partial, options });
      return;
    }

    case "search": {
      send({ type: "search_results", query: msg.query, hits: sessions.search(msg.query) });
      return;
    }

    case "archive_session": {
      sessions.setArchived(msg.sessionId, msg.archived);
      send({ type: "sessions", sessions: sessions.list(100, prefs.includeArchived) });
      return;
    }

    case "list_workspaces": {
      // Directories previously worked in, so a new chat can be pointed at one.
      send({
        type: "workspaces",
        workspaces: sessions.recentWorkspaces(),
        current: defaultCwd(),
        lastProviderId: sessions.lastProviderId(),
      });
      return;
    }

    case "remember_opening": {
      sessions.rememberStart(msg.providerId, { opening: msg.opening });
      return;
    }

    case "resume": {
      const record = sessions.summary(msg.sessionId);
      const provider = loadConfig().providers.find((p) => p.id === record.providerId);
      if (!provider) {
        throw kcError(
          "PROVIDER_UNKNOWN",
          `'${record.providerName}' is no longer configured, so this conversation cannot be reopened.`,
        );
      }
      const resumed = await sessions.resume(msg.sessionId, provider);
      // The same slot `subscribe` uses: resuming what you are already watching
      // must not leave you subscribed to it twice.
      watch(resumed.id);
      send({ type: "events", sessionId: resumed.id, events: resumed.eventsSince(msg.sinceSeq) });
      send({ type: "session_state", session: resumed.summary() });
      return;
    }

    case "prompt": {
      const session = sessions.requireLive(msg.sessionId);
      send({ type: "session_state", session: { ...session.summary(), busy: true } });
      await session.prompt(msg.text, msg.images ?? [], msg.files ?? [], msg.quiet ?? false);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "set_config_option": {
      const session = sessions.requireLive(msg.sessionId);
      await session.setConfigOption(msg.configId, msg.value);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "switch_provider": {
      const provider = loadConfig().providers.find((p) => p.id === msg.providerId);
      if (!provider) throw kcError("PROVIDER_UNKNOWN", `No provider configured with id '${msg.providerId}'.`);
      const session = await sessions.switchProvider(msg.sessionId, provider);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "permission_response": {
      sessions.requireLive(msg.sessionId).resolvePermission(msg.requestId, msg.optionId);
      return;
    }

    case "elicitation_response": {
      sessions
        .requireLive(msg.sessionId)
        .resolveElicitation(msg.requestId, msg.action, msg.content);
      return;
    }

    case "set_auto_approve": {
      const session = sessions.requireLive(msg.sessionId);
      session.setAutoApprove(msg.enabled);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "unqueue": {
      const session = sessions.requireLive(msg.sessionId);
      session.unqueue(msg.index);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "edit_queued": {
      const session = sessions.requireLive(msg.sessionId);
      session.editQueued(msg.index, msg.text);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "move_queued": {
      const session = sessions.requireLive(msg.sessionId);
      session.moveQueued(msg.from, msg.to);
      send({ type: "session_state", session: session.summary() });
      return;
    }

    case "cancel": {
      await sessions.requireLive(msg.sessionId).cancel();
      return;
    }

    case "interrupt": {
      await sessions.requireLive(msg.sessionId).interrupt(msg.text, msg.images ?? [], msg.files ?? []);
      return;
    }
  }
}
