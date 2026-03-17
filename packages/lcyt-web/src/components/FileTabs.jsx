import { useState, useRef } from 'react';
import { useFileContext } from '../contexts/FileContext';
import { NormalizeLinesModal } from './NormalizeLinesModal';
import { readFileAsLines, linesToFile } from '../lib/fileUtils';

function truncate(name, max = 20) {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

export function FileTabs({ dropZoneVisible, onToggleDropZone }) {
  const { files, activeId, loadFile, setActive, removeFile } = useFileContext();
  const fileInputRef = useRef(null);
  const [pendingFiles, setPendingFiles] = useState([]);

  function triggerFilePicker() {
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  function loadLines(name, lines) {
    loadFile(linesToFile(name, lines)).catch(err => console.error('Failed to load file:', err));
  }

  function handleModalConfirm(normalizedLines) {
    const [current, ...rest] = pendingFiles;
    loadLines(current.name, normalizedLines);
    setPendingFiles(rest);
  }

  function handleModalSkip() {
    const [current, ...rest] = pendingFiles;
    loadLines(current.name, current.rawLines);
    setPendingFiles(rest);
  }

  async function onFileChange(e) {
    const txtFiles = [];
    for (const file of Array.from(e.target.files)) {
      if (!file.name.endsWith('.txt') && !file.name.endsWith('.md') && !file.type.startsWith('text/')) continue;
      try {
        const rawLines = await readFileAsLines(file);
        txtFiles.push({ name: file.name, rawLines });
      } catch {}
    }
    if (txtFiles.length > 0) {
      setPendingFiles(txtFiles);
    }
  }

  return (
    <>
      {pendingFiles.length > 0 && (
        <NormalizeLinesModal
          fileName={pendingFiles[0].name}
          rawLines={pendingFiles[0].rawLines}
          onConfirm={handleModalConfirm}
          onSkip={handleModalSkip}
        />
      )}
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
          accept=".txt,.md,text/plain,text/markdown"
          multiple
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>
    </>
  );
}
