import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { AiRoleModelsSection } from '../../src/components/setup-hub/AiRoleModelsSection.jsx';

const ROLES = [
  { roleCode: 'tracker', name: 'Tracker', description: 'Vision tracker.', runtimeKind: 'continuous_vision' },
  { roleCode: 'setup_assistant', name: 'Setup Assistant', description: 'Configures Setup Hub cards.', runtimeKind: 'agentic_chat' },
  { roleCode: 'planner', name: 'Planner Assistant', description: 'Assists writing a rundown.', runtimeKind: 'agentic_chat' },
];

const PROVIDERS = [
  { id: 'prov-openai', name: 'OpenAI', kind: 'api', vendor: 'openai', reachability: 'direct' },
  { id: 'prov-ollama', name: 'Office GPU', kind: 'ollama', vendor: 'ollama', reachability: 'bridge' },
];

const CONFIGS = {
  setup_assistant: { roleCode: 'setup_assistant', enabled: false, providerId: null, modelName: '', harnessConfig: {}, updatedAt: null },
  planner: { roleCode: 'planner', enabled: true, providerId: 'prov-openai', modelName: 'gpt-4o-mini', harnessConfig: {}, updatedAt: 1 },
};

const MODELS = [
  { id: 1, providerId: 'prov-ollama', modelName: 'llama3.1:8b', capabilities: ['chat'], source: 'discovered', enabled: true, parameterSize: '8.0B' },
];

const baseSession = { connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' };

function mockFetchImpl({ onPut } = {}) {
  return (url, opts) => {
    const method = opts?.method || 'GET';
    if (url.endsWith('/roles/catalog')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, roles: ROLES }) });
    }
    if (url.endsWith('/ai/providers')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, providers: PROVIDERS }) });
    }
    if (url.includes('/ai/providers/prov-ollama/models')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, models: MODELS }) });
    }
    const configMatch = url.match(/\/roles\/([^/]+)\/config$/);
    if (configMatch && method === 'GET') {
      const roleCode = configMatch[1];
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, config: CONFIGS[roleCode] }) });
    }
    if (configMatch && method === 'PUT') {
      const roleCode = configMatch[1];
      const body = JSON.parse(opts.body);
      onPut?.(roleCode, body);
      const merged = { ...CONFIGS[roleCode], ...body };
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, config: merged }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
}

function renderWith(session = baseSession) {
  return render(
    <SessionContext.Provider value={{ getPersistedConfig: () => ({}), ...session }}>
      <AiRoleModelsSection />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('AiRoleModelsSection', () => {
  it('shows a connect prompt when not connected', () => {
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });
    expect(screen.getByText('Connect to a project to configure AI role models.')).toBeInTheDocument();
  });

  it('lists only agentic_chat roles, with a provider/model summary per row', async () => {
    global.fetch.mockImplementation(mockFetchImpl());
    renderWith();

    await waitFor(() => expect(screen.getByText('Setup Assistant')).toBeInTheDocument());
    expect(screen.getByText('Planner Assistant')).toBeInTheDocument();
    expect(screen.queryByText('Tracker')).not.toBeInTheDocument();

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText('OpenAI · gpt-4o-mini')).toBeInTheDocument();
  });

  it('quick-toggles a role\'s enabled flag from the row switch', async () => {
    const onPut = vi.fn();
    global.fetch.mockImplementation(mockFetchImpl({ onPut }));
    renderWith();

    await waitFor(() => expect(screen.getByText('Planner Assistant')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Disable Planner Assistant'));

    await waitFor(() => {
      expect(onPut).toHaveBeenCalledWith('planner', { enabled: false });
    });
  });

  it('opens the settings dialog, picks a provider, and saves a free-text model name for an api-kind provider', async () => {
    const onPut = vi.fn();
    global.fetch.mockImplementation(mockFetchImpl({ onPut }));
    renderWith();

    await waitFor(() => expect(screen.getByText('Setup Assistant')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getAllByTitle('Settings')[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Configure Setup Assistant')).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'prov-openai');
    await user.type(within(dialog).getByPlaceholderText('model name, e.g. gpt-4o-mini'), 'gpt-4o-mini');
    await user.click(within(dialog).getByLabelText('Enabled'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onPut).toHaveBeenCalledWith('setup_assistant', {
        enabled: true,
        providerId: 'prov-openai',
        modelName: 'gpt-4o-mini',
      });
    });
  });

  it('shows a discovered-model dropdown for an ollama-kind provider', async () => {
    global.fetch.mockImplementation(mockFetchImpl());
    renderWith();

    await waitFor(() => expect(screen.getByText('Setup Assistant')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getAllByTitle('Settings')[0]);
    const dialog = screen.getByRole('dialog');

    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'prov-ollama');

    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'llama3.1:8b (8.0B)' })).toBeInTheDocument();
    });
  });
});
