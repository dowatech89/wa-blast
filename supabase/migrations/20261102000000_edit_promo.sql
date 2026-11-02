-- WA Blast: a promo's title, message and photo can change only while it is a draft or paused.
-- While running, the agent may be sending it this second; once done, customers already have it.
-- Run after 20261030010000_defer_promo_gap.sql. Status changes keep going through set_campaign_status.

create function public.guard_campaign_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.title, new.message, new.image_path) is distinct from (old.title, old.message, old.image_path)
     and old.status not in ('draft', 'paused') then
    raise exception 'campaign can be edited only while draft or paused' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.guard_campaign_edit() from public, anon, authenticated;
create trigger campaigns_guard_edit before update on public.campaigns
  for each row execute function public.guard_campaign_edit();
