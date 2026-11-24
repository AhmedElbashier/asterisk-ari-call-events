import { readFileSync } from "node:fs";
import { HttpAriClient } from "./ari/http-ari-client.js";
import { MockAriClient } from "./ari/mock-ari-client.js";
import type { AriClient } from "./ari/types.js";
import { CallStore } from "./call-store.js";
import { createApiServer } from "./http/server.js";
import { validateConfig, type IvrConfig } from "./ivr/config.js";
import { IvrEngine } from "./ivr/ivr-engine.js";
import { startSimulator } from "./simulator.js";

const mode = process.env.ARI_MODE === "mock" ? "mock" : "ari";
const port = Number(process.env.PORT ?? 3001);
const configPath = process.env.IVR_CONFIG ?? new URL("../config/ivr.example.json", import.meta.url).pathname;

const config = JSON.parse(readFileSync(configPath, "utf8")) as IvrConfig;
const errors = validateConfig(config);
if (errors.length) {
  console.error("Invalid IVR config:\n - " + errors.join("\n - "));
  process.exit(1);
}

// In mock mode, ignore business hours by default so the demo always shows the full IVR.
if (mode === "mock" && process.env.SIM_RESPECT_HOURS !== "true") delete config.businessHours;

let connected = false;
let ari: AriClient;
let stopSim: (() => void) | undefined;

if (mode === "mock") {
  const mock = new MockAriClient();
  ari = mock;
  stopSim = startSimulator(mock, Number(process.env.SIM_INTERVAL_MS ?? 5000));
} else {
  ari = new HttpAriClient({
    url: process.env.ARI_URL ?? "http://localhost:8088",
    username: process.env.ARI_USERNAME ?? "ari",
    password: process.env.ARI_PASSWORD ?? "",
    app: process.env.ARI_APP ?? "call-events",
  });
}

const store = new CallStore();
new IvrEngine(ari, config, store);
store.on("change", (e) => console.log(JSON.stringify(e)));

await ari.connect();
connected = true;
console.log(`ARI ${mode === "mock" ? "mock client ready" : "connected"}; API on :${port}`);

const server = createApiServer({ store, mode, isConnected: () => connected });
server.listen(port);

const shutdown = async () => {
  stopSim?.();
  connected = false;
  await ari.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
