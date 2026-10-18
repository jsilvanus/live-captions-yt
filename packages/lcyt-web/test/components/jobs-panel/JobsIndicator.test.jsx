import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import JobsIndicator from '../../../src/components/JobsIndicator.jsx';
import { SessionContext } from '../../../src/contexts/SessionContext.jsx';

const session = (over = {}) => ({ connected: true, backendUrl: 'http://backend/', getSessionToken: () => 'sess-token', ...over });
const mount = (value) => render(<SessionContext.Provider value={value}><JobsIndicator /></SessionContext.Provider>);

afterEach(() => vi.unstubAllGlobals());

describe('JobsIndicator', { timeout: 20_000 }, () => {
  it('asks the backend with the session token and shows the count', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push([url, init.headers.Authorization]);
      const body = url.endsWith('/jobs/strip')
        ? { enabled: true, fleet: null, local: null, app: { running: 1, queued: 0 }, stt: null, live: null }
        : { jobs: [{ id: 'ffmpeg-1', projectId: 'k', projectTitle: 'hls', type: 'FFMPEG', status: 'RUNNING', phase: null, progress: 0, message: null, error: null, workerId: 'spawn', cancelRequested: false, createdAt: new Date().toISOString(), startedAt: null, completedAt: null }], counts: { running: 1, queued: 0 } };
      return { ok: true, status: 200, json: async () => body };
    }));
    mount(session());
    await waitFor(() => expect(screen.getByTitle('1 running or queued')).toBeInTheDocument());
    expect([...new Set(calls.map((c) => c[0]))].sort()).toEqual(['http://backend/api/v1/jobs', 'http://backend/api/v1/jobs/strip']);
    expect(calls.every((c) => c[1] === 'Bearer sess-token')).toBe(true);
  });

  it('renders nothing and calls nothing while not connected', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = mount(session({ connected: false }));
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
