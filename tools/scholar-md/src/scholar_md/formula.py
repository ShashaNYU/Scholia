from __future__ import annotations

import re

from .models import TextLine, TextSpan
from .utils import clean_text

MATH_FONT_HINTS = (
    "cmmi",
    "cmsy",
    "cmex",
    "math",
    "symbol",
    "msam",
    "msbm",
    "stix",
    "cambria math",
    "asana",
    "latinmodernmath",
)

GREEK_TO_LATEX = {
    "α": r"\alpha",
    "β": r"\beta",
    "γ": r"\gamma",
    "δ": r"\delta",
    "ε": r"\epsilon",
    "ζ": r"\zeta",
    "η": r"\eta",
    "θ": r"\theta",
    "ι": r"\iota",
    "κ": r"\kappa",
    "λ": r"\lambda",
    "μ": r"\mu",
    "ν": r"\nu",
    "ξ": r"\xi",
    "π": r"\pi",
    "ρ": r"\rho",
    "σ": r"\sigma",
    "τ": r"\tau",
    "υ": r"\upsilon",
    "φ": r"\phi",
    "χ": r"\chi",
    "ψ": r"\psi",
    "ω": r"\omega",
    "Γ": r"\Gamma",
    "Δ": r"\Delta",
    "Θ": r"\Theta",
    "Λ": r"\Lambda",
    "Ξ": r"\Xi",
    "Π": r"\Pi",
    "Σ": r"\Sigma",
    "Φ": r"\Phi",
    "Ψ": r"\Psi",
    "Ω": r"\Omega",
}

SYMBOL_TO_LATEX = {
    "¬": r"\neg",
    "∧": r"\land",
    "∨": r"\lor",
    "∴": r"\therefore",
    "∵": r"\because",
    "∀": r"\forall",
    "∃": r"\exists",
    "⊢": r"\vdash",
    "⊨": r"\models",
    "⊥": r"\bot",
    "□": r"\Box",
    "◇": r"\Diamond",
    "→": r"\to",
    "⇒": r"\Rightarrow",
    "↔": r"\leftrightarrow",
    "≤": r"\leq",
    "≥": r"\geq",
    "≠": r"\neq",
    "≈": r"\approx",
    "≡": r"\equiv",
    "∈": r"\in",
    "∉": r"\notin",
    "⊂": r"\subset",
    "⊃": r"\supset",
    "⊆": r"\subseteq",
    "⊇": r"\supseteq",
    "∼": r"\sim",
    "⊤": r"\top",
    "∪": r"\cup",
    "∩": r"\cap",
    "∫": r"\int",
    "∑": r"\sum",
    "∏": r"\prod",
    "√": r"\sqrt{}",
    "∞": r"\infty",
    "∂": r"\partial",
    "∇": r"\nabla",
    "×": r"\times",
    "÷": r"\div",
    "±": r"\pm",
    "∅": r"\emptyset",
    "⋆": r"\star",
    "†": r"\dagger",
    "‡": r"\ddagger",
    "′": "′",
    "Ö": r"\equiv",
    "î": r"\vdash",
    "ℝ": r"\mathbb{R}",
    "ℕ": r"\mathbb{N}",
    "ℤ": r"\mathbb{Z}",
    "ℚ": r"\mathbb{Q}",
}

SUPERSCRIPT_TO_LATEX = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁺": "+",
    "⁻": "-",
    "⁼": "=",
    "⁽": "(",
    "⁾": ")",
    "ⁿ": "n",
    "ᵢ": "i",
    "ⱼ": "j",
}

SUBSCRIPT_TO_LATEX = {
    "₀": "0",
    "₁": "1",
    "₂": "2",
    "₃": "3",
    "₄": "4",
    "₅": "5",
    "₆": "6",
    "₇": "7",
    "₈": "8",
    "₉": "9",
    "₊": "+",
    "₋": "-",
    "₌": "=",
    "₍": "(",
    "₎": ")",
    "ᵢ": "i",
    "ⱼ": "j",
}

UNICODE_MATH_CONTEXT_RE = re.compile(r"[¬∧∨∀∃∴∵⊢⊨⊥□◇→⇒↔≤≥≠≈≡∈∉⊂⊃⊆⊇∪∩∫∑∏√∞∂∇×÷±∼⊤⋆†‡′Öî]")
ASCII_MATH_CONTEXT_RE = re.compile(
    r"(?:[A-Za-z0-9)\]}]\s*(?:=|<|>)\s*[A-Za-z0-9({\[]|"
    r"[A-Za-z0-9)\]}]\s+(?:\+|-|\*|/)\s+[A-Za-z0-9({\[])"
)


def is_math_font(font: str) -> bool:
    normalized = font.split("+")[-1].lower()
    return any(hint in normalized for hint in MATH_FONT_HINTS)


