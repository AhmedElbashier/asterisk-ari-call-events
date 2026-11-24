import { readFileSync } from "node:fs";
import type { IvrConfig } from "../src/ivr/config.js";

export function loadConfig(overrides: Partial<IvrConfig> = {}): IvrConfig {
  const base = JSON.parse(readFileSync(new URL("../config/ivr.example.json", import.meta.url), "utf8")) as IvrConfig;
  return { ...base, inputTimeoutMs: 1000, ...overrides };
}

/** Tuesday 2026-11-24 10:00 in Dubai (06:00 UTC): inside business hours. */
export const OPEN_TIME = new Date("2026-11-24T06:00:00Z");
/** Tuesday 2026-11-24 20:00 in Dubai: after hours. */
export const CLOSED_TIME = new Date("2026-11-24T16:00:00Z");

export const silentLogger = { info() {}, warn() {}, error() {} };
