import { useState, useRef } from 'react';
import { useFileContext } from '../contexts/FileContext';

export function DropZone({ visible = true }) {
  const { loadFile } = useFileContext();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  if (!visible) return null;

  function showError(msg) {
    setError(msg);
    setTimeout(() => setError(null), 3000);
  }

  async function handleFiles(files) {
    for (const file of files) {
      if (!file.name.endsWith('.txt') && !file.type.startsWith('text/')) {
        showError(`Only .txt files supported (skipped: ${file.name})`);
        continue;
      }
      try {
        await loadFile(file);
      } catch (err) {
        showError(err.message);
      }
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

  return (
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
  );
}
