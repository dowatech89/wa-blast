"""One outlet's sending loop. Scheduling state and settings live in Supabase; only the QR timer is in memory."""

import json
import logging
import secrets
import time
from collections.abc import Callable
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
PUSH_NAME_MAX = 25  # WhatsApp's own limit for a profile name


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def get_greeting(hour: int | None = None) -> str:
    if hour is None:
        hour = datetime.now().hour
    if 5 <= hour < 11:
        return "Selamat pagi"
    if 11 <= hour < 15:
        return "Selamat siang"
    if 15 <= hour < 18:
        return "Selamat sore"
    return "Selamat malam"


def compose_caption(message: str, name: str | None, footer: str, outlet: str = "", hour: int | None = None) -> str:
    greeting = get_greeting(hour)
    text = (
        message.replace("{nama}", (name or "").strip() or "Kak")
        .replace("{outlet}", outlet.strip())
        .replace("{salam}", greeting)
    )
    return f"{text}\n\n{footer.strip()}" if footer.strip() else text


class Agent:
    def __init__(
        self,
        db: Client,
        gowa: Gowa,
        outlet: Row,
        signed_url_seconds: int,
        on_disconnect: Callable[[str], None] | None = None,
    ):
        self.db = db
        self.gowa = gowa
        self.outlet = outlet
        self.signed_url_seconds = signed_url_seconds
        self.on_disconnect = on_disconnect
        self.qr_valid_until = 0.0
        # A link that drops while the agent runs (or while the PC was off) pauses running promos.
        self.was_connected = outlet.get("wa_status") == "connected"
        # Last linked number; survives a relogin so relinking the same phone keeps its warm-up progress.
        self.last_number: str | None = outlet.get("wa_number")
        self.push_name_failed: str | None = None

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
                if self.on_disconnect:
                    try:
                        self.on_disconnect(self.outlet["name"])
                    except Exception as exc:
                        log.warning("on_disconnect handler error: %s", exc)
            self._show_qr()
            self._check_test_send(offline=True)
            return "waiting_qr"
        self.was_connected = True
        wa_num_updates = self._wa_number()
        if (
            self.outlet.get("wa_status") != "connected"
            or self.outlet.get("qr_image_path") is not None
            or wa_num_updates
        ):
            self._update_outlet(wa_status="connected", qr_image_path=None, **wa_num_updates)
        self._sync_sender_name()
        if self._check_test_send():
            return "test_sent"
        return self._send_one()

    def _check_test_send(self, offline: bool = False) -> bool:
        """Check if dashboard requested an instant single-recipient test send."""
        test_path = f"{self.outlet_id}/test_request.json"
        try:
            raw = self.db.storage.from_(QR_BUCKET).download(test_path)
            if not raw:
                return False
            data = json.loads(raw.decode("utf-8"))
        except (StorageApiError, Exception):
            return False

        phone = str(data.get("phone", "")).strip()
        message = str(data.get("message", ""))
        contact_name = str(data.get("name", "Tester"))
        image_path = data.get("image_path")
        test_id = str(data.get("id", "test"))

        if not phone:
            return False

        if offline:
            status = "failed"
            error_msg = "WhatsApp di PC outlet belum tersambung. Silakan scan QR di menu WhatsApp terlebih dahulu."
            log.warning("Test send %s rejected: WhatsApp not logged in", test_id)
        else:
            log.info("Processing test send %s to +%s", test_id, phone)
            status = "sent"
            error_msg = None

            try:
                image_url = None
                if image_path:
                    signed = self.db.storage.from_(IMAGE_BUCKET).create_signed_url(
                        image_path, self.signed_url_seconds
                    )
                    image_url = signed.get("signedURL")

                caption = compose_caption(
                    message, contact_name, self.outlet.get("optout_footer") or "", self.outlet["name"]
                )

                try:
                    self.gowa.set_chat_presence(phone, "start")
                    time.sleep(secrets.SystemRandom().uniform(1.0, 2.0))
                except Exception as exc:
                    log.debug("test send set_chat_presence start: %s", exc)

                self.gowa.send(phone, caption, image_url)

                try:
                    self.gowa.set_chat_presence(phone, "stop")
                except Exception as exc:
                    log.debug("test send set_chat_presence stop: %s", exc)

                log.info("Test send %s sent successfully to +%s", test_id, phone)
            except Exception as exc:
                status = "failed"
                error_msg = str(exc)[:500]
                log.warning("Test send %s failed to +%s: %s", test_id, phone, error_msg)

        result_payload = {
            "id": test_id,
            "status": status,
            "phone": phone,
            "error": error_msg,
            "sent_at": now_iso(),
        }

        try:
            self.db.storage.from_(QR_BUCKET).upload(
                f"{self.outlet_id}/test_result.json",
                json.dumps(result_payload).encode("utf-8"),
                {"content-type": "application/json", "upsert": "true", "cache-control": "0"},
            )
        except Exception as exc:
            log.warning("Failed to upload test_result.json: %s", exc)

        try:
            self.db.storage.from_(QR_BUCKET).remove([test_path])
        except Exception as exc:
            log.warning("Failed to remove test_request.json: %s", exc)

        return True

    def _sync_sender_name(self) -> None:
        """Profile name people see as "~Name" when they have not saved the number: sender_name, else the outlet name.

        Applied once per change, so a name edited on the phone stays until the dashboard changes it again.
        """
        if "sender_name_applied" not in self.outlet:
            return  # database not migrated yet (20261103010000_sender_name.sql): keep sending, skip the name
        wanted = (self.outlet.get("sender_name") or self.outlet["name"]).strip()[:PUSH_NAME_MAX]
        if not wanted or wanted in (self.outlet.get("sender_name_applied"), self.push_name_failed):
            return
        try:
            self.gowa.set_push_name(wanted)
        except GowaError:
            # Never let the profile name hold up sending; retried after the next change or restart.
            self.push_name_failed = wanted
            log.exception("WhatsApp profile name not updated")
            return
        self._update_outlet(sender_name_applied=wanted)
        log.info("WhatsApp profile name updated")

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
            if "sender_name_applied" in self.outlet:
                fields["sender_name_applied"] = None  # a new phone gets the outlet's sender name too
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
            if self.outlet.get("wa_status") != "waiting_qr":
                self._update_outlet(wa_status="waiting_qr")
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
                caption = compose_caption(
                    m["message"], m["contact_name"], self.outlet.get("optout_footer") or "", self.outlet["name"]
                )

                # Simulasi sedang mengetik (Anti-Ban)
                try:
                    self.gowa.set_chat_presence(m["phone"], "start")
                    time.sleep(secrets.SystemRandom().uniform(1.5, 3.0))
                except Exception as exc:
                    log.debug("gagal set_chat_presence start: %s", exc)

                self.gowa.send(m["phone"], caption, image_url)

                try:
                    self.gowa.set_chat_presence(m["phone"], "stop")
                except Exception as exc:
                    log.debug("gagal set_chat_presence stop: %s", exc)
        except (GowaError, StorageApiError, httpx.HTTPError) as exc:
            result, error = "failed", str(exc)[:500]
            log.warning("send failed for message %s: %s", m["message_id"], error)
        self.db.rpc("finish_message", {"p_message_id": m["message_id"], "p_result": result, "p_error": error}).execute()
        return {"sent": "sent", "failed": "failed", "not_on_wa": "skipped"}[result]
