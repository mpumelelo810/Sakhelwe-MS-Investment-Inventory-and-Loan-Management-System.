export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Mbabane',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money=n=>`E ${Number(n||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export const ageWeeks=(b,date=today())=>Math.max(0,Number(b.age_weeks||0)+Math.floor(days(b.received_on,date)/7));
export const ANIMAL_CATEGORIES=Object.freeze({
 Poultry:Object.freeze([{label:'Chicks',min:0,max:4},{label:'Growers',min:4,max:6},{label:'Ready to sell',min:6,max:Infinity}]),
 Pigs:Object.freeze([{label:'Piglets',min:0,max:9},{label:'Growers',min:9,max:21},{label:'Adults',min:21,max:Infinity}])
});
const normalDivision=division=>['Chicken','Chickens','Poultry'].includes(String(division||''))?'Poultry':'Pigs';
export const ageCategory=(division,weeks)=>{const w=Math.max(0,Number(weeks||0)),d=normalDivision(division);return ANIMAL_CATEGORIES[d].find(c=>w>=c.min&&w<c.max)?.label||ANIMAL_CATEGORIES[d].at(-1).label;};
export const days=(a,b)=>Math.max(0,Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000));
export const addDays=(date,n)=>{
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(n||0));return d.toISOString().slice(0,10);
};
export const addMonths=(date,n=1)=>{
 const d=new Date(date+'T12:00:00Z'),day=d.getUTCDate();
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Number(n||0));
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
};
export const compoundPeriods=(dueOn,date=today())=>{
 if(!dueOn||date<dueOn)return 0;
 let n=0,d=dueOn;
 while(d<=date){n++;d=addMonths(d,1);}
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
   s.loans.push({id:e.id,customer_id:p.customer_id,principal:Number(p.amount),original_amount:Number(p.amount),interest:0,annual_rate:0.30,accrued_through:addDays(p.due_on,-1),due_on:p.due_on,status:'active'});
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


const dateRange=range=>({
 fromDate:range?.fromDate||range?.from||null,
 toDate:range?.toDate||range?.to||null
});
const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(new Date(date+'T12:00:00Z').getTime());
const kindOf=event=>String(event?.kind||event?.event_type||event?.type||'').toLowerCase();
const eventQuantity=event=>Math.max(0,Number(event?.payload?.quantity??event?.quantity??0));
const eventDate=event=>event?.business_date||event?.date||null;
const isChicken=division=>normalDivision(division)==='Poultry';
const initialBatchQuantity=batch=>Math.max(0,Number(batch?.initial_quantity??batch?.quantity??0));
const currentBatchQuantity=batch=>Math.max(0,Number(batch?.remaining??batch?.quantity??batch?.initial_quantity??0));
const divisionForProduct=(state,productId)=>state?.products?.find(p=>p.id===productId)?.division||null;
const batchDivision=(state,batch)=>batch?.division||batch?.animal||batch?.product_division||divisionForProduct(state,batch?.product_id)||(
 batch?.category==='Opening Ready'||batch?.batch_name?.includes('chicken')||batch?.batch_name?.includes('Chicken')?'Poultry':null
);
const inWindow=(date,from,to)=>validDate(date)&&(!from||date>=from)&&(!to||date<=to);
const isSaleKind=kind=>['sale','sell','chicken_sale','live_sale','dressed_sale'].includes(kind);
const isDeathKind=kind=>['mortality','death','died'].includes(kind);
const isLossKind=kind=>['loss','other_loss','adjustment_out','write_off'].includes(kind);
const isReceiptKind=kind=>['opening_stock','receive','received','delivery'].includes(kind);

/**
 * Daily stock from confirmed records only. The UI's pending/outbox queue must
 * never be passed here as events. Chicken-specific tables are supported when
 * available; otherwise the general ledger event stream is replayed.
 */
export function stockTimeline(state,division,fromDate,toDate){
 const allDates=[];
 const customChicken=isChicken(division)&&Array.isArray(state?.chickenBatches);
 const changes=[];
 const add=(date,field,quantity)=>{if(!validDate(date))return;const q=Math.max(0,Number(quantity||0));if(!q)return;changes.push({date,field,quantity:q});allDates.push(date);};
 if(customChicken){
  for(const b of state.chickenBatches||[]){
   const date=b.received_on||b.business_date;
   if(date)add(date,b.category==='Opening Ready'||b.opening_stock?'opening':'bought',initialBatchQuantity(b));
  }
  for(const m of state.chickenMortality||[])add(m.death_date||m.business_date,'died',m.quantity);
  for(const s of state.chickenSales||[])add(s.sale_date||s.business_date,'sold',s.quantity);
  for(const e of state.chickenEvents||[])if(isLossKind(kindOf(e)))add(eventDate(e),'otherLosses',eventQuantity(e));
 } else {
  const products=state?.products||[];
  for(const e of state?.events||[]){
   const productDivision=e.division||divisionForProduct(state,e.payload?.product_id||e.product_id);
   if(division!=='All sections'&&division!=='All'&&productDivision!==division)continue;
   const kind=kindOf(e),date=eventDate(e),q=eventQuantity(e);
   if(!q)continue;
   if(isReceiptKind(kind))add(date,kind==='opening_stock'?'opening':'bought',q);
   else if(isSaleKind(kind))add(date,'sold',q);
   else if(isDeathKind(kind))add(date,'died',q);
   else if(isLossKind(kind))add(date,'otherLosses',q);
  }
 }
 const end=validDate(toDate)?toDate:(allDates.length?allDates.sort().at(-1):today());
 const start=validDate(fromDate)?fromDate:(allDates.length?allDates.sort()[0]:end);
 if(start>end)return [];
 const changesByDate=new Map();
 for(const c of changes){const row=changesByDate.get(c.date)||{bought:0,opening:0,sold:0,died:0,otherLosses:0};row[c.field]+=c.quantity;changesByDate.set(c.date,row);}
 const result=[];let balance=0;
 // Replay everything before the requested window so the first point carries
 // the correct confirmed opening balance.
 const prior=[...changesByDate.keys()].filter(d=>d<start).sort();
 for(const d of prior){const x=changesByDate.get(d);balance+=x.opening+x.bought-x.sold-x.died-x.otherLosses;}
 for(let date=start;date<=end;date=addDays(date,1)){
  const c=changesByDate.get(date)||{bought:0,opening:0,sold:0,died:0,otherLosses:0};
  balance+=c.opening+c.bought-c.sold-c.died-c.otherLosses;
  result.push({date,balance,opening:c.opening,bought:c.bought,sold:c.sold,died:c.died,otherLosses:c.otherLosses});
 }
 return result;
}

export function batchProgress(batch,date=today()){
 const receivedOn=batch?.received_on||batch?.date||date;
 const division=batchDivision({products:[]},batch)||batch?.division||(
  batch?.category==='Opening Ready'||batch?.batch_name?.toLowerCase?.().includes('chicken')?'Poultry':'Pigs'
 );
 const weeks=Math.max(0,Number(batch?.age_weeks||0)+Math.floor(days(receivedOn,date)/7));
 const targetWeeks=isChicken(division)?6:null;
 return {ageWeeks:weeks,ageDays:Math.max(0,Number(batch?.age_weeks||0)*7+days(receivedOn,date)),category:batch?.category==='Opening Ready'?'Ready to sell':ageCategory(division,weeks),targetWeeks,weeksUntilReady:targetWeeks===null?null:Math.max(0,targetWeeks-weeks),ready:targetWeeks!==null&&weeks>=targetWeeks,progressPercent:targetWeeks===null?null:Math.min(100,Math.round(weeks/targetWeeks*100))};
}

function eventDivision(state,event){return event?.division||divisionForProduct(state,event?.payload?.product_id||event?.product_id)||null;}
function standardEntries(state,division){
 const products=new Map((state?.products||[]).map(p=>[p.id,p]));
 return (state?.batches||[]).filter(b=>{
  const d=b.division||b.product_division||products.get(b.product_id)?.division;
  return d===division;
 });
}
function deathsForBatch(state,batch,from,to){
 return (state?.chickenMortality||[]).filter(e=>e.batch_id===batch.id&&inWindow(e.death_date||e.business_date,from,to)).reduce((n,e)=>n+Number(e.quantity||0),0);
}
function customChickenRemaining(state,batch,date){
 const started=batch.received_on<=date?initialBatchQuantity(batch):0;
 const dead=(state.chickenMortality||[]).filter(e=>e.batch_id===batch.id&&(e.death_date||e.business_date)<=date).reduce((n,e)=>n+Number(e.quantity||0),0);
 const sold=(state.chickenSales||[]).filter(e=>e.batch_id===batch.id&&(e.sale_date||e.business_date)<=date).reduce((n,e)=>n+Number(e.quantity||0),0);
 return Math.max(0,started-dead-sold);
}
function standardRemainingByBatch(state,division,date){
 const products=new Map((state?.products||[]).map(p=>[p.id,p]));
 const batches=(state?.batches||[]).filter(b=>(b.division||products.get(b.product_id)?.division)===division&&validDate(b.received_on)&&b.received_on<=date)
  .map(b=>({...b,remainingAtDate:Math.max(0,Number(b.quantity??b.initial_quantity??b.remaining??0))}))
  .sort((a,b)=>a.received_on.localeCompare(b.received_on)||String(a.id).localeCompare(String(b.id)));
 const consumption=(state?.events||[]).filter(e=>{
  const k=kindOf(e);return inWindow(eventDate(e),null,date)&&
   (isSaleKind(k)||isDeathKind(k)||isLossKind(k))&&eventDivision(state,e)===division;
 }).sort((a,b)=>eventDate(a).localeCompare(eventDate(b))||String(a.id).localeCompare(String(b.id)));
 for(const e of consumption){
  const productId=e.payload?.product_id||e.product_id;
  let need=eventQuantity(e);
  for(const b of batches){
   if(productId&&b.product_id!==productId)continue;
   if(b.received_on>eventDate(e)||b.remainingAtDate<=0)continue;
   const take=Math.min(need,b.remainingAtDate);b.remainingAtDate-=take;need-=take;if(need<=0)break;
  }
 }
 return batches;
}

/** Remaining animals grouped by their age band at the requested date. */
export function ageMix(state,division,date=today()){
 const config=ANIMAL_CATEGORIES[normalDivision(division)];
 const counts=new Map(config.map(c=>[c.label,0]));
 let batches=[];
 if(isChicken(division)&&Array.isArray(state?.chickenBatches)){
  batches=(state.chickenBatches||[]).filter(b=>validDate(b.received_on)&&b.received_on<=date).map(b=>({
   batch:b,remaining:customChickenRemaining(state,b,date),
   division:'Poultry',
   age_weeks:batchProgress({...b,division:'Poultry'},date).ageWeeks
  }));
 } else {
  batches=standardRemainingByBatch(state,division,date).map(b=>({batch:b,remaining:Math.max(0,Number(b.remainingAtDate||0)),division,age_weeks:Math.max(0,Number(b.age_weeks||0)+Math.floor(days(b.received_on,date)/7))}));
 }
 for(const row of batches){
  const label=row.batch.category==='Opening Ready'&&isChicken(division)?'Ready to sell':ageCategory(division,row.age_weeks);
  if(counts.has(label))counts.set(label,counts.get(label)+row.remaining);
 }
 const categories=config.map(c=>({category:c.label,count:counts.get(c.label)||0}));
 return {date,division,total:categories.reduce((n,c)=>n+c.count,0),categories};
}

/**
 * Mortality rate for the selected intake cohort. The denominator is the number
 * entered in batches received in the date window; deaths are counted against
 * those same batches in that window. With no range, all recorded batches apply.
 */
export function mortalityRate(state,division,range={}){
 const {fromDate}=dateRange(range),toDate=validDate(range?.toDate||range?.to)?(range.toDate||range.to):today();
 const customChicken=isChicken(division)&&Array.isArray(state?.chickenBatches);
 let batches=[];
 if(customChicken){
  batches=(state.chickenBatches||[]).filter(b=>inWindow(b.received_on,fromDate,toDate)).map(b=>{
   const entered=initialBatchQuantity(b);
   const deaths=(state.chickenMortality||[]).filter(e=>e.batch_id===b.id&&inWindow(e.death_date||e.business_date,fromDate,toDate)).reduce((n,e)=>n+Number(e.quantity||0),0);
   return {batchId:b.id,label:b.batch_name||b.received_on,entered,deaths,rate:entered?deaths/entered*100:0};
  });
 } else {
  const products=new Map((state?.products||[]).map(p=>[p.id,p]));
  const inventory=(state?.batches||[]).filter(b=>(b.division||products.get(b.product_id)?.division)===division&&validDate(b.received_on)&&b.received_on<=toDate)
   .map(b=>({...b,remainingForReplay:initialBatchQuantity(b),deathsInRange:0}))
   .sort((a,b)=>a.received_on.localeCompare(b.received_on)||String(a.id).localeCompare(String(b.id)));
  const outcomes=(state?.events||[]).filter(e=>{
   const k=kindOf(e),date=eventDate(e);
   return validDate(date)&&date<=toDate&&(isSaleKind(k)||isDeathKind(k)||isLossKind(k))&&eventDivision(state,e)===division;
  }).sort((a,b)=>eventDate(a).localeCompare(eventDate(b))||String(a.id).localeCompare(String(b.id)));
  for(const e of outcomes){
   let need=eventQuantity(e);if(!need)continue;
   const k=kindOf(e),date=eventDate(e),productId=e.payload?.product_id||e.product_id,directId=e.payload?.batch_id||e.batch_id;
   const candidates=inventory.filter(b=>(!directId||b.id===directId)&&(!productId||b.product_id===productId)&&b.received_on<=date&&b.remainingForReplay>0);
   for(const b of candidates){
    const take=Math.min(need,b.remainingForReplay);
    if(isDeathKind(k)&&inWindow(date,fromDate,toDate))b.deathsInRange+=take;
    b.remainingForReplay-=take;need-=take;if(need<=0)break;
   }
  }
  batches=inventory.filter(b=>inWindow(b.received_on,fromDate,toDate)).map(b=>{
   const entered=initialBatchQuantity(b),deaths=b.deathsInRange;
   return {batchId:b.id,label:b.received_on,entered,deaths,rate:entered?deaths/entered*100:0};
  });
 }
 const totalEntered=batches.reduce((n,b)=>n+b.entered,0),totalDeaths=batches.reduce((n,b)=>n+b.deaths,0);
 return {division,fromDate,toDate,totalEntered,totalDeaths,rate:totalEntered?totalDeaths/totalEntered*100:0,batches};
}
