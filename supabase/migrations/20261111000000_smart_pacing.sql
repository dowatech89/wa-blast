-- WA Blast: Smart Pacing (Penyebaran Jadwal Pengiriman Cerdas)
-- Alih-alih menghabiskan pesan secara burst beruntun (30-90 detik), pesan disebar merata
-- sepanjang sisa jam operasional hari ini (misal 10:00 s.d 18:00) agar aktivitas kirim terlihat
-- alami seperti manusia dan meminimalkan risiko blokir anti-spam WhatsApp.
--
-- Formula jeda:
-- target_interval = sisa_detik_operasional_hari_ini / pesan_yang_perlu_disebar_hari_ini
-- dengan jitter variasi acak +/- 15%, batas minimal (floor) 45 detik, dan batas maksimal (cap) 30 menit.

create or replace function public.claim_next_message(p_outlet_id uuid)
returns table (message_id uuid, phone text, contact_name text, campaign_id uuid, message text, image_path text)
language plpgsql security definer set search_path = public as $$
declare
  o                      outlets%rowtype;
  local_now              timestamp;
  sent_today             int;
  gap_start              timestamptz;
  m_id                   uuid;
  daily_lim              int;
  remaining_quota_today  int;
  remaining_queued       int;
  messages_to_pace       int;
  seconds_left           numeric;
  target_interval        numeric;
  jitter                 numeric;
  final_delay            int;
  min_delay_floor        int := 45;   -- minimum mutlak (detik) untuk mencegah burst terlalu cepat
  max_delay_cap          int := 1800; -- batas maksimal (30 menit) agar jeda tidak berlebihan jika pesan sedikit
begin
  select * into o from outlets where id = p_outlet_id and owner_user_id = auth.uid() for update;
  if not found then
    raise exception 'outlet not found or not yours' using errcode = '42501';
  end if;

  if o.next_send_at > now() then return; end if;

  local_now := now() at time zone o.timezone;
  if local_now::time < o.send_start or local_now::time >= o.send_end then return; end if;

  daily_lim := public.effective_daily_limit(o);

  select count(*) into sent_today
    from messages m join campaigns c on c.id = m.campaign_id
   where c.outlet_id = o.id and m.status = 'sent'
     and m.sent_at >= (date_trunc('day', local_now) at time zone o.timezone);
  if sent_today >= daily_lim then return; end if;

  remaining_quota_today := greatest(0, daily_lim - sent_today);

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

  -- Hitung sisa detik hari ini sampai jendela operasional berakhir (o.send_end)
  seconds_left := extract(epoch from (o.send_end - local_now::time));

  -- Hitung total antrean pesan yang masih menunggu di promo berjalan untuk outlet ini
  select count(*) into remaining_queued
    from messages m
    join campaigns c on c.id = m.campaign_id
    join contacts ct on ct.id = m.contact_id
   where c.outlet_id = o.id and c.status = 'running'
     and m.status = 'queued' and not ct.opted_out and not ct.not_on_whatsapp
     and (gap_start is null or not exists (
           select 1 from messages prev
            where prev.contact_id = m.contact_id and prev.status = 'sent' and prev.sent_at >= gap_start));

  -- Pesan yang akan disebar adalah yang muat dalam sisa kuota hari ini (ditambah pesan yang baru saja di-claim)
  messages_to_pace := least(remaining_quota_today, remaining_queued + 1);

  if messages_to_pace > 1 and seconds_left > 0 then
    -- Hitung interval ideal agar pesan tersebar merata sepanjang sisa jam operasional
    target_interval := seconds_left / messages_to_pace;
    -- Variasi acak (jitter) +/- 15% agar ritme tidak kaku/mekanis
    jitter := (random() * 0.3 - 0.15) * target_interval;
    -- Batasi: tidak boleh lebih cepat dari min_delay_floor (atau o.delay_min_sec),
    -- dan tidak melebihi max_delay_cap (30 menit)
    final_delay := greatest(greatest(o.delay_min_sec, min_delay_floor), least(max_delay_cap, round(target_interval + jitter)::int));
  else
    -- Fallback jeda acak jika hanya 1 pesan tersisa atau mendekati akhir jam kirim
    final_delay := greatest(o.delay_min_sec, min_delay_floor) + floor(random() * (greatest(o.delay_max_sec, min_delay_floor + 30) - greatest(o.delay_min_sec, min_delay_floor) + 1))::int;
  end if;

  update outlets
     set next_send_at = now() + make_interval(secs => final_delay)
   where id = o.id;

  return query
    select m.id, ct.phone, ct.name, c.id, c.message, c.image_path
      from messages m
      join campaigns c on c.id = m.campaign_id
      join contacts ct on ct.id = m.contact_id
     where m.id = m_id;
end $$;
