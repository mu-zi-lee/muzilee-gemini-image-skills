from __future__ import annotations

import json
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Type

from ..application.artifact_store import ArtifactStore
from ..application.capability_service import CapabilityService
from ..application.setup_service import SetupService
from ..application.task_service import TaskService
from ..config import CONFIG, Config
from ..contracts.protocol_loader import load_protocol_catalog
from ..state.task_queue import TaskQueue
from ..state.worker_registry import WorkerRegistry
from .json_io import read_json, write_json
from .routes_agent import handle_agent_execute
from .routes_worker import (
    handle_health,
    handle_worker_heartbeat,
    handle_worker_next,
    handle_worker_result,
    handle_worker_state,
)


@dataclass
class SkillApp:
    config: Config
    catalog: Dict[str, Any]
    worker_registry: WorkerRegistry
    task_queue: TaskQueue
    task_service: TaskService


def build_app(config: Config | None = None, catalog: Dict[str, Any] | None = None) -> SkillApp:
    app_config = config or CONFIG
    catalog_data = catalog or load_protocol_catalog(str(app_config.protocol_path))

    worker_registry = WorkerRegistry(worker_timeout_seconds=app_config.worker_timeout_seconds)
    task_queue = TaskQueue()
    setup_service = SetupService(catalog=catalog_data)
    capability_service = CapabilityService(catalog=catalog_data)
    artifact_store = ArtifactStore(output_dir=app_config.output_dir)
    task_service = TaskService(
        default_timeout_seconds=app_config.default_task_timeout_seconds,
        task_queue=task_queue,
        worker_registry=worker_registry,
        setup_service=setup_service,
        capability_service=capability_service,
        artifact_store=artifact_store,
    )
    return SkillApp(
        config=app_config,
        catalog=catalog_data,
        worker_registry=worker_registry,
        task_queue=task_queue,
        task_service=task_service,
    )


def create_handler(app: SkillApp) -> Type[BaseHTTPRequestHandler]:
    class RequestHandler(BaseHTTPRequestHandler):
        server_version = "MuzileeGeminiSkillHTTP/0.1"

        def do_OPTIONS(self) -> None:
            write_json(self, HTTPStatus.OK, {"ok": True})

        def do_GET(self) -> None:
            if self.path == "/health":
                handle_health(self, app)
                return

            if self.path == "/worker/state":
                handle_worker_state(self, app)
                return

            if self.path.startswith("/api/worker/tasks/next"):
                handle_worker_next(self, app, self.path)
                return

            write_json(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

        def do_POST(self) -> None:
            try:
                payload = read_json(self)
            except json.JSONDecodeError as exc:
                write_json(
                    self,
                    HTTPStatus.BAD_REQUEST,
                    {"ok": False, "error": "invalid_json", "detail": exc.msg},
                )
                return

            if self.path == "/agent/tasks/execute":
                handle_agent_execute(self, app, payload)
                return

            if self.path == "/api/worker/heartbeat":
                handle_worker_heartbeat(self, app, payload)
                return

            if self.path.startswith("/api/worker/tasks/") and self.path.endswith("/result"):
                handle_worker_result(self, app, self.path, payload)
                return

            write_json(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

        def log_message(self, format: str, *args: object) -> None:
            return

    return RequestHandler


def create_http_server(app: SkillApp) -> ThreadingHTTPServer:
    address = (app.config.host, app.config.port)
    return ThreadingHTTPServer(address, create_handler(app))


def main() -> None:
    app = build_app()
    server = create_http_server(app)
    print(f"[muzilee-gemini-image-skills] server listening on http://{app.config.host}:{app.config.port}")
    print(f"[muzilee-gemini-image-skills] output dir: {app.config.output_dir}")
    server.serve_forever()


if __name__ == "__main__":
    main()

