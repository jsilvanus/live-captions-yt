/**
 * icons.jsx — line-icon set for the Setup Hub cards, ported from the Claude
 * Design mockup (project 9919ac53, Cameras/Mixers/.../ApiConnectorsCard
 * .dc.html) so the hub matches the mockup's icon language instead of emoji.
 * Every icon is a fixed 16x16 viewBox, stroke-based, uses currentColor so the
 * category color comes from the wrapping icon box (see CATEGORY_COLORS).
 */

export const CATEGORY_COLORS = {
  accent: { fg: 'var(--color-accent)', bg: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' },
  cyan:    { fg: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
  purple:  { fg: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  green:   { fg: '#15803d', bg: 'rgba(21,128,61,0.08)' },
  teal:    { fg: '#0f766e', bg: 'rgba(15,118,110,0.08)' },
  muted:   { fg: 'var(--color-text-muted)', bg: 'var(--color-surface-alt)' },
};

export function CamerasIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 5C2 4.17 2.67 3.5 3.5 3.5H9.5C10.33 3.5 11 4.17 11 5V11C11 11.83 10.33 12.5 9.5 12.5H3.5C2.67 12.5 2 11.83 2 11V5Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 6.5L14 5V11L11 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function MixersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 4V12M6 4V12M9 4V12M13 4V12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="1.5" y="6" width="3" height="2.5" rx="0.75" fill="currentColor" />
      <rect x="4.5" y="5" width="3" height="2.5" rx="0.75" fill="currentColor" />
      <rect x="7.5" y="7" width="3" height="2.5" rx="0.75" fill="currentColor" />
      <rect x="11.5" y="4.5" width="3" height="2.5" rx="0.75" fill="currentColor" />
    </svg>
  );
}

export function EncodersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 1.5V4M10 1.5V4M6 12V14.5M10 12V14.5M1.5 6H4M1.5 10H4M12 6H14.5M12 10H14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function BridgesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 8H14.5M4 5L1.5 8L4 11M12 5L14.5 8L12 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IngestionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2V11M8 11L5 8M8 11L11 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function EgressIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 11V2M8 2L5 5M8 2L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function WebRadioIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="9" r="1.5" fill="currentColor" />
      <path d="M5.5 7C5.5 7 4.5 7.8 4.5 9C4.5 10.2 5.5 11 5.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10.5 7C10.5 7 11.5 7.8 11.5 9C11.5 10.2 10.5 11 10.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="8" y1="7.5" x2="8" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4 5C4 5 2 6.5 2 9C2 11.5 4 13 4 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.35" />
      <path d="M12 5C12 5 14 6.5 14 9C14 11.5 12 13 12 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

export function ViewportsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 13.5H10.5M8 11.5V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function CaptionTargetsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3.5C2 2.67 2.67 2 3.5 2H12.5C13.33 2 14 2.67 14 3.5V10C14 10.83 13.33 11.5 12.5 11.5H9L6.5 14V11.5H3.5C2.67 11.5 2 10.83 2 10V3.5Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6H11M5 8.5H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function LanguagesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3H9M5.5 3V2M3.5 5.5C3.5 5.5 4.5 8 7 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 8.5C6 8.5 8 6.5 8.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.5 9.5L11.5 14M11.5 14L13.5 9.5M10.25 12H12.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SttServiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 7.5C3 10.26 5.24 12.5 8 12.5C10.76 12.5 13 10.26 13 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8 12.5V14.5M5.5 14.5H10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function StorageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 7H14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 2H10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="4.5" cy="9.5" r="0.8" fill="currentColor" opacity="0.6" />
      <circle cx="7" cy="9.5" r="0.8" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

export function ModelsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 2V4M8 12V14M2 8H4M12 8H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

export function ApiConnectorsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="3.5" width="5" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="3.5" width="5" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 8H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8 6.5V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

export function WorkflowsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 4H14M2 8H10M2 12H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 9L15 11L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 6C6.5 5.17 7.17 4.5 8 4.5C8.83 4.5 9.5 5.17 9.5 6C9.5 7 8 7.5 8 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="10.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

/** Small "+" glyph used inside the header Add button. */
export function PlusIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M4.5 1V8M1 4.5H8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Pencil glyph used on the per-item settings button. */
export function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 2L12 4.5L4.5 12H2V9.5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Trash glyph used on delete-only item rows (e.g. caption targets). */
export function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <path d="M2 3.5H12M5 3.5V2.5C5 2 5.5 1.5 6 1.5H8C8.5 1.5 9 2 9 2.5V3.5M10.5 3.5L10 11.5C10 12 9.5 12.5 9 12.5H5C4.5 12.5 4 12 4 11.5L3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
