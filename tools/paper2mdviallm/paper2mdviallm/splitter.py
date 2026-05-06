from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import fitz


@dataclass
class ChunkSpec:
    path: Path
    start: int
    end: int
    context_pages: int
    chunk_idx: int
    total: int


def detect_chapter_boundaries(doc: fitz.Document) -> list[int] | None:
    toc = doc.get_toc()
    top_level = [entry for entry in toc if entry[0] == 1]
    if len(top_level) >= 2:
        pages = sorted({entry[2] - 1 for entry in top_level})
        if pages[0] != 0:
            pages.insert(0, 0)
        return pages

    heading_re = re.compile(r"^(\d+\.?\s+[A-Z]|[IVX]+\.\s+)")
    boundaries = [0]
    for page_num in range(1, len(doc)):
        page = doc[page_num]
        first_line = page.get_text("text").strip().split("\n")[0].strip()
        if heading_re.match(first_line):
            boundaries.append(page_num)

    return boundaries if len(boundaries) >= 2 else None


def split_pdf(
    pdf_path: Path,
    output_dir: Path,
    chunk_size: int = 10,
    overlap: int = 1,
    single_pass_threshold: int = 12
) -> list[ChunkSpec]:
    doc = fitz.open(pdf_path)
    n_pages = len(doc)

    if n_pages <= single_pass_threshold:
        return [
            ChunkSpec(
                path=pdf_path,
                start=0,
                end=n_pages - 1,
                context_pages=0,
                chunk_idx=0,
                total=1
            )
        ]

    boundaries = detect_chapter_boundaries(doc) or list(range(0, n_pages, chunk_size))

    output_dir.mkdir(parents=True, exist_ok=True)
    specs: list[ChunkSpec] = []
    total = len(boundaries)

    for i, start in enumerate(boundaries):
        end = boundaries[i + 1] - 1 if i + 1 < total else n_pages - 1
        ctx_start = max(0, start - overlap) if i > 0 else start

        sub = fitz.open()
        sub.insert_pdf(doc, from_page=ctx_start, to_page=end)
        sub_path = output_dir / f"chunk_{i:03d}.pdf"
        sub.save(sub_path)
        sub.close()

        specs.append(
            ChunkSpec(
                path=sub_path,
                start=start,
                end=end,
                context_pages=(start - ctx_start),
                chunk_idx=i,
                total=total
            )
        )

    doc.close()
    return specs
