from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.polish import polish_markdown


class PolishTest(unittest.TestCase):
    def test_spacing_and_math_fragment_cleanup(self) -> None:
        result = polish_markdown("probability ,  ( H ) and non -probabilistic $A$ $B$ $[C\\$\n\n\nnext")

        self.assertIn("probability, (H) and non-probabilistic $A B C$", result.text)
        self.assertNotIn("$[", result.text)
        self.assertGreaterEqual(result.stats["before_punctuation"], 1)
        self.assertGreaterEqual(result.stats["hyphen_spacing"], 1)
        self.assertGreaterEqual(result.stats["inline_math_fragments"], 1)

    def test_escapes_embedded_numeric_citations_and_spaces_inline_math(self) -> None:
        result = polish_markdown("Harman [15] and [14, ch. 3] and object$x$ but [[#^fn-001|1]] stays.")

        self.assertIn(r"Harman \[15\] and \[14, ch. 3\] and object $x$ but [[#^fn-001|1]] stays.", result.text)
        self.assertGreaterEqual(result.stats["numeric_bracket_citation_escape"], 1)
        self.assertGreaterEqual(result.stats["literal_square_bracket_escape"], 1)
        self.assertGreaterEqual(result.stats["space_before_inline_math"], 1)

    def test_escapes_literal_brackets_across_inline_math(self) -> None:
        result = polish_markdown(r"[$a$ is an emerald and $a$ is green] but [[#^fn-001|1]] stays.")

        self.assertIn(r"\[$a$ is an emerald and $a$ is green\]", result.text)
        self.assertIn("[[#^fn-001|1]]", result.text)
        self.assertGreaterEqual(result.stats["literal_square_bracket_escape"], 1)

    def test_does_not_escape_math_heavy_square_brackets(self) -> None:
        result = polish_markdown(r"Nothing can confirm “(∀y)[(Fy &∼ Gy) ⊃ (Fy &∼ Fy)],” here.")

        self.assertIn(r"[(Fy &∼ Gy) ⊃ (Fy &∼ Fy)]", result.text)
        self.assertNotIn(r"\[(Fy", result.text)

    def test_escapes_prose_gloss_even_when_it_contains_math(self) -> None:
        result = polish_markdown(r"Hempel’s theory [specifically, property ($\ddagger$)].")

        self.assertIn(r"\[specifically, property ($\ddagger$)\]", result.text)

    def test_subscript_only_math_stays_attached(self) -> None:
        result = polish_markdown(r"(NC$_{0}$) and H$_{1}$")

        self.assertIn(r"(NC$_{0}$) and H$_{1}$", result.text)
        self.assertNotIn(r"NC $_{0}$", result.text)

    def test_splits_body_tail_from_numbered_heading(self) -> None:
        result = polish_markdown("### 3.1. Prelude: Logic vs Epistemology. Good-\n\nman is right.")

        self.assertIn("### 3.1. Prelude: Logic vs Epistemology.\n\nGoodman is right.", result.text)
        self.assertGreaterEqual(result.stats["numbered_heading_body_split"], 1)


if __name__ == "__main__":
    unittest.main()
