# lcyt-worker-daemon

Minimal worker daemon used by the ffmpeg worker-runner.

- Default port: 5000
- Default WORKER_ID: worker-0

Run:

```bash
# start daemon (default port 5000)
node src/index.js
```

Testing note:
- The included test `test/daemon.basic.test.js` is guarded by the `TEST_WORKER_DAEMON=1` environment variable. To run it use:

```bash
TEST_WORKER_DAEMON=1 node test/daemon.basic.test.js
```

(Windows PowerShell example)

```powershell
$env:TEST_WORKER_DAEMON=1; node test/daemon.basic.test.js
```
