import { describe, expect, it } from "vitest";
import { HttpAriClient } from "../src/ari/http-ari-client.js";

function recordingFetch(body: unknown = {}) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const impl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: input.toString(), method: init?.method ?? "GET", auth: headers.get("authorization") });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, impl };
}

describe("HttpAriClient", () => {
  const base = { url: "http://pbx.local:8088", username: "ari", password: "s3cret", app: "call-events" };

  it("builds the events websocket URL for the Stasis app", () => {
    const c = new HttpAriClient(base);
    expect(c.eventsUrl()).toBe("ws://pbx.local:8088/ari/events?app=call-events&subscribeAll=false");
    expect(new HttpAriClient({ ...base, url: "https://pbx.local" }).eventsUrl()).toMatch(/^wss:/);
  });

  it("sends ARI REST commands with basic auth", async () => {
    const { calls, impl } = recordingFetch({ id: "pb-1" });
    const c = new HttpAriClient({ ...base, fetchImpl: impl });
    await c.answer("chan/1");
    const pb = await c.play("chan/1", "sound:hello-world");
    await c.continueInDialplan("chan/1", "queues", "sales");
    await c.hangup("chan/1");

    expect(pb).toBe("pb-1");
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      "POST http://pbx.local:8088/ari/channels/chan%2F1/answer",
      "POST http://pbx.local:8088/ari/channels/chan%2F1/play?media=sound%3Ahello-world",
      "POST http://pbx.local:8088/ari/channels/chan%2F1/continue?context=queues&extension=sales&priority=1",
      "DELETE http://pbx.local:8088/ari/channels/chan%2F1?reason=normal",
    ]);
    expect(calls[0]!.auth).toBe("Basic " + Buffer.from("ari:s3cret").toString("base64"));
  });

  it("keeps a base path such as the http.conf prefix", async () => {
    const { calls, impl } = recordingFetch();
    const c = new HttpAriClient({ ...base, url: "http://pbx.local:8088/asterisk/", fetchImpl: impl });
    expect(c.eventsUrl()).toBe("ws://pbx.local:8088/asterisk/ari/events?app=call-events&subscribeAll=false");
    await c.answer("chan-2");
    expect(calls[0]!.url).toBe("http://pbx.local:8088/asterisk/ari/channels/chan-2/answer");
  });

  it("throws on non-2xx responses", async () => {
    const impl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(new HttpAriClient({ ...base, fetchImpl: impl }).answer("x")).rejects.toThrow(/404/);
  });
});
