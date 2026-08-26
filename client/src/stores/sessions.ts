import { create } from "zustand";
import { eventStream, type BrokerEvent } from "@/lib/event-stream";
import { getClientId } from "@/lib/client-id";
import { listSessions } from "@/services/sessions";
import type { SessionInfo } from "@/types/session";
import type { WebAuthnPublicKey } from "@/lib/passkey";

type SseStatus = "connecting" | "connected" | "disconnected";

type State = {
  sessions: SessionInfo[];
  qrs: Record<string, string>;
  codes: Record<string, string>;
  passkeys: Record<string, WebAuthnPublicKey>;
  activeId: string | null;
  sseStatus: SseStatus;
};

export const useSessions = create<State>(() => ({
  sessions: [],
  qrs: {},
  codes: {},
  passkeys: {},
  activeId: null,
  sseStatus: "connecting",
}));

export const setPairingCode = (id: string, code: string): void =>
  useSessions.setState((s) => ({ codes: { ...s.codes, [id]: code } }));

export const setActiveSession = (id: string): void => useSessions.setState({ activeId: id });

const pickActive = (sessions: SessionInfo[], current: string | null): string | null => {
  if (current && sessions.some((s) => s.id === current)) return current;
  return sessions[0]?.id ?? null;
};

const fetchSessions = (): void => {
  void listSessions()
    .then((sessions) =>
      useSessions.setState((s) => {
        const byId = new Map(s.sessions.map((x) => [x.id, x]));
        const qrs = { ...s.qrs };
        for (const remote of sessions) {
          const local = byId.get(remote.id);
          if (
            !local ||
            (remote.jid && remote.jid !== local.jid) ||
            (remote.qr && !local.qr) ||
            (remote.state && remote.state !== local.state)
          ) {
            byId.set(remote.id, remote);
          }
          if (remote.qr && !qrs[remote.id]) {
            qrs[remote.id] = remote.qr;
          }
        }
        const merged = Array.from(byId.values());
        return { sessions: merged, qrs, activeId: pickActive(merged, s.activeId) };
      }),
    )
    .catch(() => {});
};

let wired = false;
export const ensureSessionsWired = (): void => {
  if (wired) return;
  wired = true;

  eventStream.onStatus((status) => {
    useSessions.setState({ sseStatus: status });
  });

  eventStream.on((ev: BrokerEvent) => {
    if (ev.type === "session-list") {
      useSessions.setState((s) => {
        const ids = new Set(ev.sessions.map((x) => x.id));
        const qrs: Record<string, string> = {};
        for (const [id, qr] of Object.entries(s.qrs)) if (ids.has(id)) qrs[id] = qr;
        for (const sess of ev.sessions) {
          if (sess.qr && !qrs[sess.id]) qrs[sess.id] = sess.qr;
        }
        const codes: Record<string, string> = {};
        for (const [id, code] of Object.entries(s.codes)) if (ids.has(id)) codes[id] = code;
        return { sessions: ev.sessions, qrs, codes, activeId: pickActive(ev.sessions, s.activeId) };
      });
    } else if (ev.type === "session-qr") {
      useSessions.setState((s) => ({ qrs: { ...s.qrs, [ev.sessionId]: ev.qr } }));
    } else if (ev.type === "auth-state") {
      useSessions.setState((s) => {
        const sessions = s.sessions.map((x) =>
          x.id === ev.sessionId ? { ...x, state: ev.state, paired: ev.paired } : x,
        );
        const qrs = { ...s.qrs };
        if (ev.paired) delete qrs[ev.sessionId];
        else if (ev.qr) qrs[ev.sessionId] = ev.qr;
        const codes = { ...s.codes };
        if (ev.paired) delete codes[ev.sessionId];
        else if (ev.code) codes[ev.sessionId] = ev.code;
        const passkeys = { ...s.passkeys };
        if (ev.state === "passkey_request" && ev.passkey) {
          passkeys[ev.sessionId] = ev.passkey as WebAuthnPublicKey;
        } else {
          delete passkeys[ev.sessionId];
        }
        return { sessions, qrs, codes, passkeys };
      });
    }
  });

  eventStream.connect(getClientId());
  fetchSessions();
  setInterval(fetchSessions, 2000);
};
