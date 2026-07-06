import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetupCard } from '../../src/components/setup-hub/SetupCard.jsx';
import { KEYS } from '../../src/lib/storageKeys.js';

function TestIcon() {
  return <svg data-testid="test-icon" />;
}

describe('SetupCard', () => {
  it('renders title, description, and status pill', () => {
    render(<SetupCard icon={TestIcon} title="Cameras" description="PTZ control" status="ready" />);
    expect(screen.getByText('Cameras')).toBeInTheDocument();
    expect(screen.getByText('PTZ control')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('does not render a body when there are no children or emptyText', () => {
    const { container } = render(<SetupCard icon={TestIcon} title="Cameras" status="ready" />);
    expect(container.querySelector('.setup-card__body')).not.toBeInTheDocument();
  });

  it('always renders children in the body — no expand/collapse', () => {
    const { container } = render(
      <SetupCard icon={TestIcon} title="Cameras" status="ready">
        <div data-testid="body-content">hi</div>
      </SetupCard>
    );
    expect(screen.getByTestId('body-content')).toBeInTheDocument();
    expect(container.querySelector('.setup-card__body')).toBeInTheDocument();
  });

  it('never renders the body when placeholder, even with children', () => {
    const { container } = render(
      <SetupCard icon={TestIcon} title="API connectors" status="soon" placeholder>
        <div data-testid="body-content">hi</div>
      </SetupCard>
    );
    expect(container.querySelector('.setup-card--placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('body-content')).not.toBeInTheDocument();
  });

  it('renders a header link when headerAction.href is given', () => {
    render(<SetupCard icon={TestIcon} title="Viewports" status="ready" headerAction={{ label: 'Manage', href: '/graphics/viewports' }} />);
    const link = screen.getByRole('link', { name: 'Manage' });
    expect(link).toHaveAttribute('href', '/graphics/viewports');
  });

  it('renders a header button and calls onClick', () => {
    const onClick = vi.fn();
    render(<SetupCard icon={TestIcon} title="Targets" status="ready" headerAction={{ label: 'Do it', onClick }} />);
    screen.getByRole('button', { name: 'Do it' }).click();
    expect(onClick).toHaveBeenCalled();
  });

  it('renders a footerLink below the body', () => {
    render(
      <SetupCard icon={TestIcon} title="Bridges" status="ready" footerLink={{ label: 'Open standalone page', href: '/production/bridges' }}>
        <div>content</div>
      </SetupCard>
    );
    const link = screen.getByRole('link', { name: /open standalone page/i });
    expect(link).toHaveAttribute('href', '/production/bridges');
  });

  it('renders a favorite star for cards with an id, toggles it, and persists to localStorage', () => {
    render(<SetupCard id="cameras" icon={TestIcon} title="Cameras" status="ready" />);
    const star = screen.getByRole('button', { name: /add to favorites/i });
    expect(star).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(star).toHaveAccessibleName(/remove from favorites/i);
    expect(JSON.parse(localStorage.getItem(KEYS.setup.favorites))).toEqual(['cameras']);

    fireEvent.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(localStorage.getItem(KEYS.setup.favorites))).toEqual([]);
  });

  it('does not render a favorite star when there is no id, or when placeholder', () => {
    const { rerender } = render(<SetupCard icon={TestIcon} title="No id" status="ready" />);
    expect(screen.queryByRole('button', { name: /favorites/i })).not.toBeInTheDocument();

    rerender(<SetupCard id="workflows" icon={TestIcon} title="Workflows" status="soon" placeholder />);
    expect(screen.queryByRole('button', { name: /favorites/i })).not.toBeInTheDocument();
  });

  it('applies the cta variant class and skips the icon-box category tint', () => {
    const { container } = render(<SetupCard id="workflows" icon={TestIcon} title="Workflows" variant="cta" />);
    expect(container.querySelector('.setup-card--cta')).toBeInTheDocument();
    expect(container.querySelector('.setup-card__icon-box')).not.toHaveAttribute('style');
  });
});
