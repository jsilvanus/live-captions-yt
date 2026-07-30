"""FastAPI inference server: whisper.cpp-compatible /inference + /health.

The Node.js WhisperHttpAdapter (packages/plugins/lcyt-rtmp/src/stt-adapters/
whisper-http.js) already speaks this exact protocol, so pointing
WHISPER_HTTP_URL at this service requires no changes on that side.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .audio import temp_audio_file
from .model import ModelHost, ModelLoadError
from .queue import InferenceQueue, QueueFullError

logger = logging.getLogger(__name__)


def create_app(model_host: Optional[ModelHost] = None, queue: Optional[InferenceQueue] = None) -> FastAPI:
    host = model_host or ModelHost(
        model_id=os.environ.get("LCYT_STT_MODEL", "Systran/faster-whisper-large-v3-turbo"),
        model_dir=os.environ.get("LCYT_STT_MODEL_DIR"),
        device=os.environ.get("LCYT_STT_DEVICE", "auto"),
        compute_type=os.environ.get("LCYT_STT_COMPUTE_TYPE"),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            host.load()
        except ModelLoadError:
            logger.exception("Model failed to load at startup; /health will report not-loaded until fixed")
        yield

    app = FastAPI(title="lcyt-stt", version="0.1.0", lifespan=lifespan)
    app.state.model_host = host
    app.state.queue = queue or InferenceQueue(max_queue=int(os.environ.get("LCYT_STT_MAX_QUEUE", "8")))
    app.state.default_language = os.environ.get("LCYT_STT_DEFAULT_LANGUAGE", "fi")

    @app.get("/health")
    async def health():
        host = app.state.model_host
        body = {
            "status": "ok" if host.loaded else "loading",
            "model_id": host.model_id,
            "device": host.device,
            "compute_type": host.compute_type,
            "loaded": host.loaded,
        }
        if not host.loaded:
            return JSONResponse(body, status_code=503)
        return body

    @app.post("/inference")
    async def inference(
        file: UploadFile = File(...),
        language: Optional[str] = Form(None),
        model: Optional[str] = Form(None),  # noqa: ARG001 - accepted for whisper.cpp compat; model switching is Phase 5
    ):
        host = app.state.model_host
        if not host.loaded:
            raise HTTPException(status_code=503, detail="Model not loaded yet")

        data = await file.read()
        lang = language or app.state.default_language

        try:
            with temp_audio_file(data, filename=file.filename, content_type=file.content_type) as path:
                result = await app.state.queue.run(host.transcribe, path, language=lang)
        except QueueFullError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        return result

    return app


app = create_app()
