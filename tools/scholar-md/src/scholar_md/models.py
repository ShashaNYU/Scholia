from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median
from typing import Any


@dataclass(frozen=True)
class BBox:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def height(self) -> float:
        return max(0.0, self.y1 - self.y0)

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    def to_list(self) -> list[float]:
        return [round(self.x0, 2), round(self.y0, 2), round(self.x1, 2), round(self.y1, 2)]

    @staticmethod
    def union(boxes: list["BBox"]) -> "BBox":
        if not boxes:
            return BBox(0, 0, 0, 0)
        return BBox(
            min(box.x0 for box in boxes),
            min(box.y0 for box in boxes),
            max(box.x1 for box in boxes),
            max(box.y1 for box in boxes),
        )


@dataclass
class TextSpan:
    text: str
    bbox: BBox
    font: str = ""
    size: float = 0.0
    flags: int = 0
    page_num: int = 0
    block_id: int = 0
    line_id: int = 0
    is_bold: bool = False
    is_italic: bool = False
    region: str = "body"
    role: str = ""
    confidence: float = 1.0
    warnings: list[str] = field(default_factory=list)

    @property
    def normalized_font(self) -> str:
        return self.font.split("+")[-1].lower()

    def diagnostic_bbox(self) -> list[float]:
        return self.bbox.to_list()


@dataclass
class TextLine:
    spans: list[TextSpan]
    page_num: int
    line_id: int
    bbox: BBox
    text: str
    font_size: float
    is_bold: bool = False
    region: str = "body"
    column: int = 0
    confidence: float = 1.0
    warnings: list[str] = field(default_factory=list)

    @classmethod
    def from_spans(cls, spans: list[TextSpan], page_num: int, line_id: int) -> "TextLine":
        ordered = sorted(spans, key=lambda span: (span.bbox.x0, span.bbox.y0))
        text = join_span_text(ordered)
        sizes = [span.size for span in ordered if span.size > 0]
        for span in ordered:
            span.line_id = line_id
        return cls(
            spans=ordered,
            page_num=page_num,
            line_id=line_id,
            bbox=BBox.union([span.bbox for span in ordered]),
            text=text,
            font_size=median(sizes) if sizes else 0.0,
            is_bold=any(span.is_bold for span in ordered),
        )

    def set_region(self, region: str, confidence: float = 1.0, warning: str | None = None) -> None:
        self.region = region
        self.confidence = min(self.confidence, confidence)
        if warning:
            self.warnings.append(warning)
        for span in self.spans:
            span.region = region
            span.confidence = min(span.confidence, confidence)
            if warning:
                span.warnings.append(warning)


@dataclass
class ImageRegion:
    page_num: int
    bbox: BBox
    kind: str = "image"
    caption: str = ""


@dataclass
class PageLayout:
    page_num: int
    width: float
    height: float
    lines: list[TextLine] = field(default_factory=list)
    images: list[ImageRegion] = field(default_factory=list)
    horizontal_rules: list[BBox] = field(default_factory=list)
    body_size: float = 0.0
    columns: int = 1
    footnote_separator_y: float | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class Footnote:
    marker: str
    content: str
    page_num: int
    source_line_id: int | None = None
    source_bbox: BBox | None = None
    anchor: str = ""
    label: str = ""
    linked: bool = False
    kind: str = "footnote"
    confidence: float = 0.8
    warnings: list[str] = field(default_factory=list)


@dataclass
class DiagnosticEvent:
    kind: str
    message: str
    page: int | None = None
    bbox: BBox | None = None
    confidence: float = 1.0
    severity: str = "info"

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "kind": self.kind,
            "message": self.message,
            "confidence": round(self.confidence, 3),
            "severity": self.severity,
        }
        if self.page is not None:
            data["page"] = self.page
        if self.bbox is not None:
            data["source_bbox"] = self.bbox.to_list()
        return data


@dataclass
class ExtractedDocument:
    pdf_path: str
    metadata: dict[str, Any]
    pages: list[PageLayout]
    diagnostics: list[DiagnosticEvent] = field(default_factory=list)


@dataclass
class InlineMarker:
    kind: str
    marker: str
    page_num: int
    line_id: int
    bbox: BBox
    confidence: float = 1.0


@dataclass
class MathRun:
    text: str
    bbox: BBox
    display: bool = False
    confidence: float = 1.0
    warnings: list[str] = field(default_factory=list)


@dataclass
class ReferenceEntry:
    marker: str
    text: str
    page_num: int | None = None
    anchor: str = ""


@dataclass
class DocumentNode:
    kind: str
    text: str = ""
    page_num: int | None = None
    lines: list[TextLine] = field(default_factory=list)
    level: int = 0
    list_kind: str = "unordered"
    list_level: int = 0
    list_index: int = 0
    list_marker: str = ""
    confidence: float = 1.0
    warnings: list[str] = field(default_factory=list)


@dataclass
class NoteProfile:
    has_numeric_bibliography: bool = False
    has_page_footnotes: bool = False
    has_endnotes: bool = False
    bibliography_markers: set[str] = field(default_factory=set)


@dataclass
class DocumentPlan:
    nodes: list[DocumentNode]
    footnotes: list[Footnote] = field(default_factory=list)
    references: list[ReferenceEntry] = field(default_factory=list)
    inline_markers: list[InlineMarker] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)


def join_span_text(spans: list[TextSpan]) -> str:
    pieces: list[str] = []
    previous: TextSpan | None = None
    for span in spans:
        text = span.text
        if not text:
            continue
        if previous is not None and should_insert_span_space(previous, span, text):
            pieces.append(" ")
        pieces.append(text)
        previous = span
    return "".join(pieces)


def should_insert_span_space(previous: TextSpan, current: TextSpan, current_text: str) -> bool:
    if current_text.startswith((" ", "\n", "\t")) or previous.text.endswith((" ", "\n", "\t")):
        return False
    if current_text[:1] in ",.;:!?)]}":
        return False
    gap = current.bbox.x0 - previous.bbox.x1
    threshold = max(1.2, min(previous.size or 8, current.size or 8) * 0.18)
    return gap > threshold
