from __future__ import annotations

import threading
import time
from typing import Any, Dict, Iterable, List, Optional

from .models import WorkerInfo


class WorkerRegistry:
    def __init__(self, worker_timeout_seconds: int) -> None:
        self.worker_timeout_seconds = worker_timeout_seconds
        self._lock = threading.RLock()
        self._workers: Dict[str, WorkerInfo] = {}

    def heartbeat(
        self,
        worker_id: str,
        page_url: str,
        ready: bool,
        model: str,
        title: str,
        meta: Optional[Dict[str, Any]] = None,
    ) -> WorkerInfo:
        with self._lock:
            worker = self._workers.get(worker_id)
            if worker is None:
                worker = WorkerInfo(worker_id=worker_id)
                self._workers[worker_id] = worker
            worker.page_url = page_url
            worker.ready = ready
            worker.model = model
            worker.title = title
            worker.meta = meta or {}
            worker.last_seen = time.time()
            return worker

    def get(self, worker_id: str) -> WorkerInfo | None:
        with self._lock:
            return self._workers.get(worker_id)

    def expire_stale_workers(self) -> List[str]:
        with self._lock:
            now = time.time()
            stale_task_ids: List[str] = []
            stale_worker_ids = [
                worker_id
                for worker_id, worker in self._workers.items()
                if now - worker.last_seen > self.worker_timeout_seconds
            ]
            for worker_id in stale_worker_ids:
                worker = self._workers.pop(worker_id, None)
                if worker and worker.current_task_id:
                    stale_task_ids.append(worker.current_task_id)
            return stale_task_ids

    def has_compatible_worker(self, required_capabilities: Iterable[str]) -> bool:
        with self._lock:
            for worker in self._workers.values():
                if not worker.ready:
                    continue
                if self.supports_capabilities(worker, required_capabilities):
                    return True
            return False

    def supports_capabilities(self, worker: WorkerInfo, required_capabilities: Iterable[str]) -> bool:
        worker_caps = set(worker.meta.get("capabilities") or [])
        return all(capability in worker_caps for capability in required_capabilities)

    def mark_task_assignment(self, worker_id: str, task_id: str | None) -> None:
        with self._lock:
            worker = self._workers.get(worker_id)
            if worker is not None:
                worker.current_task_id = task_id

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            workers = [
                {
                    "worker_id": worker.worker_id,
                    "page_url": worker.page_url,
                    "ready": worker.ready,
                    "model": worker.model,
                    "title": worker.title,
                    "last_seen": worker.last_seen,
                    "current_task_id": worker.current_task_id,
                    "meta": worker.meta,
                }
                for worker in self._workers.values()
            ]
            return {
                "online": bool(workers),
                "workers": workers,
            }

