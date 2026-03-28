from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class RouteResult:
    status: int
    body: Dict[str, Any]


@dataclass(frozen=True)
class TaskOutcome:
    ok: bool
    task_id: str
    task_type: str
    result: Optional[Dict[str, Any]] = None
    error: str | None = None
    detail: str | None = None

    def to_agent_response(self) -> Dict[str, Any]:
        payload = {
            "ok": self.ok,
            "task_id": self.task_id,
            "type": self.task_type,
        }
        if self.ok:
            payload["result"] = self.result or {}
        else:
            payload["error"] = self.error or "task_failed"
            if self.result is not None:
                payload["result"] = self.result
            if self.detail:
                payload["detail"] = self.detail
        return payload

