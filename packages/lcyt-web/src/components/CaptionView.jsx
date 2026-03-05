import { useRef, useEffect, useState } from 'react';
import { useFileContext } from '../contexts/FileContext';

const VIRTUAL_THRESHOLD = 500;
const VIRTUAL_BUFFER = 50;

/** Tooltip text for the Insert Code button */
const INSERT_CODE_TOOLTIP =
  'Insert a metadata code comment at the cursor line.\n\n' +
  'Codes with special backend functionality:\n' +
  '  • lang — caption / speech language (e.g. fi-FI, en-US)\n' +
  '    Sent as captionLang on every caption that follows.\n' +
  '  • no-translate — prevents translation for lines that follow\n\n' +
  'Other standard codes:\n' +
  '  • section — section / chapter name\n' +
  '  • speaker — speaker name\n' +
  '  • lyrics — marks lines as song lyrics (true/false)\n\n' +
  'You can also use any custom key. Empty value (<!-- key: -->) removes the code.';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a tooltip string from a codes object, or null if no codes. */
function buildCodesTitle(codes) {
  if (!codes || Object.keys(codes).length === 0) return null;
  return Object.entries(codes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');
}

/** Insert `<!-- key: value -->\n` before the line at cursor position. */
function insertCodeAtCursor(textareaEl, rawValue, setRawValue, key, value) {
  const pos = textareaEl ? textareaEl.selectionStart : rawValue.length;
  const lineStart = rawValue.lastIndexOf('\n', pos - 1) + 1; // 0 if first line
  const codeComment = `<!-- ${key}: ${value} -->\n`;
  const newText = rawValue.slice(0, lineStart) + codeComment + rawValue.slice(lineStart);
  setRawValue(newText);
  // Restore cursor after inserted comment
  const newCursor = lineStart + codeComment.length;
  setTimeout(() => {
    if (!textareaEl) return;
    textareaEl.focus();
    textareaEl.setSelectionRange(newCursor, newCursor);
  }, 0);
}

export function CaptionView({ onLineSend }) {
  const { activeFile, setPointer, lastSentLine, setLastSentLine, rawEditMode, setRawEditMode, updateFileFromRawText, rawEditValue, setRawEditValue } = useFileContext();
  const containerRef = useRef(null);
  const textareaRef = useRef(null);

  // Insert-code form state (only relevant in edit mode)
  const [codeFormOpen, setCodeFormOpen] = useState(false);
  const [codeKey, setCodeKey] = useState('');
  const [codeValue, setCodeValue] = useState('');
  const codeKeyRef = useRef(null);

  // When entering edit mode or switching active file in edit mode, populate the editor
  useEffect(() => {
    if (rawEditMode && activeFile) {
      setRawEditValue(activeFile.rawText ?? activeFile.lines.join('\n'));
      setCodeFormOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [rawEditMode, activeFile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the key input when form opens
  useEffect(() => {
    if (codeFormOpen) {
      setTimeout(() => codeKeyRef.current?.focus(), 0);
    }
  }, [codeFormOpen]);

  // Scroll active line into view when pointer changes (only in view mode)
  useEffect(() => {
    if (rawEditMode) return;
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector('.caption-line--active');
    if (activeEl) {
      const elRect = activeEl.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const isVisible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
      if (!isVisible) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });

  // Clear flash animation after 1500ms
  useEffect(() => {
    if (!lastSentLine) return;
    const timer = setTimeout(() => setLastSentLine(null), 1500);
    return () => clearTimeout(timer);
  }, [lastSentLine, setLastSentLine]);

  // ── Insert-code form handlers ────────────────────────────

  function handleInsertCode() {
    const key = codeKey.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!key) {
      setCodeFormOpen(false);
      setCodeKey('');
      setCodeValue('');
      return;
    }
    insertCodeAtCursor(textareaRef.current, rawEditValue, setRawEditValue, key, codeValue.trim());
    setCodeFormOpen(false);
    setCodeKey('');
    setCodeValue('');
  }

  function handleCodeFormKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleInsertCode(); }
    if (e.key === 'Escape') { setCodeFormOpen(false); setCodeKey(''); setCodeValue(''); }
  }

  // ── Raw Edit Mode ───────────────────────────────────────

  if (rawEditMode && activeFile) {
    return (
      <div className="caption-view caption-view--edit" ref={containerRef}>
        <div className="caption-view__edit-toolbar">
          <span className="caption-view__edit-filename">
            ✏ <strong>{activeFile.name}</strong>
          </span>
          <div className="caption-view__edit-actions">
            {codeFormOpen ? (
              <div className="caption-view__code-form">
                <input
                  ref={codeKeyRef}
                  type="text"
                  className="caption-view__code-input"
                  placeholder="key"
                  value={codeKey}
                  onChange={e => setCodeKey(e.target.value)}
                  onKeyDown={handleCodeFormKeyDown}
                  aria-label="Metadata code key"
                />
                <span className="caption-view__code-sep">:</span>
                <input
                  type="text"
                  className="caption-view__code-input caption-view__code-input--val"
                  placeholder="value"
                  value={codeValue}
                  onChange={e => setCodeValue(e.target.value)}
                  onKeyDown={handleCodeFormKeyDown}
                  aria-label="Metadata code value"
                />
                <button
                  className="caption-view__code-insert-btn"
                  onClick={handleInsertCode}
                  title="Insert code (Enter)"
                >✔</button>
                <button
                  className="caption-view__code-cancel-btn"
                  onClick={() => { setCodeFormOpen(false); setCodeKey(''); setCodeValue(''); }}
                  title="Cancel (Esc)"
                >✕</button>
              </div>
            ) : (
              <button
                className="caption-view__add-code-btn"
                title={INSERT_CODE_TOOLTIP}
                onClick={() => setCodeFormOpen(true)}
                aria-label="Insert metadata code comment"
              >
                {'<!-- + code -->'}
              </button>
            )}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className="caption-view__editor"
          value={rawEditValue}
          onChange={e => setRawEditValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    );
  }

  if (!activeFile) {
    return (
      <div className="caption-view" ref={containerRef}>
        <ul className="caption-lines">
          <div className="caption-view__empty">No file loaded. Drop a .txt file to begin.</div>
        </ul>
      </div>
    );
  }

  const { lines, lineCodes, lineNumbers, pointer, id: fileId } = activeFile;

  if (lines.length === 0) {
    return (
      <div className="caption-view" ref={containerRef}>
        <ul className="caption-lines">
          <div className="caption-view__empty">No caption lines found in this file.</div>
        </ul>
      </div>
    );
  }

  const useVirtual = lines.length > VIRTUAL_THRESHOLD;
  const start = useVirtual ? Math.max(0, pointer - VIRTUAL_BUFFER) : 0;
  const end = useVirtual ? Math.min(lines.length, pointer + VIRTUAL_BUFFER + 1) : lines.length;

  const visibleLines = [];
  for (let i = start; i < end; i++) {
    const isActive = i === pointer;
    const isSent = lastSentLine?.fileId === fileId && lastSentLine?.lineIndex === i;
    const isHeading = lines[i].startsWith('#');

    let cls = 'caption-line';
    if (isActive) cls += ' caption-line--active';
    if (isSent) cls += ' caption-line--sent';
    if (isHeading) cls += ' caption-line--heading';

    const displayText = isHeading
      ? escapeHtml(lines[i].replace(/^#+\s*/, ''))
      : escapeHtml(lines[i]);

    const lineNum = lineNumbers?.[i] ?? (i + 1);
    const codes = lineCodes?.[i];
    const codesTitle = buildCodesTitle(codes);
    const hasCodes = !!codesTitle;

    visibleLines.push(
      <li
        key={i}
        className={cls}
        data-index={i}
        onClick={() => setPointer(fileId, i)}
        onDoubleClick={!isHeading ? () => onLineSend?.(lines[i], fileId, i) : undefined}
      >
        <span
          className={`caption-line__linenum${hasCodes ? ' caption-line__linenum--coded' : ''}`}
          title={codesTitle ?? undefined}
          aria-label={codesTitle ? `Line ${lineNum}, codes: ${codesTitle}` : `Line ${lineNum}`}
        >
          {lineNum}
        </span>
        <span className="caption-line__gutter">{isActive ? '►' : ''}</span>
        <span
          className="caption-line__text"
          dangerouslySetInnerHTML={{ __html: displayText }}
        />
      </li>
    );
  }

  const atEof = pointer >= lines.length - 1;

  return (
    <div className="caption-view" ref={containerRef} tabIndex={0} style={{ outline: 'none' }}>
      <ul className="caption-lines">
        {visibleLines}
      </ul>
      {atEof && <div className="caption-view__eof">End of file</div>}
    </div>
  );
}
