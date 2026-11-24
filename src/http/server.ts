import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CallStore } from "../call-store.js";

export interface ServerDeps {
  store: CallStore;
  mode: "ari" | "mock";
  isConnected: () => boolean;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Tiny read-only API: health, calls, stats, and a Server-Sent Events stream of call changes. */
export function createApiServer({ store, mode, isConnected }: ServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });

    if (url.pathname === "/health") {
      const ok = isConnected();
      return json(res, ok ? 200 : 503, { status: ok ? "ok" : "disconnected", mode });
    }
    if (url.pathname === "/calls") {
      const active = url.searchParams.get("active") === "true";
      return json(res, 200, active ? store.active() : store.list());
    }
    if (url.pathname === "/stats") return json(res, 200, store.stats());
    const m = url.pathname.match(/^\/calls\/([\w.-]+)$/);
    if (m) {
      const call = store.get(m[1]!);
      return call ? json(res, 200, call) : json(res, 404, { error: "not found" });
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      const onChange = (e: unknown) => res.write(`event: call\ndata: ${JSON.stringify(e)}\n\n`);
      store.on("change", onChange);
      req.on("close", () => store.off("change", onChange));
      return;
    }
    return json(res, 404, { error: "not found" });
  });
}
