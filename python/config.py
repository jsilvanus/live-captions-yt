"""Configuration management for LCYT."""

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from .errors import ConfigError

DEFAULT_BASE_URL = "http://upload.youtube.com/closedcaption"
DEFAULT_CONFIG_FILENAME = ".lcyt-config.json"


@dataclass
class LCYTConfig:
    """Configuration for YouTube Live Caption Sender."""

    stream_key: str = ""
    base_url: str = DEFAULT_BASE_URL
    region: str = "reg1"
    cue: str = "cue1"
    sequence: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert config to dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LCYTConfig":
        """Create config from dictionary."""
        # Handle camelCase keys from JS config
        return cls(
            stream_key=data.get("stream_key", data.get("streamKey", "")),
            base_url=data.get("base_url", data.get("baseUrl", DEFAULT_BASE_URL)),
            region=data.get("region", "reg1"),
            cue=data.get("cue", "cue1"),
            sequence=data.get("sequence", 0),
        )


def get_default_config_path() -> Path:
    """Get the default config file path (~/.lcyt-config.json)."""
    return Path.home() / DEFAULT_CONFIG_FILENAME


def load_config(config_path: Path | str | None = None) -> LCYTConfig:
    """Load configuration from file.

    Args:
        config_path: Path to config file. If None, uses default path.

    Returns:
        LCYTConfig instance.

    Raises:
        ConfigError: If config file exists but cannot be parsed.
    """
    if config_path is None:
        config_path = get_default_config_path()
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        return LCYTConfig()

    try:
        with open(config_path) as f:
            data = json.load(f)
        return LCYTConfig.from_dict(data)
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in config file: {e}") from e
    except OSError as e:
        raise ConfigError(f"Cannot read config file: {e}") from e


def save_config(config: LCYTConfig, config_path: Path | str | None = None) -> None:
    """Save configuration to file.

    Args:
        config: LCYTConfig instance to save.
        config_path: Path to config file. If None, uses default path.

    Raises:
        ConfigError: If config cannot be saved.
    """
    if config_path is None:
        config_path = get_default_config_path()
    else:
        config_path = Path(config_path)

    try:
        with open(config_path, "w") as f:
            json.dump(config.to_dict(), f, indent=2)
    except OSError as e:
        raise ConfigError(f"Cannot write config file: {e}") from e


def build_ingestion_url(config: LCYTConfig) -> str:
    """Build the full ingestion URL from config.

    Args:
        config: LCYTConfig instance.

    Returns:
        Full ingestion URL with stream key.
    """
    if not config.stream_key:
        raise ConfigError("Stream key is required")
    return f"{config.base_url}?cid={config.stream_key}"
