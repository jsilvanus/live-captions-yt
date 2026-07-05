import logging
import sys

_logger = logging.getLogger("lcyt")
_handler: logging.StreamHandler | None = None


def set_use_stderr(value: bool) -> None:
    """Route lcyt log output to stderr (for MCP/pipeline compatibility)."""
    global _handler
    if _handler is not None:
        _logger.removeHandler(_handler)
        _handler = None

    if value:
        _handler = logging.StreamHandler(sys.stderr)
        _handler.setFormatter(logging.Formatter("[LCYT] %(message)s"))
        _logger.addHandler(_handler)
        _logger.propagate = False
        if _logger.level == logging.NOTSET:
            _logger.setLevel(logging.DEBUG)
    else:
        _logger.propagate = True


def set_silent(value: bool) -> None:
    """Suppress all lcyt log output."""
    _logger.setLevel(logging.CRITICAL + 1 if value else logging.DEBUG)
