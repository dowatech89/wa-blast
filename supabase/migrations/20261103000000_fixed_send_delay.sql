-- WA Blast: the delay between messages is fixed by the system, no longer a setting.
-- Every message waits a fresh random 30-90 s (claim_next_message picks it), so no two sends follow the same rhythm.
-- Shorter gaps raise the block risk, so neither captains nor supervisors can change it from the dashboard.
-- Run after 20261102010000_outlet_overview.sql. Changing it later is a deliberate SQL Editor edit.

update public.outlets set delay_min_sec = 30, delay_max_sec = 90;
alter table public.outlets
  alter column delay_min_sec set default 30,
  alter column delay_max_sec set default 90;
revoke update (delay_min_sec, delay_max_sec) on public.outlets from authenticated;
