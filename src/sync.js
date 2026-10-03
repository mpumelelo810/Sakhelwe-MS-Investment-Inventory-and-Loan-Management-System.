// Private, per-user snapshots and a durable outbox. Never cache auth tokens here.
const openDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('sakhelwe-cloud-sync',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspaces');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function change(user,fn){if(!user)throw Error('Sign in before using cloud sync.');const db=await openDB();return new Promise((resolve,reject)=>{let result,failure;const tx=db.transaction('workspaces','readwrite'),store=tx.objectStore('workspaces'),r=store.get(user);r.onsuccess=()=>{try{const doc=r.result||{snapshot:null,queue:[],updatedAt:null};result=fn(doc);store.put(doc,user)}catch(e){failure=e;tx.abort()}};tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=tx.onerror=()=>{db.close();reject(failure||tx.error||Error('Local storage failed; the entry was not saved.'))}})}
export const syncRead=user=>change(user,d=>structuredClone(d));
export const syncEnqueue=(user,kind,payload,key)=>change(user,d=>{if(!d.snapshot)throw Error('Connect once to load your authorised workspace before recording offline.');if(d.snapshot.role==='analyst')throw Error('This account is read-only.');const prior=d.queue.find(e=>e.key===key);if(prior){if(prior.kind!==kind||JSON.stringify(prior.payload)!==JSON.stringify(payload))throw Error('Request key already used.');return}d.queue.push({key,kind,payload:structuredClone(payload),createdAt:new Date().toISOString(),error:null});});
export const syncRetry=user=>change(user,d=>{if(d.queue[0])d.queue[0].error=null;});
export const syncBackup=user=>change(user,d=>JSON.stringify({format:'sakhelwe-cloud-outbox-v1',user_id:user,...d},null,2));
const running=new Map();
export function syncRun(user,rpc){if(running.has(user))return running.get(user);const promise=run(user,rpc).finally(()=>running.delete(user));running.set(user,promise);return promise;}
function normalisePayload(payload){
 const next=structuredClone(payload||{});
 // Optional foreign keys must never be sent as an empty UUID string.
 for(const field of ['product_id','customer_id','invoice_id','loan_id','policy_id']){
  if(field in next && (next[field]===null || String(next[field]).trim()==='')) next[field]=null;
 }
 return next;
}
async function run(user,rpc){
 // Membership is checked before posting. A network failure leaves every entry intact.
 let snapshot=await rpc('sakhelwe_snapshot');
 await change(user,d=>{d.snapshot=snapshot;d.updatedAt=new Date().toISOString()});
 while(true){const doc=await syncRead(user),entry=doc.queue[0];if(!entry)break;if(entry.error)await change(user,d=>{const first=d.queue.find(x=>x.key===entry.key);if(first)first.error=null;});
  try{await rpc('sakhelwe_post',{kind:entry.kind,payload:normalisePayload(entry.payload),request_key:entry.key});}
  catch(e){if(e.code&& !['PGRST000','PGRST001','PGRST002','PGRST003','57014','53300','57P01'].includes(e.code)&&!String(e.code).startsWith('08'))await change(user,d=>{const first=d.queue.find(x=>x.key===entry.key);if(first)first.error=e.message});throw e}
  // Only acknowledge after the server confirms. Duplicate retries use the same UUID.
  await change(user,d=>{d.queue=d.queue.filter(x=>x.key!==entry.key)});
 }
 snapshot=await rpc('sakhelwe_snapshot');await change(user,d=>{d.snapshot=snapshot;d.updatedAt=new Date().toISOString()});return syncRead(user);
}
