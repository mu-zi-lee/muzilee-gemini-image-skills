from __future__ import annotations

from typing import Any, Dict, List


class CapabilityService:
    def __init__(self, catalog: Dict[str, Any]) -> None:
        self.catalog = catalog
        self.task_capabilities = catalog.get("capabilities", {}).get("tasks", {})
        self.feature_capabilities = catalog.get("capabilities", {}).get("features", {})

    def required_capabilities_for_payload(self, payload: Dict[str, Any]) -> List[str]:
        task_type = payload["type"]
        setup = payload.get("setup") or {}
        task_input = payload.get("input") or {}
        required = [self.task_capabilities[task_type]]

        if setup.get("new_chat"):
            required.append(self.feature_capabilities["new_chat"])
        if setup.get("model"):
            required.append(self.feature_capabilities["switch_model"])
        if setup.get("reference_images"):
            required.append(self.feature_capabilities["upload_reference_images"])

        return sorted(set(required))
