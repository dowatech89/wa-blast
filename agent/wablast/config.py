import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def app_dir() -> Path:
    """Folder of WABlast.exe when frozen, else the agent/ source folder."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """Per-PC state (login session, WhatsApp session). Survives reinstalls of the exe."""
    path = Path(os.environ["APPDATA"]) / "WABlast"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _env_files() -> tuple[Path, ...]:
    # Later files win. The exe carries wablast.env inside (URL + publishable key are public), so outlets get one file;
    # a wablast.env next to the exe still overrides it. During development: .env.local at the repo root.
    if getattr(sys, "frozen", False):
        return (Path(getattr(sys, "_MEIPASS", app_dir())) / "wablast.env", app_dir() / "wablast.env")
    return (app_dir().parent / ".env.local", app_dir() / "wablast.env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_files(), extra="ignore")

    supabase_url: str = Field(min_length=1)
    supabase_anon_key: str = Field(min_length=1)
    gowa_port: int
    webhook_port: int
    tick_seconds: float = Field(gt=0)
    signed_url_seconds: int = Field(gt=0)
