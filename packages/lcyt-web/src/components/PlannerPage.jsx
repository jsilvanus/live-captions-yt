import { useState, useRef, useEffect, useCallback, useContext } from 'react';
import { useFileContext } from '../contexts/FileContext';
import { useToastContext } from '../contexts/ToastContext';
import { uid, serializePlan, deserializePlan } from '../lib/plannerUtils.js';
import { NormalizeLinesModal, normalizeLines } from './NormalizeLinesModal';
import { SessionContext } from '../contexts/SessionContext';
export { serializePlan, deserializePlan } from '../lib/plannerUtils.js';

function makeBlock(type) {
  switch (type) {
    case 'caption':     return { id: uid(), type: 'caption',    text: '' };
    case 'heading':     return { id: uid(), type: 'heading',    text: '' };
    case 'audio-start': return { id: uid(), type: 'audio-start' };
    case 'audio-stop':  return { id: uid(), type: 'audio-stop' };
    case 'graphics':    return { id: uid(), type: 'graphics',   value: '' };
    case 'codes':       return { id: uid(), type: 'codes',      codes: {} };
    case 'stanza':      return { id: uid(), type: 'stanza',     lines: [''] };
    case 'empty-send':  return { id: uid(), type: 'empty-send', label: '' };
    default:            return { id: uid(), type: 'caption',    text: '' };
  }
}

// ─── Block type metadata ──────────────────────────────────────────────────────

const BLOCK_TYPES = [
  { type: 'caption',     icon: '✏️', label: 'Caption' },
  { type: 'heading',     icon: '#',  label: 'Heading' },
  { type: 'audio-start', icon: '🎙', label: 'Audio On' },
  { type: 'audio-stop',  icon: '⏹', label: 'Audio Off' },
  { type: 'graphics',    icon: '🎨', label: 'Graphics' },
  { type: 'codes',       icon: '🏷', label: 'Codes row' },
  { type: 'stanza',      icon: '♪',  label: 'Stanza' },
  { type: 'empty-send',  icon: '—',  label: 'Empty send' },
];

const CODE_CHIP_CLASS = { section: 'planner-chip--section', speaker: 'planner-chip--speaker', lang: 'planner-chip--lang', stanza: 'planner-chip--stanza' };
const CODE_ICON = { section: '📖', speaker: '👤', lang: '🌐', stanza: '♪', 'no-translate': '🚫', lyrics: '🎵' };

// ─── Block sub-components ─────────────────────────────────────────────────────

function CaptionBlock({ block, onUpdate, onDelete }) {
  const [value, setValue] = useState(block.text ?? '');

  return (
    <div className="planner-caption-row">
      <input
        className="planner-caption-input"
        type="text"
        value={value}
        placeholder="Caption text…"
        onChange={e => setValue(e.target.value)}
        onBlur={() => onUpdate({ text: value })}
        onKeyDown={e => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && !value) onDelete();
        }}
      />
      <button className="planner-chip__delete" onClick={onDelete} title="Remove" aria-label="Remove">×</button>
    </div>
  );
}

function AudioBlock({ type, onDelete }) {
  return (
    <div className={`planner-chip planner-chip--audio-${type}`}>
      {type === 'start' ? '🎙 Audio On' : '⏹ Audio Off'}
      <button className="planner-chip__delete" onClick={onDelete} title="Remove" aria-label="Remove">×</button>
    </div>
  );
}

function GraphicsBlock({ block, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(block.value ?? '');

  function commit() { onUpdate({ value }); setEditing(false); }

  if (editing) {
    return (
      <div className="planner-chip planner-chip--graphics planner-chip--editing">
        <span className="planner-chip__key">🎨 Graphics:</span>
        <input
          autoFocus
          className="planner-chip-input"
          value={value}
          placeholder="template1, template2"
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setValue(block.value ?? ''); setEditing(false); }
          }}
        />
        <button className="planner-chip__delete" onClick={e => { e.stopPropagation(); onDelete(); }} title="Remove" aria-label="Remove">×</button>
      </div>
    );
  }

  return (
    <div className="planner-chip planner-chip--graphics" role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={e => e.key === 'Enter' && setEditing(true)}>
      🎨 Graphics: {value || <em className="planner-placeholder">click to set</em>}
      <button className="planner-chip__delete" onClick={e => { e.stopPropagation(); onDelete(); }} title="Remove" aria-label="Remove">×</button>
    </div>
  );
}

