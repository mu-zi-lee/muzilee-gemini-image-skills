from __future__ import annotations

import base64
import mimetypes
import re
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict


class ArtifactStore:
    def __init__(self, output_dir: Path) -> None:
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def persist_worker_payload(
        self,
        task_type: str,
        task_id: str,
        payload: Dict[str, Any],
        task_payload: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        image_data_url = payload.get("image_data_url")
        if not image_data_url:
            return dict(payload)

        header, encoded = image_data_url.split(",", 1)
        mime_type = header.split(";")[0].split(":", 1)[1]
        extension = mimetypes.guess_extension(mime_type) or ".png"
        filename_stem = self._build_filename_stem(task_type, task_id, payload, task_payload or {})
        filename = f"{filename_stem}{extension}"
        file_path = self.output_dir / filename
        file_path.write_bytes(base64.b64decode(encoded))

        persisted = dict(payload)
        persisted["file_path"] = str(file_path)
        persisted["mime_type"] = mime_type
        persisted.pop("image_data_url", None)
        return persisted

    def _build_filename_stem(
        self,
        task_type: str,
        task_id: str,
        payload: Dict[str, Any],
        task_payload: Dict[str, Any],
    ) -> str:
        input_payload = task_payload.get("input")
        prompt = input_payload.get("prompt", "") if isinstance(input_payload, dict) else ""
        suggested_name = payload.get("filename") or prompt or task_type
        slug = self._slugify(str(suggested_name).strip())
        if not slug:
            slug = task_type
        return f"{slug}_{int(time.time())}_{task_id[:8]}"

    def _slugify(self, value: str, max_length: int = 48, max_words: int = 6) -> str:
        normalized = unicodedata.normalize("NFKD", value)
        ascii_value = normalized.encode("ascii", "ignore").decode("ascii").lower()
        slug = re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")
        slug = re.sub(r"_+", "_", slug)
        words = [part for part in slug.split("_") if part]
        if max_words > 0:
            slug = "_".join(words[:max_words])
        return slug[:max_length].rstrip("_")
