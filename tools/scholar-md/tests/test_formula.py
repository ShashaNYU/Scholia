from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.formula import is_likely_math_text, render_math, unicode_math_to_latex


class FormulaPolicyTest(unittest.TestCase):
    def test_math_context_converts_greek_and_logic(self) -> None:
        latex = unicode_math_to_latex("α₁ → β²")
        self.assertIn(r"\alpha", latex)
        self.assertIn("_{1}", latex)
        self.assertIn(r"\to", latex)
        self.assertIn(r"\beta", latex)
        self.assertIn("^{2}", latex)

    def test_natural_language_greek_is_not_math(self) -> None:
        self.assertFalse(is_likely_math_text("Ἀριστοτέλης εἶπε τὸ ζῷον πολιτικόν"))
        self.assertFalse(is_likely_math_text("Überzeugung café العربية"))
        self.assertFalse(is_likely_math_text("Nicod’s (3) is a charitable reconstruction"))
        self.assertFalse(is_likely_math_text("precisifications/reconstructions"))

    def test_math_detection_uses_context(self) -> None:
        self.assertTrue(is_likely_math_text("α = β + 1"))
        self.assertTrue(is_likely_math_text("□p → ◇q"))
        self.assertEqual(render_math("α = β"), r"$\alpha = \beta$")

    def test_probability_operator_and_numeric_subscripts(self) -> None:
        latex = unicode_math_to_latex("iffPr(E | H1 & K) > Pr(E | H2 & K)")

        self.assertIn(r"iff \operatorname{Pr}", latex)
        self.assertIn("H_{1}", latex)
        self.assertIn("H_{2}", latex)
        self.assertIn(r"\&", latex)

    def test_common_math_symbol_coverage(self) -> None:
        latex = unicode_math_to_latex("∑x + ∫y ≥ z ∴ H1 ‡")

        self.assertIn(r"\sum", latex)
        self.assertIn(r"\int", latex)
        self.assertIn(r"\geq", latex)
        self.assertIn(r"\therefore", latex)
        self.assertIn(r"H_{1}", latex)
        self.assertIn(r"\ddagger", latex)


if __name__ == "__main__":
    unittest.main()
