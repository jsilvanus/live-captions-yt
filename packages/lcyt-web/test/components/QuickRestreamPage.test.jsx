import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const call = vi.fn();
vi.mock('../../src/components/quick/useQuickApi.js', () => ({ useQuickApi: () => ({ connected: true, call }) }));
vi.mock('../../src/components/quick/IngestDirections.jsx', () => ({ IngestDirections: () => <div>ingest</div> }));
vi.mock('../../src/hooks/usePolling.js', async () => {
  const React = await import('react');
  return { usePolling: (task) => { React.useEffect(() => { task(); }, []); } };
});
vi.mock('../../src/contexts/SessionContext', () => ({ useSessionContext: () => ({ connected: true }) }));
vi.mock('../../src/contexts/LangContext', () => ({ useLang: () => ({ t: (k) => k }) }));
vi.mock('wouter', () => ({ Link: ({ children, href }) => <a href={href}>{children}</a> }));

import { QuickRestreamPage } from '../../src/components/quick/QuickRestreamPage.jsx';

const stream = (over = {}) => ({ active: false, runningSlots: [], relays: [], ...over });

beforeEach(() => { call.mockReset(); });

describe('QuickRestreamPage', () => {
  it('shows the empty hint and blocks Start without outputs', async () => {
    call.mockResolvedValue(stream());
    render(<QuickRestreamPage />);
    await screen.findByText('quick.restream.empty');
    expect(screen.getByRole('button', { name: 'quick.restream.start' }).disabled).toBe(true);
  });

  it('adds a YouTube output through POST /stream', async () => {
    call.mockResolvedValue(stream());
    render(<QuickRestreamPage />);
    await screen.findByText('quick.restream.empty');
    fireEvent.click(screen.getByText('quick.restream.add'));
    fireEvent.change(screen.getByLabelText('quick.restream.form.youtubeKey'), { target: { value: 'abcd-efgh-ijkl-mnop' } });
    await act(async () => { fireEvent.click(screen.getByText('quick.restream.form.save')); });
    const post = call.mock.calls.find(([p, o]) => p === '/stream' && o?.method === 'POST');
    expect(post).toBeTruthy();
    expect(post[1].body.targetName).toBe('abcd-efgh-ijkl-mnop');
  });

  it('rejects an empty key without calling the backend', async () => {
    call.mockResolvedValue(stream());
    render(<QuickRestreamPage />);
    await screen.findByText('quick.restream.empty');
    fireEvent.click(screen.getByText('quick.restream.add'));
    fireEvent.click(screen.getByText('quick.restream.form.save'));
    expect(await screen.findByText('quick.restream.err.noKey')).toBeTruthy();
    expect(call.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('starts the relay with PUT /stream/active', async () => {
    call.mockImplementation(async (path, opts) => {
      if (path === '/stream' && !opts) return stream({ relays: [{ slot: 1, targetUrl: 'rtmp://a.rtmp.youtube.com/live2', targetName: 'key-1' }] });
      return {};
    });
    render(<QuickRestreamPage />);
    const start = await screen.findByRole('button', { name: 'quick.restream.start' });
    await waitFor(() => expect(start.disabled).toBe(false));
    await act(async () => { fireEvent.click(start); });
    expect(call).toHaveBeenCalledWith('/stream/active', { method: 'PUT', body: { active: true } });
  });

  it('shows the unavailable hint on 403', async () => {
    call.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
    render(<QuickRestreamPage />);
    expect(await screen.findByText('quick.ingest.unavailable')).toBeTruthy();
  });
});
