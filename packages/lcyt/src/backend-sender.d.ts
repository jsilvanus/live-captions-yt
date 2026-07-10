export interface BackendSenderOptions {
  backendUrl: string;
  apiKey: string;
  /** YouTube stream key. Optional in target-array mode — pass targets in `start()` instead. */
  streamKey?: string;
  domain?: string;
  sequence?: number;
  verbose?: boolean;
}

export interface BackendCaptionItem {
  text: string;
  timestamp?: string | Date | number;
  time?: number;
}

export interface SendResult {
  sequence: number;
  timestamp: string;
  statusCode: number;
  serverTimestamp: string | null;
}

export interface SendBatchResult {
  sequence: number;
  count: number;
  statusCode: number;
  serverTimestamp: string | null;
}

export interface SyncResult {
  syncOffset: number;
  roundTripTime: number;
  serverTimestamp: string;
  statusCode: number;
}

/** Backend caption-file format for one language ('original' keys the untranslated text). */
export type CaptionFileFormat = 'text' | 'youtube' | 'vtt';

/** Extra per-caption fields merged into the POST /captions payload. */
export interface SendExtraOptions {
  translations?: Record<string, string>;
  captionLang?: string;
  showOriginal?: boolean;
  codes?: Record<string, unknown>;
  fileFormats?: Record<string, CaptionFileFormat>;
}

export declare class BackendCaptionSender {
  backendUrl: string;
  apiKey: string;
  /** YouTube stream key. null when using target-array mode. */
  streamKey: string | null;
  domain: string;
  sequence: number;
  isStarted: boolean;
  syncOffset: number;
  startedAt: number;
  verbose: boolean;

  constructor(options: BackendSenderOptions);

  start(): Promise<this>;
  end(): Promise<this>;

  send(text: string, timestamp?: string | Date | number, extraOpts?: SendExtraOptions): Promise<SendResult>;
  send(text: string, options: { time: number }, extraOpts?: SendExtraOptions): Promise<SendResult>;
  sendBatch(captions?: BackendCaptionItem[]): Promise<SendBatchResult>;

  construct(text: string, timestamp?: string | Date | number): number;
  getQueue(): BackendCaptionItem[];
  clearQueue(): number;

  heartbeat(): Promise<{ sequence: number; syncOffset: number }>;
  sync(): Promise<SyncResult>;

  getSequence(): number;
  setSequence(seq: number): this;
  getSyncOffset(): number;
  setSyncOffset(offset: number): this;
  getStartedAt(): number;
}
