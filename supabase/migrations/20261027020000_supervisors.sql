-- WA Blast: supervisor accounts see and manage every outlet from the dashboard.
-- Run after 20261027010000_risk_controls.sql. Rows are added by the admin in the SQL Editor only.
-- Sending stays owner-only: claim_next_message and mark_number_linked still check owner_user_id,
-- so a supervisor can press NYALAKAN but never acts as an outlet's WABlast.exe.

create table public.supervisors (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.supervisors enable row level security;
revoke all on public.supervisors from anon, authenticated;

create or replace function public.owns_outlet(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from outlets where id = p_outlet_id and owner_user_id = auth.uid())
      or exists (select 1 from supervisors where user_id = auth.uid());
$$;

drop policy outlets_select on public.outlets;
drop policy outlets_update on public.outlets;
create policy outlets_select on public.outlets for select to authenticated
  using (public.owns_outlet(id));
create policy outlets_update on public.outlets for update to authenticated
  using (public.owns_outlet(id)) with check (public.owns_outlet(id));

create or replace function public.today_limit(p_outlet_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select public.effective_daily_limit(o) from outlets o where o.id = p_outlet_id and public.owns_outlet(o.id);
$$;
