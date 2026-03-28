from __future__ import annotations

import threading
import time
from typing import Callable, Dict, List, Optional

from .models import TaskRecord


class TaskQueue:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._tasks: Dict[str, TaskRecord] = {}
        self._task_order: List[str] = []

    def create_task(self, task_type: str, payload: dict, required_capabilities: list[str]) -> TaskRecord:
        with self._condition:
            task = TaskRecord(
                task_type=task_type,
                payload=payload,
                required_capabilities=list(required_capabilities),
            )
            self._tasks[task.task_id] = task
            self._task_order.append(task.task_id)
            self._condition.notify_all()
            return task

    def assign_next_task(
        self,
        worker_id: str,
        supports_task: Callable[[TaskRecord], bool],
    ) -> TaskRecord | None:
        with self._condition:
            for task_id in self._task_order:
                task = self._tasks[task_id]
                if task.status != "queued":
                    continue
                if not supports_task(task):
                    continue
                task.status = "running"
                task.started_at = time.time()
                task.assigned_worker_id = worker_id
                return task
            return None

    def get(self, task_id: str) -> TaskRecord:
        return self._tasks[task_id]

    def complete_task(self, task_id: str, ok: bool, result: dict, error: str | None = None) -> TaskRecord:
        with self._condition:
            task = self._tasks[task_id]
            if task.status in {"done", "failed"}:
                return task
            task.status = "done" if ok else "failed"
            task.result = result
            task.error = None if ok else (error or "worker_failed")
            task.finished_at = time.time()
            self._condition.notify_all()
            return task

    def requeue_tasks(self, task_ids: list[str]) -> None:
        with self._condition:
            for task_id in task_ids:
                task = self._tasks.get(task_id)
                if task is None or task.status != "running":
                    continue
                task.status = "queued"
                task.started_at = None
                task.assigned_worker_id = None
            self._condition.notify_all()

    def wait_for_task(self, task_id: str, timeout_seconds: int) -> TaskRecord:
        deadline = time.time() + timeout_seconds
        with self._condition:
            while True:
                task = self._tasks[task_id]
                if task.status in {"done", "failed"}:
                    return task

                remaining = deadline - time.time()
                if remaining <= 0:
                    task.status = "failed"
                    task.error = "timeout"
                    task.finished_at = time.time()
                    return task

                self._condition.wait(timeout=remaining)

    def snapshot(self) -> Dict[str, int]:
        with self._lock:
            return {
                "queued_tasks": sum(1 for task in self._tasks.values() if task.status == "queued"),
                "running_tasks": sum(1 for task in self._tasks.values() if task.status == "running"),
            }

