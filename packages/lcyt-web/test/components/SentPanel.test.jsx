import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SentPanel } from '../../src/components/SentPanel.jsx';
import { SentLogContext } from '../../src/contexts/SentLogContext.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSentLog(entries = []) {
  return {
    entries,
    add: vi.fn(),
    confirm: vi.fn(),
    markError: vi.fn(),
    updateRequestId: vi.fn(),
    clear: vi.fn(),
  };
}

function renderSentPanel(entries = []) {
  const sentLog = mockSentLog(entries);
  const result = render(
    <SentLogContext.Provider value={sentLog}>
      <SentPanel />
    </SentLogContext.Provider>
  );
  return { ...result, sentLog };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.confirm = vi.fn(() => true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SentPanel', () => {
  it('renders header with title', () => {
    renderSentPanel();
    expect(screen.getByText('Sent Captions')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    renderSentPanel([]);
    expect(screen.getByText('No captions sent yet')).toBeInTheDocument();
  });

  it('renders confirmed entry with sequence number', () => {
    renderSentPanel([
      { requestId: 'r1', text: 'Hello world', sequence: 42, pending: false, error: false, timestamp: Date.now() },
    ]);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders pending entry with ? marker', () => {
    renderSentPanel([
      { requestId: 'r1', text: 'Pending caption', pending: true, error: false, timestamp: Date.now() },
    ]);
    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByText('Pending caption')).toBeInTheDocument();
  });

  it('renders error entry with error marker', () => {
    renderSentPanel([
      { requestId: 'r1', text: 'Failed caption', pending: false, error: true, timestamp: Date.now() },
    ]);
    // Error seq shows ✕
    const items = document.querySelectorAll('.sent-item--error');
    expect(items.length).toBe(1);
  });

  it('renders translation text when captionTranslationText exists', () => {
    renderSentPanel([
      {
        requestId: 'r1',
        text: 'Hello',
        captionTranslationText: 'Hola',
        showOriginal: true,
        sequence: 1,
        pending: false,
        error: false,
        timestamp: Date.now(),
      },
    ]);
    expect(screen.getByText('Hola')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows globe icon for entries with translations', () => {
    renderSentPanel([
      {
        requestId: 'r1',
        text: 'Test',
        hasTranslations: true,
        otherTranslations: { 'fi-FI': 'Testi' },
        sequence: 1,
        pending: false,
        error: false,
        timestamp: Date.now(),
      },
    ]);
    expect(screen.getByTitle(/fi-FI: Testi/)).toBeInTheDocument();
  });

  it('calls clear when clear button is clicked', () => {
    const { sentLog } = renderSentPanel([
      { requestId: 'r1', text: 'Caption 1', sequence: 1, pending: false, error: false, timestamp: Date.now() },
    ]);

    fireEvent.click(screen.getByLabelText('Clear sent log'));
    expect(sentLog.clear).toHaveBeenCalled();
  });

  it('renders word wrap toggle', () => {
    renderSentPanel();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByText('Wrap')).toBeInTheDocument();
  });

  it('toggles word wrap and persists to localStorage', () => {
    renderSentPanel([
      { requestId: 'r1', text: 'Test', sequence: 1, pending: false, error: false, timestamp: Date.now() },
    ]);

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(localStorage.getItem('lcyt:sent-panel-wrap')).toBe('1');

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(localStorage.getItem('lcyt:sent-panel-wrap')).toBe('0');
  });

  it('renders batch continuation items without sequence', () => {
    renderSentPanel([
      { requestId: 'batch-1', text: 'Line 1', sequence: 10, pending: false, error: false, timestamp: Date.now() },
      { requestId: 'batch-1', text: 'Line 2', sequence: 11, pending: false, error: false, timestamp: Date.now() },
    ]);
    // First item has sequence, second is a continuation (no seq label)
    expect(screen.getByText('#10')).toBeInTheDocument();
    expect(screen.getByText('Line 2')).toBeInTheDocument();
    // Continuation items have empty seq span
    const continuations = document.querySelectorAll('.sent-item--continuation');
    expect(continuations.length).toBe(1);
  });

  it('renders all entries below virtual threshold without windowing', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      requestId: `r${i}`,
      text: `Caption ${i}`,
      sequence: i,
      pending: false,
      error: false,
      timestamp: Date.now(),
    }));
    renderSentPanel(entries);
    const items = document.querySelectorAll('.sent-item');
    expect(items.length).toBe(50);
  });

  it('renders a windowed subset for large entry lists', () => {
    const entries = Array.from({ length: 600 }, (_, i) => ({
      requestId: `r${i}`,
      text: `Caption ${i}`,
      sequence: i,
      pending: false,
      error: false,
      timestamp: Date.now(),
    }));
    renderSentPanel(entries);
    // Virtual mode renders visible rows + overscan (≈35 rows with defaults), not all 600
    const items = document.querySelectorAll('.sent-item');
    expect(items.length).toBeLessThan(200);
    // At least a few rows should be visible
    expect(items.length).toBeGreaterThan(0);
  });
});
