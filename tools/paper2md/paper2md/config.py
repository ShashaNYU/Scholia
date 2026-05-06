from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

_CONFIG_PATH = Path.home() / ".paper2md" / "config.toml"


class ApiConfig(BaseModel):
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 16000
    concurrency: int = 3


class OutputConfig(BaseModel):
    default_dir: str = "~/Documents/ObsidianVault/Papers"


class ChunkingConfig(BaseModel):
    max_pages_per_chunk: int = 10
    overlap_pages: int = 1
    single_pass_threshold: int = 12


class Config(BaseModel):
    api: ApiConfig = Field(default_factory=ApiConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    chunking: ChunkingConfig = Field(default_factory=ChunkingConfig)
    api_key: Optional[str] = None
    openai_api_key: Optional[str] = None

    @classmethod
    def load(cls) -> "Config":
        raw: dict = {}
        if _CONFIG_PATH.exists():
            with open(_CONFIG_PATH, "rb") as f:
                raw = tomllib.load(f)
        obj = cls(**raw)
        obj.api_key = os.environ.get("ANTHROPIC_API_KEY")
        obj.openai_api_key = os.environ.get("OPENAI_API_KEY")
        return obj


def load_config() -> Config:
    return Config.load()
