"""WABlast.exe entry point: log in, start GOWA, then send queued messages until the PC shuts down."""

import contextlib
import html
import logging
import sys
import threading
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, cast

import httpx
from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError
from supabase_auth.errors import AuthError

from . import session, webhook
from .config import Settings, app_dir, data_dir
from .gowa import Gowa, GowaError, start_gowa
from .worker import Agent

log = logging.getLogger("wablast")

READY_ATTEMPTS = 30  # GOWA normally answers within a few seconds of launch


def gowa_exe() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)  # PyInstaller one-file extraction dir
    return Path(bundle) / "gowa.exe" if bundle else app_dir().parent / "tools" / "gowa" / "gowa.exe"


def set_autostart(enabled: bool) -> None:
    """Start WABlast.exe at Windows logon (current user only). Asked after the first login, or `--autostart`."""
    import winreg

    key = r"Software\Microsoft\Windows\CurrentVersion\Run"
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, "WABlast", 0, winreg.REG_SZ, f'"{sys.executable}"')
        else:
            with contextlib.suppress(FileNotFoundError):  # never enabled on this PC
                winreg.DeleteValue(k, "WABlast")


def claim_single_instance() -> int | None:
    """Mutex handle, or None when another WABlast already runs: a second GOWA would be refused on its port.

    Windows frees the mutex when the owning process exits, so a crash never leaves it stuck.
    """
    import ctypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.CreateMutexW(None, False, "Local\\WABlast")
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        return None
    return handle


def wait_until_ready(gowa: Gowa) -> None:
    for _ in range(READY_ATTEMPTS):
        try:
            gowa.ensure_device()
            return
        except httpx.TransportError:
            time.sleep(1)  # readiness probe on a freshly launched local process, bounded
    raise RuntimeError("GOWA tidak merespons setelah dijalankan")


def send_telegram_chat_notification(
    token: str, chat_id: str, outlet_name: str, phone: str, name: str, body: str
) -> None:
    safe_outlet = html.escape(outlet_name)
    safe_phone = html.escape(phone)
    safe_name = html.escape(name if name else "-")
    if len(body) > 3000:
        body = body[:2997] + "..."
    safe_body = html.escape(body if body else "-")

    text = (
        f"💬 <b>Pesan Masuk WhatsApp Baru!</b>\n"
        f"🏢 <b>Outlet:</b> {safe_outlet}\n"
        f"📱 <b>Nomor:</b> +{safe_phone}\n"
        f"👤 <b>Pengirim:</b> {safe_name}\n\n"
        f"✉️ <b>Isi Pesan:</b>\n<i>{safe_body}</i>\n\n"
        f'👉 <a href="https://wa.me/{safe_phone}">Balas Chat di WhatsApp</a>'
    )
    chat_ids = [c.strip() for c in chat_id.replace(";", ",").split(",") if c.strip()]
    for cid in chat_ids:
        try:
            res = httpx.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": cid, "text": text, "parse_mode": "HTML"},
                timeout=10.0,
            )
            if res.status_code >= 400 or not res.json().get("ok"):
                log.warning("Gagal mengirim notifikasi telegram ke %s: %s", cid, res.text)
            else:
                log.info("Notifikasi telegram terkirim ke %s untuk pesan dari +%s", cid, phone)
        except Exception as exc:
            log.warning("Gagal mengirim notifikasi telegram ke %s: %s", cid, exc)


def send_telegram_disconnect_alert(token: str, chat_id: str, outlet_name: str) -> None:
    safe_outlet = html.escape(outlet_name)
    text = (
        f"🚨 <b>PERINGATAN: WhatsApp Terputus!</b>\n"
        f"🏢 <b>Outlet:</b> {safe_outlet}\n"
        f"⚠️ <b>Status:</b> WhatsApp logout / koneksi terputus. Promo otomatis dijeda demi keamanan.\n\n"
        f"👉 <i>Silakan buka dashboard dan scan ulang kode QR di menu WhatsApp agar pengiriman dapat dilanjutkan.</i>"
    )
    chat_ids = [c.strip() for c in chat_id.replace(";", ",").split(",") if c.strip()]
    for cid in chat_ids:
        try:
            res = httpx.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": cid, "text": text, "parse_mode": "HTML"},
                timeout=10.0,
            )
            if res.status_code >= 400 or not res.json().get("ok"):
                log.warning("Gagal mengirim alert disconnect telegram ke %s: %s", cid, res.text)
            else:
                log.info("Alert disconnect telegram terkirim ke %s untuk outlet %s", cid, outlet_name)
        except Exception as exc:
            log.warning("Gagal mengirim alert disconnect telegram ke %s: %s", cid, exc)


