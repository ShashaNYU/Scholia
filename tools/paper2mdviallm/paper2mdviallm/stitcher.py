from __future__ import annotations

import re
from dataclasses import dataclass

_FOOTNOTES_HEADER_RE = re.compile(r"^##\s+Footnotes\s*$", re.MULTILINE)
_FN_DEF_RE = re.compile(r"^\\?\[\^(fn\d+)\\?\]:\s*(.*?)(\s*\^fn-\d+)?\s*$", re.MULTILINE)
_FN_REF_RE = re.compile(r"\\?\[\^(fn\d+)\\?\](?!\s*:)")


@dataclass
class FootnoteDef:
    new_id: str
    content: str


def split_body_and_footnotes(text: str) -> tuple[str, list[tuple[str, str]]]:
    match = _FOOTNOTES_HEADER_RE.search(text)
    if match:
        body = text[:match.start()].rstrip()
        footnote_block = text[match.end():]
    else:
        body = text.rstrip()
        footnote_block = ""

    defs = []
    for m in _FN_DEF_RE.finditer(footnote_block):
        defs.append((m.group(1), m.group(2).strip()))

    return body, defs


def renumber_footnotes(chunks: list[str]) -> tuple[str, list[FootnoteDef]]:
    all_defs: list[FootnoteDef] = []
    counter = 1
    rebuilt_chunks: list[str] = []

    for chunk in chunks:
        body, defs = split_body_and_footnotes(chunk)
        mapping: dict[str, str] = {}
        for old_id, content in defs:
            new_id = f"fn{counter}"
            mapping[old_id] = new_id
            all_defs.append(FootnoteDef(new_id=new_id, content=content))
            counter += 1

        def replace_ref(m: re.Match) -> str:
            old = m.group(1)
            return f"[^{mapping.get(old, old)}]"

        body = _FN_REF_RE.sub(replace_ref, body)
        rebuilt_chunks.append(body)

    return "\n\n".join(rebuilt_chunks), all_defs


def _is_continuation(tail_a: str, head_b: str) -> bool:
    tail = tail_a.rstrip()
    head = head_b.lstrip()
    if not tail or not head:
        return False
    sentence_terminal = tail[-1] in ".!?"
    starts_new = bool(re.match(r"[A-Z#\-*\d]", head))
    return not sentence_terminal and not starts_new


def _dedup_overlap(a: str, b: str, window: int = 200) -> str:
    tail = a[-window:]
    head = b[:window]

    best_len = 0
    for length in range(min(len(tail), len(head)), 4, -1):
        if tail.endswith(head[:length]):
            best_len = length
            break

    if best_len > 0:
        return b[best_len:]
    return b


def stitch(chunks: list[str]) -> str:
    if not chunks:
        return ""

    renumbered_bodies: list[str] = []
    counter = 1
    all_defs: list[FootnoteDef] = []
    for chunk in chunks:
        body, defs = split_body_and_footnotes(chunk)
        mapping: dict[str, str] = {}
        for old_id, content in defs:
            new_id = f"fn{counter}"
            mapping[old_id] = new_id
            all_defs.append(FootnoteDef(new_id=new_id, content=content))
            counter += 1

        def replace_ref(m: re.Match, _mapping: dict = mapping) -> str:
            old = m.group(1)
            return f"[^{_mapping.get(old, old)}]"

        body = _FN_REF_RE.sub(replace_ref, body)
        renumbered_bodies.append(body.strip())

    result_parts: list[str] = [renumbered_bodies[0]]
    for i in range(1, len(renumbered_bodies)):
        prev = result_parts[-1]
        curr = _dedup_overlap(prev, renumbered_bodies[i])

        tail_a = prev[-50:] if len(prev) >= 50 else prev
        head_b = curr[:50] if len(curr) >= 50 else curr

        if _is_continuation(tail_a, head_b):
            result_parts[-1] = prev.rstrip() + " " + curr.lstrip()
        else:
            result_parts.append(curr)

    stitched_body = "\n\n".join(result_parts)

    if not all_defs:
        return stitched_body

    footnote_lines = ["", "## Footnotes", ""]
    for footnote in all_defs:
        n = footnote.new_id[2:]
        footnote_lines.append(f"[^{footnote.new_id}]: {footnote.content} ^fn-{n}")

    return stitched_body + "\n" + "\n".join(footnote_lines)
