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
    assert compose_caption("Halo {nama}, ini {outlet}.", "Sari", "", "Sunset Grill") == "Halo Sari, ini Sunset Grill."


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


class _Chain:
    """Stands in for the Supabase client: every call returns itself, so db.table(...).update(...).execute() works."""

    data = None

    def __getattr__(self, _name):
        return lambda *_a, **_k: self


def test_sender_name_is_set_once_per_change_and_skipped_before_migration():
    from wablast.worker import Agent

    calls: list[str] = []
    gowa = type("FakeGowa", (), {"set_push_name": lambda _self, name: calls.append(name)})()
    outlet = {"id": "o1", "name": "Sunset Grill", "sender_name": None, "sender_name_applied": None}
    agent = Agent(_Chain(), gowa, outlet, 60)  # type: ignore[arg-type]

    agent._sync_sender_name()
    agent._sync_sender_name()
    assert calls == ["Sunset Grill"]  # outlet name by default, applied once

    agent.outlet["sender_name"] = "Sunset Grill Bali Seminyak Beach"  # longer than WhatsApp allows
    agent._sync_sender_name()
    assert calls[-1] == "Sunset Grill Bali Seminyak"[:25] and len(calls[-1]) == 25

    def refuse(_self, _name):
        from wablast.gowa import GowaError

        raise GowaError("push name refused")

    stubborn = Agent(_Chain(), type("G", (), {"set_push_name": refuse})(), dict(outlet, sender_name=None), 60)  # type: ignore[arg-type]
    stubborn._sync_sender_name()  # GOWA refuses: logged, no exception, so the tick still sends
    assert stubborn.push_name_failed == "Sunset Grill"

    before = Agent(_Chain(), gowa, {"id": "o2", "name": "Rooms"}, 60)  # type: ignore[arg-type]
    before._sync_sender_name()  # columns missing: sending must not break, nothing is set
    assert len(calls) == 2


def test_incoming_message_notification(monkeypatch):
    import httpx

    from wablast.main import send_telegram_chat_notification

    posted: list[dict] = []

    def mock_post(url, json=None, timeout=None):
        posted.append({"url": url, "json": json})
        return type("Resp", (), {"status_code": 200, "json": lambda self: {"ok": True}})()

    monkeypatch.setattr(httpx, "post", mock_post)

    send_telegram_chat_notification(
        "bot123",
        "chat456",
        "Sunset & Grill",
        "6281234567890",
        "Budi <VIP>",
        "Mau pesan meja 1 < 2 & makan?",
    )

    assert len(posted) == 1
    assert posted[0]["json"]["chat_id"] == "chat456"
    text = posted[0]["json"]["text"]
    assert "Sunset &amp; Grill" in text
    assert "Budi &lt;VIP&gt;" in text
    assert "1 &lt; 2 &amp; makan?" in text
    assert "https://wa.me/6281234567890" in text


def test_webhook_receives_incoming_chat():
    import threading
    import urllib.request

    from wablast.webhook import serve

    received: list[tuple[str, str, str]] = []
    server = serve(
        "127.0.0.1",
        0,
        SECRET,
        lambda: KEYWORDS,
        on_stop=lambda _p: None,
        on_message=lambda p, n, b: received.append((p, n, b)),
    )
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        body = json.dumps({
            "event": "message",
            "device_id": "628999@s.whatsapp.net",
            "payload": {
                "id": "MSG1",
                "chat_id": "628987654321@s.whatsapp.net",
                "from": "628987654321@s.whatsapp.net",
                "from_name": "Andi",
                "is_from_me": False,
                "body": "Halo mau tanya promo",
            },
        }).encode()

        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sign(body),
            },
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            assert resp.status == 200

        assert len(received) == 1
        assert received[0] == ("628987654321", "Andi", "Halo mau tanya promo")
    finally:
        server.shutdown()


