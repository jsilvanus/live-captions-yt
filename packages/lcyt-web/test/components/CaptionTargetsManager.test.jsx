import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { CaptionTargetsManager } from '../../src/components/TargetCaptionsPage.jsx';

vi.mock('../../src/contexts/LangContext.jsx', () => ({
  useLang: () => ({ t: key => key }),
}));

describe('CaptionTargetsManager', () => {
  const fetchMock = vi.fn();
  const session = {
    backendUrl: 'http://backend.test',
    connected: true,
    getSessionToken: () => 'token',
    listIcons: vi.fn().mockResolvedValue({ icons: [] }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation((url, opts = {}) => {
      if (url === 'http://backend.test/targets' && opts.method !== 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ targets: [] }) });
      }
      if (opts.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'new-target' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ targets: [] }) });
    });
    global.fetch = fetchMock;
  });

  it('parses generic target headers before POSTing to the backend', async () => {
    const ref = createRef();

    render(
      <SessionContext.Provider value={session}>
        <CaptionTargetsManager embedded ref={ref} />
      </SessionContext.Provider>
    );

    await act(async () => {
      ref.current.openAdd();
    });

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'generic' } });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/captions'), { target: { value: 'https://example.com/captions' } });
    fireEvent.change(screen.getByPlaceholderText('{"Authorization": "******"}'), { target: { value: '{"Authorization":"Bearer abc"}' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });

    // Save triggers a POST, then a reload GET to resync the list — assert the
    // POST happened rather than pin an exact call count that shifts with that
    // (correct) reload behavior.
    await waitFor(() => expect(fetchMock.mock.calls.some(args => args[1]?.method === 'POST')).toBe(true));

    const saveCall = fetchMock.mock.calls.find((args) => args[1]?.method === 'POST');
    expect(saveCall).toBeDefined();
    expect(JSON.parse(saveCall[1].body)).toMatchObject({
      type: 'generic',
      url: 'https://example.com/captions',
      headers: { Authorization: 'Bearer abc' },
    });
  });
});
