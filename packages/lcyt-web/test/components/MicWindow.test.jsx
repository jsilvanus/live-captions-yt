import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const audio = { listening: false, toggle: vi.fn(), interimText: '' };
const send = vi.fn(async () => {});
const sentLog = { entries: [{ requestId: 'a', text: 'Hello', sequence: 3 }, { requestId: 'b', text: 'bad', error: 'x' }] };
vi.mock('../../src/contexts/AudioContext', () => ({ useAudioContext: () => audio }));
vi.mock('../../src/contexts/CaptionContext', () => ({ useCaptionContext: () => ({ send }) }));
vi.mock('../../src/contexts/ConnectionContext', () => ({ useConnectionContext: () => ({ connected: true }) }));
vi.mock('../../src/contexts/SentLogContext', () => ({ useSentLogContext: () => sentLog }));
vi.mock('../../src/contexts/LangContext', () => ({ useLang: () => ({ t: (k) => k }) }));

import { MicWindow } from '../../src/components/MicWindow.jsx';
import { requestMicWindow, openMicWindow } from '../../src/lib/micWindow.js';

beforeEach(() => { audio.toggle.mockClear(); send.mockClear(); });
afterEach(() => { delete window.documentPictureInPicture; vi.restoreAllMocks(); });

describe('openMicWindow', () => {
  it('prefers Document Picture-in-Picture, then a popup, then null', async () => {
    const pipWin = { id: 'pip' };
    expect(await openMicWindow({ documentPictureInPicture: { requestWindow: async () => pipWin } }))
      .toEqual({ mode: 'pip', win: pipWin });
    const popup = { closed: false };
    expect(await openMicWindow({ documentPictureInPicture: { requestWindow: async () => { throw new Error('no'); } }, open: () => popup }))
      .toEqual({ mode: 'popup', win: popup });
    expect(await openMicWindow({ open: () => null })).toBeNull();
  });
});

describe('MicWindow', () => {
  it('renders nothing until opened, then shows an in-page bar when no window type exists', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = render(<MicWindow />);
    expect(container.innerHTML).toBe('');
    await act(async () => { requestMicWindow('open'); });
    expect(screen.getByText('listenPane.start')).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.queryByText('bad')).toBeNull();
    fireEvent.click(screen.getByText('listenPane.start'));
    expect(audio.toggle).toHaveBeenCalledTimes(1);
  });

  it('sends a typed caption and closes on request', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<MicWindow />);
    await act(async () => { requestMicWindow('open'); });
    const input = screen.getByLabelText('micWindow.placeholder');
    fireEvent.change(input, { target: { value: 'Amen' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(send).toHaveBeenCalledWith('Amen', expect.any(Number));
    await act(async () => { requestMicWindow('toggle'); });
    expect(screen.queryByText('listenPane.start')).toBeNull();
  });
});
