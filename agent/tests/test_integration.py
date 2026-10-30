"""End-to-end against the local Supabase stack (`npx supabase start`) and a real GOWA process.

WhatsApp itself is not logged in here, so these tests cover everything up to the actual delivery:
login, QR publishing, commands, crash recovery, claiming, failure recording and STOP opt-out.
"""

import hashlib
import hmac
import json
import shutil
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from postgrest.exceptions import APIError
from supabase import create_client

from wablast import session, webhook
from wablast.gowa import Gowa, start_gowa
from wablast.main import gowa_exe, wait_until_ready
from wablast.worker import IMAGE_BUCKET, QR_BUCKET, Agent

REPO = Path(__file__).resolve().parents[2]
GOWA_PORT, WEBHOOK_PORT = 3910, 3911


@pytest.fixture(scope="module")
def outlet(admin):
    email, password = f"captain-{uuid.uuid4().hex[:8]}@test.local", "test-password-123"
    user = admin.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
    row = (
        admin.table("outlets")
        .insert(
            {
                "name": "Outlet Test",
                "owner_user_id": user.id,
                "gowa_device_id": f"test-{user.id[:8]}",
                "daily_limit": 50,
                "delay_min_sec": 1,
                "delay_max_sec": 1,
                "send_start": "00:00",
                "send_end": "23:59:59",
                "timezone": "Asia/Jakarta",
            }
        )
        .execute()
        .data[0]
    )
    return {**row, "email": email, "password": password}


@pytest.fixture(scope="module")
def db(stack, outlet, tmp_path_factory):
    session_file = tmp_path_factory.mktemp("session") / "session.json"
    asked = []

    def creds(error):
        asked.append(error)
        return (outlet["email"], "wrong-password") if len(asked) == 1 else (outlet["email"], outlet["password"])

    client = session.connect(stack["url"], stack["anon"], session_file, credentials=creds)
    assert asked == [None, "Nama pengguna atau kata sandi salah. Coba lagi."]  # wrong password re-asks
    # A second start reuses the saved session without asking again.
    session.connect(stack["url"], stack["anon"], session_file, credentials=lambda _error: pytest.fail("asked again"))
    return client


@pytest.fixture(scope="module")
def gowa(outlet, tmp_path_factory):
    workdir = tmp_path_factory.mktemp("gowa")
    proc, auth, secret = start_gowa(gowa_exe(), workdir, GOWA_PORT, WEBHOOK_PORT)
    client = Gowa(GOWA_PORT, auth, outlet["gowa_device_id"])
    wait_until_ready(client)
    yield client, secret
    proc.terminate()
    proc.wait()
    shutil.rmtree(workdir, ignore_errors=True)


@pytest.fixture(scope="module")
def agent(db, gowa, outlet):
    row = db.table("outlets").select("*").single().execute().data
    assert row["id"] == outlet["id"]  # RLS: the captain sees exactly their own outlet
    return Agent(db, gowa[0], row, signed_url_seconds=600)


def test_tick_publishes_qr_while_logged_out(agent, db):
    assert agent.tick() == "waiting_qr"
    row = db.table("outlets").select("wa_status,qr_image_path,last_seen_at").single().execute().data
    assert row["wa_status"] == "waiting_qr" and row["last_seen_at"]
    png = db.storage.from_(QR_BUCKET).download(row["qr_image_path"])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"

    # Within the QR lifetime the next tick only sends a heartbeat (no new QR).
    first_qr_deadline = agent.qr_valid_until
    assert agent.tick() == "waiting_qr"
    assert agent.qr_valid_until == first_qr_deadline


def test_relogin_command_is_consumed(agent, db, outlet):
    cmd = db.table("commands").insert({"outlet_id": outlet["id"], "type": "relogin"}).execute().data[0]
    agent.tick()
    done = db.table("commands").select("done_at").eq("id", cmd["id"]).single().execute().data
    assert done["done_at"] is not None


def reset_outlet(admin, outlet, **fields):
    defaults = {"next_send_at": "2000-01-01T00:00:00Z", "consecutive_failures": 0, "pause_reason": None}
    admin.table("outlets").update({**defaults, **fields}).eq("id", outlet["id"]).execute()


