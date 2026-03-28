from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from .error_codes import TASK_VALIDATION_ERROR
from .task_types import (
    OUTPUT_MODE_AUTO,
    OUTPUT_MODES,
    TASK_DOWNLOAD_LATEST_IMAGE,
    TASK_GENERATE_IMAGE,
    TASK_NEW_CHAT,
    TASK_SEND_MESSAGE,
    TASK_SWITCH_MODEL,
    TASK_TYPES,
    TASK_UPLOAD_REFERENCE_IMAGES,
)


class TaskValidationError(ValueError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.code = TASK_VALIDATION_ERROR


@dataclass(frozen=True)
class TaskEnvelope:
    task_type: str
    setup: Dict[str, Any]
    task_input: Dict[str, Any]
    timeout_seconds: int

    def to_payload(self) -> Dict[str, Any]:
        return {
            "type": self.task_type,
            "setup": dict(self.setup),
            "input": dict(self.task_input),
            "timeout_seconds": self.timeout_seconds,
        }


def _normalize_dict(value: Any, field_name: str) -> Dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TaskValidationError(f"{field_name}_must_be_object")
    return dict(value)


def _normalize_timeout(value: Any, default_timeout: int) -> int:
    if value in (None, ""):
        return default_timeout
    try:
        timeout = int(value)
    except (TypeError, ValueError) as exc:
        raise TaskValidationError("timeout_seconds_must_be_integer") from exc
    if timeout <= 0:
        raise TaskValidationError("timeout_seconds_must_be_positive")
    return timeout


def parse_task_envelope(payload: Dict[str, Any], default_timeout: int) -> TaskEnvelope:
    if not isinstance(payload, dict):
        raise TaskValidationError("task_payload_must_be_object")

    task_type = str(payload.get("type", "")).strip()
    if task_type not in TASK_TYPES:
        raise TaskValidationError("unsupported_task_type")

    setup = _normalize_dict(payload.get("setup"), "setup")
    task_input = _normalize_dict(payload.get("input"), "input")
    timeout_seconds = _normalize_timeout(payload.get("timeout_seconds"), default_timeout)

    if task_type == TASK_SEND_MESSAGE:
        if not str(task_input.get("message", "")).strip():
            raise TaskValidationError("missing_message")

    if task_type == TASK_GENERATE_IMAGE:
        if not str(task_input.get("prompt", "")).strip():
            raise TaskValidationError("missing_prompt")
        output_mode = str(task_input.get("output_mode", OUTPUT_MODE_AUTO)).strip() or OUTPUT_MODE_AUTO
        if output_mode not in OUTPUT_MODES:
            raise TaskValidationError("invalid_output_mode")
        task_input["output_mode"] = output_mode

    if task_type == TASK_SWITCH_MODEL:
        if not str(task_input.get("model", "")).strip():
            raise TaskValidationError("missing_model")

    if task_type == TASK_UPLOAD_REFERENCE_IMAGES:
        images = task_input.get("reference_images") or []
        if not isinstance(images, list) or not images:
            raise TaskValidationError("missing_reference_images")

    if task_type in {TASK_NEW_CHAT, TASK_DOWNLOAD_LATEST_IMAGE} and task_input:
        task_input = dict(task_input)

    return TaskEnvelope(
        task_type=task_type,
        setup=setup,
        task_input=task_input,
        timeout_seconds=timeout_seconds,
    )
