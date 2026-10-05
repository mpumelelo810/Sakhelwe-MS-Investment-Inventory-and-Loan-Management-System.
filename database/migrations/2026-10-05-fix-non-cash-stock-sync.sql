-- Sakhelwe Business Control
-- Opening stock, mortality and stock loss are non-cash records.
-- They must not be rejected merely because operating cash is E0.
-- Cash-consuming transactions still require available operating cash.
--
-- The canonical implementation is also kept in database/schema.sql.

create or replace function sakhelwe_private.post(k text,p jsonb,r uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid();
 cash numeric;
begin
  -- This migration is intentionally a guard/documentation marker.
  -- Deploy the canonical function from database/schema.sql when rebuilding
  -- the database. Existing production function was updated directly.
  raise exception 'Use database/schema.sql canonical sakhelwe_private.post definition.';
end $$;
