import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceFreshness} from './balance-freshness.js';
test('loading saved data today does not make an old bank balance fresh',()=>{
  const data={accounts:[{id:'a',plaid_account_id:'p',include_in_spendable:true}],balances:[{account_id:'a',as_of:'2026-10-26',created_at:'2026-10-26T21:00:00Z'}],fetchedAt:'2026-10-29T12:00:00Z'};
  assert.equal(balanceFreshness(data,Date.parse(data.fetchedAt))?.stale,true);
  assert.equal(balanceFreshness({...data,bankCheckedAt:data.fetchedAt},Date.parse(data.fetchedAt))?.stale,false);
  assert.equal(balanceFreshness({...data,balances:[]})?.checkedAt,null);
});
