"""Compatibility helpers for lcyt-backend."""


def import_sender():
    """Import YoutubeLiveCaptionSender from the lcyt library.

    Separated into a function to make it easy to mock in tests.

    Returns:
        YoutubeLiveCaptionSender class.
    """
    from lcyt import YoutubeLiveCaptionSender  # type: ignore[import]
    return YoutubeLiveCaptionSender
