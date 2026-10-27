-- WA Blast: block-risk controls. Every knob is a column on outlets, editable from the dashboard
-- or directly in the Supabase table editor. Defaults below apply to new and existing outlets.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

alter table public.outlets
  -- 1. Ask WhatsApp whether a number exists before sending; unknown numbers are skipped for good.
  add column check_number_first      boolean not null default true,
  -- 2. Pause every running promo after this many failed sends in a row (0 = never).
  add column pause_after_failures    int     not null default 3 check (pause_after_failures >= 0),
  -- 3. A customer receives at most one promo per this many days (0 = no limit).
  add column min_days_between_promos int     not null default 3 check (min_days_between_promos >= 0),
  -- 4. Line appended to every promo so customers reply STOP instead of reporting spam ('' = none).
  add column optout_footer           text    not null default 'Balas STOP kalau tidak mau menerima promo lagi.',
  add column stop_keywords           text[]  not null default '{STOP,BERHENTI,UNSUBSCRIBE}',
  -- 5. Warm-up: a newly connected number starts low and rises by a fixed step per day up to daily_limit.
  add column warmup_enabled          boolean not null default true,
  add column warmup_start_limit      int     not null default 10 check (warmup_start_limit > 0),
  add column warmup_daily_increase   int     not null default 5 check (warmup_daily_increase >= 0),
  -- State written by the system, read by the dashboard.
  add column wa_connected_since      date,
  add column consecutive_failures    int     not null default 0,
  add column pause_reason            text;

alter table public.contacts add column not_on_whatsapp boolean not null default false;

create index messages_contact_sent_idx on public.messages (contact_id, sent_at) where status = 'sent';

-- Settings edits bump the outlet version; system state (heartbeat, counters, alerts) does not.
drop trigger outlets_bump_version on public.outlets;
create trigger outlets_bump_version before update on public.outlets
  for each row
  when ((old.name, old.daily_limit, old.delay_min_sec, old.delay_max_sec, old.send_start, old.send_end,
         old.check_number_first, old.pause_after_failures, old.min_days_between_promos, old.optout_footer,
         old.stop_keywords, old.warmup_enabled, old.warmup_start_limit, old.warmup_daily_increase)
        is distinct from
        (new.name, new.daily_limit, new.delay_min_sec, new.delay_max_sec, new.send_start, new.send_end,
         new.check_number_first, new.pause_after_failures, new.min_days_between_promos, new.optout_footer,
         new.stop_keywords, new.warmup_enabled, new.warmup_start_limit, new.warmup_daily_increase))
  execute function public.bump_version();

grant update (check_number_first, pause_after_failures, min_days_between_promos, optout_footer, stop_keywords,
              warmup_enabled, warmup_start_limit, warmup_daily_increase, pause_reason)
  on public.outlets to authenticated;

-- ---------------------------------------------------------------------------
-- Warm-up: today's effective daily limit
-- ---------------------------------------------------------------------------

create function public.effective_daily_limit(o public.outlets)
returns int
language sql stable as $$
  select case
    when not o.warmup_enabled or o.wa_connected_since is null then o.daily_limit
    else least(o.daily_limit,
               o.warmup_start_limit
               + o.warmup_daily_increase * greatest(0, (now() at time zone o.timezone)::date - o.wa_connected_since))
  end;
$$;

-- WABlast.exe calls this when a different number is linked: warm-up restarts on the outlet's local date.
-- The date is computed here because the outlet's timezone lives in the DB (Windows has no IANA tz data).
create function public.mark_number_linked(p_outlet_id uuid)
returns date
language sql security definer set search_path = public as $$
  update outlets set wa_connected_since = (now() at time zone timezone)::date
   where id = p_outlet_id and owner_user_id = auth.uid()
  returning wa_connected_since;
$$;

