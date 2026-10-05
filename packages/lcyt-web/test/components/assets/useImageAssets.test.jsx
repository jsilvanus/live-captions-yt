import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuidedActionProvider, useGuidedActionDispatcher } from '../../../src/hooks/useGuidedAction.jsx';
import { useImageAssets } from '../../../src/components/assets/useImageAssets.jsx';

let dispatchRef;
function Harness() {
  const { images, dialogs } = useImageAssets({ backendUrl: 'https://api.test', headers: { 'X-API-Key': 'k' }, connected: true });
  dispatchRef = useGuidedActionDispatcher();
  return (
    <div>
      {images.map(i => <span key={i.id}>{i.shorthand}</span>)}
      {dialogs}
    </div>
  );
}

const IMAGES = [{ id: 7, shorthand: 'logo', filename: 'logo.png', mimeType: 'image/png', sizeBytes: 10, settingsJson: { opacity: 1 } }];

beforeEach(() => {
  global.fetch = vi.fn((url, init = {}) => {
    if (url.endsWith('/images') && !init.method) return Promise.resolve({ ok: true, json: async () => ({ images: IMAGES }) });
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
});

function renderHarness() {
  return render(<GuidedActionProvider><Harness /></GuidedActionProvider>);
}

describe('useImageAssets guided actions', () => {
  it('asset.update opens a prefilled dialog and PUTs the edited settings', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('logo');
    act(() => { dispatchRef('asset.update', { id: 7, settings: { opacity: 0.5 } }); });
    const box = await screen.findByLabelText('Image settings JSON');
    expect(JSON.parse(box.value)).toEqual({ opacity: 0.5 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = global.fetch.mock.calls.find(([, i]) => i?.method === 'PUT');
      expect(put[0]).toBe('https://api.test/images/7');
      expect(JSON.parse(put[1].body)).toEqual({ settingsJson: { opacity: 0.5 } });
    });
  });

  it('rejects invalid JSON without calling the API', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('logo');
    act(() => { dispatchRef('asset.update', { id: 7 }); });
    const box = await screen.findByLabelText('Image settings JSON');
    await user.clear(box);
    await user.type(box, 'nope');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid JSON');
    expect(global.fetch.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
  });

  it('asset.delete asks for confirmation and then DELETEs', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('logo');
    act(() => { dispatchRef('asset.delete', { id: 7 }); });
    expect(global.fetch.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(global.fetch.mock.calls.some(([u, i]) => i?.method === 'DELETE' && u === 'https://api.test/images/7')).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText('logo')).toBeNull());
  });
});
