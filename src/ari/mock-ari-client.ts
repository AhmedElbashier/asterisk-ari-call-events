import type { AriChannel, AriClient, AriEvent, AriEventHandler } from "./types.js";

export type MockCommand =
  | { kind: "answer"; channelId: string }
  | { kind: "play"; channelId: string; media: string }
  | { kind: "hangup"; channelId: string; reason?: string }
  | { kind: "continue"; channelId: string; context: string; extension: string; priority: number };

/**
 * In-memory stand-in for Asterisk. Tests (and `ARI_MODE=mock`) drive it by emitting
 * the same JSON events Asterisk would send, and assert on the commands the IVR issued.
 */
export class MockAriClient implements AriClient {
  readonly commands: MockCommand[] = [];
  private handlers: AriEventHandler[] = [];
  private playbackSeq = 0;
  private channels = new Map<string, AriChannel>();

  async connect(): Promise<void> {}
  async close(): Promise<void> {}

  onEvent(handler: AriEventHandler): void {
    this.handlers.push(handler);
  }

  async emit(event: AriEvent): Promise<void> {
    for (const h of this.handlers) await h(event);
  }

  private now() {
    return new Date().toISOString();
  }

  /** Simulates a new inbound call entering the Stasis app. */
  async startCall(id: string, callerNumber: string, exten = "100"): Promise<AriChannel> {
    const channel: AriChannel = {
      id,
      name: `PJSIP/${callerNumber}-${id}`,
      state: "Ring",
      caller: { name: "", number: callerNumber },
      dialplan: { context: "from-external", exten, priority: 1 },
    };
    this.channels.set(id, channel);
    await this.emit({ type: "StasisStart", channel, args: [], timestamp: this.now() });
    return channel;
  }

  async pressDigit(id: string, digit: string): Promise<void> {
    const channel = this.mustGet(id);
    await this.emit({ type: "ChannelDtmfReceived", channel, digit, duration_ms: 100, timestamp: this.now() });
  }

  async callerHangup(id: string): Promise<void> {
    const channel = this.mustGet(id);
    await this.emit({ type: "ChannelHangupRequest", channel, cause: 16, timestamp: this.now() });
    await this.emit({ type: "StasisEnd", channel, timestamp: this.now() });
    this.channels.delete(id);
  }

  private mustGet(id: string): AriChannel {
    const c = this.channels.get(id);
    if (!c) throw new Error(`unknown channel ${id}`);
    return c;
  }

  async answer(channelId: string): Promise<void> {
    this.commands.push({ kind: "answer", channelId });
    const c = this.channels.get(channelId);
    if (c) {
      c.state = "Up";
      await this.emit({ type: "ChannelStateChange", channel: c, timestamp: this.now() });
    }
  }

  async play(channelId: string, media: string): Promise<string> {
    this.commands.push({ kind: "play", channelId, media });
    return `pb-${++this.playbackSeq}`;
  }

  async hangup(channelId: string, reason?: string): Promise<void> {
    this.commands.push({ kind: "hangup", channelId, reason });
    const c = this.channels.get(channelId);
    if (c) {
      this.channels.delete(channelId);
      await this.emit({ type: "StasisEnd", channel: c, timestamp: this.now() });
    }
  }

  async continueInDialplan(channelId: string, context: string, extension: string, priority = 1): Promise<void> {
    this.commands.push({ kind: "continue", channelId, context, extension, priority });
    const c = this.channels.get(channelId);
    if (c) {
      this.channels.delete(channelId);
      await this.emit({ type: "StasisEnd", channel: c, timestamp: this.now() });
    }
  }

  commandsFor(channelId: string) {
    return this.commands.filter((c) => c.channelId === channelId);
  }
}
