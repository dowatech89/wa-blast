-- WA Blast: initial schema.
-- Run in Supabase SQL Editor. Uses gen_random_uuid(); switch to uuidv7() once the project runs Postgres 18.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.outlets (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner_user_id  uuid not null unique references auth.users(id) on delete restrict,
  gowa_device_id text not null unique,
  wa_status      text not null default 'disconnected'
                 check (wa_status in ('disconnected', 'waiting_qr', 'connected')),
  wa_number      text,
  qr_image_path  text,
  -- Sending policy: set per outlet when the row is created, editable from the dashboard.
  daily_limit    int  not null check (daily_limit > 0),
  delay_min_sec  int  not null check (delay_min_sec > 0),
  delay_max_sec  int  not null,
  send_start     time not null,
  send_end       time not null,
  timezone       text not null,
  next_send_at   timestamptz not null default now(),
  last_seen_at   timestamptz,
  version        int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (delay_max_sec >= delay_min_sec),
  check (send_end > send_start)
);

create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null references public.outlets(id) on delete cascade,
  phone      text not null check (phone ~ '^62[0-9]{8,13}$'),
  name       text,
  opted_out  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (outlet_id, phone)
);

create table public.campaigns (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null references public.outlets(id) on delete cascade,
  title      text not null,
  message    text not null,
  image_path text,
  status     text not null default 'draft'
             check (status in ('draft', 'running', 'paused', 'done')),
  version    int  not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts    int  not null default 0,
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create table public.commands (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null references public.outlets(id) on delete cascade,
  type       text not null check (type in ('relogin')),
  done_at    timestamptz,
  created_at timestamptz not null default now()
);

create index messages_queue_idx   on public.messages (campaign_id, status, created_at);
create index messages_sent_at_idx on public.messages (sent_at) where status = 'sent';
create index contacts_outlet_idx  on public.contacts (outlet_id);
create index campaigns_outlet_idx on public.campaigns (outlet_id, status);
create index commands_pending_idx on public.commands (outlet_id) where done_at is null;

-- ---------------------------------------------------------------------------
-- OCC: every update bumps version. Clients update with
--   ... where id = $1 and version = $expected
-- and treat 0 affected rows as 409 Conflict.
-- ---------------------------------------------------------------------------

create function public.bump_version() returns trigger
language plpgsql as $$
begin
  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- Outlets: only settings edits count as a new version; heartbeat, QR and schedule updates
-- from WABlast.exe must not make the captain's settings form stale.
create trigger outlets_bump_version before update on public.outlets
  for each row
  when ((old.name, old.daily_limit, old.delay_min_sec, old.delay_max_sec, old.send_start, old.send_end)
        is distinct from
        (new.name, new.daily_limit, new.delay_min_sec, new.delay_max_sec, new.send_start, new.send_end))
  execute function public.bump_version();
create trigger campaigns_bump_version before update on public.campaigns
  for each row execute function public.bump_version();

-- ---------------------------------------------------------------------------
-- Row-Level Security: a user only sees the outlet they own.
-- ---------------------------------------------------------------------------

create function public.owns_outlet(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from outlets where id = p_outlet_id and owner_user_id = auth.uid());
$$;

alter table public.outlets   enable row level security;
alter table public.contacts  enable row level security;
alter table public.campaigns enable row level security;
alter table public.messages  enable row level security;
alter table public.commands  enable row level security;

revoke all on public.outlets, public.contacts, public.campaigns, public.messages, public.commands from anon;

create policy outlets_select on public.outlets for select to authenticated
  using (owner_user_id = auth.uid());
create policy outlets_update on public.outlets for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
-- Captains may edit settings and WA state, never ownership, device id or the send schedule.
revoke update on public.outlets from authenticated;
grant update (name, wa_status, wa_number, qr_image_path, daily_limit, delay_min_sec,
              delay_max_sec, send_start, send_end, last_seen_at)
  on public.outlets to authenticated;

create policy contacts_all on public.contacts for all to authenticated
  using (public.owns_outlet(outlet_id)) with check (public.owns_outlet(outlet_id));

create policy campaigns_all on public.campaigns for all to authenticated
  using (public.owns_outlet(outlet_id)) with check (public.owns_outlet(outlet_id));
-- Status changes go through set_campaign_status() so the queue stays consistent.
revoke update on public.campaigns from authenticated;
grant update (title, message, image_path) on public.campaigns to authenticated;

-- Messages are written only by the functions below.
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and public.owns_outlet(c.outlet_id)));
revoke insert, update, delete on public.messages from authenticated;

create policy commands_all on public.commands for all to authenticated
  using (public.owns_outlet(outlet_id)) with check (public.owns_outlet(outlet_id));

