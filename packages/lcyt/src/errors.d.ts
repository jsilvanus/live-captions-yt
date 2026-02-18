export declare class LCYTError extends Error {
  name: string;
}

export declare class ConfigError extends LCYTError {}

export declare class NetworkError extends LCYTError {
  statusCode: number | null;
}

export declare class ValidationError extends LCYTError {
  field: string | null;
}