def start_campaign(db, outlet, image_path=None):
    camp = (
        db.table("campaigns")
        .insert({"outlet_id": outlet["id"], "title": "T", "message": "Halo {nama}", "image_path": image_path})
        .execute()
        .data[0]
    )
    db.rpc(
        "set_campaign_status",
        {"p_campaign_id": camp["id"], "p_status": "running", "p_expected_version": camp["version"]},
    ).execute()
    return camp


@pytest.fixture
def running_campaign(db, admin, outlet):
    reset_outlet(admin, outlet)
    phones = [f"62812{uuid.uuid4().int % 10**8:08d}" for _ in range(2)]
    db.table("contacts").insert(
        [{"outlet_id": outlet["id"], "phone": p, "name": f"C{i}"} for i, p in enumerate(phones)]
    ).execute()
    image_path = f"{outlet['id']}/{uuid.uuid4().hex}.png"
    db.storage.from_(IMAGE_BUCKET).upload(
        image_path, (REPO / "agent/tests/promo.png").read_bytes(), {"content-type": "image/png"}
    )
    camp = start_campaign(db, outlet, image_path)
    yield camp, phones
    admin.table("campaigns").delete().eq("outlet_id", outlet["id"]).execute()
    admin.table("contacts").delete().in_("phone", phones).execute()


def test_send_failure_is_recorded_not_swallowed(agent, db, admin, outlet, running_campaign):
    camp, _ = running_campaign
    admin.table("outlets").update({"next_send_at": "2000-01-01T00:00:00Z"}).eq("id", outlet["id"]).execute()
    # WhatsApp is not logged in, so GOWA rejects the send; the message must end as failed with GOWA's reason.
    assert agent._send_one() == "failed"
    failed = (
        db.table("messages").select("status,error").eq("campaign_id", camp["id"]).eq("status", "failed").execute().data
    )
    assert len(failed) == 1 and failed[0]["error"]


def test_recover_marks_interrupted_sends_failed(agent, db, admin, running_campaign):
    camp, _ = running_campaign
    msg = db.table("messages").select("id").eq("campaign_id", camp["id"]).limit(1).execute().data[0]
    admin.table("messages").update({"status": "sending"}).eq("id", msg["id"]).execute()
    assert agent.recover() == 1
    row = db.table("messages").select("status,error").eq("id", msg["id"]).single().execute().data
    assert row["status"] == "failed" and "terputus" in row["error"]


def test_stop_reply_opts_contact_out(agent, db, gowa, running_campaign):
    _, phones = running_campaign
    secret = gowa[1]
    server = webhook.serve("127.0.0.1", WEBHOOK_PORT, secret, agent.stop_keywords, agent.opt_out)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        body = json.dumps(
            {
                "event": "message",
                "payload": {"from": f"{phones[1]}@s.whatsapp.net", "is_from_me": False, "body": "STOP"},
            }
        ).encode()
        bad = httpx.post(
            f"http://127.0.0.1:{WEBHOOK_PORT}/", content=body, headers={"X-Hub-Signature-256": "sha256=00"}
        )
        assert bad.status_code == 401
        sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        ok = httpx.post(f"http://127.0.0.1:{WEBHOOK_PORT}/", content=body, headers={"X-Hub-Signature-256": sig})
        assert ok.status_code == 200
    finally:
        server.shutdown()
    contact = db.table("contacts").select("opted_out").eq("phone", phones[1]).single().execute().data
    assert contact["opted_out"] is True


def post_signed(secret: str, phone: str, text: str) -> None:
    body = json.dumps(
        {"event": "message", "payload": {"from": f"{phone}@s.whatsapp.net", "is_from_me": False, "body": text}}
    ).encode()
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    httpx.post(f"http://127.0.0.1:{WEBHOOK_PORT}/", content=body, headers={"X-Hub-Signature-256": sig})


