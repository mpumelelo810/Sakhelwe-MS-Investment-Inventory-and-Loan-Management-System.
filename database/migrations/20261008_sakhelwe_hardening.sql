-- Sakhelwe hardening: fixed lending, connected chicken sales, and stale-feature cleanup.
-- Apply after the existing Sakhelwe tables/functions are installed.

begin;

-- Snapshot exposes only active business data.
create or replace function sakhelwe_private.snapshot()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null or sakhelwe_private.role() is null then
    raise exception 'Your account has not been granted Sakhelwe access.';
  end if;

  return jsonb_build_object(
    'role',sakhelwe_private.role(),
    'products',coalesce((select jsonb_agg(x) from public.sakhelwe_products x),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(x) from public.sakhelwe_customers x),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(x order by x.business_date desc,x.created_at desc) from public.sakhelwe_events x),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(x) from public.sakhelwe_batches x),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(x) from public.sakhelwe_invoices x),'[]'::jsonb),
    'loans',coalesce((select jsonb_agg(x) from public.sakhelwe_loans x),'[]'::jsonb),
    'journal',coalesce((select jsonb_agg(x) from public.sakhelwe_journal x),'[]'::jsonb)
  );
end;
$$;

-- Treat the obsolete transaction kind as unknown rather than exposing a legacy branch.
do $$
declare ddl text;
begin
  select pg_get_functiondef('sakhelwe_private.post(text,jsonb,uuid)'::regprocedure) into ddl;
  ddl:=replace(
    ddl,
    $$ elsif k='policy' then
  raise exception 'Loan policies are no longer used. Sakhelwe loans use a fixed 30%% monthly compound interest rule.';
$$,
    ''
  );
  execute ddl;
end;
$$;

-- A new loan starts accruing just before its due date so the due date is the first 30% compounding date.
do $
declare ddl text;
begin
  select pg_get_functiondef('sakhelwe_private.post(text,jsonb,uuid)'::regprocedure) into ddl;
  ddl:=replace(
    ddl,
    $values(e,customer,amt,0,amt,0.30,dt,(p->>'due_on')::date);$,
    $values(e,customer,amt,0,amt,0.30,(p->>'due_on')::date-1,(p->>'due_on')::date);$
  );
  execute ddl;
end;
$;

-- Owner/cashier can create chicken batches; only the owner can delete them.
drop policy if exists "owner chicken batches" on public.sakhelwe_chicken_batches;
drop policy if exists "chicken_batches_read" on public.sakhelwe_chicken_batches;
drop policy if exists "chicken_batches_insert" on public.sakhelwe_chicken_batches;
drop policy if exists "chicken_batches_update" on public.sakhelwe_chicken_batches;
drop policy if exists "chicken_batches_delete" on public.sakhelwe_chicken_batches;

create policy "chicken_batches_read"
on public.sakhelwe_chicken_batches
for select to authenticated
using ((select sakhelwe_private.role()) is not null);

create policy "chicken_batches_insert"
on public.sakhelwe_chicken_batches
for insert to authenticated
with check (
  (select sakhelwe_private.role()) in ('owner','cashier')
  and created_by=(select auth.uid())
);

create policy "chicken_batches_update"
on public.sakhelwe_chicken_batches
for update to authenticated
using ((select sakhelwe_private.role()) in ('owner','cashier'))
with check ((select sakhelwe_private.role()) in ('owner','cashier'));

create policy "chicken_batches_delete"
on public.sakhelwe_chicken_batches
for delete to authenticated
using ((select sakhelwe_private.role())='owner');

-- Chicken sales are dressed-only and are linked to invoices/receivables.
drop function if exists public.sakhelwe_record_chicken_sale(uuid,date,text,integer,numeric,numeric,numeric,uuid);

