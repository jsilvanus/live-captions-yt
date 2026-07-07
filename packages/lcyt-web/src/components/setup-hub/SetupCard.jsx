import { useEffect, useRef, useState } from 'react';
import { useRoute } from 'wouter';
import { CATEGORY_COLORS, PencilIcon, PlusIcon, StarIcon, TrashIcon } from './icons.jsx';
import { useCardFavorites } from '../../lib/cardFavorites.js';

const HIGHLIGHT_MS = 10_000;

/**
 * SetupCard — catalog card used throughout SetupHubPage, styled after the
 * Claude Design mockup's Cameras/Mixers/.../ApiConnectorsCard components:
 * a colored icon box, title + one-line description, a header action button
 * (Add / Configure / "Manage in X"), and an always-visible body listing
 * configured items inline (see SetupItemRow below) — no more click-to-expand.
 *
 * Props:
 *   icon         component — one of the icons in ./icons.jsx.
 *   color        string    — key into CATEGORY_COLORS ('accent'|'cyan'|'purple'|'green'|'teal'|'muted').
 *   title        string
 *   description  string
 *   status       'ready' | 'client-only' | 'partial' | 'soon' — optional status pill.
 *   statusLabel  string    — overrides the default label for `status`.
 *   placeholder  boolean   — renders the dashed, always-visible "coming soon"/
 *                            "help" style card (no icon-box tint, no header action).
 *   headerAction { label, onClick } | { label, href } — button in the header
 *                (e.g. "+ Add", "Configure", "Manage in Broadcast →").
 *   emptyText    string    — shown when there are no items (no `children`).
 *   children     — item rows (see SetupItemRow) or a custom body.
 *   footerLink   { label, href } — optional link below the item list
 *                (e.g. "Open standalone page").
 *   id           string    — stable slug for this card (e.g. "connectors").
 *                            When set, navigating to `/setup/:id` scrolls this
 *                            card into view and highlights it for 10 seconds.
 *                            Also doubles as the favorite-star key (skipped
 *                            for `placeholder` cards) and the id SetupHubPage's
 *                            filter pills match against.
 *   variant      'default' | 'cta' — 'cta' renders a solid accent-filled card
 *                (no icon-box tint, white text/button) for an action entry
 *                point rather than a status display — see the Workflows card.
 */
export function SetupCard({
  id, icon: Icon, color = 'accent', title, description,
  status, statusLabel, placeholder = false, variant = 'default',
  headerAction, emptyText, children, footerLink,
}) {
  const containerRef = useRef(null);
  const [deepLinked] = useRoute(id ? `/setup/${id}` : '/__setup-card-no-id__');
  const [highlighted, setHighlighted] = useState(false);
  const { isFavorite, toggle } = useCardFavorites();
  const favorite = id ? isFavorite(id) : false;

  useEffect(() => {
    if (!deepLinked) return;
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlighted(true);
    const t = setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [deepLinked]);

  const cat = CATEGORY_COLORS[color] || CATEGORY_COLORS.accent;
  const hasBody = !placeholder && (children || emptyText);

  return (
    <div ref={containerRef} className={`setup-card${placeholder ? ' setup-card--placeholder' : ''}${highlighted ? ' setup-card--highlighted' : ''}${variant === 'cta' ? ' setup-card--cta' : ''}`}>
      <div className={`setup-card__header${hasBody ? ' setup-card__header--bordered' : ''}`}>
        {Icon && (
          <div className="setup-card__icon-box" style={variant === 'cta' ? undefined : { background: cat.bg, color: cat.fg }}>
            <Icon />
          </div>
        )}
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
        {id && !placeholder && (
          <button
            type="button"
            className="setup-card__fav-btn"
            onClick={() => toggle(id)}
            aria-pressed={favorite}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <StarIcon filled={favorite} />
          </button>
        )}
        {headerAction && (
          headerAction.href ? (
            <a className="setup-card__add-btn" href={headerAction.href}>
              {headerAction.label}
            </a>
          ) : (
            <button type="button" className="setup-card__add-btn" onClick={headerAction.onClick}>
              <PlusIcon /> {headerAction.label}
            </button>
          )
        )}
      </div>

      {hasBody && (
        <div className="setup-card__body">
          {children || <p className="setup-card__empty">{emptyText}</p>}
        </div>
      )}

      {footerLink && (
        <div className="setup-card__footer">
          <a href={footerLink.href}>{footerLink.label} →</a>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS = {
  ready:        'Ready',
  'client-only':'Client-only',
  partial:      'Partial',
  soon:         'Coming soon',
};

/**
 * SetupItemRow — one configured item inside a SetupCard's body: name + meta
 * on the left, optional status dot / badge, optional toggle switch, and a
 * settings (edit) or delete icon-button on the right that opens a Dialog.
 */
export function SetupItemRow({
  name, meta, badge, statusDot, faded = false,
  toggleOn, onToggle, onSettings, onDelete, extra,
}) {
  return (
    <div className={`setup-item-row${faded ? ' setup-item-row--faded' : ''}`}>
      {statusDot && <span className="setup-item-row__dot" style={{ background: statusDot }} />}
      <div className="setup-item-row__text">
        <p className="setup-item-row__name">{name}</p>
        {(meta || badge) && (
          <div className="setup-item-row__meta-line">
            {meta && <span className="setup-item-row__meta">{meta}</span>}
            {badge && <span className="setup-item-row__badge">{badge}</span>}
          </div>
        )}
      </div>
      {extra}
      {onToggle && (
        <button
          type="button"
          className={`setup-item-row__toggle${toggleOn ? ' setup-item-row__toggle--on' : ''}`}
          onClick={onToggle}
          aria-pressed={!!toggleOn}
          aria-label={`${toggleOn ? 'Disable' : 'Enable'} ${name}`}
        >
          <span className="setup-item-row__toggle-knob" />
        </button>
      )}
      {onSettings && (
        <button type="button" className="setup-item-row__icon-btn" onClick={onSettings} title="Settings">
          <PencilIcon />
        </button>
      )}
      {onDelete && (
        <button type="button" className="setup-item-row__icon-btn setup-item-row__icon-btn--danger" onClick={onDelete} title="Delete">
          <TrashIcon />
        </button>
      )}
    </div>
  );
}
