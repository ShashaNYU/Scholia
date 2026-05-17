from __future__ import annotations

import re

from .models import ReferenceEntry, TextLine
from .utils import clean_text

REFERENCE_SPLIT_RE = re.compile(r"(?=\[\d{1,4}\]\s)")
REFERENCE_MARKER_RE = re.compile(r"^\[(?P<marker>\d{1,4})\]\s*(?P<body>.*)")


def is_references_heading(text: str) -> bool:
    return bool(re.match(r"^references\b", clean_text(text), re.IGNORECASE))


def collect_reference_entries(lines: list[TextLine]) -> list[ReferenceEntry]:
    if not lines:
        return []
    text = "\n".join(clean_text(line.text) for line in lines if clean_text(line.text))
    text = re.sub(r"^references\b", "", text, flags=re.IGNORECASE).strip()
    chunks = [chunk.strip() for chunk in REFERENCE_SPLIT_RE.split(text) if chunk.strip()]
    entries: list[ReferenceEntry] = []
    for chunk in chunks:
        match = REFERENCE_MARKER_RE.match(chunk)
        if not match:
            if entries:
                entries[-1].text = clean_reference_text(f"{entries[-1].text} {chunk}")
            continue
        marker = match.group("marker")
        body = clean_reference_text(match.group("body"))
        entries.append(ReferenceEntry(marker=marker, text=body, anchor=f"ref-{int(marker):03d}"))
    return entries


def clean_reference_text(text: str) -> str:
    text = clean_text(text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    return text.strip()
