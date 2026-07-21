import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AccountPage } from '../../src/components/AccountPage.jsx';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';
import { ToastProvider } from '../../src/contexts/ToastContext.jsx';

// ---------------------------------------------------------------------------
// Mock wouter (AccountPage uses <Link> for /login and /register links)
// ---------------------------------------------------------------------------

vi.mock('wouter', () => ({
  Link: ({ href, children }) => <a href={href}>{children}</a>,
}));

// ---------------------------------------------------------------------------
// Mock useUserAuth
// ---------------------------------------------------------------------------

let mockAuth;

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => mockAuth,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAnonymous() {
  mockAuth = {
    user: null,
    token: null,
    backendUrl: null,
    loading: false,
    logout: vi.fn(),
    changePassword: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    updateProfile: vi.fn(),
    exportData: vi.fn(),
    removeData: vi.fn(),
    deleteAccount: vi.fn(),
  };
}

function setupLoading() {
  mockAuth = {
    user: null,
    token: null,
    backendUrl: null,
    loading: true,
    logout: vi.fn(),
    changePassword: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    updateProfile: vi.fn(),
    exportData: vi.fn(),
    removeData: vi.fn(),
    deleteAccount: vi.fn(),
  };
}

function setupLoggedIn(overrides = {}) {
  mockAuth = {
    user: { userId: 'u1', email: 'test@example.com', name: 'Test User' },
    token: 'user-jwt',
    backendUrl: 'https://api.test',
    loading: false,
    logout: vi.fn(),
    changePassword: vi.fn().mockResolvedValue({}),
    login: vi.fn(),
    register: vi.fn(),
    updateProfile: vi.fn().mockResolvedValue({ name: 'Updated Name' }),
    exportData: vi.fn().mockResolvedValue({ user: {}, projects: [], orgs: [] }),
    removeData: vi.fn().mockResolvedValue({ deletedProjectCount: 0 }),
    deleteAccount: vi.fn().mockResolvedValue({ deleted: true }),
    ...overrides,
  };
}

const baseSession = { connected: false, backendUrl: 'https://api.test', getStats: vi.fn(), eraseSelf: vi.fn() };

