"""Local webhook receiver for GOWA events. Only used to catch STOP replies."""

import hashlib
import hmac
import json
import logging
import re
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger(__name__)

_PERSONAL_JID = re.compile(r"^(\d+)@s\.whatsapp\.net$")


def verify_signature(body: bytes, header: str | None, secret: str) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def stop_request_phone(event: dict, keywords: frozenset[str]) -> str | None:
    """Phone (628...) of a contact whose whole message is a STOP keyword, else None."""
    if event.get("event") != "message":
        return None
    payload = event.get("payload") or {}
    if payload.get("is_from_me"):
        return None
    word = re.sub(r"[^\w]", "", str(payload.get("body", ""))).upper()
    if word not in keywords:
        return None
    match = _PERSONAL_JID.match(str(payload.get("from", "")))
    return match.group(1) if match else None


def serve(
    host: str,
    port: int,
    secret: str,
    keywords: Callable[[], frozenset[str]],
    on_stop: Callable[[str], None],
):
    """Build the receiver. Caller runs serve_forever() in a thread and shutdown() to stop.

    `keywords` is read per request so STOP words edited in the backend apply without a restart.
    """

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if not verify_signature(body, self.headers.get("X-Hub-Signature-256"), secret):
                log.warning("webhook rejected: bad signature")
                self.send_response(401)
                self.end_headers()
                return
            phone = stop_request_phone(json.loads(body), keywords())
            if phone:
                on_stop(phone)
                log.info("contact opted out via STOP")
            self.send_response(200)
            self.end_headers()

        def log_message(self, format, *args):  # noqa: A002 - keep phone numbers out of the console
            del format, args

    return ThreadingHTTPServer((host, port), Handler)
