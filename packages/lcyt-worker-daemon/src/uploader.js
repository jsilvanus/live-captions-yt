import fs from 'fs';
import path from 'path';

// Minimal uploader skeleton: watches a directory for new files and calls the provided
// `uploadFn(localPath, remotePath)` callback. If S3 env vars are not set, it's a no-op.

export function createUploader({ watchDir, prefix = '', uploadFn }) {
  if (!watchDir) throw new Error('watchDir required');
  let watcher = null;

  function start() {
    // noop if S3 not configured
    const s3Endpoint = process.env.S3_ENDPOINT || process.env.S3_URL || '';
    if (!s3Endpoint) {
      console.warn('S3 endpoint not configured; uploader will be a no-op');
      return { stop: () => {} };
    }

    // ensure directory exists
    try { fs.mkdirSync(watchDir, { recursive: true }); } catch (e) {}

    watcher = fs.watch(watchDir, { persistent: false }, (evt, filename) => {
      if (!filename) return;
      const full = path.join(watchDir, filename);
      // small debounce / existence check
      setTimeout(() => {
        try {
          const stat = fs.statSync(full);
          if (stat.isFile()) {
            const remote = prefix ? `${prefix}/${filename}` : filename;
            if (typeof uploadFn === 'function') {
              uploadFn(full, remote).catch(err => console.error('uploadFn error', err));
            } else {
              console.log('Uploader: detected', full, 'would upload to', remote);
            }
          }
        } catch (e) {
          // file may have disappeared
        }
      }, 200);
    });

    return {
      stop: () => { if (watcher) try { watcher.close(); } catch (e) {} }
    };
  }

  return { start };
}

export default createUploader;
