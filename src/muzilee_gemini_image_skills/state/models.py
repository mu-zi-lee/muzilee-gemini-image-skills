from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class WorkerInfo:
    worker_id: str
    page_url: str = ""
    ready: bool = False
    model: str = ""
    title: str = ""
    last_seen: float = field(default_factory=time.time)
    current_task_id: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TaskRecord:
    task_type: str
    payload: Dict[str, Any]
    required_capabilities: list[str]
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "queued"
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    assigned_worker_id: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

