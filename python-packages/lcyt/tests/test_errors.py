"""Tests for lcyt error hierarchy (errors.py)."""

import pytest

from lcyt.errors import LCYTError, ConfigError, NetworkError, ValidationError


class TestErrorHierarchy:
    def test_lcyt_error_is_exception(self):
        err = LCYTError("base error")
        assert isinstance(err, Exception)
        assert str(err) == "base error"

    def test_config_error_inherits_lcyt_error(self):
        err = ConfigError("bad config")
        assert isinstance(err, LCYTError)
        assert isinstance(err, Exception)
        assert str(err) == "bad config"

    def test_network_error_inherits_lcyt_error(self):
        err = NetworkError("connection failed")
        assert isinstance(err, LCYTError)

    def test_validation_error_inherits_lcyt_error(self):
        err = ValidationError("invalid input")
        assert isinstance(err, LCYTError)


class TestNetworkError:
    def test_default_status_code_is_none(self):
        err = NetworkError("oops")
        assert err.status_code is None

    def test_status_code_stored(self):
        err = NetworkError("Not Found", 404)
        assert err.status_code == 404
        assert str(err) == "Not Found"

    def test_status_code_400(self):
        err = NetworkError("Bad Request", 400)
        assert err.status_code == 400

    def test_status_code_500(self):
        err = NetworkError("Server Error", 500)
        assert err.status_code == 500


class TestValidationError:
    def test_default_field_is_none(self):
        err = ValidationError("required")
        assert err.field is None

    def test_field_stored(self):
        err = ValidationError("Stream key is required", field="stream_key")
        assert err.field == "stream_key"
        assert str(err) == "Stream key is required"

    def test_field_text(self):
        err = ValidationError("Cannot be empty", field="text")
        assert err.field == "text"


class TestCatchingByBase:
    def test_catch_config_error_as_lcyt_error(self):
        with pytest.raises(LCYTError):
            raise ConfigError("catch me")

    def test_catch_network_error_as_lcyt_error(self):
        with pytest.raises(LCYTError):
            raise NetworkError("network fail", 503)

    def test_catch_validation_error_as_lcyt_error(self):
        with pytest.raises(LCYTError):
            raise ValidationError("bad field", field="x")
