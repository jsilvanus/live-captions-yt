import React from 'react';

/**
 * ConfirmDialog — Modal confirmation dialog replacing native window.confirm()
 *
 * Props:
 *   - open (bool): Dialog visibility
 *   - title (string): Dialog title/heading
 *   - message (string): Confirmation message
 *   - confirmLabel (string): Confirm button text (default "Confirm")
 *   - cancelLabel (string): Cancel button text (default "Cancel")
 *   - danger (bool): If true, confirm button is red/destructive style (default false)
 *   - loading (bool): If true, confirm button shows loading state and is disabled
 *   - onConfirm (func): Called when user clicks confirm
 *   - onCancel (func): Called when user clicks cancel or closes dialog
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const handleBackdropClick = () => onCancel?.();
  const handleConfirm = () => onConfirm?.();
  const handleCancel = () => onCancel?.();

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 9998,
        }}
      />

      {/* Dialog */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-surface, #1e1e1e)',
          border: '1px solid var(--color-border, #333)',
          borderRadius: '8px',
          padding: '24px',
          minWidth: '320px',
          maxWidth: '400px',
          maxHeight: '90vh',
          overflow: 'auto',
          zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Title */}
        <h2
          style={{
            margin: '0 0 4px 0',
            color: 'var(--color-text, #eee)',
            fontSize: '16px',
            fontWeight: 600,
          }}
        >
          {title}
        </h2>

        {/* Message */}
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-secondary, #aaa)',
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        >
          {message}
        </p>

        {/* Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            marginTop: '8px',
          }}
        >
          <button
            onClick={handleCancel}
            disabled={loading}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid var(--color-border, #555)',
              background: 'var(--color-surface-alt, #2a2a2a)',
              color: 'var(--color-text-secondary, #ddd)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => {
              if (!loading) e.target.style.background = 'var(--color-surface-hover, #333)';
            }}
            onMouseLeave={e => {
              e.target.style.background = 'var(--color-surface-alt, #2a2a2a)';
            }}
          >
            {cancelLabel}
          </button>

          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid transparent',
              background: danger
                ? 'var(--color-destructive, #c44)'
                : 'var(--color-primary, #0fa)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => {
              if (!loading) {
                e.target.style.opacity = '0.85';
              }
            }}
            onMouseLeave={e => {
              e.target.style.opacity = loading ? '0.6' : '1';
            }}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
