from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List

from ..config import CONFIG


def _base_url() -> str:
    return f"http://{CONFIG.host}:{CONFIG.port}"


def execute_task(payload: Dict[str, Any]) -> Dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{_base_url()}/agent/tasks/execute",
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    timeout = int(payload.get("timeout_seconds", CONFIG.default_task_timeout_seconds)) + 5
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"ok": False, "error": f"http_{exc.code}", "detail": body}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": "connection_failed", "detail": str(exc.reason)}


def read_worker_state() -> Dict[str, Any]:
    try:
        with urllib.request.urlopen(f"{_base_url()}/worker/state", timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        return {"ok": False, "error": "connection_failed", "detail": str(exc.reason)}


def make_chat_send_payload(
    message: str,
    timeout_seconds: int,
    model: str | None,
    new_chat: bool,
    reference_images: List[str],
) -> Dict[str, Any]:
    return {
        "type": "send_message",
        "setup": {
            "new_chat": new_chat,
            "model": model,
            "reference_images": reference_images,
        },
        "input": {"message": message},
        "timeout_seconds": timeout_seconds,
    }


def make_chat_new_payload(timeout_seconds: int) -> Dict[str, Any]:
    return {
        "type": "new_chat",
        "setup": {},
        "input": {},
        "timeout_seconds": timeout_seconds,
    }


def make_model_set_payload(model: str, timeout_seconds: int) -> Dict[str, Any]:
    return {
        "type": "switch_model",
        "setup": {},
        "input": {"model": model},
        "timeout_seconds": timeout_seconds,
    }


def make_image_generate_payload(
    prompt: str,
    timeout_seconds: int,
    output_mode: str,
    model: str | None,
    new_chat: bool,
    reference_images: List[str],
) -> Dict[str, Any]:
    return {
        "type": "generate_image",
        "setup": {
            "new_chat": new_chat,
            "model": model,
            "reference_images": reference_images,
        },
        "input": {
            "prompt": prompt,
            "output_mode": output_mode,
        },
        "timeout_seconds": timeout_seconds,
    }


def make_image_upload_reference_payload(images: List[str], timeout_seconds: int) -> Dict[str, Any]:
    return {
        "type": "upload_reference_images",
        "setup": {},
        "input": {"reference_images": images},
        "timeout_seconds": timeout_seconds,
    }


def make_image_download_latest_payload(timeout_seconds: int) -> Dict[str, Any]:
    return {
        "type": "download_latest_image",
        "setup": {},
        "input": {},
        "timeout_seconds": timeout_seconds,
    }

