from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import fitz  # type: ignore

from scholar_md.convert import ConversionOptions, convert_pdf


class ConversionContractTest(unittest.TestCase):
    def test_emit_diagnostics_writes_markdown_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            pdf_path = tmp / "sample.pdf"
            markdown_path = tmp / "sample.md"
            diagnostics_path = tmp / "sample.diagnostics.json"

            doc = fitz.open()
            page = doc.new_page()
            page.insert_text((72, 72), "Metalinguistic negotiation clarifies conceptual engineering.")
            doc.save(pdf_path)
            doc.close()

            result = convert_pdf(
                pdf_path,
                markdown_path,
                ConversionOptions(
                    emit_diagnostics=True,
                    diagnostics_output=str(diagnostics_path),
                ),
            )

            self.assertEqual(result.markdown_path, markdown_path)
            self.assertEqual(result.diagnostics_path, diagnostics_path)
            self.assertTrue(markdown_path.exists())
            self.assertTrue(diagnostics_path.exists())

            markdown_text = markdown_path.read_text(encoding="utf8")
            self.assertIn("Metalinguistic negotiation", markdown_text)

            diagnostics = json.loads(diagnostics_path.read_text(encoding="utf8"))
            self.assertEqual(diagnostics["metadata"]["source_pdf"], "sample.pdf")


if __name__ == "__main__":
    unittest.main()