create or replace function public.sakhelwe_record_chicken_sale(
  p_batch_id uuid,
  p_sale_date date,
  p_sale_type text,
  p_quantity integer,
  p_unit_price numeric,
  p_paid numeric,
  p_customer_id uuid default null,
  p_request_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid := auth.uid();
  role_name text;
  batch public.sakhelwe_chicken_batches%rowtype;
  dressed integer;
  dressed_sales integer;
  dressed_available integer;
  sale_total numeric(16,2);
  sale_event_id uuid;
  existing_id uuid;
begin
  if actor is null then raise exception 'Please sign in.'; end if;

  select role into role_name
  from public.sakhelwe_staff
  where user_id=actor;

  if role_name is null or role_name='analyst' then
    raise exception 'Your account cannot record transactions.';
  end if;

  p_request_key:=coalesce(p_request_key,gen_random_uuid());

  select id into existing_id
  from public.sakhelwe_events
  where request_key=p_request_key;

  if existing_id is not null then return existing_id; end if;

  if p_sale_date is null
     or p_sale_date>(now() at time zone 'Africa/Mbabane')::date then
    raise exception 'Choose today or an earlier sale date.';
  end if;

  select * into batch
  from public.sakhelwe_chicken_batches
  where id=p_batch_id
  for update;

  if not found then raise exception 'Chicken batch not found.'; end if;
  if p_sale_type<>'dressed' then
    raise exception 'Only dressed chickens are sold.';
  end if;
  if p_quantity is null or p_quantity<=0 then
    raise exception 'Enter a valid quantity.';
  end if;
  if p_unit_price is null or p_unit_price<=0 then
    raise exception 'Enter a valid selling price.';
  end if;

  sale_total:=round(p_quantity*p_unit_price,2);

  if p_paid is null or p_paid<0 or p_paid>sale_total then
    raise exception 'Check the sale amount and payment.';
  end if;

  if p_paid<sale_total and p_customer_id is null then
    raise exception 'Register and select a customer for an unpaid sale.';
  end if;

  if p_customer_id is not null
     and not exists(select 1 from public.sakhelwe_customers where id=p_customer_id) then
    raise exception 'Customer not found.';
  end if;

  if batch.category<>'Opening Ready'
     and p_sale_date<(batch.received_on+42) then
    raise exception 'This chicken batch is not at the Ready Batch stage yet. Sales start at 6 weeks.';
  end if;

  select coalesce(sum(quantity),0)::integer into dressed
  from public.sakhelwe_chicken_stock_moves
  where batch_id=p_batch_id and move_type='dressed';

  select coalesce(sum(quantity),0)::integer into dressed_sales
  from public.sakhelwe_chicken_sales
  where batch_id=p_batch_id and sale_type='dressed';

  dressed_available:=dressed-dressed_sales;

  if p_quantity>dressed_available then
    raise exception 'Only % dressed chickens are available in this batch.',dressed_available;
  end if;

  insert into public.sakhelwe_events(
    request_key,actor,kind,business_date,division,description,amount,payload
  )
  values(
    p_request_key,actor,'chicken_sale',p_sale_date,'Poultry',
    batch.batch_name||' dressed chicken sale',sale_total,
    jsonb_build_object(
      'date',p_sale_date,
      'batch_id',p_batch_id,
      'quantity',p_quantity,
      'sale_type','dressed',
      'unit_price',p_unit_price,
      'paid',p_paid,
      'customer_id',p_customer_id
    )
  )
  returning id into sale_event_id;

  insert into public.sakhelwe_chicken_sales(
    id,batch_id,sale_date,sale_type,quantity,weight_kg,unit_price,total,paid,customer_id,created_by
  )
  values(
    sale_event_id,p_batch_id,p_sale_date,'dressed',p_quantity,null,
    p_unit_price,sale_total,p_paid,p_customer_id,actor
  );

  insert into public.sakhelwe_invoices(id,customer_id,total,paid)
  values(sale_event_id,p_customer_id,sale_total,p_paid);

  if p_paid>0 then
    perform sakhelwe_private.journal(sale_event_id,'cash',p_paid,0);
  end if;
  if sale_total-p_paid>0 then
    perform sakhelwe_private.journal(sale_event_id,'receivables',sale_total-p_paid,0);
  end if;

  perform sakhelwe_private.journal(sale_event_id,'revenue',0,sale_total);

  if (select coalesce(sum(j.debit-j.credit),0)
      from public.sakhelwe_journal j
      where j.event_id=sale_event_id)<>0 then
    raise exception 'Journal does not balance.';
  end if;

  return sale_event_id;
end;
$$;

revoke all on function public.sakhelwe_record_chicken_sale(uuid,date,text,integer,numeric,numeric,uuid,uuid) from public,anon;
grant execute on function public.sakhelwe_record_chicken_sale(uuid,date,text,integer,numeric,numeric,uuid,uuid) to authenticated;

-- Customer totals are sourced from loan balances and invoices, without a second chicken-debt path.
create or replace function public.sakhelwe_loan_summary()
returns jsonb
language sql
security definer
set search_path=''
stable
as $$
with authorized as (
  select exists(
    select 1 from public.sakhelwe_staff
    where user_id=(select auth.uid())
  ) as ok
),
fund as (
  select
    coalesce(sum(case when movement_type in ('opening','in') then amount else 0 end),0) as added,
    coalesce(sum(case when movement_type='out' then amount else 0 end),0) as legacy_out
  from public.sakhelwe_loan_fund_movements
),
loan_out as (
  select coalesce(sum(original_amount),0) as amount
  from public.sakhelwe_loans
),
loan_in as (
  select coalesce(sum(coalesce((payload->>'amount')::numeric,0)),0) as amount
  from public.sakhelwe_events
  where kind='repay'
),
outstanding as (
  select coalesce(sum(principal+interest) filter (where status='active'),0) as amount
  from public.sakhelwe_loans
),
customers as (
  select c.id,c.name,c.phone,
    coalesce((
      select sum(l.principal+l.interest)
      from public.sakhelwe_loans l
      where l.customer_id=c.id and l.status='active'
    ),0) as loan_balance,
    coalesce((
      select sum(i.total-i.paid)
      from public.sakhelwe_invoices i
      where i.customer_id=c.id and i.paid<i.total
    ),0) as sales_balance
  from public.sakhelwe_customers c
)
select case when authorized.ok then jsonb_build_object(
  'fund_added',round(fund.added,2),
  'legacy_manual_out',round(fund.legacy_out,2),
  'money_in',round(loan_in.amount,2),
  'money_out',round(loan_out.amount,2),
  'available',round(fund.added+loan_in.amount-loan_out.amount-fund.legacy_out,2),
  'outstanding_loans',round(outstanding.amount,2),
  'customers',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'phone',phone,
      'loan_balance',round(loan_balance,2),
      'sales_balance',round(sales_balance,2),
      'total_balance',round(loan_balance+sales_balance,2),
      'status',case when loan_balance+sales_balance>0 then 'OWING' else 'PAID' end
    ) order by name)
    from customers
  ),'[]'::jsonb)
) else '{}'::jsonb end
from authorized,fund,loan_out,loan_in,outstanding;
$$;

