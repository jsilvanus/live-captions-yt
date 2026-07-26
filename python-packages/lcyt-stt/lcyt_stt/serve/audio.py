"""Temp-file staging for uploaded audio segments.

faster-whisper decodes arbitrary containers (fMP4/AAC, WAV, ...) itself via
PyAV, so all this module does is write the uploaded bytes to a suffixed temp
file and clean it up afterwards — no separate ffmpeg subprocess needed here.
"""

import os
import tempfile
from contextlib import contextmanager


def _suffix_for(filename, content_type):
    if filename and "." in filename:
        return os.path.splitext(filename)[1]
    if content_type and "wav" in content_type:
        return ".wav"
    return ".mp4"


@contextmanager
def temp_audio_file(data, filename=None, content_type=None):
    suffix = _suffix_for(filename, content_type)
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        yield path
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
