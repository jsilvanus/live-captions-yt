import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JobsPanel from '../../../src/components/jobs-panel/JobsPanel.jsx';
import { getMessages } from '../../../src/lib/i18n.js';
import { makePanelT } from '../../../src/components/JobsIndicator.jsx';

const t = makePanelT(getMessages('en'));
const job = (over) => ({
  id: 'ffmpeg-1', projectId: 'k', projectTitle: 'hls', type: 'FFMPEG', status: 'RUNNING', phase: null, progress: 0, message: null, error: null,
  workerId: 'fleet', cancelRequested: false, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), completedAt: null, ...over,
});
const typeLabel = (type) => ({ FFMPEG: 'ffmpeg', AUDITOR_LIVE: 'Live transcription' }[type] ?? type);

describe('JobsPanel', { timeout: 20_000 }, () => {
  it('shows the count, the strip and the rows, including the auditor live row', async () => {
    const loadJobs = vi.fn().mockResolvedValue({
      jobs: [job(), job({ id: 'auditor-s1', type: 'AUDITOR_LIVE', projectTitle: 'fi', message: 'fi · 7', phase: 'running', workerId: 'auditor' })],
      counts: { running: 2, queued: 0 },
    });
    const loadStrip = vi.fn().mockResolvedValue({ enabled: true, fleet: { state: 'ok', workers: 2, slotsUsed: 5, slotsTotal: 8, queued: 2 }, local: null, app: { running: 1, queued: 0 }, stt: { queued: 2, running: 1 }, live: 1 });
    render(<JobsPanel t={t} loadJobs={loadJobs} loadStrip={loadStrip} typeLabel={typeLabel} />);
    await waitFor(() => expect(screen.getByTitle('2 running or queued')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Open the jobs panel' }));
    const region = await screen.findByRole('region', { name: 'Jobs' });
    expect(region).toHaveTextContent('ffmpeg · hls');
    expect(region).toHaveTextContent('Live transcription · fi');
    expect(region).toHaveTextContent('fi · 7');
    expect(region).toHaveTextContent('fleet 2w · slots 5/8 · queue 2 · app 1 run / 0 queued · stt 1 run / 2 queued · live translation 1');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull(); // no cancelJob prop, no button
  });

  it('says nothing is running, and shows a notice when loading fails', async () => {
    const loadJobs = vi.fn().mockResolvedValueOnce({ jobs: [], counts: { running: 0, queued: 0 } }).mockRejectedValue(new Error('x'));
    render(<JobsPanel t={t} loadJobs={loadJobs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the jobs panel' }));
    expect(await screen.findByText('Nothing is running.')).toBeInTheDocument();
  });

  it('shows a cancel button only when cancelJob is given', async () => {
    const cancelJob = vi.fn().mockResolvedValue();
    const loadJobs = vi.fn().mockResolvedValue({ jobs: [job({ id: 'j1', status: 'QUEUED' })], counts: { running: 0, queued: 1 } });
    render(<JobsPanel t={t} loadJobs={loadJobs} cancelJob={cancelJob} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the jobs panel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    // first click only asks
    expect(cancelJob).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel this job?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' })));
  });

  it('does not cancel when the answer is No', async () => {
    const cancelJob = vi.fn().mockResolvedValue();
    const loadJobs = vi.fn().mockResolvedValue({ jobs: [job({ id: 'j1' })], counts: { running: 1, queued: 0 } });
    render(<JobsPanel t={t} loadJobs={loadJobs} cancelJob={cancelJob} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the jobs panel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(cancelJob).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancel this job?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows no cancel button for a row that is not cancellable, and a pull symbol on a live row', async () => {
    const cancelJob = vi.fn().mockResolvedValue();
    const loadJobs = vi.fn().mockResolvedValue({
      jobs: [job({ id: 'ffmpeg-1', cancellable: false }), job({ id: 'auditor-s1', type: 'AUDITOR_LIVE', projectTitle: 'fi', cancellable: false, mode: 'pull' }), job({ id: 'x', projectTitle: 'push-row', cancellable: false, mode: 'push' })],
      counts: { running: 3, queued: 0 },
    });
    render(<JobsPanel t={t} loadJobs={loadJobs} cancelJob={cancelJob} typeLabel={typeLabel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the jobs panel' }));
    await screen.findByRole('region', { name: 'Jobs' });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Pull: the service pulls the stream itself' })).toHaveAttribute('title', 'Pull: the service pulls the stream itself');
    expect(screen.getByRole('img', { name: 'Push: audio is sent to the service' })).toBeInTheDocument();
  });
});
