import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ProductionHeader } from '../../src/components/production/workspace/Chrome.jsx';

function header(arming, setArmed = vi.fn()) {
  const D = {
    creds: { apiKey: 'abcdef123456789' }, broadcast: null, arming,
    ui: { captioning: false, recording: false, onAir: false },
    actions: { setBroadcastStatus: vi.fn(), setArmed },
  };
  const { hook } = memoryLocation({ path: '/production' });
  return { setArmed, ...render(<Router hook={hook}><ProductionHeader D={D} /></Router>) };
}

describe('Production header arming badge', () => {
  it('is hidden while arming is unknown', () => {
    header(null);
    expect(screen.queryByRole('button', { name: /armed|safe/i })).toBeNull();
  });

  it('shows SAFE and arms on click', async () => {
    const { setArmed } = header({ armed: false });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Safe' }));
    expect(setArmed).toHaveBeenCalledWith(true);
  });

  it('shows ARMED and disarms on click', async () => {
    const { setArmed } = header({ armed: true });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Armed' }));
    expect(setArmed).toHaveBeenCalledWith(false);
  });
});
