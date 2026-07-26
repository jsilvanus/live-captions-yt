"""faster-whisper model loading with GPU auto-detect and CPU int8 fallback."""

import logging

logger = logging.getLogger(__name__)


class ModelLoadError(Exception):
    pass


class ModelHost:
    """Lazily loads and holds a single faster-whisper WhisperModel instance.

    Device selection tries CUDA/float16 first (unless a specific device was
    requested), falling back to CPU/int8 — both are inside the STT latency
    budget (see docs/plans/plan_local_stt.md), so silently degrading to CPU
    rather than failing startup is the right default for `device="auto"`.
    """

    def __init__(self, model_id, model_dir=None, device="auto", compute_type=None):
        self.model_id = model_id
        self.model_dir = model_dir
        self._requested_device = device
        self._requested_compute_type = compute_type
        self.device = None
        self.compute_type = None
        self.model = None
        self.loaded = False

    def load(self):
        from faster_whisper import WhisperModel

        last_error = None
        for device, compute_type in self._device_attempts():
            try:
                logger.info("Loading faster-whisper model %s on %s/%s", self.model_id, device, compute_type)
                self.model = WhisperModel(
                    self.model_id,
                    device=device,
                    compute_type=compute_type,
                    download_root=self.model_dir,
                )
                self.device = device
                self.compute_type = compute_type
                self.loaded = True
                return
            except Exception as exc:  # noqa: BLE001 - any backend init failure should fall through to the next device
                last_error = exc
                logger.warning("Failed to load model on %s/%s: %s", device, compute_type, exc)
        raise ModelLoadError(f"Could not load model '{self.model_id}' on any device") from last_error

    def _device_attempts(self):
        if self._requested_device == "cuda":
            return [("cuda", self._requested_compute_type or "float16")]
        if self._requested_device == "cpu":
            return [("cpu", self._requested_compute_type or "int8")]
        return [
            ("cuda", self._requested_compute_type or "float16"),
            ("cpu", self._requested_compute_type or "int8"),
        ]

    def transcribe(self, audio_path, language=None):
        if not self.loaded:
            raise RuntimeError("Model is not loaded yet")
        segments, info = self.model.transcribe(audio_path, language=language)
        segments = list(segments)
        text = "".join(segment.text for segment in segments).strip()
        return {
            "text": text,
            "language": (info.language if info else None) or language,
            "segments": [
                {"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments
            ],
        }
