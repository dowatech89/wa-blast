"""One outlet's sending loop. Scheduling state and settings live in Supabase; only the QR timer is in memory."""

import logging
import time
from datetime import UTC, datetime
from typing import Any, cast

import httpx
from storage3.exceptions import StorageApiError
from supabase import Client

from .gowa import Gowa, GowaError

log = logging.getLogger(__name__)

Row = dict[str, Any]

QR_BUCKET = "qr-codes"
IMAGE_BUCKET = "campaign-images"
DISCONNECT_REASON = "WhatsApp terputus. Scan ulang kode QR di menu WhatsApp, lalu nyalakan lagi promonya."


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def compose_caption(message: str, name: str | None, footer: str) -> str:
    text = message.replace("{nama}", (name or "").strip() or "Kak")
    return f"{text}\n\n{footer.strip()}" if footer.strip() else text


class Agent:
    def __init__(self, db: Client, gowa: Gowa, outlet: Row, signed_url_seconds: int):
        self.db = db
        self.gowa = gowa
        self.outlet = outlet
        self.signed_url_seconds = signed_url_seconds
        self.qr_valid_until = 0.0
        # A link that drops while the agent runs (or while the PC was off) pauses running promos.
        self.was_connected = outlet.get("wa_status") == "connected"
        # Last linked number; survives a relogin so relinking the same phone keeps its warm-up progress.
        self.last_number: str | None = outlet.get("wa_number")

    @property
    def outlet_id(self) -> str:
        return self.outlet["id"]

    def stop_keywords(self) -> frozenset[str]:
        return frozenset(k.strip().upper() for k in self.outlet.get("stop_keywords") or [] if k.strip())

    def refresh(self) -> None:
        """Re-read the outlet row so settings edited in the dashboard or backend apply on the next tick."""
        self.outlet = cast(Row, self.db.table("outlets").select("*").eq("id", self.outlet_id).single().execute().data)

    def recover(self) -> int:
        """Mark messages cut off by a crash as failed. Call once at startup."""
        return cast(int, self.db.rpc("fail_stuck_messages", {"p_outlet_id": self.outlet_id}).execute().data)

    def opt_out(self, phone: str) -> None:
        self.db.rpc("opt_out_contact", {"p_outlet_id": self.outlet_id, "p_phone": phone}).execute()

    def tick(self) -> str:
        """Do one unit of work. Returns what happened: waiting_qr | idle | sent | failed | skipped."""
        self.refresh()
        self._run_commands()
        if not self.gowa.status().get("is_logged_in"):
            if self.was_connected:
                self.was_connected = False
                self.db.rpc("auto_pause", {"p_outlet_id": self.outlet_id, "p_reason": DISCONNECT_REASON}).execute()
                log.warning("WhatsApp link dropped: running promos paused")
            self._show_qr()
            return "waiting_qr"
        self.was_connected = True
        self._update_outlet(wa_status="connected", qr_image_path=None, **self._wa_number())
        return self._send_one()

    def _update_outlet(self, **fields) -> None:
        fields["last_seen_at"] = now_iso()
        self.db.table("outlets").update(fields).eq("id", self.outlet_id).execute()
        self.outlet.update(fields)

    def _wa_number(self) -> dict:
        if self.outlet.get("wa_status") == "connected" and self.outlet.get("wa_number"):
            return {}
        jid = self.gowa.info().get("jid", "")
        number = jid.split("@")[0].split(":")[0] or None
        fields: dict = {"wa_number": number}
        if number and number != self.last_number:
            self.db.rpc("mark_number_linked", {"p_outlet_id": self.outlet_id}).execute()  # warm-up restarts
        self.last_number = number or self.last_number
        return fields

    def _run_commands(self) -> None:
        pending = cast(
            list[Row],
            self.db.table("commands")
            .select("id,type")
            .eq("outlet_id", self.outlet_id)
            .is_("done_at", "null")
            .execute()
            .data,
        )
        for cmd in pending:
            if cmd["type"] == "relogin":
                if self.gowa.status().get("is_logged_in"):
                    self.gowa.logout()
                self.qr_valid_until = 0.0
                self.was_connected = False  # deliberate number change, not a dropped link
                self._update_outlet(wa_status="disconnected", wa_number=None)
                log.info("relogin requested: WhatsApp logged out")
            self.db.table("commands").update({"done_at": now_iso()}).eq("id", cmd["id"]).execute()

    def _show_qr(self) -> None:
        if time.monotonic() < self.qr_valid_until:
            self._update_outlet()  # heartbeat only, QR on the dashboard is still valid
            return
        png, seconds = self.gowa.login_qr()
        path = f"{self.outlet_id}/qr.png"
        self.db.storage.from_(QR_BUCKET).upload(
            path, png, {"content-type": "image/png", "upsert": "true", "cache-control": "0"}
        )
        self.qr_valid_until = time.monotonic() + seconds
        self._update_outlet(wa_status="waiting_qr", qr_image_path=path)

    def _send_one(self) -> str:
        rows = cast(list[Row], self.db.rpc("claim_next_message", {"p_outlet_id": self.outlet_id}).execute().data)
        if not rows:
            return "idle"
        m = rows[0]
        result, error = "sent", None
        try:
            if self.outlet.get("check_number_first") and not self.gowa.is_on_whatsapp(m["phone"]):
                result = "not_on_wa"
            else:
                image_url = None
                if m["image_path"]:
                    signed = self.db.storage.from_(IMAGE_BUCKET).create_signed_url(
                        m["image_path"], self.signed_url_seconds
                    )
                    image_url = signed["signedURL"]
                    if not image_url:
                        raise StorageApiError("gambar promo tidak ditemukan", "NotFound", 404)
                caption = compose_caption(m["message"], m["contact_name"], self.outlet.get("optout_footer") or "")
                self.gowa.send(m["phone"], caption, image_url)
        except (GowaError, StorageApiError, httpx.HTTPError) as exc:
            result, error = "failed", str(exc)[:500]
            log.warning("send failed for message %s: %s", m["message_id"], error)
        self.db.rpc("finish_message", {"p_message_id": m["message_id"], "p_result": result, "p_error": error}).execute()
        return {"sent": "sent", "failed": "failed", "not_on_wa": "skipped"}[result]
