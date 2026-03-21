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
  // Return a Promise always for consistent async handling
  return new Promise((resolve, reject) => {
    // On Windows, create an empty file as fallback (not a real FIFO)
    if (process.platform === 'win32') {
      try {
        writeFileSync(path, '');
        return resolve({ path, createdAsFifo: false });
      } catch (e) {
        return reject(e);
      }
    }

    // POSIX: use mkfifo
    const p = spawn('mkfifo', ['-m', '600', path]);
    p.on('error', err => reject(err));
    p.on('close', code => {
      if (code === 0) resolve({ path, createdAsFifo: true });
      else reject(new Error(`mkfifo exited ${code}`));
    });
  });
}
