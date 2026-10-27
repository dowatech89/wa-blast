"""Fixtures shared by the tests that run against the local Supabase stack (`npx supabase start`)."""

import subprocess
from pathlib import Path

import pytest
from supabase import create_client

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def stack():
    out = subprocess.run(  # noqa: S603, S607
        "npx -y supabase@2.120.0 status -o env",
        cwd=REPO,
        shell=True,  # noqa: S602
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    env = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    env = {k: v.strip().strip('"') for k, v in env.items()}
    return {"url": env["API_URL"], "anon": env["ANON_KEY"], "service": env["SERVICE_ROLE_KEY"]}


@pytest.fixture(scope="module")
def admin(stack):
    return create_client(stack["url"], stack["service"])
