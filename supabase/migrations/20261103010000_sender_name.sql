-- WA Blast: the WhatsApp profile name people see as "~Name" when they have not saved the outlet's number.
-- sender_name: what the dashboard asks for; empty = use the outlet name.
-- sender_name_applied: what the agent last set through GOWA (POST /user/pushname); it re-applies only on change.
-- Run after 20261103000000_fixed_send_delay.sql.

alter table public.outlets
  add column sender_name text check (sender_name is null or char_length(btrim(sender_name)) between 1 and 25),
  add column sender_name_applied text;
grant update (sender_name, sender_name_applied) on public.outlets to authenticated;
