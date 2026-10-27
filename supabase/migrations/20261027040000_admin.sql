-- WA Blast: lets the dashboard show the Admin menu to supervisors only.
-- Account changes themselves go through the `admin` Edge Function, which re-checks this.

create function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from supervisors where user_id = auth.uid());
$$;
revoke execute on function public.is_supervisor() from public, anon;
grant execute on function public.is_supervisor() to authenticated;
