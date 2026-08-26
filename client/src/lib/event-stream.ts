import { getApiBase, getApiKey } from "./auth";
import type { CallStatus } from "@/types/call";
import type { SessionInfo, SessionState } from "@/types/session";

type CallListRow = {
  sessionId: string;
  callId: string;
  owner: string | null;
  direction: "outbound" | "inbound";
  peer: string;
  startedAt: number;
  status: CallStatus;
  held?: boolean;
  endedAt?: number;
  endReason?: string;
};

export type BrokerEvent =
  | { type: "session-list"; sessions: SessionInfo[] }
  | { type: "session-qr"; sessionId: string; qr: string }
  | { type: "auth-state"; sessionId: string; paired: boolean; state: SessionState; qr?: string; code?: string; passkey?: unknown }
  | { type: "call-list"; calls: CallListRow[] }
  | { type: "call-status"; sessionId: string; id: string; owner: string | null; status: CallStatus; peer: string; startedAt: number; held?: boolean }
  | { type: "call-ended"; sessionId: string; id: string; owner: string | null; reason: string; endedAt: number }
  | { type: "incoming"; sessionId: string; id: string; peer: string; video: boolean; offeredAt: number }
  | { type: "incoming-claimed"; sessionId: string; id: string; owner: string }
  | { type: "call-transfer-offer"; sessionId: string; id: string; peer: string; from: string; offeredAt: number }
  | { type: "call-transfer-claimed"; sessionId: string; id: string; owner: string }
  | {
      type: "video-state";
      sessionId: string;
      id: string;
      kind: "upgrade-request" | "state";
      peerVideo: boolean;
      localVideo: boolean;
      upgradeIncoming: boolean;
      upgradeOutgoing: boolean;
    };

type Listener = (ev: BrokerEvent) => void;
type StatusListener = (status: "connecting" | "connected" | "disconnected") => void;

class EventStream {
  #es: EventSource | null = null;
  #listeners = new Set<Listener>();
  #statusListeners = new Set<StatusListener>();
  #clientId: string = "";
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelay = 1000;
  #maxReconnectDelay = 30000;
  #closed = false;
  #reconnectable = true;
  onReconnect: (() => void) | null = null;

  connect(clientId: string): void {
    if (this.#es) return;
    this.#clientId = clientId;
    this.#closed = false;
    this.#doConnect();
  }

  #doConnect(): void {
    if (this.#closed) return;
    this.#notifyStatus("connecting");
    const url = `${getApiBase()}/api/events?clientId=${encodeURIComponent(this.#clientId)}&apiKey=${encodeURIComponent(getApiKey())}`;
    this.#es = new EventSource(url);
    this.#es.onopen = () => {
      this.#reconnectDelay = 1000;
      this.#notifyStatus("connected");
    };
    this.#es.onmessage = (ev) => {
      try {
        const parsed: BrokerEvent = JSON.parse(ev.data);
        for (const l of this.#listeners) l(parsed);
      } catch (err) {
        console.error("[EventStream] parse error:", err, ev.data);
      }
    };
    this.#es.onerror = () => {
      this.#notifyStatus("disconnected");
      this.#es?.close();
      this.#es = null;
      if (!this.#closed && this.#reconnectable) {
        this.#scheduleReconnect();
      }
    };
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer) return;
    const delay = this.#reconnectDelay;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#doConnect();
      this.onReconnect?.();
    }, delay);
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, this.#maxReconnectDelay);
  }

  #notifyStatus(status: "connecting" | "connected" | "disconnected"): void {
    for (const l of this.#statusListeners) l(status);
  }

  onStatus(l: StatusListener): () => void {
    this.#statusListeners.add(l);
    return () => this.#statusListeners.delete(l);
  }

  on(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  close(): void {
    this.#closed = true;
    this.#reconnectable = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#es?.close();
    this.#es = null;
  }
}

export const eventStream = new EventStream();
