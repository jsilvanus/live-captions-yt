"""Custom exception classes for LCYT."""


class LCYTError(Exception):
    """Base exception class for LCYT errors."""

    pass


class ConfigError(LCYTError):
    """Configuration-related errors."""

    pass


class NetworkError(LCYTError):
    """Network/HTTP errors."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class ValidationError(LCYTError):
    """Input validation errors."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field
