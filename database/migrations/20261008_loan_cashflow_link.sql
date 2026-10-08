-- Link lending money in/out to real loan repayments and loan disbursements.
-- No new tables or columns. The existing ledger and loan-fund entries remain the source data.

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
  select
    c.id,
    c.name,
    c.phone,
    coalesce((
      select sum(l.principal+l.interest)
      from public.sakhelwe_loans l
      where l.customer_id=c.id and l.status='active'
    ),0) as loan_balance,
    coalesce((
      select sum(i.total-i.paid)
      from public.sakhelwe_invoices i
      where i.customer_id=c.id and i.paid<i.total
    ),0) as sales_balance,
    coalesce((
      select sum(s.total-s.paid)
      from public.sakhelwe_chicken_sales s
      where s.customer_id=c.id and s.paid<s.total
    ),0) as chicken_sales_balance
  from public.sakhelwe_customers c
)
select case when authorized.ok then jsonb_build_object(
  'fund_added', round(fund.added,2),
  'legacy_manual_out', round(fund.legacy_out,2),
  'money_in', round(loan_in.amount,2),
  'money_out', round(loan_out.amount,2),
  'available', round(fund.added + loan_in.amount - loan_out.amount - fund.legacy_out,2),
  'outstanding_loans', round(outstanding.amount,2),
  'customers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id',id,
            'name',name,
            'phone',phone,
            'loan_balance',round(loan_balance,2),
            'sales_balance',round(sales_balance,2),
            'chicken_sales_balance',round(chicken_sales_balance,2),
            'total_balance',round(loan_balance+sales_balance+chicken_sales_balance,2),
            'status',case when loan_balance+sales_balance+chicken_sales_balance>0 then 'OWING' else 'PAID' end
          )
          order by name
        )
        from customers
      ),
      '[]'::jsonb
    )
) else '{}'::jsonb end
from authorized, fund, loan_out, loan_in, outstanding;
$$;

revoke all on function public.sakhelwe_loan_summary() from public;
revoke all on function public.sakhelwe_loan_summary() from anon;
grant execute on function public.sakhelwe_loan_summary() to authenticated;


-- All authorized staff may read the lending fund so the loan balance is visible consistently.
drop policy if exists "loan fund owner select" on public.sakhelwe_loan_fund_movements;
create policy "loan fund staff select"
on public.sakhelwe_loan_fund_movements
for select
to authenticated
using ((select sakhelwe_private.role()) is not null);
