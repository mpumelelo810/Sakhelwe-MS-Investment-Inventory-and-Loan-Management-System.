-- First create the owner in Supabase Authentication. Replace this sample email.
-- Run from the project SQL editor as the database administrator.
-- No passwords or secret keys belong in this file.
begin;
do $$
declare owner_id uuid;
begin
 select id into owner_id from auth.users where email = 'owner@example.com';
 if owner_id is null then raise exception 'Create the owner Auth account and replace owner@example.com first.'; end if;
 insert into public.sakhelwe_staff(user_id,role) values(owner_id,'owner');
end $$;
commit;
