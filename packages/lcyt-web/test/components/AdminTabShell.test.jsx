import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/admin/users', navigate],
}));

import { AdminTabShell } from '../../src/components/AdminTabShell.jsx';

beforeEach(() => vi.clearAllMocks());

describe('AdminTabShell', () => {
  it('renders exactly the mock\'s four tabs, in order', () => {
    render(<AdminTabShell active="users"><div>content</div></AdminTabShell>);
    const tabs = screen.getAllByRole('button').map(b => b.textContent);
    expect(tabs).toEqual(['Site Features', 'Teams', 'Projects', 'Users']);
  });

  it('does not render Audit Log or AI Models (kept as direct-URL-only routes)', () => {
    render(<AdminTabShell active="users"><div>content</div></AdminTabShell>);
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
    expect(screen.queryByText('AI Models')).not.toBeInTheDocument();
  });

  it('marks the active tab', () => {
    const { container } = render(<AdminTabShell active="projects"><div>content</div></AdminTabShell>);
    const tabs = Array.from(container.querySelectorAll('.settings-tab'));
    const active = tabs.find(t => t.classList.contains('settings-tab--active'));
    expect(active.textContent).toContain('Projects');
  });

  it('navigates when a tab is clicked', () => {
    render(<AdminTabShell active="users"><div>content</div></AdminTabShell>);
    fireEvent.click(screen.getByText('Teams'));
    expect(navigate).toHaveBeenCalledWith('/admin/teams');
  });

  it('renders children', () => {
    render(<AdminTabShell active="users"><div data-testid="child">hi</div></AdminTabShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
