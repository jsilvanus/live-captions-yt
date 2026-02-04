import blessed from 'blessed';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

    // Context display settings
    this.prevLines = 2;
    this.nextLines = 5;
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
   * Get the context lines (prev + current + next)
   */
  getContextLines() {
    const start = Math.max(0, this.currentLine - this.prevLines);
    const end = Math.min(this.lines.length, this.currentLine + this.nextLines + 1);

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
   * Send the current line and advance pointer
   */
  async sendCurrentLine() {
    if (this.lines.length === 0 || this.currentLine >= this.lines.length) {
      this.addToHistory('No line to send', 'warn');
      return;
    }

    const text = this.lines[this.currentLine];
    const lineNum = this.currentLine + 1;

    if (this.batchMode) {
      // Add to batch instead of sending immediately
      this.batchCaptions.push({ text, timestamp: this.defaultTimestamp });
      this.addToHistory(`[Line ${lineNum}] Added to batch (${this.batchCaptions.length} total)`, 'info');

      // Start timer on first caption
      if (this.batchCaptions.length === 1 && !this.batchTimer) {
        this.addToHistory(`Timer started: batch will send in ${this.batchTimeout}s`, 'info');
        this.batchTimer = setTimeout(async () => {
          await this.sendBatch();
        }, this.batchTimeout * 1000);
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
      content: ' LCYT Interactive Mode',
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
      height: '60%',
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

    // History box
    this.historyBox = blessed.box({
      top: '60%',
      left: 0,
      width: '100%',
      height: '30%',
      label: ' Sent History ',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      tags: true
    });

    // Status/Command bar
    this.commandBar = blessed.box({
      top: '90%',
      left: 0,
      width: '100%',
      height: 3,
      content: ' Commands: Enter=Send+Next | +N/-N=Shift | /load <file> | /goto <N> | q=Quit',
      style: {
        fg: 'white',
        bg: 'black'
      },
      tags: true
    });

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
    this.screen.append(this.commandBar);
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
    } else {
      const context = this.getContextLines();
      const fileName = this.loadedFile || 'unknown';
      content = `\n  File: {cyan-fg}${fileName}{/cyan-fg} | Line: {yellow-fg}${this.currentLine + 1}${/this.lines.length}{/yellow-fg}\n\n`;

      for (const line of context) {
        const prefix = line.isCurrent ? '{green-fg}{bold}►{/bold}{/green-fg}' : ' ';
        const lineStyle = line.isCurrent ? '{black-bg}{white-fg}{bold}' : '';
        const lineStyleEnd = line.isCurrent ? '{/bold}{/white-fg}{/black-bg}' : '';
        const numPadded = String(line.lineNum).padStart(4, ' ');

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
    // Quit
    this.screen.key(['q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });

    // Send current line and advance
    this.screen.key(['enter'], async () => {
      await this.sendCurrentLine();
    });

    // Navigation
    this.screen.key(['up', 'k'], () => {
      this.shiftPointer(-1);
    });

    this.screen.key(['down', 'j'], () => {
      this.shiftPointer(1);
    });

    this.screen.key(['pageup'], () => {
      this.shiftPointer(-10);
    });

    this.screen.key(['pagedown'], () => {
      this.shiftPointer(10);
    });

    // Focus switching
    this.screen.key(['tab'], () => {
      if (this.screen.focused === this.textPreview) {
        this.historyBox.focus();
      } else {
        this.textPreview.focus();
      }
      this.screen.render();
    });

    // Command input
    this.screen.key([':', '/'], () => {
      this.promptCommand();
    });

    // Quick commands
    this.screen.key(['h'], () => {
      this.showHelp();
    });
  }

  /**
   * Prompt for command input
   */
  promptCommand() {
    const prompt = blessed.prompt({
      parent: this.screen,
      top: 'center',
      left: 'center',
      height: 'shrink',
      width: 'shrink',
      border: 'line',
      label: ' Enter Command ',
      tags: true,
      keys: true,
      vi: true
    });

    prompt.input('Command:', '', async (err, value) => {
      if (err || !value) {
        this.screen.render();
        return;
      }

      await this.handleCommand(value.trim());
      this.screen.render();
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
          this.addToHistory('Usage: /load <filepath>', 'warn');
        } else {
          this.loadFile(args.join(' '));
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

  {cyan-fg}Navigation:{/cyan-fg}
    Enter         Send current line and advance to next
    ↑ / k         Move to previous line
    ↓ / j         Move to next line
    PageUp        Move up 10 lines
    PageDown      Move down 10 lines
    Tab           Switch focus between text preview and history

  {cyan-fg}Commands:{/cyan-fg}
    : or /        Open command prompt
    h             Show this help
    q or Ctrl+C   Quit

  {cyan-fg}Available Commands (type : or / first):{/cyan-fg}
    /load <file>     Load a text file
    /reload          Reload the current file
    /goto <N>        Jump to line number N
    /batch [secs]    Toggle batch mode (auto-send after N seconds, default 5)
    /send            Send batch immediately
    /status          Show current status
    /heartbeat       Send heartbeat to server
    +N               Shift pointer forward N lines
    -N               Shift pointer backward N lines

  {cyan-fg}Batch Mode:{/cyan-fg}
    When batch mode is ON, pressing Enter adds lines to batch instead of
    sending immediately. The batch auto-sends after the timeout (from first
    caption). Use /send to send immediately or /batch to toggle off.

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

    this.textPreview.focus();
    this.addToHistory('Interactive mode started. Press h for help.', 'info');
  }

  /**
   * Cleanup and save state
   */
  cleanup() {
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
