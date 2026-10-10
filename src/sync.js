// Private, per-user snapshots and durable outbox. Never cache auth tokens here.
// IndexedDB is preferred. localStorage is a fallback for browser contexts where IndexedDB
// is unavailable (for example, some downloaded-file/desktop browser contexts).
const DB_NAME='sakhelwe-cloud-sync',STORE='workspaces',LOCAL_PREFIX='sakhelwe-cloud-sync:';
const blank=()=>({snapshot:null,workspace:null,queue:[],updatedAt:null});
const localKey=user=>LOCAL_PREFIX+user;
const openDB=()=>new Promise((resolve,reject)=>{
 if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB is unavailable.'));return}
 let r;
 try{r=indexedDB.open(DB_NAME,1)}catch(e){reject(e);return}
 r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
 r.onsuccess=()=>resolve(r.result);
 r.onerror=()=>reject(r.error||new Error('Could not open local storage.'));
});
function readLocal(user){
 if(typeof localStorage==='undefined')return null;
 try{const raw=localStorage.getItem(localKey(user));if(!raw)return null;const d=JSON.parse(raw);if(!d||typeof d!=='object')return null;return {...blank(),...d,queue:Array.isArray(d.queue)?d.queue:[]}}catch{return null}
}
function writeLocal(user,doc){
 if(typeof localStorage==='undefined')throw new Error('This browser does not provide persistent local storage. Open the installed Sakhelwe app in Edge or Chrome, connect once, then retry.');
 try{localStorage.setItem(localKey(user),JSON.stringify(doc))}catch(e){throw new Error('Offline storage is unavailable or full. No offline record was confirmed saved. '+(e?.message||''))}
}
function mergeDocs(primary,fallback){
 if(!fallback)return primary;
 if(!primary.snapshot&&fallback.snapshot)primary.snapshot=structuredClone(fallback.snapshot);
 const primaryTime=primary.updatedAt?Date.parse(primary.updatedAt):0,fallbackTime=fallback.updatedAt?Date.parse(fallback.updatedAt):0;
 if(fallback.workspace&&(!primary.workspace||fallbackTime>primaryTime))primary.workspace=structuredClone(fallback.workspace);
 const keys=new Set((primary.queue||[]).map(e=>e.key));
 for(const entry of fallback.queue||[])if(!keys.has(entry.key)){primary.queue.push(structuredClone(entry));keys.add(entry.key)}
 primary.queue.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
 if(fallbackTime>primaryTime)primary.updatedAt=fallback.updatedAt;
 return primary;
}
async function change(user,fn){
 if(!user)throw Error('Sign in before using cloud sync.');
 let db;
 try{
  db=await openDB();
  const result=await new Promise((resolve,reject)=>{
   let answer,failure;
   let tx;
   try{tx=db.transaction(STORE,'readwrite')}catch(e){reject(e);return}
   const store=tx.objectStore(STORE),r=store.get(user);
   r.onsuccess=()=>{
    try{
     const doc=mergeDocs(r.result||blank(),readLocal(user));
     answer=fn(doc);store.put(doc,user);
    }catch(e){failure=Object.assign(new Error(e?.message||"Offline queue operation failed."),{cause:e,skipFallback:true});try{tx.abort()}catch{}}
   };
   r.onerror=()=>{failure=r.error;try{tx.abort()}catch{}};
   tx.oncomplete=()=>resolve(answer);
   tx.onabort=tx.onerror=()=>reject(failure||tx.error||Error('Local storage transaction failed.'));
  });
  // Keep a fallback copy until the IndexedDB write has definitely committed.
  try{if(typeof localStorage!=='undefined')localStorage.removeItem(localKey(user))}catch{}
  return result;
 }catch(idbError){
  if(idbError?.skipFallback)throw idbError.cause||idbError;
  const doc=readLocal(user)||blank();let result;
  try{result=fn(doc)}catch(validationError){throw validationError}
  try{writeLocal(user,doc);return result}catch(localError){
   throw new Error('Could not save or read the offline workspace. '+(localError?.message||idbError?.message||'Local storage is unavailable.'));
  }
 }finally{try{db?.close()}catch{}}
}
export const syncRead=user=>change(user,d=>structuredClone(d));
export const syncSaveWorkspace=(user,workspace)=>change(user,d=>{
 d.workspace=structuredClone(workspace);
 if(!d.snapshot?.role&&workspace?.role)d.snapshot={role:workspace.role};
 d.updatedAt=new Date().toISOString();
});
export const syncEnqueue=(user,kind,payload,key)=>change(user,d=>{
 if(!d.snapshot)throw Error('Connect once to load your authorised workspace before recording offline.');
 if(d.snapshot.role==='analyst')throw Error('This account is read-only.');
 const prior=d.queue.find(e=>e.key===key);
 if(prior){if(prior.kind!==kind||JSON.stringify(prior.payload)!==JSON.stringify(payload))throw Error('Request key already used.');return}
 d.queue.push({key,kind,payload:structuredClone(payload),createdAt:new Date().toISOString(),error:null});
 d.updatedAt=new Date().toISOString();
});
export const syncRetry=user=>change(user,d=>{if(d.queue[0])d.queue[0].error=null});
export const syncClearPending=user=>change(user,d=>{if(typeof navigator!=='undefined'&&navigator.userActivation&&!navigator.userActivation.isActive)return;d.queue=[];d.updatedAt=new Date().toISOString()});
export const syncRepairPending=(user,key,patch)=>change(user,d=>{
 const entry=d.queue.find(e=>e.key===key);if(!entry)throw Error('Pending entry no longer exists.');
 entry.payload={...entry.payload,...structuredClone(patch)};entry.error=null;d.updatedAt=new Date().toISOString();
});
export const syncBackup=user=>change(user,d=>JSON.stringify({format:'sakhelwe-cloud-outbox-v1',user_id:user,...d},null,2));
const running=new Map();
export function syncRun(user,rpc){
 if(running.has(user))return running.get(user);
 const promise=run(user,rpc).finally(()=>running.delete(user));running.set(user,promise);return promise;
}
function normalisePayload(payload){
 const next=structuredClone(payload||{});
 for(const field of ['product_id','customer_id','invoice_id','loan_id']){
  if(field in next&&(next[field]===null||String(next[field]).trim()===''))next[field]=null;
 }
 return next;
}
async function run(user,rpc){
 let snapshot=await rpc('sakhelwe_snapshot');
 await change(user,d=>{d.snapshot=snapshot;d.updatedAt=new Date().toISOString()});
 while(true){
  const doc=await syncRead(user),entry=doc.queue[0];if(!entry)break;
  if(entry.error)throw Error(entry.error);
  try{await rpc('sakhelwe_post',{kind:entry.kind,payload:normalisePayload(entry.payload),request_key:entry.key})}
  catch(e){
   if(e.code&&!['PGRST000','PGRST001','PGRST002','PGRST003','57014','53300','57P01'].includes(e.code)&&!String(e.code).startsWith('08'))
    await change(user,d=>{const first=d.queue.find(x=>x.key===entry.key);if(first)first.error=e.message});
   throw e;
  }
  await change(user,d=>{d.queue=d.queue.filter(x=>x.key!==entry.key);d.updatedAt=new Date().toISOString()});
 }
 snapshot=await rpc('sakhelwe_snapshot');
 await change(user,d=>{d.snapshot=snapshot;d.updatedAt=new Date().toISOString()});
 return syncRead(user);
}
