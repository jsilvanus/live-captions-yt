import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PopOutButton } from '../../src/components/PopOutButton.jsx';

beforeEach(() => {
  vi.stubGlobal('open', vi.fn());
});

describe('PopOutButton', () => {
  it('opens the given embed path in a new same-origin window', async () => {
    const user = userEvent.setup();
    render(<PopOutButton embedPath="/embed/sentlog" />);

    await user.click(screen.getByRole('button'));

    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, target, features] = window.open.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/embed/sentlog`);
    expect(target).toBe('_blank');
    expect(features).toContain('width=420');
    expect(features).toContain('height=640');
  });

  it('respects custom width/height/title', async () => {
    const user = userEvent.setup();
    render(<PopOutButton embedPath="/embed/input" title="Pop out input" width={300} height={200} />);

    expect(screen.getByRole('button', { name: 'Pop out input' })).toBeInTheDocument();
    await user.click(screen.getByRole('button'));

    const [, , features] = window.open.mock.calls[0];
    expect(features).toContain('width=300');
    expect(features).toContain('height=200');
  });
});
