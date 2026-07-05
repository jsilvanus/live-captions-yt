import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { TeamPage } from '../../src/components/TeamPage.jsx';

function renderWith(connected) {
  return render(
    <SessionContext.Provider value={{ connected }}>
      <TeamPage />
    </SessionContext.Provider>
  );
}

describe('TeamPage', () => {
  it('renders a single "coming soon" placeholder with no tabs', () => {
    const { container } = renderWith(false);
    expect(screen.getByText(/team management is coming soon/i)).toBeInTheDocument();
    expect(container.querySelectorAll('.settings-tab').length).toBe(0);
  });

  it('links to /projects when no project is active', () => {
    renderWith(false);
    expect(screen.getByRole('link', { name: /team tab/i })).toHaveAttribute('href', '/projects');
  });

  it('links to / (the active project summary) when a project is connected', () => {
    renderWith(true);
    expect(screen.getByRole('link', { name: /team tab/i })).toHaveAttribute('href', '/');
  });
});
