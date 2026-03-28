from __future__ import annotations

import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from ..application.task_service import TaskServiceError
from ..contracts.error_codes import MISSING_WORKER_ID
from .json_io import write_json


def handle_worker_state(handler: BaseHTTPRequestHandler, app: "SkillApp") -> None:
    write_json(handler, HTTPStatus.OK, {"ok": True, **app.task_service.worker_snapshot()})


def handle_health(handler: BaseHTTPRequestHandler, app: "SkillApp") -> None:
    write_json(
        handler,
        HTTPStatus.OK,
        {
            "ok": True,
            "service": app.catalog.get("service_name", "muzilee-gemini-image-skills"),
            "ts": int(time.time()),
        },
    )


def handle_worker_next(handler: BaseHTTPRequestHandler, app: "SkillApp", request_path: str) -> None:
    parsed = urlparse(request_path)
    query = parse_qs(parsed.query)
    worker_id = (query.get("worker_id") or [""])[0]
    if not worker_id:
        write_json(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": MISSING_WORKER_ID})
        return

    task = app.task_service.next_task_for_worker(worker_id)
    write_json(handler, HTTPStatus.OK, {"ok": True, "task": task})


def handle_worker_heartbeat(handler: BaseHTTPRequestHandler, app: "SkillApp", payload: dict) -> None:
    worker_id = payload.get("worker_id")
    if not worker_id:
        write_json(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": MISSING_WORKER_ID})
        return

    worker = app.worker_registry.heartbeat(
        worker_id=worker_id,
        page_url=payload.get("page_url", ""),
        ready=bool(payload.get("ready", False)),
        model=payload.get("model", ""),
        title=payload.get("title", ""),
        meta=payload.get("meta", {}),
    )
    write_json(
        handler,
        HTTPStatus.OK,
        {
            "ok": True,
            "worker_id": worker.worker_id,
            "poll_interval_seconds": app.config.poll_interval_seconds,
        },
    )


def handle_worker_result(handler: BaseHTTPRequestHandler, app: "SkillApp", request_path: str, payload: dict) -> None:
    worker_id = payload.get("worker_id")
    if not worker_id:
        write_json(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": MISSING_WORKER_ID})
        return

    task_id = request_path.split("/")[4]
    try:
        result = app.task_service.submit_worker_result(
            worker_id=worker_id,
            task_id=task_id,
            ok=bool(payload.get("ok")),
            payload=payload.get("payload", {}),
        )
    except TaskServiceError as exc:
        route_result = exc.to_route_result()
        write_json(handler, route_result.status, route_result.body)
        return

    write_json(handler, HTTPStatus.OK, {"ok": True, **result})

