import { useEscapeKey } from '../hooks/useEscapeKey';

/**
 * Dialog — generic modal shell reusing the existing `.settings-modal*` CSS
 * (see NormalizeLinesModal.jsx for the original convention) so every settings
 * dialog in the app shares one look. `width` overrides the default 520px cap
 * for forms that need more horizontal room (e.g. device connection forms).
 */
export function Dialog({ title, onClose, children, footer, width }) {
  useEscapeKey(onClose);
  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box" style={width ? { maxWidth: width } : undefined}>
        <div className="settings-modal__header">
          <span className="settings-modal__title">{title}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-modal__body">
          {children}
        </div>
        {footer && <div className="settings-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
