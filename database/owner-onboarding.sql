-- The owner email is fixed by the business owner. User-editable metadata is never trusted.
create function sakhelwe_private.activate_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if lower(new.email)='sakhelweinvestment@gmail.com' and new.email_confirmed_at is not null then
  perform pg_catalog.pg_advisory_xact_lock(7420912);
  if not exists(select 1 from public.sakhelwe_staff where role='owner') then
   insert into public.sakhelwe_staff(user_id,role) values(new.id,'owner') on conflict(user_id) do nothing;
  end if;
 end if;
 return new;
end $$;
revoke all on function sakhelwe_private.activate_owner() from public,anon,authenticated;
create trigger sakhelwe_activate_verified_owner after insert or update of email_confirmed_at on auth.users for each row execute function sakhelwe_private.activate_owner();
