import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropZone } from '../../src/components/DropZone.jsx';
import { FileContext } from '../../src/contexts/FileContext.jsx';

// ---------------------------------------------------------------------------
// Mock NormalizeLinesModal to simplify — it's a separate component
// ---------------------------------------------------------------------------

vi.mock('../../src/components/NormalizeLinesModal', () => ({
  NormalizeLinesModal: ({ fileName, onConfirm, onSkip }) => (
    <div data-testid="normalize-modal">
      <span>{fileName}</span>
      <button onClick={() => onConfirm(['normalized'])}>Confirm</button>
      <button onClick={onSkip}>Skip</button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFileStore() {
  return {
    files: [],
    activeFile: null,
    loadFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn(),
    setActive: vi.fn(),
    cycleActive: vi.fn(),
    setPointer: vi.fn(),
    advancePointer: vi.fn(),
    createEmptyFile: vi.fn(),
    updateFileFromRawText: vi.fn(),
    setLastSentLine: vi.fn(),
  };
}

function renderDropZone(fileStore, props = {}) {
  const fs = fileStore || mockFileStore();
  const result = render(
    <FileContext.Provider value={fs}>
      <DropZone {...props} />
    </FileContext.Provider>
  );
  return { ...result, fileStore: fs };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DropZone', () => {
  it('renders drop zone with instructions', () => {
    renderDropZone();
    expect(screen.getByText(/drop text files here/i)).toBeInTheDocument();
    expect(screen.getByText(/click to browse/i)).toBeInTheDocument();
  });

  it('renders hidden file input', () => {
    renderDropZone();
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input.style.display).toBe('none');
    expect(input.accept).toContain('.txt');
  });

  it('hides the drop zone when visible=false', () => {
    renderDropZone(null, { visible: false });
    expect(screen.queryByText(/drop text files here/i)).not.toBeInTheDocument();
  });

  it('adds active class on drag over', () => {
    renderDropZone();
    const zone = document.querySelector('.drop-zone');
    fireEvent.dragOver(zone, { preventDefault: vi.fn() });
    expect(zone.classList.contains('drop-zone--active')).toBe(true);
  });

  it('removes active class on drag leave', () => {
    renderDropZone();
    const zone = document.querySelector('.drop-zone');
    fireEvent.dragOver(zone, { preventDefault: vi.fn() });
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(zone.classList.contains('drop-zone--active')).toBe(false);
  });

  it('triggers file input click on zone click', () => {
    renderDropZone();
    const input = document.querySelector('input[type="file"]');
    const clickSpy = vi.spyOn(input, 'click');
    const zone = document.querySelector('.drop-zone');
    fireEvent.click(zone);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('shows error for non-txt files on drop', async () => {
    renderDropZone();
    const zone = document.querySelector('.drop-zone');

    const file = new File(['data'], 'image.png', { type: 'image/png' });
    fireEvent.drop(zone, {
      preventDefault: vi.fn(),
      dataTransfer: { files: [file] },
    });

    // Error message appears
    expect(await screen.findByText(/only .txt files supported/i)).toBeInTheDocument();
  });
});
