from __future__ import annotations

from dataclasses import dataclass

from .models import DiagnosticEvent, ExtractedDocument


@dataclass
class LLMConfig:
    provider: str = "none"
    model: str | None = None
    api_key: str | None = None


def review_low_confidence_regions(document: ExtractedDocument, config: LLMConfig) -> ExtractedDocument:
    """Placeholder for targeted low-confidence review.

    The MVP deliberately avoids whole-document rewriting. Provider wiring is
    kept here so the CLI contract is stable while conversion remains rule-first.
    """
    if config.provider != "none":
        document.diagnostics.append(
            DiagnosticEvent(
                kind="llm_skipped",
                message="LLM review is reserved for low-confidence regions and is not enabled in this MVP.",
                confidence=1.0,
                severity="warning",
            )
        )
    return document
