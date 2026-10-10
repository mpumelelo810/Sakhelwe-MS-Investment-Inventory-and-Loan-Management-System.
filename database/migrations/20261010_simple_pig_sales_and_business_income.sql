-- Simple pig sale entry with typed buyer names, plus fully journaled business income.
-- Uses existing tables and the existing ledger; no tables or columns are added.
begin;
CREATE OR REPLACE FUNCTION sakhelwe_private.post(k text, p jsonb, r uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor_id uuid:=auth.uid(); staff_role text; e uuid; prior public.sakhelwe_events%rowtype;
 dt date:=(p->>'date')::date; division text:='Business'; label text; amt numeric(16,2):=0;
 qty numeric(16,3); age_weeks integer:=0; sex text:='Unknown'; pricing_qty numeric(16,3); cost numeric(16,2):=0; paid numeric(16,2):=0;
 prod public.sakhelwe_products%rowtype; batch public.sakhelwe_batches%rowtype; ln public.sakhelwe_loans%rowtype; inv public.sakhelwe_invoices%rowtype;
 customer uuid; product uuid; b uuid; needed numeric; take numeric; part numeric(16,2); ip numeric(16,2); pp numeric(16,2);
begin
 if actor_id is null then raise exception 'Please sign in.'; end if;
 select role into staff_role from public.sakhelwe_staff where user_id=actor_id;
 if staff_role is null or staff_role='analyst' then raise exception 'Your account cannot record transactions.'; end if;
 perform pg_advisory_xact_lock(7420911);
 select * into prior from public.sakhelwe_events where request_key=r;
 if found then
  if prior.actor<>actor_id or prior.kind<>k or prior.payload<>p then raise exception 'Request key has already been used for another entry.'; end if;
  return prior.id;
 end if;
 if dt is null or dt>(now() at time zone 'Africa/Mbabane')::date then raise exception 'Choose today or an earlier business date.'; end if;
 
 if length(coalesce(p->>'description',''))>500 then raise exception 'Description must be 500 characters or fewer.'; end if;
 if k in ('capital','receive','expense','loan','repay','invoice_payment','reserve','income') then
  amt:=(p->>'amount')::numeric;
  if amt is null or amt<=0 or (p->>'amount')::numeric<>amt then raise exception 'Enter a positive amount with at most two decimal places.'; end if;
 end if;
 if k in ('opening_stock','receive','sale','mortality','loss') then
  product:=nullif(trim(coalesce(p->>'product_id','')),'')::uuid;
  if product is null then select id into product from public.sakhelwe_products where division=case when p->>'division' in ('Poultry','Pigs') then p->>'division' else null end order by name limit 1; end if;
  select * into prod from public.sakhelwe_products where id=product;
  if not found then raise exception 'Choose an existing livestock product.'; end if;
  qty:=(p->>'quantity')::numeric;
  if k in ('opening_stock','receive') then
   age_weeks:=coalesce((p->>'age_weeks')::integer,0); if age_weeks<0 or age_weeks>200 then raise exception 'Age must be between 0 and 200 weeks.'; end if;
   sex:=coalesce(nullif(p->>'sex',''),'Unknown'); if sex not in ('Male','Female','Mixed','Unknown') then raise exception 'Choose Male, Female, Mixed or Unknown.'; end if;
  end if;
  if qty is null or qty<=0 or (p->>'quantity')::numeric<>qty or (prod.unit='each' and qty<>trunc(qty)) then raise exception 'Enter a valid quantity in the product stock unit.'; end if;
  division:=prod.division;
 end if;
 if k in ('loan','repay','accrue') then division:='Loans'; end if;
 if k='expense' then division:=p->>'division'; if division not in ('Poultry','Pigs','Loans','Business') then raise exception 'Choose a business section.'; end if; end if;
 if k='income' then division:='Business'; end if;
 customer:=nullif(p->>'customer_id','')::uuid;
 if k='sale' and customer is null and nullif(trim(coalesce(p->>'customer_name','')),'') is not null then
  if length(trim(p->>'customer_name'))>100 then raise exception 'Customer name must be 100 characters or fewer.'; end if;
  select id into customer from public.sakhelwe_customers where lower(name)=lower(trim(p->>'customer_name')) order by created_at limit 1;
  if customer is null then
   insert into public.sakhelwe_customers(name,phone) values(trim(p->>'customer_name'),coalesce(p->>'customer_phone','')) returning id into customer;
  end if;
  p:=p||jsonb_build_object('customer_id',customer);
 end if;
 if customer is not null and not exists(select 1 from public.sakhelwe_customers where id=customer) then raise exception 'Customer not found.'; end if;
 label:=coalesce(nullif(trim(p->>'description'),''),initcap(replace(k,'_',' ')));
 if k='product' then
  if staff_role<>'owner' then raise exception 'Only the owner can create products.'; end if;
  if length(trim(coalesce(p->>'name','')))<2 or length(p->>'name')>100 then raise exception 'Enter a product name between 2 and 100 characters.'; end if;
  insert into public.sakhelwe_products(name,unit,division,threshold) values(trim(p->>'name'),p->>'unit',p->>'division',coalesce((p->>'threshold')::numeric,5));
 elsif k='customer' then
  if length(trim(coalesce(p->>'name','')))<2 or length(p->>'name')>100 or length(coalesce(p->>'phone',''))>30 then raise exception 'Check the customer name and phone number.'; end if;
  insert into public.sakhelwe_customers(name,phone) values(trim(p->>'name'),coalesce(p->>'phone',''));
 elsif k not in ('capital','opening_stock','receive','sale','mortality','loss','expense','income','loan','repay','accrue','invoice_payment','reserve') then raise exception 'Unknown transaction type.'; end if;
 if k in ('capital','reserve') and staff_role<>'owner' then raise exception 'Only the owner can perform this action.'; end if;
 if k='sale' then
  pricing_qty:=(p->>'pricing_quantity')::numeric;
  if pricing_qty is null or pricing_qty<=0 or pricing_qty<>(p->>'pricing_quantity')::numeric or (p->>'price')::numeric<=0 then raise exception 'Enter a positive pricing quantity and unit price.'; end if;
  amt:=round(pricing_qty*(p->>'price')::numeric,2); paid:=(p->>'paid')::numeric;
  if amt<=0 or paid is null or paid<0 or paid>amt or paid<>(p->>'paid')::numeric then raise exception 'Check the sale amount and payment.'; end if;
  if paid<amt and customer is null then raise exception 'Enter the customer name for a credit sale.'; end if;
  label:=prod.name||' sale';
 end if;
 insert into public.sakhelwe_events(request_key,actor,kind,business_date,division,description,amount,payload) values(r,actor_id,k,dt,division,label,amt,p) returning id into e;
 if k='capital' then
  perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'capital',0,amt);
 elsif k in ('opening_stock','receive') then
  if k='opening_stock' then amt:=0; end if;
  insert into public.sakhelwe_batches(product_id,event_id,received_on,supplier,quantity,total_cost,remaining,remaining_cost,age_weeks,sex,mortality) values(product,e,dt,case when k='opening_stock' then 'Opening stock' else coalesce(p->>'supplier','') end,qty,amt,qty,amt,age_weeks,sex,0) returning id into b;
  insert into public.sakhelwe_stock_movements(event_id,batch_id,quantity,value) values(e,b,qty,amt);
  if amt>0 then perform sakhelwe_private.journal(e,'inventory',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt); end if;
 elsif k in ('sale','mortality','loss') then
  needed:=qty;
  for batch in select * from public.sakhelwe_batches where product_id=product and remaining>0 order by received_on,id for update loop
   take:=least(needed,batch.remaining); part:=case when take=batch.remaining then batch.remaining_cost else round(batch.remaining_cost*take/batch.remaining,2) end;
   update public.sakhelwe_batches set remaining=remaining-take,remaining_cost=remaining_cost-part,mortality=case when k='mortality' then mortality+take else mortality end where id=batch.id;
   insert into public.sakhelwe_stock_movements(event_id,batch_id,quantity,value) values(e,batch.id,-take,-part);
   cost:=cost+part; needed:=needed-take; exit when needed=0;
  end loop;
  if needed>0 then raise exception 'There is not enough stock. Receive stock first or reduce the quantity.'; end if;
  if k='sale' then
   insert into public.sakhelwe_invoices(id,customer_id,total,paid) values(e,customer,amt,paid);
   perform sakhelwe_private.journal(e,'cash',paid,0); perform sakhelwe_private.journal(e,'receivables',amt-paid,0); perform sakhelwe_private.journal(e,'revenue',0,amt); perform sakhelwe_private.journal(e,'cost_of_sales',cost,0);
  else
   if length(trim(coalesce(p->>'description','')))<3 then raise exception 'Give a reason for the mortality/loss.'; end if;
   perform sakhelwe_private.journal(e,'expenses',cost,0);
  end if;
  perform sakhelwe_private.journal(e,'inventory',0,cost);
 elsif k='expense' then
  if length(trim(coalesce(p->>'description','')))<3 then raise exception 'Describe the expense.'; end if;
  perform sakhelwe_private.journal(e,'expenses',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
 elsif k='income' then
  if length(trim(coalesce(p->>'description','')))<3 then raise exception 'Describe the income.'; end if;
  perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'revenue',0,amt);
 elsif k='reserve' then perform sakhelwe_private.journal(e,'reserve',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
 elsif k='invoice_payment' then
  select * into inv from public.sakhelwe_invoices where id=(p->>'invoice_id')::uuid for update;
  if not found or amt>inv.total-inv.paid then raise exception 'Payment exceeds the invoice balance or invoice does not exist.'; end if;
  update public.sakhelwe_invoices as i set paid=i.paid+amt where i.id=inv.id;
  perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'receivables',0,amt);
 elsif k='loan' then
  if customer is null then raise exception 'Register and select a customer first.'; end if;
  if exists(select 1 from public.sakhelwe_loans where customer_id=customer and status='active') or exists(select 1 from public.sakhelwe_invoices i where i.customer_id=customer and i.paid<i.total) then raise exception 'This customer must clear existing debt before a new loan.'; end if;
  if (p->>'due_on')::date<dt or p->>'due_on' is null then raise exception 'Due date must be on or after the loan date.'; end if;
  insert into public.sakhelwe_loans(id,customer_id,principal,interest,original_amount,annual_rate,accrued_through,due_on) values(e,customer,amt,0,amt,0.30,(p->>'due_on')::date-1,(p->>'due_on')::date);
  perform sakhelwe_private.journal(e,'principal',amt,0); perform sakhelwe_private.journal(e,'cash',0,amt);
 elsif k in ('repay','accrue') then
  select * into ln from public.sakhelwe_loans where id=(p->>'loan_id')::uuid for update;
  if not found or ln.status<>'active' then raise exception 'Choose an active loan.'; end if;
  if dt < ln.due_on then
   if k='accrue' then raise exception 'The loan is not due yet.'; end if;
  else
   declare periods integer; compound_date date; balance numeric; old_balance numeric; begin
    periods:=0; compound_date:=ln.due_on;
    while compound_date<=dt loop
     if compound_date>coalesce(ln.accrued_through,dt) then periods:=periods+1; end if;
     compound_date:=(compound_date+interval '1 month')::date;
    end loop;
    if periods>0 then
     old_balance:=ln.principal+ln.interest; balance:=round(old_balance*power(1.30,periods),2);
     ln.interest:=balance-ln.principal;
     ln.accrued_through:=(ln.due_on+make_interval(months=>periods-1))::date;
     perform sakhelwe_private.journal(e,'interest_receivable',round(balance-old_balance,2),0);
     perform sakhelwe_private.journal(e,'interest_income',0,round(balance-old_balance,2));
    end if;
   end;
  end if;
  if k='repay' then
   if amt>ln.principal+ln.interest then raise exception 'Payment exceeds the settlement balance.'; end if;
   ip:=least(amt,ln.interest); pp:=amt-ip;
   perform sakhelwe_private.journal(e,'cash',amt,0); perform sakhelwe_private.journal(e,'interest_receivable',0,ip); perform sakhelwe_private.journal(e,'principal',0,pp);
   ln.principal:=ln.principal-pp; ln.interest:=ln.interest-ip;
  end if;
  update public.sakhelwe_loans set principal=ln.principal,interest=ln.interest,accrued_through=case when dt>=ln.due_on then greatest(ln.accrued_through,dt) else ln.accrued_through end,status=case when ln.principal+ln.interest=0 then 'settled' else 'active' end where id=ln.id;
 end if;
 if (select coalesce(sum(debit-credit),0) from public.sakhelwe_journal where event_id=e)<>0 then raise exception 'Journal does not balance.'; end if;
 return e;
