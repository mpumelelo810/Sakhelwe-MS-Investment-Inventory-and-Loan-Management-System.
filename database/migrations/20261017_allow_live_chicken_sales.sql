-- Allow sales from either live/undressed stock or dressed stock.
-- No table, column, policy, or accounting schema changes are required.
create or replace function public.sakhelwe_record_chicken_sale(
  p_batch_id uuid,
  p_sale_date date,
  p_sale_type text,
  p_quantity integer,
  p_unit_price numeric,
  p_paid numeric,
  p_customer_id uuid default null,
  p_request_key uuid default gen_random_uuid()
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor uuid := auth.uid();
  role_name text;
  batch public.sakhelwe_chicken_batches%rowtype;
  deaths integer;
  dressed integer;
  live_sales integer;
  dressed_sales integer;
  live_available integer;
  dressed_available integer;
  available integer;
  sale_total numeric(16,2);
  sale_event_id uuid;
  existing_id uuid;
  sale_label text;
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

  if p_sale_type not in ('live','dressed') then
    raise exception 'Choose Live / undressed or Dressed chicken.';
  end if;

  select * into batch
  from public.sakhelwe_chicken_batches
  where id=p_batch_id
  for update;

  if not found then raise exception 'Chicken batch not found.'; end if;

  if p_quantity is null or p_quantity<=0 then
    raise exception 'Enter a valid quantity.';
  end if;

  if p_unit_price is null or p_unit_price not in (80,85,90) then
    raise exception 'Chicken price must be E80 Bundle, E85 Standard or E90 Normal.';
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

  select coalesce(sum(quantity),0)::integer into deaths
  from public.sakhelwe_chicken_mortality
  where batch_id=p_batch_id;

  select coalesce(sum(quantity),0)::integer into dressed
  from public.sakhelwe_chicken_stock_moves
  where batch_id=p_batch_id and move_type='dressed';

  select coalesce(sum(quantity),0)::integer into live_sales
  from public.sakhelwe_chicken_sales
  where batch_id=p_batch_id and sale_type='live';

  select coalesce(sum(quantity),0)::integer into dressed_sales
  from public.sakhelwe_chicken_sales
  where batch_id=p_batch_id and sale_type='dressed';

  live_available:=greatest(0,batch.initial_quantity-deaths-dressed-live_sales);
  dressed_available:=greatest(0,dressed-dressed_sales);

  if p_sale_type='live' then
    available:=live_available;
    sale_label:='live/undressed';
  else
    available:=dressed_available;
    sale_label:='dressed';
  end if;

  if p_quantity>available then
    raise exception 'Only % % chickens are available in this batch.',available,sale_label;
  end if;

  insert into public.sakhelwe_events(
    request_key,actor,kind,business_date,division,description,amount,payload
  )
  values(
    p_request_key,actor,'chicken_sale',p_sale_date,'Poultry',
    batch.batch_name||' '||sale_label||' chicken sale',sale_total,
    jsonb_build_object(
      'date',p_sale_date,
      'batch_id',p_batch_id,
      'quantity',p_quantity,
      'sale_type',p_sale_type,
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
    sale_event_id,p_batch_id,p_sale_date,p_sale_type,p_quantity,null,
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
$function$;
