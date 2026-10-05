import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PerceptionPanel, describeScene } from '../../src/components/ai-observability/PerceptionPanel.jsx';

const OVERVIEW = {
  attribution: { running: false, tag: { cameraId: 'c1', method: 'mixer-signal', confidence: 1 } },
  shared: { running: false, auto: false },
  cameras: [
    { id: 'c1', name: 'Choir', hasFeed: true, perceptionEnabled: false, jobRunning: true, onProgram: true,
      scene: { visible: true, people: 2, roles: ['preacher'], framingScore: 0.72, ageMs: 800 } },
    { id: 'c2', name: 'Wide', hasFeed: false, perceptionEnabled: false, jobRunning: false, onProgram: false, scene: null },
  ],
};

describe('describeScene', () => {
  it('summarises people, roles, framing and age', () => {
    expect(describeScene({ visible: true, people: 2, roles: ['preacher'], framingScore: 0.72, ageMs: 800 })).toBe('2 people (preacher) · framing 0.72 · 800 ms ago');
    expect(describeScene({ visible: true, people: 0, ageMs: 2500 })).toBe('no people · 2.5 s ago');
    expect(describeScene({ visible: false, people: 0, ageMs: 7000 })).toBe('not visible · last report 7.0 s ago');
    expect(describeScene(null)).toBe('no detector data');
  });
});

describe('PerceptionPanel', () => {
  it('shows program source, per-camera state and which cameras have a feed of their own', () => {
    render(<PerceptionPanel overview={OVERVIEW} onAction={async () => null} />);
    expect(screen.getByTestId('attribution-line').textContent).toBe('Program feed: Choir (mixer-signal, 100%)');
    expect(screen.getByTestId('camera-c1').textContent).toContain('on program');
    expect(screen.getByTestId('camera-c1').textContent).toContain('detector running');
    expect(screen.getByTestId('camera-c2').textContent).toContain('no feed of its own');
  });

  it('controls call the right routes; an error is shown', async () => {
    const onAction = vi.fn(async (path) => (path.endsWith('/stop') && path.includes('cameras') ? 'worker unreachable' : null));
    render(<PerceptionPanel overview={OVERVIEW} onAction={onAction} />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Stop' })[0]); // Choir's detector
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('worker unreachable'));
    expect(onAction).toHaveBeenCalledWith('/production/cameras/c1/perception/stop', undefined);
    await user.click(screen.getByRole('button', { name: 'Start matching' }));
    expect(onAction).toHaveBeenCalledWith('/production/attribution/start', undefined);
    await user.selectOptions(screen.getByLabelText('This is camera'), 'c2');
    expect(onAction).toHaveBeenCalledWith('/production/attribution/override', { cameraId: 'c2' });
    await user.click(screen.getAllByRole('checkbox')[0]); // shared auto
    expect(onAction).toHaveBeenCalledWith('/production/perception/shared/auto', { enabled: true });
  });

  it('shows a loading line without data', () => {
    render(<PerceptionPanel overview={null} onAction={async () => null} />);
    expect(screen.getByText(/Loading camera status/)).toBeTruthy();
  });
});
