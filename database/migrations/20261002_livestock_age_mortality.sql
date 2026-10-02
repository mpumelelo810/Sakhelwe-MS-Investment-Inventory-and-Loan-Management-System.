-- Add livestock age and mortality tracking to existing Sakhelwe installations.
begin;
alter table public.sakhelwe_batches add column if not exists age_weeks integer not null default 0;
alter table public.sakhelwe_batches add column if not exists mortality numeric(16,3) not null default 0;
alter table public.sakhelwe_batches add constraint sakhelwe_batches_age_weeks_check check(age_weeks>=0 and age_weeks<=200);
alter table public.sakhelwe_batches add constraint sakhelwe_batches_mortality_check check(mortality>=0 and mortality<=quantity);
commit;