function CodesBlock({ block, onUpdate, onDelete }) {
  const [editingKey, setEditingKey] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const codes = block.codes ?? {};

  function setCode(key, value) {
    const next = { ...codes };
    if (value === '') delete next[key];
    else next[key] = value;
    onUpdate({ codes: next });
  }

  function addCode() {
    const k = newKey.trim().toLowerCase();
    if (!k) return;
    setCode(k, newVal.trim() || 'true');
    setNewKey(''); setNewVal(''); setShowAddForm(false);
  }

  const entries = Object.entries(codes);

  return (
    <div className="planner-codes-row">
      {entries.map(([k, v]) => {
        const cls = CODE_CHIP_CLASS[k] ?? 'planner-chip--custom';
        if (editingKey === k) {
          return (
            <div key={k} className={`planner-chip ${cls} planner-chip--editing`}>
              <span className="planner-chip__key">{CODE_ICON[k] ?? '🏷'} {k}:</span>
              <input
                autoFocus
                className="planner-chip-input"
                defaultValue={v}
                onBlur={e => { setCode(k, e.target.value); setEditingKey(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setCode(k, e.target.value); setEditingKey(null); }
                  if (e.key === 'Escape') setEditingKey(null);
                  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.value) {
                    setCode(k, ''); setEditingKey(null);
                  }
                }}
              />
            </div>
          );
        }
        return (
          <div key={k} className={`planner-chip ${cls}`} role="button" tabIndex={0} onClick={() => setEditingKey(k)} onKeyDown={e => e.key === 'Enter' && setEditingKey(k)}>
            {CODE_ICON[k] ?? '🏷'} {k}: {v}
            <button className="planner-chip__delete" title="Remove" aria-label={`Remove ${k}`} onClick={e => { e.stopPropagation(); setCode(k, ''); }}>×</button>
          </div>
        );
      })}

      {showAddForm ? (
        <div className="planner-chip planner-chip--add-form">
          <input
            autoFocus
            className="planner-chip-input planner-chip-input--key"
            placeholder="key"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCode(); if (e.key === 'Escape') setShowAddForm(false); }}
          />
          <span className="planner-chip__colon">:</span>
          <input
            className="planner-chip-input planner-chip-input--value"
            placeholder="value"
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCode(); if (e.key === 'Escape') setShowAddForm(false); }}
          />
          <button className="planner-chip__btn" onClick={addCode} title="Confirm" aria-label="Confirm">✓</button>
          <button className="planner-chip__delete" onClick={() => setShowAddForm(false)} title="Cancel" aria-label="Cancel">×</button>
        </div>
      ) : (
        <button className="planner-chip planner-chip--add-btn" onClick={() => setShowAddForm(true)} title="Add code">+</button>
      )}

      {entries.length === 0 && !showAddForm && (
        <button className="planner-chip__delete-row" onClick={onDelete} title="Remove row" aria-label="Remove row">× remove row</button>
      )}
    </div>
  );
}

function StanzaBlock({ block, onUpdate, onDelete }) {
  const lines = block.lines ?? [''];

  function updateLine(idx, value) {
    const next = [...lines];
    next[idx] = value;
    onUpdate({ lines: next });
  }

  function addLine() { onUpdate({ lines: [...lines, ''] }); }

  function removeLine(idx) {
    if (lines.length <= 1) { onDelete(); return; }
    onUpdate({ lines: lines.filter((_, i) => i !== idx) });
  }

  return (
    <div className="planner-stanza">
      <span className="planner-chip planner-chip--stanza planner-stanza__label">♪ Stanza</span>
      <div className="planner-stanza__lines">
        {lines.map((line, idx) => (
          <div key={idx} className="planner-stanza__line">
            <input
              className="planner-caption-input"
              value={line}
              placeholder={`Line ${idx + 1}…`}
              onChange={e => updateLine(idx, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addLine();
                if ((e.key === 'Delete' || e.key === 'Backspace') && !line) removeLine(idx);
              }}
            />
            <button className="planner-chip__delete" onClick={() => removeLine(idx)} title="Remove line" aria-label="Remove line">×</button>
          </div>
        ))}
        <button className="planner-stanza__add-line btn btn--secondary btn--sm" onClick={addLine}>+ line</button>
      </div>
      <button className="planner-chip__delete" onClick={onDelete} title="Remove stanza" aria-label="Remove stanza">×</button>
    </div>
  );
}

