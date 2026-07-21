import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../src/contexts/ToastContext.jsx';
import { ToastContainer } from '../../src/components/ToastContainer.jsx';
import { StorageQuotaMonitor } from '../../src/components/StorageQuotaMonitor.jsx';

function renderMonitor() {
  return render(
    <ToastProvider>
      <StorageQuotaMonitor />
      <ToastContainer />
    </ToastProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('navigator', { storage: { estimate: vi.fn() } });
});

describe('StorageQuotaMonitor', () => {
  it('renders nothing itself', () => {
    navigator.storage.estimate.mockResolvedValue({ usage: 10, quota: 100 });
    const { container } = renderMonitor();
    // Only the (empty) toast container should be present besides null output.
    expect(container.querySelector('#toast-container')?.children.length ?? 0).toBe(0);
  });

  it('warns once usage crosses the threshold', async () => {
    navigator.storage.estimate.mockResolvedValue({ usage: 85, quota: 100 });
    renderMonitor();
    await waitFor(() => expect(screen.getByText(/85% full/)).toBeInTheDocument());
  });

  it('stays quiet when usage is below the threshold', async () => {
    navigator.storage.estimate.mockResolvedValue({ usage: 20, quota: 100 });
    renderMonitor();
    await waitFor(() => expect(navigator.storage.estimate).toHaveBeenCalled());
    expect(screen.queryByText(/% full/)).not.toBeInTheDocument();
  });

  it('does not warn again within the same session once already warned', async () => {
    sessionStorage.setItem('lcyt.storageQuotaWarned', '1');
    navigator.storage.estimate.mockResolvedValue({ usage: 95, quota: 100 });
    renderMonitor();
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByText(/% full/)).not.toBeInTheDocument();
  });
});
