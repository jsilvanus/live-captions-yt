import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginPage } from '../../src/components/LoginPage.jsx';

vi.mock('../../src/hooks/useUserAuth', () => ({
  useUserAuth: () => ({ login: vi.fn(), register: vi.fn(), logout: vi.fn(), user: null, token: null, backendUrl: null, loading: false }),
}));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('LoginPage (adapted)', () => {
  it('renders backend preset selector with Connect button', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/backend/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('allows selecting custom backend and entering url', () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/backend/i), { target: { value: 'custom' } });
    expect(screen.getByPlaceholderText(/https:\/\/your-server.example.com/i)).toBeInTheDocument();
  });
});
