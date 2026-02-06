const PREFIX = '[LCYT]';

let verbose = false;
let silent = false;
let logCallback = null;

export function setVerbose(value) {
  verbose = value;
}

export function setSilent(value) {
  silent = value;
}

export function setCallback(callback) {
  logCallback = callback;
}

export function info(message) {
  if (logCallback) {
    logCallback(message, 'info');
  } else if (!silent) {
    console.log(`${PREFIX} ${message}`);
  }
}

export function success(message) {
  if (logCallback) {
    logCallback(message, 'success');
  } else if (!silent) {
    console.log(`${PREFIX} ✓ ${message}`);
  }
}

export function error(message) {
  if (logCallback) {
    logCallback(message, 'error');
  } else if (!silent) {
    console.error(`${PREFIX} ✗ ${message}`);
  }
}

export function warn(message) {
  if (logCallback) {
    logCallback(message, 'warn');
  } else if (!silent) {
    console.warn(`${PREFIX} ⚠ ${message}`);
  }
}

export function debug(message) {
  if (logCallback && verbose) {
    logCallback(message, 'info');
  } else if (!silent && verbose) {
    console.log(`${PREFIX} [DEBUG] ${message}`);
  }
}

// Default export for convenience
export default {
  setVerbose,
  setSilent,
  setCallback,
  info,
  success,
  error,
  warn,
  debug
};
