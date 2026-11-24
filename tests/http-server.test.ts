import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { CallStore } from "../src/call-store.js";
import { createApiServer } from "../src/http/server.js";

describe("HTTP API", () => {
  const store = new CallStore();
  const server = createApiServer({ store, mode: "mock", isConnected: () => true });
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    store.start("x1", "+971500000001", "100");
    store.answered("x1");
    store.routed("x1", "Sales (queues/sales)");
    store.start("x2", "+971500000002", "100");
  });
  afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

  it("reports health and mode", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", mode: "mock" });
  });

  it("lists calls, active calls and a single call", async () => {
    expect((await (await fetch(`${base}/calls`)).json()).length).toBe(2);
    expect((await (await fetch(`${base}/calls?active=true`)).json()).length).toBe(2);
    const one = await (await fetch(`${base}/calls/x1`)).json();
    expect(one.routedTo).toBe("Sales (queues/sales)");
    expect((await fetch(`${base}/calls/nope`)).status).toBe(404);
  });

  it("streams call changes over SSE", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    await reader.read(); // ": connected"
    store.digit("x2", "5");
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"event":"dtmf"');
    ctrl.abort();
  });

  it("returns stats", async () => {
    expect(await (await fetch(`${base}/stats`)).json()).toMatchObject({ total: 2, routed: 1 });
  });
});
