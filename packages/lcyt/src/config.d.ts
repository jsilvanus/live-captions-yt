export interface Config {
  baseUrl: string;
  streamKey: string | null;
  region: string;
  cue: string;
  sequence: number;
}

export declare const DEFAULT_YOUTUBE_URL: string;

export declare function getDefaultConfigPath(): string;
export declare function getDefaultConfig(): Config;
export declare function loadConfig(configPath?: string): Config;
export declare function saveConfig(configPath: string | undefined, config: Config): boolean;
export declare function buildIngestionUrl(config: Config): string | null;
