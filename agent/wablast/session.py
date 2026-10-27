"""Supabase login for this PC. The captain signs in once; the session is kept in %APPDATA%\\WABlast."""

import json
from pathlib import Path

from supabase import Client, ClientOptions, create_client
from supabase_auth import SyncSupportedStorage  # pyright: ignore[reportPrivateImportUsage]
from supabase_auth.errors import AuthApiError

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


def ask_credentials(error: str | None) -> tuple[str, str]:
    from tkinter import Tk, messagebox, simpledialog

    root = Tk()
    root.withdraw()
    if error:
        messagebox.showerror("WA Blast", error)
    email = simpledialog.askstring("WA Blast", "Masukkan nama pengguna:")
    password = simpledialog.askstring("WA Blast", "Masukkan kata sandi:", show="*")
    root.destroy()
    if not email or not password:
        raise SystemExit("Login dibatalkan.")
    return email.strip(), password


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


def connect(url: str, anon_key: str, session_file: Path, credentials=ask_credentials) -> Client:
    client = create_client(url, anon_key, options=ClientOptions(storage=FileStorage(session_file)))
    if client.auth.get_session() is not None:
        return client
    error = None
    while True:
        email, password = credentials(error)
        try:
            client.auth.sign_in_with_password({"email": to_email(email), "password": password})
            return client
        except AuthApiError:
            error = "Nama pengguna atau kata sandi salah. Coba lagi."
