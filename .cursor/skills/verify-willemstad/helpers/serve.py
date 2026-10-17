#!/usr/bin/env python3
"""Verification scaffolding: serve the compiled theme plus preview fixtures.

This is not Obsidian. It only exposes the repo's theme.css against static
HTML that uses Obsidian class names so Chrome can exercise the CSS.
"""

from __future__ import annotations

import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(os.environ["VERIFY_REPO_ROOT"]).resolve()
SKILL_DIR = Path(os.environ["VERIFY_SKILL_DIR"]).resolve()
PREVIEW_DIR = SKILL_DIR / "preview"
BIND = os.environ.get("VERIFY_BIND", "127.0.0.1")
PORT = int(os.environ.get("VERIFY_PORT", "47821"))

THEME_CSS = REPO_ROOT / "theme.css"
MANIFEST = REPO_ROOT / "manifest.json"

VERSION_RE = re.compile(r"Willemstad \| v([0-9]+(?:\.[0-9]+)*)")


def theme_version() -> str | None:
    header = THEME_CSS.read_text(encoding="utf-8", errors="replace")[:8000]
    match = VERSION_RE.search(header)
    return match.group(1) if match else None


def health_payload() -> dict:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    css_version = theme_version()
    css_bytes = THEME_CSS.stat().st_size
    ok = (
        css_version == manifest.get("version")
        and css_bytes > 100_000
        and THEME_CSS.is_file()
    )
    return {
        "ok": ok,
        "app": manifest.get("name", "Willemstad"),
        "version": manifest.get("version"),
        "minAppVersion": manifest.get("minAppVersion"),
        "themeCssVersion": css_version,
        "themeCssBytes": css_bytes,
        "pid": os.getpid(),
        "bind": BIND,
        "port": PORT,
        "preview": "/preview/index.html",
    }


MIME = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".map": "application/json; charset=utf-8",
}


def safe_under(root: Path, rel: str) -> Path | None:
    if not rel or ".." in Path(rel).parts:
        return None
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


class Handler(BaseHTTPRequestHandler):
    server_version = "verify-willemstad/1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path in ("/", "/index.html"):
            path = "/preview/index.html"

        if path == "/healthz":
            payload = health_payload()
            self._send(
                200 if payload["ok"] else 503,
                json.dumps(payload, indent=2).encode("utf-8"),
                "application/json; charset=utf-8",
            )
            return

        if path == "/theme.css":
            data = THEME_CSS.read_bytes()
            self._send(200, data, MIME[".css"])
            return

        if path == "/manifest.json":
            self._send(200, MANIFEST.read_bytes(), MIME[".json"])
            return

        if path.startswith("/preview/"):
            rel = path[len("/preview/") :]
            target = safe_under(PREVIEW_DIR, rel)
            if target is None:
                self._send(404, b"not found\n", "text/plain; charset=utf-8")
                return
            self._send(200, target.read_bytes(), MIME.get(target.suffix, "application/octet-stream"))
            return

        self._send(404, b"not found\n", "text/plain; charset=utf-8")


def main() -> int:
    if BIND not in {"127.0.0.1", "localhost", "::1"}:
        print("verify-willemstad: bind must stay loopback (got %s)" % BIND, file=sys.stderr)
        return 2
    if not THEME_CSS.is_file() or not MANIFEST.is_file():
        print("verify-willemstad: theme.css or manifest.json missing", file=sys.stderr)
        return 2

    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(
        "verify-willemstad ready on http://%s:%s (pid %s)" % (BIND, PORT, os.getpid()),
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
