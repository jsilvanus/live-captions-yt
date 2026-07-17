import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

vi.mock('../../src/components/AdminKeyGate.jsx', () => ({ AdminKeyGate: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/components/AdminTabShell.jsx', () => ({ AdminTabShell: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ user: { isAdmin: true }, backendUrl: 'http://backend.test' }),
}));
vi.mock('../../src/lib/admin.js', () => ({
  adminFetch: (backendUrl, path) => mockAdminFetch(backendUrl, path),
}));

import { AdminMetricsPage, formatMetricValue } from '../../src/components/AdminMetricsPage.jsx';

let mockAdminFetch;

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

const LIVE = {
  activeSessions: 3,
  sse: { viewer: 4, 'event-bus': 2 },
  ffmpeg: { relay: 1 },
  burst: { active: [], history: [], totals: { created: 2, destroyed: 2, vmSecondsTotal: 7200 } },
  ts: Date.now(),
};

const SERIES = {
  series: [
    { key: '', metric: 'captions.sent', points: [['2026-07-16T10:00:00Z', 40], ['2026-07-16T11:00:00Z', 60]] },
    { key: '', metric: 'stt.seconds', points: [['2026-07-16T10:00:00Z', 120]] },
  ],
  catalog: [],
};

function renderPage() {
  return render(
    <SessionContext.Provider value={{ backendUrl: 'http://backend.test' }}>
      <AdminMetricsPage />
    </SessionContext.Provider>
  );
}

describe('AdminMetricsPage', () => {
  beforeEach(() => {
    mockAdminFetch = vi.fn((backendUrl, path) => {
      if (path.startsWith('/admin/metrics/live')) return jsonResponse(LIVE);
      if (path.includes('groupBy=project')) {
        return jsonResponse({ series: [{ key: 'proj-1', metric: 'captions.sent', points: [['2026-07-16T10:00:00Z', 100]] }] });
      }
      return jsonResponse(SERIES);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders live tiles and rollup series', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Active sessions')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();          // active sessions
      expect(screen.getAllByText('captions.sent').length).toBeGreaterThan(0);
      expect(screen.getAllByText('stt.seconds').length).toBeGreaterThan(0);
    });
    // Top projects bar list rendered from the groupBy=project response
    await waitFor(() => {
      expect(screen.getByText('proj-1')).toBeTruthy();
    });
  });
});

describe('formatMetricValue', () => {
  it('humanizes bytes, seconds, and counts', () => {
    expect(formatMetricValue('egress.mediamtx_bytes', 2_500_000)).toBe('2.5 MB');
    expect(formatMetricValue('stt.seconds', 5400)).toBe('1.5 h');
    expect(formatMetricValue('captions.sent', 1500)).toBe('1.5k');
    expect(formatMetricValue('captions.sent', 12)).toBe('12');
  });
});
