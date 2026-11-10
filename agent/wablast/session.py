"""Supabase login for this PC. The captain signs in once; the session is kept in %APPDATA%\\WABlast."""

import json
import time
from pathlib import Path

from supabase import Client, ClientOptions, create_client
from supabase_auth import SyncSupportedStorage  # pyright: ignore[reportPrivateImportUsage]
from supabase_auth.errors import AuthApiError, AuthSessionMissingError

LOGIN_DOMAIN = "wablast.local"  # same as web/src/supabase.ts


def to_email(username: str) -> str:
    """Accounts are created as <username>@wablast.local so captains only type the username."""
    username = username.strip().lower()
    return username if "@" in username else f"{username}@{LOGIN_DOMAIN}"


class FileStorage(SyncSupportedStorage):
    def __init__(self, path: Path):
        self.path = path

    def _load(self) -> dict:
        return json.loads(self.path.read_text("utf-8")) if self.path.exists() else {}

    def get_item(self, key: str) -> str | None:
        return self._load().get(key)

    def set_item(self, key: str, value: str) -> None:
        data = self._load()
        data[key] = value
        self.path.write_text(json.dumps(data), "utf-8")

    def remove_item(self, key: str) -> None:
        data = self._load()
        data.pop(key, None)
        self.path.write_text(json.dumps(data), "utf-8")


DEFAULT_OUTLETS: list[tuple[str, str]] = [
    ("Dowa Testing (Laptop)", "dowa-test"),
    ("Dowa Labs (Kantor)", "dowa"),
    ("Sunset Grill", "sunset"),
    ("D'Spa", "dspa"),
    ("D'Bistro", "dbistro"),
    ("Dragon Beach Club", "dbc"),
    ("Rooms", "rooms"),
    ("D'Bar", "dbar"),
]
MANUAL_OPTION = "Lainnya (ketik manual)..."


def ask_credentials(error: str | None = None, initial_outlet: str | None = None) -> tuple[str, str]:
    import contextlib
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title("WA Blast — Masuk Outlet")
    root.resizable(False, False)

    with contextlib.suppress(Exception):
        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")

    result: dict[str, str] = {}

    frame = ttk.Frame(root, padding=(20, 16, 20, 16))
    frame.grid(row=0, column=0, sticky="nsew")

    header = ttk.Label(
        frame,
        text="Sambungkan Komputer Outlet ke WA Blast",
        font=("Segoe UI", 11, "bold"),
    )
    header.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 4))

    sub = ttk.Label(
        frame,
        text="Pilih outlet untuk PC ini agar pesan dapat dikirim sesuai jadwal.",
        font=("Segoe UI", 8),
        foreground="#666666",
    )
    sub.grid(row=1, column=0, columnspan=2, sticky="w", pady=(0, 12))

    current_row = 2
    if error:
        err_lbl = ttk.Label(
            frame,
            text=f"⚠ {error}",
            font=("Segoe UI", 9, "bold"),
            foreground="#dc2626",
            wraplength=340,
        )
        err_lbl.grid(row=current_row, column=0, columnspan=2, sticky="w", pady=(0, 10))
        current_row += 1

    lbl_combo = ttk.Label(frame, text="Nama Outlet:", font=("Segoe UI", 9, "bold"))
    lbl_combo.grid(row=current_row, column=0, sticky="w", pady=(0, 4))
    current_row += 1

    outlet_display = [name for name, _ in DEFAULT_OUTLETS] + [MANUAL_OPTION]
    outlet_map = {name: u for name, u in DEFAULT_OUTLETS}

    # Default selection
    default_sel = outlet_display[0]
    if initial_outlet:
        for name, u in DEFAULT_OUTLETS:
            if u == initial_outlet or name.lower() == initial_outlet.lower():
                default_sel = name
                break

    combo_var = tk.StringVar(value=default_sel)
    combo = ttk.Combobox(
        frame,
        textvariable=combo_var,
        values=outlet_display,
        state="readonly",
        width=38,
        font=("Segoe UI", 9),
    )
    combo.grid(row=current_row, column=0, columnspan=2, sticky="ew", pady=(0, 10))
    current_row += 1

    # Container for manual username (hidden initially)
    manual_frame = ttk.Frame(frame)
    lbl_manual = ttk.Label(manual_frame, text="Username Manual:", font=("Segoe UI", 9, "bold"))
    lbl_manual.grid(row=0, column=0, sticky="w", pady=(0, 2))
    manual_entry = ttk.Entry(manual_frame, width=40, font=("Segoe UI", 9))
    manual_entry.grid(row=1, column=0, sticky="ew", pady=(0, 10))

    manual_row = current_row

    def on_outlet_changed(_event: object = None) -> None:
        if combo_var.get() == MANUAL_OPTION:
            manual_frame.grid(row=manual_row, column=0, columnspan=2, sticky="ew")
            manual_entry.focus_set()
        else:
            manual_frame.grid_remove()
            pwd_entry.focus_set()

    combo.bind("<<ComboboxSelected>>", on_outlet_changed)
    current_row += 1

    lbl_pwd = ttk.Label(frame, text="Kata Sandi:", font=("Segoe UI", 9, "bold"))
    lbl_pwd.grid(row=current_row, column=0, sticky="w", pady=(0, 4))
    current_row += 1

    pwd_entry = ttk.Entry(frame, show="*", width=40, font=("Segoe UI", 9))
    pwd_entry.grid(row=current_row, column=0, columnspan=2, sticky="ew", pady=(0, 6))
    current_row += 1

    show_pwd_var = tk.BooleanVar(value=False)

    def toggle_show_pwd() -> None:
        pwd_entry.config(show="" if show_pwd_var.get() else "*")

    chk = ttk.Checkbutton(frame, text="Tampilkan kata sandi", variable=show_pwd_var, command=toggle_show_pwd)
    chk.grid(row=current_row, column=0, columnspan=2, sticky="w", pady=(0, 14))
    current_row += 1

    btn_frame = ttk.Frame(frame)
    btn_frame.grid(row=current_row, column=0, columnspan=2, sticky="e")

    def on_cancel(_event: object = None) -> None:
        root.destroy()

    def on_submit(_event: object = None) -> None:
        choice = combo_var.get()
        if choice == MANUAL_OPTION:
            uname = manual_entry.get().strip()
            if not uname:
                manual_entry.focus_set()
                return
        else:
            uname = outlet_map.get(choice, "")
        pword = pwd_entry.get()
        if not pword:
            pwd_entry.focus_set()
            return

        result["username"] = uname
        result["password"] = pword
        root.destroy()

    btn_cancel = ttk.Button(btn_frame, text="Batal", command=on_cancel)
    btn_cancel.grid(row=0, column=0, padx=(0, 8))

    btn_submit = ttk.Button(btn_frame, text="Masuk & Sambungkan", command=on_submit)
    btn_submit.grid(row=0, column=1)

    root.bind("<Return>", on_submit)
    root.bind("<Escape>", on_cancel)

    # Center window
    root.update_idletasks()
    w = root.winfo_reqwidth()
    h = root.winfo_reqheight()
    sw = root.winfo_screenwidth()
    sh = root.winfo_screenheight()
    root.geometry(f"+{(sw - w) // 2}+{(sh - h) // 2}")

    root.attributes("-topmost", True)
    root.after(100, lambda: root.attributes("-topmost", False))
    pwd_entry.focus_set()

    root.mainloop()

    if "username" not in result or "password" not in result:
        raise SystemExit("Login dibatalkan.")
    return result["username"], result["password"]


