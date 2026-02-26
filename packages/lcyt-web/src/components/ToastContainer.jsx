import { useEffect, useRef } from 'react';
import { useToastContext } from '../contexts/ToastContext';

function Toast({ toast, onDismiss }) {
  const ref = useRef(null);

  // Fade-out on dismiss
  function dismiss() {
    if (ref.current) {
      ref.current.style.opacity = '0';
      ref.current.style.transition = 'opacity 0.2s';
    }
    // Match the 200ms fade before actually removing
    setTimeout(onDismiss, 200);
  }

  return (
    <div
      ref={ref}
      className={`toast toast--${toast.type}`}
      onClick={dismiss}
    >
      {toast.message}
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismissToast } = useToastContext();

  return (
    <div id="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}
