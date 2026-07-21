import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileAudioBar } from '../../src/components/MobileAudioBar.jsx';

function baseProps(overrides = {}) {
  return {
    fileStore: { activeFile: null, setPointer: vi.fn(), advancePointer: vi.fn() },
    session: { micHolder: null, clientId: 'me' },
    micListening: false,
    micHolding: false,
    micHoldToSpeak: false,
    mobileInterimText: '',
    mobileUtteranceEndEnabled: false,
    utteranceActive: false,
    utteranceTimerRunning: false,
    utteranceTimerSec: 0,
    mobileBarMeterRef: { current: null },
    audioPanelRef: { current: null },
    inputBarRef: { current: null },
    textInputOpen: false,
    onToggleTextInput: vi.fn(),
    ...overrides,
  };
}

describe('MobileAudioBar — keyboard toggle (plan_ui.md v2 §4c)', () => {
  it('renders a ⌨ toggle button, inactive by default', () => {
    render(<MobileAudioBar {...baseProps()} />);
    const btn = screen.getByRole('button', { name: 'Type a caption' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).not.toHaveClass('mobile-bar__kbd-btn--active');
  });

  it('calls onToggleTextInput when clicked', async () => {
    const onToggleTextInput = vi.fn();
    const user = userEvent.setup();
    render(<MobileAudioBar {...baseProps({ onToggleTextInput })} />);

    await user.click(screen.getByRole('button', { name: 'Type a caption' }));

    expect(onToggleTextInput).toHaveBeenCalledTimes(1);
  });

  it('reflects the open state: active class, pressed state, and different title', () => {
    render(<MobileAudioBar {...baseProps({ textInputOpen: true })} />);
    const btn = screen.getByRole('button', { name: 'Hide text input' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveClass('mobile-bar__kbd-btn--active');
  });
});