revoke all on function public.sakhelwe_loan_summary() from public,anon;
grant execute on function public.sakhelwe_loan_summary() to authenticated;

-- Due-date interest is compounded 30% monthly and every interest event is journaled.
create or replace function public.sakhelwe_apply_due_interest()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  l public.sakhelwe_loans%rowtype;
  compound_date date;
  old_balance numeric(16,2);
  new_balance numeric(16,2);
  delta numeric(16,2);
  event_id uuid;
  request_id uuid;
  applied integer:=0;
  total_periods integer:=0;
begin
  if (select auth.uid()) is null then raise exception 'Please sign in.'; end if;
  if not exists(select 1 from public.sakhelwe_staff where user_id=(select auth.uid())) then
    raise exception 'Not authorized.';
  end if;

  perform pg_advisory_xact_lock(7420911);

  for l in select * from public.sakhelwe_loans where status='active' for update loop
    if current_date<l.due_on then continue; end if;

    compound_date:=l.due_on;

    while compound_date<=current_date loop
      if compound_date>coalesce(l.accrued_through,l.due_on-1) then
        old_balance:=round(l.principal+l.interest,2);
        new_balance:=round(old_balance*1.30,2);
        delta:=round(new_balance-old_balance,2);
        request_id:=md5('loan-interest:'||l.id::text||':'||compound_date::text)::uuid;

        insert into public.sakhelwe_events(
          request_key,actor,kind,business_date,division,description,amount,payload
        )
        values(
          request_id,(select auth.uid()),'accrue',compound_date,'Loans',
          'Monthly loan interest',delta,
          jsonb_build_object('loan_id',l.id,'compound_date',compound_date,'rate',0.30)
        )
        on conflict(request_key) do nothing
        returning id into event_id;

        if event_id is null then
          select id into event_id from public.sakhelwe_events where request_key=request_id;
        else
          perform sakhelwe_private.journal(event_id,'interest_receivable',delta,0);
          perform sakhelwe_private.journal(event_id,'interest_income',0,delta);
        end if;

        update public.sakhelwe_loans
        set interest=new_balance-principal,
            accrued_through=compound_date
        where id=l.id;

        l.interest:=new_balance-l.principal;
        l.accrued_through:=compound_date;
        applied:=applied+1;
        total_periods:=total_periods+1;
      end if;

      compound_date:=(compound_date+interval '1 month')::date;
    end loop;
  end loop;

  return jsonb_build_object('loans_updated',applied,'periods_applied',total_periods);
end;
$$;

revoke all on function public.sakhelwe_apply_due_interest() from public,anon;
grant execute on function public.sakhelwe_apply_due_interest() to authenticated;

commit;
