import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePageThemeOverride } from '../../src/hooks/usePageThemeOverride.js';

function Probe({ storageKey }) {
  usePageThemeOverride(storageKey);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('usePageThemeOverride', () => {
  it('does nothing when no override is stored', () => {
    render(<Probe storageKey="lcyt.ui.editorTheme" />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('does nothing when the override is "auto"', () => {
    localStorage.setItem('lcyt.ui.editorTheme', 'auto');
    render(<Probe storageKey="lcyt.ui.editorTheme" />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('applies the override and restores the previous state on unmount', () => {
    localStorage.setItem('lcyt.ui.editorTheme', 'dark');
    const { unmount } = render(<Probe storageKey="lcyt.ui.editorTheme" />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    unmount();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('restores the prior theme (not just clears it) on unmount', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('lcyt.ui.plannerTheme', 'dark');
    const { unmount } = render(<Probe storageKey="lcyt.ui.plannerTheme" />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    unmount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
