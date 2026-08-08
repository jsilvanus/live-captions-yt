/**
 * Tests for InviteMemberForm — the 5-role invite vocabulary
 * (plan_project_roles.md Phase 3): default accessLevel and option list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteMemberForm } from '../../src/components/InviteMemberForm.jsx';

beforeEach(() => {
  global.fetch = vi.fn();
});

function renderForm(onInvited = vi.fn()) {
  return render(
    <InviteMemberForm backendUrl="https://api.test" token="tok" apiKey="key-abc" onInvited={onInvited} />
  );
}

describe('InviteMemberForm', () => {
  it('defaults accessLevel to editor and offers the 5-role vocabulary (no owner)', () => {
    renderForm();
    const select = screen.getByRole('combobox');
    expect(select.value).toBe('editor');
    expect([...select.options].map(o => o.value).sort()).toEqual(['admin', 'editor', 'operator', 'viewer']);
  });

  it('submits the selected accessLevel in the POST body', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ userId: 'u9', accessLevel: 'operator' }) });
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'operator' } });
    fireEvent.click(screen.getByRole('button', { name: /invite/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.test/keys/key-abc/members');
    expect(JSON.parse(opts.body)).toEqual({ email: 'new@example.com', accessLevel: 'operator' });
  });

  it('resets accessLevel back to editor after a successful invite', async () => {
    const onInvited = vi.fn();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ userId: 'u9', accessLevel: 'viewer' }) });
    renderForm(onInvited);

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: /invite/i }));

    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(screen.getByRole('combobox').value).toBe('editor');
  });
});
