import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/admin/users', navigate],
}));

import { AdminTabShell } from '../../src/components/AdminTabShell.jsx';

beforeEach(() => vi.clearAllMocks());

describe('AdminTabShell', () => {
  it('renders all five tabs, including the two stubs', () => {
    render(<AdminTabShell active="users"><div>content</div></AdminTabShell>);
    for (const label of ['Users', 'Projects', 'Audit Log', 'Site Features', 'Teams']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('marks the active tab', () => {
    const { container } = render(<AdminTabShell active="projects"><div>content</div></AdminTabShell>);
    const tabs = Array.from(container.querySelectorAll('.settings-tab'));
    const active = tabs.find(t => t.classList.contains('settings-tab--active'));
    expect(active.textContent).toContain('Projects');
  });

  it('navigates when a tab is clicked', () => {
    render(<AdminTabShell active="users"><div>content</div></AdminTabShell>);
    fireEvent.click(screen.getByText('Audit Log'));
    expect(navigate).toHaveBeenCalledWith('/admin/audit-log');
  });

  it('renders children', () => {
    render(<AdminTabShell active="users"><div data-testid="child">hi</div></AdminTabShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('labels the stub tabs as coming soon', () => {
    render(<AdminTabShell active="users"><div>content</div></AdminTabShell>);
    const soonLabels = screen.getAllByText('soon');
    expect(soonLabels.length).toBe(2);
  });
});
