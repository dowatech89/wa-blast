-- WA Blast: the promo gap now postpones instead of skipping. A customer who got promo A today waits in
-- promo B's queue and gets it once the gap has passed, so several running promos reach everyone in turn.
-- The gap counts calendar days in the outlet's timezone: 1 = not twice on the same day.
-- Run after 20261030000000_allow_again.sql. Only the frequency-cap block differs from the previous version.

create or replace function public.claim_next_message(p_outlet_id uuid)
returns table (message_id uuid, phone text, contact_name text, campaign_id uuid, message text, image_path text)
language plpgsql security definer set search_path = public as $$
declare
  o          outlets%rowtype;
  local_now  timestamp;
  sent_today int;
  gap_start  timestamptz;
  m_id       uuid;
begin
  select * into o from outlets where id = p_outlet_id and owner_user_id = auth.uid() for update;
  if not found then
    raise exception 'outlet not found or not yours' using errcode = '42501';
  end if;

  if o.next_send_at > now() then return; end if;

  local_now := now() at time zone o.timezone;
  if local_now::time < o.send_start or local_now::time >= o.send_end then return; end if;

  select count(*) into sent_today
    from messages m join campaigns c on c.id = m.campaign_id
   where c.outlet_id = o.id and m.status = 'sent'
     and m.sent_at >= (date_trunc('day', local_now) at time zone o.timezone);
  if sent_today >= public.effective_daily_limit(o) then return; end if;

  -- Frequency cap: a customer with a promo sent on or after gap_start waits; their message stays queued.
  gap_start := case when o.min_days_between_promos > 0
    then (date_trunc('day', local_now) - make_interval(days => o.min_days_between_promos - 1)) at time zone o.timezone
  end;

  select m.id into m_id
    from messages m
    join campaigns c on c.id = m.campaign_id
    join contacts ct on ct.id = m.contact_id
   where c.outlet_id = o.id and c.status = 'running'
     and m.status = 'queued' and not ct.opted_out and not ct.not_on_whatsapp
     and (gap_start is null or not exists (
           select 1 from messages prev
            where prev.contact_id = m.contact_id and prev.status = 'sent' and prev.sent_at >= gap_start))
   order by c.created_at, m.created_at
   limit 1
   for update of m skip locked;

  if m_id is null then
    -- Close the promos with nothing left; ones holding postponed customers stay running.
    update campaigns c set status = 'done'
     where c.outlet_id = o.id and c.status = 'running'
       and not exists (select 1 from messages m where m.campaign_id = c.id and m.status in ('queued', 'sending'));
    return;
  end if;

  update messages set status = 'sending', attempts = attempts + 1, updated_at = now() where id = m_id;
  update outlets
     set next_send_at = now() + make_interval(
           secs => o.delay_min_sec + floor(random() * (o.delay_max_sec - o.delay_min_sec + 1)))
   where id = o.id;

  return query
    select m.id, ct.phone, ct.name, c.id, c.message, c.image_path
      from messages m
      join campaigns c on c.id = m.campaign_id
      join contacts ct on ct.id = m.contact_id
     where m.id = m_id;
end $$;
