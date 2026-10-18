/** Console output: one line per change of state. */
export function createConsoleOutput({ label = 'light', log = (line) => console.log(line) } = {}) {
  let lastState = null;
  return {
    name: 'console',
    apply(reading) {
      if (reading.state === lastState) return;
      lastState = reading.state;
      log(`[${label}] ${reading.state}${reading.detail ? ` (${reading.detail})` : ''}`);
    },
  };
}
