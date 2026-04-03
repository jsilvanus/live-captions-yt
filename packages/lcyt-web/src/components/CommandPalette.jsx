import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { NAV_ITEMS, NAV_GROUPS, NAV_BOTTOM } from './sidebar/navConfig.js';
import { useSessionContext } from '../contexts/SessionContext';

// Flatten all nav items into a single searchable list
function buildEntries(features) {
  const entries = [];

  for (const item of NAV_ITEMS) {
    if (item.feature && features && !features.includes(item.feature)) continue;
    entries.push({ id: item.id, icon: item.icon, label: item.label, path: item.path });
  }

  for (const group of NAV_GROUPS) {
    if (group.feature && features && !features.includes(group.feature)) continue;
    for (const sub of group.items) {
      entries.push({
        id: sub.id,
        icon: group.icon,
        label: `${group.label} › ${sub.label}`,
        path: sub.path,
      });
    }
  }

  for (const item of NAV_BOTTOM) {
    if (item.feature && features && !features.includes(item.feature)) continue;
    entries.push({ id: item.id, icon: item.icon, label: item.label, path: item.path });
  }

  return entries;
}

/**
 * CommandPalette — global navigation palette triggered by Ctrl/Cmd+K.
 *
 * Renders a floating modal with a search field. Filtered items are navigable
 * with ArrowUp/ArrowDown; Enter navigates to the selected item; Escape closes.
 * Does NOT open when focus is inside a text input or textarea (except its own
 * search field).
 */
export function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [, navigate] = useLocation();
  const { backendFeatures } = useSessionContext();

  const entries = buildEntries(backendFeatures);

  const filtered = query.trim().length === 0
    ? entries
    : entries.filter(e =>
        e.label.toLowerCase().includes(query.toLowerCase()) ||
        e.path.toLowerCase().includes(query.toLowerCase())
      );

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep activeIndex in range
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = useCallback((path) => {
    navigate(path);
    onClose();
  }, [navigate, onClose]);

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) handleSelect(item.path);
      return;
    }
  }

  if (!open) return null;

  return (
    <div
      className="cmd-palette-backdrop"
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <div className="cmd-palette__search">
          <span className="cmd-palette__search-icon" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette__input"
            placeholder="Go to page…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search pages"
            aria-autocomplete="list"
            aria-controls="cmd-palette-list"
            aria-activedescendant={filtered[activeIndex] ? `cmd-item-${filtered[activeIndex].id}` : undefined}
            role="combobox"
            aria-expanded={filtered.length > 0}
          />
          <kbd className="cmd-palette__esc-hint">Esc</kbd>
        </div>

        <ul
          id="cmd-palette-list"
          ref={listRef}
          className="cmd-palette__list"
          role="listbox"
          aria-label="Navigation options"
        >
          {filtered.length === 0 ? (
            <li className="cmd-palette__empty">No pages match "{query}"</li>
          ) : (
            filtered.map((item, idx) => (
              <li
                key={item.id}
                id={`cmd-item-${item.id}`}
                className={['cmd-palette__item', idx === activeIndex ? 'cmd-palette__item--active' : ''].filter(Boolean).join(' ')}
                role="option"
                aria-selected={idx === activeIndex}
                data-active={idx === activeIndex ? 'true' : undefined}
                onClick={() => handleSelect(item.path)}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className="cmd-palette__item-icon" aria-hidden="true">{item.icon}</span>
                <span className="cmd-palette__item-label">{item.label}</span>
                <span className="cmd-palette__item-path">{item.path}</span>
              </li>
            ))
          )}
        </ul>

        <div className="cmd-palette__footer">
          <span className="cmd-palette__hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-palette__hint"><kbd>Enter</kbd> open</span>
          <span className="cmd-palette__hint"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
