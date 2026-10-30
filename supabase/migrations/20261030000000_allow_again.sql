-- WA Blast: a supervisor can make a number that replied STOP receivable again, for example after a test
-- reply or when the customer asks in person. Captains cannot. Run after 20261027040000_admin.sql.
-- Messages already skipped for that number stay skipped; only promos started afterwards reach it.

create function public.allow_contact_again(p_contact_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c contacts;
begin
  if not public.is_supervisor() then
    raise exception 'supervisors only' using errcode = '42501';
  end if;
  select * into c from contacts where id = p_contact_id;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  delete from opt_outs where outlet_id = c.outlet_id and phone = c.phone;
  update contacts set opted_out = false where id = c.id;
end $$;
revoke execute on function public.allow_contact_again(uuid) from public, anon;
grant execute on function public.allow_contact_again(uuid) to authenticated;
