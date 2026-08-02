"""Bounded single-worker inference queue.

Chunks arrive every ~5-15s per session; faster-whisper models aren't safely
shared across concurrent calls, so requests are serialized through a single
worker. Rather than letting a backlog build unbounded latency, requests
beyond `max_queue` are rejected immediately (503) — the Node.js
WhisperHttpAdapter already treats STT errors as skip-and-continue.
"""

import asyncio


class QueueFullError(Exception):
    pass


class InferenceQueue:
    def __init__(self, max_queue=8):
        self.max_queue = max_queue
        self._lock = asyncio.Lock()
        self._depth = 0

    async def run(self, fn, *args, **kwargs):
        if self._depth >= self.max_queue:
            raise QueueFullError(f"Inference queue depth exceeded ({self.max_queue})")
        self._depth += 1
        try:
            async with self._lock:
                return await asyncio.to_thread(fn, *args, **kwargs)
        finally:
            self._depth -= 1
