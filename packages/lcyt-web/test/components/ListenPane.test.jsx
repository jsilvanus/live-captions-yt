import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const audio = { listening: false, toggle: vi.fn(), interimText: '' };
vi.mock('../../src/contexts/AudioContext', () => ({ useAudioContext: () => audio }));
vi.mock('../../src/contexts/LangContext', () => ({ useLang: () => ({ t: (k) => k }) }));
vi.mock('../../src/hooks/useSourceLanguages.js', () => ({ useSourceLanguages: () => ({ sourceLanguages: [] }) }));

import { ListenPane, ListenButton } from '../../src/components/production/workspace/panes/ListenPane.jsx';
import { PaneBody } from '../../src/components/production/workspace/panes/index.jsx';
import { getSttLang, setSttEngine } from '../../src/lib/sttConfig.js';
import { TYPE_OPTIONS, paneMeta } from '../../src/components/production/workspace/paneTypes.js';

beforeEach(() => { localStorage.clear(); audio.listening = false; audio.toggle.mockClear(); audio.interimText = ''; });

describe('ListenPane', () => {
  it('is registered as a pane type', () => {
    expect(TYPE_OPTIONS.some(([k]) => k === 'listen')).toBe(true);
    expect(paneMeta('listen').title).toBe('Listen');
    expect(typeof PaneBody).toBe('function');
  });

  it('starts and stops through the shared listener', () => {
    const { rerender } = render(<ListenPane />);
    fireEvent.click(screen.getByText('listenPane.start'));
    expect(audio.toggle).toHaveBeenCalledTimes(1);
    audio.listening = true;
    rerender(<ListenPane />);
    expect(screen.getByText('listenPane.stop').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches the recognition language', () => {
    render(<ListenPane />);
    fireEvent.change(screen.getByLabelText('listenPane.language'), { target: { value: 'sv-SE' } });
    expect(getSttLang()).toBe('sv-SE');
  });

  it('shows the server source note instead of device choice for server STT', () => {
    setSttEngine('server');
    render(<ListenPane />);
    expect(screen.getByText('listenPane.serverSource')).toBeTruthy();
  });

  it('ListenButton toggles from a pane header', () => {
    render(<ListenButton />);
    fireEvent.click(screen.getByText('listenPane.short.start'));
    expect(audio.toggle).toHaveBeenCalledTimes(1);
  });
});
