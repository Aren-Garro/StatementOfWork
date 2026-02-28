"""Bootstrap helper for local desktop startup."""
from __future__ import annotations

import importlib
import platform
import subprocess
import sys


REQUIRED_IMPORTS = {
    "flask": "flask",
    "markdown_it": "markdown-it-py",
    "mdit_py_plugins": "mdit-py-plugins",
    "jinja2": "Jinja2",
    "dotenv": "python-dotenv",
}
OPTIONAL_IMPORTS = {
    "weasyprint": "weasyprint (PDF export)",
    "gunicorn": "gunicorn (production server)",
    "webview": "pywebview (desktop native window)",
}


def _check_modules(modules: dict[str, str]) -> list[str]:
    missing = []
    for module_name, package_name in modules.items():
        try:
            importlib.import_module(module_name)
        except ModuleNotFoundError:
            missing.append(package_name)
    return missing


def main() -> int:
    print(f"Python: {sys.version.split()[0]}")
    print(f"OS: {platform.system()} {platform.release()}")

    missing_required = _check_modules(REQUIRED_IMPORTS)
    missing_optional = _check_modules(OPTIONAL_IMPORTS)

    if missing_required:
        print("\nMissing required packages:")
        for package in missing_required:
            print(f"- {package}")
        print("\nInstall with:")
        print("python -m pip install -r requirements.txt")
        return 1

    if missing_optional:
        print("\nOptional packages not installed:")
        for package in missing_optional:
            print(f"- {package}")
        print("The app will still run with reduced functionality.")

    print("\nLaunching desktop mode...")
    return subprocess.call([sys.executable, "-m", "app.desktop_app"])


if __name__ == "__main__":
    raise SystemExit(main())
