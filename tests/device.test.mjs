import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceRead,deviceWrite,deviceBackup,deviceRestore} from '../src/device.js';
import {today} from '../src/model.js';
test('offline entries survive reload, preserve linked IDs, reject overspending and backup restores',async()=>{
const date=today();await deviceWrite('capital',{date,amount:'1000'},'offline-1');let s=await deviceWrite('product',{date,name:'Chicken',unit:'each',division:'Poultry',threshold:'2'},'offline-2');const product=s.products[0].id;
s=await deviceWrite('receive',{date,amount:'200',quantity:'10',product_id:product,supplier:'Supplier'},'offline-3');s=await deviceRead();assert.equal(s.batches[0].product_id,product);assert.equal(s.events.length,3);
await assert.rejects(deviceWrite('expense',{date,amount:'9999',division:'Business',description:'Rejected'},'offline-4'));assert.equal((await deviceRead()).events.length,3);
await deviceWrite('capital',{date,amount:'1000'},'offline-1');assert.equal((await deviceRead()).events.length,3);
const backup=await deviceBackup();await assert.rejects(deviceRestore(backup),/empty/);assert.equal((await deviceRead()).events.length,3);
await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('sakhelwe-device-records');r.onsuccess=resolve;r.onerror=reject});await deviceRestore(backup);s=await deviceRead();assert.equal(s.products[0].id,product);assert.equal(s.batches[0].product_id,product);assert.equal(s.events.length,3);
});
