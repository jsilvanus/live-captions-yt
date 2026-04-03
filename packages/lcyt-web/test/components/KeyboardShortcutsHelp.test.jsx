/**
 * Tests for KeyboardShortcutsHelp component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsHelp } from '../../src/components/KeyboardShortcutsHelp.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KeyboardShortcutsHelp', () => {
  it('renders nothing when closed', () => {
    render(<KeyboardShortcutsHelp open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when open', () => {
    render(<KeyboardShortcutsHelp open={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('shows all shortcut sections', () => {
    render(<KeyboardShortcutsHelp open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Caption file')).toBeInTheDocument();
    expect(screen.getByText('App shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Input shortcuts')).toBeInTheDocument();
  });

  it('shows Ctrl+K shortcut', () => {
    render(<KeyboardShortcutsHelp open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Open command palette (go to any page)')).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close keyboard shortcuts'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />);
    const backdrop = document.querySelector('.shortcuts-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when dialog body is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes Escape listener when closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(<KeyboardShortcutsHelp open={true} onClose={onClose} />);

    rerender(<KeyboardShortcutsHelp open={false} onClose={onClose} />);

    // Escape should no longer trigger onClose
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
