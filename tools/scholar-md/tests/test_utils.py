from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.utils import merge_hyphenated_text, normalize_unicode


class UnicodeNormalizationTest(unittest.TestCase):
    def test_repairs_ligatures_and_controls(self) -> None:
        self.assertEqual(normalize_unicode("\ufb01nding e\ufb00ect"), "finding effect")
        self.assertEqual(normalize_unicode("a\u0003b"), "ab")

    def test_preserves_natural_language_unicode(self) -> None:
        text = "“Kritik”—Ἀριστοτέλης العربية Überzeugung café"
        self.assertEqual(normalize_unicode(text), text)

    def test_merges_only_linebreak_hyphenation(self) -> None:
        self.assertEqual(merge_hyphenated_text("philoso-\nphy"), "philosophy")
        self.assertEqual(merge_hyphenated_text("well-known"), "well-known")


if __name__ == "__main__":
    unittest.main()