def test_stop_keywords_follow_outlet_settings(agent, db, admin, gowa, outlet, running_campaign):
    _, phones = running_campaign
    reset_outlet(admin, outlet, stop_keywords=["BATAL"])
    agent.refresh()  # the agent re-reads outlet settings every tick
    server = webhook.serve("127.0.0.1", WEBHOOK_PORT, gowa[1], agent.stop_keywords, agent.opt_out)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        post_signed(gowa[1], phones[0], "STOP")
        post_signed(gowa[1], phones[1], "batal")
    finally:
        server.shutdown()
        reset_outlet(admin, outlet, stop_keywords=["STOP", "BERHENTI", "UNSUBSCRIBE"])
        agent.refresh()
    rows = db.table("contacts").select("phone,opted_out").in_("phone", phones).execute().data
    assert {r["phone"]: r["opted_out"] for r in rows} == {phones[0]: False, phones[1]: True}


def test_failures_in_a_row_pause_all_promos(agent, db, admin, outlet, running_campaign):
    camp, _ = running_campaign
    reset_outlet(admin, outlet, pause_after_failures=2)
    agent.refresh()
    for _ in range(2):
        # Not logged in: GOWA rejects the number check, so each attempt is a real failure.
        assert agent._send_one() == "failed"
        admin.table("outlets").update({"next_send_at": "2000-01-01T00:00:00Z"}).eq("id", outlet["id"]).execute()
    state = db.table("outlets").select("pause_reason,consecutive_failures").single().execute().data
    assert state["consecutive_failures"] == 2 and "gagal berturut-turut" in state["pause_reason"]
    assert db.table("campaigns").select("status").eq("id", camp["id"]).single().execute().data["status"] == "paused"

    # Turning the promo back on clears the alert and the streak.
    version = db.table("campaigns").select("version").eq("id", camp["id"]).single().execute().data["version"]
    db.rpc(
        "set_campaign_status", {"p_campaign_id": camp["id"], "p_status": "running", "p_expected_version": version}
    ).execute()
    state = db.table("outlets").select("pause_reason,consecutive_failures").single().execute().data
    assert state == {"pause_reason": None, "consecutive_failures": 0}
    reset_outlet(admin, outlet, pause_after_failures=3)


def test_whatsapp_disconnect_pauses_running_promos(agent, db, outlet, running_campaign):
    camp, _ = running_campaign
    agent.was_connected = True  # as if WhatsApp was linked on the previous tick
    agent.tick()  # GOWA reports logged out
    state = db.table("outlets").select("pause_reason").single().execute().data
    assert "WhatsApp terputus" in state["pause_reason"]
    assert db.table("campaigns").select("status").eq("id", camp["id"]).single().execute().data["status"] == "paused"


def test_number_without_whatsapp_is_skipped_for_good(db, outlet, running_campaign):
    _, phones = running_campaign
    m = db.rpc("claim_next_message", {"p_outlet_id": outlet["id"]}).execute().data[0]
    db.rpc("finish_message", {"p_message_id": m["message_id"], "p_result": "not_on_wa", "p_error": None}).execute()
    row = db.table("messages").select("status,error").eq("id", m["message_id"]).single().execute().data
    assert row == {"status": "skipped", "error": "nomor tidak terdaftar di WhatsApp"}
    contact = db.table("contacts").select("not_on_whatsapp").eq("phone", m["phone"]).single().execute().data
    assert contact["not_on_whatsapp"] is True
    assert db.table("outlets").select("consecutive_failures").single().execute().data["consecutive_failures"] == 0
    # A new promo does not queue that contact again.
    camp2 = start_campaign(db, outlet)
    queued = db.table("messages").select("contact_id").eq("campaign_id", camp2["id"]).execute().data
    assert len(queued) == len(phones) - 1


def test_second_promo_waits_until_the_gap_has_passed(db, admin, outlet, running_campaign):
    camp, _ = running_campaign  # outlet default: 3 calendar days between promos
    first = [r["id"] for r in db.table("messages").select("id").eq("campaign_id", camp["id"]).execute().data]
    admin.table("messages").update({"status": "sent", "sent_at": datetime.now(UTC).isoformat()}).in_(
        "id", first
    ).execute()
    camp2 = start_campaign(db, outlet)

    # Postponed, not skipped: nothing to send now, but promo 2 keeps its queue and stays running.
    assert db.rpc("claim_next_message", {"p_outlet_id": outlet["id"]}).execute().data == []
    rows = db.table("messages").select("status").eq("campaign_id", camp2["id"]).execute().data
    assert {r["status"] for r in rows} == {"queued"}
    assert db.table("campaigns").select("status").eq("id", camp2["id"]).single().execute().data["status"] == "running"

    # 2 days ago is still inside a 3-day gap; 3 days ago is not.
    for days, expected in ((2, []), (3, [camp2["id"]])):
        sent_at = (datetime.now(UTC) - timedelta(days=days)).isoformat()
        admin.table("messages").update({"sent_at": sent_at}).in_("id", first).execute()
        claimed = db.rpc("claim_next_message", {"p_outlet_id": outlet["id"]}).execute().data
        assert [m["campaign_id"] for m in claimed] == expected


