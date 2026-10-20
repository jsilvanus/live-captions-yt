import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const call = vi.fn();
const send = vi.fn(async () => {});
const updateTargets = vi.fn(async () => {});
const audio = { listening: false, toggle: vi.fn(), interimText: '' };
const session = { connected: true, backendUrl: '', getSttStatus: vi.fn(async () => ({ running: false })), startStt: vi.fn(async () => {}), stopStt: vi.fn(async () => {}), getSessionToken: () => 't' };
const sentLog = { entries: [{ requestId: 'a', text: 'Hello', sequence: 3 }] };

vi.mock('../../src/components/quick/useQuickApi.js', () => ({ useQuickApi: () => ({ connected: true, call }) }));
vi.mock('../../src/components/quick/IngestDirections.jsx', () => ({
  IngestDirections: ({ onChange }) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    require('react').useEffect(() => { onChange?.({ enabled: true, live: true, streamKey: 'ing-key', available: true }); }, []);
    return <div>ingest</div>;
  },
}));
vi.mock('../../src/hooks/usePolling.js', () => ({ usePolling: () => {} }));
vi.mock('../../src/hooks/useSourceLanguages.js', () => ({ useSourceLanguages: () => ({ sourceLanguages: [] }) }));
vi.mock('../../src/contexts/SessionContext', () => ({ useSessionContext: () => session }));
vi.mock('../../src/contexts/AudioContext', () => ({ useAudioContext: () => audio }));
vi.mock('../../src/contexts/CaptionContext', () => ({ useCaptionContext: () => ({ send, updateTargets }) }));
vi.mock('../../src/contexts/SentLogContext', () => ({ useSentLogContext: () => sentLog }));
vi.mock('../../src/contexts/LangContext', () => ({ useLang: () => ({ t: (k) => k }) }));
vi.mock('wouter', () => ({ Link: ({ children, href }) => <a href={href}>{children}</a> }));

import { QuickCaptionsPage } from '../../src/components/quick/QuickCaptionsPage.jsx';

beforeEach(() => {
  localStorage.clear();
  call.mockReset(); send.mockClear(); updateTargets.mockClear(); audio.toggle.mockClear();
  session.startStt.mockClear();
});

describe('QuickCaptionsPage', () => {
  it('asks for a key first and refuses to start without one', async () => {
    call.mockResolvedValue({ targets: [] });
    render(<QuickCaptionsPage />);
    expect(screen.getByText('quick.captions.key.none')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'quick.captions.start' })); });
    expect(screen.getByText('quick.captions.needKey')).toBeTruthy();
    expect(audio.toggle).not.toHaveBeenCalled();
  });

  it('rejects an invalid key and saves a valid one to the server', async () => {
    call.mockResolvedValue({ targets: [] });
    render(<QuickCaptionsPage />);
    const input = screen.getByRole('textbox', { name: 'quick.captions.key.label' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('quick.captions.key.save'));
    expect(await screen.findByText('quick.captions.key.invalid')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'abcd-efgh-ijkl-mnop' } });
    await act(async () => { fireEvent.click(screen.getByText('quick.captions.key.save')); });
    expect(call).toHaveBeenCalledWith('/targets', { method: 'POST', body: { type: 'youtube', streamKey: 'abcd-efgh-ijkl-mnop', enabled: true } });
    expect(updateTargets).toHaveBeenCalled();
  });

  it('starts the browser microphone once a key exists', async () => {
    call.mockResolvedValue({ targets: [{ id: 't1', type: 'youtube', streamKey: 'abcd-efgh-ijkl-mnop', enabled: true }] });
    render(<QuickCaptionsPage />);
    await waitFor(() => expect(screen.queryByText('quick.captions.key.none')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'quick.captions.start' }));
    expect(audio.toggle).toHaveBeenCalledTimes(1);
  });

  it('starts the auditor with the ingest key', async () => {
    call.mockResolvedValue({ targets: [{ id: 't1', type: 'youtube', streamKey: 'abcd-efgh-ijkl-mnop', enabled: true }] });
    render(<QuickCaptionsPage />);
    await waitFor(() => expect(screen.queryByText('quick.captions.key.none')).toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'quick.captions.engine.auditor' })); });
    expect(call).toHaveBeenCalledWith('/stt/config', expect.objectContaining({ method: 'PUT' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'quick.captions.start' })); });
    expect(session.startStt).toHaveBeenCalledWith(expect.objectContaining({ provider: 'auditor', streamKey: 'ing-key' }));
  });

  it('starts the auditor from a chosen feed with feedId', async () => {
    call.mockImplementation(async (path) => {
      if (path === '/targets') return { targets: [{ id: 't1', type: 'youtube', streamKey: 'abcd-efgh-ijkl-mnop', enabled: true }] };
      if (path === '/feeds') return { feeds: [{ id: 'f9', name: 'Mixer', kind: 'generic', transport: 'rtmp', feedKey: 'k9', ingestUrl: 'rtmp://h/stream/k9' }] };
      return {};
    });
    render(<QuickCaptionsPage />);
    await waitFor(() => expect(screen.queryByText('quick.captions.key.none')).toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'quick.captions.engine.auditor' })); });
    const pick = await screen.findByRole('combobox', { name: 'quick.captions.audioFrom' });
    await act(async () => { fireEvent.change(pick, { target: { value: 'f9' } }); });
    expect(call).toHaveBeenCalledWith('/stt/config', { method: 'PUT', body: { feedId: 'f9' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'quick.captions.start' })); });
    const arg = session.startStt.mock.calls[0][0];
    expect(arg.feedId).toBe('f9');
    expect(arg.streamKey).toBeUndefined();
  });

  it('lists sent captions and sends a typed one', async () => {
    call.mockResolvedValue({ targets: [] });
    render(<QuickCaptionsPage />);
    expect(screen.getByText('Hello')).toBeTruthy();
    const input = screen.getByLabelText('quick.captions.placeholder');
    fireEvent.change(input, { target: { value: 'Amen' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(send).toHaveBeenCalledWith('Amen', expect.any(Number));
  });
});
