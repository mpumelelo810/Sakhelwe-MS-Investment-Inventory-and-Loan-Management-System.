-- Run once in a NEW Supabase project. Keep application secrets out of this file.
begin;
create schema if not exists sakhelwe_private;
revoke all on schema sakhelwe_private from public;
grant usage on schema sakhelwe_private to authenticated;
create table public.sakhelwe_staff (user_id uuid primary key references auth.users(id), role text not null check(role in ('owner','cashier','analyst')));
create table public.sakhelwe_products (id uuid primary key default gen_random_uuid(), name text not null unique, unit text not null check(unit in ('each','kg')), division text not null check(division in ('Poultry','Pigs')), threshold numeric(16,3) not null default 5 check(threshold>=0));
create table public.sakhelwe_customers (id uuid primary key default gen_random_uuid(), name text not null, phone text not null default '', created_at timestamptz not null default now());
create table public.sakhelwe_events (id uuid primary key default gen_random_uuid(), request_key uuid not null unique, actor uuid not null references auth.users(id), kind text not null, business_date date not null, division text not null, description text not null, amount numeric(16,2) not null default 0, payload jsonb not null, created_at timestamptz not null default now());
create table public.sakhelwe_batches (id uuid primary key default gen_random_uuid(), product_id uuid not null references public.sakhelwe_products, event_id uuid not null references public.sakhelwe_events, received_on date not null, supplier text not null default '', quantity numeric(16,3) not null check(quantity>0), total_cost numeric(16,2) not null check(total_cost>=0), remaining numeric(16,3) not null check(remaining>=0), remaining_cost numeric(16,2) not null check(remaining_cost>=0), age_weeks integer not null default 0 check(age_weeks>=0 and age_weeks<=200), sex text not null default 'Unknown' check(sex in ('Male','Female','Mixed','Unknown')), mortality numeric(16,3) not null default 0 check(mortality>=0 and mortality<=quantity));
create table public.sakhelwe_stock_movements (id bigint generated always as identity primary key, event_id uuid not null references public.sakhelwe_events, batch_id uuid not null references public.sakhelwe_batches, quantity numeric(16,3) not null, value numeric(16,2) not null);
create table public.sakhelwe_invoices (id uuid primary key references public.sakhelwe_events, customer_id uuid references public.sakhelwe_customers, total numeric(16,2) not null check(total>0), paid numeric(16,2) not null check(paid>=0 and paid<=total));
create table public.sakhelwe_policies (id uuid primary key default gen_random_uuid(), name text not null, annual_rate numeric(9,6) not null check(annual_rate>=0 and annual_rate<=1), approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now());
create table public.sakhelwe_loans (id uuid primary key references public.sakhelwe_events, customer_id uuid not null references public.sakhelwe_customers, policy_id uuid not null references public.sakhelwe_policies, principal numeric(16,2) not null check(principal>=0), interest numeric(16,2) not null default 0 check(interest>=0), original_amount numeric(16,2) not null check(original_amount>0), annual_rate numeric(9,6) not null, accrued_through date not null, due_on date not null, status text not null default 'active' check(status in ('active','settled')));
create unique index sakhelwe_one_active_loan on public.sakhelwe_loans(customer_id) where status='active';
create table public.sakhelwe_journal (id bigint generated always as identity primary key, event_id uuid not null references public.sakhelwe_events, account text not null check(account in ('cash','reserve','inventory','receivables','principal','interest_receivable','capital','revenue','cost_of_sales','expenses','interest_income')), debit numeric(16,2) not null default 0 check(debit>=0), credit numeric(16,2) not null default 0 check(credit>=0), check(debit=0 or credit=0));
create index on public.sakhelwe_events(business_date);
create index on public.sakhelwe_batches(product_id,received_on,id);
create index on public.sakhelwe_stock_movements(batch_id);
create index on public.sakhelwe_journal(event_id);
create index on public.sakhelwe_invoices(customer_id);
create index on public.sakhelwe_loans(policy_id);
create index on public.sakhelwe_batches(event_id);
create index on public.sakhelwe_stock_movements(event_id);

