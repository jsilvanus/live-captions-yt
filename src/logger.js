const PREFIX = '[LCYT]';

let verbose = false;

export function setVerbose(value) {
  verbose = value;
}

export function info(message) {
  console.log(`${PREFIX} ${message}`);
}

export function success(message) {
  console.log(`${PREFIX} ✓ ${message}`);
}

export function error(message) {
  console.error(`${PREFIX} ✗ ${message}`);
}

export function warn(message) {
  console.warn(`${PREFIX} ⚠ ${message}`);
}

export function debug(message) {
  if (verbose) {
    console.log(`${PREFIX} [DEBUG] ${message}`);
  }
}

// Default export for convenience
export default {
  setVerbose,
  info,
  success,
  error,
  warn,
  debug
};
