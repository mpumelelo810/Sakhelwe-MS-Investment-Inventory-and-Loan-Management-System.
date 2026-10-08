-- Simple Sakhelwe seed data.
-- Keeps the selectable livestock list predictable and provides one owner-approved
-- policy for the existing loan workflow. Existing records are not deleted.
insert into public.sakhelwe_products(name,unit,division,threshold)
select 'Whole chickens','each','Poultry',10
where not exists(select 1 from public.sakhelwe_products where name='Whole chickens' and division='Poultry');

insert into public.sakhelwe_products(name,unit,division,threshold)
select 'Live pigs','each','Pigs',3
where not exists(select 1 from public.sakhelwe_products where name='Live pigs' and division='Pigs');

