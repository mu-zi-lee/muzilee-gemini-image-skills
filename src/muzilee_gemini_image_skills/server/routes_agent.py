from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler

from ..application.task_service import TaskServiceError
from ..contracts.task_models import TaskValidationError
from .json_io import write_json


def handle_agent_execute(handler: BaseHTTPRequestHandler, app: "SkillApp", payload: dict) -> None:
    try:
        outcome = app.task_service.submit_agent_task(payload)
    except TaskValidationError as exc:
        write_json(
            handler,
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": exc.code,
                "detail": str(exc),
            },
        )
        return
    except FileNotFoundError as exc:
        write_json(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        return
    except ValueError as exc:
        write_json(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        return
    except TaskServiceError as exc:
        route_result = exc.to_route_result()
        write_json(handler, route_result.status, route_result.body)
        return

    status = HTTPStatus.OK if outcome.ok else HTTPStatus.REQUEST_TIMEOUT
    write_json(handler, status, outcome.to_agent_response())

