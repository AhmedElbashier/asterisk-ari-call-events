import { describe, expect, it } from "vitest";
import { isOpen, validateConfig } from "../src/ivr/config.js";
import { CLOSED_TIME, OPEN_TIME, loadConfig } from "./helpers.js";

describe("IVR config", () => {
  it("accepts the example config", () => {
    expect(validateConfig(loadConfig({ inputTimeoutMs: 6000 }))).toEqual([]);
  });

  it("rejects bad DTMF keys, timeouts and hours", () => {
    const errors = validateConfig(
      loadConfig({
        inputTimeoutMs: 10,
        options: { "12": { type: "hangup" } },
        businessHours: { timezone: "Asia/Dubai", days: [1], open: "9am", close: "18:00" },
      }),
    );
    expect(errors).toHaveLength(3);
  });

  it("evaluates business hours in the configured timezone", () => {
    const hours = loadConfig().businessHours!;
    expect(isOpen(hours, OPEN_TIME)).toBe(true);
    expect(isOpen(hours, CLOSED_TIME)).toBe(false);
    // Saturday 10:00 Dubai -> closed (not in days)
    expect(isOpen(hours, new Date("2026-11-28T06:00:00Z"))).toBe(false);
    expect(isOpen(undefined, CLOSED_TIME)).toBe(true);
  });
});
