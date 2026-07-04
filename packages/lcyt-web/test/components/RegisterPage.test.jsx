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
// Helpers
// ---------------------------------------------------------------------------

function fillRequiredFields({
  backendUrl = 'https://api.test',
  firstName = 'Ada',
  lastName = 'Lovelace',
  email = 'ada@test.com',
  password = 'password123',
  agree = true,
} = {}) {
  fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: backendUrl } });
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: firstName } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: lastName } });
  fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: password } });
  if (agree) {
    fireEvent.click(screen.getByRole('checkbox'));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegisterPage (two-step redesign)', () => {
  it('renders the sign-up form with all expected fields', () => {
    render(<RegisterPage />);
    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(screen.getByText(/free to start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/organization/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeDisabled();
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

  it('toggles password visibility', () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('disables submit until all required fields are filled and terms are agreed', () => {
    render(<RegisterPage />);
    const submit = screen.getByRole('button', { name: /create account/i });
    expect(submit).toBeDisabled();

    fillRequiredFields({ agree: false });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).not.toBeDisabled();
  });

  it('shows error when password is too short', async () => {
    render(<RegisterPage />);
    fillRequiredFields({ password: 'short12' });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('combines first and last name and calls register (without organization)', async () => {
    mockRegister.mockResolvedValue({});
    render(<RegisterPage />);
    fillRequiredFields({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@test.com', password: 'password123' });
    fireEvent.change(screen.getByLabelText(/organization/i), { target: { value: 'Acme Broadcasting' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('https://api.test', 'ada@test.com', 'password123', 'Ada Lovelace');
    });
    // Organization must never be sent — there is no server-side column for it.
    expect(mockRegister.mock.calls[0]).toHaveLength(4);
  });

  it('shows loading state during registration', async () => {
    let resolveReg;
    mockRegister.mockReturnValue(new Promise(r => { resolveReg = r; }));
    render(<RegisterPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
    });

    resolveReg({});
  });

  it('shows server error message on registration failure', async () => {
    mockRegister.mockRejectedValue(new Error('Email already registered'));
    render(<RegisterPage />);
    fillRequiredFields();
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

  it('shows the success step with workspace copy when organization is provided', async () => {
    mockRegister.mockResolvedValue({});
    render(<RegisterPage />);
    fillRequiredFields({ firstName: 'Ada' });
    fireEvent.change(screen.getByLabelText(/organization/i), { target: { value: 'Acme Broadcasting' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Account created.')).toBeInTheDocument();
    });
    expect(screen.getByText('Ada', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Acme Broadcasting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open the app/i })).toBeInTheDocument();
  });

  it('shows generic workspace copy when no organization was entered', async () => {
    mockRegister.mockResolvedValue({});
    render(<RegisterPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Your workspace is ready.')).toBeInTheDocument();
    });
  });
});
