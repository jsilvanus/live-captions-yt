#!/usr/bin/env node
// Stand-in for ffmpeg in manager lifecycle tests: records its arguments (one JSON line in
// $FAKE_FFMPEG_LOG), then stays alive until it is killed.
import { appendFileSync } from 'node:fs';

if (process.env.FAKE_FFMPEG_LOG) appendFileSync(process.env.FAKE_FFMPEG_LOG, `${JSON.stringify({ args: process.argv.slice(2) })}\n`);
// Everything written to stdin is appended to $FAKE_FFMPEG_LOG.stdin (read it with stdinWritten()).
if (process.env.FAKE_FFMPEG_LOG) process.stdin.on('data', d => appendFileSync(`${process.env.FAKE_FFMPEG_LOG}.stdin`, d));
else process.stdin.resume();
setTimeout(() => {}, 60_000);
