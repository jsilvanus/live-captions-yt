import { useState, useEffect, useRef } from 'react';
import { useRoute } from 'wouter';

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
 *   id           string   — stable slug for this card (e.g. "connectors").
 *                            When set, navigating to `/setup/:id` pre-expands
 *                            this card and scrolls it into view — every card
 *                            with an `id` is deep-linkable this way, no extra
 *                            wiring needed per card. See SetupHubPage.
 */
const STATUS_LABELS = {
  ready:        'Ready',
  'client-only':'Client-only',
  partial:      'Partial',
  soon:         'Coming soon',
};

export function SetupCard({
  icon, title, description, status, statusLabel, disabled = false,
  action, children, defaultExpanded = false, id,
}) {
  const hasBody = !disabled && !!children;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const containerRef = useRef(null);

  const [deepLinked] = useRoute(id ? `/setup/${id}` : '/__setup-card-no-id__');

  useEffect(() => {
    if (!deepLinked) return;
    if (hasBody) setExpanded(true);
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Only react to the deep-link itself arriving/changing — not to hasBody,
    // which is stable per card and shouldn't re-trigger the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinked]);

  return (
    <div ref={containerRef} className={`setup-card${disabled ? ' setup-card--disabled' : ''}`}>
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
