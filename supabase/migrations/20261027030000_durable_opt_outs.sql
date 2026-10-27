-- WA Blast: opt-outs outlive the contact row. Deleting and re-importing a customer who replied STOP,
-- or editing the row through the API, must never make them receivable again.
-- Run after 20261027020000_supervisors.sql. Only security definer functions (and the SQL Editor) write here.

create table public.opt_outs (
  outlet_id  uuid not null references public.outlets(id) on delete cascade,
  phone      text not null,
  created_at timestamptz not null default now(),
  primary key (outlet_id, phone)
);
alter table public.opt_outs enable row level security;
revoke all on public.opt_outs from anon, authenticated;

insert into public.opt_outs (outlet_id, phone)
  select outlet_id, phone from public.contacts where opted_out
  on conflict do nothing;

-- Captains may rename contacts; opted_out and not_on_whatsapp change only through the functions.
revoke update on public.contacts from authenticated;
grant update (name) on public.contacts to authenticated;

create function public.apply_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.opted_out := new.opted_out
    or exists (select 1 from opt_outs where outlet_id = new.outlet_id and phone = new.phone);
  return new;
end $$;
revoke execute on function public.apply_opt_out() from public, anon, authenticated;
create trigger contacts_apply_opt_out before insert on public.contacts
  for each row execute function public.apply_opt_out();

-- Same signature as before, so existing grants stay. A STOP from a number not imported yet is kept too.
create or replace function public.opt_out_contact(p_outlet_id uuid, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.owns_outlet(p_outlet_id) then
    raise exception 'outlet not yours' using errcode = '42501';
  end if;

  insert into opt_outs (outlet_id, phone) values (p_outlet_id, p_phone) on conflict do nothing;
  update contacts set opted_out = true where outlet_id = p_outlet_id and phone = p_phone;

  update messages m set status = 'skipped', error = 'opted out', updated_at = now()
    from contacts ct
   where ct.id = m.contact_id and ct.outlet_id = p_outlet_id and ct.phone = p_phone
     and m.status = 'queued';
end $$;
