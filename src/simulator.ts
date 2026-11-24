import type { MockAriClient } from "./ari/mock-ari-client.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mock mode only: plays out sample calls so the API and SSE stream show realistic activity. */
export function startSimulator(mock: MockAriClient, everyMs = 5000) {
  let n = 0;
  const scenarios = [
    async (id: string) => { await sleep(800); await mock.pressDigit(id, "1"); },
    async (id: string) => { await sleep(800); await mock.pressDigit(id, "7"); await sleep(500); await mock.pressDigit(id, "2"); },
    async (id: string) => { await sleep(1200); await mock.callerHangup(id); },
    async (id: string) => { await sleep(600); await mock.pressDigit(id, "0"); },
  ];
  const timer = setInterval(async () => {
    const id = `sim-${++n}`;
    try {
      await mock.startCall(id, `+97150000${(n % 100).toString().padStart(4, "0")}`);
      await scenarios[n % scenarios.length]!(id);
    } catch (e) {
      console.error("simulator", e);
    }
  }, everyMs);
  return () => clearInterval(timer);
}
