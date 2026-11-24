import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAriClient } from "../src/ari/mock-ari-client.js";
import { CallStore } from "../src/call-store.js";
import { IvrEngine } from "../src/ivr/ivr-engine.js";
import { CLOSED_TIME, OPEN_TIME, loadConfig, silentLogger } from "./helpers.js";

function setup(at = OPEN_TIME, overrides = {}) {
  const ari = new MockAriClient();
  const store = new CallStore();
  const engine = new IvrEngine(ari, loadConfig(overrides), store, { clock: () => at, logger: silentLogger });
  return { ari, store, engine };
}

describe("IvrEngine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("answers, plays welcome + menu and routes digit 1 to the sales queue", async () => {
    const { ari, store } = setup();
    await ari.startCall("c1", "+971500000001");
    await ari.pressDigit("c1", "1");

    expect(ari.commandsFor("c1")).toEqual([
      { kind: "answer", channelId: "c1" },
      { kind: "play", channelId: "c1", media: "sound:hello-world" },
      { kind: "play", channelId: "c1", media: "sound:vm-enter-num-to-call" },
      { kind: "continue", channelId: "c1", context: "queues", extension: "sales", priority: 1 },
    ]);
    const call = store.get("c1")!;
    expect(call.routedTo).toBe("Sales (queues/sales)");
    expect(call.digits).toEqual(["1"]);
    expect(call.endedAt).toBeDefined();
  });

  it("replays the menu on an invalid digit, then accepts a valid one", async () => {
    const { ari } = setup();
    await ari.startCall("c2", "+971500000002");
    await ari.pressDigit("c2", "7");
    await ari.pressDigit("c2", "2");

    const kinds = ari.commandsFor("c2").map((c) => (c.kind === "play" ? c.media : c.kind));
    expect(kinds).toEqual([
      "answer",
      "sound:hello-world",
      "sound:vm-enter-num-to-call",
      "sound:option-is-invalid",
      "sound:vm-enter-num-to-call",
      "continue",
    ]);
    expect(ari.commandsFor("c2").at(-1)).toMatchObject({ extension: "support" });
  });

  it("repeats the menu when 9 is pressed without counting a retry", async () => {
    const { ari } = setup(OPEN_TIME, { maxRetries: 0 });
    await ari.startCall("c3", "+971500000003");
    await ari.pressDigit("c3", "9");
    await ari.pressDigit("c3", "9");
    await ari.pressDigit("c3", "1");
    expect(ari.commandsFor("c3").at(-1)).toMatchObject({ kind: "continue", extension: "sales" });
  });

  it("falls back to the operator after the caller stays silent past max retries", async () => {
    const { ari, store } = setup(OPEN_TIME, { maxRetries: 2 });
    await ari.startCall("c4", "+971500000004");
    await vi.advanceTimersByTimeAsync(1000); // retry 1
    await vi.advanceTimersByTimeAsync(1000); // retry 2
    expect(store.get("c4")!.routedTo).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000); // exhausted -> fallback

    const menuPlays = ari.commandsFor("c4").filter((c) => c.kind === "play" && c.media === "sound:vm-enter-num-to-call");
    expect(menuPlays).toHaveLength(3);
    expect(ari.commandsFor("c4").at(-1)).toMatchObject({ kind: "continue", context: "internal", extension: "1000" });
    expect(store.get("c4")!.routedTo).toContain("Operator");
  });

  it("plays the closed message and hangs up outside business hours", async () => {
    const { ari, store } = setup(CLOSED_TIME);
    await ari.startCall("c5", "+971500000005");
    expect(ari.commandsFor("c5")).toEqual([
      { kind: "answer", channelId: "c5" },
      { kind: "play", channelId: "c5", media: "sound:vm-goodbye" },
      { kind: "hangup", channelId: "c5", reason: "normal" },
    ]);
    expect(store.get("c5")!.endedAt).toBeDefined();
    expect(store.get("c5")!.routedTo).toBeUndefined();
  });

  it("cleans up the session and timer when the caller hangs up in the IVR", async () => {
    const { ari, store, engine } = setup();
    await ari.startCall("c6", "+971500000006");
    expect(engine.activeSessions()).toBe(1);
    await ari.callerHangup("c6");
    expect(engine.activeSessions()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ari.commandsFor("c6").some((c) => c.kind === "continue")).toBe(false);
    expect(store.stats()).toMatchObject({ total: 1, active: 0, abandonedInIvr: 1 });
  });


  it("handles concurrent calls independently", async () => {
    const { ari, store } = setup();
    await ari.startCall("a", "+971500000010");
    await ari.startCall("b", "+971500000011");
    await ari.pressDigit("b", "2");
    await ari.pressDigit("a", "1");
    expect(store.get("a")!.routedTo).toContain("Sales");
    expect(store.get("b")!.routedTo).toContain("Support");
  });
});
