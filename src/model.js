export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Mbabane',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money=n=>`E ${Number(n||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export const ageWeeks=(b,date=today())=>Math.max(0,Number(b.age_weeks||0)+Math.floor(days(b.received_on,date)/7));
export const ageCategory=(division,weeks)=>{const w=Number(weeks||0);return division==='Poultry'?(w<=6?'Chicks (0–6 weeks)':w<=18?'Growers (7–18 weeks)':'Adults (19+ weeks)'):(w<=8?'Piglets (0–8 weeks)':w<=20?'Growers (9–20 weeks)':'Adults (21+ weeks)');};
export const days=(a,b)=>Math.max(0,Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000));
export const compoundPeriods=(dueOn,date=today())=>{
 if(!dueOn||date<dueOn)return 0;
 let n=0,d=dueOn;
 while(d<=date){n++;const next=new Date(d+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);d=next.toISOString().slice(0,10);}
 return n;
};
export const compoundBalance=(principal,periods)=>round(Number(principal)*Math.pow(1.30,Math.max(0,Number(periods||0))));
export const interest=(l,date=today())=>{
 const principal=Number(l.principal||0),existing=Number(l.interest||0);
 const totalPeriods=compoundPeriods(l.due_on,date);
 const appliedPeriods=l.accrued_through&&l.accrued_through>=l.due_on?compoundPeriods(l.due_on,l.accrued_through):0;
 const periods=Math.max(0,totalPeriods-appliedPeriods);
 return round((principal+existing)*Math.pow(1.30,periods)-(principal+existing));
};
export const empty=()=>({role:'owner',products:[],customers:[],batches:[],events:[],invoices:[],loans:[],journal:[]});
export const account=(s,a,ids)=>s.journal.filter(j=>j.account===a&&(!ids||ids.has(j.event_id))).reduce((n,j)=>n+Number(j.debit)-Number(j.credit),0);
export function totals(s,month,division='All sections'){
 const es=s.events.filter(e=>e.business_date.startsWith(month)&&(division==='All sections'||e.division===division));const ids=new Set(es.map(e=>e.id));
 const revenue=-account(s,'revenue',ids),earned=-account(s,'interest_income',ids),cost=account(s,'cost_of_sales',ids),expenses=account(s,'expenses',ids);
 return{revenue,earned,cost,expenses,profit:revenue+earned-cost-expenses,cash:account(s,'cash'),reserve:account(s,'reserve'),debt:account(s,'receivables')+account(s,'principal')+account(s,'interest_receivable'),inventory:account(s,'inventory'),events:es};
}
export function demo(){
 const s=empty(),dt=today();s.products=[{id:'chicken',name:'Whole chickens',unit:'each',division:'Poultry',threshold:10},{id:'pig',name:'Live pigs',unit:'each',division:'Pigs',threshold:3}];
 s.customers=[{id:'c1',name:'Sample customer A',phone:''},{id:'c2',name:'Sample customer B',phone:''}];
 demoPost(s,'capital',{date:dt,amount:'15000',description:'Sample opening capital'},'d1');
 demoPost(s,'receive',{date:dt,amount:'6000',quantity:'100',product_id:'chicken',supplier:'Example supplier'},'d2');
 demoPost(s,'receive',{date:dt,amount:'4800',quantity:'4',product_id:'pig',supplier:'Example supplier'},'d3');
 demoPost(s,'sale',{date:dt,quantity:'28',pricing_quantity:'28',price:'95',paid:'2660',product_id:'chicken'},'d4');
 demoPost(s,'sale',{date:dt,quantity:'1',pricing_quantity:'1',price:'1800',paid:'1000',customer_id:'c1',product_id:'pig'},'d5');
 demoPost(s,'expense',{date:dt,amount:'350',division:'Poultry',description:'Sample feed and transport'},'d6');return s;
}
export function demoPost(s,k,p,key){
 if(s.role==='analyst')throw Error('This account is read-only.');
 const previous=s.events.find(e=>e.request_key===key);
 if(previous){if(previous.kind!==k||JSON.stringify(previous.payload)!==JSON.stringify(p))throw Error('Request key already used.');return previous.id;}
 const dt=p.date;
 if(!dt||dt>today())throw Error('Choose today or an earlier date.');
 if(s.events.some(e=>e.business_date>dt))throw Error('Record entries in date order.');
 const e={id:crypto.randomUUID(),request_key:key,kind:k,business_date:dt,division:'Business',description:p.description||k.replaceAll('_',' '),amount:Number(p.amount||0),payload:p,created_at:new Date().toISOString()};
 const journal=(a,d=0,cr=0)=>s.journal.push({event_id:e.id,account:a,debit:round(d),credit:round(cr)});
 const prod=s.products.find(x=>x.id===p.product_id);
 const q=Number(p.quantity);
 if(['capital','receive','expense','loan','repay','invoice_payment','reserve'].includes(k)&&(!(Number(p.amount)>0)||round(Number(p.amount))!==Number(p.amount)))throw Error('Enter a positive amount with at most two decimal places.');
 if(['opening_stock','receive','sale','mortality'].includes(k)){
   if(!prod||!(q>0)||(prod.unit==='each'&&!Number.isInteger(q)))throw Error('Check the product and stock quantity.');
   e.division=prod.division;
 }
 if(['capital','reserve','loan','product','opening_stock'].includes(k)&&s.role!=='owner')throw Error('Only the owner can perform this action.');

 if(k==='product'){
   if(s.products.some(x=>x.name===p.name))throw Error('A product with this name already exists.');
   s.products.push({id:crypto.randomUUID(),name:p.name,unit:p.unit,division:p.division,threshold:Number(p.threshold)});
 } else if(k==='customer'){
   s.customers.push({id:crypto.randomUUID(),name:p.name,phone:p.phone});
  } else if(k==='capital'){
   journal('cash',Number(p.amount)); journal('capital',0,Number(p.amount));
 } else if(k==='opening_stock'||k==='receive'){
   const age=Number(p.age_weeks||0);
   const sex=String(p.sex||'Unknown');
   if(age<0||age>200||!Number.isInteger(age))throw Error('Age must be between 0 and 200 weeks.');
   if(!['Male','Female','Mixed','Unknown'].includes(sex))throw Error('Choose Male, Female, Mixed or Unknown.');
   const cost=k==='receive'?Number(p.amount):0;
   s.batches.push({id:crypto.randomUUID(),event_id:e.id,product_id:prod.id,received_on:dt,supplier:k==='receive'?(p.supplier||''): 'Opening stock',quantity:q,total_cost:cost,remaining:q,remaining_cost:cost,age_weeks:age,sex,mortality:0});
   if(cost>0){journal('inventory',cost);journal('cash',0,cost)}else journal('inventory',0,0);
   e.amount=cost;
   e.description=k==='opening_stock'?prod.name+' opening stock':prod.name+' stock received';
 } else if(k==='sale'||k==='mortality'){
   let need=q,cost=0;
   const batches=s.batches.filter(b=>b.product_id===prod.id&&b.remaining>0).sort((a,b)=>a.received_on.localeCompare(b.received_on)||a.id.localeCompare(b.id));
   if(batches.reduce((n,b)=>n+Number(b.remaining),0)<q)throw Error('There is not enough stock.');
   for(const b of batches){
     const take=Math.min(need,b.remaining);
     const cc=take===b.remaining?b.remaining_cost:round(b.remaining_cost*take/b.remaining);
     b.remaining-=take;b.remaining_cost=round(b.remaining_cost-cc);
     if(k==='mortality')b.mortality=Number(b.mortality||0)+take;
     cost+=cc;need-=take;if(need===0)break;
   }
   journal('inventory',0,cost);
   if(k==='sale'){
     const pricingQty=Number(p.pricing_quantity);
     const price=Number(p.price);
     const amount=round(pricingQty*price);
     const paid=Number(p.paid);
     if(!(pricingQty>0)||!(price>0)||!(amount>0)||paid<0||paid>amount||(!p.customer_id&&paid<amount))throw Error('Check pricing, payment or customer credit details.');
     s.invoices.push({id:e.id,customer_id:p.customer_id||null,total:amount,paid});
     e.amount=amount;e.description=prod.name+' sale';
     journal('revenue',0,amount);journal('cash',paid);journal('receivables',amount-paid);journal('cost_of_sales',cost);
   }else{
     if(!p.description?.trim())throw Error('Give a reason for the mortality.');
     e.description=prod.name+' mortality';
     e.amount=cost;
     journal('expenses',cost);
   }
 } else if(k==='expense'){
   e.division=p.division;journal('expenses',Number(p.amount));journal('cash',0,Number(p.amount));
 } else if(k==='reserve'){
   journal('reserve',Number(p.amount));journal('cash',0,Number(p.amount));
 } else if(k==='invoice_payment'){
   const inv=s.invoices.find(x=>x.id===p.invoice_id);
   if(!inv||Number(p.amount)>inv.total-inv.paid)throw Error('Payment exceeds the invoice balance.');
   inv.paid=round(inv.paid+Number(p.amount));journal('cash',Number(p.amount));journal('receivables',0,Number(p.amount));
 } else if(k==='loan'){
   if(!s.customers.some(x=>x.id===p.customer_id))throw Error('Select a registered customer.');
   if(s.loans.some(l=>l.customer_id===p.customer_id&&l.status==='active')||s.invoices.some(i=>i.customer_id===p.customer_id&&i.paid<i.total))throw Error('This customer must clear existing debt first.');
   if(p.due_on<dt)throw Error('Check the due date.');
   s.loans.push({id:e.id,customer_id:p.customer_id,principal:Number(p.amount),original_amount:Number(p.amount),interest:0,annual_rate:0.30,accrued_through:dt,due_on:p.due_on,status:'active'});
   e.division='Loans';journal('principal',Number(p.amount));journal('cash',0,Number(p.amount));
 } else if(k==='repay'||k==='accrue'){
   const l=s.loans.find(x=>x.id===p.loan_id&&x.status==='active');
   if(!l||dt<l.accrued_through)throw Error('Choose an active loan and valid date.');
   const earn=interest(l,dt);l.interest=round(l.interest+earn);journal('interest_income',0,earn);journal('interest_receivable',earn);
   if(k==='repay'){const amount=Number(p.amount);if(amount>l.principal+l.interest)throw Error('Payment exceeds the settlement balance.');const ip=Math.min(amount,l.interest),pp=round(amount-ip);l.interest=round(l.interest-ip);l.principal=round(l.principal-pp);journal('cash',amount);journal('interest_receivable',0,ip);journal('principal',0,pp)}
   l.accrued_through=dt;l.status=l.principal+l.interest===0?'settled':'active';e.division='Loans';
 } else throw Error('Unknown transaction.');

 // Negative operating cash is allowed. The owner can record expenses, purchases and loans before cash is replenished.
 s.events.unshift(e);return e.id;
}
export function csv(rows){return rows.map(row=>row.map(x=>{let value=String(x??'');if(/^[=+@\-\t\r]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