def send_telegram_startup_alert(token: str, chat_id: str, outlet_name: str, wa_number: str | None) -> None:
    safe_outlet = html.escape(outlet_name)
    wa_display = f"+{wa_number}" if wa_number else "Belum terhubung (cek QR di dashboard)"
    safe_number = html.escape(wa_display)
    waktu = datetime.now().strftime("%d %b %Y, %H:%M WIB")
    text = (
        f"🚀 <b>WA Blast Aktif & Siap!</b>\n"
        f"🏢 <b>Outlet:</b> {safe_outlet}\n"
        f"📱 <b>Nomor WhatsApp:</b> {safe_number}\n"
        f"⏱️ <b>Waktu Mulai:</b> {waktu}\n\n"
        f"🟢 <i>Runner sistem aktif di PC outlet. Memantau chat masuk dan antrean promo blast.</i>"
    )
    chat_ids = [c.strip() for c in chat_id.replace(";", ",").split(",") if c.strip()]
    for cid in chat_ids:
        try:
            res = httpx.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": cid, "text": text, "parse_mode": "HTML"},
                timeout=10.0,
            )
            if res.status_code >= 400 or not res.json().get("ok"):
                log.warning("Gagal mengirim startup alert telegram ke %s: %s", cid, res.text)
            else:
                log.info("Startup alert telegram terkirim ke %s untuk outlet %s", cid, outlet_name)
        except Exception as exc:
            log.warning("Gagal mengirim startup alert telegram ke %s: %s", cid, exc)


def send_telegram_daily_report(
    token: str,
    chat_id: str,
    outlet: dict[str, Any],
    db: Any,
    date_str: str,
    report_hour: int,
) -> None:
    outlet_id = outlet["id"]
    safe_outlet = html.escape(outlet["name"])
    wa_number = outlet.get("wa_number")
    wa_display = (
        f"+{wa_number} (🟢 Terhubung)"
        if outlet.get("wa_status") == "connected" and wa_number
        else "🔴 Terputus"
    )
    safe_wa = html.escape(wa_display)

    start_of_day = f"{date_str}T00:00:00"
    sent_today = 0
    failed_today = 0
    optouts_today = 0
    total_contacts = 0

    try:
        camp_res = db.table("campaigns").select("id").eq("outlet_id", outlet_id).execute()
        campaign_ids = [c["id"] for c in (camp_res.data or [])]
        if campaign_ids:
            sent_res = (
                db.table("messages")
                .select("id", count="exact")
                .in_("campaign_id", campaign_ids)
                .eq("status", "sent")
                .gte("sent_at", start_of_day)
                .execute()
            )
            sent_today = sent_res.count or 0

            failed_res = (
                db.table("messages")
                .select("id", count="exact")
                .in_("campaign_id", campaign_ids)
                .eq("status", "failed")
                .gte("created_at", start_of_day)
                .execute()
            )
            failed_today = failed_res.count or 0

        opt_res = (
            db.table("opt_outs")
            .select("id", count="exact")
            .eq("outlet_id", outlet_id)
            .gte("created_at", start_of_day)
            .execute()
        )
        optouts_today = opt_res.count or 0

        contacts_res = db.table("contacts").select("id", count="exact").eq("outlet_id", outlet_id).execute()
        total_contacts = contacts_res.count or 0
    except Exception as exc:
        log.warning("Gagal mengambil data rekap harian: %s", exc)

    text = (
        f"📊 <b>Laporan Harian WhatsApp Blast</b>\n"
        f"🏢 <b>Outlet:</b> {safe_outlet}\n"
        f"📱 <b>WhatsApp:</b> {safe_wa}\n"
        f"📅 <b>Tanggal:</b> {html.escape(date_str)}\n\n"
        f"📈 <b>Aktivitas Hari Ini:</b>\n"
        f"  • ✅ <b>Pesan Terkirim:</b> {sent_today} pesan\n"
        f"  • ❌ <b>Pesan Gagal:</b> {failed_today} pesan\n"
        f"  • 🛑 <b>Minta Berhenti (STOP):</b> {optouts_today} nomor\n"
        f"  • 👥 <b>Total Kontak Tersimpan:</b> {total_contacts} kontak\n\n"
        f"<i>Laporan otomatis direkap setiap pukul {report_hour:02d}:00.</i>"
    )

    chat_ids = [c.strip() for c in chat_id.replace(";", ",").split(",") if c.strip()]
    for cid in chat_ids:
        try:
            res = httpx.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": cid, "text": text, "parse_mode": "HTML"},
                timeout=10.0,
            )
            if res.status_code >= 400 or not res.json().get("ok"):
                log.warning("Gagal mengirim daily report telegram ke %s: %s", cid, res.text)
            else:
                log.info("Daily report telegram terkirim ke %s untuk outlet %s (%s)", cid, safe_outlet, date_str)
        except Exception as exc:
            log.warning("Gagal mengirim daily report telegram ke %s: %s", cid, exc)


