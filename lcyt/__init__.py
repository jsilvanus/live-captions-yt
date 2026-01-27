"""LCYT - YouTube Live Caption Sender for Python.

A Python library to send live captions to YouTube streams using Google's
official closed caption API format.

Example:
    >>> from lcyt import YoutubeLiveCaptionSender
    >>> sender = YoutubeLiveCaptionSender(stream_key="YOUR_KEY")
    >>> sender.start()
    >>> sender.send("Hello, world!")
    >>> sender.end()
"""

from .sender import YoutubeLiveCaptionSender, Caption, SendResult
from .errors import LCYTError, ConfigError, NetworkError, ValidationError
from .config import (
    LCYTConfig,
    load_config,
    save_config,
    build_ingestion_url,
    get_default_config_path,
    DEFAULT_BASE_URL,
)

__version__ = "1.0.0"
__all__ = [
    # Main class
    "YoutubeLiveCaptionSender",
    # Data classes
    "Caption",
    "SendResult",
    "LCYTConfig",
    # Errors
    "LCYTError",
    "ConfigError",
    "NetworkError",
    "ValidationError",
    # Config utilities
    "load_config",
    "save_config",
    "build_ingestion_url",
    "get_default_config_path",
    "DEFAULT_BASE_URL",
]
