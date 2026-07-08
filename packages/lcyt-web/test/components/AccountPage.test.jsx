import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AccountPage } from '../../src/components/AccountPage.jsx';

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
    render(<AccountPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Anonymous state
// ---------------------------------------------------------------------------

describe('AccountPage — anonymous', () => {
  it('shows "Not signed in" heading', () => {
    setupAnonymous();
    render(<AccountPage />);
    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
  });

  it('shows a Sign in link pointing to /login', () => {
    setupAnonymous();
    render(<AccountPage />);
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('shows a Create account link pointing to /register', () => {
    setupAnonymous();
    render(<AccountPage />);
    const link = screen.getByRole('link', { name: /create account/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/register');
  });

  it('does not show profile information', () => {
    setupAnonymous();
    render(<AccountPage />);
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
    render(<AccountPage />);
    expect(screen.getAllByText('test@example.com').length).toBeGreaterThan(0);
  });

  it('shows the display name in the header and as an editable field', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Test User');
  });

  it('shows avatar initials derived from the display name', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByText('TU')).toBeInTheDocument();
  });

  it('shows a Change Password section', () => {
    setupLoggedIn();
    render(<AccountPage />);
    const matches = screen.getAllByText(/change password/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows Change password form fields', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it('shows a Sign out button', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('calls logout when Sign out is clicked', () => {
    setupLoggedIn();
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(mockAuth.logout).toHaveBeenCalledTimes(1);
  });

  it('does not show anonymous sign-in links', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.queryByText(/not signed in/i)).not.toBeInTheDocument();
  });

  it('does not show a redundant Projects quick-link (covered by sidebar nav)', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.queryByText(/go to projects/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Account info (display name)
// ---------------------------------------------------------------------------

describe('AccountPage — account info', () => {
  it('disables Save changes until the name actually changes', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'New Name' } });
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
  });

  it('calls updateProfile with the new name on save', async () => {
    setupLoggedIn();
    render(<AccountPage />);
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
    render(<AccountPage />);
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
    render(<AccountPage />);
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
    render(<AccountPage />);
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
    render(<AccountPage />);
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
    render(<AccountPage />);
    expect(screen.getByText('General theme')).toBeInTheDocument();
    expect(screen.getByText('Editor theme')).toBeInTheDocument();
    expect(screen.getByText('Planner theme')).toBeInTheDocument();
  });

  it('persists the editor theme to its own storage key without touching the general theme', () => {
    setupLoggedIn();
    render(<AccountPage />);
    const editorSection = screen.getByText('Editor theme').closest('div');
    fireEvent.click(within(editorSection.parentElement).getByText('Dark'));
    expect(localStorage.getItem('lcyt.ui.editorTheme')).toBe('dark');
    expect(localStorage.getItem('lcyt.ui.theme')).not.toBe('dark');
  });

  it('applies the general theme immediately via the data-theme attribute', () => {
    setupLoggedIn();
    render(<AccountPage />);
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
    render(<AccountPage />);
    expect(screen.getByRole('button', { name: /export data/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /remove data/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /delete account/i })).not.toBeDisabled();
  });

  it('calls exportData when Export data is clicked', async () => {
    setupLoggedIn();
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /export data/i }));
    await waitFor(() => expect(mockAuth.exportData).toHaveBeenCalledTimes(1));
  });

  it('calls removeData after confirmation when Remove data is clicked', async () => {
    setupLoggedIn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /remove data/i }));
    await waitFor(() => expect(mockAuth.removeData).toHaveBeenCalledTimes(1));
  });

  it('does not call removeData when the confirmation is cancelled', () => {
    setupLoggedIn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /remove data/i }));
    expect(mockAuth.removeData).not.toHaveBeenCalled();
  });

  it('shows a soft failure message when deleteAccount is not implemented on the backend', async () => {
    setupLoggedIn({ deleteAccount: vi.fn().mockRejectedValue(new Error('Account deletion is not available on this backend yet')) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    await waitFor(() => {
      expect(screen.getByText(/not available on this backend yet/i)).toBeInTheDocument();
    });
  });
});
