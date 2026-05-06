from __future__ import annotations

import logging
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

import fitz

log = logging.getLogger(__name__)

_FN_MARKER_RE = re.compile(r"\[\^fn\d+\](?!:)")
_WORD_RE = re.compile(r"\b\w+\b")


@dataclass
class VerificationResult:
    word_ratio: float = 0.0
    ngram_recall: float = 0.0
    footnote_match: bool = True
    warnings: list[str] = field(default_factory=list)
    passed: bool = True
    missing_passages: list[str] = field(default_factory=list)


def _extract_pdf_words(pdf_path: Path) -> list[str]:
    doc = fitz.open(pdf_path)
    words = []
    for page in doc:
        words.extend(_WORD_RE.findall(page.get_text("text")))
    doc.close()
    return words


def _md_words(md: str) -> list[str]:
    text = re.sub(r"^---\n.*?\n---\n", "", md, flags=re.DOTALL)
    text = re.sub(r"\$\$.*?\$\$", " ", text, flags=re.DOTALL)
    text = re.sub(r"\$.*?\$", " ", text)
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"[#\*`_\\>|]", " ", text)
    return _WORD_RE.findall(text)


def _ngram_recall(pdf_words: list[str], md_words: list[str], n: int = 5, samples: int = 100) -> tuple[float, list[str]]:
    if len(pdf_words) < n:
        return 1.0, []

    md_text = " ".join(word.lower() for word in md_words)
    indices = random.sample(range(len(pdf_words) - n + 1), min(samples, len(pdf_words) - n + 1))
    missing = []
    found = 0

    for idx in indices:
        gram = " ".join(word.lower() for word in pdf_words[idx:idx + n])
        if gram in md_text:
            found += 1
        else:
            missing.append(" ".join(pdf_words[idx:idx + n]))

    recall = found / len(indices) if indices else 1.0
    return recall, missing


def _count_pdf_footnotes(pdf_path: Path) -> int:
    doc = fitz.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text("text")
    doc.close()
    markers = re.findall(r"[\*†‡§¶]|\b\d{1,2}\b(?=\s*[\n\.])", text)
    return len(markers)


def verify(pdf_path: Path, md: str) -> VerificationResult:
    result = VerificationResult()

    pdf_words = _extract_pdf_words(pdf_path)
    md_words = _md_words(md)

    if pdf_words:
        result.word_ratio = len(md_words) / len(pdf_words)
        if not (0.85 <= result.word_ratio <= 1.15):
            result.warnings.append(
                f"Word count ratio {result.word_ratio:.2f} outside [0.85, 1.15] "
                f"(PDF: {len(pdf_words)}, MD: {len(md_words)})"
            )
            result.passed = False

    recall, missing = _ngram_recall(pdf_words, md_words)
    result.ngram_recall = recall
    if recall < 0.90:
        result.warnings.append(f"n-gram recall {recall:.2%} below 90% threshold")
        result.missing_passages = missing[:10]
        result.passed = False

    md_fn_count = len(_FN_MARKER_RE.findall(md))
    pdf_fn_count = _count_pdf_footnotes(pdf_path)
    result.footnote_match = md_fn_count == pdf_fn_count
    if not result.footnote_match:
        result.warnings.append(f"Footnote count mismatch: PDF heuristic={pdf_fn_count}, MD={md_fn_count}")

    for warning in result.warnings:
        log.warning("[verifier] %s", warning)

    return result
