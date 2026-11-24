import { EventEmitter } from "node:events";

export type CallStatus = "ringing" | "in-ivr" | "routed" | "ended";

export interface CallRecord {
  id: string;
  caller: string;
  dialed: string;
  status: CallStatus;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  routedTo?: string;
  digits: string[];
  timeline: { at: string; event: string; detail?: string }[];
}

/** Keeps live + recent calls in memory and publishes changes (for SSE / webhooks). */
export class CallStore extends EventEmitter {
  private calls = new Map<string, CallRecord>();

  constructor(private readonly maxRecent = 200, private readonly clock: () => Date = () => new Date()) {
    super();
  }

  private now() {
    return this.clock().toISOString();
  }

  start(id: string, caller: string, dialed: string): CallRecord {
    const rec: CallRecord = { id, caller, dialed, status: "ringing", startedAt: this.now(), digits: [], timeline: [] };
    this.calls.set(id, rec);
    this.log(id, "call.started", `from ${caller} to ${dialed}`);
    this.trim();
    return rec;
  }

  answered(id: string) {
    this.update(id, (c) => {
      c.status = "in-ivr";
      c.answeredAt ??= this.now();
    }, "call.answered");
  }

  digit(id: string, d: string) {
    this.update(id, (c) => c.digits.push(d), "dtmf", d);
  }

  routed(id: string, target: string) {
    this.update(id, (c) => {
      c.status = "routed";
      c.routedTo = target;
    }, "call.routed", target);
  }

  ended(id: string, reason = "hangup") {
    this.update(id, (c) => {
      if (c.status === "ended") return;
      c.status = c.status === "routed" ? "routed" : "ended";
      c.endedAt ??= this.now();
    }, "call.ended", reason);
  }

  get(id: string) {
    return this.calls.get(id);
  }

  list(): CallRecord[] {
    return [...this.calls.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  active(): CallRecord[] {
    return this.list().filter((c) => !c.endedAt);
  }

  stats() {
    const all = this.list();
    return {
      total: all.length,
      active: all.filter((c) => !c.endedAt).length,
      routed: all.filter((c) => c.routedTo).length,
      abandonedInIvr: all.filter((c) => c.endedAt && !c.routedTo).length,
    };
  }

  private update(id: string, fn: (c: CallRecord) => void, event: string, detail?: string) {
    const c = this.calls.get(id);
    if (!c) return;
    fn(c);
    this.log(id, event, detail);
  }

  private log(id: string, event: string, detail?: string) {
    const c = this.calls.get(id);
    if (!c) return;
    const entry = { at: this.now(), event, detail };
    c.timeline.push(entry);
    this.emit("change", { callId: id, ...entry });
  }

  private trim() {
    if (this.calls.size <= this.maxRecent) return;
    for (const c of [...this.calls.values()].filter((c) => c.endedAt).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      if (this.calls.size <= this.maxRecent) break;
      this.calls.delete(c.id);
    }
  }
}
