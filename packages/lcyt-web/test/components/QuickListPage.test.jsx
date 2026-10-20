import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const call = vi.fn();
vi.mock('../../src/components/quick/useQuickApi.js', () => ({ useQuickApi: () => ({ connected: true, call }) }));
vi.mock('../../src/hooks/usePolling.js', async () => {
  const React = await import('react');
  return { usePolling: (task) => { React.useEffect(() => { task(); }, []); } };
});
vi.mock('../../src/contexts/SessionContext', () => ({ useSessionContext: () => ({ connected: true }) }));
vi.mock('../../src/contexts/LangContext', () => ({ useLang: () => ({ t: (k) => k }) }));
vi.mock('wouter', () => ({ Link: ({ children, href }) => <a href={href}>{children}</a> }));

import { QuickListPage } from '../../src/components/quick/QuickListPage.jsx';
import { QUICK_WORKFLOWS, openWorkflowWindow } from '../../src/components/quick/workflows.js';

beforeEach(() => { call.mockReset(); });

describe('QuickListPage', () => {
  it('lists both workflows with ready / needs-setup badges', async () => {
    call.mockImplementation(async (p) => (p === '/targets'
      ? { targets: [{ type: 'youtube', streamKey: 'k', enabled: true }] }
      : { relays: [] }));
    render(<QuickListPage />);
    expect(screen.getByTestId('workflow-captions')).toBeTruthy();
    expect(screen.getByTestId('workflow-restream')).toBeTruthy();
    expect(await screen.findByText('quick.needsSetup')).toBeTruthy();
    expect(screen.getAllByRole('link').some(a => a.getAttribute('href') === '/captions')).toBe(true);
  });

  it('warns when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    call.mockResolvedValue({});
    render(<QuickListPage />);
    fireEvent.click(screen.getAllByText('quick.openWindow')[0]);
    expect(screen.getByText('quick.popupBlocked')).toBeTruthy();
  });
});

describe('openWorkflowWindow', () => {
  it('opens /quick/<path> sized for the workflow', () => {
    const open = vi.fn(() => ({}));
    expect(openWorkflowWindow(QUICK_WORKFLOWS[0], open)).toBeTruthy();
    expect(open.mock.calls[0][0]).toBe(`/quick${QUICK_WORKFLOWS[0].path}`);
    expect(open.mock.calls[0][2]).toContain('width=');
  });
});