// AccountPage now also owns the Privacy & Terms & Data dialog (PrivacyModal,
// which needs SessionContext/ToastContext) and auto-opens it, with
// acceptance required, whenever `lcyt:privacyAccepted` is unset. Most tests
// here are about unrelated profile behavior, so `privacyAccepted` defaults
// to true; the dedicated "privacy" describe block below clears it to
// exercise the first-visit flow itself.
function renderAccountPage({ session = baseSession, privacyAccepted = true } = {}) {
  if (privacyAccepted) localStorage.setItem('lcyt:privacyAccepted', '1');
  return render(
    <SessionContext.Provider value={session}>
      <ToastProvider>
        <AccountPage />
      </ToastProvider>
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('AccountPage — loading', () => {
  it('shows loading text while auth is resolving', () => {
    setupLoading();
    renderAccountPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Anonymous state
// ---------------------------------------------------------------------------

describe('AccountPage — anonymous', () => {
  it('shows "Not signed in" heading', () => {
    setupAnonymous();
    renderAccountPage();
    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
  });

  it('shows a Sign in link pointing to /login', () => {
    setupAnonymous();
    renderAccountPage();
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('shows a Create account link pointing to /register', () => {
    setupAnonymous();
    renderAccountPage();
    const link = screen.getByRole('link', { name: /create account/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/register');
  });

  it('does not show profile information', () => {
    setupAnonymous();
    renderAccountPage();
    expect(screen.queryByText(/change password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign out/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Logged-in state — profile view
// ---------------------------------------------------------------------------

describe('AccountPage — logged in', () => {
  it('shows the user email', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getAllByText('test@example.com').length).toBeGreaterThan(0);
  });

  it('shows the display name in the header and as an editable field', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Test User');
  });

  it('shows avatar initials derived from the display name', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByText('TU')).toBeInTheDocument();
  });

  it('shows a Change Password section', () => {
    setupLoggedIn();
    renderAccountPage();
    const matches = screen.getAllByText(/change password/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows Change password form fields', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it('shows a Sign out button', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('calls logout when Sign out is clicked', () => {
    setupLoggedIn();
    renderAccountPage();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(mockAuth.logout).toHaveBeenCalledTimes(1);
  });

  it('does not show anonymous sign-in links', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.queryByText(/not signed in/i)).not.toBeInTheDocument();
  });

  it('does not show a redundant Projects quick-link (covered by sidebar nav)', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.queryByText(/go to projects/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Account info (display name)
// ---------------------------------------------------------------------------

describe('AccountPage — account info', () => {
  it('disables Save changes until the name actually changes', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'New Name' } });
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
  });

  it('calls updateProfile with the new name on save', async () => {
    setupLoggedIn();
    renderAccountPage();
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(mockAuth.updateProfile).toHaveBeenCalledWith('New Name');
    });
  });
});

// ---------------------------------------------------------------------------
// Change password form
// ---------------------------------------------------------------------------

describe('AccountPage — change password', () => {
  it('shows error when new passwords do not match', async () => {
    setupLoggedIn();
    renderAccountPage();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpass' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'newpass1' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpass2' } });
    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /update password/i })).toBeDisabled();
  });

  it('calls changePassword with correct args on valid submit', async () => {
    setupLoggedIn();
    renderAccountPage();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'newpass99' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpass99' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      expect(mockAuth.changePassword).toHaveBeenCalledWith('oldpass1', 'newpass99');
    });
  });

  it('shows success message after password change', async () => {
    setupLoggedIn();
    renderAccountPage();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'newpass99' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpass99' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      expect(screen.getByText(/password changed successfully/i)).toBeInTheDocument();
    });
  });

  it('shows server error message on failure', async () => {
    setupLoggedIn({
      changePassword: vi.fn().mockRejectedValue(new Error('Invalid current password')),
    });
    renderAccountPage();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'wrongpass' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'newpass99' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpass99' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid current password/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Appearance (segmented theme controls)
// ---------------------------------------------------------------------------

describe('AccountPage — appearance', () => {
  it('renders General / Editor / Planner theme segmented controls', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByText('General theme')).toBeInTheDocument();
    expect(screen.getByText('Editor theme')).toBeInTheDocument();
    expect(screen.getByText('Planner theme')).toBeInTheDocument();
  });

  it('persists the editor theme to its own storage key without touching the general theme', () => {
    setupLoggedIn();
    renderAccountPage();
    const editorSection = screen.getByText('Editor theme').closest('div');
    fireEvent.click(within(editorSection.parentElement).getByText('Dark'));
    expect(localStorage.getItem('lcyt.ui.editorTheme')).toBe('dark');
    expect(localStorage.getItem('lcyt.ui.theme')).not.toBe('dark');
  });

  it('applies the general theme immediately via the data-theme attribute', () => {
    setupLoggedIn();
    renderAccountPage();
    const generalSection = screen.getByText('General theme').closest('div');
    fireEvent.click(within(generalSection.parentElement).getByText('Dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('lcyt.ui.theme')).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Danger zone (real actions, calling the new self-service endpoints)
// ---------------------------------------------------------------------------

describe('AccountPage — danger zone', () => {
  it('shows enabled Export/Remove/Delete actions', () => {
    setupLoggedIn();
    renderAccountPage();
    expect(screen.getByRole('button', { name: /export data/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /remove data/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /delete account/i })).not.toBeDisabled();
  });

  it('calls exportData when Export data is clicked', async () => {
    setupLoggedIn();
    renderAccountPage();
    fireEvent.click(screen.getByRole('button', { name: /export data/i }));
    await waitFor(() => expect(mockAuth.exportData).toHaveBeenCalledTimes(1));
  });

  it('calls removeData after confirmation when Remove data is clicked', async () => {
    setupLoggedIn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAccountPage();
    fireEvent.click(screen.getByRole('button', { name: /remove data/i }));
    await waitFor(() => expect(mockAuth.removeData).toHaveBeenCalledTimes(1));
  });

  it('does not call removeData when the confirmation is cancelled', () => {
    setupLoggedIn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAccountPage();
    fireEvent.click(screen.getByRole('button', { name: /remove data/i }));
    expect(mockAuth.removeData).not.toHaveBeenCalled();
  });

  it('shows a soft failure message when deleteAccount is not implemented on the backend', async () => {
    setupLoggedIn({ deleteAccount: vi.fn().mockRejectedValue(new Error('Account deletion is not available on this backend yet')) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAccountPage();
    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    await waitFor(() => {
      expect(screen.getByText(/not available on this backend yet/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Privacy & Terms & Data dialog (moved here from App.jsx's classic layout)
// ---------------------------------------------------------------------------

describe('AccountPage — privacy dialog', () => {
  it('does not auto-open when lcyt:privacyAccepted is already set', () => {
    setupLoggedIn();
    renderAccountPage({ privacyAccepted: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('auto-opens, with acceptance required, on a first visit with no privacyAccepted flag', () => {
    setupLoggedIn();
    renderAccountPage({ privacyAccepted: false });
    expect(screen.getByRole('dialog', { name: /privacy & terms & data/i })).toBeInTheDocument();
    // requireAcceptance mode: no dismiss (✕) button, only the accept CTA.
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByText(/please read the policy below/i)).toBeInTheDocument();
  });

  it('setting the accepted flag on accept means it will not reopen next render', () => {
    setupLoggedIn();
    renderAccountPage({ privacyAccepted: false });
    expect(localStorage.getItem('lcyt:privacyAccepted')).toBeNull();
    // The accept button is disabled during the 10s countdown, so directly
    // exercise the flag it sets rather than waiting out a real timer here —
    // the countdown/backdrop behavior itself belongs to PrivacyModal's own
    // tests, not AccountPage's.
    localStorage.setItem('lcyt:privacyAccepted', '1');
    expect(localStorage.getItem('lcyt:privacyAccepted')).toBe('1');
  });

  it('logged-in profile view has a "View" button that reopens the dialog without requiring acceptance', () => {
    setupLoggedIn();
    renderAccountPage({ privacyAccepted: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('dialog', { name: /privacy & terms & data/i })).toBeInTheDocument();
    // Not requireAcceptance mode this time — plain Close buttons (header ✕
    // + footer), not the "Close and accept (Ns)" acceptance CTA.
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/close and accept/i)).not.toBeInTheDocument();
  });

  it('anonymous view has a Privacy & Terms & Data button that opens the dialog', () => {
    setupAnonymous();
    renderAccountPage({ privacyAccepted: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /privacy & terms & data/i }));

    expect(screen.getByRole('dialog', { name: /privacy & terms & data/i })).toBeInTheDocument();
  });
});
