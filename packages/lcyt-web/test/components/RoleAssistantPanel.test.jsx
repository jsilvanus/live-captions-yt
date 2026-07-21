import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { RoleAssistantPanel } from '../../src/components/agent/RoleAssistantPanel.jsx';
import { GuidedActionProvider, useGuidedActionTargets } from '../../src/hooks/useGuidedAction.jsx';

const baseSession = { connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' };

function renderWith(ui, session = baseSession) {
  return render(
    <SessionContext.Provider value={session}>
      <GuidedActionProvider>{ui}</GuidedActionProvider>
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('RoleAssistantPanel', () => {
  it('shows the disabled message when not connected', () => {
    renderWith(<RoleAssistantPanel roleCode="setup_assistant" title="Setup Assistant" />, { connected: false });
    expect(screen.getByText(/Connect to a project/)).toBeInTheDocument();
  });

  it('posts to /roles/:roleCode/message and renders the reply', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, reply: 'Sure, here is the current setup.', pendingActions: [] }),
    });
    const user = userEvent.setup();
    renderWith(<RoleAssistantPanel roleCode="setup_assistant" title="Setup Assistant" />);

    await user.type(screen.getByPlaceholderText('Describe what you want…'), 'What targets do I have?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Sure, here is the current setup.')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/roles/setup_assistant/message',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ text: 'What targets do I have?' }),
      })
    );
  });

  it('dispatches a pending tool call to a registered guided-action handler', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        reply: '',
        pendingActions: [{ name: 'caption_target.create', args: { type: 'youtube', streamKey: 'abc' } }],
      }),
    });
    const opener = vi.fn();
    function DialogOwner() {
      useGuidedActionTargets({ 'caption_target.create': opener });
      return null;
    }
    const user = userEvent.setup();
    renderWith(
      <>
        <DialogOwner />
        <RoleAssistantPanel roleCode="setup_assistant" title="Setup Assistant" />
      </>
    );

    await user.type(screen.getByPlaceholderText('Describe what you want…'), 'Add a YouTube target');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(opener).toHaveBeenCalledWith({ type: 'youtube', streamKey: 'abc' }));
    expect(screen.getByText(/pre-filled from your request/)).toBeInTheDocument();
  });

  it('reports an unhandled tool call instead of silently dropping it', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        reply: '',
        pendingActions: [{ name: 'asset.delete', args: { id: 7 } }],
      }),
    });
    const user = userEvent.setup();
    renderWith(<RoleAssistantPanel roleCode="asset_control_assistant" title="Asset Control Assistant" />);

    await user.type(screen.getByPlaceholderText('Describe what you want…'), 'Delete asset 7');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/no interactive dialog is wired up/)).toBeInTheDocument());
  });

  it('surfaces a non-ok response as an error', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Role is not enabled for this project' }) });
    const user = userEvent.setup();
    renderWith(<RoleAssistantPanel roleCode="setup_assistant" title="Setup Assistant" />);

    await user.type(screen.getByPlaceholderText('Describe what you want…'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Role is not enabled for this project')).toBeInTheDocument());
  });
});
