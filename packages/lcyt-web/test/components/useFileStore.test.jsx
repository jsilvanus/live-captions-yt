/**
 * Tests for useFileStore hook.
 *
 * FileReader is provided by jsdom; all file-loading tests create real File objects.
 * localStorage is cleared between tests in test/setup.vitest.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileStore } from '../../src/hooks/useFileStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name, content) {
  return new File([content], name, { type: 'text/plain' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useFileStore — initial state', () => {
  it('starts with no files', () => {
    const { result } = renderHook(() => useFileStore());
    expect(result.current.files).toEqual([]);
  });

  it('activeId starts null', () => {
    const { result } = renderHook(() => useFileStore());
    expect(result.current.activeId).toBeNull();
  });

  it('activeFile starts null', () => {
    const { result } = renderHook(() => useFileStore());
    expect(result.current.activeFile).toBeNull();
  });

  it('rawEditMode starts false', () => {
    const { result } = renderHook(() => useFileStore());
    expect(result.current.rawEditMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadFile()
// ---------------------------------------------------------------------------

describe('useFileStore — loadFile()', () => {
  it('adds a file to the store', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'Hello world')));
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].name).toBe('test.txt');
  });

  it('parses lines from file content', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'Line one\nLine two')));
    expect(result.current.files[0].lines).toEqual(['Line one', 'Line two']);
  });

  it('sets the first loaded file as active', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('first.txt', 'Hello')));
    expect(result.current.activeId).toBe(result.current.files[0].id);
  });

  it('fires onFileLoaded callback', async () => {
    const onFileLoaded = vi.fn();
    const { result } = renderHook(() => useFileStore({ onFileLoaded }));
    await act(() => result.current.loadFile(makeFile('test.txt', 'Hello')));
    expect(onFileLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test.txt' })
    );
  });

  it('fires onActiveChanged for the first file', async () => {
    const onActiveChanged = vi.fn();
    const { result } = renderHook(() => useFileStore({ onActiveChanged }));
    await act(() => result.current.loadFile(makeFile('test.txt', 'Hello')));
    expect(onActiveChanged).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.objectContaining({ name: 'test.txt' }) })
    );
  });

  it('does NOT fire onActiveChanged when a file is already active', async () => {
    const onActiveChanged = vi.fn();
    const { result } = renderHook(() => useFileStore({ onActiveChanged }));
    await act(() => result.current.loadFile(makeFile('first.txt', 'First')));
    onActiveChanged.mockClear();
    await act(() => result.current.loadFile(makeFile('second.txt', 'Second')));
    expect(onActiveChanged).not.toHaveBeenCalled();
  });

  it('persists rawText to localStorage', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'Hello')));
    const stored = JSON.parse(localStorage.getItem('lcyt:files'));
    expect(stored[0].rawText).toBe('Hello');
  });

  it('returns the entry as the resolved value', async () => {
    const { result } = renderHook(() => useFileStore());
    let entry;
    await act(async () => {
      entry = await result.current.loadFile(makeFile('test.txt', 'Hi'));
    });
    expect(entry).toMatchObject({ name: 'test.txt', lines: ['Hi'] });
  });

  it('loads multiple files', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    await act(() => result.current.loadFile(makeFile('b.txt', 'B')));
    expect(result.current.files).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// removeFile()
// ---------------------------------------------------------------------------

describe('useFileStore — removeFile()', () => {
  it('removes the file from the list', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    const id = result.current.files[0].id;
    act(() => result.current.removeFile(id));
    expect(result.current.files).toHaveLength(0);
  });

  it('fires onFileRemoved with the file id', async () => {
    const onFileRemoved = vi.fn();
    const { result } = renderHook(() => useFileStore({ onFileRemoved }));
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    const id = result.current.files[0].id;
    act(() => result.current.removeFile(id));
    expect(onFileRemoved).toHaveBeenCalledWith(id);
  });

  it('sets activeId to null when the last file is removed', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('only.txt', 'X')));
    const id = result.current.files[0].id;
    act(() => result.current.removeFile(id));
    expect(result.current.activeId).toBeNull();
  });

  it('switches active to the next file when the active file is removed', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    await act(() => result.current.loadFile(makeFile('b.txt', 'B')));
    const firstId = result.current.files[0].id;
    const secondId = result.current.files[1].id;
    act(() => result.current.setActive(firstId));
    act(() => result.current.removeFile(firstId));
    expect(result.current.activeId).toBe(secondId);
  });

  it('is a no-op for unknown ids', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    act(() => result.current.removeFile('non-existent-id'));
    expect(result.current.files).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// setActive() / cycleActive()
// ---------------------------------------------------------------------------

describe('useFileStore — setActive() / cycleActive()', () => {
  it('setActive changes the active file', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    await act(() => result.current.loadFile(makeFile('b.txt', 'B')));
    const secondId = result.current.files[1].id;
    act(() => result.current.setActive(secondId));
    expect(result.current.activeId).toBe(secondId);
  });

  it('cycleActive advances to the next file', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    await act(() => result.current.loadFile(makeFile('b.txt', 'B')));
    const firstId = result.current.files[0].id;
    const secondId = result.current.files[1].id;
    act(() => result.current.setActive(firstId));
    act(() => result.current.cycleActive());
    expect(result.current.activeId).toBe(secondId);
  });

  it('cycleActive wraps around to the first file', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('a.txt', 'A')));
    await act(() => result.current.loadFile(makeFile('b.txt', 'B')));
    const firstId = result.current.files[0].id;
    const secondId = result.current.files[1].id;
    act(() => result.current.setActive(secondId));
    act(() => result.current.cycleActive());
    expect(result.current.activeId).toBe(firstId);
  });

  it('cycleActive is a no-op with only one file', async () => {
    const onActiveChanged = vi.fn();
    const { result } = renderHook(() => useFileStore({ onActiveChanged }));
    await act(() => result.current.loadFile(makeFile('only.txt', 'X')));
    onActiveChanged.mockClear();
    act(() => result.current.cycleActive());
    expect(onActiveChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setPointer()
// ---------------------------------------------------------------------------

describe('useFileStore — setPointer()', () => {
  it('updates the pointer within bounds', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2\nL3')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, 2));
    expect(result.current.files[0].pointer).toBe(2);
  });

  it('clamps pointer to the max line index', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, 999));
    expect(result.current.files[0].pointer).toBe(1);
  });

  it('clamps pointer to 0', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, -5));
    expect(result.current.files[0].pointer).toBe(0);
  });

  it('fires onPointerChanged callback', async () => {
    const onPointerChanged = vi.fn();
    const { result } = renderHook(() => useFileStore({ onPointerChanged }));
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2\nL3')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, 1));
    expect(onPointerChanged).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: id, fromIndex: 0, toIndex: 1 })
    );
  });

  it('persists pointer to localStorage', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('named.txt', 'L1\nL2\nL3')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, 2));
    const stored = JSON.parse(localStorage.getItem('lcyt-pointers'));
    expect(stored['named.txt']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// advancePointer()
// ---------------------------------------------------------------------------

describe('useFileStore — advancePointer()', () => {
  it('increments the pointer by 1', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2\nL3')));
    const id = result.current.files[0].id;
    act(() => result.current.advancePointer(id));
    expect(result.current.files[0].pointer).toBe(1);
  });

  it('does not advance past the last line', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, 1));
    act(() => result.current.advancePointer(id));
    expect(result.current.files[0].pointer).toBe(1);
  });

  it('fires onPointerChanged callback', async () => {
    const onPointerChanged = vi.fn();
    const { result } = renderHook(() => useFileStore({ onPointerChanged }));
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2')));
    const id = result.current.files[0].id;
    act(() => result.current.advancePointer(id));
    expect(onPointerChanged).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: id, fromIndex: 0, toIndex: 1 })
    );
  });
});

// ---------------------------------------------------------------------------
// createEmptyFile()
// ---------------------------------------------------------------------------

describe('useFileStore — createEmptyFile()', () => {
  it('creates a file with zero lines', () => {
    const { result } = renderHook(() => useFileStore());
    act(() => result.current.createEmptyFile('new.txt'));
    expect(result.current.files[0].lines).toEqual([]);
  });

  it('sets the new file as active', () => {
    const { result } = renderHook(() => useFileStore());
    act(() => result.current.createEmptyFile('new.txt'));
    expect(result.current.activeId).toBe(result.current.files[0].id);
  });

  it('enters rawEditMode', () => {
    const { result } = renderHook(() => useFileStore());
    act(() => result.current.createEmptyFile('new.txt'));
    expect(result.current.rawEditMode).toBe(true);
  });

  it('fires onFileLoaded callback', () => {
    const onFileLoaded = vi.fn();
    const { result } = renderHook(() => useFileStore({ onFileLoaded }));
    act(() => result.current.createEmptyFile('new.txt'));
    expect(onFileLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new.txt', lines: [] })
    );
  });

  it('fires onActiveChanged callback', () => {
    const onActiveChanged = vi.fn();
    const { result } = renderHook(() => useFileStore({ onActiveChanged }));
    act(() => result.current.createEmptyFile('new.txt'));
    expect(onActiveChanged).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.objectContaining({ name: 'new.txt' }) })
    );
  });
});

// ---------------------------------------------------------------------------
// updateFileFromRawText()
// ---------------------------------------------------------------------------

describe('useFileStore — updateFileFromRawText()', () => {
  it('re-parses and updates the file lines', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'Old line')));
    const id = result.current.files[0].id;
    act(() => result.current.updateFileFromRawText(id, 'New line A\nNew line B'));
    expect(result.current.files[0].lines).toEqual(['New line A', 'New line B']);
  });

  it('persists updated rawText to localStorage', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'Old')));
    const id = result.current.files[0].id;
    act(() => result.current.updateFileFromRawText(id, 'New content'));
    const stored = JSON.parse(localStorage.getItem('lcyt:files'));
    expect(stored[0].rawText).toBe('New content');
  });

  it('clamps pointer when line count shrinks', async () => {
    const { result } = renderHook(() => useFileStore());
    await act(() => result.current.loadFile(makeFile('test.txt', 'L1\nL2\nL3')));
    const id = result.current.files[0].id;
    act(() => result.current.setPointer(id, 2));
    act(() => result.current.updateFileFromRawText(id, 'Only one'));
    expect(result.current.files[0].pointer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence across remount
// ---------------------------------------------------------------------------

describe('useFileStore — localStorage restore on mount', () => {
  it('restores files saved in localStorage on mount', async () => {
    // First hook instance: load a file
    const { result: r1, unmount } = renderHook(() => useFileStore());
    await act(() => r1.current.loadFile(makeFile('restore.txt', 'Restored line')));
    unmount();

    // Second hook instance: should restore from localStorage
    const { result: r2 } = renderHook(() => useFileStore());
    // useEffect runs after render; act flushes it
    await act(async () => {});
    expect(r2.current.files).toHaveLength(1);
    expect(r2.current.files[0].name).toBe('restore.txt');
    expect(r2.current.files[0].lines).toEqual(['Restored line']);
  });
});
