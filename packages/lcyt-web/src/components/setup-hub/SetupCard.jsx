import { useState } from 'react';

/**
 * SetupCard — generic catalog card used throughout SetupHubPage.
 *
 * Props:
 *   icon         string   — emoji/icon shown at the top-left.
 *   title        string
 *   description  string
 *   status       'ready' | 'client-only' | 'partial' | 'soon' — status pill.
 *   statusLabel  string   — overrides the default label for `status`.
 *   disabled     boolean  — renders the "Coming soon" disabled variant
 *                            (dims the card, ignores expand/collapse).
 *   action       { label, href } | { label, onClick } — optional primary action button.
 *   children     — expandable body (e.g. an embedded manager/panel). Only
 *                  rendered when the card is expanded (click the header to
 *                  toggle) and `disabled` is false.
 *   defaultExpanded boolean
 */
const STATUS_LABELS = {
  ready:        'Ready',
  'client-only':'Client-only',
  partial:      'Partial',
  soon:         'Coming soon',
};

export function SetupCard({
  icon, title, description, status, statusLabel, disabled = false,
  action, children, defaultExpanded = false,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasBody = !disabled && !!children;

  return (
    <div className={`setup-card${disabled ? ' setup-card--disabled' : ''}`}>
      <div
        className={`setup-card__header${hasBody ? ' setup-card__header--clickable' : ''}`}
        onClick={hasBody ? () => setExpanded(v => !v) : undefined}
        role={hasBody ? 'button' : undefined}
        tabIndex={hasBody ? 0 : undefined}
        onKeyDown={hasBody ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } } : undefined}
      >
        <span className="setup-card__icon" aria-hidden="true">{icon}</span>
        <div className="setup-card__title-block">
          <div className="setup-card__title-row">
            <span className="setup-card__title">{title}</span>
            {status && (
              <span className={`setup-card__pill setup-card__pill--${status}`}>
                {statusLabel || STATUS_LABELS[status] || status}
              </span>
            )}
          </div>
          {description && <p className="setup-card__desc">{description}</p>}
        </div>
        {hasBody && (
          <span className="setup-card__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        )}
      </div>

      {action && (
        <div className="setup-card__actions">
          {action.href ? (
            <a className="btn btn--ghost btn--sm" href={action.href} title={disabled ? 'Coming soon' : undefined}>
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={action.onClick}
              disabled={disabled}
              title={disabled ? 'Coming soon' : undefined}
            >
              {action.label}
            </button>
          )}
        </div>
      )}

      {hasBody && expanded && (
        <div className="setup-card__body">
          {children}
        </div>
      )}
    </div>
  );
}
