export type LogLevel = 'info' | 'success' | 'error' | 'warn';
export type LogCallback = (message: string, level: LogLevel) => void;

export declare function setVerbose(value: boolean): void;
export declare function setSilent(value: boolean): void;
export declare function setCallback(callback: LogCallback): void;

export declare function info(message: string): void;
export declare function success(message: string): void;
export declare function error(message: string): void;
export declare function warn(message: string): void;
export declare function debug(message: string): void;

declare const logger: {
  setVerbose: typeof setVerbose;
  setSilent: typeof setSilent;
  setCallback: typeof setCallback;
  info: typeof info;
  success: typeof success;
  error: typeof error;
  warn: typeof warn;
  debug: typeof debug;
};

export default logger;
