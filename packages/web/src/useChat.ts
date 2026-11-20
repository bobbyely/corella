import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  CommandOption,
  ElicitationAction,
  ElicitationValue,
  KcError,
  KcEvent,
  SearchHit,
  ServerMessage,
  SessionSummary,
  StartOptions,
} from "@corella/shared";

/**
 * Owns the WebSocket and mirrors the server's event log.
 *
 * The browser holds no authoritative state: it accumulates events by `seq` and
 * renders them. On reconnect it re-subscribes from its high-water mark, so a
 * dropped socket costs nothing — the turn kept running on the server.
 */
export function useChat() {
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [events, setEvents] = useState<KcEvent[]>([]);
  const [error, setError] = useState<KcError | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [workspaces, setWorkspaces] = useState<string[] | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  /** Agent-supplied argument suggestions, keyed by "command\u0000partial". */
  const [commandOptions, setCommandOptions] = useState<Record<string, CommandOption[]>>({});
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);
  const [lastProviderId, setLastProviderId] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const sessionId = useRef<string | null>(null);
  const retry = useRef<number | null>(null);
  /**
   * The start this page is waiting on. Only its `session_opened` is shown:
   * an earlier one, for a folder or agent since switched away from, can still
   * answer, and taking it would send the next message to the wrong place.
   */
  const startId = useRef<string | null>(null);
  /** The same, for rendering: a message waiting for the agent waits on this start. */
  const [start, setStartState] = useState<string | null>(null);
  const setStart = useCallback((id: string | null) => {
    startId.current = id;
    setStartState(id);
  }, []);
  /**
   * Its `open`, until answered, and for a new chat until something is said
   * in it: the server closes an unsaid draft when the socket drops, so that
   * start is asked for again, as a new one.
   */
  const openFrame = useRef<Extract<ClientMessage, { type: "open" }> | null>(null);

  /** False when the socket is not open and the frame went nowhere. */
  const send = useCallback((msg: ClientMessage): boolean => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false;
    ws.current.send(JSON.stringify(msg));
    return true;
  }, []);

  const connect = useCallback(() => {
    // Same host as the page, so it works behind Vite's proxy in development
    // and directly against the server in production.
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/ws`);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      // A start the old socket was waiting on was let go with it, by the
      // server; ask again so this page is not left on "Starting…". A new id,
      // so a message that was waiting on the old start is not sent by itself.
      if (openFrame.current) {
        const requestId = newRequestId();
        openFrame.current = { ...openFrame.current, requestId };
        setStart(requestId);
        socket.send(JSON.stringify(openFrame.current));
      }
      // Catch up on anything missed while we were away.
      if (sessionId.current) {
        socket.send(
          JSON.stringify({
            type: "subscribe",
            sessionId: sessionId.current,
            sinceSeq: lastSeq.current,
          } satisfies ClientMessage),
        );
      }
    };

    socket.onmessage = (raw) => {
      const msg = JSON.parse(String(raw.data)) as ServerMessage;
      switch (msg.type) {
        case "session_opened":
          if (msg.requestId !== (startId.current ?? undefined)) break;
          if (!openFrame.current?.draft) openFrame.current = null;
          sessionId.current = msg.session.id;
          lastSeq.current = 0;
          setSession(msg.session);
          setEvents([]);
          setError(null);
          send({ type: "subscribe", sessionId: msg.session.id, sinceSeq: 0 });
          break;
        case "events": {
          // A batch for the conversation just switched away from can still be
          // in flight; its seqs would interleave into this transcript.
          if (msg.sessionId !== sessionId.current) break;
          if (msg.events.length === 0) break;
          lastSeq.current = Math.max(lastSeq.current, ...msg.events.map((e) => e.seq));
          // De-duplicate by seq: a reconnect may overlap with what we hold.
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.seq));
            return [...prev, ...msg.events.filter((e) => !seen.has(e.seq))].sort((a, b) => a.seq - b.seq);
          });
          break;
        }
        case "session_state":
          if (msg.session.id !== sessionId.current) break;
          setSession(msg.session);
          break;
        case "sessions":
          setSessions(msg.sessions);
          break;
        case "search_results":
          setSearchHits(msg.hits);
          break;
        case "command_options_result":
          setCommandOptions((prev) => ({ ...prev, [`${msg.command}\u0000${msg.partial}`]: msg.options }));
          break;
        case "workspaces":
          setWorkspaces(msg.workspaces);
          setCurrentWorkspace(msg.current);
          setLastProviderId(msg.lastProviderId);
          break;
        case "error":
          if (msg.requestId !== undefined) {
            // A start's failure: an earlier start's is no longer this page's
            // business, and the current one's ends it. The next Send starts afresh.
            if (msg.requestId !== startId.current) break;
            openFrame.current = null;
            setStart(null);
          }
          setError(msg.error);
          break;
      }
    };

    socket.onclose = () => {
      setConnected(false);
      // The server let the start, or the unsaid draft, go with the socket: the
      // page drops it too, so nothing is sent to it and a waiting message
      // waits on nothing now. Reconnecting starts it again.
      if (openFrame.current) {
        sessionId.current = null;
        setSession(null);
        setEvents([]);
        setStart(null);
      }
      retry.current = window.setTimeout(connect, 1_000);
    };
  }, [send, setStart]);

  useEffect(() => {
    connect();
    return () => {
      if (retry.current) window.clearTimeout(retry.current);
      const socket = ws.current;
      if (socket) {
        socket.onclose = null; // deliberate close: do not schedule a reconnect
        socket.close();
      }
    };
  }, [connect]);

  /**
   * Starts an agent. `draft` is a new chat nobody has written in yet; see the
   * `open` message. The chat on screen is let go at once, so nothing typed
   * meanwhile is sent to it by mistake.
   */
  const openSession = useCallback(
    (providerId: string, cwd?: string, start?: StartOptions, draft = false) => {
      sessionId.current = null;
      setSession(null);
      setEvents([]);
      setError(null);
      const requestId = newRequestId();
      setStart(requestId);
      const frame: Extract<ClientMessage, { type: "open" }> = {
        type: "open",
        requestId,
        providerId,
        ...(cwd ? { cwd } : {}),
        ...(start ? { start } : {}),
        ...(draft ? { draft } : {}),
      };
      openFrame.current = frame;
      send(frame);
      return requestId;
    },
    [send, setStart],
  );

  /**
   * Takes over a conversation the agent already had, from `session/list`.
   *
   * Answered with `session_opened` like `openSession`, so nothing downstream
   * needs to know which of the two happened.
   */
  const adoptSession = useCallback(
    (providerId: string, listed: { agentSessionId: string; cwd: string; title: string | null }) => {
      setStart(null);
      openFrame.current = null;
      send({
        type: "adopt",
        providerId,
        agentSessionId: listed.agentSessionId,
        cwd: listed.cwd,
        ...(listed.title ? { title: listed.title } : {}),
      });
    },
    [send, setStart],
  );

  /**
   * Attaches to a session that already exists, live or restored from disk.
   * Also used to switch conversations, which is why the previous one's summary
   * is cleared: leaving it would show the old title and busy state until the
   * new `session_state` arrives.
   */
  const attachSession = useCallback(
    (id: string) => {
      setStart(null);
      openFrame.current = null;
      sessionId.current = id;
      lastSeq.current = 0;
      setSession(null);
      setEvents([]);
      setError(null);
      send({ type: "subscribe", sessionId: id, sinceSeq: 0 });
    },
    [send, setStart],
  );

  const listSessions = useCallback(
    (includeArchived = false) => send({ type: "list_sessions", includeArchived }),
    [send],
  );

  const requestCommandOptions = useCallback(
    (command: string, partial: string) => {
      if (sessionId.current) {
        send({ type: "command_options", sessionId: sessionId.current, command, partial });
      }
    },
    [send],
  );

  const search = useCallback(
    (query: string) => {
      if (query.trim()) send({ type: "search", query });
      else setSearchHits(null);
    },
    [send],
  );

  const archiveSession = useCallback(
    (id: string, archived: boolean) => send({ type: "archive_session", sessionId: id, archived }),
    [send],
  );
  const listWorkspaces = useCallback(() => send({ type: "list_workspaces" }), [send]);

  const unqueue = useCallback(
    (index: number) => {
      if (sessionId.current) send({ type: "unqueue", sessionId: sessionId.current, index });
    },
    [send],
  );

  const editQueued = useCallback(
    (index: number, text: string) => {
      if (sessionId.current) send({ type: "edit_queued", sessionId: sessionId.current, index, text });
    },
    [send],
  );

  const moveQueued = useCallback(
    (from: number, to: number) => {
      if (sessionId.current) send({ type: "move_queued", sessionId: sessionId.current, from, to });
    },
    [send],
  );

  const renameSession = useCallback(
    (id: string, title: string) => send({ type: "rename_session", sessionId: id, title }),
    [send],
  );

  const answerPermission = useCallback(
    (requestId: string, optionId: string | null) => {
      if (sessionId.current) send({ type: "permission_response", sessionId: sessionId.current, requestId, optionId });
    },
    [send],
  );

  const answerElicitation = useCallback(
    (requestId: string, action: ElicitationAction, content?: Record<string, ElicitationValue>) => {
      if (sessionId.current) {
        send({ type: "elicitation_response", sessionId: sessionId.current, requestId, action, content });
      }
    },
    [send],
  );

  const setAutoApprove = useCallback(
    (enabled: boolean) => {
      if (sessionId.current) send({ type: "set_auto_approve", sessionId: sessionId.current, enabled });
    },
    [send],
  );

  const setConfigOption = useCallback(
    (configId: string, value: string | boolean) => {
      if (sessionId.current) send({ type: "set_config_option", sessionId: sessionId.current, configId, value });
    },
    [send],
  );
  const rememberOpening = useCallback(
    (providerId: string, opening: string) => send({ type: "remember_opening", providerId, opening }),
    [send],
  );

  const switchProvider = useCallback(
    (providerId: string) => {
      if (sessionId.current) send({ type: "switch_provider", sessionId: sessionId.current, providerId });
    },
    [send],
  );

  /** Re-attaches an agent to a stored conversation so it can be continued. */
  const resumeSession = useCallback(
    (id: string) => send({ type: "resume", sessionId: id, sinceSeq: lastSeq.current }),
    [send],
  );

  /** False when it could not be sent, so the box keeps it. */
  const prompt = useCallback(
    (text: string, images: Array<{ mime: string; data: string }> = [], files: string[] = [], quiet = false): boolean => {
      if (!sessionId.current) return false;
      const sent = send({
        type: "prompt",
        sessionId: sessionId.current,
        text,
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { files } : {}),
        ...(quiet ? { quiet } : {}),
      });
      // Said, so the draft is a saved chat now: a dropped socket no longer ends it.
      if (sent && !quiet) openFrame.current = null;
      return sent;
    },
    [send],
  );

  const interrupt = useCallback(
    (text: string, images: Array<{ mime: string; data: string }> = [], files: string[] = []) => {
      if (!sessionId.current) return;
      const sent = send({
        type: "interrupt",
        sessionId: sessionId.current,
        text,
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { files } : {}),
      });
      if (sent) openFrame.current = null;
    },
    [send],
  );

  const cancel = useCallback(() => {
    if (sessionId.current) send({ type: "cancel", sessionId: sessionId.current });
  }, [send]);

  return {
    connected,
    session,
    sessions,
    workspaces,
    currentWorkspace,
    lastProviderId,
    events,
    error,
    openSession,
    start,
    adoptSession,
    attachSession,
    resumeSession,
    switchProvider,
    rememberOpening,
    listSessions,
    listWorkspaces,
    archiveSession,
    renameSession,
    search,
    searchHits,
    commandOptions,
    requestCommandOptions,
    unqueue,
    editQueued,
    moveQueued,
    setConfigOption,
    answerPermission,
    answerElicitation,
    setAutoApprove,
    prompt,
    interrupt,
    cancel,
  };
}

/** Unique enough: it only has to differ from this page's other starts. */
function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
