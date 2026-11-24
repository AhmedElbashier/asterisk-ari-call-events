import type { AriClient, AriEvent } from "../ari/types.js";
import type { CallStore } from "../call-store.js";
import { isOpen, type IvrAction, type IvrConfig } from "./config.js";

interface Session {
  channelId: string;
  retries: number;
  timer?: NodeJS.Timeout;
  done: boolean;
}

export interface IvrEngineOptions {
  clock?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Per-call state machine:
 *   StasisStart -> answer -> (closed? play closed + hangup) -> welcome + menu -> wait for DTMF
 *   digit -> option action | invalid (retry) ; timeout -> retry ; retries exhausted -> fallback
 */
export class IvrEngine {
  private sessions = new Map<string, Session>();
  private readonly clock: () => Date;
  private readonly log: Pick<Console, "info" | "warn" | "error">;

  constructor(
    private readonly ari: AriClient,
    private readonly config: IvrConfig,
    private readonly store: CallStore,
    opts: IvrEngineOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date());
    this.log = opts.logger ?? console;
    ari.onEvent((e) => this.handle(e));
  }

  activeSessions() {
    return this.sessions.size;
  }

  async handle(event: AriEvent): Promise<void> {
    switch (event.type) {
      case "StasisStart":
        return this.onStart(event.channel.id, event.channel.caller.number, event.channel.dialplan?.exten ?? "");
      case "ChannelStateChange":
        if (event.channel.state === "Up") this.store.answered(event.channel.id);
        return;
      case "ChannelDtmfReceived":
        return this.onDigit(event.channel.id, event.digit);
      case "ChannelHangupRequest":
      case "StasisEnd":
        return this.onEnd(event.channel.id, event.type === "ChannelHangupRequest" ? "caller-hangup" : "left-app");
      default:
        return;
    }
  }

  private async onStart(channelId: string, caller: string, dialed: string) {
    if (this.sessions.has(channelId)) return;
    const s: Session = { channelId, retries: 0, done: false };
    this.sessions.set(channelId, s);
    this.store.start(channelId, caller, dialed);
    try {
      await this.ari.answer(channelId);
      if (!isOpen(this.config.businessHours, this.clock())) {
        await this.ari.play(channelId, this.config.closedMessage);
        return this.finish(s, { type: "hangup" }, "closed");
      }
      await this.ari.play(channelId, this.config.welcome);
      await this.promptMenu(s);
    } catch (err) {
      this.log.error(`IVR start failed for ${channelId}`, err);
      await this.safeHangup(channelId);
    }
  }

  private async promptMenu(s: Session) {
    await this.ari.play(s.channelId, this.config.menu);
    this.armTimer(s);
  }

  private armTimer(s: Session) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => void this.onTimeout(s), this.config.inputTimeoutMs);
    s.timer.unref?.();
  }

  private async onTimeout(s: Session) {
    if (s.done) return;
    await this.retryOrFallback(s, "timeout");
  }

  private async onDigit(channelId: string, digit: string) {
    const s = this.sessions.get(channelId);
    if (!s || s.done) return;
    clearTimeout(s.timer);
    this.store.digit(channelId, digit);
    const action = this.config.options[digit];
    if (!action) {
      await this.ari.play(channelId, this.config.invalid);
      return this.retryOrFallback(s, "invalid");
    }
    if (action.type === "repeat") return this.promptMenu(s);
    if (action.type === "play") {
      await this.ari.play(channelId, action.media);
      return this.promptMenu(s);
    }
    return this.finish(s, action, `dtmf ${digit}`);
  }

  private async retryOrFallback(s: Session, why: string) {
    s.retries += 1;
    if (s.retries > this.config.maxRetries) {
      this.log.info(`call ${s.channelId}: ${why}, retries exhausted -> fallback`);
      return this.finish(s, this.config.fallback, `fallback after ${why}`);
    }
    return this.promptMenu(s);
  }

  private async finish(s: Session, action: IvrAction, reason: string) {
    s.done = true;
    clearTimeout(s.timer);
    try {
      if (action.type === "route") {
        this.store.routed(s.channelId, `${action.label} (${action.context}/${action.extension})`);
        await this.ari.continueInDialplan(s.channelId, action.context, action.extension, 1);
      } else {
        await this.ari.hangup(s.channelId, "normal");
      }
    } catch (err) {
      this.log.warn(`finish(${reason}) failed for ${s.channelId}`, err);
    }
  }

  private async onEnd(channelId: string, reason: string) {
    const s = this.sessions.get(channelId);
    if (s) {
      clearTimeout(s.timer);
      s.done = true;
      this.sessions.delete(channelId);
    }
    this.store.ended(channelId, reason);
  }

  private async safeHangup(channelId: string) {
    try {
      await this.ari.hangup(channelId, "normal");
    } catch {
      /* channel may already be gone */
    }
  }
}
