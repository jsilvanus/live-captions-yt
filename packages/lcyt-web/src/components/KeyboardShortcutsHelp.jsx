import { useEffect } from 'react';

const SHORTCUT_SECTIONS = [
  {
    title: 'Navigation',
    items: [
      { keys: ['Ctrl', 'K'],       description: 'Open command palette (go to any page)' },
      { keys: ['?'],               description: 'Show keyboard shortcuts (this overlay)' },
    ],
  },
  {
    title: 'Caption file',
    items: [
      { keys: ['↑'],               description: 'Move pointer to previous line' },
      { keys: ['↓'],               description: 'Move pointer to next line (auto-advance)' },
      { keys: ['Page Up'],         description: 'Jump pointer back 10 lines' },
      { keys: ['Page Down'],       description: 'Jump pointer forward 10 lines' },
      { keys: ['Home'],            description: 'Jump to first line' },
      { keys: ['End'],             description: 'Jump to last line' },
      { keys: ['Enter'],           description: 'Send current line (when input is empty)' },
    ],
  },
  {
    title: 'App shortcuts',
    items: [
      { keys: ['Ctrl', ','],       description: 'Open settings' },
      { keys: ['Ctrl', '1–9'],     description: 'Switch to file tab 1–9' },
    ],
  },
  {
    title: 'Input shortcuts',
    items: [
      { keys: ['Ctrl', 'Enter'],   description: 'Send caption from input box' },
      { keys: ['Enter'],           description: 'Send caption (single-line input)' },
    ],
  },
];

/**
 * KeyboardShortcutsHelp — overlay listing all keyboard shortcuts.
 *
 * Triggered by pressing '?' anywhere (when not in a text field) or via
 * the ? button in the topbar. Closes on Escape or backdrop click.
 */
export function KeyboardShortcutsHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="shortcuts-backdrop"
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="shortcuts-dialog__header">
          <h2 className="shortcuts-dialog__title">Keyboard Shortcuts</h2>
          <button
            className="shortcuts-dialog__close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >✕</button>
        </div>

        <div className="shortcuts-dialog__body">
          {SHORTCUT_SECTIONS.map(section => (
            <section key={section.title} className="shortcuts-section">
              <h3 className="shortcuts-section__title">{section.title}</h3>
              <dl className="shortcuts-list">
                {section.items.map((item, i) => (
                  <div key={i} className="shortcuts-row">
                    <dt className="shortcuts-keys">
                      {item.keys.map((k, ki) => (
                        <span key={ki}>
                          {ki > 0 && <span className="shortcuts-plus">+</span>}
                          <kbd className="shortcut-key">{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="shortcuts-desc">{item.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="shortcuts-dialog__footer">
          Press <kbd className="shortcut-key">?</kbd> or <kbd className="shortcut-key">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
