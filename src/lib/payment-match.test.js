// @ts-nocheck

import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDemoPaymentMatch, paymentSnapshot, paymentSuggestions } from './payment-match.js'
import { unpaidBills } from './budget.js'
import { catchUpSchedule } from './card-catch-up.js'

const today='2026-11-20'
const tx=(id,merchant,amount,extra={})=>({id,merchant,amount,txn_date:'2026-11-19',source:'plaid',pending:false,...extra})
const bill={id:'b',name:'Example Telecom',amount:100,cadence:'monthly',due_day:19,active:true}
const card={id:'c',name:'Example Card 1234',kind:'card',balance:500,catch_up_plan:{first_due:'2026-11-19',amount:90,count:3,source:'Example confirmation'}}
function confirm(data, id, kind) {
  const {txn,options}=paymentSuggestions(data,today).find(x=>x.txn.id===id)
  const option=options.find(o=>o.kind===kind)
  const payload={p_transaction_id:id,p_expected_transaction:paymentSnapshot(txn),
    p_target:{kind,id:option.id,due:option.due,remaining:option.remaining,as_of:option.asOf || null}}
  const saved=applyDemoPaymentMatch(data,payload,today)
  assert.equal(applyDemoPaymentMatch(saved,payload,today),saved)
  return saved
}

test('bank matching confirms partial then full bill without claiming other dates',()=>{
  let data={transactions:[tx('a','Example Telecom',35),tx('b','Example Telecom',65)],bills:[bill]}
  data=confirm(data,'a','bill')
  assert.equal(unpaidBills(data.bills,data.transactions,today,40).find(o=>o.originalDate==='2026-11-19')?.amount,65)
  data=confirm(data,'b','bill')
  const due=unpaidBills(data.bills,data.transactions,today,40)
  assert.equal(due.some(o=>(o.originalDate || o.date)==='2026-11-19'),false)
  assert.equal(due.some(o=>o.date==='2026-12-19'),true)
  assert.deepEqual(paymentSuggestions(data,today),[])
})

test('bank matching uses only posted unused transactions and excludes ambiguous statement history',()=>{
  const balances=[{...bill,outstanding_amount:200,outstanding_as_of:'2026-11-18',outstanding_through:'2026-10-19',outstanding_due_date:'2026-10-19',outstanding_note:'Example statement'}]
  let data={transactions:[tx('a','Example Telecom',100),tx('p','Example Telecom',100,{pending:true}),tx('m','Example Telecom',100,{source:'manual'}),tx('old','Example Telecom',150,{txn_date:'2026-11-18'}),tx('used','Example Telecom',100,{note:'paid:b'})],bills:balances}
  assert.deepEqual(paymentSuggestions(data,today).map(x=>x.txn.id),['a'])
  data=confirm(data,'a','balance')
  assert.equal(data.bills[0].outstanding_amount,100)
  assert.equal(data.bills[0].outstanding_as_of,'2026-11-18')
})

test('card installments accept multiple identified partial payments, guard manual duplicates and honor suffixes',()=>{
  let data={transactions:[tx('a','Example Card 1234',45),tx('b','Example Card 1234',45),tx('other','Example Card 9999',45)],bills:[],debts:[card],debtPayments:[]}
  assert.equal(paymentSuggestions({...data,debtPayments:[{id:'manual',debt_id:'c',amount:45,paid_on:'2026-11-18'}]},today).length,0)
  data=confirm(data,'a','card')
  data=confirm(data,'b','card')
  assert.equal(data.debts[0].balance,410)
  assert.equal(data.debtPayments.length,2)
  assert.equal(catchUpSchedule(data.debts[0],today,data.debtPayments).completed,1)
  assert.deepEqual(paymentSuggestions(data,today),[])
})