def test_gowa_send_media_routing(monkeypatch):
    from wablast.gowa import Gowa

    calls: list[tuple[str, str, dict]] = []

    def mock_call(self, method: str, path: str, **kwargs):
        calls.append((method, path, kwargs))
        return {"message_id": "MSG_123"}

    monkeypatch.setattr(Gowa, "_call", mock_call)
    gowa = Gowa(3100, ("user", "pass"), "device-1")

    # 1. Text only
    res = gowa.send("628111", "Hello text", None)
    assert res == "MSG_123"
    assert calls[-1][1] == "/send/message"
    assert calls[-1][2]["json"]["phone"] == "628111@s.whatsapp.net"

    # 2. Image (jpg/png)
    gowa.send("628111", "Photo caption", "https://example.com/promo.jpg?token=abc")
    assert calls[-1][1] == "/send/image"
    assert calls[-1][2]["files"]["image_url"][1] == "https://example.com/promo.jpg?token=abc"

    # 3. Video (mp4/webm)
    gowa.send("628111", "Video caption", "https://example.com/video.mp4?token=abc")
    assert calls[-1][1] == "/send/video"
    assert calls[-1][2]["files"]["video_url"][1] == "https://example.com/video.mp4?token=abc"

    # 4. PDF Document (pdf)
    gowa.send("628111", "Menu PDF", "https://example.com/menu.pdf?token=abc")
    assert calls[-1][1] == "/send/file"
    assert calls[-1][2]["files"]["file_url"][1] == "https://example.com/menu.pdf?token=abc"


def test_gowa_chat_presence(monkeypatch):
    from wablast.gowa import Gowa

    calls: list[tuple[str, str, dict]] = []

    def mock_call(self, method: str, path: str, **kwargs):
        calls.append((method, path, kwargs))
        return {}

    monkeypatch.setattr(Gowa, "_call", mock_call)
    gowa = Gowa(3100, ("user", "pass"), "device-1")

    gowa.set_chat_presence("628123456789", "start")
    assert calls[-1][1] == "/send/chat-presence"
    assert calls[-1][2]["json"] == {
        "phone": "628123456789@s.whatsapp.net",
        "action": "start",
    }


def test_telegram_disconnect_alert(monkeypatch):
    import httpx

    from wablast.main import send_telegram_disconnect_alert

    posted: list[dict] = []

    def mock_post(url, json=None, timeout=None):
        posted.append({"url": url, "json": json})
        return type("Resp", (), {"status_code": 200, "json": lambda self: {"ok": True}})()

    monkeypatch.setattr(httpx, "post", mock_post)

    send_telegram_disconnect_alert("bot123", "chat456, chat789", "Sunset & Grill")

    assert len(posted) == 2
    assert posted[0]["json"]["chat_id"] == "chat456"
    assert posted[1]["json"]["chat_id"] == "chat789"
    text = posted[0]["json"]["text"]
    assert "Sunset &amp; Grill" in text
    assert "WhatsApp Terputus" in text


def test_agent_disconnect_triggers_callback():
    from wablast.worker import Agent

    disconnect_outlets: list[str] = []
    fake_gowa = type(
        "G",
        (),
        {
            "status": lambda _self: {"is_logged_in": False},
            "login_qr": lambda _self: (b"png", 60),
        },
    )()
    outlet = {"id": "o1", "name": "Sunset Grill", "wa_status": "connected"}

    class MockDb:
        def table(self, name):
            c = _Chain()
            c.data = outlet if name == "outlets" else []
            return c

        def rpc(self, *a, **k):
            return _Chain()

        @property
        def storage(self):
            return _Chain()

    agent = Agent(
        MockDb(),  # type: ignore[arg-type]
        fake_gowa,  # type: ignore[arg-type]
        outlet,
        60,
        on_disconnect=lambda name: disconnect_outlets.append(name),
    )
    assert agent.was_connected is True
    agent.tick()
    assert agent.was_connected is False
    assert disconnect_outlets == ["Sunset Grill"]


