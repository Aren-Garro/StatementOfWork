"""Executable entrypoint for packaged desktop builds."""
from app.desktop_app import launch_desktop


if __name__ == "__main__":
    raise SystemExit(launch_desktop())
