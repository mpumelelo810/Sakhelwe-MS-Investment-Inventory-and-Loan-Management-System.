import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const components = await readFile(new URL('../src/components.jsx', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../database/migrations/20261017_allow_live_chicken_sales.sql', import.meta.url), 'utf8');

test('chicken sale form offers live/undressed and dressed stock', () => {
  assert.match(components, /Chicken type sold/);
  assert.match(components, /option value="live">Live \/ undressed/);
  assert.match(components, /option value="dressed">Dressed/);
  assert.match(components, /sale_type:p\.sale_type/);
});

test('live and dressed sales are labelled and deducted from the matching stock', () => {
  assert.match(components, /soldLive=chickenSales\.filter\(x=>x\.batch_id===b\.id&&x\.sale_type==="live"\)/);
  assert.match(components, /liveSales=ss\.filter\(x=>x\.sale_type==="live"\)/);
  assert.match(components, /dressedSales=ss\.filter\(x=>x\.sale_type==="dressed"\)/);
  assert.match(components, /x\.sale_type==="live"\?"live\/undressed":"dressed"/);
  assert.match(main, /p_sale_type:x\.sale_type\|\|"live"/);
  assert.match(main, /liveSales=\(d\.chickenSales\|\|\[\]\)\.filter\(v=>v\.batch_id===x\.batch_id&&v\.sale_type==="live"\)/);
  assert.match(main, /remaining=Number\(b\.initial_quantity\)-dead-salesTotal/);
});

test('database sale function validates stock for the chosen type and stores that type', () => {
  assert.match(migration, /p_sale_type not in \('live','dressed'\)/);
  assert.match(migration, /live_available:=greatest\(0,batch\.initial_quantity-deaths-dressed-live_sales\)/);
  assert.match(migration, /dressed_available:=greatest\(0,dressed-dressed_sales\)/);
  assert.match(migration, /if p_sale_type='live' then/);
  assert.match(migration, /p_sale_type,p_quantity,null/);
  assert.match(migration, /'sale_type',p_sale_type/);
});
