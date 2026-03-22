// Guarded uploader test: Set TEST_UPLOADER=1 to run
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_UPLOADER) {
  console.log('TEST_UPLOADER not set — skipping uploader test');
  process.exit(0);
}

(async () => {
  const { createUploader } = require('../src/uploader.js');
  const tmpDir = path.join(__dirname, 'tmp-uploader-test');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tmpDir, { recursive: true });

  let calls = [];
  const uploader = createUploader({ watchDir: tmpDir, prefix: 'hls', uploadFn: async (local, remote) => { calls.push({ local, remote }); } });
  const runner = uploader.start();

  // create a file
  const fpath = path.join(tmpDir, 'seg-1.ts');
  fs.writeFileSync(fpath, 'segment-data');

  // wait for watcher to detect
  await new Promise(r => setTimeout(r, 500));

  if (calls.length === 0) {
    console.error('uploadFn not called');
    process.exit(2);
  }

  console.log('uploader test detected', calls.length, 'calls');
  runner.stop();
  process.exit(0);
})();
