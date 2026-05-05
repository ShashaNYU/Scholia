from __future__ import annotations

import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from typing import Iterable, TypeVar

T = TypeVar("T")

LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
}

MOJIBAKE_REPLACEMENTS = {
    "â€™": "’",
    "â€˜": "‘",
    "â€œ": "“",
    "â€": "”",
    "â€“": "–",
    "â€”": "—",
    "â€¦": "…",
    "Â ": " ",
    "Â": "",
}

CONTROL_CHARS_RE = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]")


def normalize_unicode(text: str) -> str:
    """Normalize extraction artifacts while preserving typographic Unicode."""
    for bad, good in MOJIBAKE_REPLACEMENTS.items():
        text = text.replace(bad, good)
    for old, new in LIGATURES.items():
        text = text.replace(old, new)
    text = CONTROL_CHARS_RE.sub("", text)
    return unicodedata.normalize("NFC", text)


def clean_text(text: str) -> str:
    text = normalize_unicode(text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def merge_hyphenated_text(text: str) -> str:
    """Join line-break hyphenation without touching lexical hyphens."""
    return re.sub(r"(?<=[A-Za-zΑ-Ωα-ωÀ-ÖØ-öø-ÿ])-\n(?=[A-Za-zΑ-Ωα-ωÀ-ÖØ-öø-ÿ])", "", text)


def mode(values: Iterable[float], precision: float = 0.5, default: float = 0.0) -> float:
    rounded = [round(value / precision) * precision for value in values if value > 0]
    if not rounded:
        return default
    return Counter(rounded).most_common(1)[0][0]


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def first_existing(items: Iterable[T], default: T | None = None) -> T | None:
    for item in items:
        if item:
            return item
    return default
