import { useState, useRef, useEffect, useCallback, useContext } from 'react';
import { useFileContext } from '../contexts/FileContext';
import { useToastContext } from '../contexts/ToastContext';
import { usePageThemeOverride } from '../hooks/usePageThemeOverride.js';
import { useProjectRequired } from '../hooks/useProjectRequired.js';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';
import { uid, serializePlan, deserializePlan } from '../lib/plannerUtils.js';
import { NormalizeLinesModal, normalizeLines } from './NormalizeLinesModal';
import { SessionContext } from '../contexts/SessionContext';
import { useAgentChat } from './agent/AgentChatPanel.jsx';
import { PlannerAssistPanel } from './planner/PlannerAssistPanel.jsx';
import { SwipeablePages } from './SwipeablePages.jsx';
import { PlannerBroadcastFilePanel } from './PlannerBroadcastFilePanel.jsx';
export { serializePlan, deserializePlan } from '../lib/plannerUtils.js';

function makeBlock(type) {
  switch (type) {
    case 'caption':      return { id: uid(), type: 'caption',    text: '' };
    case 'heading':      return { id: uid(), type: 'heading',    text: '' };
    case 'audio-start':  return { id: uid(), type: 'audio-start' };
    case 'audio-stop':   return { id: uid(), type: 'audio-stop' };
    case 'graphics':     return { id: uid(), type: 'graphics',   value: '' };
    case 'codes':        return { id: uid(), type: 'codes',      codes: {} };
    case 'stanza':       return { id: uid(), type: 'stanza',     lines: [''] };
    case 'empty-send':   return { id: uid(), type: 'empty-send', label: '' };
    case 'file-include': return { id: uid(), type: 'file-include', src: '' };
    default:             return { id: uid(), type: 'caption',    text: '' };
  }
}

// ─── Block type metadata ──────────────────────────────────────────────────────

