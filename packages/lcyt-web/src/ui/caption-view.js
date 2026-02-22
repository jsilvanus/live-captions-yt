import * as fileStore from '../file-store.js';

const VIRTUAL_THRESHOLD = 500;
const VIRTUAL_BUFFER = 50;

export function createCaptionView(container) {
  const el = document.createElement('div');
  el.className = 'caption-view';
  el.tabIndex = 0;  // keyboard focusable
  el.style.outline = 'none';

  const list = document.createElement('ul');
  list.className = 'caption-lines';
  el.appendChild(list);

  const eofBar = document.createElement('div');
  eofBar.className = 'caption-view__eof';
  eofBar.textContent = 'End of file';
  eofBar.style.display = 'none';
  el.appendChild(eofBar);

  // Track last-sent line for flash animation
  let lastSentIndex = null;
  let lastFileId = null;

  function renderLines(file) {
    list.innerHTML = '';
    eofBar.style.display = 'none';

    if (!file) {
      const empty = document.createElement('div');
      empty.className = 'caption-view__empty';
      empty.textContent = 'No file loaded. Drop a .txt file to begin.';
      list.appendChild(empty);
      return;
    }

    if (file.lines.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'caption-view__empty';
      empty.textContent = 'No caption lines found in this file.';
      list.appendChild(empty);
      return;
    }

    const { lines, pointer, id } = file;
    const useVirtual = lines.length > VIRTUAL_THRESHOLD;

    // Determine render window for virtual scroll
    const start = useVirtual ? Math.max(0, pointer - VIRTUAL_BUFFER) : 0;
    const end = useVirtual ? Math.min(lines.length, pointer + VIRTUAL_BUFFER + 1) : lines.length;

    for (let i = start; i < end; i++) {
      const li = document.createElement('li');
      li.className = 'caption-line';
      li.dataset.index = i;

      const isActive = i === pointer;
      const wasSent = lastFileId === id && i === lastSentIndex;

      if (isActive) li.classList.add('caption-line--active');
      if (wasSent) li.classList.add('caption-line--sent');

      li.innerHTML = `
        <span class="caption-line__gutter">${isActive ? '►' : ''}</span>
        <span class="caption-line__text">${escapeHtml(lines[i])}</span>
      `;

      li.addEventListener('click', () => {
        fileStore.setPointer(id, i);
      });

      list.appendChild(li);
    }

    // EOF indicator
    if (pointer >= lines.length - 1) {
      eofBar.style.display = '';
    }

    // Scroll active line into view
    const activeEl = list.querySelector('.caption-line--active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function update() {
    const file = fileStore.getActive();
    renderLines(file);
  }

  window.addEventListener('lcyt:active-changed', update);
  window.addEventListener('lcyt:files-changed', update);
  window.addEventListener('lcyt:pointer-changed', update);

  container.appendChild(el);
  update();

  return {
    element: el,
    flashSent: (fileId, lineIndex) => {
      lastSentIndex = lineIndex;
      lastFileId = fileId;
      update();
      setTimeout(() => {
        list.querySelectorAll('.caption-line--sent')
          .forEach(el => el.classList.remove('caption-line--sent'));
        lastSentIndex = null;
        lastFileId = null;
      }, 1500);
    },
  };
}
