"""WABlast.exe entry point: log in, start GOWA, then send queued messages until the PC shuts down."""

import contextlib
import logging
import sys
import threading
import time
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


def wait_until_ready(gowa: Gowa) -> None:
    for _ in range(READY_ATTEMPTS):
        try:
            gowa.ensure_device()
            return
        except httpx.TransportError:
            time.sleep(1)  # readiness probe on a freshly launched local process, bounded
    raise RuntimeError("GOWA tidak merespons setelah dijalankan")


def main() -> None:
    if not getattr(sys, "frozen", False) and {"--autostart", "--no-autostart"} & set(sys.argv):
        raise SystemExit("--autostart only applies to the built WABlast.exe")
    if "--autostart" in sys.argv or "--no-autostart" in sys.argv:
        set_autostart("--autostart" in sys.argv)
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
        agent = Agent(db, gowa, outlet, settings.signed_url_seconds)
        stuck = agent.recover()
        if stuck:
            log.warning("%s message(s) interrupted by the last shutdown were marked failed", stuck)

        server = webhook.serve("127.0.0.1", settings.webhook_port, secret, agent.stop_keywords, agent.opt_out)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        log.info("WABlast running for outlet %s", outlet["name"])

        stop = threading.Event()
        # ponytail: fixed-interval poll of the DB queue; switch to Supabase Realtime if ticks get costly.
        while not stop.wait(settings.tick_seconds):
            try:
                session.keep_fresh(db)
                agent.tick()
            except (APIError, StorageApiError, GowaError, httpx.HTTPError, AuthError):
                # Network blip or GOWA hiccup: logged with traceback, retried next tick. Queue state is in the DB.
                log.exception("tick failed")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
