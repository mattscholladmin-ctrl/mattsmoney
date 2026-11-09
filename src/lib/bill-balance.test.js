// @ts-nocheck — fixtures exercise optional persisted fields absent from legacy inference.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unpaidBills, spendableToday, isBillOccurrencePaid, suggestBillPayment } from './budget.js'
import { billFields, billSnapshot, checkBillSnapshot } from './bill-write.js'
import { balancePayment } from './bill-balance.js'
import { forecastCash } from './planning.js'
const storage={id:'storage',name:'Silver Rush Storage',amount:179,cadence:'monthly',due_day:1,active:true,
  outstanding_amount:716,outstanding_through:'2026-11-01',outstanding_due_date:'2026-08-01',outstanding_as_of:'2026-11-09',outstanding_note:'Four unpaid months after July payment; excludes unconfirmed fees.',outstanding_estimated:true}
test('snapshot replaces included months and holds all 716 rather than one 179',()=>{
 const rows=unpaidBills([storage],[],'2026-11-09',30)
 assert.equal(rows.filter(r=>r.overdue).reduce((n,r)=>n+r.amount,0),716)
 assert.equal(rows.filter(r=>r.date==='2026-12-01').length,1)
 assert.equal(rows.reduce((n,r)=>n+r.amount,0),895)
 const plan=spendableToday(1000,{bills:[storage],fromIso:'2026-11-09',incomes:[{name:'Pay',amount:1000,cadence:'biweekly',anchor_date:'2026-11-19',active:true}]})
 assert.equal(plan.billsBeforePay,716)
 assert.equal(plan.windowItems[0].estimated,true)
 assert.equal(plan.windowItems[0].outstandingBalance,true)
})
test('new cycles accumulate after the snapshot, including longer than one year',()=>{
 const rows=unpaidBills([storage],[],'2028-02-09',0)
 assert.equal(rows.reduce((n,r)=>n+r.amount,0),716+15*179)
})
test('the due-today cycle is counted once along with the older balance',()=>{
 const rows=unpaidBills([storage],[],'2026-12-01',0)
 assert.equal(rows.length,2); assert.equal(rows.reduce((n,r)=>n+r.amount,0),895)
 const included=unpaidBills([{...storage,outstanding_as_of:'2026-11-01'}],[],'2026-11-01',0)
 assert.equal(included.length,1);assert.equal(included[0].amount,716)
})
test('old markers, pending charges and guessed matches cannot settle a statement balance',()=>{
 const txns=[{id:'old',merchant:'Silver Rush Storage',txn_date:'2026-11-08',amount:716,pending:false,note:'paid:storage@2026-08-01'}]
 const row=unpaidBills([{...storage,paid_through:'2026-11-01'}],txns,'2026-11-09',0)[0]
 assert.equal(row.amount,716)
 assert.equal(isBillOccurrencePaid(row,txns,'2026-11-09'),false)
 assert.equal(suggestBillPayment(row,txns,'2026-11-09'),null)
 assert.equal(unpaidBills([storage],txns.map(t=>({...t,pending:true})),'2026-11-09',0)[0].amount,716)
})
test('partial and final payments reduce balance without changing recurring amount or adding expenses',()=>{
 const partial={...storage,...balancePayment(storage,100,'2026-11-10')}
 assert.equal(partial.outstanding_amount,616);assert.equal(partial.amount,179)
 assert.equal(unpaidBills([partial],[],'2026-11-10',0)[0].amount,616)
 const settled={...partial,...balancePayment(partial,616,'2026-11-11')}
 assert.equal(unpaidBills([settled],[],'2026-11-11',30).filter(r=>r.overdue).length,0)
 assert.equal(unpaidBills([settled],[],'2026-12-02',0)[0].amount,179)
 for(const n of [0,-1,717,1.001,NaN,Infinity]) assert.throws(()=>balancePayment(storage,n,'2026-11-10'))
 assert.throws(()=>checkBillSnapshot(partial,billSnapshot(storage)),/another session/)
})
test('snapshots are date bound, ignored for inactive bills, and do not disturb legacy partials',()=>{
 assert.equal(unpaidBills([{...storage,active:false}],[],'2026-11-09',40).length,0)
 assert.equal(unpaidBills([storage],[],'2026-11-08',0)[0].amount,179)
 const legacy={id:'phone',name:'Phone',amount:200,cadence:'monthly',due_day:1,partial_paid:50,partial_for:'2026-11-01'}
 assert.equal(unpaidBills([legacy],[],'2026-11-09',0)[0].amount,150)
})
test('forecast counts balance and future bill once each, including a cycle due today',()=>{
 for(const today of ['2026-11-09','2026-12-01']) {
 const f=forecastCash({data:{bills:[storage],accounts:[],transactions:[]},today,horizon:30})
 const events=f.points.flatMap(p=>p.entries).filter(e=>e.kind==='bill')
 assert.equal(events.reduce((n,e)=>n-e.delta,0),895)
 }
})
test('balance metadata validates as a complete unit and permits settled zero',()=>{
 const fields=Object.fromEntries(Object.entries(storage).filter(([k])=>k.startsWith('outstanding_')))
 assert.equal(billFields(fields).outstanding_amount,716)
 assert.equal(billFields({...fields,outstanding_amount:0}).outstanding_amount,0)
 for(const patch of [{outstanding_amount:-1},{outstanding_amount:1.111},{outstanding_amount:''},{outstanding_amount:null},{outstanding_as_of:'2026-02-31'},{outstanding_due_date:'2026-12-01'},{outstanding_note:''},{outstanding_estimated:'true'}]) assert.throws(()=>billFields({...fields,...patch}))
 assert.throws(()=>billFields({outstanding_amount:200}))
})
