import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetupCard } from '../../src/components/setup-hub/SetupCard.jsx';

describe('SetupCard', () => {
  it('renders title, description, and status pill', () => {
    render(<SetupCard icon="📷" title="Cameras" description="PTZ control" status="ready" />);
    expect(screen.getByText('Cameras')).toBeInTheDocument();
    expect(screen.getByText('PTZ control')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('does not render a body or chevron when there are no children', () => {
    const { container } = render(<SetupCard icon="📷" title="Cameras" status="ready" />);
    expect(container.querySelector('.setup-card__chevron')).not.toBeInTheDocument();
    expect(container.querySelector('.setup-card__body')).not.toBeInTheDocument();
  });

  it('toggles the body on header click when children are present', () => {
    const { container } = render(
      <SetupCard icon="📷" title="Cameras" status="ready">
        <div data-testid="body-content">hi</div>
      </SetupCard>
    );
    expect(screen.queryByTestId('body-content')).not.toBeInTheDocument();

    fireEvent.click(container.querySelector('.setup-card__header'));
    expect(screen.getByTestId('body-content')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.setup-card__header'));
    expect(screen.queryByTestId('body-content')).not.toBeInTheDocument();
  });

  it('never renders the body when disabled, even with children', () => {
    const { container } = render(
      <SetupCard icon="🔌" title="API connectors" status="soon" disabled>
        <div data-testid="body-content">hi</div>
      </SetupCard>
    );
    expect(container.querySelector('.setup-card--disabled')).toBeInTheDocument();
    expect(container.querySelector('.setup-card__header--clickable')).not.toBeInTheDocument();
    fireEvent.click(container.querySelector('.setup-card__header'));
    expect(screen.queryByTestId('body-content')).not.toBeInTheDocument();
  });

  it('renders a link action when action.href is given', () => {
    render(<SetupCard icon="🖼️" title="Viewports" status="ready" action={{ label: 'Manage', href: '/graphics/viewports' }} />);
    const link = screen.getByRole('link', { name: 'Manage' });
    expect(link).toHaveAttribute('href', '/graphics/viewports');
  });

  it('renders a button action and calls onClick', () => {
    const onClick = vi.fn();
    render(<SetupCard icon="🎯" title="Targets" status="ready" action={{ label: 'Do it', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(onClick).toHaveBeenCalled();
  });
});
