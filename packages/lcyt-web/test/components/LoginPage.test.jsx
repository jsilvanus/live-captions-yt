import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../../src/components/LoginPage.jsx';

// ---------------------------------------------------------------------------
// Mock useUserAuth
// ---------------------------------------------------------------------------

const mockLogin = vi.fn();

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({
    login: mockLogin,
    register: vi.fn(),
    logout: vi.fn(),
    user: null,
    token: null,
    backendUrl: null,
    loading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage', () => {
  it('renders sign-in heading and form fields', () => {
    render(<LoginPage />);
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('reads backend URL from localStorage', () => {
    localStorage.setItem('lcyt-config', JSON.stringify({ backendUrl: 'https://test.api' }));
    render(<LoginPage />);
    expect(screen.getByLabelText(/server url/i)).toHaveValue('https://test.api');
  });

  it('has a register link', () => {
    render(<LoginPage />);
    const link = screen.getByText(/register/i);
    expect(link.closest('a')).toHaveAttribute('href', expect.stringContaining('/register'));
  });

  it('has a back to app link', () => {
    render(<LoginPage />);
    expect(screen.getByText(/back to app/i).closest('a')).toHaveAttribute('href', '/');
  });

  it('calls login on form submit', async () => {
    mockLogin.mockResolvedValue({});
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('https://api.test', 'user@test.com', 'password123');
    });
  });

  it('shows loading state while submitting', async () => {
    let resolveLogin;
    mockLogin.mockReturnValue(new Promise(r => { resolveLogin = r; }));
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass1234' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    });

    resolveLogin({});
  });

  it('displays error on login failure', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('does not submit when fields are empty', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('passes backendUrl to register link', () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://my.server' } });
    const link = screen.getByText(/register/i).closest('a');
    expect(link.getAttribute('href')).toContain(encodeURIComponent('https://my.server'));
  });
});
