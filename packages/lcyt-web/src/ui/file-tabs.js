import * as fileStore from '../file-store.js';

// Current view: 'captions' | 'audio'
let currentView = 'captions';

export function getCurrentView() {
  return currentView;
}

export function setView(view) {
  currentView = view;
  window.dispatchEvent(new CustomEvent('lcyt:view-changed', { detail: { view } }));
}

export function createFileTabs(container, { triggerFilePicker } = {}) {
  const el = document.createElement('div');
  el.className = 'file-tabs';

  function truncate(name, max = 20) {
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
  }

  function render() {
    const files = fileStore.getAll();
    const active = fileStore.getActive();

    // Always show the tab bar (for the Audio tab at minimum)
    el.style.display = '';

    el.innerHTML = '';

    files.forEach(file => {
      const isActive = currentView === 'captions' && active && active.id === file.id;
      const isEnd = file.lines.length > 0 && file.pointer >= file.lines.length - 1;
      const isEmpty = file.lines.length === 0;

      const tab = document.createElement('button');
      tab.className = 'file-tab' + (isActive ? ' file-tab--active' : '');
      tab.title = file.name;

      let badge = '';
      if (isEmpty) {
        badge = `<span class="file-tab__badge file-tab__badge--empty">empty</span>`;
      } else if (isEnd) {
        badge = `<span class="file-tab__badge file-tab__badge--end">end</span>`;
      }

      tab.innerHTML = `
        <span class="file-tab__name">${truncate(file.name)}</span>
        ${badge}
        <span class="file-tab__close" title="Close">×</span>
      `;

      // Click tab → activate captions view + set file active
      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-tab__close')) return;
        setView('captions');
        fileStore.setActive(file.id);
      });

      // Close button
      tab.querySelector('.file-tab__close').addEventListener('click', (e) => {
        e.stopPropagation();
        if (file.pointer > 0) {
          if (!confirm(`Close "${file.name}"? Your position (line ${file.pointer + 1}) will be remembered.`)) {
            return;
          }
        }
        fileStore.removeFile(file.id);
      });

      el.appendChild(tab);
    });

    // "+" add tab
    const addTab = document.createElement('button');
    addTab.className = 'file-tab file-tab--add';
    addTab.title = 'Add file';
    addTab.textContent = '+';
    addTab.addEventListener('click', () => {
      triggerFilePicker && triggerFilePicker();
    });
    el.appendChild(addTab);

    // Spacer to push Audio tab to the right
    const spacer = document.createElement('div');
    spacer.className = 'file-tabs__spacer';
    el.appendChild(spacer);

    // "Audio" special tab — always visible on the right
    const audioTab = document.createElement('button');
    audioTab.className = 'file-tab file-tab--audio' + (currentView === 'audio' ? ' file-tab--active' : '');
    audioTab.title = 'Audio & STT Settings';
    audioTab.innerHTML = '<span class="file-tab__audio-icon">&#127908;</span> Audio';
    audioTab.addEventListener('click', () => {
      setView('audio');
    });
    el.appendChild(audioTab);
  }

  window.addEventListener('lcyt:files-changed', render);
  window.addEventListener('lcyt:active-changed', render);
  window.addEventListener('lcyt:pointer-changed', render);
  window.addEventListener('lcyt:view-changed', render);

  container.appendChild(el);
  render();

  return { element: el };
}
