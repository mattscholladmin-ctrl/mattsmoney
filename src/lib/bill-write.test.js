import test from 'node:test';
import assert from 'node:assert/strict';
import { billFields, billSnapshot, checkBillSnapshot, expectBill } from './bill-write.js';
test('bill amounts reject blank, non-finite, negative, zero and fractional cents before any write', () => {
  for (const amount of ['', ' ', null, -1, 0, Infinity, NaN, 'abc', 12.345, 1e308]) assert.throws(() => billFields({amount}));
  assert.deepEqual(billFields({amount:'142.20'}), {amount:142.2});
  assert.deepEqual(billFields({name:' New name '}), {name:'New name'});
});
test('bill comparisons protect unrelated fields and null values from stale writes', () => {
  const bill={name:'Phone',amount:85,category:null,cadence:'monthly',due_day:8};
  const expected=billSnapshot(bill);
  checkBillSnapshot(bill,expected);
  assert.throws(() => checkBillSnapshot({...bill,name:'Changed elsewhere'},expected), /another session/);
  assert.throws(() => checkBillSnapshot(null,expected), /another session/);
  /** @type {any[]} */ const filters=[]; const q={eq(/** @type {string} */ k,/** @type {any} */ v){filters.push([k,v]);return this},is(/** @type {string} */ k,/** @type {any} */ v){filters.push([k,v]);return this}};
  expectBill(q,expected); assert.ok(filters.some(([k,v])=>k==='category' && v===null));
  assert.deepEqual(billFields({amount:90}),{amount:90});
});
