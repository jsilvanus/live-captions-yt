const PREFIX = '[LCYT]';

let verbose = false;
let silent = false;
let logCallback = null;
let useStderr = false;

function setVerbose(value) {
  verbose = value;
}

function setSilent(value) {
  silent = value;
}

function setUseStderr(value) {
  useStderr = !!value;
}

function setCallback(callback) {
  logCallback = callback;
}

function info(message) {
  if (logCallback) {
    logCallback(message, 'info');
  } else if (!silent) {
    if (useStderr) console.error(`${PREFIX} ${message}`);
    else console.log(`${PREFIX} ${message}`);
  }
}

function success(message) {
  if (logCallback) {
    logCallback(message, 'success');
  } else if (!silent) {
    if (useStderr) console.error(`${PREFIX} ✓ ${message}`);
    else console.log(`${PREFIX} ✓ ${message}`);
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
    if (useStderr) console.error(`${PREFIX} ⚠ ${message}`);
    else console.warn(`${PREFIX} ⚠ ${message}`);
  }
}

function debug(message) {
  if (logCallback && verbose) {
    logCallback(message, 'info');
  } else if (!silent && verbose) {
    if (useStderr) console.error(`${PREFIX} [DEBUG] ${message}`);
    else console.log(`${PREFIX} [DEBUG] ${message}`);
  }
}

// Default export for convenience
module.exports = {
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
