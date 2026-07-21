import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { OnboardingBanner } from '../../src/components/OnboardingBanner.jsx';
import { isOnboarded } from '../../src/lib/onboarding.js';

const baseSession = { apiKey: 'proj-1', backendUrl: 'https://api.test', getSessionToken: () => 'tok' };

function renderWith(session = baseSession) {
  return render(
    <SessionContext.Provider value={session}>
      <OnboardingBanner />
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('OnboardingBanner', () => {
  it('renders nothing while no apiKey is present', () => {
    renderWith({ apiKey: '', backendUrl: '', getSessionToken: () => '' });
    expect(screen.queryByText(/isn't configured yet/)).not.toBeInTheDocument();
  });

  it('renders nothing once the project is already marked onboarded', () => {
    localStorage.setItem('lcyt.onboarded.proj-1', '1');
    renderWith();
    expect(screen.queryByText(/isn't configured yet/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows the nudge when the project has zero caption targets', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ targets: [] }) });
    renderWith();
    await waitFor(() => expect(screen.getByText(/isn't configured yet/)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/targets', { headers: { Authorization: 'Bearer tok' } });
  });

  it('stays hidden when the project already has a caption target', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ targets: [{ id: 1 }] }) });
    renderWith();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/isn't configured yet/)).not.toBeInTheDocument();
  });

  it('dismissing marks the project onboarded and hides the banner', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ targets: [] }) });
    const user = userEvent.setup();
    renderWith();
    await waitFor(() => expect(screen.getByText(/isn't configured yet/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/isn't configured yet/)).not.toBeInTheDocument();
    expect(isOnboarded('proj-1')).toBe(true);
  });
});