end $function$;
CREATE OR REPLACE FUNCTION sakhelwe_private.delete_event(p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor_id uuid:=auth.uid(); staff_role text; ev public.sakhelwe_events%rowtype; inv public.sakhelwe_invoices%rowtype; ln public.sakhelwe_loans%rowtype;
 mv record; b public.sakhelwe_batches%rowtype; original_paid numeric; payment_amount numeric;
begin
 if actor_id is null then raise exception 'Please sign in.'; end if;
 select role into staff_role from public.sakhelwe_staff where user_id=actor_id;
 if staff_role is distinct from 'owner' then raise exception 'Only the owner can delete a saved record.'; end if;
 perform pg_advisory_xact_lock(7420911);
 select * into ev from public.sakhelwe_events where id=p_event_id for update;
 if not found then raise exception 'Record not found.'; end if;
 if ev.kind in ('repay','accrue') then raise exception 'Loan repayment/interest records cannot be deleted because they change a loan history.'; end if;
 if ev.kind in ('opening_stock','receive') then
   select * into b from public.sakhelwe_batches where event_id=ev.id for update;
   if not found then raise exception 'The stock batch for this record was not found.'; end if;
   if exists(select 1 from public.sakhelwe_stock_movements where batch_id=b.id and event_id<>ev.id) then raise exception 'This stock entry has already been used by a sale, mortality or loss. Delete those later stock records first.'; end if;
   delete from public.sakhelwe_stock_movements where event_id=ev.id;
   delete from public.sakhelwe_batches where id=b.id;
 elsif ev.kind in ('sale','mortality','loss') then
   if ev.kind='sale' then
     select * into inv from public.sakhelwe_invoices where id=ev.id for update;
     if found then
       original_paid:=coalesce((ev.payload->>'paid')::numeric,0);
       if inv.paid>original_paid then raise exception 'This sale has payments recorded against it. Delete those payment records first.'; end if;
       delete from public.sakhelwe_invoices where id=ev.id;
     end if;
   end if;
   for mv in select batch_id,quantity,value from public.sakhelwe_stock_movements where event_id=ev.id loop
     update public.sakhelwe_batches set remaining=remaining-mv.quantity, remaining_cost=remaining_cost-mv.value, mortality=case when ev.kind='mortality' then greatest(0,mortality-mv.quantity) else mortality end where id=mv.batch_id;
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
   if exists(select 1 from public.sakhelwe_events x where x.id<>ev.id and x.payload->>'loan_id'=ev.id::text) then raise exception 'This loan has repayments or interest records. Delete those later records first.'; end if;
   delete from public.sakhelwe_loans where id=ev.id;
 elsif ev.kind in ('capital','expense','reserve','income') then null;
 else raise exception 'This record type cannot be deleted yet.'; end if;
 delete from public.sakhelwe_journal where event_id=ev.id;
 delete from public.sakhelwe_events where id=ev.id;
 return ev.id;
end $function$;
commit;