const BLOCK_TYPES = [
  { type: 'caption',      icon: '✏️', label: 'Caption' },
  { type: 'heading',      icon: '#',  label: 'Heading' },
  { type: 'audio-start',  icon: '🎙', label: 'Audio On' },
  { type: 'audio-stop',   icon: '⏹', label: 'Audio Off' },
  { type: 'graphics',     icon: '🎨', label: 'Graphics' },
  { type: 'codes',        icon: '🏷', label: 'Codes row' },
  { type: 'stanza',       icon: '♪',  label: 'Stanza' },
  { type: 'empty-send',   icon: '—',  label: 'Empty send' },
  { type: 'file-include', icon: '📎', label: 'Include file' },
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

// Render each nested block of an included file as a single read-only preview
// line — mirrors how the block would look serialized, without exposing a
// full nested editor (the include is a reference, not an embedded copy).
function includePreviewLines(includedBlocks) {
  let n = 0;
  return includedBlocks.map(b => {
    const isText = b.type === 'caption' || b.type === 'empty-send';
    const lnum = isText ? String(++n) : (b.type === 'heading' ? '#' : '·');
    let text = '';
    switch (b.type) {
      case 'caption':      text = b.text; break;
      case 'heading':      text = b.text; break;
      case 'audio-start':  text = '🎙 Audio On'; break;
      case 'audio-stop':   text = '⏹ Audio Off'; break;
      case 'graphics':     text = `🎨 Graphics: ${b.value}`; break;
      case 'codes':        text = Object.entries(b.codes ?? {}).map(([k, v]) => `${k}: ${v}`).join('  ·  '); break;
      case 'stanza':       text = `♪ Stanza (${(b.lines ?? []).length} lines)`; break;
      case 'empty-send':   text = b.label ? `— ${b.label}` : '— (empty send)'; break;
      case 'file-include': text = `📎 include: ${b.src}`; break;
      default:             text = '';
    }
    return { key: `${b.id}`, lnum, text, isHeading: b.type === 'heading', isMeta: b.type !== 'caption' && b.type !== 'heading' };
  });
}

function FileIncludeBlock({ block, onUpdate, onDelete, includedBlocks, onLoad }) {
  const hasContent = !!includedBlocks;
  const lines = hasContent ? includePreviewLines(includedBlocks) : [];
  const lineCount = lines.filter(l => /^\d+$/.test(l.lnum)).length;

  return (
    <div className="planner-include">
      <div className="planner-include__header">
        <span aria-hidden="true">📎</span>
        <input
          className="planner-include__src"
          type="text"
          value={block.src ?? ''}
          onChange={e => onUpdate({ src: e.target.value })}
          placeholder="filename.md"
          title="Source file path"
        />
        {hasContent && (
          <span className="planner-include__count">{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
        )}
        <button className="btn btn--secondary btn--sm" onClick={onLoad}>Load</button>
        <button className="planner-chip__delete" onClick={onDelete} title="Remove" aria-label="Remove">×</button>
      </div>
      {hasContent ? (
        <div className="planner-include__body">
          {lines.map(l => (
            <div key={l.key} className="planner-include__line">
              <span className="planner-include__linenum">{l.lnum}</span>
              <span className={`planner-include__text${l.isHeading ? ' planner-include__text--heading' : l.isMeta ? ' planner-include__text--meta' : ''}`}>
                {l.text}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="planner-include__empty">Click Load to import file contents inline</div>
      )}
    </div>
  );
}

function BlockContent({ block, onUpdate, onDelete, includedBlocks, onLoadInclude }) {
  switch (block.type) {
    case 'caption':      return <CaptionBlock     block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'heading':      return <HeadingBlock     block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'audio-start':  return <AudioBlock       type="start"  onDelete={onDelete} />;
    case 'audio-stop':   return <AudioBlock       type="stop"   onDelete={onDelete} />;
    case 'graphics':     return <GraphicsBlock    block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'codes':        return <CodesBlock       block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'stanza':       return <StanzaBlock      block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'empty-send':   return <EmptySendBlock   block={block} onUpdate={onUpdate} onDelete={onDelete} />;
    case 'file-include': return <FileIncludeBlock block={block} onUpdate={onUpdate} onDelete={onDelete} includedBlocks={includedBlocks} onLoad={onLoadInclude} />;
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

function PlannerRow({ block, lineNum, onUpdate, onDelete, onInsertAfter, onDragStart, onDrop, includedBlocks, onLoadInclude }) {
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
      id={`planner-block-${block.id}`}
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
        <BlockContent block={block} onUpdate={onUpdate} onDelete={onDelete} includedBlocks={includedBlocks} onLoadInclude={onLoadInclude} />
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

// ─── Structure/outline sidebar ────────────────────────────────────────────────

function PlannerOutline({ filename, totalLines, dirty, outline, onJumpTo, onNew, onImport, onExport, isNarrow }) {
  const [showActions, setShowActions] = useState(() => !isNarrow);

  return (
    <aside className="planner-outline">
      <div className="planner-outline__header">
        <div className="planner-outline__brand">
          <span className="planner-outline__brand-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="planner-outline__brand-label">Planner</span>
        </div>
        <div className="planner-outline__filename" title={filename}>{filename}</div>
        <div className="planner-outline__meta">
          <span>{totalLines} line{totalLines !== 1 ? 's' : ''}</span>
          {dirty && <span className="planner-outline__dirty">unsaved</span>}
        </div>
      </div>

      <div className="planner-outline__list">
        <div className="planner-outline__label">Structure</div>
        {outline.length === 0 ? (
          <div className="planner-outline__empty">No headings yet</div>
        ) : (
          outline.map(item => (
            <button key={item.id} className="planner-outline__item" onClick={() => onJumpTo(item.id)}>
              <span className="planner-outline__item-hash" aria-hidden="true">#</span>
              <span className="planner-outline__item-label">{item.label}</span>
            </button>
          ))
        )}
      </div>

      {/* Secondary to the Structure outline above, so it collapses out of
          the way on narrow screens. */}
      <div className="planner-outline__actions-wrap">
        <button className="planner-outline__actions-toggle" onClick={() => setShowActions(v => !v)}>
          <span aria-hidden="true">{showActions ? '▾' : '▸'}</span> File
        </button>
        {showActions && (
          <div className="planner-outline__actions">
            <button className="planner-outline__action" onClick={onImport}>⬆ Import .md</button>
            <button className="planner-outline__action" onClick={onExport}>⬇ Export .md</button>
            <button className="planner-outline__action" onClick={onNew}>＋ New plan</button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function PlannerToolbar({
  filename,
  editingFilename,
  dirty,
  onFilenameChange,
  onEditingFilename,
  onNormalize,
  onToDashboard,
  onInsert,
  projectReady,
  projectSaving,
  projectLoading,
  serverRundowns,
  selectedServerRundownId,
  onSelectedServerRundownChange,
  onSaveToProject,
  onOpenFromProject,
}) {
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
          <button className="btn btn--secondary btn--sm" onClick={onNormalize}>Normalize</button>
          <button className="btn btn--primary btn--sm" onClick={onToDashboard}>→ Dashboard</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <select
          value={selectedServerRundownId || ''}
          onChange={e => onSelectedServerRundownChange(e.target.value)}
          disabled={!projectReady || serverRundowns.length === 0}
          style={{ minWidth: 180, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface-elevated)', color: 'var(--color-text)' }}
          aria-label="Saved project rundowns"
        >
          {serverRundowns.length === 0 ? (
            <option value="">No saved rundowns</option>
          ) : (
            serverRundowns.map(item => (
              <option key={item.id} value={item.id}>{item.displayName || item.filename || `Rundown ${item.id}`}</option>
            ))
          )}
        </select>
        <button className="btn btn--secondary btn--sm" onClick={onOpenFromProject} disabled={!projectReady || !selectedServerRundownId || projectLoading}>
          {projectLoading ? 'Opening…' : 'Open from project'}
        </button>
        <button className="btn btn--primary btn--sm" onClick={onSaveToProject} disabled={!projectReady || !filename.trim() || projectSaving}>
          {projectSaving ? 'Saving…' : 'Save to project'}
        </button>
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

// Below this width the outline sidebar + resizable editor column no longer
// have room to breathe — same breakpoint and reasoning as DskEditorPage.
const NARROW_BREAKPOINT = 860;

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);
  useEffect(() => {
    function onResize() { setIsNarrow(window.innerWidth < NARROW_BREAKPOINT); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isNarrow;
}

export function PlannerPage() {
  useProjectRequired();
  usePageThemeOverride(KEYS.ui.plannerTheme);
  const fileStore = useFileContext();
  const { showToast } = useToastContext();
  const { editorWidth, editorRef, startResize } = usePlannerResize();
  const isNarrow = useIsNarrow();

  const session = useContext(SessionContext);
  const { token: userToken } = useUserAuth();
  const backendUrl = (session?.backendUrl || '').replace(/\/$/, '');
  const sessionToken = session?.getSessionToken?.();

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const { messages: chatMessages, addMessage: addChatMessage } = useAgentChat();

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
  const [serverRundowns, setServerRundowns] = useState([]);
  const [selectedServerRundownId, setSelectedServerRundownId] = useState('');
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  // blockId → parsed blocks from an included file (session-only, not persisted/exported)
  const [includeContents, setIncludeContents] = useState({});

  const RUNDOWN_STARTERS = [
    { id: 'church_service', label: '⛪ Church service', prompt: 'Draft a rundown for a church service' },
    { id: 'concert', label: '🎵 Concert', prompt: 'Draft a rundown for a concert' },
    { id: 'conference', label: '🏛 Conference', prompt: 'Draft a rundown for a conference' },
    { id: 'sports', label: '🏆 Sports event', prompt: 'Draft a rundown for a sports event' },
  ];

  const saveTimer = useRef(null);

  const loadServerRundowns = useCallback(async () => {
    if (!backendUrl || !sessionToken) {
      setServerRundowns([]);
      setSelectedServerRundownId('');
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/file?type=rundown`, {
        headers: { Authorization: 'Bearer ' + sessionToken },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const list = Array.isArray(data.files) ? data.files : [];
      setServerRundowns(list);
      if (list.length === 0) {
        setSelectedServerRundownId('');
      } else if (!list.some(item => String(item.id) === String(selectedServerRundownId))) {
        setSelectedServerRundownId(String(list[0].id));
      }
    } catch {
      setServerRundowns([]);
      setSelectedServerRundownId('');
    }
  }, [backendUrl, sessionToken, selectedServerRundownId]);

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

  useEffect(() => {
    loadServerRundowns();
  }, [loadServerRundowns]);

  function updateBlock(id, patch) {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
    setDirty(true);
  }

  function deleteBlock(id) {
    setBlocks(prev => prev.filter(b => b.id !== id));
    setDirty(true);
    setIncludeContents(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function loadInclude(blockId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,text/plain,text/markdown';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const src = /\.(md|txt)$/i.test(file.name) ? file.name : file.name + '.md';
        updateBlock(blockId, { src });
        setIncludeContents(prev => ({ ...prev, [blockId]: deserializePlan(text) }));
      } catch {
        showToast('Failed to read file', 'error');
      }
    };
    input.click();
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

  function extensionForFormat(format) {
    if (format === 'txt') return '.txt';
    if (format === 'vtt') return '.vtt';
    return '.md';
  }

  function normalizeProjectFilename(name, format = 'md') {
    const trimmed = (name || '').trim();
    const extension = extensionForFormat(format);
    if (!trimmed) return `rundown${extension}`;
    return new RegExp(`${extension.replace('.', '\\.')}$`, 'i').test(trimmed)
      ? trimmed
      : `${trimmed}${extension}`;
  }

  async function handleSaveToProject() {
    if (!backendUrl || !sessionToken) return;
    setProjectSaving(true);
    try {
      const text = serializePlan(blocks);
      const targetName = normalizeProjectFilename(filename, 'md');
      const method = selectedServerRundownId ? 'PUT' : 'POST';
      const url = `${backendUrl}/file${selectedServerRundownId ? `/${selectedServerRundownId}` : ''}`;
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + sessionToken,
        },
        body: JSON.stringify({ filename: targetName, content: text, type: 'rundown', format: 'md' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const item = data.file;
      if (item?.id) {
        setSelectedServerRundownId(String(item.id));
        setServerRundowns(prev => {
          const next = prev.filter(existing => String(existing.id) !== String(item.id));
          return [{ id: item.id, filename: item.filename, displayName: item.displayName || targetName, type: item.type, format: item.format }, ...next];
        });
      }
      setDirty(false);
      showToast(`Saved to project as ${targetName}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save rundown to project', 'error');
    } finally {
      setProjectSaving(false);
    }
  }

  async function handleOpenFromProject() {
    if (!backendUrl || !sessionToken || !selectedServerRundownId) return;
    setProjectLoading(true);
    try {
      const id = Number(selectedServerRundownId);
      const res = await fetch(`${backendUrl}/file/${id}`, {
        headers: { Authorization: 'Bearer ' + sessionToken },
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const selected = serverRundowns.find(item => String(item.id) === String(id)) || null;
      setBlocks(deserializePlan(text));
      setFilename(normalizeProjectFilename(selected?.displayName || selected?.filename || filename));
      setDirty(false);
      showToast('Opened rundown from project', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to open rundown from project', 'error');
    } finally {
      setProjectLoading(false);
    }
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

  // ── AI Assist chat ──
  // An empty plan means "generate a first draft"; anything already on the
  // page means "edit what's there" — this is the same generate/edit split
  // the old two-button form had, just decided automatically from context
  // instead of asking the user to pick.
  async function handleChatSend(text) {
    const trimmedText = text?.trim();
    if (aiLoading || !trimmedText || !backendUrl || !sessionToken) return;
    addChatMessage('user', trimmedText);
    setAiLoading(true); setAiError('');
    try {
      const isNewPlan = blocks.length === 0;
      const body = { goal: trimmedText };
      if (!isNewPlan) body.currentPlan = serializePlan(blocks);

      const res = await fetch(`${backendUrl}/roles/planner/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      if (typeof data.content === 'string' && data.content.trim()) {
        setBlocks(deserializePlan(data.content));
        if (isNewPlan) {
          setFilename(trimmedText.slice(0, 40).replace(/[^a-zA-Z0-9 _-]/g, '') + '.md');
        }
        setDirty(true);
        addChatMessage('assistant', isNewPlan ? 'Generated a first draft — see the editor.' : 'Updated the rundown — see the editor.');
      } else {
        addChatMessage('assistant', "I couldn't generate a rundown from that. Try describing the event in more detail.");
      }
    } catch (err) {
      setAiError(err.message);
      addChatMessage('assistant', err.message || 'Sorry, I could not complete that request.');
    } finally {
      setAiLoading(false);
    }
  }

  // Line number counter (only caption + empty-send blocks get numbers)
  let lineNum = 0;
  let totalLines = 0;
  for (const b of blocks) {
    if (b.type === 'caption' || b.type === 'empty-send') totalLines++;
  }

  const outline = blocks
    .filter(b => b.type === 'heading')
    .map(b => ({ id: b.id, label: b.text || '(untitled)' }));

  function jumpToHeading(blockId) {
    const container = editorRef.current;
    const el = document.getElementById(`planner-block-${blockId}`);
    if (container && el) {
      container.scrollTo({ top: el.offsetTop - container.offsetTop - 20 + container.scrollTop, behavior: 'smooth' });
    }
  }

  const broadcastScopePanel = (
    <div style={{ padding: isNarrow ? 12 : 0 }}>
      <PlannerBroadcastFilePanel backendUrl={backendUrl} token={userToken} projectKey={session?.apiKey} serverRundowns={serverRundowns} />
    </div>
  );

  // Shared with both the desktop and narrow (SwipeablePages) layouts below —
  // PlannerAssistPanel forwards this straight to AgentChatPanel.
  const chatProps = {
    title: 'Planner Assistant',
    subtitle: 'Describe the event to draft a rundown, or describe a change to make to the one you have.',
    messages: chatMessages,
    onSend: handleChatSend,
    loading: aiLoading,
    error: aiError,
    disabled: !sessionToken,
    quickActions: blocks.length === 0 ? RUNDOWN_STARTERS.map(t => ({
      label: t.label,
      onClick: () => handleChatSend(t.prompt),
    })) : undefined,
    isNarrow,
  };

  // On mobile, use swipeable pages for the three main sections
  if (isNarrow) {
    const pages = [
      {
        label: 'Files',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--color-text-muted)', marginBottom: 8 }}>File</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={handleNew} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-text)' }}>New</button>
                <button onClick={handleImport} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-text)' }}>Import</button>
                <button onClick={handleExport} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-text)' }}>Export</button>
              </div>
            </div>
            <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              {broadcastScopePanel}
            </div>
            {/* Structure outline */}
            <PlannerOutline
              filename={filename}
              totalLines={totalLines}
              dirty={dirty}
              outline={outline}
              onJumpTo={jumpToHeading}
              onNew={handleNew}
              onImport={handleImport}
              onExport={handleExport}
              isNarrow={isNarrow}
            />
          </div>
        ),
      },
      {
        label: 'Script',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <PlannerToolbar
              filename={filename}
              editingFilename={editingFilename}
              dirty={dirty}
              onFilenameChange={setFilename}
              onEditingFilename={setEditingFilename}
              onNormalize={() => setShowNormalizeModal(true)}
              onToDashboard={handleToDashboard}
              onInsert={type => {
                insertBlock(null, makeBlock(type));
              }}
              projectReady={Boolean(backendUrl && sessionToken)}
              projectSaving={projectSaving}
              projectLoading={projectLoading}
              serverRundowns={serverRundowns}
              selectedServerRundownId={selectedServerRundownId}
              onSelectedServerRundownChange={setSelectedServerRundownId}
              onSaveToProject={handleSaveToProject}
              onOpenFromProject={handleOpenFromProject}
            />
            {showNormalizeModal && (
              <NormalizeLinesModal
                fileName={filename}
                rawLines={serializePlan(blocks).split('\n')}
                onConfirm={handleNormalizeConfirm}
                onSkip={() => setShowNormalizeModal(false)}
              />
            )}
            <div className="planner-body" style={{ flex: 1 }}>
              <div className="planner-editor" ref={editorRef}>
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
                      includedBlocks={includeContents[block.id]}
                      onLoadInclude={() => loadInclude(block.id)}
                    />
                  );
                })}
                <PlannerQuickAdd onAdd={handleQuickAdd} />
              </div>
            </div>
          </div>
        ),
      },
      {
        label: 'Cues & AI',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <PlannerAssistPanel chatProps={chatProps} />
          </div>
        ),
      },
    ];

    return (
      <SwipeablePages pages={pages} isNarrow={true} />
    );
  }

  // Desktop layout: three columns side-by-side
  return (
    <div className="planner-page">
      <PlannerOutline
        filename={filename}
        totalLines={totalLines}
        dirty={dirty}
        outline={outline}
        onJumpTo={jumpToHeading}
        onNew={handleNew}
        onImport={handleImport}
        onExport={handleExport}
        isNarrow={isNarrow}
      />
      <div className="planner-main">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PlannerToolbar
          filename={filename}
          editingFilename={editingFilename}
          dirty={dirty}
          onFilenameChange={setFilename}
          onEditingFilename={setEditingFilename}
          onNormalize={() => setShowNormalizeModal(true)}
          onToDashboard={handleToDashboard}
          onInsert={type => {
            insertBlock(null, makeBlock(type));
          }}
          projectReady={Boolean(backendUrl && sessionToken)}
          projectSaving={projectSaving}
          projectLoading={projectLoading}
          serverRundowns={serverRundowns}
          selectedServerRundownId={selectedServerRundownId}
          onSelectedServerRundownChange={setSelectedServerRundownId}
          onSaveToProject={handleSaveToProject}
          onOpenFromProject={handleOpenFromProject}
        />
        {broadcastScopePanel}
      </div>
      {showNormalizeModal && (
        <NormalizeLinesModal
          fileName={filename}
          rawLines={serializePlan(blocks).split('\n')}
          onConfirm={handleNormalizeConfirm}
          onSkip={() => setShowNormalizeModal(false)}
        />
      )}
      <div className="planner-body">
        <div
          className="planner-editor"
          ref={editorRef}
          style={editorWidth && !isNarrow ? { width: editorWidth, flexShrink: 0 } : {}}
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
                includedBlocks={includeContents[block.id]}
                onLoadInclude={() => loadInclude(block.id)}
              />
            );
          })}
          <PlannerQuickAdd onAdd={handleQuickAdd} />
        </div>
        {!isNarrow && (
          <div
            className="planner-resize-handle"
            onPointerDown={startResize}
            title="Drag to resize editor width"
          />
        )}
      </div>
      </div>
      <PlannerAssistPanel chatProps={chatProps} />
    </div>
  );
}
