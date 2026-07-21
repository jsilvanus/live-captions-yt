/**
 * MetacodeAutocompleteDropdown — the popup for `lib/metacodeAutocomplete.js`'s
 * suggestions. Purely presentational; `InputBar.jsx` owns cursor tracking,
 * data fetching, and keyboard navigation state.
 */
export function MetacodeAutocompleteDropdown({ options, activeIndex, onSelect }) {
  if (!options.length) return null;
  return (
    <div className="input-bar__metacode-dropdown" role="listbox">
      {options.map((opt, i) => (
        <button
          key={opt.insertText + i}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`input-bar__metacode-option${i === activeIndex ? ' input-bar__metacode-option--active' : ''}`}
          // Fires before the input's blur — mousedown, not click, so the
          // text field never loses focus/cursor-position context first.
          onMouseDown={e => { e.preventDefault(); onSelect(opt); }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
