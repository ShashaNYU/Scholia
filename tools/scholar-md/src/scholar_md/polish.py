from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class PolishResult:
    text: str
    stats: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def polish_markdown(text: str) -> PolishResult:
    stats: dict[str, int] = {}
    warnings: list[str] = []

    text, stats["before_punctuation"] = counted_sub(r"[ \t]+([,.;:!?])", r"\1", text)
    text, stats["after_punctuation_runs"] = counted_sub(r"([,.;:!?]) {2,}", r"\1 ", text)
    text, stats["open_paren_inner"] = counted_sub(r"([(\[{])\s+", r"\1", text)
    text, stats["close_paren_inner"] = counted_sub(r"\s+([)\]}])", r"\1", text)
    text, stats["hyphen_spacing"] = counted_sub(
        r"\b([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+-\s*([A-Za-zÀ-ÖØ-öø-ÿ]+)\b",
        r"\1-\2",
        text,
    )
    text, stats["math_leading_bracket"] = counted_sub(r"\$\[", "$", text)
    text, stats["math_trailing_backslash"] = counted_sub(r"\\\$", "$", text)
    text, stats["inline_math_fragments"] = merge_adjacent_inline_math(text)
    text, stats["numeric_bracket_citation_escape"] = counted_sub(r"(?<![\\[])\[(\d{1,4})\](?!\])", r"\\[\1\\]", text)
    text, stats["literal_square_bracket_escape"] = escape_literal_square_brackets(text)
    text, stats["numbered_heading_body_split"] = split_numbered_heading_body_tail(text)
    text, inline_math_spacing_stats = space_around_inline_math(text)
    stats.update(inline_math_spacing_stats)
    text, stats["blank_lines"] = counted_blank_line_collapse(text)

    bad_patterns = {
        "math_open_bracket": r"\$\[",
        "math_backslash_fragment": r"\$\\\$",
        "unbalanced_inline_math": r"(?m)^[^$]*\$[^$]*$",
        "double_space_after_comma": r", {2,}",
    }
    for name, pattern in bad_patterns.items():
        count = len(re.findall(pattern, text))
        if count:
            warnings.append(f"{name}: {count}")
            stats[name] = count
    return PolishResult(text=text.strip() + "\n", stats=stats, warnings=warnings)


def counted_sub(pattern: str, repl: str, text: str) -> tuple[str, int]:
    return re.subn(pattern, repl, text)


def counted_blank_line_collapse(text: str) -> tuple[str, int]:
    collapsed, count = re.subn(r"\n{3,}", "\n\n", text)
    return collapsed, count


def merge_adjacent_inline_math(text: str) -> tuple[str, int]:
    count = 0
    pattern = re.compile(r"\$([^$\n]{1,40})\$\s+\$([^$\n]{1,40})\$")
    while True:
        text, changed = pattern.subn(lambda match: f"${match.group(1)} {match.group(2)}$", text)
        count += changed
        if changed == 0:
            break
    return text, count


def escape_literal_square_brackets(text: str) -> tuple[str, int]:
    escaped_lines: list[str] = []
    count = 0
    for line in text.splitlines():
        if line.startswith("> [!"):
            escaped_lines.append(line)
            continue
        escaped, changed = escape_literal_square_brackets_in_line(line)
        count += changed
        escaped_lines.append(escaped)
    return "\n".join(escaped_lines), count


def escape_literal_square_brackets_in_line(line: str) -> tuple[str, int]:
    pieces: list[str] = []
    count = 0
    i = 0
    while i < len(line):
        if line[i] == "\\" and i + 1 < len(line):
            pieces.append(line[i : i + 2])
            i += 2
            continue
        if line.startswith("[[", i):
            end = line.find("]]", i + 2)
            if end != -1:
                pieces.append(line[i : end + 2])
                i = end + 2
                continue
        if line[i] == "[":
            close = find_unescaped_closing_bracket(line, i + 1)
            if close != -1 and should_escape_bracket_group(line, i, close):
                pieces.append(r"\[")
                pieces.append(line[i + 1 : close])
                pieces.append(r"\]")
                count += 1
                i = close + 1
                continue
        pieces.append(line[i])
        i += 1
    return "".join(pieces), count


