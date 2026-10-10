import test from "node:test";import assert from "node:assert/strict";import{readFile}from"node:fs/promises";
import {downloadMonthlyExcelReport} from "../src/excelExport.js";
test("Sakhelwe uses the Supabase snapshot and transaction RPCs",async()=>{const s=(await Promise.all(["src/main.jsx","src/components.jsx"].map(p=>readFile(p,"utf8")))).join("\n");assert.match(s,/sakhelwe_snapshot/);assert.match(s,/sakhelwe_post/);assert.match(s,/sakhelwe_delete_event/);});
test("Sakhelwe keeps the essential livestock features",async()=>{const s=(await Promise.all(["src/main.jsx","src/components.jsx"].map(p=>readFile(p,"utf8")))).join("\n");assert.match(s,/age_weeks/);assert.match(s,/mortality/);assert.match(s,/pricing_quantity/);assert.match(s,/Money owed/);});

test("Pig sales and expenses are contextual and avoid unnecessary section choices",async()=>{const app=(await Promise.all(["src/main.jsx","src/components.jsx"].map(p=>readFile(p,"utf8")))).join("\n");assert.match(app,/f.type==="sale"&&f.division==="Pigs"/);assert.match(app,/Total sale amount \(E\)/);assert.doesNotMatch(app,/<Field l="Livestock">/);assert.doesNotMatch(app,/<Field l="Section">/);assert.match(app,/addPigSale/);assert.match(app,/What was the expense for\?/);});
test("Business income and buyer names are linked to the ledger",async()=>{const app=(await Promise.all(["src/main.jsx","src/components.jsx"].map(p=>readFile(p,"utf8")))).join("\n");const migration=await readFile("database/migrations/20261010_simple_pig_sales_and_business_income.sql","utf8");assert.match(app,/f.type==="income"/);assert.match(app,/e.kind==="income"/);assert.match(migration,/journal\(e,'revenue',0,amt\)/);assert.match(migration,/p->>'customer_name'/);});
test("Chicken and pig sales explicitly record cash or credit and use the customer list",async()=>{const app=(await Promise.all(["src/main.jsx","src/components.jsx"].map(p=>readFile(p,"utf8")))).join("\n");assert.match(app,/value="Cash">Paid cash/);assert.match(app,/value="Credit">Credit — customer owes/);assert.match(app,/__register__/);assert.match(app,/New customer name/);assert.match(app,/kind:"customer",payload:\{date:today\(\),name:customerName/);assert.match(app,/payment_type:p.payment_type/);});
test("Home leads with the monthly enterprise report and combined totals",async()=>{const app=(await Promise.all(["src/main.jsx","src/components.jsx"].map(p=>readFile(p,"utf8")))).join("\n");assert.match(app,/Monthly business report/);assert.match(app,/Total income/);assert.match(app,/Combined profit/);assert.match(app,/enterpriseMonthlySummary/);assert.match(app,/View detailed reports/);});

test("Excel report export includes month-end reports and a multi-sheet workbook",async()=>{const [app,components,exporter]=await Promise.all(["src/main.jsx","src/components.jsx","src/excelExport.js"].map(p=>readFile(p,"utf8")));assert.match(components,/Download Excel report/);assert.match(components,/downloadMonthlyExcelReport/);assert.match(exporter,/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);assert.match(exporter,/Monthly Summary/);assert.match(exporter,/Customer Balances/);assert.match(exporter,/Stock Snapshot/);assert.match(exporter,/Loan Activity/);assert.match(app,/stockBatches=\{bs\}/);});

test("Latest production repairs include core livestock catalog seeds and RPC permission hardening",async()=>{const products=await readFile("database/migrations/20261010135742_restore_core_livestock_products.sql","utf8");const permissions=await readFile("database/migrations/20261010135507_restrict_public_loan_interest_rpc.sql","utf8");assert.match(products,/Whole chickens/);assert.match(products,/Live pigs/);assert.match(products,/ON CONFLICT \(name\) DO NOTHING/);assert.match(permissions,/REVOKE EXECUTE ON FUNCTION public\.sakhelwe_apply_loan_interest\(uuid, integer\) FROM PUBLIC, anon, authenticated/i);});

test("Excel report export creates a readable multi-sheet XLSX package",async()=>{
 const originalDocument=globalThis.document,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 let blob=null,clicked=false;
 const anchor={href:"",download:"",click(){clicked=true},remove(){}};
 globalThis.document={createElement(tag){assert.equal(tag,"a");return anchor},body:{appendChild(node){assert.equal(node,anchor)}}};
 URL.createObjectURL=value=>{blob=value;return "blob:test-report"};
 URL.revokeObjectURL=()=>{};
 try{
  downloadMonthlyExcelReport({
   month:"2026-10",
   events:[{id:"pig-sale",kind:"sale",division:"Pigs",business_date:"2026-10-12",description:"Pig sale",amount:100,payload:{quantity:1,paid:100,customer_name:"Test Buyer"}}],
   journal:[],batches:[],mortality:[],moves:[],expenses:[],sales:[],customers:[],invoices:[],loans:[],products:[],stockBatches:[]
  });
  assert.ok(blob instanceof Blob);
  assert.equal(anchor.download,"Sakhelwe_Monthly_Report_2026-10.xlsx");
  assert.equal(clicked,true);
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
  const files={};let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
   assert.equal(view.getUint16(offset+8,true),0,"XLSX file entries are stored without compression");
   const compressedSize=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);
   const name=decoder.decode(bytes.slice(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extraLength;
   files[name]=decoder.decode(bytes.slice(start,start+compressedSize));
   offset=start+compressedSize;
  }
  const eocd=bytes.length-22;
  assert.equal(view.getUint32(eocd,true),0x06054b50,"ZIP end-of-central-directory record exists");
  const centralOffset=view.getUint32(eocd+16,true),entryCount=view.getUint16(eocd+10,true);
  assert.equal(offset,centralOffset,"Central directory begins after the local file records");
  let central=centralOffset,centralNames=0;
  while(central+46<=eocd&&view.getUint32(central,true)===0x02014b50){
   const nameLength=view.getUint16(central+28,true),extraLength=view.getUint16(central+30,true),commentLength=view.getUint16(central+32,true);
   const name=decoder.decode(bytes.slice(central+46,central+46+nameLength));
   assert.ok(Object.hasOwn(files,name),"Each central-directory entry points to a local file");
   central+=46+nameLength+extraLength+commentLength;centralNames++;
  }
  assert.equal(centralNames,entryCount);
  assert.ok(files["[Content_Types].xml"]);
  assert.ok(files["xl/styles.xml"]);
  const workbook=files["xl/workbook.xml"];
  for(const name of ["Monthly Summary","Sales","Expenses","Poultry Batches","Customer Balances","Loans","Loan Activity","Stock Snapshot","Transactions","Read Me"])assert.ok(workbook.includes('name="'+name+'"'),"Workbook contains "+name+" sheet");
  assert.ok(files["xl/worksheets/sheet2.xml"].includes("Pig sale"));
  assert.ok(files["xl/worksheets/sheet10.xml"].includes("HOW TO USE THIS REPORT"));
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;
 }
});


test("Desktop installation and offline reconnect sync are configured",async()=>{
 const [app,sync,manifest,pkg,offlineBuilder]=await Promise.all(["src/main.jsx","src/sync.js","public/manifest.webmanifest","package.json","scripts/offline-build.py"].map(p=>readFile(p,"utf8")));
 assert.match(app,/navigator\.serviceWorker\.register\("\/sw\.js"\)/);
 assert.match(app,/beforeinstallprompt/);
 assert.match(app,/sakhelwe_sync_post/);
 assert.match(app,/__table_insert/);
 assert.match(app,/Offline — showing the last synced records/);
 assert.match(sync,/syncSaveWorkspace/);
 assert.match(manifest,/"display": "standalone"/);
 assert.match(pkg,/"build": "vite build && python3 scripts\/offline-build\.py"/);
 assert.match(offlineBuilder,/dist\/sw\.js/);
});