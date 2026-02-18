export interface SenderOptions {
  streamKey?: string | null;
  baseUrl?: string;
  ingestionUrl?: string | null;
  region?: string;
  cue?: string;
  useRegion?: boolean;
  sequence?: number;
  verbose?: boolean;
}

export interface CaptionItem {
  text: string;
  timestamp?: string;
}

export interface SendResult {
  sequence: number;
  timestamp: string;
  statusCode: number;
  response: string;
  serverTimestamp: string | null;
}

export interface SendBatchResult {
  sequence: number;
  count: number;
  statusCode: number;
  response: string;
  serverTimestamp: string | null;
}

export interface HeartbeatResult {
  sequence: number;
  statusCode: number;
  serverTimestamp: string | null;
}

export declare class YoutubeLiveCaptionSender {
  streamKey: string | null;
  baseUrl: string;
  region: string;
  cue: string;
  useRegion: boolean;
  sequence: number;
  isStarted: boolean;
  verbose: boolean;
  ingestionUrl: string | null;

  constructor(options?: SenderOptions);

  start(): this;
  end(): this;

  send(text: string, timestamp?: string): Promise<SendResult>;
  sendBatch(captions?: CaptionItem[]): Promise<SendBatchResult>;

  construct(text: string, timestamp?: string): number;
  getQueue(): CaptionItem[];
  clearQueue(): number;

  heartbeat(): Promise<HeartbeatResult>;
  sendTest(): Promise<{ statusCode: number; response: string; serverTimestamp: string | null }>;

  getSequence(): number;
  setSequence(seq: number): this;
}

export declare const DEFAULT_YOUTUBE_URL: string;
