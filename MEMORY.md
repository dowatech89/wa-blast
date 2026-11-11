# MEMORY.md — WA Blast
<!-- Hermes: keep under 2,200 chars -->

## Project
- WA blast promo (photo + text) for outlets: Sunset Grill, Dowa Labs (office), Dowa Testing (laptop tester), D'Spa, D'Bistro, DBC, Rooms, D'Bar. All Windows. Regular WA numbers.
- Plan: docs/plans/implementation_plan.md (validated 100% by plan_architect.py). Progress: TODO.md.

## Decisions (2026-10-27)
- WA engine: GOWA (go-whatsapp-web-multidevice, MIT), device via X-Device-Id.
- Free, no VPS. Dashboard (static web, plain Indonesian) = all settings. WABlast.exe (Python + GOWA, PyInstaller) per outlet PC = headless sender. They only talk via Supabase tables.
- Exe logs in as outlet account (no service-role key on PC); QR uploaded to Supabase, shown on web.
- Login by username: `sunset` = `sunset@wablast.local`. `supervisors` table: sees all outlets in dashboard, never sends.
- Online ref wnnxiprxasbiptpvwsmz. Passwords in .env.admin.local (gitignored). Mgmt token revoked 2026-11-03: owner runs new migrations in SQL Editor; verify by logging in as supervisor.
- Throttle without sleep: outlets.next_send_at + claim_next_message() with FOR UPDATE SKIP LOCKED.
- All send + risk settings live in outlets table (dashboard or Supabase); agent re-reads each tick. Guide: docs/guides/pengaturan-backend.md.

- GOWA pinned v9.8.0 (tools/gowa/gowa.exe); v9.6.0 hit "can't link new devices" while WhatsApp Web linked fine (2026-10-30).
- Built: agent/ (WABlast.exe via build.bat), web/ (Vite+React, Vercel wa-blast-dowa1).
- Telegram alerts; typing presence; promo photo/video/PDF with {salam}; Contacts filter 'Sudah Di-chat' & Excel export; Testing tab for 1-number campaign trial.
- Smart Pacing (claim_next_message): spreads messages evenly across operational hours (10-18); dynamic typing presence; safe batch test countdown; sender name via GOWA /user/pushname.
- Inbound replies tracked: record_inbound_message to inbound_messages table + contacts.last_replied_at; Inbox tab in dashboard with wa.me quick-reply.
- Push: gh active account may be monauli; switch to dowatech89 to push, then back.

## Tool quirks
- Global uv cache partly corrupt (Missing .dist-info): `uv cache clean <pkg>`.
- plan_architect.py on Windows needs PYTHONIOENCODING=utf-8.
- plan_architect domain: web_service_microservices.

## Risks
- Unofficial gateway breaks WhatsApp ToS; ban risk reduced via opt-in, throttle, warm-up, STOP. Cloud API = zero-risk.
