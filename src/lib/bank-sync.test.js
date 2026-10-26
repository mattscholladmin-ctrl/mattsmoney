// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import {syncBankItems} from './bank-sync.js'
test('one failing connection does not hide another successful sync',async()=>{
 const result=await syncBankItems([{item_id:'bad'},{item_id:'good'}],async i=>{if(i.item_id==='bad')throw {response:{data:{error_code:'ITEM_LOGIN_REQUIRED'}}}},async()=>({ready:true}))
 assert.equal(result.ok,false);assert.equal(result.synced,1);assert.equal(result.results[0].needs_repair,true);assert.equal(result.results[1].transactions,true)
})
test('transaction failure cannot masquerade as a successful connection refresh',async()=>{
 const result=await syncBankItems([{item_id:'x'}],async()=>{},async()=>({ready:false,error_code:'ITEM_LOGIN_REQUIRED'}))
 assert.equal(result.synced,0);assert.equal(result.results[0].balances,true);assert.equal(result.results[0].transactions,false);assert.equal(result.results[0].needs_repair,true)
})
