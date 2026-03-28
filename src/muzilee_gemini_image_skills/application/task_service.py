from __future__ import annotations

from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, Dict

from ..contracts.error_codes import (
    MISSING_COMPATIBLE_WORKER,
    TASK_TIMEOUT,
    UNKNOWN_TASK,
)
from ..contracts.result_models import RouteResult, TaskOutcome
from ..contracts.task_models import TaskEnvelope, TaskValidationError, parse_task_envelope
from ..state.task_queue import TaskQueue
from ..state.worker_registry import WorkerRegistry
from .artifact_store import ArtifactStore
from .capability_service import CapabilityService
from .setup_service import SetupService


@dataclass
class TaskServiceError(Exception):
    status: int
    error: str
    detail: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_route_result(self) -> RouteResult:
        body = {"ok": False, "error": self.error}
        if self.detail:
            body["detail"] = self.detail
        body.update(self.extra)
        return RouteResult(status=self.status, body=body)


class TaskService:
    def __init__(
        self,
        default_timeout_seconds: int,
        task_queue: TaskQueue,
        worker_registry: WorkerRegistry,
        setup_service: SetupService,
        capability_service: CapabilityService,
        artifact_store: ArtifactStore,
    ) -> None:
        self.default_timeout_seconds = default_timeout_seconds
        self.task_queue = task_queue
        self.worker_registry = worker_registry
        self.setup_service = setup_service
        self.capability_service = capability_service
        self.artifact_store = artifact_store

    def submit_agent_task(self, raw_payload: Dict[str, Any]) -> TaskOutcome:
        envelope = parse_task_envelope(raw_payload, self.default_timeout_seconds)
        prepared_payload = self.setup_service.prepare_task_payload(envelope.to_payload())
        required_capabilities = self.capability_service.required_capabilities_for_payload(prepared_payload)

        self._expire_stale_workers()

        if not self.worker_registry.has_compatible_worker(required_capabilities):
            raise TaskServiceError(
                status=HTTPStatus.CONFLICT,
                error=MISSING_COMPATIBLE_WORKER,
                detail="没有在线且兼容当前任务能力的 Gemini worker。请重新构建并安装 userscript，然后刷新 gemini.google.com 页面。",
                extra={"required_capabilities": required_capabilities},
            )

        task = self.task_queue.create_task(
            task_type=envelope.task_type,
            payload=prepared_payload,
            required_capabilities=required_capabilities,
        )
        finished = self.task_queue.wait_for_task(task.task_id, envelope.timeout_seconds)

        if finished.status != "done":
            return TaskOutcome(
                ok=False,
                task_id=finished.task_id,
                task_type=finished.task_type,
                result=finished.result,
                error=finished.error or TASK_TIMEOUT,
            )

        return TaskOutcome(
            ok=True,
            task_id=finished.task_id,
            task_type=finished.task_type,
            result=finished.result,
        )

    def next_task_for_worker(self, worker_id: str) -> Dict[str, Any] | None:
        self._expire_stale_workers()
        worker = self.worker_registry.get(worker_id)
        if worker is None:
            return None

        task = self.task_queue.assign_next_task(
            worker_id=worker_id,
            supports_task=lambda queued_task: worker.ready
            and self.worker_registry.supports_capabilities(worker, queued_task.required_capabilities),
        )
        if task is None:
            return None

        self.worker_registry.mark_task_assignment(worker_id, task.task_id)
        return {
            "id": task.task_id,
            "type": task.task_type,
            "payload": task.payload,
            "created_at": task.created_at,
        }

    def submit_worker_result(self, worker_id: str, task_id: str, ok: bool, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            task = self.task_queue.get(task_id)
        except KeyError as exc:
            raise TaskServiceError(status=HTTPStatus.NOT_FOUND, error=UNKNOWN_TASK) from exc

        result_payload = (
            self.artifact_store.persist_worker_payload(task.task_type, task.task_id, payload)
            if ok
            else dict(payload)
        )
        completed = self.task_queue.complete_task(
            task_id=task_id,
            ok=ok,
            result=result_payload,
            error=result_payload.get("error", "worker_failed"),
        )
        self.worker_registry.mark_task_assignment(worker_id, None)
        return {
            "task_id": completed.task_id,
            "status": completed.status,
        }

    def worker_snapshot(self) -> Dict[str, Any]:
        self._expire_stale_workers()
        snapshot = self.worker_registry.snapshot()
        snapshot.update(self.task_queue.snapshot())
        return snapshot

    def _expire_stale_workers(self) -> None:
        stale_task_ids = self.worker_registry.expire_stale_workers()
        if stale_task_ids:
            self.task_queue.requeue_tasks(stale_task_ids)

