import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('shows the user name when provided', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('shows the backend URL', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByText('https://api.test')).toBeInTheDocument();
  });

  it('does not show name when user has no name', () => {
    setupLoggedIn({ user: { userId: 'u1', email: 'test@example.com', name: undefined } });
    render(<AccountPage />);
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('shows a Projects link pointing to /projects', () => {
    setupLoggedIn();
    render(<AccountPage />);
    const link = screen.getByRole('link', { name: /go to projects/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/projects');
  });

  it('shows a Change Password section', () => {
    setupLoggedIn();
    render(<AccountPage />);
    // Section heading is an h3; there may also be a "Change password" submit button
    const matches = screen.getAllByText(/change password/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows Change password form fields', () => {
    setupLoggedIn();
    render(<AccountPage />);
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    // Use exact label text to avoid matching "Confirm new password"
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
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    });
    expect(mockAuth.changePassword).not.toHaveBeenCalled();
  });

  it('shows error when new password is too short', async () => {
    setupLoggedIn();
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpass' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockAuth.changePassword).not.toHaveBeenCalled();
  });

  it('calls changePassword with correct args on valid submit', async () => {
    setupLoggedIn();
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'newpass99' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpass99' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid current password/i)).toBeInTheDocument();
    });
  });

  it('clears fields after successful password change', async () => {
    setupLoggedIn();
    render(<AccountPage />);
    const currentInput = screen.getByLabelText(/current password/i);
    fireEvent.change(currentInput, { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'newpass99' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpass99' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(() => {
      expect(currentInput.value).toBe('');
    });
  });
});
