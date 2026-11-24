/** Config-driven IVR. Load from JSON so non-developers can change menus. */
export type IvrAction =
  | { type: "route"; context: string; extension: string; label: string }
  | { type: "play"; media: string }
  | { type: "repeat" }
  | { type: "hangup" };

export interface BusinessHours {
  timezone: string; // IANA, e.g. "Asia/Dubai"
  days: number[]; // 0 = Sunday ... 6 = Saturday
  open: string; // "09:00"
  close: string; // "18:00"
}

export interface IvrConfig {
  welcome: string; // ARI media URI, e.g. "sound:custom/welcome"
  menu: string; // prompt listing the options
  invalid: string;
  closedMessage: string;
  maxRetries: number;
  inputTimeoutMs: number;
  options: Record<string, IvrAction>; // DTMF digit -> action
  fallback: IvrAction; // after max retries / timeouts
  businessHours?: BusinessHours;
}

export function validateConfig(c: IvrConfig): string[] {
  const errors: string[] = [];
  if (!c.welcome || !c.menu) errors.push("welcome and menu prompts are required");
  if (c.maxRetries < 0 || c.maxRetries > 10) errors.push("maxRetries must be between 0 and 10");
  if (c.inputTimeoutMs < 1000) errors.push("inputTimeoutMs must be >= 1000");
  for (const digit of Object.keys(c.options)) {
    if (!/^[0-9*#]$/.test(digit)) errors.push(`invalid DTMF key "${digit}"`);
  }
  if (c.businessHours) {
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!re.test(c.businessHours.open) || !re.test(c.businessHours.close)) errors.push("business hours must be HH:MM");
  }
  return errors;
}

/** True when `at` falls inside business hours in the configured timezone. */
export function isOpen(hours: BusinessHours | undefined, at: Date): boolean {
  if (!hours) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hhmm = `${get("hour").replace("24", "00")}:${get("minute")}`;
  return hours.days.includes(day) && hhmm >= hours.open && hhmm < hours.close;
}
