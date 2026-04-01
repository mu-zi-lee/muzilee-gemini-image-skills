from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from typing import Any, Dict, List

from ..contracts.error_codes import INVALID_MODEL
from ..contracts.protocol_loader import get_model_alias_mapping
from ..contracts.task_types import OUTPUT_MODE_AUTO, OUTPUT_MODE_PREVIEW, TASK_GENERATE_IMAGE, TASK_SWITCH_MODEL


class SetupService:
    def __init__(self, catalog: Dict[str, Any]) -> None:
        self.catalog = catalog
        self.model_aliases = get_model_alias_mapping(catalog)
        self.default_generate_image_model = (
            catalog.get("models", {}).get("default_for_task", {}).get(TASK_GENERATE_IMAGE, "pro")
        )

    def normalize_model_name(self, model: str | None) -> str:
        normalized = str(model or "").strip().lower()
        if not normalized:
            return ""
        if normalized not in self.model_aliases:
            raise ValueError(INVALID_MODEL)
        return self.model_aliases[normalized]

    def prepare_task_payload(self, envelope_payload: Dict[str, Any]) -> Dict[str, Any]:
        setup = dict(envelope_payload.get("setup") or {})
        task_input = dict(envelope_payload.get("input") or {})
        task_type = envelope_payload["type"]

        prepared_setup = {
            "new_chat": bool(setup.get("new_chat", False)),
            "model": self.normalize_model_name(setup.get("model")),
            "reference_images": self.prepare_reference_images(setup.get("reference_images") or []),
        }

        prepared_input = dict(task_input)
        if task_type == TASK_GENERATE_IMAGE:
            if not prepared_setup["model"]:
                prepared_setup["model"] = self.default_generate_image_model
            output_mode = task_input.get("output_mode") or OUTPUT_MODE_PREVIEW
            prepared_input["output_mode"] = OUTPUT_MODE_PREVIEW if output_mode == OUTPUT_MODE_AUTO else output_mode
        elif task_type == TASK_SWITCH_MODEL:
            prepared_input["model"] = self.normalize_model_name(task_input.get("model"))
        elif task_type == "upload_reference_images":
            prepared_input["reference_images"] = self.prepare_reference_images(task_input.get("reference_images") or [])

        return {
            "type": task_type,
            "setup": prepared_setup,
            "input": prepared_input,
            "timeout_seconds": envelope_payload["timeout_seconds"],
        }

    def prepare_reference_images(self, entries: List[Any]) -> List[Dict[str, Any]]:
        prepared: List[Dict[str, Any]] = []
        for index, entry in enumerate(entries):
            if isinstance(entry, dict) and entry.get("data_url"):
                prepared.append(
                    {
                        "name": entry.get("name") or f"reference-{index + 1}.png",
                        "mime_type": entry.get("mime_type") or "image/png",
                        "data_url": entry["data_url"],
                        "path": entry.get("path", ""),
                    }
                )
                continue

            path = Path(str(entry)).expanduser().resolve()
            if not path.exists() or not path.is_file():
                raise FileNotFoundError(f"reference_image_not_found:{path}")

            mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            prepared.append(
                {
                    "name": path.name,
                    "mime_type": mime_type,
                    "data_url": f"data:{mime_type};base64,{encoded}",
                    "path": str(path),
                }
            )
        return prepared
