from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import BBox, DiagnosticEvent, ExtractedDocument, ImageRegion, PageLayout, TextLine, TextSpan
from .utils import utc_timestamp


def require_fitz() -> Any:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "PyMuPDF is required for PDF extraction. Install with: "
            "tools/scholar-md/bootstrap.sh"
        ) from exc
    return fitz


def extract_pdf(pdf_path: str | Path) -> ExtractedDocument:
    fitz = require_fitz()
    path = Path(pdf_path)
    doc = fitz.open(path)
    diagnostics: list[DiagnosticEvent] = []
    metadata = extract_metadata(doc)
    metadata.update(
        {
            "converted_by": "scholar-md",
            "converted_at": utc_timestamp(),
            "source_pdf": path.name,
        }
    )

    pages: list[PageLayout] = []
    for page_num, page in enumerate(doc):
        page_layout = PageLayout(
            page_num=page_num + 1,
            width=float(page.rect.width),
            height=float(page.rect.height),
        )
        page_layout.horizontal_rules = extract_horizontal_rules(page, page_num + 1)
        blocks = page.get_text("dict").get("blocks", [])
        line_counter = 0
        for block_id, block in enumerate(blocks):
            block_type = block.get("type")
            if block_type == 1:
                bbox = BBox(*[float(value) for value in block.get("bbox", (0, 0, 0, 0))])
                page_layout.images.append(ImageRegion(page_num=page_num + 1, bbox=bbox))
                diagnostics.append(
                    DiagnosticEvent(
                        kind="image_placeholder",
                        message="Image block detected; MVP will emit a placeholder if caption context is available.",
                        page=page_num + 1,
                        bbox=bbox,
                        confidence=0.7,
                    )
                )
                continue
            if block_type != 0:
                continue
            for raw_line in block.get("lines", []):
                spans: list[TextSpan] = []
                for raw_span in raw_line.get("spans", []):
                    text = raw_span.get("text", "")
                    if not text:
                        continue
                    flags = int(raw_span.get("flags", 0))
                    bbox = BBox(*[float(value) for value in raw_span.get("bbox", (0, 0, 0, 0))])
                    spans.append(
                        TextSpan(
                            text=text,
                            bbox=bbox,
                            font=str(raw_span.get("font", "")),
                            size=float(raw_span.get("size", 0.0)),
                            flags=flags,
                            page_num=page_num + 1,
                            block_id=block_id,
                            line_id=line_counter,
                            is_bold=bool(flags & 2**4),
                            is_italic=bool(flags & 2**1),
                        )
                    )
                if spans:
                    page_layout.lines.append(TextLine.from_spans(spans, page_num + 1, line_counter))
                    line_counter += 1
        pages.append(page_layout)

    return ExtractedDocument(pdf_path=str(path), metadata=metadata, pages=pages, diagnostics=diagnostics)


def extract_metadata(doc: Any) -> dict[str, Any]:
    meta = doc.metadata or {}
    producer = str(meta.get("producer", "") or "").lower()
    creator = str(meta.get("creator", "") or "").lower()
    source_blob = f"{producer} {creator}"
    source_tool = "unknown"
    if any(key in source_blob for key in ("pdftex", "xetex", "luatex", "latex")):
        source_tool = "latex"
    elif any(key in source_blob for key in ("microsoft", "word")):
        source_tool = "word"
    elif "indesign" in source_blob:
        source_tool = "indesign"
    return {
        "title": meta.get("title", "") or "",
        "author": meta.get("author", "") or "",
        "source_tool": source_tool,
        "page_count": len(doc),
        "producer": meta.get("producer", "") or "",
    }


def extract_horizontal_rules(page: Any, page_num: int) -> list[BBox]:
    rules: list[BBox] = []
    try:
        drawings = page.get_drawings()
    except Exception:
        return rules
    for drawing in drawings:
        for item in drawing.get("items", []):
            if not item or item[0] != "l":
                continue
            _, p1, p2 = item
            if abs(p1.y - p2.y) <= 1.5 and abs(p2.x - p1.x) > 12:
                rules.append(BBox(float(min(p1.x, p2.x)), float(p1.y), float(max(p1.x, p2.x)), float(p2.y)))
    return rules
