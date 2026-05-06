from __future__ import annotations

import asyncio
import base64
import logging
from pathlib import Path
from typing import Any

import anthropic
import openai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import Config
from .prompts import SYSTEM_PROMPT, build_user_instruction
from .splitter import ChunkSpec

log = logging.getLogger(__name__)

_ANTHROPIC_RETRYABLE = (
    anthropic.RateLimitError,
    anthropic.APITimeoutError,
    anthropic.APIConnectionError
)

_OPENAI_RETRYABLE = (
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.APIConnectionError
)

_RETRY_KWARGS = dict(
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(5),
    reraise=True
)


def _is_openai(model: str) -> bool:
    return model.startswith(("gpt-", "o1-", "o3-", "o4-"))


def _make_client(cfg: Config) -> Any:
    if _is_openai(cfg.api.model):
        return openai.OpenAI(api_key=cfg.openai_api_key)
    return anthropic.Anthropic(api_key=cfg.api_key)


def convert_chunk(
    spec: ChunkSpec,
    title: str,
    authors: list[str],
    cfg: Config,
    client: Any = None
) -> str:
    if client is None:
        client = _make_client(cfg)
    return _call_with_retry(spec, title, authors, cfg, client)


def _call_with_retry(
    spec: ChunkSpec,
    title: str,
    authors: list[str],
    cfg: Config,
    client: Any,
    attempt: int = 0
) -> str:
    bad_request = openai.BadRequestError if _is_openai(cfg.api.model) else anthropic.BadRequestError
    try:
        if _is_openai(cfg.api.model):
            return _do_call_openai(spec, title, authors, cfg, client)
        return _do_call_anthropic(spec, title, authors, cfg, client)
    except bad_request as exc:
        if attempt >= 2:
            raise
        log.warning("Chunk %d failed (attempt %d), halving and retrying: %s", spec.chunk_idx, attempt, exc)
        return _halve_and_retry(spec, title, authors, cfg, client, attempt)


@retry(retry=retry_if_exception_type(_ANTHROPIC_RETRYABLE), **_RETRY_KWARGS)
def _do_call_anthropic(
    spec: ChunkSpec,
    title: str,
    authors: list[str],
    cfg: Config,
    client: anthropic.Anthropic
) -> str:
    pdf_bytes = spec.path.read_bytes()
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
    user_text = build_user_instruction(
        title=title,
        authors=authors,
        chunk_idx=spec.chunk_idx,
        total=spec.total,
        start=spec.start,
        end=spec.end,
        context_pages=spec.context_pages
    )

    response = client.messages.create(
        model=cfg.api.model,
        max_tokens=cfg.api.max_tokens,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64
                        },
                        "cache_control": {"type": "ephemeral"}
                    },
                    {"type": "text", "text": user_text}
                ]
            }
        ]
    )
    return response.content[0].text


@retry(retry=retry_if_exception_type(_OPENAI_RETRYABLE), **_RETRY_KWARGS)
def _do_call_openai(
    spec: ChunkSpec,
    title: str,
    authors: list[str],
    cfg: Config,
    client: openai.OpenAI
) -> str:
    import fitz

    doc = fitz.open(spec.path)
    content: list[dict] = []

    mat = fitz.Matrix(150 / 72, 150 / 72)
    for page in doc:
        pix = page.get_pixmap(matrix=mat)
        img_b64 = base64.standard_b64encode(pix.tobytes("png")).decode("utf-8")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{img_b64}", "detail": "high"}
        })
    doc.close()

    user_text = build_user_instruction(
        title=title,
        authors=authors,
        chunk_idx=spec.chunk_idx,
        total=spec.total,
        start=spec.start,
        end=spec.end,
        context_pages=spec.context_pages
    )
    content.append({"type": "text", "text": user_text})

    response = client.chat.completions.create(
        model=cfg.api.model,
        max_completion_tokens=cfg.api.max_tokens,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content}
        ]
    )
    return response.choices[0].message.content


def _halve_and_retry(
    spec: ChunkSpec,
    title: str,
    authors: list[str],
    cfg: Config,
    client: Any,
    attempt: int
) -> str:
    import fitz

    doc = fitz.open(spec.path)
    n = len(doc)
    mid = n // 2
    tmp_dir = spec.path.parent

    halves = []
    for hi, (fr, to) in enumerate([(0, mid - 1), (mid, n - 1)]):
        sub = fitz.open()
        sub.insert_pdf(doc, from_page=fr, to_page=to)
        sub_path = tmp_dir / f"{spec.path.stem}_half{hi}.pdf"
        sub.save(sub_path)
        sub.close()

        half_spec = ChunkSpec(
            path=sub_path,
            start=spec.start + fr,
            end=spec.start + to,
            context_pages=spec.context_pages if hi == 0 else 0,
            chunk_idx=spec.chunk_idx,
            total=spec.total
        )
        halves.append(half_spec)

    doc.close()

    results = [_call_with_retry(half, title, authors, cfg, client, attempt + 1) for half in halves]
    return "\n\n".join(results)


async def convert_chunks_async(
    specs: list[ChunkSpec],
    title: str,
    authors: list[str],
    cfg: Config
) -> list[str]:
    client = _make_client(cfg)
    sem = asyncio.Semaphore(cfg.api.concurrency)

    async def bounded(spec: ChunkSpec) -> str:
        async with sem:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, convert_chunk, spec, title, authors, cfg, client)

    tasks = [bounded(spec) for spec in specs]
    return await asyncio.gather(*tasks)


def convert_all(
    specs: list[ChunkSpec],
    title: str,
    authors: list[str],
    cfg: Config
) -> list[str]:
    return asyncio.run(convert_chunks_async(specs, title, authors, cfg))
