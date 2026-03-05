import { useState, useRef } from 'react';
import { useFileContext } from '../contexts/FileContext';
import { NormalizeLinesModal } from './NormalizeLinesModal';

function readFileAsLines(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      resolve(lines);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

export function DropZone({ visible = true }) {
  const { loadFile } = useFileContext();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);

  function showError(msg) {
    setError(msg);
    setTimeout(() => setError(null), 3000);
  }

  function loadLines(name, lines) {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const f = new File([blob], name, { type: 'text/plain' });
    loadFile(f).catch(err => showError(err.message));
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

  async function handleFiles(files) {
    const txtFiles = [];
    for (const file of files) {
      if (!file.name.endsWith('.txt') && !file.type.startsWith('text/')) {
        showError(`Only .txt files supported (skipped: ${file.name})`);
        continue;
      }
      try {
        const rawLines = await readFileAsLines(file);
        txtFiles.push({ name: file.name, rawLines });
      } catch (err) {
        showError(err.message);
      }
    }
    if (txtFiles.length > 0) {
      setPendingFiles(txtFiles);
    }
  }

  function onDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragging(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }

  function onClick() {
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  function onFileChange(e) {
    handleFiles(Array.from(e.target.files));
  }

  const modal = pendingFiles.length > 0 ? (
    <NormalizeLinesModal
      fileName={pendingFiles[0].name}
      rawLines={pendingFiles[0].rawLines}
      onConfirm={handleModalConfirm}
      onSkip={handleModalSkip}
    />
  ) : null;

  if (!visible) return modal;

  return (
    <>
      {modal}
      <div
        className={`drop-zone${dragging ? ' drop-zone--active' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClick}
      >
        <div className="drop-zone__inner">
          <div className="drop-zone__icon">📄</div>
          <div className="drop-zone__title">Drop text files here</div>
          <div className="drop-zone__sub">or click to browse<br />(.txt files)</div>
          {error && <div className="drop-zone__error">{error}</div>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          multiple
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>
    </>
  );
}
