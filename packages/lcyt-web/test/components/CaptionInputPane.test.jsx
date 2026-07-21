import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptionContext } from '../../src/contexts/CaptionContext.jsx';
import { ConnectionContext } from '../../src/contexts/ConnectionContext.jsx';
import { PaneBody } from '../../src/components/production/workspace/panes/index.jsx';

function renderPane({ connected = true, send = vi.fn().mockResolvedValue(undefined) } = {}) {
  return render(
    <ConnectionContext.Provider value={{ connected }}>
      <CaptionContext.Provider value={{ send }}>
        <PaneBody type="captionInput" />
      </CaptionContext.Provider>
    </ConnectionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CaptionInputPane (Production workspace)', () => {
  it('shows a disabled state when not connected', () => {
    renderPane({ connected: false });
    expect(screen.getByText('Not connected.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Send a caption…')).toBeDisabled();
  });

  it('sends the typed text via CaptionContext.send() on Enter and clears the field', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPane({ send });

    const input = screen.getByPlaceholderText('Send a caption…');
    await user.type(input, 'Hello world{enter}');

    await waitFor(() => expect(send).toHaveBeenCalledWith('Hello world', expect.any(Number)));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('sends via the Send button', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPane({ send });

    await user.type(screen.getByPlaceholderText('Send a caption…'), 'Second line');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(send).toHaveBeenCalledWith('Second line', expect.any(Number));
  });

  it('shows an error message when send() rejects', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderPane({ send });

    await user.type(screen.getByPlaceholderText('Send a caption…'), 'oops{enter}');

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });

  it('does not send an empty/whitespace-only line', async () => {
    const send = vi.fn();
    const user = userEvent.setup();
    renderPane({ send });

    await user.type(screen.getByPlaceholderText('Send a caption…'), '   {enter}');

    expect(send).not.toHaveBeenCalled();
  });
});