def ask_autostart() -> bool:
    """Shown once after the first login: the exe has no window, so this is also the sign that it is running."""
    from tkinter import Tk, messagebox

    root = Tk()
    root.withdraw()
    answer = messagebox.askyesno(
        "WA Blast",
        "WA Blast sudah jalan di belakang layar. Buka dashboard untuk scan kode QR.\n\n"
        "Nyalakan WA Blast otomatis setiap PC menyala?",
    )
    root.destroy()
    return answer


# Refresh this long before expiry: the PC clock can run behind Supabase's, and the token lives 1 hour.
REFRESH_BEFORE_SECONDS = 600


def keep_fresh(client: Client) -> None:
    """Called every tick. supabase-py's own refresh timer runs in a background thread whose errors vanish in
    the windowed exe; after one silent failure every request got "JWT expired" and the PC looked switched off."""
    current = client.auth.get_session()
    if current is None or current.expires_at is None:
        raise AuthSessionMissingError()
    if current.expires_at - time.time() < REFRESH_BEFORE_SECONDS:
        try:
            client.auth.refresh_session()
        except AuthApiError as exc:
            import logging
            logging.getLogger(__name__).warning("Session refresh failed (will retry next tick): %s", exc)


def connect(url: str, anon_key: str, session_file: Path, credentials=ask_credentials) -> Client:
    options = ClientOptions(storage=FileStorage(session_file), auto_refresh_token=False)  # keep_fresh() does it
    client = create_client(url, anon_key, options=options)
    try:
        sess = client.auth.get_session()
        if sess is not None:
            # Verify the session is genuinely valid and accepted by Supabase
            client.auth.get_user()
            return client
    except Exception:
        # Saved login was revoked, expired, or invalid: clean stale session and re-prompt below
        if session_file.exists():
            session_file.unlink(missing_ok=True)
    error = None
    last_username = None
    while True:
        try:
            email, password = credentials(error, initial_outlet=last_username)
        except TypeError:
            email, password = credentials(error)
        try:
            client.auth.sign_in_with_password({"email": to_email(email), "password": password})
            return client
        except AuthApiError:
            error = "Nama pengguna atau kata sandi salah. Coba lagi."
            last_username = email
