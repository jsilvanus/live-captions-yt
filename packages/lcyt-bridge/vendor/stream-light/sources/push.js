/**
 * Push sources: the host feeds states in (switcher events), the light listens.
 * Also the pure mappings from switcher state to camera tally state.
 */

/** A source the host drives by calling `push({ state, detail })`. */
export function createPushSource() {
  const listeners = new Set();
  return {
    subscribe(emit) {
      listeners.add(emit);
      return () => listeners.delete(emit);
    },
    push(reading) {
      for (const emit of [...listeners]) emit(reading);
    },
  };
}

/** ATEM: program is PGM, preview is PRV, anything else is OFF. */
export function atemTallyState(atemState, { meIndex = 0, input } = {}) {
  const me = atemState?.video?.mixEffects?.[meIndex];
  if (!me) return null;
  if (me.programInput === input) return 'PGM';
  if (me.previewInput === input) return 'PRV';
  return 'OFF';
}

/** A software mixer that only has a program input: that input is PGM, any other is OFF, unknown is null. */
export function programInputTallyState(activeInput, input) {
  if (activeInput == null) return null;
  return activeInput === input ? 'PGM' : 'OFF';
}

/** OBS: the program scene is PGM, the studio-mode preview scene is PRV. */
export function obsTallyState({ program, preview } = {}, sceneName) {
  if (program == null && preview == null) return null;
  if (program === sceneName) return 'PGM';
  if (preview === sceneName) return 'PRV';
  return 'OFF';
}

/**
 * Camera tally from an `atem-connection` style object (EventEmitter with `state`;
 * events `connected`, `disconnected`, `stateChanged`). The caller owns the
 * connection, this only listens.
 */
export function createAtemSource({ atem, input, meIndex = 0, isConnected = () => true }) {
  const source = createPushSource();
  const current = () => (isConnected() ? atemTallyState(atem.state, { meIndex, input }) : null);
  const emitCurrent = () => {
    const state = current();
    source.push(state ? { state } : { state: 'UNKNOWN', detail: 'switcher not connected' });
  };
  const subscribe = source.subscribe;
  source.subscribe = (emit) => {
    const off = subscribe(emit);
    const onState = () => emitCurrent();
    const onDown = () => source.push({ state: 'UNKNOWN', detail: 'switcher disconnected' });
    atem.on('stateChanged', onState);
    atem.on('connected', onState);
    atem.on('disconnected', onDown);
    if (current()) emitCurrent();
    return () => {
      off();
      atem.off?.('stateChanged', onState);
      atem.off?.('connected', onState);
      atem.off?.('disconnected', onDown);
    };
  };
  return source;
}
