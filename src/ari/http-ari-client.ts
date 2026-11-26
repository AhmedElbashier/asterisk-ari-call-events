import WebSocket from "ws";
import type { AriClient, AriEvent, AriEventHandler } from "./types.js";

export interface AriConnectionOptions {
  url: string; // e.g. http://localhost:8088, or http://pbx:8088/asterisk when http.conf sets `prefix`
  username: string;
  password: string;
  app: string; // Stasis application name
  fetchImpl?: typeof fetch;
  reconnectDelayMs?: number;
}

/**
 * Minimal ARI client over plain fetch + WebSocket (no SDK), so every request is visible.
 * Reconnects the event socket with a fixed delay if Asterisk restarts.
 */
export class HttpAriClient implements AriClient {
  private ws?: WebSocket;
  private handlers: AriEventHandler[] = [];
  private closed = false;
  private readonly fetchImpl: typeof fetch;
  private readonly auth: string;

  constructor(private readonly opts: AriConnectionOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.auth = "Basic " + Buffer.from(`${opts.username}:${opts.password}`).toString("base64");
  }

  onEvent(handler: AriEventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Resolves an ARI path against the configured base URL, keeping any base path.
   * `new URL("/ari/x", base)` would drop it, which breaks Asterisk's http.conf `prefix`
   * option (ARI then lives under /<prefix>/ari) and reverse proxies that mount ARI on a sub-path.
   */
  ariUrl(path: string): URL {
    const u = new URL(this.opts.url);
    u.pathname = `${u.pathname.replace(/\/+$/, "")}/ari${path}`;
    u.search = "";
    return u;
  }

  eventsUrl(): string {
    const u = this.ariUrl("/events");
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("app", this.opts.app);
    u.searchParams.set("subscribeAll", "false");
    return u.toString();
  }

  async connect(): Promise<void> {
    this.closed = false;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.eventsUrl(), { headers: { Authorization: this.auth } });
      this.ws = ws;
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
      ws.on("message", (data) => {
        let event: AriEvent;
        try {
          event = JSON.parse(data.toString()) as AriEvent;
        } catch {
          return;
        }
        for (const h of this.handlers) void Promise.resolve(h(event)).catch((e) => console.error("handler error", e));
      });
      ws.on("close", () => {
        if (this.closed) return;
        setTimeout(() => this.connect().catch((e) => console.error("ARI reconnect failed", e.message)), this.opts.reconnectDelayMs ?? 3000);
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.close();
  }

  async request(method: string, path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const u = this.ariUrl(path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    const res = await this.fetchImpl(u, { method, headers: { Authorization: this.auth } });
    if (!res.ok) throw new Error(`ARI ${method} ${path} failed: ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  async answer(channelId: string): Promise<void> {
    await this.request("POST", `/channels/${encodeURIComponent(channelId)}/answer`);
  }

  async play(channelId: string, media: string): Promise<string> {
    const r = (await this.request("POST", `/channels/${encodeURIComponent(channelId)}/play`, { media })) as { id: string };
    return r.id;
  }

  async hangup(channelId: string, reason = "normal"): Promise<void> {
    await this.request("DELETE", `/channels/${encodeURIComponent(channelId)}`, { reason });
  }

  async continueInDialplan(channelId: string, context: string, extension: string, priority = 1): Promise<void> {
    await this.request("POST", `/channels/${encodeURIComponent(channelId)}/continue`, { context, extension, priority });
  }
}
