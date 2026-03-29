/**
 * Tests for InteractiveUI pure-logic methods.
 *
 * The blessed screen (initScreen/start) is never called, so all UI widgets
 * remain null.  All update methods guard with `if (!this.widget) return;`
 * so they are safe to call — they simply become no-ops.
 *
 * Tested: loadFile, shiftPointer, gotoLine, isSendableLine, sendCurrentLine,
 *         sendCustomCaption, sendBatch, handleCommand (/load, /goto, /batch,
 *         /timestamps, /send, /stream, /reload), _parseVideoId.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InteractiveUI } from '../src/interactive-ui.js';

// ---------------------------------------------------------------------------
// Temp file fixture
// ---------------------------------------------------------------------------

const TMP_DIR  = join(tmpdir(), `lcyt-cli-ui-test-${Date.now()}`);
const TMP_FILE = join(TMP_DIR, 'test.txt');
const FILE_CONTENT = [
  '# Heading',
  'First line',
  'Second line',
  '',
  'Third line',
].join('\n');

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.writeFileSync(TMP_FILE, FILE_CONTENT);

// Clean up after all tests (best-effort)
process.on('exit', () => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Mock sender
// ---------------------------------------------------------------------------

function makeMockSender() {
  let seq = 1;
  const sent = [];
  const batches = [];
  return {
    sent,
    batches,
    getSequence: () => seq,
    send: async (text) => { sent.push(text); seq++; },
    sendBatch: async (captions) => { batches.push(captions); seq += captions.length; },
  };
}

// ---------------------------------------------------------------------------
// Helper: create UI without starting blessed
// ---------------------------------------------------------------------------

function makeUI(senderOverride) {
  const sender = senderOverride || makeMockSender();
  const config = { sequence: 1, streamKey: 'testkey123' };
  const ui = new InteractiveUI(sender, config, '/tmp/fake-config.json', null);
  return { ui, sender, config };
}

// ---------------------------------------------------------------------------
// loadFile
// ---------------------------------------------------------------------------

describe('InteractiveUI.loadFile()', () => {
  it('loads a real file and splits into lines', () => {
    const { ui } = makeUI();
    const ok = ui.loadFile(TMP_FILE);
    assert.equal(ok, true);
    assert.equal(ui.loadedFile, TMP_FILE);
    assert.ok(ui.lines.length > 0);
    assert.equal(ui.currentLine, 0);
  });

  it('returns false for a non-existent file', () => {
    const { ui } = makeUI();
    const ok = ui.loadFile('/does/not/exist.txt');
    assert.equal(ok, false);
  });

  it('logs an error message on failure', () => {
    const { ui } = makeUI();
    ui.loadFile('/does/not/exist.txt');
    const lastLog = ui.logMessages[ui.logMessages.length - 1];
    assert.equal(lastLog.type, 'error');
  });
});

// ---------------------------------------------------------------------------
// shiftPointer
// ---------------------------------------------------------------------------

describe('InteractiveUI.shiftPointer()', () => {
  it('advances pointer by positive offset', () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const ok = ui.shiftPointer(1);
    assert.equal(ok, true);
    assert.equal(ui.currentLine, 1);
  });

  it('returns false when offset would go out of bounds (negative)', () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const ok = ui.shiftPointer(-1); // already at 0
    assert.equal(ok, false);
    assert.equal(ui.currentLine, 0);
  });

  it('returns false when offset goes past end', () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const ok = ui.shiftPointer(9999);
    assert.equal(ok, false);
  });

  it('returns false when no content is loaded', () => {
    const { ui } = makeUI();
    // lines is empty
    const ok = ui.shiftPointer(1);
    assert.equal(ok, false);
  });
});

// ---------------------------------------------------------------------------
// gotoLine
// ---------------------------------------------------------------------------

describe('InteractiveUI.gotoLine()', () => {
  it('jumps to a valid 1-indexed line number', () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const ok = ui.gotoLine(2);
    assert.equal(ok, true);
    assert.equal(ui.currentLine, 1);
  });

  it('returns false for line 0 (out of range)', () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const ok = ui.gotoLine(0);
    assert.equal(ok, false);
  });

  it('returns false for line beyond file length', () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const ok = ui.gotoLine(9999);
    assert.equal(ok, false);
  });
});

// ---------------------------------------------------------------------------
// isSendableLine
// ---------------------------------------------------------------------------

describe('InteractiveUI.isSendableLine()', () => {
  it('returns false for an out-of-range index', () => {
    const { ui } = makeUI();
    assert.equal(ui.isSendableLine(0), false);
  });

  it('returns false for a heading line (starts with #)', () => {
    const { ui } = makeUI();
    ui.lines = ['# Heading', 'Normal line'];
    assert.equal(ui.isSendableLine(0), false);
  });

  it('returns false for an empty line', () => {
    const { ui } = makeUI();
    ui.lines = ['', 'Normal'];
    assert.equal(ui.isSendableLine(0), false);
  });

  it('returns true for a normal text line', () => {
    const { ui } = makeUI();
    ui.lines = ['# Heading', 'Normal line'];
    assert.equal(ui.isSendableLine(1), true);
  });
});

// ---------------------------------------------------------------------------
// sendCurrentLine
// ---------------------------------------------------------------------------

describe('InteractiveUI.sendCurrentLine()', () => {
  it('logs warning when no content loaded', async () => {
    const { ui } = makeUI();
    await ui.sendCurrentLine();
    const log = ui.logMessages.find(m => m.message.includes('No content'));
    assert.ok(log);
  });

  it('skips heading lines and advances pointer', async () => {
    const { ui } = makeUI();
    ui.lines = ['# Heading', 'Normal line'];
    ui.currentLine = 0;
    await ui.sendCurrentLine();
    assert.equal(ui.currentLine, 1); // advanced past heading
  });

  it('sends a sendable line and advances pointer', async () => {
    const sender = makeMockSender();
    const { ui } = makeUI(sender);
    ui.lines = ['First line', 'Second line'];
    ui.currentLine = 0;
    await ui.sendCurrentLine();
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0], 'First line');
    assert.equal(ui.currentLine, 1);
  });

  it('queues to batch when batchMode is on', async () => {
    const { ui } = makeUI();
    ui.lines = ['Batch line'];
    ui.currentLine = 0;
    ui.batchMode = true;
    await ui.sendCurrentLine();
    assert.equal(ui.batchCaptions.length, 1);
    assert.equal(ui.batchCaptions[0].text, 'Batch line');
    // Clean up timer
    if (ui.batchTimer) clearTimeout(ui.batchTimer);
  });
});

// ---------------------------------------------------------------------------
// sendCustomCaption
// ---------------------------------------------------------------------------

describe('InteractiveUI.sendCustomCaption()', () => {
  it('logs warning for empty string', async () => {
    const { ui } = makeUI();
    await ui.sendCustomCaption('  ');
    const log = ui.logMessages.find(m => m.message.includes('Empty'));
    assert.ok(log);
  });

  it('sends trimmed text via sender', async () => {
    const sender = makeMockSender();
    const { ui } = makeUI(sender);
    await ui.sendCustomCaption('  Hello world  ');
    assert.equal(sender.sent[0], 'Hello world');
  });

  it('does not advance pointer', async () => {
    const { ui } = makeUI();
    ui.lines = ['Line 1', 'Line 2'];
    ui.currentLine = 0;
    await ui.sendCustomCaption('Custom text');
    assert.equal(ui.currentLine, 0); // pointer unchanged
  });

  it('queues to batch when batchMode is on', async () => {
    const { ui } = makeUI();
    ui.batchMode = true;
    await ui.sendCustomCaption('Batch text');
    assert.equal(ui.batchCaptions[0].text, 'Batch text');
    if (ui.batchTimer) clearTimeout(ui.batchTimer);
  });
});

// ---------------------------------------------------------------------------
// sendBatch
// ---------------------------------------------------------------------------

describe('InteractiveUI.sendBatch()', () => {
  it('logs warning when queue is empty', async () => {
    const { ui } = makeUI();
    await ui.sendBatch();
    const log = ui.logMessages.find(m => m.message.includes('empty'));
    assert.ok(log);
  });

  it('flushes all queued captions', async () => {
    const sender = makeMockSender();
    const { ui } = makeUI(sender);
    ui.batchCaptions = [
      { text: 'Cap 1', timestamp: null },
      { text: 'Cap 2', timestamp: null },
    ];
    await ui.sendBatch();
    assert.equal(sender.batches.length, 1);
    assert.equal(sender.batches[0].length, 2);
    assert.equal(ui.batchCaptions.length, 0); // cleared
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /goto
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /goto', () => {
  it('logs warning when no argument given', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/goto');
    const log = ui.logMessages.find(m => m.message.includes('Usage'));
    assert.ok(log);
  });

  it('logs warning for non-numeric argument', async () => {
    const { ui } = makeUI();
    ui.lines = ['a', 'b', 'c'];
    await ui.handleCommand('/goto abc');
    const log = ui.logMessages.find(m => m.message.includes('Not a number'));
    assert.ok(log);
  });

  it('jumps to line and logs success', async () => {
    const { ui } = makeUI();
    ui.lines = ['a', 'b', 'c'];
    await ui.handleCommand('/goto 2');
    assert.equal(ui.currentLine, 1);
    const log = ui.logMessages.find(m => m.message.includes('Jumped'));
    assert.ok(log);
  });

  it('logs warning for out-of-range line', async () => {
    const { ui } = makeUI();
    ui.lines = ['a', 'b'];
    await ui.handleCommand('/goto 100');
    const log = ui.logMessages.find(m => m.message.includes('out of range'));
    assert.ok(log);
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /batch
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /batch', () => {
  it('toggles batch mode on', async () => {
    const { ui } = makeUI();
    assert.equal(ui.batchMode, false);
    await ui.handleCommand('/batch');
    assert.equal(ui.batchMode, true);
  });

  it('toggles batch mode off (and flushes if queued)', async () => {
    const sender = makeMockSender();
    const { ui } = makeUI(sender);
    ui.batchMode = true;
    ui.batchCaptions = [{ text: 'queued', timestamp: null }];
    await ui.handleCommand('/batch');
    assert.equal(ui.batchMode, false);
    // Batch should have been flushed
    assert.equal(sender.batches.length, 1);
  });

  it('sets custom timeout when provided', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/batch 10');
    assert.equal(ui.batchTimeout, 10);
    assert.equal(ui.batchMode, true);
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /timestamps (/ts)
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /timestamps', () => {
  it('toggles showTimestamps off', async () => {
    const { ui } = makeUI();
    assert.equal(ui.showTimestamps, true);
    await ui.handleCommand('/timestamps');
    assert.equal(ui.showTimestamps, false);
  });

  it('/ts alias also toggles', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/ts');
    assert.equal(ui.showTimestamps, false);
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /load
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /load', () => {
  it('logs usage warning with no args', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/load');
    const log = ui.logMessages.find(m => m.message.includes('Usage'));
    assert.ok(log);
  });

  it('loads a file successfully', async () => {
    const { ui } = makeUI();
    await ui.handleCommand(`/load ${TMP_FILE}`);
    assert.ok(ui.lines.length > 0);
    assert.equal(ui.loadedFile, TMP_FILE);
  });

  it('loads a file and jumps to specified line', async () => {
    const { ui } = makeUI();
    await ui.handleCommand(`/load ${TMP_FILE} 2`);
    assert.equal(ui.currentLine, 1);
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /reload
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /reload', () => {
  it('logs warning when nothing loaded', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/reload');
    const log = ui.logMessages.find(m => m.message.includes('No content'));
    assert.ok(log);
  });

  it('reloads the currently loaded file', async () => {
    const { ui } = makeUI();
    ui.loadFile(TMP_FILE);
    const linesBefore = ui.lines.length;
    ui.lines = []; // simulate clearing
    await ui.handleCommand('/reload');
    assert.equal(ui.lines.length, linesBefore);
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /stream
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /stream', () => {
  it('logs usage warning with no args', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/stream');
    const log = ui.logMessages.find(m => m.message.includes('Usage'));
    assert.ok(log);
  });

  it('sets watchVideoId from a bare 11-char video ID', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/stream abcdefghijk');
    assert.equal(ui.watchVideoId, 'abcdefghijk');
  });

  it('extracts video ID from a youtube.com URL', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/stream https://www.youtube.com/watch?v=abc12345678');
    assert.equal(ui.watchVideoId, 'abc12345678');
  });

  it('logs error for invalid input', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/stream not-a-valid-id');
    const log = ui.logMessages.find(m => m.type === 'error');
    assert.ok(log);
  });
});

// ---------------------------------------------------------------------------
// handleCommand — /send
// ---------------------------------------------------------------------------

describe('InteractiveUI.handleCommand() — /send', () => {
  it('logs warning when batch queue is empty', async () => {
    const { ui } = makeUI();
    await ui.handleCommand('/send');
    const log = ui.logMessages.find(m => m.message.includes('empty'));
    assert.ok(log);
  });

  it('flushes the batch queue', async () => {
    const sender = makeMockSender();
    const { ui } = makeUI(sender);
    ui.batchCaptions = [{ text: 'A', timestamp: null }];
    await ui.handleCommand('/send');
    assert.equal(sender.batches.length, 1);
    assert.equal(ui.batchCaptions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// _parseVideoId
// ---------------------------------------------------------------------------

describe('InteractiveUI._parseVideoId()', () => {
  let ui;
  beforeEach(() => { ({ ui } = makeUI()); });

  it('returns null for invalid input', () => {
    assert.equal(ui._parseVideoId('not-valid'), null);
    assert.equal(ui._parseVideoId(''), null);
  });

  it('returns a bare 11-char ID unchanged', () => {
    assert.equal(ui._parseVideoId('abcdefghijk'), 'abcdefghijk');
  });

  it('extracts ID from watch?v= URL', () => {
    assert.equal(ui._parseVideoId('https://www.youtube.com/watch?v=abc12345678'), 'abc12345678');
  });

  it('extracts ID from youtu.be short URL', () => {
    assert.equal(ui._parseVideoId('https://youtu.be/abc12345678'), 'abc12345678');
  });

  it('extracts ID from /live/ URL', () => {
    assert.equal(ui._parseVideoId('https://www.youtube.com/live/abc12345678'), 'abc12345678');
  });
});
