from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

from ..config import CONFIG


@lru_cache(maxsize=8)
def load_protocol_catalog(path: str | None = None) -> Dict[str, Any]:
    protocol_path = Path(path or CONFIG.protocol_path).expanduser().resolve()
    return json.loads(protocol_path.read_text(encoding="utf-8"))


def get_model_alias_mapping(catalog: Dict[str, Any] | None = None) -> Dict[str, str]:
    catalog_data = catalog or load_protocol_catalog()
    mapping: Dict[str, str] = {}
    aliases = catalog_data.get("models", {}).get("aliases", {})
    for canonical, names in aliases.items():
        mapping[canonical] = canonical
        for alias in names:
            mapping[str(alias).strip().lower()] = canonical
    return mapping


def get_capability_catalog(catalog: Dict[str, Any] | None = None) -> Dict[str, Any]:
    catalog_data = catalog or load_protocol_catalog()
    return catalog_data.get("capabilities", {})

