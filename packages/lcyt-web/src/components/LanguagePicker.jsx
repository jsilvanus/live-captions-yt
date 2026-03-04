import { useState, useRef } from 'react';
import { COMMON_LANGUAGES } from '../lib/sttConfig';

/**
 * Reusable autocomplete language picker.
 *
 * Props:
 *   value     — current BCP-47 language code (e.g. 'fi-FI')
 *   onChange  — (code: string) => void
 *   placeholder — optional input placeholder text
 *   className   — optional extra class for the input element
 */
export function LanguagePicker({ value, onChange, placeholder = 'Type to filter…', className = '' }) {
  const entry = COMMON_LANGUAGES.find(l => l.code === value);
  const [query, setQuery] = useState(entry ? entry.label : (value || ''));
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  const matches = open
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(query.toLowerCase()) ||
        l.code.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  function handleChange(e) {
    setQuery(e.target.value);
    setOpen(e.target.value.trim().length > 0);
  }

  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  function handleSelect(l) {
    clearTimeout(blurTimer.current);
    setQuery(l.label);
    setOpen(false);
    onChange(l.code);
  }

  function handleFocus() {
    if (query.trim().length > 0) setOpen(true);
  }

  return (
    <div className="audio-lang-wrap">
      <input
        className={`settings-field__input${className ? ' ' + className : ''}`}
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
      />
      {open && matches.length > 0 && (
        <div className="audio-lang-list">
          {matches.map(l => (
            <button
              key={l.code}
              className="audio-lang-option"
              onMouseDown={() => handleSelect(l)}
            >
              {l.label} <span className="audio-lang-code">{l.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
