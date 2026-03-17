"""Tests for lcyt configuration utilities (config.py)."""

import json
import pytest
from pathlib import Path

from lcyt.config import (
    LCYTConfig,
    DEFAULT_BASE_URL,
    load_config,
    save_config,
    build_ingestion_url,
    get_default_config_path,
)
from lcyt.errors import ConfigError


# ---------------------------------------------------------------------------
# LCYTConfig dataclass
# ---------------------------------------------------------------------------

class TestLCYTConfig:
    def test_defaults(self):
        cfg = LCYTConfig()
        assert cfg.stream_key == ""
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.region == "reg1"
        assert cfg.cue == "cue1"
        assert cfg.sequence == 0

    def test_custom_values(self):
        cfg = LCYTConfig(stream_key="MY_KEY", base_url="http://custom.test", sequence=5)
        assert cfg.stream_key == "MY_KEY"
        assert cfg.base_url == "http://custom.test"
        assert cfg.sequence == 5

    def test_to_dict_round_trips(self):
        cfg = LCYTConfig(stream_key="abc", region="reg2", cue="cue3", sequence=7)
        d = cfg.to_dict()
        assert d["stream_key"] == "abc"
        assert d["region"] == "reg2"
        assert d["cue"] == "cue3"
        assert d["sequence"] == 7

    def test_from_dict_snake_case(self):
        cfg = LCYTConfig.from_dict({"stream_key": "k1", "base_url": "http://x.test", "sequence": 3})
        assert cfg.stream_key == "k1"
        assert cfg.base_url == "http://x.test"
        assert cfg.sequence == 3

    def test_from_dict_camel_case(self):
        # JS config interop: camelCase keys should also work
        cfg = LCYTConfig.from_dict({"streamKey": "k2", "baseUrl": "http://y.test"})
        assert cfg.stream_key == "k2"
        assert cfg.base_url == "http://y.test"

    def test_from_dict_missing_keys_use_defaults(self):
        cfg = LCYTConfig.from_dict({})
        assert cfg.stream_key == ""
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.region == "reg1"

    def test_from_dict_snake_takes_priority_over_camel(self):
        # When both forms are present, snake_case wins
        cfg = LCYTConfig.from_dict({"stream_key": "snake", "streamKey": "camel"})
        assert cfg.stream_key == "snake"


# ---------------------------------------------------------------------------
# get_default_config_path
# ---------------------------------------------------------------------------

class TestGetDefaultConfigPath:
    def test_returns_path_in_home(self):
        path = get_default_config_path()
        assert isinstance(path, Path)
        assert path.name == ".lcyt-config.json"
        assert path.parent == Path.home()


# ---------------------------------------------------------------------------
# build_ingestion_url
# ---------------------------------------------------------------------------

class TestBuildIngestionUrl:
    def test_builds_url_with_stream_key(self):
        cfg = LCYTConfig(stream_key="MY_KEY")
        url = build_ingestion_url(cfg)
        assert "MY_KEY" in url
        assert url.startswith("http")

    def test_uses_default_base_url(self):
        cfg = LCYTConfig(stream_key="K")
        url = build_ingestion_url(cfg)
        assert url.startswith(DEFAULT_BASE_URL)
        assert "cid=K" in url

    def test_uses_custom_base_url(self):
        cfg = LCYTConfig(stream_key="K", base_url="http://custom.test/cc")
        url = build_ingestion_url(cfg)
        assert url.startswith("http://custom.test/cc")
        assert "cid=K" in url

    def test_raises_config_error_when_no_stream_key(self):
        cfg = LCYTConfig(stream_key="")
        with pytest.raises(ConfigError):
            build_ingestion_url(cfg)


# ---------------------------------------------------------------------------
# load_config
# ---------------------------------------------------------------------------

class TestLoadConfig:
    def test_returns_default_config_when_file_does_not_exist(self, tmp_path):
        path = tmp_path / "nonexistent.json"
        cfg = load_config(path)
        assert isinstance(cfg, LCYTConfig)
        assert cfg.stream_key == ""

    def test_loads_config_from_file(self, tmp_path):
        path = tmp_path / "config.json"
        path.write_text(json.dumps({"stream_key": "LOADED_KEY", "sequence": 10}))
        cfg = load_config(path)
        assert cfg.stream_key == "LOADED_KEY"
        assert cfg.sequence == 10

    def test_raises_config_error_for_invalid_json(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text("not valid json {{{")
        with pytest.raises(ConfigError, match="Invalid JSON"):
            load_config(path)

    def test_accepts_string_path(self, tmp_path):
        path = tmp_path / "cfg.json"
        path.write_text(json.dumps({"stream_key": "STRING_PATH_KEY"}))
        cfg = load_config(str(path))
        assert cfg.stream_key == "STRING_PATH_KEY"

    def test_uses_default_path_when_none_given(self, tmp_path, monkeypatch):
        # Point home() to tmp_path so we don't touch the real ~/.lcyt-config.json
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        # File doesn't exist — should return defaults
        cfg = load_config(None)
        assert isinstance(cfg, LCYTConfig)

    def test_loads_camelcase_keys_from_file(self, tmp_path):
        path = tmp_path / "js-config.json"
        path.write_text(json.dumps({"streamKey": "JS_KEY", "baseUrl": "http://js.test"}))
        cfg = load_config(path)
        assert cfg.stream_key == "JS_KEY"
        assert cfg.base_url == "http://js.test"


# ---------------------------------------------------------------------------
# save_config
# ---------------------------------------------------------------------------

class TestSaveConfig:
    def test_saves_config_to_file(self, tmp_path):
        path = tmp_path / "out.json"
        cfg = LCYTConfig(stream_key="SAVED_KEY", sequence=3)
        save_config(cfg, path)

        assert path.exists()
        data = json.loads(path.read_text())
        assert data["stream_key"] == "SAVED_KEY"
        assert data["sequence"] == 3

    def test_saved_file_is_loadable(self, tmp_path):
        path = tmp_path / "roundtrip.json"
        original = LCYTConfig(stream_key="RT_KEY", region="reg2", sequence=99)
        save_config(original, path)
        loaded = load_config(path)
        assert loaded.stream_key == original.stream_key
        assert loaded.region == original.region
        assert loaded.sequence == original.sequence

    def test_accepts_string_path(self, tmp_path):
        path = str(tmp_path / "str.json")
        save_config(LCYTConfig(stream_key="STR_KEY"), path)
        assert Path(path).exists()

    def test_raises_config_error_for_unwritable_path(self, tmp_path):
        path = tmp_path / "nodir" / "config.json"
        # Parent directory does not exist → OSError
        with pytest.raises(ConfigError, match="Cannot write"):
            save_config(LCYTConfig(), path)