@pytest.mark.parametrize(
    ("days_ago", "enabled", "daily_limit", "expected"),
    [(0, True, 50, 10), (2, True, 50, 20), (30, True, 50, 50), (2, False, 50, 50), (2, True, 15, 15)],
)
def test_warmup_limit_grows_daily(db, admin, outlet, days_ago, enabled, daily_limit, expected):
    jakarta = timezone(timedelta(hours=7))  # Asia/Jakarta, no DST
    since = (datetime.now(jakarta).date() - timedelta(days=days_ago)).isoformat()
    reset_outlet(
        admin,
        outlet,
        wa_connected_since=since,
        warmup_enabled=enabled,
        daily_limit=daily_limit,
        warmup_start_limit=10,
        warmup_daily_increase=5,
    )
    assert db.rpc("today_limit", {"p_outlet_id": outlet["id"]}).execute().data == expected


def test_linking_a_new_number_restarts_warmup(db, admin, outlet):
    reset_outlet(
        admin,
        outlet,
        wa_connected_since="2000-01-01",
        warmup_enabled=True,
        daily_limit=50,
        warmup_start_limit=10,
        warmup_daily_increase=5,
    )
    assert db.rpc("today_limit", {"p_outlet_id": outlet["id"]}).execute().data == 50
    db.rpc("mark_number_linked", {"p_outlet_id": outlet["id"]}).execute()
    assert db.rpc("today_limit", {"p_outlet_id": outlet["id"]}).execute().data == 10


def sign_in_supervisor(stack, admin):
    email = f"supervisor-{uuid.uuid4().hex[:8]}@test.local"
    sup = admin.auth.admin.create_user({"email": email, "password": "test-password-123", "email_confirm": True}).user
    admin.table("supervisors").insert({"user_id": sup.id}).execute()
    sup_db = create_client(stack["url"], stack["anon"])
    sup_db.auth.sign_in_with_password({"email": email, "password": "test-password-123"})
    return sup, sup_db


def test_supervisor_sees_every_outlet_captain_only_own(stack, admin, outlet, db):
    other = admin.auth.admin.create_user(
        {"email": f"other-{uuid.uuid4().hex[:8]}@test.local", "password": "test-password-123", "email_confirm": True}
    ).user
    admin.table("outlets").insert(
        {
            "name": "Outlet Lain",
            "owner_user_id": other.id,
            "gowa_device_id": f"test-{other.id[:8]}",
            "daily_limit": 50,
            "delay_min_sec": 1,
            "delay_max_sec": 1,
            "send_start": "00:00",
            "send_end": "23:59:59",
            "timezone": "Asia/Jakarta",
        }
    ).execute()
    sup, sup_db = sign_in_supervisor(stack, admin)

    seen = {r["id"] for r in sup_db.table("outlets").select("id").execute().data}
    assert {outlet["id"]} < seen
    assert [r["id"] for r in db.table("outlets").select("id").execute().data] == [outlet["id"]]
    assert sup_db.rpc("today_limit", {"p_outlet_id": outlet["id"]}).execute().data is not None
    sup_db.table("outlets").update({"pause_reason": None}).eq("id", outlet["id"]).execute()
    # Sending stays with the outlet's own exe, and nobody can list or grant supervisors through the API.
    with pytest.raises(APIError, match="not yours"):
        sup_db.rpc("claim_next_message", {"p_outlet_id": outlet["id"]}).execute()
    with pytest.raises(APIError, match="permission denied"):
        sup_db.table("supervisors").insert({"user_id": sup.id}).execute()


