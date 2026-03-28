from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_int(key: str, default: int) -> int:
    value = os.getenv(key, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    host: str = os.getenv("MUZILEE_GEMINI_SKILL_HOST", "127.0.0.1")
    port: int = _env_int("MUZILEE_GEMINI_SKILL_PORT", 8765)
    worker_timeout_seconds: int = _env_int("MUZILEE_GEMINI_WORKER_TIMEOUT_SECONDS", 20)
    default_task_timeout_seconds: int = _env_int("MUZILEE_GEMINI_TASK_TIMEOUT_SECONDS", 180)
    poll_interval_seconds: int = _env_int("MUZILEE_GEMINI_POLL_INTERVAL_SECONDS", 2)
    output_dir: Path = Path(
        os.getenv(
            "MUZILEE_GEMINI_OUTPUT_DIR",
            str(Path(__file__).resolve().parents[2] / "outputs"),
        )
    )
    protocol_path: Path = Path(
        os.getenv(
            "MUZILEE_GEMINI_PROTOCOL_PATH",
            str(Path(__file__).resolve().parents[2] / "protocol" / "catalog.json"),
        )
    )


CONFIG = Config()

