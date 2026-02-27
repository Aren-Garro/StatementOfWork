"""Test session compatibility shims for Windows environments."""

from __future__ import annotations

import os
from pathlib import Path
import sys


if sys.platform == "win32":
    temp_root = Path.cwd() / ".pytest_temp_root"
    temp_root.mkdir(parents=True, exist_ok=True)
    os.environ["PYTEST_DEBUG_TEMPROOT"] = str(temp_root)

    from _pytest import pathlib as pytest_pathlib

    _original_cleanup_dead_symlinks = pytest_pathlib.cleanup_dead_symlinks

    def _safe_cleanup_dead_symlinks(root):  # type: ignore[no-untyped-def]
        try:
            _original_cleanup_dead_symlinks(root)
        except PermissionError:
            # Some Windows/OneDrive setups deny directory scans during pytest
            # session teardown. Ignore this cleanup-only failure.
            return

    pytest_pathlib.cleanup_dead_symlinks = _safe_cleanup_dead_symlinks
