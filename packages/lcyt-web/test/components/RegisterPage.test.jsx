import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterPage } from '../../src/components/RegisterPage.jsx';

// ---------------------------------------------------------------------------
// Mock useUserAuth
// ---------------------------------------------------------------------------

const mockRegister = vi.fn();

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({
    login: vi.fn(),
    register: mockRegister,
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

describe('RegisterPage', () => {
  it('renders create account heading and all form fields', () => {
    render(<RegisterPage />);
    expect(screen.getByText('Create account')).toBeInTheDocument();
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('reads backend URL from localStorage', () => {
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'https://saved.api' }));
    render(<RegisterPage />);
    expect(screen.getByLabelText(/server url/i)).toHaveValue('https://saved.api');
  });

  it('has a sign-in link', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/sign in/i).closest('a')).toHaveAttribute('href', expect.stringContaining('/login'));
  });

  it('shows error when passwords do not match', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'u@t.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows error when password is too short', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'u@t.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('calls register with correct args on valid submit', async () => {
    mockRegister.mockResolvedValue({});
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'user@test.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('https://api.test', 'user@test.com', 'password123', 'Test User');
    });
  });

  it('calls register with undefined name when name is empty', async () => {
    mockRegister.mockResolvedValue({});
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'u@t.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'abcdefgh' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'abcdefgh' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('https://api.test', 'u@t.com', 'abcdefgh', undefined);
    });
  });

  it('shows loading state during registration', async () => {
    let resolveReg;
    mockRegister.mockReturnValue(new Promise(r => { resolveReg = r; }));
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'u@t.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'abcdefgh' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'abcdefgh' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
    });

    resolveReg({});
  });

  it('shows server error message on registration failure', async () => {
    mockRegister.mockRejectedValue(new Error('Email already registered'));
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://api.test' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'u@t.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'abcdefgh' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'abcdefgh' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Email already registered')).toBeInTheDocument();
    });
  });

  it('does not submit when required fields are empty', () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
