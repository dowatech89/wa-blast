"""The `admin` Edge Function against the local stack. Needs `npx supabase functions serve admin` running."""

import uuid

import httpx
import pytest
from supabase import create_client


def call(stack, token, **body):
    return httpx.post(
        f"{stack['url']}/functions/v1/admin",
        json=body,
        headers={"Authorization": f"Bearer {token}", "apikey": stack["anon"]},
        timeout=60,
    )


def login(stack, email, password):
    c = create_client(stack["url"], stack["anon"])
    return c, c.auth.sign_in_with_password({"email": email, "password": password}).session.access_token


@pytest.fixture(scope="module")
def supervisor(stack, admin):
    email = f"sup-{uuid.uuid4().hex[:8]}@test.local"
    user = admin.auth.admin.create_user({"email": email, "password": "test-password-123", "email_confirm": True}).user
    admin.table("supervisors").insert({"user_id": user.id}).execute()
    return login(stack, email, "test-password-123")


def test_supervisor_creates_outlet_and_resets_its_password(stack, supervisor):
    db, token = supervisor
    assert db.rpc("is_supervisor").execute().data is True
    name = f"o{uuid.uuid4().hex[:8]}"
    r = call(stack, token, action="create_outlet", name="Outlet Baru", username=name, password="awal-12345")
    assert r.status_code == 200, r.text
    listed = call(stack, token, action="list").json()
    row = next(o for o in listed["outlets"] if o["username"] == name)
    assert row["name"] == "Outlet Baru"

    captain, _ = login(stack, f"{name}@wablast.local", "awal-12345")
    assert [o["name"] for o in captain.table("outlets").select("name").execute().data] == ["Outlet Baru"]
    assert captain.rpc("is_supervisor").execute().data is False

    assert call(stack, token, action="set_password", user_id=row["user_id"], password="baru-12345").status_code == 200
    login(stack, f"{name}@wablast.local", "baru-12345")

    dup = call(stack, token, action="create_outlet", name="Lagi", username=name, password="awal-12345")
    assert dup.status_code == 400 and "sudah dipakai" in dup.json()["error"]


def test_supervisor_creates_supervisor(stack, supervisor):
    _, token = supervisor
    name = f"s{uuid.uuid4().hex[:8]}"
    assert call(stack, token, action="create_supervisor", username=name, password="awal-12345").status_code == 200
    other, _ = login(stack, f"{name}@wablast.local", "awal-12345")
    assert other.rpc("is_supervisor").execute().data is True


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"action": "create_outlet", "name": "X", "username": "AB", "password": "awal-12345"}, "Nama pengguna"),
        ({"action": "create_outlet", "name": "X", "username": "okname", "password": "pendek"}, "minimal 8"),
        ({"action": "create_outlet", "name": " ", "username": "okname", "password": "awal-12345"}, "Nama outlet"),
    ],
)
def test_invalid_input_is_rejected(stack, supervisor, body, message):
    r = call(stack, supervisor[1], **body)
    assert r.status_code == 400 and message in r.json()["error"]


def test_captains_and_strangers_are_refused(stack, admin):
    email = f"cap-{uuid.uuid4().hex[:8]}@test.local"
    admin.auth.admin.create_user({"email": email, "password": "test-password-123", "email_confirm": True})
    _, token = login(stack, email, "test-password-123")
    assert call(stack, token, action="list").status_code == 403
    assert call(stack, stack["anon"], action="list").status_code == 401