def find_unescaped_closing_bracket(line: str, start: int) -> int:
    i = start
    while i < len(line):
        if line[i] == "\\":
            i += 2
            continue
        if line[i] == "]":
            return i
        i += 1
    return -1


def should_escape_bracket_group(line: str, open_index: int, close_index: int) -> bool:
    if open_index > 0 and line[open_index - 1] in {"!", "\\"}:
        return False
    if open_index + 1 < len(line) and line[open_index + 1] == "[":
        return False
    if close_index + 1 < len(line) and line[close_index + 1] in {"]", "("}:
        return False
    inner = line[open_index + 1 : close_index]
    if not inner or len(inner) > 220:
        return False
    if is_math_heavy_bracket_group(inner):
        return False
    return True


def is_math_heavy_bracket_group(inner: str) -> bool:
    without_inline_math = re.sub(r"\$[^$\n]*\$", " ", inner)
    prose_words = re.findall(
        r"\b(?:is|are|and|or|not|the|an|a|where|specifically|property|viz|i\.e|green|grue|emerald)\b",
        without_inline_math,
        flags=re.I,
    )
    if prose_words:
        return False
    if re.search(
        r"\\(?:forall|exists|supset|sim|equiv|operatorname|frac|sum|int|prod|lim|infty|phi|psi|ddagger|dagger|wedge|vee|neg|rightarrow|leftrightarrow)\b",
        inner,
    ):
        return True
    if re.search(r"[∀∃⊃≡∼→↔≤≥∑∫∏√]", inner):
        return True
    if "$" in inner:
        return without_inline_math.strip() == ""
    operators = len(re.findall(r"[&=<>+\-*/|~¬]|\\[A-Za-z]+", inner))
    letters = len(re.findall(r"[A-Za-z]", inner))
    return operators >= 2 and letters <= 12


def split_numbered_heading_body_tail(text: str) -> tuple[str, int]:
    pattern = re.compile(r"(?m)^(?P<head>#{2,6} \d+(?:\.\d+)+\. .+?\.) (?P<body>[A-Z][^\n]*)\n\n(?P<next>[a-z][^\n]*)")

    def replace(match: re.Match[str]) -> str:
        body = match.group("body").strip()
        next_text = match.group("next")
        if body.endswith("-"):
            merged = body[:-1] + next_text
        else:
            merged = f"{body} {next_text}"
        return f"{match.group('head')}\n\n{merged}"

    return pattern.subn(replace, text)


def space_around_inline_math(text: str) -> tuple[str, dict[str, int]]:
    stats = {
        "space_before_inline_math": 0,
        "space_after_inline_math": 0,
        "inline_math_inner_space": 0,
    }
    lines: list[str] = []
    inline_math_re = re.compile(r"\$[^$\n]+\$")
    for line in text.splitlines():
        pieces: list[str] = []
        last = 0
        for match in inline_math_re.finditer(line):
            before = line[last : match.start()]
            math = match.group(0)
            subscript_only = is_subscript_only_math(math)
            if before and is_inline_math_left_adjacent(before[-1]) and not subscript_only:
                before += " "
                stats["space_before_inline_math"] += 1
            inner = math[1:-1]
            stripped_inner = inner.strip()
            if stripped_inner != inner:
                stats["inline_math_inner_space"] += 1
            pieces.append(before)
            pieces.append(f"${stripped_inner}$")
            last = match.end()
            if last < len(line) and is_word_char(line[last]) and not subscript_only:
                pieces.append(" ")
                stats["space_after_inline_math"] += 1
        pieces.append(line[last:])
        lines.append("".join(pieces))
    return "\n".join(lines), stats


def is_word_char(char: str) -> bool:
    return bool(re.match(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]", char))


def is_inline_math_left_adjacent(char: str) -> bool:
    return is_word_char(char) or char in "”’\"'"


def is_subscript_only_math(math: str) -> bool:
    return bool(re.fullmatch(r"\$_\{[^{}\n]+\}\$", math))
