/**
 * Tests for MusicHistoryPanel component.
 *
 * Vitest + jsdom environment. SessionApiContext is mocked directly (no real
 * network traffic occurs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { SessionApiContext } from '../../src/contexts/SessionApiContext.jsx';
import { MusicHistoryPanel } from '../../src/components/panels/MusicHistoryPanel.jsx';

function renderPanel(getMusicEventsHistory) {
  return render(
    <SessionApiContext.Provider value={{ getMusicEventsHistory }}>
      <LangProvider>
        <MusicHistoryPanel />
      </LangProvider>
    </SessionApiContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MusicHistoryPanel — initial load', () => {
  it('shows the empty state when there are no events', async () => {
    const getMusicEventsHistory = vi.fn().mockResolvedValue({ events: [], total: 0, limit: 20, offset: 0 });
    renderPanel(getMusicEventsHistory);

    await waitFor(() => {
      expect(screen.getByText('No detection events yet.')).toBeInTheDocument();
    });
    expect(getMusicEventsHistory).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it('renders fetched events', async () => {
    const getMusicEventsHistory = vi.fn().mockResolvedValue({
      events: [
        { id: 2, event_type: 'label_change', label: 'music', bpm: null, confidence: 0.9, ts: 1700000100 },
        { id: 1, event_type: 'bpm_update', label: null, bpm: 128, confidence: 0.8, ts: 1700000000 },
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    renderPanel(getMusicEventsHistory);

    await waitFor(() => {
      expect(screen.getByText(/Label change: music/)).toBeInTheDocument();
    });
    expect(screen.getByText(/BPM update: 128 BPM/)).toBeInTheDocument();
  });

  it('shows the error state when the fetch fails', async () => {
    const getMusicEventsHistory = vi.fn().mockRejectedValue(new Error('network error'));
    renderPanel(getMusicEventsHistory);

    await waitFor(() => {
      expect(screen.getByText('Failed to load detection history.')).toBeInTheDocument();
    });
  });
});

describe('MusicHistoryPanel — pagination', () => {
  it('shows a "Load more" button only when more events remain', async () => {
    const getMusicEventsHistory = vi.fn().mockResolvedValue({
      events: [{ id: 1, event_type: 'label_change', label: 'speech', bpm: null, confidence: 0.7, ts: 1700000000 }],
      total: 5,
      limit: 20,
      offset: 0,
    });
    renderPanel(getMusicEventsHistory);

    await waitFor(() => {
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });
  });

  it('does not show "Load more" once all events are loaded', async () => {
    const getMusicEventsHistory = vi.fn().mockResolvedValue({
      events: [{ id: 1, event_type: 'label_change', label: 'speech', bpm: null, confidence: 0.7, ts: 1700000000 }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    renderPanel(getMusicEventsHistory);

    await waitFor(() => {
      expect(screen.getByText(/Label change: speech/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });

  it('appends the next page and requests the correct offset on "Load more" click', async () => {
    const getMusicEventsHistory = vi.fn()
      .mockResolvedValueOnce({
        events: [{ id: 1, event_type: 'label_change', label: 'speech', bpm: null, confidence: 0.7, ts: 1700000000 }],
        total: 2,
        limit: 20,
        offset: 0,
      })
      .mockResolvedValueOnce({
        events: [{ id: 2, event_type: 'label_change', label: 'music', bpm: null, confidence: 0.9, ts: 1700000100 }],
        total: 2,
        limit: 20,
        offset: 1,
      });
    renderPanel(getMusicEventsHistory);

    await waitFor(() => {
      expect(screen.getByText(/Label change: speech/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Load more'));

    await waitFor(() => {
      expect(screen.getByText(/Label change: music/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Label change: speech/)).toBeInTheDocument();
    expect(getMusicEventsHistory).toHaveBeenLastCalledWith({ limit: 20, offset: 1 });
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });
});
