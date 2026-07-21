import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SidebarLayout } from '../../src/components/SidebarLayout.jsx';

// Heavy child components each need their own context stack (session, user
// auth, active-broadcast, etc.) that's irrelevant to the one thing under
// test here — the first-visit privacy redirect effect — so they're stubbed
// out to keep this test focused.
vi.mock('../../src/components/sidebar/Sidebar.jsx', () => ({
  TopBar: () => null,
  Sidebar: () => null,
}));
vi.mock('../../src/components/CommandPalette.jsx', () => ({ CommandPalette: () => null }));
vi.mock('../../src/components/KeyboardShortcutsHelp.jsx', () => ({ KeyboardShortcutsHelp: () => null }));
vi.mock('../../src/components/ConnectionStatusMonitor.jsx', () => ({ ConnectionStatusMonitor: () => null }));
vi.mock('../../src/components/StorageQuotaMonitor.jsx', () => ({ StorageQuotaMonitor: () => null }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSessionContext: () => ({ reconnecting: false, reconnectNow: vi.fn() }),
}));

const navigateMock = vi.fn();
let mockLocation = '/';

vi.mock('wouter', () => ({
  useLocation: () => [mockLocation, navigateMock],
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockLocation = '/';
});

describe('SidebarLayout — first-visit privacy redirect (plan: privacy moved to /account)', () => {
  it('redirects to /account when lcyt:privacyAccepted is unset', () => {
    mockLocation = '/setup';
    render(<SidebarLayout>content</SidebarLayout>);
    expect(navigateMock).toHaveBeenCalledWith('/account');
  });

  it('does not redirect when already on /account', () => {
    mockLocation = '/account';
    render(<SidebarLayout>content</SidebarLayout>);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does not redirect once lcyt:privacyAccepted is set', () => {
    localStorage.setItem('lcyt:privacyAccepted', '1');
    mockLocation = '/setup';
    render(<SidebarLayout>content</SidebarLayout>);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('still renders the page content underneath', () => {
    localStorage.setItem('lcyt:privacyAccepted', '1');
    mockLocation = '/setup';
    const { getByText } = render(<SidebarLayout>my page content</SidebarLayout>);
    expect(getByText('my page content')).toBeInTheDocument();
  });
});
