from paper2md.postprocess import consolidate_footnotes, escape_brackets


def test_escape_plain_brackets():
    result = escape_brackets("See [1] and [2,3] for details.")
    assert result == r"See \[1\] and \[2,3\] for details."


def test_escape_skips_math_inline():
    result = escape_brackets("Formula $[a+b]$ here.")
    assert result == r"Formula $[a+b]$ here."


def test_escape_skips_math_block():
    result = escape_brackets("$$\n[a+b]\n$$")
    assert result == "$$\n[a+b]\n$$"


def test_escape_skips_code_inline():
    result = escape_brackets("Use `arr[0]` here.")
    assert result == "Use `arr[0]` here."


def test_escape_skips_code_block():
    markdown = "```python\narr[0] = 1\n```"
    assert escape_brackets(markdown) == markdown


def test_escape_skips_footnote_ref():
    markdown = "text[^fn1] more text"
    assert escape_brackets(markdown) == "text[^fn1] more text"


def test_escape_skips_md_link():
    markdown = "See [paper](https://example.com) for more."
    assert escape_brackets(markdown) == "See [paper](https://example.com) for more."


def test_escape_skips_frontmatter():
    markdown = "---\ntitle: \"Test [paper]\"\n---\n\nBody [1]."
    result = escape_brackets(markdown)
    assert "title: \"Test [paper]\"" in result
    assert r"Body \[1\]" in result


def test_consolidate_footnotes_moves_to_end():
    markdown = "Body text[^fn1] here.\n\n## Footnotes\n\n[^fn1]: Note content. ^fn-1\n"
    result = consolidate_footnotes(markdown)
    assert result.index("## Footnotes") > result.index("Body text")
    assert "[^fn1]: Note content." in result


def test_consolidate_footnotes_deduplicates():
    markdown = (
        "Chunk 1[^fn1].\n\n## Footnotes\n\n[^fn1]: First note. ^fn-1\n\n"
        "Chunk 2[^fn2].\n\n## Footnotes\n\n[^fn2]: Second note. ^fn-2\n"
    )
    result = consolidate_footnotes(markdown)
    assert result.count("## Footnotes") == 1
