// Import this before anything that loads lcyt-compute: FFMPEG_WRAPPER is read once, at module load.
// Every ffmpeg the managers start is then helpers/fake-ffmpeg.mjs (no real ffmpeg needed), which
// logs the arguments it was given; read them with `launched()`.
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const log = join(mkdtempSync(join(tmpdir(), 'fake-ffmpeg-')), 'launches.jsonl');
writeFileSync(log, '');
delete process.env.FFMPEG_RUNNER;
delete process.env.FFFLEET_URL;
process.env.FFMPEG_WRAPPER = fileURLToPath(new URL('./fake-ffmpeg.mjs', import.meta.url));
process.env.FAKE_FFMPEG_LOG = log;

/** Forget the launches so far. */
export function resetLaunches() { writeFileSync(log, ''); }

/** The launches recorded so far (`{ args }`), waiting until at least `n` have started. */
export async function launched(n = 1, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (rows.length >= n || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
}