-- Dashboard helper: today's limit for the caller's outlet.
create function public.today_limit(p_outlet_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select public.effective_daily_limit(o) from outlets o where o.id = p_outlet_id and o.owner_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Auto-pause
-- ---------------------------------------------------------------------------

-- Pause every running promo of the outlet and leave a message for the dashboard.
create function public.auto_pause(p_outlet_id uuid, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.owns_outlet(p_outlet_id) then
    raise exception 'outlet not yours' using errcode = '42501';
  end if;
  update campaigns set status = 'paused' where outlet_id = p_outlet_id and status = 'running';
  get diagnostics n = row_count;
  if n > 0 then
    update outlets set pause_reason = p_reason where id = p_outlet_id;
  end if;
  return n;
end $$;

-- Starting a promo again acknowledges the alert and resets the failure streak.
create or replace function public.set_campaign_status(p_campaign_id uuid, p_status text, p_expected_version int)
returns public.campaigns
language plpgsql security definer set search_path = public as $$
declare
  c campaigns%rowtype;
begin
  if p_status not in ('running', 'paused') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  update campaigns set status = p_status
   where id = p_campaign_id and version = p_expected_version
     and public.owns_outlet(outlet_id) and status <> 'done'
  returning * into c;

  if not found then
    raise exception 'OCC_CONFLICT' using errcode = 'PT409',
      hint = 'Campaign changed elsewhere, is done, or not yours. Reload and retry.';
  end if;

  if p_status = 'running' then
    insert into messages (campaign_id, contact_id)
    select c.id, ct.id from contacts ct
     where ct.outlet_id = c.outlet_id and not ct.opted_out and not ct.not_on_whatsapp
    on conflict (campaign_id, contact_id) do nothing;
    update outlets set pause_reason = null, consecutive_failures = 0 where id = c.outlet_id;
  end if;

  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Sending queue
-- ---------------------------------------------------------------------------

create or replace function public.claim_next_message(p_outlet_id uuid)
returns table (message_id uuid, phone text, contact_name text, campaign_id uuid, message text, image_path text)
language plpgsql security definer set search_path = public as $$
declare
  o          outlets%rowtype;
  local_now  timestamp;
  sent_today int;
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

  -- Frequency cap: skip customers who already got a promo from this outlet recently.
  if o.min_days_between_promos > 0 then
    update messages m
       set status = 'skipped', error = 'sudah menerima promo dalam ' || o.min_days_between_promos || ' hari terakhir',
           updated_at = now()
      from campaigns c
     where c.id = m.campaign_id and c.outlet_id = o.id and c.status = 'running' and m.status = 'queued'
       and exists (select 1 from messages prev
                    where prev.contact_id = m.contact_id and prev.status = 'sent'
                      and prev.sent_at > now() - make_interval(days => o.min_days_between_promos));
  end if;

  select m.id into m_id
    from messages m
    join campaigns c on c.id = m.campaign_id
    join contacts ct on ct.id = m.contact_id
   where c.outlet_id = o.id and c.status = 'running'
     and m.status = 'queued' and not ct.opted_out and not ct.not_on_whatsapp
   order by c.created_at, m.created_at
   limit 1
   for update of m skip locked;

  if m_id is null then
    -- Everything left was skipped above: close the promos that have nothing to send.
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

-- Record the send result.
--   sent        delivered to WhatsApp, resets the failure streak
--   failed      send error, counts toward pause_after_failures
--   not_on_wa   number has no WhatsApp: message skipped, contact never queued again, not a failure
create function public.finish_message(p_message_id uuid, p_result text, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_contact_id  uuid;
  v_outlet      outlets%rowtype;
begin
  if p_result not in ('sent', 'failed', 'not_on_wa') then
    raise exception 'invalid result %', p_result using errcode = '22023';
  end if;

  update messages m
     set status  = case p_result when 'sent' then 'sent' when 'failed' then 'failed' else 'skipped' end,
         sent_at = case when p_result = 'sent' then now() end,
         error   = case p_result when 'sent' then null when 'failed' then p_error
                                 else 'nomor tidak terdaftar di WhatsApp' end,
         updated_at = now()
    from campaigns c
   where m.id = p_message_id and c.id = m.campaign_id
     and m.status = 'sending' and public.owns_outlet(c.outlet_id)
  returning m.campaign_id, m.contact_id into v_campaign_id, v_contact_id;

  if v_campaign_id is null then
    raise exception 'message % is not in sending state or not yours', p_message_id using errcode = 'PT409';
  end if;

  select o.* into v_outlet from outlets o join campaigns c on c.outlet_id = o.id where c.id = v_campaign_id;

  if p_result = 'not_on_wa' then
    update contacts set not_on_whatsapp = true where id = v_contact_id;
  elsif p_result = 'sent' then
    update outlets set consecutive_failures = 0 where id = v_outlet.id;
  else
    update outlets set consecutive_failures = consecutive_failures + 1 where id = v_outlet.id
    returning * into v_outlet;
    if v_outlet.pause_after_failures > 0 and v_outlet.consecutive_failures >= v_outlet.pause_after_failures then
      perform public.auto_pause(v_outlet.id,
        'Pengiriman dihentikan otomatis: ' || v_outlet.consecutive_failures
        || ' pesan gagal berturut-turut. Cek WhatsApp di HP captain, lalu nyalakan lagi promonya.');
    end if;
  end if;

  update campaigns set status = 'done'
   where id = v_campaign_id and status = 'running'
     and not exists (select 1 from messages
                      where campaign_id = v_campaign_id and status in ('queued', 'sending'));
end $$;

drop function public.complete_message(uuid, boolean, text);

revoke execute on function public.effective_daily_limit(public.outlets), public.today_limit(uuid),
                           public.auto_pause(uuid, text), public.finish_message(uuid, text, text),
                           public.mark_number_linked(uuid)
  from public, anon;
grant execute on function public.effective_daily_limit(public.outlets), public.today_limit(uuid),
                          public.auto_pause(uuid, text), public.finish_message(uuid, text, text),
                          public.mark_number_linked(uuid)
  to authenticated;