def main() -> None:
    if not getattr(sys, "frozen", False) and {"--autostart", "--no-autostart"} & set(sys.argv):
        raise SystemExit("--autostart only applies to the built WABlast.exe")
    if "--autostart" in sys.argv or "--no-autostart" in sys.argv:
        set_autostart("--autostart" in sys.argv)
    instance = claim_single_instance()  # held until this process exits
    if instance is None:
        from tkinter import Tk, messagebox

        root = Tk()
        root.withdraw()
        messagebox.showinfo("WA Blast", "WA Blast sudah jalan di belakang layar. Buka dashboard untuk melihat status.")
        root.destroy()
        return
    handlers: list[logging.Handler] = [
        RotatingFileHandler(data_dir() / "wablast.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    ]
    if sys.stderr:  # None in the windowed exe
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request every tick drowns real events
    settings = Settings()  # type: ignore[call-arg]  # values come from env files
    session_file = data_dir() / "session.json"
    first_login = not session_file.exists()
    db = session.connect(settings.supabase_url, settings.supabase_anon_key, session_file)
    # Explicit opt-in on this PC; --autostart / --no-autostart still work for scripted installs.
    if first_login and getattr(sys, "frozen", False) and not {"--autostart", "--no-autostart"} & set(sys.argv):
        set_autostart(session.ask_autostart())
    user = db.auth.get_session().user  # type: ignore[union-attr]  # connect() guarantees a session
    # Filter by owner: a supervisor account sees every outlet but must not run as one.
    outlet = cast(dict[str, Any], db.table("outlets").select("*").eq("owner_user_id", user.id).single().execute().data)

    proc, auth, secret = start_gowa(gowa_exe(), data_dir() / "gowa", settings.gowa_port, settings.webhook_port)
    try:
        gowa = Gowa(settings.gowa_port, auth, outlet["gowa_device_id"])
        wait_until_ready(gowa)
        def on_disconnect_alert(outlet_name: str) -> None:
            if settings.telegram_bot_token and settings.telegram_chat_id:
                threading.Thread(
                    target=send_telegram_disconnect_alert,
                    args=(settings.telegram_bot_token, settings.telegram_chat_id, outlet_name),
                    daemon=True,
                ).start()

        agent = Agent(db, gowa, outlet, settings.signed_url_seconds, on_disconnect=on_disconnect_alert)
        stuck = agent.recover()
        if stuck:
            log.warning("%s message(s) interrupted by the last shutdown were marked failed", stuck)

        def on_incoming_chat(phone: str, name: str, body: str) -> None:
            if settings.telegram_bot_token and settings.telegram_chat_id:
                threading.Thread(
                    target=send_telegram_chat_notification,
                    args=(
                        settings.telegram_bot_token,
                        settings.telegram_chat_id,
                        outlet["name"],
                        phone,
                        name,
                        body,
                    ),
                    daemon=True,
                ).start()

        server = webhook.serve(
            "127.0.0.1",
            settings.webhook_port,
            secret,
            agent.stop_keywords,
            agent.opt_out,
            on_message=on_incoming_chat,
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        log.info("WABlast running for outlet %s", outlet["name"])

        if settings.telegram_bot_token and settings.telegram_chat_id:
            threading.Thread(
                target=send_telegram_startup_alert,
                args=(settings.telegram_bot_token, settings.telegram_chat_id, outlet["name"], outlet.get("wa_number")),
                daemon=True,
            ).start()

        daily_report_file = data_dir() / "last_daily_report.txt"
        last_reported_date: str | None = None
        if daily_report_file.exists():
            with contextlib.suppress(Exception):
                last_reported_date = daily_report_file.read_text(encoding="utf-8").strip()

        stop = threading.Event()
        # ponytail: fixed-interval poll of the DB queue; switch to Supabase Realtime if ticks get costly.
        while not stop.wait(settings.tick_seconds):
            try:
                session.keep_fresh(db)
                agent.tick()

                if settings.telegram_bot_token and settings.telegram_chat_id:
                    now_local = datetime.now()
                    today_str = now_local.strftime("%Y-%m-%d")
                    if now_local.hour >= settings.telegram_report_hour and last_reported_date != today_str:
                        last_reported_date = today_str
                        with contextlib.suppress(Exception):
                            daily_report_file.write_text(today_str, encoding="utf-8")
                        threading.Thread(
                            target=send_telegram_daily_report,
                            args=(
                                settings.telegram_bot_token,
                                settings.telegram_chat_id,
                                agent.outlet,
                                db,
                                today_str,
                                settings.telegram_report_hour,
                            ),
                            daemon=True,
                        ).start()
            except (APIError, StorageApiError, GowaError, httpx.HTTPError, AuthError):
                # Network blip or GOWA hiccup: logged with traceback, retried next tick. Queue state is in the DB.
                log.exception("tick failed")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
