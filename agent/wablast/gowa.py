"""Thin client for the bundled GOWA (go-whatsapp-web-multidevice v9.8.0) REST API."""

import secrets
import subprocess
from pathlib import Path
from typing import Any

import httpx


class GowaError(Exception):
    """GOWA answered with an error; message is GOWA's own text."""


class Gowa:
    def __init__(self, port: int, basic_auth: tuple[str, str], device_id: str):
        self.base_url = f"http://127.0.0.1:{port}"
        self.device_id = device_id
        self.http = httpx.Client(base_url=self.base_url, auth=basic_auth, timeout=60)

    def _call(self, method: str, path: str, **kwargs) -> Any:
        res = self.http.request(method, path, headers={"X-Device-Id": self.device_id}, **kwargs)
        try:
            body = res.json()
        except ValueError as exc:  # e.g. plain-text 401 from the auth middleware
            raise GowaError(f"HTTP {res.status_code}: {res.text[:200]}") from exc
        if res.status_code >= 400 or body.get("code") != "SUCCESS":
            raise GowaError(body.get("message") or f"HTTP {res.status_code}")
        return body.get("results") or {}

    def ensure_device(self) -> None:
        known = self._call("GET", "/devices") or []
        if not any(d.get("id") == self.device_id for d in known):
            self._call("POST", "/devices", json={"device_id": self.device_id})

    def status(self) -> dict:
        """{'is_connected': bool, 'is_logged_in': bool, ...}"""
        return self._call("GET", f"/devices/{self.device_id}/status")

    def info(self) -> dict:
        return self._call("GET", f"/devices/{self.device_id}")

    def login_qr(self) -> tuple[bytes, int]:
        """Start QR pairing; returns (PNG bytes, seconds the QR stays valid)."""
        res = self._call("GET", f"/devices/{self.device_id}/login")
        png = self.http.get(res["qr_link"])
        png.raise_for_status()
        return png.content, int(res["qr_duration"])

    def logout(self) -> None:
        self._call("POST", f"/devices/{self.device_id}/logout")

    def is_on_whatsapp(self, phone: str) -> bool:
        return bool(self._call("GET", "/user/check", params={"phone": phone}).get("is_on_whatsapp"))

    def send(self, phone: str, caption: str, image_url: str | None) -> str:
        """Send text, or image with caption. Returns WhatsApp message id."""
        jid = f"{phone}@s.whatsapp.net"
        if image_url:
            # multipart/form-data per OpenAPI; (None, value) tuples are plain form fields.
            fields = {"phone": (None, jid), "caption": (None, caption), "image_url": (None, image_url)}
            res = self._call("POST", "/send/image", files=fields)
        else:
            res = self._call("POST", "/send/message", json={"phone": jid, "message": caption})
        return res.get("message_id", "")


def start_gowa(exe: Path, workdir: Path, port: int, webhook_port: int) -> tuple[subprocess.Popen, tuple[str, str], str]:
    """Launch GOWA bound to localhost with fresh random credentials. Returns (process, basic_auth, webhook_secret)."""
    auth = ("wablast", secrets.token_urlsafe(24))
    webhook_secret = secrets.token_urlsafe(24)
    workdir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(  # noqa: S603 - fixed binary, no shell
        [
            str(exe),
            "rest",
            "--host=127.0.0.1",
            f"--port={port}",
            f"--basic-auth={auth[0]}:{auth[1]}",
            f"--webhook=http://127.0.0.1:{webhook_port}/",
            f"--webhook-secret={webhook_secret}",
            "--webhook-events=message",
            "--webhook-ignore-jids=@g.us",
            "--mcp-enabled=false",
            "--auto-download-media=false",
            "--ui-enabled=false",
            "--os=WABlast",
        ],
        cwd=workdir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return proc, auth, webhook_secret
