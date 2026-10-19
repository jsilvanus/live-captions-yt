import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BroadcastPane } from '../../src/components/production/workspace/panes/BroadcastPane.jsx';

function makeD(routes) {
  const calls = [];
  const jfetch = vi.fn(async (path, opts = {}) => {
    calls.push([path, opts.method || 'GET', opts.body]);
    const h = routes[`${opts.method || 'GET'} ${path}`];
    const { status = 200, body = {} } = typeof h === 'function' ? h() : (h || {});
    return { ok: status < 400, status, json: async () => body };
  });
  return { D: { jfetch, connected: true }, calls };
}

describe('BroadcastPane', () => {
  it('shows the running broadcast with its next-step buttons and posts the action', async () => {
    const { D, calls } = makeD({
      'GET /broadcasts/current': { body: { broadcast: { id: 'b1', title: 'Mass', status: 'staging', captionSequence: 0 } } },
      'POST /broadcasts/b1/go-live': { body: { broadcast: { id: 'b1', status: 'live' } } },
    });
    render(<BroadcastPane D={D} />);
    await screen.findByText('Mass');
    fireEvent.click(screen.getByText('Go live'));
    await waitFor(() => expect(calls.some(c => c[0] === '/broadcasts/b1/go-live' && c[1] === 'POST')).toBe(true));
  });

  it('offers "Go anyway" when the pre-flight only warns', async () => {
    const { D, calls } = makeD({
      'GET /broadcasts/current': { body: { broadcast: null } },
      'GET /broadcasts': { body: { broadcasts: [{ id: 'b2', title: 'Vespers', status: 'draft' }] } },
      'POST /broadcasts/b2/stage': { status: 409, body: { error: 'Pre-flight failed', findings: [{ severity: 'warn', message: 'No YouTube link' }] } },
    });
    render(<BroadcastPane D={D} />);
    await screen.findByText('Vespers');
    fireEvent.click(screen.getByText('Stage'));
    await screen.findByText('No YouTube link', { exact: false });
    fireEvent.click(screen.getByText('Go anyway'));
    await waitFor(() => expect(calls.some(c => c[0] === '/broadcasts/b2/stage' && JSON.parse(c[2]).force === true)).toBe(true));
  });

  it('offers a title field when nothing is running or scheduled', async () => {
    const { D } = makeD({ 'GET /broadcasts/current': { body: { broadcast: null } }, 'GET /broadcasts': { body: { broadcasts: [] } } });
    render(<BroadcastPane D={D} />);
    expect(await screen.findByPlaceholderText('Broadcast title')).toBeTruthy();
  });
});
