export class LCYTError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LCYTError';
  }
}

export class ConfigError extends LCYTError {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class NetworkError extends LCYTError {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends LCYTError {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}
