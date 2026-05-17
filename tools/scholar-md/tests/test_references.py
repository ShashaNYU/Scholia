from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.models import BBox, TextLine
from scholar_md.references import collect_reference_entries


def line(text: str, line_id: int) -> TextLine:
    return TextLine(spans=[], page_num=1, line_id=line_id, bbox=BBox(0, line_id * 10, 200, line_id * 10 + 8), text=text, font_size=8)


class ReferencesTest(unittest.TestCase):
    def test_collects_numbered_reference_entries(self) -> None:
        entries = collect_reference_entries(
            [
                line("References", 1),
                line("[17] C. Hempel. Studies in the logic of confirmation.", 2),
                line("[25] N. Goodman. Fact, Fiction, and Forecast.", 3),
            ]
        )

        self.assertEqual([entry.marker for entry in entries], ["17", "25"])
        self.assertEqual(entries[0].anchor, "ref-017")
        self.assertIn("Fact, Fiction, and Forecast.", entries[1].text)


if __name__ == "__main__":
    unittest.main()
