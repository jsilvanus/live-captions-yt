const PREFIX = '[LCYT]';

let verbose = false;

function setVerbose(value) {
  verbose = value;
}

function info(message) {
  console.log(`${PREFIX} ${message}`);
}

function success(message) {
  console.log(`${PREFIX} ✓ ${message}`);
}

function error(message) {
  console.error(`${PREFIX} ✗ ${message}`);
}

function warn(message) {
  console.warn(`${PREFIX} ⚠ ${message}`);
}

function debug(message) {
  if (verbose) {
    console.log(`${PREFIX} [DEBUG] ${message}`);
  }
}

// Default export for convenience
module.exports = {
  setVerbose,
  info,
  success,
  error,
  warn,
  debug
};
