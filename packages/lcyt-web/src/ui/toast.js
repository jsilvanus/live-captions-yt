const container = document.getElementById('toast-container');

export function showToast(message, type = 'info', duration = 5000) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  const remove = () => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
    setTimeout(() => toast.remove(), 200);
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}
