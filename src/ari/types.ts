/**
 * The subset of the Asterisk REST Interface (ARI) this service uses.
 * Event and field names match ARI's JSON (https://docs.asterisk.org/Asterisk_REST_Interface/).
 */
export interface AriChannel {
  id: string;
  name: string;
  state: string; // "Ring" | "Up" | ...
  caller: { name: string; number: string };
  dialplan?: { context: string; exten: string; priority: number };
}

export type AriEvent =
  | { type: "StasisStart"; channel: AriChannel; args: string[]; timestamp: string }
  | { type: "StasisEnd"; channel: AriChannel; timestamp: string }
  | { type: "ChannelDtmfReceived"; channel: AriChannel; digit: string; duration_ms: number; timestamp: string }
  | { type: "ChannelStateChange"; channel: AriChannel; timestamp: string }
  | { type: "ChannelHangupRequest"; channel: AriChannel; cause?: number; timestamp: string }
  | { type: "PlaybackFinished"; playback: { id: string; target_uri: string; media_uri: string }; timestamp: string };

export type AriEventHandler = (event: AriEvent) => void | Promise<void>;

/** Commands the IVR needs. Implemented by the real HTTP/WebSocket client and by the mock. */
export interface AriClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  onEvent(handler: AriEventHandler): void;
  answer(channelId: string): Promise<void>;
  play(channelId: string, media: string): Promise<string>; // returns playback id
  hangup(channelId: string, reason?: string): Promise<void>;
  /** Hand the call back to the dialplan, e.g. to a queue or extension. */
  continueInDialplan(channelId: string, context: string, extension: string, priority?: number): Promise<void>;
}
