from __future__ import annotations

import base64
import mimetypes
import time
from pathlib import Path
from typing import Any, Dict


class ArtifactStore:
    def __init__(self, output_dir: Path) -> None:
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def persist_worker_payload(self, task_type: str, task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        image_data_url = payload.get("image_data_url")
        if not image_data_url:
            return dict(payload)

        header, encoded = image_data_url.split(",", 1)
        mime_type = header.split(";")[0].split(":", 1)[1]
        extension = mimetypes.guess_extension(mime_type) or ".png"
        filename = f"{task_type}_{int(time.time())}_{task_id[:8]}{extension}"
        file_path = self.output_dir / filename
        file_path.write_bytes(base64.b64decode(encoded))

        persisted = dict(payload)
        persisted["file_path"] = str(file_path)
        persisted["mime_type"] = mime_type
        persisted.pop("image_data_url", None)
        return persisted

