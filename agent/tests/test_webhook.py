import hashlib
import hmac
import json

from wablast.webhook import stop_request_phone, verify_signature

SECRET = "s3cret"
KEYWORDS = frozenset({"STOP", "BERHENTI"})


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def event(body_text: str, sender: str = "6281234567890@s.whatsapp.net", from_me: bool = False) -> dict:
    # Shape taken from GOWA v9.6.0 docs/webhook-payload.md "Text Message".
    return {
        "event": "message",
        "device_id": "6289999999999@s.whatsapp.net",
        "payload": {
            "id": "3EB0C127D7BACC83D6A1",
            "chat_id": sender,
            "from": sender,
            "timestamp": "2026-10-27T10:30:00Z",
            "is_from_me": from_me,
            "body": body_text,
        },
    }


def test_signature_accepts_valid_and_rejects_tampered():
    body = json.dumps(event("STOP")).encode()
    assert verify_signature(body, sign(body), SECRET)
    assert not verify_signature(body + b" ", sign(body), SECRET)
    assert not verify_signature(body, sign(body, "wrong"), SECRET)
    assert not verify_signature(body, None, SECRET)


def test_stop_keyword_returns_sender_phone():
    assert stop_request_phone(event("stop"), KEYWORDS) == "6281234567890"
    assert stop_request_phone(event("  Berhenti. "), KEYWORDS) == "6281234567890"


def test_ignores_non_stop_messages():
    assert stop_request_phone(event("mau pesan meja"), KEYWORDS) is None
    assert stop_request_phone(event("jangan stop dulu"), KEYWORDS) is None
    assert stop_request_phone(event("STOP", from_me=True), KEYWORDS) is None
    assert stop_request_phone(event("STOP", sender="120363000000@g.us"), KEYWORDS) is None
    assert stop_request_phone({"event": "message.ack", "payload": {}}, KEYWORDS) is None


def test_caption_adds_name_and_optout_footer():
    from wablast.worker import compose_caption

    assert compose_caption("Halo {nama}!", "Budi", "Balas STOP.") == "Halo Budi!\n\nBalas STOP."
    assert compose_caption("Halo {nama}!", None, "") == "Halo Kak!"


def test_username_maps_to_account_email():
    from wablast.session import to_email

    assert to_email(" Sunset ") == "sunset@wablast.local"
    assert to_email("captain@test.local") == "captain@test.local"


def test_frozen_exe_reads_bundled_config_then_lets_a_file_next_to_it_override(monkeypatch, tmp_path):
    import sys

    from wablast import config

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "bundle"), raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "install" / "WABlast.exe"))
    assert config._env_files() == (tmp_path / "bundle" / "wablast.env", tmp_path / "install" / "wablast.env")


def test_second_wablast_on_the_same_pc_is_refused():
    from wablast.main import claim_single_instance

    first = claim_single_instance()
    try:
        assert claim_single_instance() is None
    finally:
        if first:
            import ctypes

            ctypes.windll.kernel32.CloseHandle(first)
