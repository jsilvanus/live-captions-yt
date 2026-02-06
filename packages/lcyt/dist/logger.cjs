const PREFIX = '[LCYT]';

let verbose = false;
let silent = false;
let logCallback = null;

function setVerbose(value) {
  verbose = value;
}

function setSilent(value) {
  silent = value;
}

function setCallback(callback) {
  logCallback = callback;
}

function info(message) {
  if (logCallback) {
    logCallback(message, 'info');
  } else if (!silent) {
    console.log(`${PREFIX} ${message}`);
  }
}

function success(message) {
  if (logCallback) {
    logCallback(message, 'success');
  } else if (!silent) {
    console.log(`${PREFIX} ✓ ${message}`);
  }
}

function error(message) {
  if (logCallback) {
    logCallback(message, 'error');
  } else if (!silent) {
    console.error(`${PREFIX} ✗ ${message}`);
  }
}

function warn(message) {
  if (logCallback) {
    logCallback(message, 'warn');
  } else if (!silent) {
    console.warn(`${PREFIX} ⚠ ${message}`);
  }
}

function debug(message) {
  if (logCallback && verbose) {
    logCallback(message, 'info');
  } else if (!silent && verbose) {
    console.log(`${PREFIX} [DEBUG] ${message}`);
  }
}

// Default export for convenience
module.exports = {
  setVerbose,
  setSilent,
  setCallback,
  info,
  success,
  error,
  warn,
  debug
};