-- Progress per campaign for the dashboard. security_invoker keeps the messages RLS in force.
create view public.campaign_progress with (security_invoker = true) as
select campaign_id,
       count(*)                                  as total,
       count(*) filter (where status = 'sent')    as sent,
       count(*) filter (where status = 'failed')  as failed,
       count(*) filter (where status = 'skipped') as skipped,
       count(*) filter (where status in ('queued', 'sending')) as waiting
  from public.messages
 group by campaign_id;

revoke all on public.campaign_progress from anon;
grant select on public.campaign_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Campaign control (dashboard)
-- ---------------------------------------------------------------------------

-- Start / pause / resume a campaign with an OCC check.
-- Starting queues every contact of the outlet that has not opted out.
create function public.set_campaign_status(p_campaign_id uuid, p_status text, p_expected_version int)
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
     where ct.outlet_id = c.outlet_id and not ct.opted_out
    on conflict (campaign_id, contact_id) do nothing;
  end if;

  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Sending queue (WABlast.exe)
-- ---------------------------------------------------------------------------

-- Returns the next due message for the caller's outlet, or no row when nothing may be sent now
-- (outside send hours, daily limit reached, delay not elapsed, queue empty).
-- Schedules the next allowed send time with a random delay. Durable: state lives in the DB.
create function public.claim_next_message(p_outlet_id uuid)
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
  if sent_today >= o.daily_limit then return; end if;

  select m.id into m_id
    from messages m
    join campaigns c on c.id = m.campaign_id
    join contacts ct on ct.id = m.contact_id
   where c.outlet_id = o.id and c.status = 'running'
     and m.status = 'queued' and not ct.opted_out
   order by c.created_at, m.created_at
   limit 1
   for update of m skip locked;
  if m_id is null then return; end if;

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

-- Record the send result. Marks the campaign done when nothing is left to send.
create function public.complete_message(p_message_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
begin
  update messages m
     set status  = case when p_ok then 'sent' else 'failed' end,
         sent_at = case when p_ok then now() end,
         error   = case when p_ok then null else p_error end,
         updated_at = now()
    from campaigns c
   where m.id = p_message_id and c.id = m.campaign_id
     and m.status = 'sending' and public.owns_outlet(c.outlet_id)
  returning m.campaign_id into v_campaign_id;

  if v_campaign_id is null then
    raise exception 'message % is not in sending state or not yours', p_message_id using errcode = 'PT409';
  end if;

  update campaigns set status = 'done'
   where id = v_campaign_id and status = 'running'
     and not exists (select 1 from messages
                      where campaign_id = v_campaign_id and status in ('queued', 'sending'));
end $$;

-- Called once when WABlast.exe starts. A message left in 'sending' means the PC died mid-send;
-- we cannot know whether WhatsApp delivered it, so mark it failed instead of risking a duplicate.
create function public.fail_stuck_messages(p_outlet_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.owns_outlet(p_outlet_id) then
    raise exception 'outlet not yours' using errcode = '42501';
  end if;

  update messages m set status = 'failed', error = 'terputus saat mengirim (PC mati/restart)', updated_at = now()
    from campaigns c
   where c.id = m.campaign_id and c.outlet_id = p_outlet_id and m.status = 'sending';
  get diagnostics n = row_count;

  update campaigns c set status = 'done'
   where c.outlet_id = p_outlet_id and c.status = 'running'
     and not exists (select 1 from messages m where m.campaign_id = c.id and m.status in ('queued', 'sending'));

  return n;
end $$;

-- Contact replied STOP: opt out and skip everything still queued for them.
create function public.opt_out_contact(p_outlet_id uuid, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.owns_outlet(p_outlet_id) then
    raise exception 'outlet not yours' using errcode = '42501';
  end if;

  update contacts set opted_out = true where outlet_id = p_outlet_id and phone = p_phone;

  update messages m set status = 'skipped', error = 'opted out', updated_at = now()
    from contacts ct
   where ct.id = m.contact_id and ct.outlet_id = p_outlet_id and ct.phone = p_phone
     and m.status = 'queued';
end $$;

revoke execute on function public.set_campaign_status(uuid, text, int),
                           public.claim_next_message(uuid),
                           public.complete_message(uuid, boolean, text),
                           public.opt_out_contact(uuid, text),
                           public.fail_stuck_messages(uuid),
                           public.owns_outlet(uuid)
  from public, anon;
grant execute on function public.set_campaign_status(uuid, text, int),
                          public.claim_next_message(uuid),
                          public.complete_message(uuid, boolean, text),
                          public.opt_out_contact(uuid, text),
                          public.fail_stuck_messages(uuid),
                          public.owns_outlet(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private buckets, files stored under "<outlet_id>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values
  ('campaign-images', 'campaign-images', false),
  ('qr-codes', 'qr-codes', false);

create policy outlet_files_rw on storage.objects for all to authenticated
  using (bucket_id in ('campaign-images', 'qr-codes')
         and public.owns_outlet(((storage.foldername(name))[1])::uuid))
  with check (bucket_id in ('campaign-images', 'qr-codes')
              and public.owns_outlet(((storage.foldername(name))[1])::uuid));
