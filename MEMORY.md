# MEMORY.md — WA Blast
<!-- Hermes: keep under 2,200 chars -->

## Project
- WA blast promo (1 photo + text) for 6 outlets, 1 captain WA number each (regular number, swappable). Pilot 1 outlet first.
- Plan: docs/plans/implementation_plan.md (validated 100% by plan_architect.py). Progress: TODO.md.

## Decisions (2026-10-27)
- WA engine: GOWA (go-whatsapp-web-multidevice, MIT), device via X-Device-Id.
- Free, no VPS. Dashboard (static web, plain Indonesian) = all settings. WABlast.exe (Python + GOWA, PyInstaller) per outlet PC = headless sender. They only talk via Supabase tables.
- Exe logs in as outlet account (no service-role key on PC); QR uploaded to Supabase, shown on web.
- Login by username: `sunset` = `sunset@wablast.local`. `supervisors` table: sees all outlets in dashboard, never sends.
- Online project ref wnnxiprxasbiptpvwsmz (Singapore). Admin token + account passwords in .env.admin.local (gitignored).
- Throttle without sleep: outlets.next_send_at + claim_next_message() with FOR UPDATE SKIP LOCKED.
- All send + risk settings live in outlets table (dashboard or Supabase); agent re-reads each tick. Guide: docs/guides/pengaturan-backend.md.

- GOWA pinned v9.8.0 (tools/gowa/gowa.exe); v9.6.0 hit "can't link new devices" while WhatsApp Web linked fine (2026-10-30).
- Built: agent/ (Python, WABlast.exe via build.bat, autostart only with --autostart), web/ (Vite+React static, not Next). Migrations 20261027000000_init + 20261027010000_risk_controls; OCC errcode PT409 = HTTP 409. Local test stack: npx supabase@2.120.0 start.

## Tool quirks
- Fixed in .agents (2026-10-27): runner cd-group split on Windows, gate 8 python, vulture --exclude .venv. Runner now 10/10.
- Global uv cache partly corrupt (Missing .dist-info): `uv cache clean <pkg>` per broken package.
- .agents manifest: dangerous_command_patterns.json hash drift pre-dates our work; left for owner to review.
- plan_architect.py on Windows needs PYTHONIOENCODING=utf-8.
- plan_architect domain must be in .agents/references/domain_archetypes (used web_service_microservices).

## Risks
- Unofficial gateway breaks WhatsApp ToS; ban risk only reduced (opt-in, throttle, warm-up, STOP). Cloud API = zero-risk option.
