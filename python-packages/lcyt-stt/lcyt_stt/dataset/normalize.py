"""Finnish text normalization for training utterances.

Whisper is case-sensitive, so casing and Finnish orthography (ä/ö, compound
hyphens) are preserved; this only cleans whitespace/prompt-export artifacts
and NFC-normalizes unicode.
"""

import re
import unicodedata


def normalize_text(text):
    if text is None:
        return text
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\\n", " ").replace("\r", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()
