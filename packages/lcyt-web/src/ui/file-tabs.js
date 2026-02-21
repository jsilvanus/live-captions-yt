import * as fileStore from '../file-store.js';

export function createFileTabs(container, { triggerFilePicker } = {}) {
  const el = document.createElement('div');
  el.className = 'file-tabs';
  el.style.display = 'none';

  function truncate(name, max = 20) {
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
  }

  function render() {
    const files = fileStore.getAll();
    const active = fileStore.getActive();

    el.style.display = files.length > 0 ? '' : 'none';

    el.innerHTML = '';

    files.forEach(file => {
      const isActive = active && active.id === file.id;
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

      // Click tab → activate
      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-tab__close')) return;
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
  }

  window.addEventListener('lcyt:files-changed', render);
  window.addEventListener('lcyt:active-changed', render);
  window.addEventListener('lcyt:pointer-changed', render);

  container.appendChild(el);
  render();

  return { element: el };
}
