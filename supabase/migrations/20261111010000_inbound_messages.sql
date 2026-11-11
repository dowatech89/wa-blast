-- WA Blast: Inbound Messages & Reply Tracking
-- Menyimpan seluruh pesan balasan masuk dari pelanggan / penerima promo ke database,
-- mencatat timestamp dan isi balasan terakhir di tabel contacts,
-- dan menyediakan endpoint fungsi untuk dashboard web.

create table if not exists public.inbound_messages (
  id           uuid primary key default gen_random_uuid(),
  outlet_id    uuid not null references public.outlets(id) on delete cascade,
  phone        text not null,
  sender_name  text,
  message      text not null,
  received_at  timestamptz not null default now()
);

create index if not exists inbound_messages_outlet_idx on public.inbound_messages (outlet_id, received_at desc);
create index if not exists inbound_messages_phone_idx on public.inbound_messages (phone);

alter table public.inbound_messages enable row level security;

create policy inbound_messages_all on public.inbound_messages
  for all to authenticated
  using (public.owns_outlet(outlet_id))
  with check (public.owns_outlet(outlet_id));

grant select, insert, delete on public.inbound_messages to authenticated;

-- Tambah kolom tracking balasan di tabel contacts
alter table public.contacts
  add column if not exists last_replied_at timestamptz,
  add column if not exists last_reply_text text;

create index if not exists contacts_replied_idx on public.contacts (outlet_id, last_replied_at desc);

-- Fungsi pencatatan pesan masuk (Security Definer agar aman dipanggil runner agent)
create or replace function public.record_inbound_message(
  p_outlet_id   uuid,
  p_phone       text,
  p_sender_name text,
  p_message     text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 1. Rekam pesan balasan ke riwayat inbound_messages
  insert into public.inbound_messages (outlet_id, phone, sender_name, message, received_at)
  values (p_outlet_id, p_phone, p_sender_name, p_message, now());

  -- 2. Update status kontak jika nomor ini terdaftar di kontak outlet
  update public.contacts
     set last_replied_at = now(),
         last_reply_text = left(p_message, 255)
   where outlet_id = p_outlet_id and phone = p_phone;
end $$;

grant execute on function public.record_inbound_message(uuid, text, text, text) to authenticated;
