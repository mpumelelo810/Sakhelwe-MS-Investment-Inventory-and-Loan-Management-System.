import {test} from 'node:test';import assert from 'node:assert/strict';import {demo,totals,today,csv,interest} from '../src/model.js';
test('demo separates sales, cash, debt and profit',()=>{const s=demo(),t=totals(s,today().slice(0,7));assert.equal(t.revenue,4460);assert.equal(t.cash,7510);assert.equal(t.debt,800);assert.equal(t.profit,1230);assert.equal(t.inventory,7920)});
test('CSV protects formula-like customer descriptions',()=>{assert.match(csv([['=HYPERLINK("bad")']]),/"'=HYPERLINK/);assert.match(csv([['a"b']]),/a""b/)});
test('daily interest uses actual elapsed days and cents rounding',()=>{assert.equal(interest({principal:1000,annual_rate:.365,accrued_through:'2026-01-01'},'2026-01-11'),10)});
