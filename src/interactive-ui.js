import blessed from 'blessed';
import { readFileSync } from 'fs';
import { resolve, basename } from 'path';
import logger from './logger.js';
import { saveConfig } from './config.js';

export class InteractiveUI {
  constructor(sender, config, configPath, defaultTimestamp) {
    this.sender = sender;
    this.config = config;
    this.configPath = configPath;
    this.defaultTimestamp = defaultTimestamp;

    // File and line tracking
    this.loadedFile = null;
    this.lines = [];
    this.currentLine = 0;

    // History tracking
    this.sentHistory = [];
    this.maxHistory = 10;

    // Batch mode tracking
    this.batchMode = false;
    this.batchCaptions = [];
    this.batchTimeout = 5; // Default 5 seconds
    this.batchTimer = null;

    // UI components
    this.screen = null;
    this.textPreview = null;
    this.historyBox = null;
    this.statusBar = null;
    this.commandBar = null;
    this.inputField = null;

    // Context display settings
    this.prevLines = 2;
    this.nextLines = 5;

    // Route logger output to history box instead of console
    logger.setCallback((message, type) => {
      this.addToHistory(message, type);
    });
  }

  /**
   * Load a text file and initialize line pointer
   */
  loadFile(filepath) {
    try {
      const fullPath = resolve(filepath);
      const content = readFileSync(fullPath, 'utf-8');
      this.lines = content.split('\n');
      this.loadedFile = filepath;
      this.currentLine = 0;

      this.addToHistory(`Loaded file: ${filepath} (${this.lines.length} lines)`, 'info');
      return true;
    } catch (err) {
      this.addToHistory(`Error loading file: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * Get the context lines dynamically based on available box height
   */
  getContextLines() {
    if (!this.textPreview || this.lines.length === 0) {
      return [];
    }

    // Calculate how many lines can fit in the preview box
    // Box height minus: border (2 rows for top/bottom lines)
    const boxHeight = this.textPreview.height;
    const availableLines = Math.max(5, boxHeight - 2);

    // Calculate the window around the current line
    // Try to center the current line, but adjust if near start/end
    let start = Math.max(0, this.currentLine - Math.floor(availableLines / 2));
    let end = Math.min(this.lines.length, start + availableLines);

    // Adjust start if we're near the end
    if (end - start < availableLines && start > 0) {
      start = Math.max(0, end - availableLines);
    }

    const context = [];
    for (let i = start; i < end; i++) {
      const isCurrent = i === this.currentLine;
      context.push({
        lineNum: i + 1,
        text: this.lines[i] || '',
        isCurrent
      });
    }

    return context;
  }

  /**
   * Shift the current line pointer
   */
  shiftPointer(offset) {
    const newLine = this.currentLine + offset;
    if (newLine >= 0 && newLine < this.lines.length) {
      this.currentLine = newLine;
      this.updateTextPreview();
      return true;
    }
    return false;
  }

  /**
   * Go to a specific line number (1-indexed)
   */
  gotoLine(lineNum) {
    const index = lineNum - 1;
    if (index >= 0 && index < this.lines.length) {
      this.currentLine = index;
      this.updateTextPreview();
      return true;
    }
    return false;
  }

  /**
   * Check if a line is sendable (not empty, not a heading)
   */
  isSendableLine(lineIndex) {
    if (lineIndex < 0 || lineIndex >= this.lines.length) {
      return false;
    }
    const line = this.lines[lineIndex].trim();
    return line.length > 0 && !line.startsWith('#');
  }

  /**
   * Find next sendable line starting from current position
   */
  findNextSendableLine() {
    for (let i = this.currentLine; i < this.lines.length; i++) {
      if (this.isSendableLine(i)) {
        return i;
      }
    }
    return -1;  // No sendable line found
  }

  /**
   * Send the current line and advance pointer
   */
  async sendCurrentLine() {
    if (this.lines.length === 0 || this.currentLine >= this.lines.length) {
      this.addToHistory('No line to send', 'warn');
      return;
    }

    // Check if current line is sendable (not empty, not a heading)
    if (!this.isSendableLine(this.currentLine)) {
      const line = this.lines[this.currentLine] || '';

      if (line.trim().length === 0) {
        this.addToHistory('Line at pointer is empty. Moving to next line.', 'warn');
      } else if (line.trim().startsWith('#')) {
        this.addToHistory('Skipping heading line. Moving to next line.', 'info');
      }

      // Just advance to next line (don't skip to sendable or send)
      if (this.currentLine < this.lines.length - 1) {
        this.currentLine++;
        this.updateTextPreview();
      }
      return;
    }

    const text = this.lines[this.currentLine];
    const lineNum = this.currentLine + 1;

    if (this.batchMode) {
      // Add to batch instead of sending immediately
      this.batchCaptions.push({ text, timestamp: this.defaultTimestamp });

      // Start timer on first caption
      if (this.batchCaptions.length === 1 && !this.batchTimer) {
        this.addToHistory(`[Line ${lineNum}] Added to batch (${this.batchCaptions.length} total) - auto-send in ${this.batchTimeout}s`, 'info');
        this.batchTimer = setTimeout(async () => {
          await this.sendBatch();
        }, this.batchTimeout * 1000);
      } else {
        this.addToHistory(`[Line ${lineNum}] Added to batch (${this.batchCaptions.length} total)`, 'info');
      }

      // Advance to next line
      if (this.currentLine < this.lines.length - 1) {
        this.currentLine++;
        this.updateTextPreview();
      }
    } else {
      // Normal mode: send immediately
      try {
        await this.sender.send(text, this.defaultTimestamp);
        this.config.sequence = this.sender.getSequence();

        this.addToHistory(`[Line ${lineNum}] Sent: ${text}`, 'success');

        // Advance to next line
        if (this.currentLine < this.lines.length - 1) {
          this.currentLine++;
          this.updateTextPreview();
        }
      } catch (err) {
        this.addToHistory(`[Line ${lineNum}] Error: ${err.message}`, 'error');
      }
    }

    this.updateStatus();
  }

  /**
   * Send batch of captions
   */
  async sendBatch() {
    if (this.batchCaptions.length === 0) {
      this.addToHistory('No captions in batch to send', 'warn');
      return;
    }

    try {
      await this.sender.sendBatch(this.batchCaptions);
      this.config.sequence = this.sender.getSequence();
      this.addToHistory(`Batch sent: ${this.batchCaptions.length} captions`, 'success');
    } catch (err) {
      this.addToHistory(`Batch error: ${err.message}`, 'error');
    }

    // Clear batch state
    this.batchCaptions = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.updateStatus();
  }

  /**
   * Send a custom caption (doesn't move file pointer)
   */
  async sendCustomCaption(text) {
    if (!text || text.trim() === '') {
      this.addToHistory('Empty caption not sent', 'warn');
      return;
    }

    const trimmedText = text.trim();

    if (this.batchMode) {
      // Add to batch instead of sending immediately
      this.batchCaptions.push({ text: trimmedText, timestamp: this.defaultTimestamp });

      // Start timer on first caption
      if (this.batchCaptions.length === 1 && !this.batchTimer) {
        this.addToHistory(`[Custom] Added to batch (${this.batchCaptions.length} total) - auto-send in ${this.batchTimeout}s`, 'info');
        this.batchTimer = setTimeout(async () => {
          await this.sendBatch();
        }, this.batchTimeout * 1000);
      } else {
        this.addToHistory(`[Custom] Added to batch (${this.batchCaptions.length} total)`, 'info');
      }
    } else {
      // Normal mode: send immediately
      try {
        await this.sender.send(trimmedText, this.defaultTimestamp);
        this.config.sequence = this.sender.getSequence();
        this.addToHistory(`[Custom] Sent: ${trimmedText}`, 'success');
      } catch (err) {
        this.addToHistory(`[Custom] Error: ${err.message}`, 'error');
      }
    }

    this.updateStatus();
  }

  /**
   * Add entry to sent history
   */
  addToHistory(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.sentHistory.push({ timestamp, message, type });

    // Keep only last N entries
    if (this.sentHistory.length > this.maxHistory) {
      this.sentHistory.shift();
    }

    if (this.historyBox) {
      this.updateHistory();
    }
  }

  /**
   * Initialize blessed screen and widgets
   */
  initScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'LCYT Interactive Mode'
    });

    // Title bar
    const title = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' LCYT Interactive Fullscreen Mode',
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });

    // Text preview box
    this.textPreview = blessed.box({
      top: 1,
      left: 0,
      width: '100%',
      height: '55%',
      label: ' Text Preview ',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      tags: true
    });

    // History box - fills remaining space between preview and input
    // bottom: 5 leaves a 1-row gap to avoid double-border with input box
    this.historyBox = blessed.box({
      top: '55%',
      left: 0,
      width: '100%',
      bottom: 5,  // Leave room for gap (1) + input (3) + status bar (1)
      label: ' Sent History ',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        },
        label: {
          fg: 'green'
        }
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      tags: true
    });

    // Input field for commands and captions
    this.inputField = blessed.textbox({
      bottom: 1,
      left: 0,
      width: '100%',
      height: 3,
      label: ' Input (/ for commands) ',
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',  // White text for visibility
        border: {
          fg: 'red'
        },
        focus: {
          fg: 'white',
          border: {
            fg: 'red'
          }
        }
      },
      inputOnFocus: true,
      keys: true,
      mouse: true,
      vi: false  // Don't use vi mode to avoid j/k being captured
    });

    // Keep commandBar for backward compatibility (not appended)
    this.commandBar = null;

    // Status bar
    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' Ready',
      style: {
        fg: 'white',
        bg: 'blue'
      }
    });

    // Add all widgets to screen
    this.screen.append(title);
    this.screen.append(this.textPreview);
    this.screen.append(this.historyBox);
    this.screen.append(this.inputField);
    this.screen.append(this.statusBar);

    // Set up key bindings
    this.setupKeyBindings();

    // Initial render
    this.screen.render();
  }

  /**
   * Update text preview display
   */
  updateTextPreview() {
    if (!this.textPreview) return;

    let content = '';

    if (this.lines.length === 0) {
      content = '\n  No file loaded. Use /load <filepath> to load a text file.';
      this.textPreview.setLabel(' Text Preview ');
    } else {
      const context = this.getContextLines();
      const fileName = this.loadedFile ? basename(this.loadedFile) : 'unknown';

      // Update label with filename and line position
      this.textPreview.setLabel(` Text Preview - File: ${fileName} | Line ${this.currentLine + 1}/${this.lines.length} `);

      for (const line of context) {
        const prefix = line.isCurrent ? '{green-fg}{bold}►{/bold}{/green-fg}' : ' ';
        const numPadded = String(line.lineNum).padStart(4, ' ');

        // Check if line is a heading
        const isHeading = line.text.trim().startsWith('#');

        let lineStyle = '';
        let lineStyleEnd = '';

        if (line.isCurrent) {
          // Current line gets highest priority styling
          lineStyle = '{black-bg}{white-fg}{bold}';
          lineStyleEnd = '{/bold}{/white-fg}{/black-bg}';
        } else if (isHeading) {
          // Headings shown in bold blue
          lineStyle = '{blue-fg}{bold}';
          lineStyleEnd = '{/bold}{/blue-fg}';
        }

        content += `  ${prefix} ${lineStyle}${numPadded}│ ${line.text}${lineStyleEnd}\n`;
      }
    }

    this.textPreview.setContent(content);
    this.screen.render();
  }

  /**
   * Update history display
   */
  updateHistory() {
    if (!this.historyBox) return;

    let content = '\n';

    if (this.sentHistory.length === 0) {
      content += '  No history yet.';
    } else {
      for (const entry of this.sentHistory) {
        let color = 'white';
        let symbol = '·';

        switch (entry.type) {
          case 'success':
            color = 'green';
            symbol = '✓';
            break;
          case 'error':
            color = 'red';
            symbol = '✗';
            break;
          case 'warn':
            color = 'yellow';
            symbol = '!';
            break;
          case 'info':
            color = 'cyan';
            symbol = 'ℹ';
            break;
        }

        content += `  {${color}-fg}${symbol}{/${color}-fg} [{gray-fg}${entry.timestamp}{/gray-fg}] ${entry.message}\n`;
      }
    }

    this.historyBox.setContent(content);
    this.historyBox.scrollTo(this.sentHistory.length);
    this.screen.render();
  }

  /**
   * Update status bar
   */
  updateStatus(message = 'Ready') {
    if (!this.statusBar) return;

    const seq = this.sender.getSequence();
    let status = ` ${message} | Seq: ${seq}`;

    if (this.batchMode) {
      status += ` | BATCH MODE (${this.batchCaptions.length} queued, ${this.batchTimeout}s)`;
    }

    this.statusBar.setContent(status);
    this.screen.render();
  }

  /**
   * Set up keyboard bindings
   */
  setupKeyBindings() {
    // IMPORTANT: Input field has keys:true and captures all events when focused
    // We must bind navigation keys directly to the input field, not the screen

    // Navigation - bind to input field since it's always focused
    this.inputField.key(['up', 'k'], () => {
      this.shiftPointer(-1);
    });

    this.inputField.key(['down', 'j'], () => {
      this.shiftPointer(1);
    });

    this.inputField.key(['pageup'], () => {
      this.shiftPointer(-10);
    });

    this.inputField.key(['pagedown'], () => {
      this.shiftPointer(10);
    });

    // Help
    this.inputField.key(['h'], () => {
      this.showHelp();
    });

    // Quit
    this.inputField.key(['q'], () => {
      this.cleanup();
      process.exit(0);
    });

    // Focus switching with Tab
    this.inputField.key(['tab'], () => {
      if (this.screen.focused === this.inputField) {
        this.textPreview.focus();
      } else {
        this.inputField.focus();
      }
      this.screen.render();
    });

    // Handle input field submission
    this.inputField.key(['enter'], async () => {
      const value = this.inputField.getValue().trim();

      // Clear input field first
      this.inputField.clearValue();

      if (!value) {
        // Empty input: send current file line and advance (backward compatibility)
        await this.sendCurrentLine();
        this.inputField.focus();
        this.screen.render();
        return;
      }

      // Check for +N/-N pattern (with or without / prefix)
      const shiftMatch = value.match(/^\/?([+-])(\d+)$/);
      if (shiftMatch) {
        // Route as command (handleCommand expects no / for +/-)
        const cmd = shiftMatch[1] + shiftMatch[2];  // e.g., "+5" or "-3"
        await this.handleCommand(cmd);
      } else if (value.startsWith('/')) {
        // Command: route to handler
        await this.handleCommand(value);
      } else {
        // Plain text: send as caption
        await this.sendCustomCaption(value);
      }

      // Re-focus input field to maintain cursor
      this.inputField.focus();
      this.screen.render();
    });

    // Handle Ctrl+C in input field (prevents widget from capturing it)
    this.inputField.key(['C-c'], () => {
      this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Handle command input
   */
  async handleCommand(cmd) {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case '/load':
      case 'load':
        if (args.length === 0) {
          this.addToHistory('Usage: /load <filepath> [linenumber]', 'warn');
        } else {
          // Check if last argument is a line number
          const lastArg = args[args.length - 1];
          const lineNum = parseInt(lastArg, 10);

          if (!isNaN(lineNum) && args.length > 1) {
            // Last arg is a valid number, treat it as line number
            const filepath = args.slice(0, -1).join(' ');
            if (this.loadFile(filepath)) {
              if (this.gotoLine(lineNum)) {
                this.addToHistory(`Jumped to line ${lineNum}`, 'info');
              } else {
                this.addToHistory(`Invalid line number: ${lineNum}`, 'warn');
              }
            }
          } else {
            // No line number, load file normally
            this.loadFile(args.join(' '));
          }
          this.updateTextPreview();
        }
        break;

      case '/reload':
      case 'reload':
        if (this.loadedFile) {
          this.loadFile(this.loadedFile);
          this.updateTextPreview();
        } else {
          this.addToHistory('No file loaded', 'warn');
        }
        break;

      case '/goto':
      case 'goto':
        if (args.length === 0) {
          this.addToHistory('Usage: /goto <line_number>', 'warn');
        } else {
          const lineNum = parseInt(args[0], 10);
          if (!isNaN(lineNum)) {
            if (this.gotoLine(lineNum)) {
              this.addToHistory(`Jumped to line ${lineNum}`, 'info');
            } else {
              this.addToHistory(`Invalid line number: ${lineNum}`, 'warn');
            }
          }
        }
        break;

      case '/batch':
      case 'batch':
        // Parse optional timeout parameter
        if (args.length > 0) {
          const seconds = parseInt(args[0], 10);
          if (!isNaN(seconds) && seconds > 0) {
            this.batchTimeout = seconds;
          }
        }

        this.batchMode = !this.batchMode;

        if (this.batchMode) {
          this.batchCaptions = [];
          if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
          }
          this.addToHistory(`Batch mode ON. Auto-send after ${this.batchTimeout}s from first caption.`, 'info');
        } else {
          // Turning off batch mode
          if (this.batchCaptions.length > 0) {
            await this.sendBatch();
          }
          this.addToHistory('Batch mode OFF', 'info');
        }
        this.updateStatus();
        break;

      case '/send':
      case 'send':
        if (this.batchCaptions.length === 0) {
          this.addToHistory('No captions in batch to send', 'warn');
        } else {
          await this.sendBatch();
        }
        break;

      case '/status':
      case 'status':
        const totalLines = this.lines.length;
        const current = this.currentLine + 1;
        const file = this.loadedFile || 'none';
        let statusMsg = `File: ${file} | Line: ${current}/${totalLines} | Seq: ${this.sender.getSequence()}`;
        if (this.batchMode) {
          statusMsg += ` | Batch: ON (${this.batchCaptions.length} queued, ${this.batchTimeout}s timeout)`;
        }
        this.addToHistory(statusMsg, 'info');
        break;

      case '/heartbeat':
      case 'heartbeat':
        try {
          const result = await this.sender.heartbeat();
          if (result.serverTimestamp) {
            this.addToHistory(`Heartbeat OK - Server time: ${result.serverTimestamp}`, 'success');
          } else {
            this.addToHistory('Heartbeat OK', 'success');
          }
        } catch (err) {
          this.addToHistory(`Heartbeat failed: ${err.message}`, 'error');
        }
        break;

      case '/help':
      case 'help':
      case '/?':
      case '?':
        this.showHelp();
        break;

      case '/quit':
      case 'quit':
      case '/exit':
      case 'exit':
        this.cleanup();
        process.exit(0);

      default:
        // Check for +N or -N patterns
        const shiftMatch = cmd.match(/^([+-])(\d+)$/);
        if (shiftMatch) {
          const direction = shiftMatch[1] === '+' ? 1 : -1;
          const amount = parseInt(shiftMatch[2], 10);
          const offset = direction * amount;

          if (this.shiftPointer(offset)) {
            this.addToHistory(`Shifted pointer by ${offset}`, 'info');
          } else {
            this.addToHistory('Cannot shift pointer out of bounds', 'warn');
          }
        } else {
          this.addToHistory(`Unknown command: ${cmd}`, 'warn');
        }
    }
  }

  /**
   * Show help dialog
   */
  showHelp() {
    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: 'line',
      label: ' Help ',
      tags: true,
      keys: true,
      vi: true,
      scrollable: true,
      content: `
  {bold}LCYT Interactive Mode - Keyboard Commands{/bold}

  {cyan-fg}Sending Captions:{/cyan-fg}
    Type text in the input field at the bottom
    Press Enter to send
    Text starting with / is a command
    Text without / is sent as a caption
    Empty input + Enter = send current file line and advance
    Empty lines and headings (#) are automatically skipped

  {cyan-fg}Navigation:{/cyan-fg}
    ↑ / k         Move to previous line
    ↓ / j         Move to next line
    PageUp        Move up 10 lines
    PageDown      Move down 10 lines
    Tab           Switch focus between input and preview

  {cyan-fg}Quick Keys:{/cyan-fg}
    h             Show this help
    q or Ctrl+C   Quit

  {cyan-fg}Available Commands (type in input, start with /):{/cyan-fg}
    /help or /?          Show this help screen
    /load <file> [line]  Load a text file, optionally jump to line number
    /reload              Reload the current file
    /goto <N>            Jump to line number N
    /batch [secs]        Toggle batch mode (auto-send after N seconds)
    /send                Send batch immediately
    /status              Show current status
    /heartbeat           Send heartbeat to server
    /quit or /exit       Quit the application
    +N or /+N            Shift pointer forward N lines
    -N or /-N            Shift pointer backward N lines

  {cyan-fg}Examples:{/cyan-fg}
    /load script.txt 42  ← Load file and jump to line 42
    Hello world          ← Send as caption
    /batch 5             ← Enable batch mode with 5s timeout
    +10                  ← Move forward 10 lines

  {cyan-fg}Batch Mode:{/cyan-fg}
    When batch mode is ON, all captions (from input or file lines)
    are added to batch instead of sending immediately. The batch auto-sends
    after the timeout (from first caption). Use /send to send immediately
    or /batch to toggle off.

  {yellow-fg}Press ESC or q to close this help{/yellow-fg}
      `
    });

    helpBox.key(['escape', 'q'], () => {
      helpBox.destroy();
      this.screen.render();
    });

    helpBox.focus();
    this.screen.render();
  }

  /**
   * Start the interactive UI
   */
  async start() {
    this.initScreen();
    this.updateTextPreview();
    this.updateHistory();
    this.updateStatus('Ready');

    this.inputField.focus();
    this.addToHistory('Interactive mode started. Type text or /command. Press h for help.', 'info');
  }

  /**
   * Cleanup and save state
   */
  cleanup() {
    // Restore normal logger output (remove callback)
    logger.setCallback(null);

    // Clear batch timer if active
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.screen) {
      this.screen.destroy();
    }

    // Save config
    saveConfig(this.configPath, this.config);

    this.sender.end();
  }
}
