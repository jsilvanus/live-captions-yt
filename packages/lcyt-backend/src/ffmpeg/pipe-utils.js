import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';

export function isFifo(path) {
  try {
    const st = statSync(path);
    // On POSIX S_IFIFO bit
    return (st.mode & 0o170000) === 0o010000;
  } catch (e) {
    return false;
  }
}

export function makeFifo(path) {
  // On non-Windows try mkfifo; on Windows fall back to creating an empty file.
  if (process.platform === 'win32') {
    writeFileSync(path, '');
    return { path, createdAsFifo: false };
  }

  // POSIX: use mkfifo
  return new Promise((resolve, reject) => {
    const p = spawn('mkfifo', ['-m', '600', path]);
    p.on('error', err => reject(err));
    p.on('close', code => {
      if (code === 0) resolve({ path, createdAsFifo: true });
      else reject(new Error(`mkfifo exited ${code}`));
    });
  });
}
