import * as fileStore from '../file-store.js';

export function createDropZone(container) {
  const el = document.createElement('div');
  el.className = 'drop-zone';
  el.innerHTML = `
    <div class="drop-zone__inner">
      <div class="drop-zone__icon">📄</div>
      <div class="drop-zone__title">Drop text files here</div>
      <div class="drop-zone__sub">or click to browse<br>(.txt files)</div>
      <div class="drop-zone__error" id="dz-error" style="display:none"></div>
    </div>
  `;

  const errorEl = el.querySelector('#dz-error');

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,text/plain';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = '';
    setTimeout(() => { errorEl.style.display = 'none'; }, 3000);
  }

  async function handleFiles(files) {
    for (const file of files) {
      if (!file.name.endsWith('.txt') && !file.type.startsWith('text/')) {
        showError(`Only .txt files supported (skipped: ${file.name})`);
        continue;
      }
      try {
        await fileStore.loadFile(file);
      } catch (err) {
        showError(err.message);
      }
    }
  }

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('drop-zone--active');
  });

  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove('drop-zone--active');
    }
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-zone--active');
    handleFiles(Array.from(e.dataTransfer.files));
  });

  el.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    handleFiles(Array.from(fileInput.files));
  });

  container.appendChild(el);

  let visible = true;

  function toggle() {
    visible = !visible;
    el.style.display = visible ? '' : 'none';
    window.dispatchEvent(new CustomEvent('lcyt:drop-zone-visibility-changed'));
  }

  return {
    element: el,
    triggerFilePicker: () => { fileInput.value = ''; fileInput.click(); },
    toggle,
    isVisible: () => visible,
  };
}
