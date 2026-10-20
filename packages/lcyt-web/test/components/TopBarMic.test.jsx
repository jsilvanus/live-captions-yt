import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const audio = { listening: false, toggle: vi.fn() };
vi.mock('../../src/contexts/AudioContext', () => ({ useAudioContext: () => audio }));
vi.mock('../../src/contexts/LangContext', () => ({
  useLang: () => ({ t: (k) => k }),
}));

import { TopBarMic } from '../../src/components/sidebar/TopBarMic.jsx';
import { setSttLang, setSttEngine, setSttSpeechMode } from '../../src/lib/sttConfig.js';

beforeEach(() => { localStorage.clear(); audio.listening = false; audio.toggle.mockClear(); });

describe('TopBarMic', () => {
  it('toggles the shared listener', () => {
    render(<TopBarMic />);
    fireEvent.click(screen.getByTestId('top-bar-mic'));
    expect(audio.toggle).toHaveBeenCalledTimes(1);
  });

  it('shows state and follows STT setting changes', () => {
    audio.listening = true;
    render(<TopBarMic />);
    const btn = screen.getByTestId('top-bar-mic');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.className).toContain('top-bar__mic--on');
    act(() => { setSttEngine('webkit'); setSttSpeechMode('local'); setSttLang('fi-FI'); });
    expect(btn.getAttribute('aria-label')).toContain('fi-FI');
    expect(btn.getAttribute('aria-label')).toContain('topMic.local');
    act(() => setSttEngine('server'));
    expect(btn.getAttribute('aria-label')).toContain('topMic.server');
  });
});
