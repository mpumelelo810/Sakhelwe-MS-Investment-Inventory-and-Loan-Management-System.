import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFile,readdir} from 'node:fs/promises';import {JSDOM} from 'jsdom';
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:new URL('..',import.meta.url),stdio:'pipe',env:{...process.env,VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''}});
const assets=await readdir(new URL('../dist/assets',import.meta.url)),bundle=await readFile(new URL('../dist/assets/'+assets.find(f=>f.endsWith('.js')),import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
test('built interface opens sample workspace, navigates all pages and records a delivery',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://sakhelwe.example',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.error?.message||e.message));
 w.structuredClone=structuredClone;try{w.eval(bundle);await tick();assert.match(doc.body.textContent,/Welcome back/);assert.match(doc.body.textContent,/Sign in to your business workspace/);
 const button=text=>[...doc.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
 button('Open sample workspace').click();await tick();assert.match(doc.body.textContent,/Business overview/);assert.match(doc.body.textContent,/E 7,510.00/);assert.match(doc.body.textContent,/E 1,230.00/);
 for(const name of ['Stock','Sales','Customers','Loans','Expenses','Reports','Settings','Overview']){[...doc.querySelectorAll('nav button')].find(b=>b.textContent.startsWith(name)).click();await tick();assert.equal(doc.querySelector('.page-heading h1').textContent,name==='Overview'?'Business overview':name);}
 button('Receive a deliveryAdd stock and purchase cost').click();await tick();const form=doc.querySelector('.modal form');assert.ok(form);
 const select=form.querySelector('[name=product_id]');select.value='chicken';select.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 const input=form.querySelector('[name=quantity]');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'5');input.dispatchEvent(new w.Event('input',{bubbles:true}));await tick();
 form.querySelector('[name=supplier]').value='UI test supplier';form.querySelector('[name=amount]').value='300';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.match(doc.body.textContent,/Demo entry saved/);assert.equal(doc.querySelector('[aria-labelledby=form-title]'),null);assert.match(doc.body.textContent,/E 7,210.00/);assert.deepEqual(errors,[]);
 }finally{w.close()}
});
