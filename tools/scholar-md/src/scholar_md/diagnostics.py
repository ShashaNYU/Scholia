from __future__ import annotations

from typing import Any

from .models import DiagnosticEvent, DocumentPlan, ExtractedDocument, Footnote


def build_diagnostics(
    document: ExtractedDocument,
    footnotes: list[Footnote],
    plan: DocumentPlan | None = None,
    polish_stats: dict[str, int] | None = None,
    polish_warnings: list[str] | None = None,
) -> dict[str, Any]:
    events = list(document.diagnostics)
    for page in document.pages:
        events.append(
            DiagnosticEvent(
                kind="page_layout",
                message=f"Detected {page.columns} column(s); body font size {page.body_size:.2f}.",
                page=page.page_num,
                confidence=0.85,
            )
        )
        for line in page.lines:
            if line.region in {"header", "footer", "formula", "figure"}:
                events.append(
                    DiagnosticEvent(
                        kind=line.region,
                        message=f"{line.region} line: {line.text[:120]}",
                        page=page.page_num,
                        bbox=line.bbox,
                        confidence=line.confidence,
                    )
                )
            for warning in line.warnings:
                events.append(
                    DiagnosticEvent(
                        kind="warning",
                        message=warning,
                        page=page.page_num,
                        bbox=line.bbox,
                        confidence=line.confidence,
                        severity="warning",
                    )
                )
    for footnote in footnotes:
        events.append(
            DiagnosticEvent(
                kind="linked_note" if footnote.linked else "unlinked_note",
                message=f"Footnote {footnote.marker}: {footnote.content[:120]}",
                page=footnote.page_num,
                bbox=footnote.source_bbox,
                confidence=footnote.confidence,
                severity="warning" if footnote.warnings else "info",
            )
        )
    summary = {
        "bibliographic_citations": 0,
        "linked_notes": len([note for note in footnotes if note.linked]),
        "unlinked_notes": len([note for note in footnotes if not note.linked]),
        "unresolved_note_refs": 0,
        "reference_entries": 0,
        "spacing_fixes": polish_stats or {},
        "low_confidence_math": 0,
        "quarantined_lines": 0,
    }
    if plan is not None:
        summary.update(
            {
                "bibliographic_citations": plan.stats.get("bibliographic_citations", 0),
                "linked_notes": plan.stats.get("linked_notes", summary["linked_notes"]),
                "unlinked_notes": plan.stats.get("unlinked_notes", summary["unlinked_notes"]),
                "unresolved_note_refs": plan.stats.get("unresolved_note_refs", 0),
                "reference_entries": plan.stats.get("reference_entries", 0),
                "low_confidence_math": plan.stats.get("low_confidence_math", 0),
                "quarantined_lines": plan.stats.get("quarantined_lines", 0),
                "page_break_merges": plan.stats.get("page_break_merges", 0),
                "definition_gloss_blocks": plan.stats.get("definition_gloss_blocks", 0),
                "fraction_candidates": plan.stats.get("fraction_candidates", 0),
                "low_confidence_fraction": plan.stats.get("low_confidence_fraction", 0),
                "ordered_list_recovered": plan.stats.get("ordered_list_recovered", 0),
                "blockquote_blocks": plan.stats.get("blockquote_blocks", 0),
            }
        )
    for warning in polish_warnings or []:
        events.append(
            DiagnosticEvent(
                kind="polish_warning",
                message=warning,
                confidence=0.75,
                severity="warning",
            )
        )
    return {
        "schema_version": 1,
        "source_pdf": document.pdf_path,
        "metadata": document.metadata,
        "summary": summary,
        "pages": [
            {
                "page": page.page_num,
                "width": round(page.width, 2),
                "height": round(page.height, 2),
                "columns": page.columns,
                "body_size": round(page.body_size, 2),
                "footnote_separator_y": round(page.footnote_separator_y, 2)
                if page.footnote_separator_y is not None
                else None,
            }
            for page in document.pages
        ],
        "events": [event.to_dict() for event in events],
    }
