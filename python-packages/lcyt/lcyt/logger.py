import logging
import sys

_logger = logging.getLogger("lcyt")
_handler: logging.StreamHandler | None = None


def set_use_stderr(value: bool) -> None:
    """Route lcyt log output to stderr for MCP/pipeline compatibility.

    Pass True to send log records to stderr instead of the default propagation path,
    which helps keep stdout free for MCP transports. Pass False to restore the
    default propagation behavior.
    """
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
    """Suppress or restore lcyt log output globally.

    Pass True to silence all lcyt loggers, including those created by other modules.
    Pass False to restore the default DEBUG-level logging behavior.
    """
    _logger.disabled = value
    if not value:
        _logger.setLevel(logging.DEBUG)
