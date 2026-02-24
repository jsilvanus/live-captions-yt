const PREFIX = '[LCYT]';

let verbose = false;
let silent = false;
let logCallback = null;
let useStderr = false;

export function setVerbose(value) {
  verbose = value;
}

export function setSilent(value) {
  silent = value;
}

export function setUseStderr(value) {
  useStderr = !!value;
}

export function setCallback(callback) {
  logCallback = callback;
}

export function info(message) {
  if (logCallback) {
    logCallback(message, 'info');
  } else if (!silent) {
    if (useStderr) console.error(`${PREFIX} ${message}`);
    else console.log(`${PREFIX} ${message}`);
  }
}

export function success(message) {
  if (logCallback) {
    logCallback(message, 'success');
  } else if (!silent) {
    if (useStderr) console.error(`${PREFIX} ✓ ${message}`);
    else console.log(`${PREFIX} ✓ ${message}`);
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
    if (useStderr) console.error(`${PREFIX} ⚠ ${message}`);
    else console.warn(`${PREFIX} ⚠ ${message}`);
  }
}

export function debug(message) {
  if (logCallback && verbose) {
    logCallback(message, 'info');
  } else if (!silent && verbose) {
    if (useStderr) console.error(`${PREFIX} [DEBUG] ${message}`);
    else console.log(`${PREFIX} [DEBUG] ${message}`);
  }
}

// Default export for convenience
export default {
  setVerbose,
  setSilent,
  setUseStderr,
  setCallback,
  info,
  success,
  error,
  warn,
  debug
};