create function sakhelwe_private.role() returns text language sql stable security definer set search_path='' as $$ select role from public.sakhelwe_staff where user_id=(select auth.uid()) $$;
revoke all on function sakhelwe_private.role() from public;
grant execute on function sakhelwe_private.role() to authenticated;
do $$ declare t text; begin foreach t in array array['staff','products','customers','events','batches','stock_movements','invoices','policies','loans','journal'] loop
 execute format('alter table public.sakhelwe_%I enable row level security',t);
 execute format('revoke all on table public.sakhelwe_%I from anon, authenticated',t);
 execute format('grant select on table public.sakhelwe_%I to authenticated',t);
 execute format('create policy staff_read on public.sakhelwe_%I for select to authenticated using ((select sakhelwe_private.role()) is not null)',t);
end loop; end $$;
-- Direct table writes remain blocked. Owner-only transaction deletion is handled through the protected delete function below.
create function sakhelwe_private.journal(e uuid,a text,d numeric,c numeric) returns void language sql set search_path='' as $$ insert into public.sakhelwe_journal(event_id,account,debit,credit) values(e,a,d,c) $$;
revoke all on function sakhelwe_private.journal(uuid,text,numeric,numeric) from public;

create function sakhelwe_private.post(k text,p jsonb,r uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid(); staff_role text; e uuid; prior public.sakhelwe_events%rowtype;
 dt date:=(p->>'date')::date; division text:='Business'; label text; amt numeric(16,2):=0;
 qty numeric(16,3); age_weeks integer:=0; sex text:='Unknown'; pricing_qty numeric(16,3); cost numeric(16,2):=0; paid numeric(16,2):=0;
 prod public.sakhelwe_products%rowtype; batch public.sakhelwe_batches%rowtype; ln public.sakhelwe_loans%rowtype; inv public.sakhelwe_invoices%rowtype; policy public.sakhelwe_policies%rowtype;
 customer uuid; product uuid; b uuid; needed numeric; take numeric; part numeric(16,2); earn numeric(16,2); ip numeric(16,2); pp numeric(16,2); cash numeric;
begin
 if actor_id is null then raise exception 'Please sign in.'; end if;
 select role into staff_role from public.sakhelwe_staff where user_id=actor_id;
 if staff_role is null or staff_role='analyst' then raise exception 'Your account cannot record transactions.'; end if;
 -- Serialize this single-business ledger. Also guards simultaneous last-stock sales and competing loans.
 perform pg_advisory_xact_lock(7420911);
 select * into prior from public.sakhelwe_events where request_key=r;
 if found then
  if prior.actor<>actor_id or prior.kind<>k or prior.payload<>p then raise exception 'Request key has already been used for another entry.'; end if;
  return prior.id;
 end if;
 if dt is null or dt>(now() at time zone 'Africa/Mbabane')::date then raise exception 'Choose today or an earlier business date.'; end if;
 if k<>'opening_stock' and dt<coalesce((select max(business_date) from public.sakhelwe_events),dt) then raise exception 'This date is earlier than the latest saved entry. Record in date order.'; end if;
 if length(coalesce(p->>'description',''))>500 then raise exception 'Description must be 500 characters or fewer.'; end if;
 if k in ('capital','receive','expense','loan','repay','invoice_payment','reserve') then
  amt:=(p->>'amount')::numeric;
  if amt is null or amt<=0 or (p->>'amount')::numeric<>amt then raise exception 'Enter a positive amount with at most two decimal places.'; end if;
 end if;
 if k in ('opening_stock','receive','sale','mortality','loss') then
  product:=nullif(trim(coalesce(p->>'product_id','')),'')::uuid;
  if product is null then
    select id into product from public.sakhelwe_products
    where division=case when p->>'division' in ('Poultry','Pigs') then p->>'division' else null end
    order by name limit 1;
  end if;
  select * into prod from public.sakhelwe_products where id=product;
  if not found then raise exception 'Choose an existing livestock product.'; end if;
  qty:=(p->>'quantity')::numeric;
  if k in ('opening_stock','receive') then age_weeks:=coalesce((p->>'age_weeks')::integer,0); if age_weeks<0 or age_weeks>200 then raise exception 'Age must be between 0 and 200 weeks.'; end if; sex:=coalesce(nullif(p->>'sex',''),'Unknown'); if sex not in ('Male','Female','Mixed','Unknown') then raise exception 'Choose Male, Female, Mixed or Unknown.'; end if; end if;
  if qty is null or qty<=0 or (p->>'quantity')::numeric<>qty or (prod.unit='each' and qty<>trunc(qty)) then raise exception 'Enter a valid quantity in the product stock unit.'; end if;
  division:=prod.division;
 end if;
 if k in ('loan','repay','accrue') then division:='Loans'; end if;
 if k='expense' then division:=p->>'division'; if division not in ('Poultry','Pigs','Loans','Business') then raise exception 'Choose a business section.'; end if; end if;
 customer:=nullif(p->>'customer_id','')::uuid;
 if customer is not null and not exists(select 1 from public.sakhelwe_customers where id=customer) then raise exception 'Customer not found.'; end if;
 label:=coalesce(nullif(trim(p->>'description'),''),initcap(replace(k,'_',' ')));
 if k='product' then
  if staff_role<>'owner' then raise exception 'Only the owner can create products.'; end if;
  if length(trim(coalesce(p->>'name','')))<2 or length(p->>'name')>100 then raise exception 'Enter a product name between 2 and 100 characters.'; end if;
  insert into public.sakhelwe_products(name,unit,division,threshold) values(trim(p->>'name'),p->>'unit',p->>'division',coalesce((p->>'threshold')::numeric,5));
 elsif k='customer' then
  if length(trim(coalesce(p->>'name','')))<2 or length(p->>'name')>100 or length(coalesce(p->>'phone',''))>30 then raise exception 'Check the customer name and phone number.'; end if;
  insert into public.sakhelwe_customers(name,phone) values(trim(p->>'name'),coalesce(p->>'phone',''));
 elsif k='policy' then
  if staff_role<>'owner' or (p->>'approved') is distinct from 'yes' then raise exception 'The owner must explicitly approve the loan terms.'; end if;
  if length(trim(coalesce(p->>'name','')))<2 then raise exception 'Enter a policy name.'; end if;
  insert into public.sakhelwe_policies(name,annual_rate,approved_by) values(trim(p->>'name'),(p->>'annual_rate')::numeric/100,actor_id);
 elsif k not in ('capital','opening_stock','receive','sale','mortality','loss','expense','loan','repay','accrue','invoice_payment','reserve') then raise exception 'Unknown transaction type.';
 end if;
 if k in ('capital','reserve','loan','policy') and staff_role<>'owner' then raise exception 'Only the owner can perform this action.'; end if;
 if k='sale' then
  pricing_qty:=(p->>'pricing_quantity')::numeric;
  if pricing_qty is null or pricing_qty<=0 or pricing_qty<>(p->>'pricing_quantity')::numeric or (p->>'price')::numeric<=0 then raise exception 'Enter a positive pricing quantity and unit price.'; end if;
  amt:=round(pricing_qty*(p->>'price')::numeric,2);
  paid:=(p->>'paid')::numeric;
  if amt<=0 or paid is null or paid<0 or paid>amt or paid<>(p->>'paid')::numeric then raise exception 'Check the sale amount and payment.'; end if;
  if paid<amt and customer is null then raise exception 'Select a registered customer for a credit sale.'; end if;
  label:=prod.name||' sale';
 end if;
 insert into public.sakhelwe_events(request_key,actor,kind,business_date,division,description,amount,payload) values(r,actor_id,k,dt,division,label,amt,p) returning id into e;
 if k='capital' then
  perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'capital',0,amt);
 elsif k in ('opening_stock','receive') then
  if k='opening_stock' then
    amt:=0;
  end if;
  insert into public.sakhelwe_batches(product_id,event_id,received_on,supplier,quantity,total_cost,remaining,remaining_cost,age_weeks,sex,mortality)
    values(product,e,dt,case when k='opening_stock' then 'Opening stock' else coalesce(p->>'supplier','') end,qty,amt,qty,amt,age_weeks,sex,0) returning id into b;
  insert into public.sakhelwe_stock_movements(event_id,batch_id,quantity,value) values(e,b,qty,amt);
  if amt>0 then
    perform sakhelwe_private.journal(e,'inventory',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
  end if;
 elsif k in ('sale','mortality','loss') then
  needed:=qty;
  for batch in select * from public.sakhelwe_batches where product_id=product and remaining>0 order by received_on,id for update loop
   take:=least(needed,batch.remaining);
   part:=case when take=batch.remaining then batch.remaining_cost else round(batch.remaining_cost*take/batch.remaining,2) end;
   update public.sakhelwe_batches set remaining=remaining-take,remaining_cost=remaining_cost-part,mortality=case when k='mortality' then mortality+take else mortality end where id=batch.id;
   insert into public.sakhelwe_stock_movements(event_id,batch_id,quantity,value) values(e,batch.id,-take,-part);
   cost:=cost+part; needed:=needed-take; exit when needed=0;
  end loop;
  if needed>0 then raise exception 'There is not enough stock. Receive stock first or reduce the quantity.'; end if;
  if k='sale' then
   insert into public.sakhelwe_invoices(id,customer_id,total,paid) values(e,customer,amt,paid);
   perform sakhelwe_private.journal(e,'cash',paid,0); perform sakhelwe_private.journal(e,'receivables',amt-paid,0); perform sakhelwe_private.journal(e,'revenue',0,amt);
   perform sakhelwe_private.journal(e,'cost_of_sales',cost,0);
  else
   if length(trim(coalesce(p->>'description','')))<3 then raise exception 'Give a reason for the mortality/loss.'; end if;
   if k='mortality' then
     perform sakhelwe_private.journal(e,'expenses',cost,0);
   else
     perform sakhelwe_private.journal(e,'expenses',cost,0);
   end if;
  end if;
  perform sakhelwe_private.journal(e,'inventory',0,cost);
 elsif k='expense' then
  if length(trim(coalesce(p->>'description','')))<3 then raise exception 'Describe the expense.'; end if;
  perform sakhelwe_private.journal(e,'expenses',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
 elsif k='reserve' then
  perform sakhelwe_private.journal(e,'reserve',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
 elsif k='invoice_payment' then
  select * into inv from public.sakhelwe_invoices where id=(p->>'invoice_id')::uuid for update;
  if not found or amt>inv.total-inv.paid then raise exception 'Payment exceeds the invoice balance or invoice does not exist.'; end if;
  update public.sakhelwe_invoices as i set paid=i.paid+amt where i.id=inv.id;
  perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'receivables',0,amt);
 elsif k='loan' then
  if customer is null then raise exception 'Register and select a customer first.'; end if;
  if exists(select 1 from public.sakhelwe_loans where customer_id=customer and status='active') or exists(select 1 from public.sakhelwe_invoices i where i.customer_id=customer and i.paid<i.total) then raise exception 'This customer must clear existing debt before a new loan.'; end if;
  select * into policy from public.sakhelwe_policies where id=(p->>'policy_id')::uuid;
  if not found then raise exception 'Select an owner-approved loan policy.'; end if;
  if (p->>'due_on')::date<dt or p->>'due_on' is null then raise exception 'Due date must be on or after the loan date.'; end if;
  insert into public.sakhelwe_loans(id,customer_id,policy_id,principal,original_amount,annual_rate,accrued_through,due_on) values(e,customer,policy.id,amt,amt,policy.annual_rate,dt,(p->>'due_on')::date);
  perform sakhelwe_private.journal(e,'principal',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
 elsif k in ('repay','accrue') then
  select * into ln from public.sakhelwe_loans where id=(p->>'loan_id')::uuid for update;
  if not found or ln.status<>'active' or dt<ln.accrued_through then raise exception 'Choose an active loan and a date after its last posting.'; end if;
  earn:=round(ln.principal*ln.annual_rate*(dt-ln.accrued_through)/365,2);
  perform sakhelwe_private.journal(e,'interest_receivable',earn,0); perform sakhelwe_private.journal(e,'interest_income',0,earn);
  ln.interest:=ln.interest+earn;
  if k='repay' then
   if amt>ln.principal+ln.interest then raise exception 'Payment exceeds the settlement balance.'; end if;
   ip:=least(amt,ln.interest); pp:=amt-ip;
   perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'interest_receivable',0,ip); perform sakhelwe_private.journal(e,'principal',0,pp);
   ln.principal:=ln.principal-pp; ln.interest:=ln.interest-ip;
  end if;
  update public.sakhelwe_loans set principal=ln.principal,interest=ln.interest,accrued_through=dt,status=case when ln.principal+ln.interest=0 then 'settled' else 'active' end where id=ln.id;
 end if;
 select coalesce(sum(debit-credit),0) into cash from public.sakhelwe_journal where account='cash';
 if cash<0 then raise exception 'There is not enough operating cash. Record a verified capital contribution first.'; end if;
 if (select coalesce(sum(debit-credit),0) from public.sakhelwe_journal where event_id=e)<>0 then raise exception 'Journal does not balance.'; end if;
 return e;
end $$;
revoke all on function sakhelwe_private.post(text,jsonb,uuid) from public;
grant execute on function sakhelwe_private.post(text,jsonb,uuid) to authenticated;
create function public.sakhelwe_post(kind text,payload jsonb,request_key uuid) returns uuid language sql security invoker set search_path='' as $$ select sakhelwe_private.post(kind,payload,request_key) $$;
revoke all on function public.sakhelwe_post(text,jsonb,uuid) from public,anon;
grant execute on function public.sakhelwe_post(text,jsonb,uuid) to authenticated;

create function sakhelwe_private.snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or sakhelwe_private.role() is null then raise exception 'Your account has not been granted Sakhelwe access.'; end if;
 return jsonb_build_object('role',sakhelwe_private.role(),
 'products',coalesce((select jsonb_agg(x) from public.sakhelwe_products x),'[]'::jsonb),
 'customers',coalesce((select jsonb_agg(x) from public.sakhelwe_customers x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(x order by x.business_date desc,x.created_at desc) from public.sakhelwe_events x),'[]'::jsonb),
 'batches',coalesce((select jsonb_agg(x) from public.sakhelwe_batches x),'[]'::jsonb),
 'invoices',coalesce((select jsonb_agg(x) from public.sakhelwe_invoices x),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(x) from public.sakhelwe_policies x),'[]'::jsonb),
 'loans',coalesce((select jsonb_agg(x) from public.sakhelwe_loans x),'[]'::jsonb),
 'journal',coalesce((select jsonb_agg(x) from public.sakhelwe_journal x),'[]'::jsonb));
end $$;
revoke all on function sakhelwe_private.snapshot() from public;
grant execute on function sakhelwe_private.snapshot() to authenticated;
create function public.sakhelwe_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select sakhelwe_private.snapshot() $$;
revoke all on function public.sakhelwe_snapshot() from public,anon;
grant execute on function public.sakhelwe_snapshot() to authenticated;

create function sakhelwe_private.delete_event(event_id uuid) returns uuid language plpgsql security definer set search_path='' as $
declare
 actor_id uuid:=auth.uid(); staff_role text; ev public.sakhelwe_events%rowtype; inv public.sakhelwe_invoices%rowtype; ln public.sakhelwe_loans%rowtype;
 mv record; b public.sakhelwe_batches%rowtype; original_paid numeric; payment_amount numeric;
begin
 if actor_id is null then raise exception 'Please sign in.'; end if;
 select role into staff_role from public.sakhelwe_staff where user_id=actor_id;
 if staff_role is distinct from 'owner' then raise exception 'Only the owner can delete a saved record.'; end if;
 perform pg_advisory_xact_lock(7420911);
 select * into ev from public.sakhelwe_events where id=event_id for update;
 if not found then raise exception 'Record not found.'; end if;
 if ev.kind in ('repay','accrue') then raise exception 'Loan repayment/interest records cannot be deleted because they change a loan history.'; end if;
 if ev.kind in ('opening_stock','receive') then
  select * into b from public.sakhelwe_batches where event_id=ev.id for update;
  if not found then raise exception 'The stock batch for this record was not found.'; end if;
  if exists(select 1 from public.sakhelwe_stock_movements where batch_id=b.id and event_id<>ev.id) then raise exception 'This stock entry has already been used. Delete the later stock records first.'; end if;
  delete from public.sakhelwe_stock_movements where event_id=ev.id;
  delete from public.sakhelwe_batches where id=b.id;
 elsif ev.kind in ('sale','mortality','loss') then
  if ev.kind='sale' then
   select * into inv from public.sakhelwe_invoices where id=ev.id for update;
   if found then
    original_paid:=coalesce((ev.payload->>'paid')::numeric,0);
    if inv.paid>original_paid then raise exception 'This sale has later payment records. Delete those payment records first.'; end if;
    delete from public.sakhelwe_invoices where id=ev.id;
   end if;
  end if;
  for mv in select batch_id,quantity,value from public.sakhelwe_stock_movements where event_id=ev.id loop
   update public.sakhelwe_batches
   set remaining=remaining-mv.quantity,
       remaining_cost=remaining_cost-mv.value,
       mortality=case when ev.kind='mortality' then greatest(0,mortality-mv.quantity) else mortality end
   where id=mv.batch_id;
  end loop;
  delete from public.sakhelwe_stock_movements where event_id=ev.id;
 elsif ev.kind='invoice_payment' then
  payment_amount:=coalesce((ev.payload->>'amount')::numeric,0);
  select * into inv from public.sakhelwe_invoices where id=nullif(trim(coalesce(ev.payload->>'invoice_id','')), '')::uuid for update;
  if not found then raise exception 'The invoice for this payment no longer exists.'; end if;
  if payment_amount>inv.paid then raise exception 'Payment record is inconsistent with the invoice.'; end if;
  update public.sakhelwe_invoices set paid=paid-payment_amount where id=inv.id;
 elsif ev.kind='loan' then
  select * into ln from public.sakhelwe_loans where id=ev.id for update;
  if not found then raise exception 'Loan account not found.'; end if;
  if exists(select 1 from public.sakhelwe_events x where x.id<>ev.id and x.payload->>'loan_id'=ev.id::text) then raise exception 'This loan has later repayment or interest records. Delete those records first.'; end if;
  delete from public.sakhelwe_loans where id=ev.id;
 elsif ev.kind in ('capital','expense','reserve') then
  null;
 else
  raise exception 'This record type cannot be deleted yet.';
 end if;
 delete from public.sakhelwe_journal where event_id=ev.id;
 delete from public.sakhelwe_events where id=ev.id;
 return ev.id;
end $;
revoke all on function sakhelwe_private.delete_event(uuid) from public;
grant execute on function sakhelwe_private.delete_event(uuid) to authenticated;
create function public.sakhelwe_delete_event(event_id uuid, expected_user_id uuid) returns uuid language sql security invoker set search_path='' as $ select sakhelwe_private.delete_event(event_id) where (select auth.uid())=expected_user_id $;
revoke all on function public.sakhelwe_delete_event(uuid,uuid) from public,anon;
grant execute on function public.sakhelwe_delete_event(uuid,uuid) to authenticated;
commit;
