import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { PlannerAssistPanel } from '../../src/components/planner/PlannerAssistPanel.jsx';

const baseSession = { connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' };

const baseChatProps = {
  title: 'Planner Assistant',
  subtitle: 'Describe the event to draft a rundown.',
  messages: [],
  onSend: vi.fn(),
  loading: false,
  error: '',
  disabled: false,
  isNarrow: false,
};

function renderWith(chatProps = baseChatProps, session = baseSession) {
  return render(
    <SessionContext.Provider value={{ getPersistedConfig: () => ({}), ...session }}>
      <PlannerAssistPanel chatProps={chatProps} />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: [], actions: [] }) });
});

describe('PlannerAssistPanel', () => {
  it('shows the Cues tab active by default', async () => {
    renderWith();
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '📋 Cues' })).toHaveClass('planner-assist-panel__tab--active');
    expect(screen.getByRole('button', { name: '⚡ Actions' })).not.toHaveClass('planner-assist-panel__tab--active');
  });

  it('switches to the Actions tab and renders NamedActionsManager content', async () => {
    const user = userEvent.setup();
    renderWith();
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '⚡ Actions' }));

    await waitFor(() => expect(screen.getByText('No named actions yet — add one to get started.')).toBeInTheDocument());
    expect(screen.queryByText('No cue rules yet — add one to get started.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⚡ Actions' })).toHaveClass('planner-assist-panel__tab--active');
  });

  it('always renders the AI assistant chat below the active tab', async () => {
    renderWith();
    await waitFor(() => expect(screen.getByPlaceholderText('Describe what you want…')).toBeInTheDocument());
    expect(screen.getByText('Describe the event to draft a rundown.')).toBeInTheDocument();
  });

  it('keeps the chat visible when switching tabs', async () => {
    const user = userEvent.setup();
    renderWith();
    await waitFor(() => expect(screen.getByPlaceholderText('Describe what you want…')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '⚡ Actions' }));

    expect(screen.getByPlaceholderText('Describe what you want…')).toBeInTheDocument();
  });
});
