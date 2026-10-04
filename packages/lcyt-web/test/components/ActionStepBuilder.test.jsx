import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionStepBuilder } from '../../src/components/ActionStepBuilder.jsx';

const CAMERAS = [
  { id: 'c1', name: 'Pulpit', controlConfig: { presets: [{ id: 'p1', name: 'Wide' }] } },
];
const MIXERS = [{ id: 'm1', name: 'Main Mixer', type: 'roland' }];

function makeFetch({ cameras = CAMERAS, mixers = MIXERS, actions = [{ slug: 'intro', name: 'Intro' }] } = {}) {
  return vi.fn(async (path) => {
    const body = path === '/production/cameras' ? cameras
      : path === '/production/mixers' ? mixers
      : { actions };
    return { ok: true, json: async () => body };
  });
}

function Harness({ authedFetch, initial = '' }) {
  const [value, setValue] = useState(initial);
  return <ActionStepBuilder value={value} onChange={setValue} authedFetch={authedFetch} />;
}

describe('ActionStepBuilder', () => {
  it('adds camera, wait and named-action steps to the expression', async () => {
    const user = userEvent.setup();
    render(<Harness authedFetch={makeFetch()} />);
    const input = screen.getByLabelText(/Run action when this cue fires/);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Pulpit' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Camera'), 'c1');
    await user.selectOptions(screen.getByLabelText('Preset'), 'p1');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(input.value).toBe('camera:pulpit.wide');

    await user.selectOptions(screen.getByLabelText('Step type'), 'wait');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(input.value).toBe('camera:pulpit.wide | wait:2s');

    await user.selectOptions(screen.getByLabelText('Step type'), 'action');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Intro' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Named action'), 'intro');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(input.value).toBe('camera:pulpit.wide | wait:2s | @intro');
  });

  it('adds a mixer step by input number when the mixer lists no input names', async () => {
    const user = userEvent.setup();
    render(<Harness authedFetch={makeFetch()} />);
    await user.selectOptions(screen.getByLabelText('Step type'), 'mixer');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Main Mixer' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Mixer'), 'm1');
    await user.type(screen.getByLabelText('Input number'), '3');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(screen.getByLabelText(/Run action when this cue fires/).value).toMatch(/^mixer:main-mixer/);
  });

  it('warns when two devices share a label', async () => {
    const dup = [CAMERAS[0], { ...CAMERAS[0], id: 'c2' }];
    render(<Harness authedFetch={makeFetch({ cameras: dup })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/share a label/);
  });

  it('notes that device rules need project admin, and stays usable when lists fail to load', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); });
    render(<Harness authedFetch={failing} initial="camera:pulpit.wide" />);
    expect(screen.getByText(/needs project admin access/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Run action when this cue fires/)).toBeInTheDocument();
  });
});
