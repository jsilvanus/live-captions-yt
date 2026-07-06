import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginPage } from '../../src/components/LoginPage.jsx';

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ login: vi.fn(), register: vi.fn(), logout: vi.fn(), user: null, token: null, backendUrl: null, loading: false }),
}));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('LoginPage (step-based redesign)', () => {
  it('renders step 1 with three backend cards', () => {
    render(<LoginPage />);
    expect(screen.getByText(/Choose your backend/i)).toBeInTheDocument();
    expect(screen.getByText(/LCYT Cloud/i)).toBeInTheDocument();
    expect(screen.getByText('Minimal')).toBeInTheDocument();
    expect(screen.getByText(/Self-hosted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('reveals URL input when custom/self-hosted is selected', () => {
    render(<LoginPage />);
    const selfHostedCard = screen.getByText(/Self-hosted/i).closest('.auth-card');
    fireEvent.click(selfHostedCard);
    expect(screen.getByPlaceholderText(/https:\/\/your-server.example.com/i)).toBeInTheDocument();
  });

  it('disables Continue button until URL is entered for self-hosted', () => {
    render(<LoginPage />);
    const selfHostedCard = screen.getByText(/Self-hosted/i).closest('.auth-card');
    fireEvent.click(selfHostedCard);
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();
    const urlInput = screen.getByPlaceholderText(/https:\/\/your-server.example.com/i);
    fireEvent.change(urlInput, { target: { value: 'https://example.com' } });
    expect(continueBtn).not.toBeDisabled();
  });
});
