import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSpeech } from '../../src/hooks/useWebSpeech.js';
import {
  getSttSpeechMode, setSttSpeechMode, getSttLocalProcessing, subscribeSttConfig, setSttLang,
} from '../../src/lib/sttConfig.js';
import { normalizeAvailability, checkLocalSpeech, installLocalSpeech } from '../../src/lib/speechLocal.js';

let instances;
class FakeSR {
  constructor() { this.processLocally = false; this.started = 0; this.stopped = 0; instances.push(this); }
  start() { this.started++; this.onstart?.(); }
  stop() { this.stopped++; queueMicrotask(() => this.onend?.()); }
}

beforeEach(() => {
  instances = [];
  localStorage.clear();
  window.SpeechRecognition = FakeSR;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete window.SpeechRecognition;
});

describe('useWebSpeech', () => {
  it('applies lang and processLocally from the mode', () => {
    const { result } = renderHook(() => useWebSpeech({ lang: 'fi-FI', mode: 'local' }));
    act(() => result.current.start());
    expect(instances[0].lang).toBe('fi-FI');
    expect(instances[0].processLocally).toBe(true);
    expect(result.current.effectiveMode).toBe('local');
    expect(result.current.status).toBe('listening');
  });

  it('keeps processLocally off in normal mode', () => {
    const { result } = renderHook(() => useWebSpeech({ lang: 'en-US', mode: 'normal' }));
    act(() => result.current.start());
    expect(instances[0].processLocally).toBe(false);
    expect(result.current.effectiveMode).toBe('normal');
  });

  it('falls back to normal once when the language is not supported on-device', async () => {
    const { result } = renderHook(() => useWebSpeech({ lang: 'fi-FI', mode: 'local' }));
    act(() => result.current.start());
    const first = instances[0];
    act(() => { first.onerror({ error: 'language-not-supported' }); first.onend(); });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(first.started).toBe(2);
    expect(first.processLocally).toBe(false);
    expect(result.current.effectiveMode).toBe('normal');
    expect(result.current.status).toBe('listening');
  });

  it('calls the latest callbacks, not the ones bound at start()', () => {
    const a = vi.fn(); const b = vi.fn();
    const { result, rerender } = renderHook((p) => useWebSpeech({ lang: 'en-US', onFinal: p.cb }), { initialProps: { cb: a } });
    act(() => result.current.start());
    rerender({ cb: b });
    act(() => instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'hi' }], { isFinal: true })] }));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('hi');
  });

  it('restarts with the new language while listening', async () => {
    const { result, rerender } = renderHook((p) => useWebSpeech({ lang: p.lang }), { initialProps: { lang: 'en-US' } });
    act(() => result.current.start());
    rerender({ lang: 'fi-FI' });
    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(150); });
    expect(instances[0].lang).toBe('fi-FI');
    expect(instances[0].started).toBe(2);
  });

  it('does not restart after stop()', async () => {
    const { result } = renderHook(() => useWebSpeech({ lang: 'en-US' }));
    act(() => result.current.start());
    act(() => result.current.stop());
    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(300); });
    expect(instances[0].started).toBe(1);
    expect(result.current.status).toBe('idle');
  });
});

describe('sttConfig speech mode', () => {
  it('defaults to normal and reads the legacy local flag', () => {
    expect(getSttSpeechMode()).toBe('normal');
    localStorage.setItem('lcyt-stt-local', '1');
    expect(getSttSpeechMode()).toBe('local');
  });

  it('stores the mode, keeps the legacy flag in step and notifies subscribers', () => {
    const fn = vi.fn();
    const off = subscribeSttConfig(fn);
    setSttSpeechMode('local');
    expect(getSttLocalProcessing()).toBe(true);
    expect(localStorage.getItem('lcyt-stt-local')).toBe('1');
    setSttLang('fi-FI');
    off();
    setSttSpeechMode('normal');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(getSttSpeechMode()).toBe('normal');
  });
});

describe('speechLocal', () => {
  it('normalises availability values', () => {
    expect(normalizeAvailability('readily')).toBe('available');
    expect(normalizeAvailability('after-download')).toBe('downloadable');
    expect(normalizeAvailability('no')).toBe('unavailable');
    expect(normalizeAvailability(undefined)).toBe('unavailable');
  });

  it('reports unsupported without the API', async () => {
    expect(await checkLocalSpeech('fi-FI', {})).toBe('unsupported');
    expect(await installLocalSpeech('fi-FI', {})).toBe(false);
  });

  it('uses the {langs, processLocally} form first and the older form on failure', async () => {
    const modern = { available: vi.fn(async () => 'downloadable') };
    expect(await checkLocalSpeech('fi-FI', modern)).toBe('downloadable');
    expect(modern.available).toHaveBeenCalledWith({ langs: ['fi-FI'], processLocally: true });

    const legacy = { available: vi.fn(async (a) => { if (typeof a === 'object') throw new TypeError('x'); return 'readily'; }) };
    expect(await checkLocalSpeech('fi-FI', legacy)).toBe('available');
    expect(legacy.available).toHaveBeenLastCalledWith('fi-FI', { processLocally: true });
  });

  it('never throws when both forms fail', async () => {
    const bad = { available: async () => { throw new Error('no'); }, install: async () => { throw new Error('no'); } };
    expect(await checkLocalSpeech('fi-FI', bad)).toBe('unsupported');
    expect(await installLocalSpeech('fi-FI', bad)).toBe(false);
  });
});
