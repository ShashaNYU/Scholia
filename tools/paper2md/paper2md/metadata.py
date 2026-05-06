from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import fitz

KNOWN_VENUES = [
    "NeurIPS", "ICML", "ICLR", "CVPR", "ECCV", "ICCV", "ACL", "EMNLP",
    "NAACL", "AAAI", "IJCAI", "SIGKDD", "SIGIR", "WWW", "VLDB", "ICDE",
    "Nature", "Science", "Cell", "PLOS", "arXiv"
]

_ARXIV_RE = re.compile(r"arXiv[:\s](\d{4}\.\d{4,5})", re.IGNORECASE)
_DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")


@dataclass
class PaperMetadata:
    title: str = ""
    authors: list[str] = field(default_factory=list)
    year: str = ""
    venue: str = ""
    doi: str = ""
    arxiv: str = ""
    source_pdf: str = ""


def extract_metadata(pdf_path: Path) -> PaperMetadata:
    doc = fitz.open(pdf_path)
    meta = PaperMetadata(source_pdf=pdf_path.name)

    embedded = doc.metadata or {}
    if embedded.get("title"):
        meta.title = embedded["title"].strip()
    if embedded.get("author"):
        raw_authors = embedded["author"].strip()
        meta.authors = [a.strip() for a in re.split(r"[,;]", raw_authors) if a.strip()]

    if len(doc) > 0:
        first_page_text = doc[0].get_text("text")
        _extract_first_page(first_page_text, meta)

    doc.close()
    return meta


def _extract_first_page(text: str, meta: PaperMetadata) -> None:
    arxiv_m = _ARXIV_RE.search(text)
    if arxiv_m:
        meta.arxiv = arxiv_m.group(1)

    doi_m = _DOI_RE.search(text)
    if doi_m:
        meta.doi = doi_m.group(0).rstrip(".")

    year_matches = _YEAR_RE.findall(text)
    if year_matches and not meta.year:
        meta.year = min(year_matches, key=int)

    for venue in KNOWN_VENUES:
        if re.search(re.escape(venue), text, re.IGNORECASE):
            meta.venue = venue
            break
