import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const writeAsync = promisify(fs.write);

export function isFifo(path) {
  try {
    const st = fs.statSync(path);
    // On POSIX S_IFIFO bit
    return (st.mode & 0o170000) === 0o010000;
  } catch (e) {
    return false;
  }
}
export function makeFifo(path) {
  // Ensure parent directory exists first to avoid mkfifo failures
  try {
    fs.mkdirSync(dirname(path), { recursive: true });
  } catch (e) {
    // ignore
  }

  // Return a Promise always for consistent async handling
  return new Promise((resolve, reject) => {
    // On Windows, create an empty file as fallback (not a real FIFO)
    if (process.platform === 'win32') {
      try {
        fs.writeFileSync(path, '');
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

/**
 * Open a FIFO path in non-blocking mode and return a file descriptor.
 * On POSIX this will set O_NONBLOCK. On Windows this falls back to a normal open.
 * Note: Caller is responsible for closing the fd with `fs.closeSync(fd)`.
 */
export let openFifoNonBlocking = function openFifoNonBlocking(path, flags = fs.constants.O_WRONLY | fs.constants.O_APPEND) {
  // Prefer O_NONBLOCK on POSIX so open()/write() do not block when no reader is present.
  if (process.platform !== 'win32' && fs.constants.O_NONBLOCK) {
    try {
      return fs.openSync(path, flags | fs.constants.O_NONBLOCK, 0o600);
    } catch (err) {
      // If open fails with EINVAL on some platforms, fallback to blocking open to surface error.
      throw err;
    }
  }

  // Windows: no O_NONBLOCK — open normally (writes won't block in typical file semantics).
  return fs.openSync(path, flags, 0o600);
};

// Test helper: allow tests to inject a mock implementation for openFifoNonBlocking
export function __test_setOpenFifo(fn) {
  openFifoNonBlocking = fn;
}

/**
 * Create a FIFO writer helper that performs non-blocking writes with bounded retries and timeout.
 * Returns: { write(cue): Promise<boolean>, close(): Promise<void> }
 * - write resolves `true` when write accepted, `false` when timed out/dropped.
 */
export function createFifoWriter(path, { timeoutMs = 250 } = {}) {
  let fd = null;
  let closed = false;

  function ensureOpen() {
    if (fd !== null) return fd;
    try {
      fd = openFifoNonBlocking(path, fs.constants.O_WRONLY | fs.constants.O_APPEND);
      return fd;
    } catch (err) {
      // rethrow for caller to handle
      throw err;
    }
  }

  async function write(cue) {
    if (closed) return false;
    const start = Date.now();
    const payload = Buffer.from(String(cue), 'utf8');

    // Try a few bounded attempts until timeout
    while (true) {
      try {
        const fdLocal = ensureOpen();
        await writeAsync(fdLocal, payload, 0, payload.length, null);
        return true;
      } catch (err) {
        // EAGAIN / EWOULDBLOCK -> retry with small backoff
        if (err && (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK')) {
          if (Date.now() - start >= timeoutMs) return false;
          await new Promise(r => setTimeout(r, 20));
          continue;
        }

        // On broken pipe / no readers, return false without throwing
        if (err && (err.code === 'EPIPE' || err.code === 'ENXIO')) return false;

        // Other errors: rethrow
        throw err;
      }
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) {}
      fd = null;
    }
  }

  return { write, close };
}
