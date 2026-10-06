-- Simple Sakhelwe seed data.
-- Keeps the selectable livestock list predictable and provides one owner-approved
-- policy for the existing loan workflow. Existing records are not deleted.
insert into public.sakhelwe_products(name,unit,division,threshold)
select 'Whole chickens','each','Poultry',10
where not exists(select 1 from public.sakhelwe_products where name='Whole chickens' and division='Poultry');

insert into public.sakhelwe_products(name,unit,division,threshold)
select 'Live pigs','each','Pigs',3
where not exists(select 1 from public.sakhelwe_products where name='Live pigs' and division='Pigs');

insert into public.sakhelwe_policies(name,annual_rate,approved_by)
select 'Standard loan',0.10,user_id
from public.sakhelwe_staff
where role='owner'
  and not exists(select 1 from public.sakhelwe_policies where name='Standard loan')
order by user_id
limit 1;
