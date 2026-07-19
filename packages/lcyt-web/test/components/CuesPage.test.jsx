import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { CuesPage } from '../../src/components/CuesPage.jsx';

function renderWith(session) {
  return render(
    <SessionContext.Provider value={{ getPersistedConfig: () => ({}), ...session }}>
      <CuesPage />
    </SessionContext.Provider>
  );
}

const baseSession = { connected: true, backendUrl: 'https://api.test', apiKey: 'key-1', getSessionToken: () => 'tok' };

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('CuesPage', () => {
  it('shows a connect prompt when not connected', () => {
    renderWith({ connected: false, backendUrl: '', apiKey: '', getSessionToken: () => null });
    expect(screen.getByText('Connect to a project to manage cue rules.')).toBeInTheDocument();
  });

  it('loads and lists existing cue rules', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        rules: [
          { id: 'r-1', name: 'Amen', match_type: 'phrase', pattern: 'amen', enabled: true, cooldown_ms: 0, action: {} },
          { id: 'r-2', name: 'Closing', match_type: 'fuzzy', pattern: 'let us close', enabled: false, fuzzy_threshold: 0.8, action: {} },
        ],
      }),
    });

    renderWith(baseSession);

    await waitFor(() => expect(screen.getByText('Amen')).toBeInTheDocument());
    expect(screen.getByText('Phrase · amen')).toBeInTheDocument();
    expect(screen.getByText('Closing')).toBeInTheDocument();
    expect(screen.getByText('Fuzzy · let us close')).toBeInTheDocument();
  });

  it('shows an empty state with no rules', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ rules: [] }) });
    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());
  });

  it('creates a new phrase rule via the dialog', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'new-id', ok: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add rule' }));
    await user.type(screen.getByPlaceholderText('e.g. Prayer response'), 'We beseech');
    await user.type(screen.getByPlaceholderText('we beseech thee'), 'we beseech thee');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
      expect(postCall).toBeTruthy();
      const [url, opts] = postCall;
      expect(url).toContain('/cues/rules');
      const body = JSON.parse(opts.body);
      expect(body).toMatchObject({ name: 'We beseech', match_type: 'phrase', pattern: 'we beseech thee', enabled: true });
    });
  });

  it('rejects an invalid regex before submitting', async () => {
    const user = userEvent.setup();
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ rules: [] }) });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add rule' }));
    await user.type(screen.getByPlaceholderText('e.g. Prayer response'), 'Bad regex');
    await user.selectOptions(screen.getByDisplayValue('Phrase'), 'regex');
    await user.type(screen.getByPlaceholderText('\\bamen\\b'), '(unclosed');

    const postCallsBefore = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'POST').length;
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Invalid regular expression.')).toBeInTheDocument();
    const postCallsAfter = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'POST').length;
    expect(postCallsAfter).toBe(postCallsBefore);
  });

  it('opens the edit dialog pre-filled and saves changes', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ rules: [{ id: 'r-1', name: 'Amen', match_type: 'phrase', pattern: 'amen', enabled: true, cooldown_ms: 0, action: {} }] }),
      });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Amen')).toBeInTheDocument());

    await user.click(screen.getByTitle('Settings'));
    expect(screen.getByDisplayValue('Amen')).toBeInTheDocument();
    expect(screen.getByDisplayValue('amen')).toBeInTheDocument();

    await user.clear(screen.getByDisplayValue('Amen'));
    await user.type(screen.getByPlaceholderText('e.g. Prayer response'), 'Amen renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
      expect(putCall).toBeTruthy();
      expect(putCall[0]).toContain('/cues/rules/r-1');
      const body = JSON.parse(putCall[1].body);
      expect(body.name).toBe('Amen renamed');
    });
  });

  it('deletes a rule after confirmation', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ rules: [{ id: 'r-1', name: 'Amen', match_type: 'phrase', pattern: 'amen', enabled: true, action: {} }] }),
      });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Amen')).toBeInTheDocument());

    await user.click(screen.getByTitle('Delete'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[0]).toContain('/cues/rules/r-1');
    });
  });

  it('toggles enabled state optimistically', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ rules: [{ id: 'r-1', name: 'Amen', match_type: 'phrase', pattern: 'amen', enabled: true, action: {} }] }),
      });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Amen')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Disable Amen'));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body).toEqual({ enabled: false });
    });
  });

  it('locks the match type for non-editable rule types', async () => {
    const user = userEvent.setup();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [{ id: 'r-1', name: 'Music start', match_type: 'music_start', pattern: null, enabled: true, action: {} }] }),
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Music start')).toBeInTheDocument());

    await user.click(screen.getByTitle('Settings'));
    expect(screen.getByText(/music_start.*rules aren't editable from this form yet/)).toBeInTheDocument();
  });

  it('lists a composite rule with a summarized condition tree', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/cues/defs')) return Promise.resolve({ ok: true, json: async () => ({ defs: [] }) });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          rules: [{
            id: 'r-1', name: 'Prayer response', match_type: 'composite', pattern: null, enabled: true, action: {},
            condition_tree: { op: 'or', children: [{ type: 'match', matchType: 'phrase', pattern: 'Amen' }, { type: 'match', matchType: 'semantic', pattern: 'end of the prayer' }] },
          }],
        }),
      });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('Prayer response')).toBeInTheDocument());
    expect(screen.getByText('Composite · Amen OR ~~end of the prayer')).toBeInTheDocument();
  });

  it('creates a composite rule by building a condition tree in the dialog', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/cues/rules')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'new-id', ok: true }) });
      }
      if (url.includes('/cues/defs')) return Promise.resolve({ ok: true, json: async () => ({ defs: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add rule' }));
    await user.type(screen.getByPlaceholderText('e.g. Prayer response'), 'Prayer response');
    await user.selectOptions(screen.getByDisplayValue('Phrase'), 'composite');
    await user.click(screen.getByRole('button', { name: '+ OR group' }));
    await user.click(screen.getByRole('button', { name: '+ Exact' }));
    await user.type(screen.getByPlaceholderText('phrase'), 'Amen');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(([url, opts]) => opts?.method === 'POST' && url.includes('/cues/rules'));
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall[1].body);
      expect(body.match_type).toBe('composite');
      expect(body.pattern).toBeUndefined();
      expect(body.condition_tree).toEqual({ op: 'or', children: [{ type: 'match', matchType: 'phrase', pattern: 'Amen' }] });
    });
  });

  it('bumps the cooldown suggestion to 1000ms when switching to the track match type', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url) => {
      if (url.includes('/cues/defs')) return Promise.resolve({ ok: true, json: async () => ({ defs: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add rule' }));
    await user.selectOptions(screen.getByDisplayValue('Phrase'), 'track');
    expect(screen.getByDisplayValue('1000')).toBeInTheDocument();
  });
});

describe('CuesManager — Named Conditions', () => {
  it('lists named conditions with a summarized tree and source badge', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/cues/defs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            defs: [{
              id: 'd-1', name: 'prayer-ending', source: 'api',
              condition_tree: { op: 'or', children: [{ type: 'match', matchType: 'phrase', pattern: 'amen' }, { type: 'ref', name: 'other' }] },
            }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('prayer-ending')).toBeInTheDocument());
    expect(screen.getByText('amen OR @other')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('shows an empty state with no named conditions', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/cues/defs')) return Promise.resolve({ ok: true, json: async () => ({ defs: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });
    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No named conditions yet — add one to reuse across rules.')).toBeInTheDocument());
  });

  it('creates a named condition via the dialog', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/cues/defs')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'd-new', ok: true }) });
      }
      if (url.includes('/cues/defs')) return Promise.resolve({ ok: true, json: async () => ({ defs: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No named conditions yet — add one to reuse across rules.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add condition' }));
    await user.type(screen.getByPlaceholderText('prayer-ending'), 'prayer-ending');
    await user.click(screen.getByRole('button', { name: '+ Exact' }));
    await user.type(screen.getByPlaceholderText('phrase'), 'amen');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(([url, opts]) => opts?.method === 'POST' && url.includes('/cues/defs'));
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall[1].body);
      expect(body.name).toBe('prayer-ending');
      expect(body.condition_tree).toEqual({ type: 'match', matchType: 'phrase', pattern: 'amen' });
    });
  });

  it('shows a 409 duplicate-name error from the backend', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/cues/defs')) {
        return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'A named condition "dup" already exists' }) });
      }
      if (url.includes('/cues/defs')) return Promise.resolve({ ok: true, json: async () => ({ defs: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No named conditions yet — add one to reuse across rules.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add condition' }));
    await user.type(screen.getByPlaceholderText('prayer-ending'), 'dup');
    await user.click(screen.getByRole('button', { name: '+ Exact' }));
    await user.type(screen.getByPlaceholderText('phrase'), 'amen');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByText('A named condition "dup" already exists')).toBeInTheDocument());
  });

  it('deletes a named condition after confirmation', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      if (url.includes('/cues/defs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ defs: [{ id: 'd-1', name: 'prayer-ending', source: 'api', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'amen' } }] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('prayer-ending')).toBeInTheDocument());

    await user.click(screen.getByTitle('Delete'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[0]).toContain('/cues/defs/d-1');
    });
  });

  it('shows a persistent notice and Detach action for inline-sourced conditions', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url, opts) => {
      if (opts?.method === 'PUT') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      if (url.includes('/cues/defs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ defs: [{ id: 'd-1', name: 'prayer-ending', source: 'inline', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'amen' } }] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('prayer-ending')).toBeInTheDocument());
    expect(screen.getByText('inline')).toBeInTheDocument();

    await user.click(screen.getByTitle('Settings'));
    expect(screen.getByText(/edits here will be overwritten next time that file syncs/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Detach' }));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([url, opts]) => opts?.method === 'PUT' && url.includes('/cues/defs/d-1'));
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body).toEqual({ source: 'api' });
    });
  });

  it('the name field is locked when editing an existing named condition', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url) => {
      if (url.includes('/cues/defs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ defs: [{ id: 'd-1', name: 'prayer-ending', source: 'api', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'amen' } }] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('prayer-ending')).toBeInTheDocument());
    await user.click(screen.getByTitle('Settings'));
    expect(screen.getByDisplayValue('prayer-ending')).toBeDisabled();
  });

  it('a composite rule ref leaf offers named conditions in its dropdown', async () => {
    const user = userEvent.setup();
    global.fetch.mockImplementation((url) => {
      if (url.includes('/cues/defs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ defs: [{ id: 'd-1', name: 'prayer-ending', source: 'api', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'amen' } }] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    });

    renderWith(baseSession);
    await waitFor(() => expect(screen.getByText('No cue rules yet — add one to get started.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Add rule' }));
    await user.selectOptions(screen.getByDisplayValue('Phrase'), 'composite');
    await user.click(screen.getByRole('button', { name: '+ Ref' }));

    const select = screen.getAllByRole('combobox').find(el => el.querySelector('option[value="prayer-ending"]'));
    expect(select).toBeTruthy();
  });
});
