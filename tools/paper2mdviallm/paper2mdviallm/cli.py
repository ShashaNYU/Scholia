from __future__ import annotations

import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

from .config import load_config
from .converter import convert_all
from .metadata import extract_metadata
from .postprocess import postprocess
from .splitter import split_pdf
from .stitcher import stitch
from .verifier import verify

app = typer.Typer(
    name="paper2mdviallm",
    help="Convert academic paper PDFs to Obsidian-compatible Markdown.",
    add_completion=False
)
console = Console()

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")


@app.command()
def convert(
    pdf: Path = typer.Argument(..., help="Path to the PDF file"),
    output: Optional[Path] = typer.Option(None, "-o", "--output", help="Output directory"),
    model: Optional[str] = typer.Option(None, "--model", help="Override model"),
    concurrency: Optional[int] = typer.Option(None, "--concurrency", help="Max concurrent API calls"),
    keep_intermediate: bool = typer.Option(False, "--keep-intermediate", help="Keep sub-PDFs and raw responses"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose logging")
) -> None:
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if not pdf.exists():
        console.print(f"[red]Error:[/red] File not found: {pdf}")
        raise typer.Exit(1)

    cfg = load_config()
    if model:
        cfg.api.model = model
    if concurrency:
        cfg.api.concurrency = concurrency

    from .converter import _is_openai

    if _is_openai(cfg.api.model):
        if not cfg.openai_api_key:
            console.print("[red]Error:[/red] OPENAI_API_KEY not set. Add it to .env or environment.")
            raise typer.Exit(1)
    else:
        if not cfg.api_key:
            console.print("[red]Error:[/red] ANTHROPIC_API_KEY not set. Add it to .env or environment.")
            raise typer.Exit(1)

    out_dir = output or Path(cfg.output.default_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        _run_conversion(pdf, out_dir, tmp_path, cfg, keep_intermediate)


def _run_conversion(pdf: Path, out_dir: Path, tmp_path: Path, cfg, keep_intermediate: bool) -> None:
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console=console
    ) as progress:
        metadata_task = progress.add_task("Extracting metadata...", total=None)
        meta = extract_metadata(pdf)
        progress.update(metadata_task, description=f"[green]Metadata:[/green] {meta.title or pdf.stem}")
        progress.stop_task(metadata_task)

        split_task = progress.add_task("Splitting PDF...", total=None)
        specs = split_pdf(
            pdf,
            tmp_path,
            chunk_size=cfg.chunking.max_pages_per_chunk,
            overlap=cfg.chunking.overlap_pages,
            single_pass_threshold=cfg.chunking.single_pass_threshold
        )
        progress.update(split_task, description=f"[green]Split:[/green] {len(specs)} chunk(s)")
        progress.stop_task(split_task)

        convert_task = progress.add_task(f"Converting {len(specs)} chunk(s)...", total=None)
        title = meta.title or pdf.stem
        raw_chunks = convert_all(specs, title, meta.authors, cfg)
        progress.update(convert_task, description=f"[green]Converted[/green] {len(raw_chunks)} chunk(s)")
        progress.stop_task(convert_task)

        stitch_task = progress.add_task("Stitching...", total=None)
        stitched = stitch(raw_chunks)
        progress.stop_task(stitch_task)

        post_task = progress.add_task("Post-processing...", total=None)
        final_md = postprocess(stitched, meta)
        progress.stop_task(post_task)

        verify_task = progress.add_task("Verifying...", total=None)
        result = verify(pdf, final_md)
        progress.stop_task(verify_task)

    if result.warnings:
        console.print("\n[yellow]Verification warnings:[/yellow]")
        for warning in result.warnings:
            console.print(f"  • {warning}")
        if result.missing_passages:
            console.print("\n[dim]Sample missing passages:[/dim]")
            for passage in result.missing_passages[:5]:
                console.print(f"  - {passage}")

    safe_title = re.sub(r'[\\/:*?"<>|]', "_", meta.title or pdf.stem)[:120]
    out_file = out_dir / f"{safe_title}.md"
    out_file.write_text(final_md, encoding="utf-8")

    status = "[green]OK[/green]" if result.passed else "[yellow]WARN[/yellow]"
    console.print(f"\n{status} Written -> {out_file}")

    if keep_intermediate:
        keep_dir = out_dir / f"{safe_title}_intermediate"
        keep_dir.mkdir(exist_ok=True)
        for spec in (specs if specs and hasattr(specs[0], "path") else []):
            try:
                shutil.copy(spec.path, keep_dir)
            except Exception:
                pass
        console.print(f"   Intermediate artifacts saved to {keep_dir}")


@app.command()
def inspect(
    pdf: Path = typer.Argument(..., help="Path to the PDF file")
) -> None:
    if not pdf.exists():
        console.print(f"[red]Error:[/red] File not found: {pdf}")
        raise typer.Exit(1)

    cfg = load_config()

    console.print("\n[bold]Metadata[/bold]")
    meta = extract_metadata(pdf)
    table = Table(show_header=False)
    table.add_row("Title", meta.title or "[dim]not found[/dim]")
    table.add_row("Authors", ", ".join(meta.authors) or "[dim]not found[/dim]")
    table.add_row("Year", meta.year or "[dim]not found[/dim]")
    table.add_row("Venue", meta.venue or "[dim]not found[/dim]")
    table.add_row("DOI", meta.doi or "[dim]not found[/dim]")
    table.add_row("arXiv", meta.arxiv or "[dim]not found[/dim]")
    console.print(table)

    console.print("\n[bold]Split Plan[/bold]")
    with tempfile.TemporaryDirectory() as tmp:
        specs = split_pdf(
            pdf,
            Path(tmp),
            chunk_size=cfg.chunking.max_pages_per_chunk,
            overlap=cfg.chunking.overlap_pages,
            single_pass_threshold=cfg.chunking.single_pass_threshold
        )

    chunk_table = Table("Chunk", "Pages", "Context pages")
    for spec in specs:
        chunk_table.add_row(
            str(spec.chunk_idx + 1),
            f"{spec.start + 1}-{spec.end + 1}",
            str(spec.context_pages)
        )
    console.print(chunk_table)
    console.print(f"\nTotal chunks: {len(specs)}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
