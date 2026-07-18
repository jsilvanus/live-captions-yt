import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { NamedActionsManager } from '../../src/components/NamedActionsManager.jsx';

function renderWith(session) {
  return render(
    <SessionContext.Provider value={{ getPersistedConfig: () => ({}), ...session }}>
      <NamedActionsManager />
    </SessionContext.Provider>
  );
}

const baseSession = { connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' };

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('NamedActionsManager', () => {
  it('shows a connect prompt when not connected', () => {
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });
    expect(screen.getByText('Connect to a project to manage named actions.')).toBeInTheDocument();
  });

  it('loads and lists existing named actions', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        actions: [{ slug: 'lower-thirds', name: 'Lower thirds on', definition: 'audio:start | graphics:+banner' }],
      }),
    });

    renderWith(baseSession);

    await waitFor(() => expect(screen.getByText('Lower thirds on')).toBeInTheDocument());
    expect(screen.getByText('@lower-thirds')).toBeInTheDocument();
    expect(screen.getByText('audio:start | graphics:+banner')).toBeInTheDocument();
  });

  it('shows an empty state with no actions', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ actions: [] }) });
    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No named actions yet — add one to get started.')).toBeInTheDocument());
  });

  it('creates a new named action via the dialog, auto-slugging the name', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ action: { slug: 'lower-thirds-on' } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ actions: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No named actions yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add action' }));
    await user.type(screen.getByPlaceholderText('Lower thirds on'), 'Lower thirds on');
    await user.type(screen.getByPlaceholderText('audio:start | graphics:+banner | section:Intro | @other'), 'audio:start | graphics:+banner');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
      expect(postCall).toBeTruthy();
      const [url, opts] = postCall;
      expect(url).toContain('/actions');
      const body = JSON.parse(opts.body);
      expect(body).toMatchObject({ name: 'Lower thirds on', slug: 'lower-thirds-on', definition: 'audio:start | graphics:+banner' });
    });
  });

  it('opens the edit dialog pre-filled with a locked slug and saves changes', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ actions: [{ slug: 'lower-thirds', name: 'Lower thirds', definition: 'audio:start' }] }),
      });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Lower thirds')).toBeInTheDocument());

    await user.click(screen.getByTitle('Settings'));
    expect(screen.getByDisplayValue('Lower thirds')).toBeInTheDocument();
    const slugInput = screen.getByDisplayValue('lower-thirds');
    expect(slugInput).toBeDisabled();

    await user.clear(screen.getByDisplayValue('Lower thirds'));
    await user.type(screen.getByPlaceholderText('Lower thirds on'), 'Lower thirds renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
      expect(putCall).toBeTruthy();
      expect(putCall[0]).toContain('/actions/lower-thirds');
      const body = JSON.parse(putCall[1].body);
      expect(body.name).toBe('Lower thirds renamed');
    });
  });

  it('deletes an action after confirmation', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ actions: [{ slug: 'lower-thirds', name: 'Lower thirds', definition: 'audio:start' }] }),
      });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Lower thirds')).toBeInTheDocument());

    await user.click(screen.getByTitle('Delete'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[0]).toContain('/actions/lower-thirds');
    });
  });

  it('renders compact chrome in embedded mode (no page title)', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ actions: [] }) });
    render(
      <SessionContext.Provider value={{ getPersistedConfig: () => ({}), ...baseSession }}>
        <NamedActionsManager embedded />
      </SessionContext.Provider>
    );
    await waitFor(() => expect(screen.getByText('No named actions yet — add one to get started.')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Named Actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add action' })).toBeInTheDocument();
  });
});
