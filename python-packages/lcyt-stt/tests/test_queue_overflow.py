import asyncio
import time

import pytest

from lcyt_stt.serve.queue import InferenceQueue, QueueFullError


def _slow(x):
    time.sleep(0.05)
    return x


@pytest.mark.asyncio
async def test_rejects_when_queue_depth_exceeds_limit():
    queue = InferenceQueue(max_queue=1)

    task = asyncio.create_task(queue.run(_slow, 1))
    await asyncio.sleep(0.01)  # let the first call claim its queue slot

    with pytest.raises(QueueFullError):
        await queue.run(_slow, 2)

    assert await task == 1


@pytest.mark.asyncio
async def test_processes_sequentially_within_capacity():
    queue = InferenceQueue(max_queue=2)
    results = await asyncio.gather(queue.run(_slow, 1), queue.run(_slow, 2))
    assert results == [1, 2]
