class LCYTError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LCYTError';
  }
}

class ConfigError extends LCYTError {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

class NetworkError extends LCYTError {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

class ValidationError extends LCYTError {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

module.exports = { LCYTError, ConfigError, NetworkError, ValidationError };
