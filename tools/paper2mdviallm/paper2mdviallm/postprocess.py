from __future__ import annotations

import re
from datetime import date

from .metadata import PaperMetadata


def _is_md_link_start(md: str, i: int) -> bool:
    j = i + 1
    n = len(md)
    depth = 1
    while j < n and depth > 0:
        if md[j] == "[":
            depth += 1
        elif md[j] == "]":
            depth -= 1
        j += 1
    return j < n and md[j] == "("


def _is_wikilink_start(md: str, i: int) -> bool:
    return md.startswith("[[", i) and md.find("]]", i + 2) != -1


def normalize_escaped_math_brackets(md: str) -> str:
    out: list[str] = []
    i, n = 0, len(md)
    in_math_inline = False
    in_math_block = False
    in_code_inline = False
    in_code_block = False

    while i < n:
        if md.startswith("```", i) and not (in_math_inline or in_math_block or in_code_inline):
            in_code_block = not in_code_block
            out.append("```")
            i += 3
            continue

        ch = md[i]

        if ch == "`" and not (in_code_block or in_math_inline or in_math_block):
            in_code_inline = not in_code_inline
            out.append(ch)
            i += 1
            continue

        if md.startswith("$$", i) and not (in_code_block or in_code_inline):
            in_math_block = not in_math_block
            out.append("$$")
            i += 2
            continue

        if ch == "$" and not (in_code_block or in_code_inline or in_math_block):
            in_math_inline = not in_math_inline
            out.append(ch)
            i += 1
            continue

        if (in_math_inline or in_math_block) and md.startswith(r"\[", i):
            out.append("[")
            i += 2
            continue

        if (in_math_inline or in_math_block) and md.startswith(r"\]", i):
            out.append("]")
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def escape_brackets(md: str) -> str:
    out: list[str] = []
    i, n = 0, len(md)
    in_math_inline = False
    in_math_block = False
    in_code_inline = False
    in_code_block = False
    in_footnote_ref = False

    if md.startswith("---"):
        end = md.find("\n---", 3)
        if end != -1:
            fm_end = end + 4
            out.append(md[:fm_end])
            i = fm_end

    while i < n:
        ch = md[i]

        if md.startswith("```", i) and not (in_math_inline or in_math_block or in_code_inline):
            in_code_block = not in_code_block
            out.append("```")
            i += 3
            continue

        if ch == "`" and not (in_code_block or in_math_inline or in_math_block):
            in_code_inline = not in_code_inline
            out.append(ch)
            i += 1
            continue

        if md.startswith("$$", i) and not (in_code_block or in_code_inline):
            in_math_block = not in_math_block
            out.append("$$")
            i += 2
            continue

        if ch == "$" and not (in_code_block or in_code_inline or in_math_block):
            in_math_inline = not in_math_inline
            out.append(ch)
            i += 1
            continue

        protected = in_math_inline or in_math_block or in_code_inline or in_code_block

        if not protected and ch in "[]":
            if ch == "[" and _is_wikilink_start(md, i):
                end = md.find("]]", i + 2)
                out.append(md[i:end + 2])
                i = end + 2
                continue
            if i > 0 and md[i - 1] == "\\":
                out.append(ch)
                i += 1
                continue
            if ch == "[" and i + 1 < n and md[i + 1] == "^":
                in_footnote_ref = True
                out.append(ch)
                i += 1
                continue
            if ch == "]" and in_footnote_ref:
                in_footnote_ref = False
                out.append(ch)
                i += 1
                continue
            if ch == "[" and _is_md_link_start(md, i):
                out.append(ch)
                i += 1
                continue
            if ch == "]" and i + 1 < n and md[i + 1] == "(":
                out.append(ch)
                i += 1
                continue
            out.append("\\" + ch)
            i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def consolidate_footnotes(md: str) -> str:
    defs: dict[str, str] = {}
    fn_block_re = re.compile(
        r"(?:^##\s+Footnotes\s*\n)((?:.*\n)*?)(?=\n##|\Z)",
        re.MULTILINE
    )
    inline_def_re = re.compile(r"^\\?\[\^(fn\d+)\\?\]:\s*(.*?)(\s*\^fn-\d+)?\s*$", re.MULTILINE)

    for block_match in fn_block_re.finditer(md):
        block = block_match.group(1)
        for match in inline_def_re.finditer(block):
            defs[match.group(1)] = match.group(2).strip()

    for match in inline_def_re.finditer(md):
        defs[match.group(1)] = match.group(2).strip()

    body = fn_block_re.sub("", md)
    body = inline_def_re.sub("", body).rstrip()

    if not defs:
        return body

    def _fn_key(key: str) -> int:
        try:
            return int(key[2:])
        except ValueError:
            return 0

    sorted_ids = sorted(defs, key=_fn_key)
    lines = ["\n\n## Footnotes\n"]
    for fn_id in sorted_ids:
        n = fn_id[2:]
        lines.append(f"[^{fn_id}]: {defs[fn_id]} ^fn-{n}")

    return body + "\n".join(lines)


def rewrite_footnote_refs_as_wikilinks(md: str) -> str:
    def replace_ref(match: re.Match[str]) -> str:
        fn_id = match.group(1)
        label = fn_id[2:]
        return f"[[#^fn-{label}|{label}]]"

    return re.sub(r"\\?\[\^(fn\d+)\\?\](?!\s*:)", replace_ref, md)


def build_frontmatter(meta: PaperMetadata) -> str:
    authors_yaml = "\n".join(f"  - {author}" for author in meta.authors) if meta.authors else "  - Unknown"
    arxiv_url = f"https://arxiv.org/abs/{meta.arxiv}" if meta.arxiv else ""
    today = date.today().isoformat()

    lines = ["---"]
    lines.append(f'title: "{meta.title or "Unknown Title"}"')
    lines.append("authors:")
    lines.append(authors_yaml)
    if meta.year:
        lines.append(f"year: {meta.year}")
    if meta.venue:
        lines.append(f'venue: "{meta.venue}"')
    if meta.doi:
        lines.append(f'doi: "{meta.doi}"')
    if meta.arxiv:
        lines.append(f'arxiv: "{meta.arxiv}"')
    if arxiv_url:
        lines.append(f'url: "{arxiv_url}"')
    lines.append("tags: [paper]")
    lines.append(f"imported: {today}")
    lines.append(f'source_pdf: "{meta.source_pdf}"')
    lines.append("---")
    return "\n".join(lines) + "\n"


def postprocess(md: str, meta: PaperMetadata) -> str:
    md = normalize_escaped_math_brackets(md)
    md = escape_brackets(md)
    md = consolidate_footnotes(md)
    md = rewrite_footnote_refs_as_wikilinks(md)
    frontmatter = build_frontmatter(meta)
    return frontmatter + "\n" + md
