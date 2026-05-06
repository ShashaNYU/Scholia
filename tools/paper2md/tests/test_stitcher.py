from paper2md.stitcher import renumber_footnotes, split_body_and_footnotes, stitch


def test_split_body_and_footnotes_no_footnotes():
    body, defs = split_body_and_footnotes("Just body text.")
    assert body == "Just body text."
    assert defs == []


def test_split_body_and_footnotes_with_footnotes():
    markdown = "Body[^fn1].\n\n## Footnotes\n\n[^fn1]: Note. ^fn-1\n"
    body, defs = split_body_and_footnotes(markdown)
    assert "Body" in body
    assert len(defs) == 1
    assert defs[0] == ("fn1", "Note.")


def test_renumber_footnotes_single_chunk():
    chunks = ["Body[^fn1].\n\n## Footnotes\n\n[^fn1]: Note A. ^fn-1\n"]
    result, defs = renumber_footnotes(chunks)
    assert "[^fn1]" in result
    assert len(defs) == 1
    assert defs[0].new_id == "fn1"


def test_renumber_footnotes_two_chunks():
    chunk_one = "Chunk 1[^fn1].\n\n## Footnotes\n\n[^fn1]: Note A. ^fn-1\n"
    chunk_two = "Chunk 2[^fn1].\n\n## Footnotes\n\n[^fn1]: Note B. ^fn-1\n"
    result, defs = renumber_footnotes([chunk_one, chunk_two])
    assert "[^fn1]" in result
    assert "[^fn2]" in result
    assert len(defs) == 2
    assert defs[0].new_id == "fn1"
    assert defs[1].new_id == "fn2"


def test_stitch_single_chunk():
    chunks = ["# Title\n\n## Abstract\n\nSome text."]
    result = stitch(chunks)
    assert "# Title" in result
    assert "Some text." in result


def test_stitch_adds_footnotes_at_end():
    chunk_one = "Chunk 1[^fn1].\n\n## Footnotes\n\n[^fn1]: Note A. ^fn-1\n"
    chunk_two = "Chunk 2[^fn1].\n\n## Footnotes\n\n[^fn1]: Note B. ^fn-1\n"
    result = stitch([chunk_one, chunk_two])
    assert "## Footnotes" in result
    footnotes_idx = result.index("## Footnotes")
    assert footnotes_idx > result.index("Chunk 1")
    assert footnotes_idx > result.index("Chunk 2")
