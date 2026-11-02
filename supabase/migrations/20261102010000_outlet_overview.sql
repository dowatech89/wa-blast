-- WA Blast: one call for the supervisor's "Semua outlet" page instead of three queries per outlet.
-- Rows follow owns_outlet(): a supervisor gets every outlet, a captain only their own.
-- Run after 20261102000000_edit_promo.sql.

create function public.outlet_overview()
returns table (outlet_id uuid, sent_today int, today_limit int, running_promos int)
language sql stable security definer set search_path = public as $$
  select o.id,
         (select count(*)::int
            from messages m join campaigns c on c.id = m.campaign_id
           where c.outlet_id = o.id and m.status = 'sent'
             and m.sent_at >= (date_trunc('day', now() at time zone o.timezone) at time zone o.timezone)),
         public.effective_daily_limit(o),
         (select count(*)::int from campaigns c where c.outlet_id = o.id and c.status = 'running')
    from outlets o
   where public.owns_outlet(o.id);
$$;
revoke execute on function public.outlet_overview() from public, anon;
grant execute on function public.outlet_overview() to authenticated;
