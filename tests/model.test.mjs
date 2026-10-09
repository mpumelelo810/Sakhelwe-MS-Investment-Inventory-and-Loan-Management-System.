import {test} from 'node:test';import assert from 'node:assert/strict';import {demo,totals,today,csv,interest} from '../src/model.js';
test('demo separates sales, cash, debt and profit',()=>{const s=demo(),t=totals(s,today().slice(0,7));assert.equal(t.revenue,4460);assert.equal(t.cash,7510);assert.equal(t.debt,800);assert.equal(t.profit,1230);assert.equal(t.inventory,7920)});
test('CSV protects formula-like customer descriptions',()=>{assert.match(csv([['=HYPERLINK("bad")']]),/"'=HYPERLINK/);assert.match(csv([['a"b']]),/a""b/)});
test('loan interest compounds at a fixed 30% per month',()=>{assert.equal(interest({principal:1000,interest:0,due_on:'2026-01-01',accrued_through:'2025-12-01'},'2026-01-01'),300);assert.equal(interest({principal:1000,interest:0,due_on:'2026-01-01',accrued_through:'2026-01-01'},'2026-02-01'),390);});


import {ageCategory,ageMix,batchProgress,mortalityRate,stockTimeline,empty,addDays} from '../src/model.js';

test('chicken and pig age bands use the agreed thresholds',()=>{
 assert.equal(ageCategory('Poultry',0),'Chicks');
 assert.equal(ageCategory('Poultry',3),'Chicks');
 assert.equal(ageCategory('Poultry',4),'Growers');
 assert.equal(ageCategory('Poultry',5),'Growers');
 assert.equal(ageCategory('Poultry',6),'Ready to sell');
 assert.equal(ageCategory('Pigs',8),'Piglets');
 assert.equal(ageCategory('Pigs',9),'Growers');
 assert.equal(ageCategory('Pigs',21),'Adults');
});

test('batch progress rolls forward by age and exposes weeks until ready',()=>{
 const b={division:'Poultry',received_on:'2026-09-01',age_weeks:0};
 assert.deepEqual(batchProgress(b,'2026-09-22'),{ageWeeks:3,ageDays:21,category:'Chicks',targetWeeks:6,weeksUntilReady:3,ready:false,progressPercent:50});
 assert.equal(batchProgress(b,'2026-10-13').ready,true);
 assert.equal(batchProgress({...b,division:'Pigs'},'2026-10-13').targetWeeks,null);
});

test('stock timeline replays backdated openings and carries the balance through quiet days',()=>{
 const state={...empty(),events:[
  {id:'a',kind:'opening_stock',division:'Poultry',business_date:'2026-09-02',payload:{quantity:20,product_id:'c'}},
  {id:'b',kind:'receive',division:'Poultry',business_date:'2026-09-04',payload:{quantity:10,product_id:'c'}},
  {id:'c',kind:'sale',division:'Poultry',business_date:'2026-09-06',payload:{quantity:7,product_id:'c'}},
  {id:'d',kind:'mortality',division:'Poultry',business_date:'2026-09-07',payload:{quantity:2,product_id:'c'}}
 ],queue:[{kind:'sale',payload:{quantity:1000}}]};
 const rows=stockTimeline(state,'Poultry','2026-09-02','2026-09-08');
 assert.equal(rows.length,7);
 assert.deepEqual(rows[0],{date:'2026-09-02',balance:20,opening:20,bought:0,sold:0,died:0,otherLosses:0});
 assert.equal(rows[1].balance,20);
 assert.equal(rows[2].balance,30);
 assert.equal(rows[4].balance,23);
 assert.equal(rows[5].balance,21);
 assert.equal(rows[6].balance,21);
});

test('custom chicken time series shows entered stock, deaths and sales without mutating the snapshot',()=>{
 const state={
  chickenBatches:[{id:'batch-a',batch_name:'September A',received_on:'2026-09-01',initial_quantity:100,category:'Growing'}],
  chickenMortality:[{id:'m1',batch_id:'batch-a',death_date:'2026-09-10',quantity:5}],
  chickenSales:[{id:'s1',batch_id:'batch-a',sale_date:'2026-09-12',quantity:20}],
  chickenMoves:[{id:'mv1',batch_id:'batch-a',move_date:'2026-09-11',move_type:'dressed',quantity:10}],
  queue:[{payload:{quantity:500}}]
 };
 const before=JSON.stringify(state);
 const rows=stockTimeline(state,'Poultry','2026-09-01','2026-09-13');
 assert.equal(rows.at(-1).balance,75);
 assert.equal(rows.find(x=>x.date==='2026-09-01').bought,100);
 assert.equal(ageMix(state,'Poultry','2026-09-13').total,75);
 const result=mortalityRate(state,'Poultry',{fromDate:'2026-09-01',toDate:'2026-09-30'});
 assert.equal(result.totalEntered,100);
 assert.equal(result.totalDeaths,5);
 assert.equal(result.rate,5);
 assert.equal(JSON.stringify(state),before);
});

test('empty farms return zero stock, zero age mix and zero mortality',()=>{
 const state=empty();
 const rows=stockTimeline(state,'Pigs','2026-09-01','2026-09-03');
 assert.deepEqual(rows.map(x=>x.balance),[0,0,0]);
 assert.deepEqual(ageMix(state,'Pigs','2026-09-03').categories.map(x=>x.count),[0,0,0]);
 assert.equal(mortalityRate(state,'Pigs').rate,0);
});


test('replayed stock and age mix reconcile with FIFO batch balances',()=>{
 const state={
  products:[{id:'p',name:'Porkers',division:'Pigs',unit:'each'}],
  batches:[
   {id:'b1',product_id:'p',received_on:'2026-09-01',quantity:10,remaining:0,age_weeks:0},
   {id:'b2',product_id:'p',received_on:'2026-09-04',quantity:20,remaining:16,age_weeks:0}
  ],
  events:[
   {id:'r1',kind:'opening_stock',division:'Pigs',business_date:'2026-09-01',payload:{product_id:'p',quantity:10}},
   {id:'r2',kind:'receive',division:'Pigs',business_date:'2026-09-04',payload:{product_id:'p',quantity:20}},
   {id:'s1',kind:'sale',division:'Pigs',business_date:'2026-09-05',payload:{product_id:'p',quantity:12}},
   {id:'m1',kind:'mortality',division:'Pigs',business_date:'2026-09-06',payload:{product_id:'p',quantity:2}}
  ]
 };
 const end=stockTimeline(state,'Pigs','2026-09-01','2026-09-06').at(-1);
 assert.equal(end.balance,state.batches.reduce((n,b)=>n+Number(b.remaining),0));
 const mix=ageMix(state,'Pigs','2026-09-06');
 assert.equal(mix.total,end.balance);
 const rate=mortalityRate(state,'Pigs',{fromDate:'2026-09-01',toDate:'2026-09-06'});
 assert.equal(rate.totalEntered,30);
 assert.equal(rate.totalDeaths,2);
 assert.equal(rate.batches.find(b=>b.batchId==='b1').deaths,0);
 assert.equal(rate.batches.find(b=>b.batchId==='b2').deaths,2);
});
