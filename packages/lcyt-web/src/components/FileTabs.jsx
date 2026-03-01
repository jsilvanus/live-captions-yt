import { useRef } from 'react';
import { useFileContext } from '../contexts/FileContext';

function truncate(name, max = 20) {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

export function FileTabs({ dropZoneVisible, onToggleDropZone }) {
  const { files, activeId, loadFile, setActive, removeFile } = useFileContext();
  const fileInputRef = useRef(null);

  function triggerFilePicker() {
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  async function onFileChange(e) {
    for (const file of Array.from(e.target.files)) {
      if (!file.name.endsWith('.txt') && !file.type.startsWith('text/')) continue;
      try { await loadFile(file); } catch {}
    }
  }

  return (
    <div className="file-tabs">
      {files.map(file => {
        const isActive = activeId === file.id;
        const isEnd = file.lines.length > 0 && file.pointer >= file.lines.length - 1;
        const isEmpty = file.lines.length === 0;

        return (
          <button
            key={file.id}
            className={`file-tab${isActive ? ' file-tab--active' : ''}`}
            title={file.name}
            onClick={() => setActive(file.id)}
          >
            <span className="file-tab__name">{truncate(file.name)}</span>
            {isEmpty && <span className="file-tab__badge file-tab__badge--empty">empty</span>}
            {!isEmpty && isEnd && <span className="file-tab__badge file-tab__badge--end">end</span>}
            <span
              className="file-tab__close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                if (file.pointer > 0) {
                  if (!confirm(`Close "${file.name}"? Your position (line ${file.pointer + 1}) will be remembered.`)) {
                    return;
                  }
                }
                removeFile(file.id);
              }}
            >×</span>
          </button>
        );
      })}

      <button className="file-tab file-tab--add" title="Add file" onClick={triggerFilePicker}>+</button>

      <div className="file-tabs__spacer" />

      <button
        className={`file-tab file-tab--dz-toggle${dropZoneVisible ? ' file-tab--dz-toggle-on' : ''}`}
        title={dropZoneVisible ? 'Hide drop zone' : 'Show drop zone'}
        onClick={onToggleDropZone}
      >⇩</button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        multiple
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
    </div>
  );
}
