from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.formula import annotate_math_spans
from scholar_md.markdown import build_markdown
from scholar_md.models import BBox, PageLayout, TextLine, TextSpan


class MarkdownTest(unittest.TestCase):
    def test_inline_math_and_unicode_prose_render_together(self) -> None:
        line = TextLine.from_spans(
            [
                TextSpan("The formula ", BBox(60, 100, 120, 112), size=10),
                TextSpan("α = β", BBox(122, 100, 160, 112), font="CMMI12", size=10),
                TextSpan(" differs from Ἀριστοτέλης.", BBox(162, 100, 310, 112), size=10),
            ],
            page_num=1,
            line_id=1,
        )
        annotate_math_spans(line)
        page = PageLayout(page_num=1, width=600, height=800, lines=[line], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"$\alpha = \beta$", markdown)
        self.assertIn("Ἀριστοτέλης", markdown)

    def test_bullet_lines_become_markdown_list_items(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("The apparent features are:", BBox(60, 100, 220, 112), size=10)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("• First feature is long and hyphen-", BBox(80, 118, 260, 130), size=10)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("ated across a line.", BBox(90, 134, 210, 146), size=10)], page_num=1, line_id=3),
            TextLine.from_spans([TextSpan("• Second feature.", BBox(80, 152, 210, 164), size=10)], page_num=1, line_id=4),
            TextLine.from_spans([TextSpan("Body resumes.", BBox(60, 180, 160, 192), size=10)], page_num=1, line_id=5),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("The apparent features are:", markdown)
        self.assertIn("- First feature is long and hyphenated across a line.\n- Second feature.", markdown)
        self.assertIn("\n\nBody resumes.", markdown)
        self.assertNotIn("•", markdown)

    def test_numbered_section_heading_is_not_a_list_item(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("Previous paragraph ends here.", BBox(60, 100, 210, 112), size=10)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("1. Prehistory: Nicod & Hempel", BBox(140, 126, 330, 138), size=10)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("Next paragraph starts.", BBox(60, 150, 200, 162), size=10)], page_num=1, line_id=3),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("## 1. Prehistory: Nicod & Hempel", markdown)
        self.assertIn("Previous paragraph ends here.\n\n## 1. Prehistory: Nicod & Hempel\n\nNext paragraph starts.", markdown)
        self.assertNotIn("- Prehistory", markdown)

    def test_intro_heading_splits_from_following_body_and_indented_paragraph(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("Introduction", BBox(60, 100, 130, 112), size=10)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("Much of philosophical inquiry starts here.", BBox(60, 120, 300, 132), size=10)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("The same point can be made for other targets.", BBox(60, 136, 320, 148), size=10)], page_num=1, line_id=3),
            TextLine.from_spans([TextSpan("This point follows straightforwardly.", BBox(70, 152, 280, 164), size=10)], page_num=1, line_id=4),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("## Introduction\n\nMuch of philosophical inquiry starts here.", markdown)
        self.assertIn("other targets.\n\nThis point follows straightforwardly.", markdown)
        self.assertNotIn("Introduction Much", markdown)

    def test_roman_section_heading_splits_from_body(self) -> None:
        lines = [
            TextLine.from_spans(
                [TextSpan("I. Metalinguistic disputes and metalinguistic negotiations", BBox(60, 100, 420, 112), size=10)],
                page_num=1,
                line_id=1,
            ),
            TextLine.from_spans([TextSpan("An important part of communication is this.", BBox(60, 122, 330, 134), size=10)], page_num=1, line_id=2),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("## I. Metalinguistic disputes and metalinguistic negotiations", markdown)
        self.assertIn("negotiations\n\nAn important part of communication is this.", markdown)
        self.assertNotIn("negotiations An important", markdown)

    def test_large_multiline_title_block_renders_as_heading(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("Which Concepts Should We Use?:", BBox(60, 80, 360, 102), size=20)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("Metalinguistic Negotiations and The", BBox(60, 106, 380, 128), size=20)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("Methodology of Philosophy", BBox(60, 132, 320, 154), size=20)], page_num=1, line_id=3),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("# Which Concepts Should We Use?: Metalinguistic Negotiations and The Methodology of Philosophy", markdown)

    def test_indented_display_quote_renders_as_blockquote_with_internal_breaks(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("Framing paragraph runs across the normal text column before the quote.", BBox(60, 80, 390, 92), size=10)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("Normally, [1] will be used in order to add", BBox(80, 112, 360, 124), size=10)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("information concerning Feynman’s height:", BBox(80, 126, 330, 138), size=10)], page_num=1, line_id=3),
            TextLine.from_spans([TextSpan("[1] Feynman is tall.", BBox(80, 148, 210, 160), size=10)], page_num=1, line_id=4),
            TextLine.from_spans([TextSpan("But [1] has another mode of use.", BBox(80, 170, 330, 182), size=10)], page_num=1, line_id=5),
            TextLine.from_spans([TextSpan("Body resumes outside the quote and uses the normal text column.", BBox(60, 210, 390, 222), size=10)], page_num=1, line_id=6),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("> Normally, [1] will be used in order to add information concerning Feynman’s height:\n>\n> [1] Feynman is tall.\n>\n> But [1] has another mode of use.", markdown)
        self.assertIn("\n\nBody resumes outside the quote", markdown)

    def test_parenthetical_alpha_labels_are_not_duplicated(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("(7) (a) Secretariat is not an athlete.", BBox(60, 100, 270, 112), size=10)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("That follows from understanding the basic essence.", BBox(205, 100, 480, 112), size=10)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("(b) No, Secretariat is an athlete.", BBox(100, 132, 330, 144), size=10)], page_num=1, line_id=3),
            TextLine.from_spans([TextSpan("Those skills can be demonstrated by many species.", BBox(150, 146, 430, 158), size=10)], page_num=1, line_id=4),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("(7) (a) Secretariat is not an athlete. That follows from understanding the basic essence.", markdown)
        self.assertIn("  (b) No, Secretariat is an athlete. Those skills can be demonstrated by many species.", markdown)
        self.assertNotIn("b. (b)", markdown)

    def test_geometric_subscript_label_number_is_not_a_note(self) -> None:
        line = TextLine.from_spans(
            [
                TextSpan("(NC", BBox(60, 100, 82, 112), font="CMMI12", size=10),
                TextSpan("0", BBox(82, 104, 87, 112), size=6),
                TextSpan(") For all objects ", BBox(88, 100, 180, 112), size=10),
                TextSpan("H", BBox(182, 100, 190, 112), font="CMMI12", size=10),
                TextSpan("1", BBox(191, 104, 196, 112), size=6),
            ],
            page_num=1,
            line_id=1,
        )
        annotate_math_spans(line)
        page = PageLayout(page_num=1, width=600, height=800, lines=[line], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"$(NC_{0})$", markdown)
        self.assertIn(r"$H_{1}$", markdown)
        self.assertNotIn("fn-001", markdown)

    def test_definition_gloss_pair_renders_as_readable_list_item(self) -> None:
        formula = TextLine.from_spans(
            [
                TextSpan("(E", BBox(60, 100, 72, 112), font="CMMI12", size=10),
                TextSpan("2", BBox(72, 104, 78, 112), size=6),
                TextSpan(") Ea & (Oa ≡Ga).", BBox(80, 100, 170, 112), font="CMMI12", size=10),
            ],
            page_num=1,
            line_id=1,
        )
        gloss = TextLine.from_spans(
            [
                TextSpan("[", BBox(230, 100, 235, 112), size=10),
                TextSpan("a", BBox(235, 100, 240, 112), font="CMMI12", size=10),
                TextSpan(" is an emerald and ", BBox(242, 100, 330, 112), size=10),
                TextSpan("a", BBox(332, 100, 337, 112), font="CMMI12", size=10),
                TextSpan(" is grue]", BBox(339, 100, 390, 112), size=10),
            ],
            page_num=1,
            line_id=2,
        )
        annotate_math_spans(formula)
        annotate_math_spans(gloss)
        page = PageLayout(page_num=1, width=600, height=800, lines=[formula, gloss], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"- $(E_{2})$ $Ea \& (Oa \equiv Ga)$ — \[$a$ is an emerald and $a$ is grue\]", markdown)
        self.assertNotIn("\n[$a$", markdown)

    def test_pr_operator_joins_following_math_run(self) -> None:
        line = TextLine.from_spans(
            [
                TextSpan("iffPr", BBox(60, 100, 85, 112), size=10),
                TextSpan("(E |", BBox(86, 100, 110, 112), font="CMMI12", size=10),
                TextSpan("H", BBox(111, 100, 118, 112), font="CMMI12", size=10),
                TextSpan("1", BBox(118, 104, 123, 112), size=6),
                TextSpan("&", BBox(124, 100, 130, 112), size=10),
                TextSpan("K)", BBox(131, 100, 145, 112), font="CMMI12", size=10),
            ],
            page_num=1,
            line_id=1,
        )
        annotate_math_spans(line)
        page = PageLayout(page_num=1, width=600, height=800, lines=[line], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"$iff \operatorname{Pr}(E | H_{1} \& K)$", markdown)

    def test_corrupt_circled_number_sequence_becomes_ordered_list(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("The argument has this form:", BBox(60, 80, 220, 92), size=10)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("x E confirms H1.", BBox(90, 100, 180, 112), size=10)], page_num=1, line_id=2),
            TextLine.from_spans([TextSpan("y ∴E confirms Gb.", BBox(90, 116, 210, 128), size=10)], page_num=1, line_id=3),
            TextLine.from_spans([TextSpan("z ∴E confirms anything.", BBox(90, 132, 240, 144), size=10)], page_num=1, line_id=4),
            TextLine.from_spans([TextSpan("{ ∴Anything confirms anything.", BBox(90, 148, 280, 160), size=10)], page_num=1, line_id=5),
        ]
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("1. E confirms H1.\n2. ∴E confirms Gb.\n3. ∴E confirms anything.\n4. ∴Anything confirms anything.", markdown)

    def test_prime_numbered_premises_become_ordered_list(self) -> None:
        first = TextLine.from_spans(
            [
                TextSpan("(1", BBox(90, 100, 102, 112), size=10),
                TextSpan("′", BBox(103, 96, 108, 104), font="CMMI12", size=6),
                TextSpan(") Hempel’s theory.", BBox(109, 100, 220, 112), size=10),
            ],
            page_num=1,
            line_id=1,
        )
        second = TextLine.from_spans(
            [
                TextSpan("(2", BBox(90, 118, 102, 130), size=10),
                TextSpan("′", BBox(103, 114, 108, 122), font="CMMI12", size=6),
                TextSpan(") Some bridge principle.", BBox(109, 118, 250, 130), size=10),
            ],
            page_num=1,
            line_id=2,
        )
        annotate_math_spans(first)
        annotate_math_spans(second)
        page = PageLayout(page_num=1, width=600, height=800, lines=[first, second], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("1′. Hempel’s theory.\n2′. Some bridge principle.", markdown)
        self.assertNotIn(r"$\prime$", markdown)

    def test_letter_prime_attaches_without_latex_command(self) -> None:
        line = TextLine.from_spans(
            [
                TextSpan("(RTE", BBox(90, 100, 120, 112), size=10),
                TextSpan("′", BBox(121, 96, 126, 104), font="CMMI12", size=6),
                TextSpan(") is a bridge principle.", BBox(127, 100, 260, 112), size=10),
            ],
            page_num=1,
            line_id=1,
        )
        annotate_math_spans(line)
        page = PageLayout(page_num=1, width=600, height=800, lines=[line], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("(RTE′) is a bridge principle.", markdown)
        self.assertNotIn(r"\prime", markdown)

    def test_prime_inside_math_run_stays_unicode(self) -> None:
        line = TextLine.from_spans(
            [TextSpan("K′", BBox(90, 100, 108, 112), font="CMMI12", size=10)],
            page_num=1,
            line_id=1,
        )
        annotate_math_spans(line)
        page = PageLayout(page_num=1, width=600, height=800, lines=[line], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("$K′$", markdown)
        self.assertNotIn(r"\prime", markdown)

    def test_two_up_page_column_transition_can_continue_paragraph(self) -> None:
        left_tail = TextLine.from_spans(
            [TextSpan("confirming instances of", BBox(60, 640, 180, 652), size=10)],
            page_num=1,
            line_id=1,
        )
        right_head = TextLine.from_spans(
            [TextSpan("universal generalizations.", BBox(330, 100, 470, 112), size=10)],
            page_num=1,
            line_id=2,
        )
        left_tail.column = 0
        right_head.column = 1
        page = PageLayout(page_num=1, width=700, height=800, lines=[left_tail, right_head], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn("confirming instances of universal generalizations.", markdown)
        self.assertNotIn("confirming instances of\n\nuniversal", markdown)

    def test_fraction_formula_block_uses_latex_frac(self) -> None:
        numerator_left = TextLine.from_spans([TextSpan("100", BBox(170, 100, 188, 112), size=10)], page_num=1, line_id=1)
        numerator_right = TextLine.from_spans([TextSpan("1000", BBox(230, 100, 252, 112), size=10)], page_num=1, line_id=2)
        formula = TextLine.from_spans(
            [TextSpan("Pr(E1 | H1 & K) =", BBox(90, 112, 165, 124), size=10)],
            page_num=1,
            line_id=3,
        )
        formula.set_region("formula")
        denominator_left = TextLine.from_spans([TextSpan("1000100 <", BBox(168, 112, 220, 124), size=10)], page_num=1, line_id=4)
        denominator_right = TextLine.from_spans(
            [TextSpan("1001001 = Pr(E1 | ∼H1 & K)", BBox(228, 112, 360, 124), size=10)],
            page_num=1,
            line_id=5,
        )
        page = PageLayout(
            page_num=1,
            width=600,
            height=800,
            lines=[numerator_left, numerator_right, formula, denominator_left, denominator_right],
            body_size=10,
        )

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"\frac{100}{1000100} < \frac{1000}{1001001}", markdown)
        self.assertIn(r"\operatorname{Pr}(E_{1} | \sim H_{1} \& K)", markdown)

    def test_inline_fraction_list_item_does_not_leak_numerators(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("1", BBox(305, 100, 310, 108), size=6)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("1", BBox(326, 100, 331, 108), size=6)], page_num=1, line_id=2),
            TextLine.from_spans(
                [TextSpan("• Ba confirms Aa, relative to K, since Pr(Aa|Ba&K) =", BBox(80, 110, 302, 122), size=10)],
                page_num=1,
                line_id=3,
            ),
            TextLine.from_spans([TextSpan("26 >", BBox(304, 110, 322, 122), size=10)], page_num=1, line_id=4),
            TextLine.from_spans([TextSpan("52 = Pr(Aa|K).", BBox(324, 110, 390, 122), size=10)], page_num=1, line_id=5),
        ]
        lines[3].set_region("formula")
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"- Ba confirms Aa, relative to K, since $\operatorname{Pr}(Aa | Ba \& K) = \frac{1}{26} > \frac{1}{52} = \operatorname{Pr}(Aa | K)$", markdown)
        self.assertNotIn("1 1", markdown)

    def test_inline_fraction_list_item_handles_swapped_denominator_order(self) -> None:
        lines = [
            TextLine.from_spans([TextSpan("2", BBox(305, 100, 310, 108), size=6)], page_num=1, line_id=1),
            TextLine.from_spans([TextSpan("4", BBox(326, 100, 331, 108), size=6)], page_num=1, line_id=2),
            TextLine.from_spans(
                [TextSpan("• Ra doesn’t confirm Sa, rel. to K, since Pr(Sa|Ra&K) =", BBox(80, 110, 302, 122), size=10)],
                page_num=1,
                line_id=3,
            ),
            TextLine.from_spans([TextSpan("52 = Pr(Sa|K).", BBox(324, 110, 390, 122), size=10)], page_num=1, line_id=4),
            TextLine.from_spans([TextSpan("26 =", BBox(304, 110, 322, 122), size=10)], page_num=1, line_id=5),
        ]
        lines[4].set_region("formula")
        page = PageLayout(page_num=1, width=600, height=800, lines=lines, body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"\frac{2}{26} = \frac{4}{52}", markdown)
        self.assertNotIn("2 4", markdown)

    def test_trailing_unit_fraction_display_block(self) -> None:
        formula = TextLine.from_spans(
            [TextSpan("Pr(Aa | Ba & Ja & K) = 0 < 1", BBox(90, 110, 260, 122), size=10)],
            page_num=1,
            line_id=1,
        )
        formula.set_region("formula")
        denominator = TextLine.from_spans([TextSpan("52 = Pr(Aa | K)", BBox(250, 116, 330, 128), size=10)], page_num=1, line_id=2)
        tail = TextLine.from_spans([TextSpan("It follows.", BBox(60, 150, 120, 162), size=10)], page_num=1, line_id=3)
        page = PageLayout(page_num=1, width=600, height=800, lines=[formula, denominator, tail], body_size=10)

        markdown = build_markdown({"title": "x"}, [page], [])

        self.assertIn(r"\operatorname{Pr}(Aa | Ba \& Ja \& K) = 0 < \frac{1}{52} = \operatorname{Pr}(Aa | K)", markdown)
        self.assertNotIn("\n52 = ", markdown)


if __name__ == "__main__":
    unittest.main()