def is_likely_math_text(text: str, font: str = "", nearby_text: str = "") -> bool:
    stripped = clean_text(text)
    if not stripped:
        return False
    if stripped in {"•", "·", "∙"}:
        return False
    has_math_context = has_math_marker(stripped)
    if is_math_font(font) and not has_math_context and re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}", stripped):
        if not (
            len(stripped) <= 3
            and bool(re.search(r"[A-Z]", stripped))
            and bool(nearby_text and re.search(r"[()&=|<>∀∃⊃≡∼]", nearby_text))
        ):
            return False
    if is_math_font(font) and not looks_like_prose(stripped):
        return True
    if any(ch in SUPERSCRIPT_TO_LATEX or ch in SUBSCRIPT_TO_LATEX for ch in stripped):
        return True
    if has_math_context:
        return True
    if re.search(r"\b[A-Za-z]\([^)]{1,40}\)", stripped):
        return True
    greek_chars = [ch for ch in stripped if ch in GREEK_TO_LATEX]
    compact = re.sub(r"\s+", "", stripped)
    if greek_chars and (has_math_context or re.search(r"[=+*/<>]", stripped) or len(compact) <= 3):
        return True
    return False


def has_math_marker(text: str) -> bool:
    return bool(UNICODE_MATH_CONTEXT_RE.search(text) or ASCII_MATH_CONTEXT_RE.search(text))


def looks_like_prose(text: str) -> bool:
    if has_math_marker(text):
        return False
    words = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]{3,}", text)
    if len(words) >= 2:
        return True
    compact = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ]", "", text)
    return len(compact) >= 7


def math_density(text: str) -> float:
    stripped = clean_text(text)
    if not stripped:
        return 0.0
    math_chars = sum(
        1
        for ch in stripped
        if ch in GREEK_TO_LATEX
        or ch in SYMBOL_TO_LATEX
        or ch in SUPERSCRIPT_TO_LATEX
        or ch in SUBSCRIPT_TO_LATEX
        or ch in "=+*/<>"
    )
    return math_chars / max(1, len(stripped))


def line_is_display_formula(line: TextLine) -> bool:
    if line.region == "formula":
        return True
    if not line.spans:
        return is_likely_math_text(line.text) and math_density(line.text) > 0.18
    math_spans = [span for span in line.spans if is_likely_math_text(span.text, span.font, line.text)]
    if not math_spans:
        return False
    math_width = sum(span.bbox.width for span in math_spans)
    return math_width >= line.bbox.width * 0.6 or math_density(line.text) > 0.24


def annotate_math_spans(line: TextLine) -> None:
    for span in line.spans:
        if is_likely_math_text(span.text, span.font, line.text):
            span.role = "math"


def unicode_math_to_latex(text: str) -> str:
    text = clean_text(text)
    parts: list[str] = []
    buffer: list[str] = []

    def flush_buffer() -> None:
        if buffer:
            parts.append("".join(buffer))
            buffer.clear()

    i = 0
    while i < len(text):
        ch = text[i]
        if ch in SUPERSCRIPT_TO_LATEX:
            flush_buffer()
            run = []
            while i < len(text) and text[i] in SUPERSCRIPT_TO_LATEX:
                run.append(SUPERSCRIPT_TO_LATEX[text[i]])
                i += 1
            parts.append("^{" + "".join(run) + "}")
            continue
        if ch in SUBSCRIPT_TO_LATEX:
            flush_buffer()
            run = []
            while i < len(text) and text[i] in SUBSCRIPT_TO_LATEX:
                run.append(SUBSCRIPT_TO_LATEX[text[i]])
                i += 1
            parts.append("_{" + "".join(run) + "}")
            continue
        if ch in GREEK_TO_LATEX:
            flush_buffer()
            parts.append(GREEK_TO_LATEX[ch])
        elif ch in SYMBOL_TO_LATEX:
            flush_buffer()
            parts.append(SYMBOL_TO_LATEX[ch])
        else:
            buffer.append(ch)
        i += 1
    flush_buffer()
    return tidy_latex_spacing(" ".join(parts))


def tidy_latex_spacing(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(?<!\\)&", r"\\&", text)
    text = re.sub(r"\s*\\&\s*", r" \\& ", text)
    text = re.sub(r"\s*\|\s*", " | ", text)
    text = re.sub(r"\s*([<>]=?)\s*", r" \1 ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:)\]}])", r"\1", text)
    text = re.sub(r"([({\[])\s+", r"\1", text)
    text = re.sub(r"\s+([′'])", r"\1", text)
    text = re.sub(r"\\sqrt\{\}\s*([A-Za-z0-9\\]+)", r"\\sqrt{\1}", text)
    text = re.sub(r"\biff\s*Pr\s*(?=\()", r"iff \\operatorname{Pr}", text)
    text = re.sub(r"\bPr\s*(?=\()", r"\\operatorname{Pr}", text)
    text = re.sub(r"\b([A-Z]{1,4})([0-9])\b", r"\1_{\2}", text)
    return text


def render_math(text: str, display: bool = False) -> str:
    latex = unicode_math_to_latex(text)
    if not display and is_single_bad_math_delimiter(latex):
        return "" if latex == "\\" else latex
    if display:
        return f"$$\n{latex}\n$$"
    return f"${latex}$"


def is_single_bad_math_delimiter(text: str) -> bool:
    return text in {"[", "]", "(", ")", "{", "}", "\\"}


def render_span(span: TextSpan) -> str:
    if span.role == "math":
        return render_math(span.text)
    if span.role.startswith("note_ref:") or span.role.startswith("footnote_ref:"):
        marker = span.role.split(":", 1)[1]
        return f"[^{marker}]"
    return clean_text(span.text)