function HeadingBlock({ block, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(block.text ?? '');

  function commit() { onUpdate({ text: value }); setEditing(false); }

  return (
    <div className="planner-heading-row">
      <span aria-hidden="true" style={{ color: 'var(--color-accent)', fontWeight: 700, flexShrink: 0 }}>#</span>
      {editing ? (
        <input
          autoFocus
          className="planner-heading-input"
          value={value}
          placeholder="Heading text…"
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setValue(block.text ?? ''); setEditing(false); }
          }}
        />
      ) : (
        <span
          className="planner-heading-text"
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={e => e.key === 'Enter' && setEditing(true)}
        >
          {value || <em className="planner-placeholder">click to set heading</em>}
        </span>
      )}
      <button className="planner-chip__delete" onClick={onDelete} title="Remove" aria-label="Remove">×</button>
    </div>
  );
}

function EmptySendBlock({ block, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(block.label ?? '');

  function commit() { onUpdate({ label }); setEditing(false); }

  return (
    <div className="planner-empty-send-content">
      <span className="planner-empty-send__dash" aria-hidden="true">—</span>
      {editing ? (
        <input
          autoFocus
          className="planner-caption-input"
          placeholder="label (optional)"
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <span
          className={`planner-empty-send__text${block.label ? '' : ' planner-empty-send__text--empty'}`}
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={e => e.key === 'Enter' && setEditing(true)}
        >
          {block.label ? block.label : <em>(sends codes only, no caption)</em>}
        </span>
      )}
      <button className="planner-chip__delete" onClick={onDelete} title="Remove" aria-label="Remove">×</button>
    </div>
  );
}

function BlockContent({ block, onUpdate, onDelete }) {
  switch (block.type) {
    case 'caption':     return <CaptionBlock    block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'heading':     return <HeadingBlock    block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'audio-start': return <AudioBlock      type="start"  onDelete={onDelete} />;
    case 'audio-stop':  return <AudioBlock      type="stop"   onDelete={onDelete} />;
    case 'graphics':    return <GraphicsBlock   block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'codes':       return <CodesBlock      block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'stanza':      return <StanzaBlock     block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'empty-send':  return <EmptySendBlock  block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    default: return null;
  }
}

// ─── Insert menu ──────────────────────────────────────────────────────────────

function InsertMenu({ onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') onClose();
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('keydown', handler);
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  return (
    <div className="planner-insert-menu" ref={ref} role="menu">
      {BLOCK_TYPES.map(({ type, icon, label }) => (
        <button
          key={type}
          className="planner-insert-menu__item"
          role="menuitem"
          onClick={() => onSelect(type)}
        >
          <span aria-hidden="true">{icon}</span> {label}
        </button>
      ))}
    </div>
  );
}

// ─── Planner row ──────────────────────────────────────────────────────────────

function PlannerRow({ block, lineNum, onUpdate, onDelete, onInsertAfter, onDragStart, onDrop }) {
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const rowCls = [
    'planner-row',
    block.type === 'heading'      ? 'planner-row--heading'      : '',
    block.type === 'empty-send'   ? 'planner-row--empty-send'  : '',
    block.type === 'audio-start'  ? 'planner-row--audio-start' : '',
    block.type === 'audio-stop'   ? 'planner-row--audio-stop'  : '',
    isDragOver                    ? 'planner-row--drag-over'   : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rowCls}
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={() => { setIsDragOver(false); onDrop(); }}
    >
      <span className="planner-row__drag" aria-hidden="true">⠿</span>
      <span className="planner-row__linenum" aria-label={lineNum ? `Line ${lineNum}` : undefined}>
        {lineNum ?? ''}
      </span>
      <div className="planner-row__content">
        <BlockContent block={block} onUpdate={onUpdate} onDelete={onDelete} />
      </div>
      <div className="planner-row__insert-wrap">
        <button
          className="planner-insert-btn"
          title="Insert after"
          aria-label="Insert block after this line"
          onClick={() => setShowInsertMenu(v => !v)}
        >
          +
        </button>
        {showInsertMenu && (
          <InsertMenu
            onSelect={type => { onInsertAfter(type); setShowInsertMenu(false); }}
            onClose={() => setShowInsertMenu(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Quick-add caption bar ────────────────────────────────────────────────────

function PlannerQuickAdd({ onAdd }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  function submit() {
    const text = value.trim();
    if (!text) return;
    onAdd(text);
    setValue('');
    inputRef.current?.focus();
  }

  return (
    <div className="planner-quick-add">
      <input
        ref={inputRef}
        className="planner-quick-add__input"
        type="text"
        placeholder="Type a caption and press Enter to add to end…"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
      />
      <button className="btn btn--primary btn--sm" onClick={submit}>Add</button>
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function PlannerToolbar({ filename, editingFilename, dirty, onFilenameChange, onEditingFilename, onNew, onImport, onNormalize, onExport, onToDashboard, onInsert }) {
  return (
    <div className="planner-toolbar">
      <div className="planner-toolbar__top">
        <div className="planner-toolbar__file">
          {editingFilename ? (
            <input
              autoFocus
              className="planner-filename-input"
              value={filename}
              onChange={e => onFilenameChange(e.target.value)}
              onBlur={() => onEditingFilename(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onEditingFilename(false); }}
              aria-label="File name"
            />
          ) : (
            <button
              className="planner-filename-btn"
              onClick={() => onEditingFilename(true)}
              title="Click to rename"
              aria-label={`File name: ${filename}. Click to rename.`}
            >
              {filename}{dirty ? ' *' : ''}
            </button>
          )}
        </div>
        <div className="planner-toolbar__actions">
          <button className="btn btn--secondary btn--sm" onClick={onNew}>New</button>
          <button className="btn btn--secondary btn--sm" onClick={onImport}>Import</button>
          <button className="btn btn--secondary btn--sm" onClick={onNormalize}>Normalize</button>
          <button className="btn btn--secondary btn--sm" onClick={onExport}>Export .md</button>
          <button className="btn btn--primary btn--sm" onClick={onToDashboard}>→ Dashboard</button>
        </div>
      </div>
      <div className="planner-insert-bar" role="toolbar" aria-label="Insert block">
        <span className="planner-insert-bar__label">Insert:</span>
        {BLOCK_TYPES.map(({ type, icon, label }) => (
          <button
            key={type}
            className="btn btn--secondary btn--sm planner-insert-bar__btn"
            onClick={() => onInsert(type)}
            title={`Insert ${label}`}
          >
            <span aria-hidden="true">{icon}</span> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PLANNER_DRAFT_KEY = 'lcyt:planner-draft';
const PLANNER_FILENAME_KEY = 'lcyt:planner-filename';
const PLANNER_WIDTH_KEY = 'lcyt:planner-width';

function usePlannerResize() {
  const [editorWidth, setEditorWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem(PLANNER_WIDTH_KEY)); return v > 200 ? v : null; } catch { return null; }
  });
  const editorRef = useRef(null);

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = editorRef.current ? editorRef.current.offsetWidth : 600;
    function onMove(e) {
      const newWidth = Math.max(280, startWidth + (e.clientX - startX));
      setEditorWidth(newWidth);
      try { localStorage.setItem(PLANNER_WIDTH_KEY, String(newWidth)); } catch {}
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  return { editorWidth, editorRef, startResize };
}

export function PlannerPage() {
  const fileStore = useFileContext();
  const { showToast } = useToastContext();
  const { editorWidth, editorRef, startResize } = usePlannerResize();

  const session = useContext(SessionContext);
  const backendUrl = (session?.backendUrl || '').replace(/\/$/, '');
  const sessionToken = session?.getSessionToken?.();

  const [aiAssistOpen, setAiAssistOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiTemplateId, setAiTemplateId] = useState('');

  const [blocks, setBlocks] = useState(() => {
    try {
      const saved = localStorage.getItem(PLANNER_DRAFT_KEY);
      if (saved) return deserializePlan(saved);
    } catch {}
    return [];
  });
  const [filename, setFilename] = useState(() => {
    try { return localStorage.getItem(PLANNER_FILENAME_KEY) || 'my-event.md'; } catch { return 'my-event.md'; }
  });
  const [editingFilename, setEditingFilename] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showNormalizeModal, setShowNormalizeModal] = useState(false);

  const RUNDOWN_TEMPLATES = [
    { id: '', label: 'Custom (no template)' },
    { id: 'church_service', label: '⛪ Church service' },
    { id: 'concert', label: '🎵 Concert' },
    { id: 'conference', label: '🏛 Conference' },
    { id: 'sports', label: '🏆 Sports event' },
  ];

  const saveTimer = useRef(null);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(PLANNER_DRAFT_KEY, serializePlan(blocks)); } catch {}
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [blocks]);

  useEffect(() => {
    try { localStorage.setItem(PLANNER_FILENAME_KEY, filename); } catch {}
  }, [filename]);

  function updateBlock(id, patch) {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
    setDirty(true);
  }

  function deleteBlock(id) {
    setBlocks(prev => prev.filter(b => b.id !== id));
    setDirty(true);
  }

  function insertBlock(afterId, newBlock) {
    setBlocks(prev => {
      if (afterId == null) return [...prev, newBlock];
      const idx = prev.findIndex(b => b.id === afterId);
      const arr = [...prev];
      arr.splice(idx + 1, 0, newBlock);
      return arr;
    });
    setDirty(true);
  }

  function handleNew() {
    if (dirty && blocks.length > 0 && !window.confirm('Discard current plan?')) return;
    setBlocks([]);
    setFilename('my-event.md');
    setDirty(false);
    try { localStorage.removeItem(PLANNER_DRAFT_KEY); } catch {}
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,text/plain,text/markdown';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        setBlocks(deserializePlan(text));
        const name = /\.(md|txt)$/i.test(file.name)
          ? file.name.replace(/\.txt$/i, '.md')
          : file.name + '.md';
        setFilename(name);
        setDirty(false);
        showToast(`Imported: ${file.name}`, 'success');
      } catch {
        showToast('Failed to read file', 'error');
      }
    };
    input.click();
  }

  function handleExport() {
    const text = serializePlan(blocks);
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = /\.md$/i.test(filename) ? filename : filename + '.md';
    a.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    showToast('Exported!', 'success');
  }

  function handleToDashboard() {
    const text = serializePlan(blocks);
    const fname = /\.md$/i.test(filename) ? filename : filename + '.md';
    const file = new File([text], fname, { type: 'text/plain' });
    fileStore.loadFile(file);
    showToast(`"${fname}" loaded into Dashboard`, 'success');
  }

  function handleQuickAdd(text) {
    insertBlock(null, { ...makeBlock('caption'), text });
  }

  function handleNormalizeConfirm(normalizedLines) {
    const text = normalizedLines.join('\n');
    setBlocks(deserializePlan(text));
    setDirty(true);
    setShowNormalizeModal(false);
  }

  // Drag-and-drop reorder
  const dragSrcId = useRef(null);

  function onDragStart(id) { dragSrcId.current = id; }
  function onDrop(targetId) {
    const srcId = dragSrcId.current;
    dragSrcId.current = null;
    if (!srcId || srcId === targetId) return;
    setBlocks(prev => {
      const src = prev.findIndex(b => b.id === srcId);
      const tgt = prev.findIndex(b => b.id === targetId);
      if (src === -1 || tgt === -1) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(src, 1);
      arr.splice(tgt, 0, moved);
      return arr;
    });
    setDirty(true);
  }

  // ── AI Assist helpers ──
  async function handleAiGenerate() {
    if (!aiPrompt.trim() || aiLoading || !backendUrl || !sessionToken) return;
    setAiLoading(true); setAiError('');
    try {
      const body = { prompt: aiPrompt.trim() };
      if (aiTemplateId) body.templateId = aiTemplateId;
      const res = await fetch(`${backendUrl}/agent/generate-rundown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      if (typeof data.content === 'string' && data.content.trim()) {
        if (dirty && blocks.length > 0 && !window.confirm('Replace current plan with AI-generated rundown?')) return;
        setBlocks(deserializePlan(data.content));
        setFilename(aiPrompt.trim().slice(0, 40).replace(/[^a-zA-Z0-9 _-]/g, '') + '.md');
        setDirty(true);
        setAiPrompt('');
      }
    } catch (err) { setAiError(err.message); }
    finally { setAiLoading(false); }
  }

  async function handleAiEdit() {
    if (!aiPrompt.trim() || aiLoading || !backendUrl || !sessionToken) return;
    setAiLoading(true); setAiError('');
    try {
      const content = serializePlan(blocks);
      const res = await fetch(`${backendUrl}/agent/edit-rundown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify({ content, prompt: aiPrompt.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      if (typeof data.content === 'string') {
        setBlocks(deserializePlan(data.content));
        setDirty(true);
        setAiPrompt('');
      }
    } catch (err) { setAiError(err.message); }
    finally { setAiLoading(false); }
  }

  // Line number counter (only caption + empty-send blocks get numbers)
  let lineNum = 0;

  return (
    <div className="planner-page">
      <PlannerToolbar
        filename={filename}
        editingFilename={editingFilename}
        dirty={dirty}
        onFilenameChange={setFilename}
        onEditingFilename={setEditingFilename}
        onNew={handleNew}
        onImport={handleImport}
        onNormalize={() => setShowNormalizeModal(true)}
        onExport={handleExport}
        onToDashboard={handleToDashboard}
        onInsert={type => {
          insertBlock(null, makeBlock(type));
        }}
      />
      {showNormalizeModal && (
        <NormalizeLinesModal
          fileName={filename}
          rawLines={serializePlan(blocks).split('\n')}
          onConfirm={handleNormalizeConfirm}
          onSkip={() => setShowNormalizeModal(false)}
        />
      )}
      <div className="planner-body">
        {/* AI Assist panel */}
        <div className="planner-ai-assist">
          <button
            className={`planner-ai-assist__toggle btn btn--secondary btn--sm${aiAssistOpen ? ' active' : ''}`}
            onClick={() => setAiAssistOpen(v => !v)}
            title="AI-assisted rundown generation"
          >
            ✨ AI Assist {aiAssistOpen ? '▲' : '▼'}
          </button>
          {aiAssistOpen && (
            <div className="planner-ai-assist__panel">
              {!sessionToken && (
                <p className="planner-ai-assist__note">Connect to a backend with AI configured to use AI Assist.</p>
              )}
              <div className="planner-ai-assist__row">
                <select
                  className="planner-ai-assist__select"
                  value={aiTemplateId}
                  onChange={e => setAiTemplateId(e.target.value)}
                  disabled={aiLoading || !sessionToken}
                  aria-label="Rundown template"
                >
                  {RUNDOWN_TEMPLATES.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="planner-ai-assist__row">
                <textarea
                  className="planner-ai-assist__input"
                  rows={2}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Describe the event or the edit to make…"
                  disabled={aiLoading || !sessionToken}
                />
              </div>
              <div className="planner-ai-assist__row planner-ai-assist__row--buttons">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={handleAiGenerate}
                  disabled={aiLoading || !aiPrompt.trim() || !sessionToken}
                  title="Generate a new rundown from the prompt"
                >
                  {aiLoading ? '…' : 'Generate'}
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={handleAiEdit}
                  disabled={aiLoading || !aiPrompt.trim() || !sessionToken || blocks.length === 0}
                  title="Edit the current rundown based on the prompt"
                >
                  {aiLoading ? '…' : 'Edit'}
                </button>
              </div>
              {aiError && <p className="planner-ai-assist__error">{aiError}</p>}
            </div>
          )}
        </div>

        <div
          className="planner-editor"
          ref={editorRef}
          style={editorWidth ? { width: editorWidth, flexShrink: 0 } : {}}
        >
          {blocks.length === 0 && (
            <div className="planner-empty-state">
              <div className="planner-empty-state__icon" aria-hidden="true">📋</div>
              <p className="planner-empty-state__text">No script yet.<br />Use the Insert buttons above to add lines, or Import a file.</p>
            </div>
          )}
          {blocks.map(block => {
            if (block.type === 'caption' || block.type === 'empty-send') lineNum++;
            const num = (block.type === 'caption' || block.type === 'empty-send') ? lineNum : null;
            return (
              <PlannerRow
                key={block.id}
                block={block}
                lineNum={num}
                onUpdate={patch => updateBlock(block.id, patch)}
                onDelete={() => deleteBlock(block.id)}
                onInsertAfter={type => insertBlock(block.id, makeBlock(type))}
                onDragStart={() => onDragStart(block.id)}
                onDrop={() => onDrop(block.id)}
              />
            );
          })}
          <PlannerQuickAdd onAdd={handleQuickAdd} />
        </div>
        <div
          className="planner-resize-handle"
          onPointerDown={startResize}
          title="Drag to resize editor width"
        />
      </div>
    </div>
  );
}
