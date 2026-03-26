export function parseAnimation(anim) {
  if (!anim || !anim.trim()) {
    return { preset: '', duration: '1', easing: 'ease', delay: '0', iterations: '1', direction: 'normal', fillMode: 'forwards' };
  }
  const parts = anim.trim().split(/\s+/);
  return {
    preset:     parts[0] || '',
    duration:   (parts[1] || '1s').replace(/s$/, ''),
    easing:     parts[2] || 'ease',
    delay:      (parts[3] || '0s').replace(/s$/, ''),
    iterations: parts[4] || '1',
    direction:  parts[5] || 'normal',
    fillMode:   parts[6] || 'forwards',
  };
}

export function buildAnimation({ preset, duration, easing, delay, iterations, direction, fillMode }) {
  if (!preset) return '';
  return `${preset} ${duration}s ${easing} ${delay}s ${iterations} ${direction} ${fillMode}`;
}
