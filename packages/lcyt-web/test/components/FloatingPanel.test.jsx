import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingPanel } from '../../src/components/FloatingPanel.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FloatingPanel', () => {
  it('renders title and children', () => {
    render(
      <FloatingPanel title="Test Panel" onClose={vi.fn()}>
        <p>Panel content</p>
      </FloatingPanel>
    );
    expect(screen.getByText('Test Panel')).toBeInTheDocument();
    expect(screen.getByText('Panel content')).toBeInTheDocument();
  });

  it('has dialog role with aria-label', () => {
    render(<FloatingPanel title="My Panel" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'My Panel');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<FloatingPanel title="Panel" onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders with correct CSS classes', () => {
    render(<FloatingPanel title="Panel" onClose={vi.fn()} />);
    const panel = document.querySelector('.floating-panel');
    expect(panel).not.toBeNull();
    expect(document.querySelector('.floating-panel__header')).not.toBeNull();
    expect(document.querySelector('.floating-panel__body')).not.toBeNull();
  });

  it('positions panel at initial coordinates', () => {
    render(<FloatingPanel title="Panel" onClose={vi.fn()} />);
    const panel = document.querySelector('.floating-panel');
    expect(panel.style.top).toBeTruthy();
    expect(panel.style.left).toBeTruthy();
  });
});
