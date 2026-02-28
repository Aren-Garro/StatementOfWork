"""Desktop launcher for SOW Creator.

Runs the Flask app in-process and opens either:
- a native PyWebView window (if available), or
- the system browser as a fallback.
"""
from __future__ import annotations

import socket
import threading
import time
import webbrowser
from contextlib import closing

from werkzeug.serving import make_server

from app import create_app


def _free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(sock.getsockname()[1])


class _ServerThread(threading.Thread):
    def __init__(self, host: str, port: int):
        super().__init__(daemon=True)
        app = create_app({"DEBUG": False, "TESTING": False})
        self.server = make_server(host, port, app)
        self.context = app.app_context()
        self.context.push()

    def run(self) -> None:
        self.server.serve_forever()

    def stop(self) -> None:
        self.server.shutdown()
        self.context.pop()


def launch_desktop() -> int:
    host = "127.0.0.1"
    port = _free_port()
    url = f"http://{host}:{port}"

    server = _ServerThread(host, port)
    server.start()
    time.sleep(0.4)

    try:
        try:
            import webview  # type: ignore
        except ModuleNotFoundError:
            webbrowser.open(url)
            print(f"Desktop WebView not installed; opened browser at {url}")
            print("Press Ctrl+C to stop.")
            while True:
                time.sleep(1)
        else:
            webview.create_window("SOW Creator", url=url, width=1400, height=920)
            webview.start()
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(launch_desktop())
