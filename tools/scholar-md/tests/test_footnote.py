from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.footnote import extract_and_link_footnotes
from scholar_md.layout import prepare_layout
from scholar_md.markdown import build_markdown
from scholar_md.models import BBox, ExtractedDocument, PageLayout, TextLine, TextSpan


def span(text: str, x0: float, y0: float, x1: float, y1: float, size: float = 10) -> TextSpan:
    return TextSpan(text=text, bbox=BBox(x0, y0, x1, y1), size=size, page_num=1)


class FootnoteTest(unittest.TestCase):
    def test_extracts_and_links_superscript_reference(self) -> None:
        body = TextLine.from_spans(
            [
                span("Kant argues", 60, 100, 130, 112, 10),
                span("1", 132, 96, 138, 102, 6),
                span(" that reason has limits.", 140, 100, 250, 112, 10),
            ],
            page_num=1,
            line_id=1,
        )
        footnote_line = TextLine.from_spans([span("1 A source note.", 60, 720, 180, 732, 8)], page_num=1, line_id=2)
        footnote_line.set_region("footnote")
        page = PageLayout(page_num=1, width=600, height=800, lines=[body, footnote_line], body_size=10)

        footnotes = extract_and_link_footnotes([page])

        self.assertEqual(len(footnotes), 1)
        self.assertEqual(footnotes[0].marker, "1")
        self.assertEqual(footnotes[0].content, "A source note.")
        self.assertEqual(body.spans[1].role, "note_ref:1")

        markdown = build_markdown({"title": "x"}, [page], footnotes)
        self.assertIn("Kant argues[[#^fn-001|1]] that reason has limits.", markdown)
        self.assertNotIn("<sup>", markdown)
        self.assertIn("## Notes", markdown)
        self.assertIn("> [!note]- 1", markdown)
        self.assertIn("^fn-001", markdown)
        self.assertNotIn("[^1]", markdown)

        plain_markdown = build_markdown({"title": "x"}, [page], footnotes, footnote_ref_style="plain")
        self.assertIn("Kant argues1 that reason has limits.", plain_markdown)

    def test_note_link_after_exclamation_does_not_become_embed(self) -> None:
        body = TextLine.from_spans(
            [
                span("A surprising claim!", 60, 100, 155, 112, 10),
                span("34", 157, 96, 167, 102, 6),
                span(" Then prose resumes.", 169, 100, 260, 112, 10),
            ],
            page_num=1,
            line_id=1,
        )
        footnote_line = TextLine.from_spans([span("34 The source note.", 60, 720, 180, 732, 8)], page_num=1, line_id=2)
        footnote_line.set_region("footnote")
        page = PageLayout(page_num=1, width=600, height=800, lines=[body, footnote_line], body_size=10)

        footnotes = extract_and_link_footnotes([page])
        markdown = build_markdown({"title": "x"}, [page], footnotes)

        self.assertIn("claim! [[#^fn-034|34]] Then prose resumes.", markdown)
        self.assertNotIn("![[#^fn-034|34]]", markdown)

    def test_unlinked_author_note_is_quarantined(self) -> None:
        body = TextLine.from_spans([span("Main argument.", 60, 100, 160, 112, 10)], page_num=1, line_id=1)
        note = TextLine.from_spans([span("Date: 01/02/08. Penultimate draft.", 60, 720, 240, 732, 7)], page_num=1, line_id=2)
        note.set_region("footnote")
        page = PageLayout(page_num=1, width=600, height=800, lines=[body, note], body_size=10)

        footnotes = extract_and_link_footnotes([page])
        markdown = build_markdown({"title": "x"}, [page], footnotes)

        self.assertEqual(len(footnotes), 1)
        self.assertFalse(footnotes[0].linked)
        self.assertIn("Main argument.", markdown)
        self.assertIn("## Unlinked Notes", markdown)
        self.assertIn("Date: 01/02/08. Penultimate draft.", markdown)

    def test_small_footnote_block_above_bottom_margin_is_quarantined(self) -> None:
        body_lines = [
            TextLine.from_spans([span("The argument starts.", 58, 320, 190, 332, 10)], page_num=1, line_id=1),
            TextLine.from_spans([span("It continues with a claim.1", 58, 350, 230, 362, 10)], page_num=1, line_id=2),
            TextLine.from_spans([span("The final body line ends here.", 58, 380, 260, 392, 10)], page_num=1, line_id=3),
            TextLine.from_spans([span("Another body line.", 58, 395, 190, 407, 10)], page_num=1, line_id=4),
        ]
        note_lines = [
            TextLine.from_spans([span("1 This is a footnote that starts before the bottom margin.", 58, 410, 360, 420, 8)], page_num=1, line_id=5),
            TextLine.from_spans([span("It should not be merged into the body paragraph.", 58, 422, 320, 432, 8)], page_num=1, line_id=6),
        ]
        page = PageLayout(page_num=1, width=425, height=652, lines=body_lines + note_lines)
        document = ExtractedDocument(pdf_path="x.pdf", metadata={}, pages=[page])

        prepare_layout(document)
        footnotes = extract_and_link_footnotes([page])
        markdown = build_markdown({"title": "x"}, [page], footnotes)

        self.assertEqual([line.region for line in note_lines], ["footnote", "footnote"])
        self.assertIn("The final body line ends here. Another body line.", markdown)
        self.assertNotIn("body paragraph. The final", markdown)
        self.assertIn("This is a footnote that starts before the bottom margin.", markdown)

    def test_bracket_bibliography_citation_stays_plain(self) -> None:
        body = TextLine.from_spans(
            [
                span("Hempel’s ", 60, 100, 110, 112, 10),
                span("[17]", 112, 100, 132, 112, 10),
                span(" theory.", 134, 100, 180, 112, 10),
            ],
            page_num=1,
            line_id=1,
        )
        page = PageLayout(page_num=1, width=600, height=800, lines=[body], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"Hempel’s \[17\] theory.", markdown)
        self.assertNotIn("fn-017", markdown)
        self.assertNotIn("[^17]", markdown)


if __name__ == "__main__":
    unittest.main()