def test_opt_out_survives_delete_reimport_and_direct_edits(db, outlet):
    phone, stranger = (f"62813{uuid.uuid4().int % 10**8:08d}" for _ in range(2))
    contact = {"outlet_id": outlet["id"], "phone": phone, "name": "Rina"}
    db.table("contacts").insert(contact).execute()
    db.rpc("opt_out_contact", {"p_outlet_id": outlet["id"], "p_phone": phone}).execute()
    db.rpc("opt_out_contact", {"p_outlet_id": outlet["id"], "p_phone": stranger}).execute()  # STOP before import

    with pytest.raises(APIError, match="permission denied"):
        db.table("contacts").update({"opted_out": False}).eq("phone", phone).execute()
    db.table("contacts").update({"name": "Rina S"}).eq("phone", phone).execute()  # renaming stays allowed

    db.table("contacts").delete().eq("phone", phone).execute()
    db.table("contacts").insert([contact, {**contact, "phone": stranger, "opted_out": False}]).execute()
    rows = db.table("contacts").select("phone,opted_out").in_("phone", [phone, stranger]).execute().data
    assert all(r["opted_out"] for r in rows) and len(rows) == 2
    db.table("contacts").delete().in_("phone", [phone, stranger]).execute()


def test_only_a_supervisor_can_allow_a_stopped_number_again(stack, admin, db, outlet):
    phone = f"62814{uuid.uuid4().int % 10**8:08d}"
    contact = {"outlet_id": outlet["id"], "phone": phone, "name": "Teman"}
    row = db.table("contacts").insert(contact).execute().data[0]
    db.rpc("opt_out_contact", {"p_outlet_id": outlet["id"], "p_phone": phone}).execute()

    with pytest.raises(APIError, match="supervisors only"):
        db.rpc("allow_contact_again", {"p_contact_id": row["id"]}).execute()
    _, sup_db = sign_in_supervisor(stack, admin)
    sup_db.rpc("allow_contact_again", {"p_contact_id": row["id"]}).execute()

    # Lifted for good: a delete and re-import no longer brings the STOP back.
    db.table("contacts").delete().eq("id", row["id"]).execute()
    db.table("contacts").insert(contact).execute()
    assert db.table("contacts").select("opted_out").eq("phone", phone).single().execute().data == {"opted_out": False}
    db.table("contacts").delete().eq("phone", phone).execute()


def test_session_is_refreshed_well_before_expiry(stack, outlet, tmp_path, monkeypatch):
    client = session.connect(
        stack["url"], stack["anon"], tmp_path / "s.json", credentials=lambda _e: (outlet["email"], outlet["password"])
    )
    old = client.auth.get_session()
    assert old is not None and old.expires_at is not None
    real_time = time.time
    # The PC clock reads 5 minutes before expiry: the server may already disagree, so refresh now.
    monkeypatch.setattr(time, "time", lambda: old.expires_at - 300)
    session.keep_fresh(client)
    monkeypatch.setattr(time, "time", real_time)
    new = client.auth.get_session()
    assert new is not None and new.access_token != old.access_token
    assert client.table("outlets").select("id").execute().data  # requests now carry the new token


def test_dead_saved_session_asks_to_log_in_again(stack, outlet, tmp_path):
    file = tmp_path / "s.json"
    creds = lambda _e: (outlet["email"], outlet["password"])  # noqa: E731
    session.connect(stack["url"], stack["anon"], file, credentials=creds)
    saved = json.loads(file.read_text("utf-8"))
    key, raw = next(iter(saved.items()))
    data = json.loads(raw)
    # Revoke that refresh token on the server, then put back an expired copy, as after a long power-off.
    revoker = create_client(stack["url"], stack["anon"])
    revoker.auth.set_session(data["access_token"], data["refresh_token"])
    revoker.auth.sign_out()
    data["expires_at"] = int(time.time()) - 60
    file.write_text(json.dumps({key: json.dumps(data)}), "utf-8")

    asked = []
    client = session.connect(stack["url"], stack["anon"], file, credentials=lambda e: asked.append(e) or creds(e))
    assert asked == [None]
    assert client.table("outlets").select("id").execute().data
