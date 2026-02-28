"""Curated template library helpers."""
from __future__ import annotations

import json
import os
from typing import Any


_LIBRARY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data",
    "template_library.json",
)


def load_curated_templates() -> list[dict[str, Any]]:
    """Load curated templates from the repository dataset."""
    if not os.path.exists(_LIBRARY_PATH):
        return []

    with open(_LIBRARY_PATH, "r", encoding="utf-8") as f:
        payload = json.load(f)

    templates = payload.get("templates", [])
    if not isinstance(templates, list):
        return []
    return [t for t in templates if isinstance(t, dict)]


def filter_library_items(
    items: list[dict[str, Any]],
    query: str = "",
    industry: str = "",
) -> list[dict[str, Any]]:
    """Apply query and industry filters to a list of template items."""
    q = (query or "").strip().lower()
    wanted_industry = (industry or "").strip().lower()

    filtered: list[dict[str, Any]] = []
    for item in items:
        item_industry = str(item.get("industry", "")).lower()
        if wanted_industry and item_industry != wanted_industry:
            continue

        if q:
            tags = item.get("tags", [])
            if not isinstance(tags, list):
                tags = []
            haystack = " ".join(
                [
                    str(item.get("name", "")),
                    str(item.get("description", "")),
                    str(item.get("industry", "")),
                    " ".join(str(tag) for tag in tags),
                ]
            ).lower()
            if q not in haystack:
                continue

        filtered.append(item)
    return filtered
