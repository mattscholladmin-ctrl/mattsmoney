// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import { forecastCash, estimatePayoff, nextDebtDate } from './planning.js'
const today='2026-10-01'
const data=(extra={})=>({accounts:[{id:'cash',name:'Cash',kind:'spending',include_in_spendable:true}],balances:[{account_id:'cash',balance:1000,as_of:today}],transactions:[],income:[],...extra})
test('forecast excludes unconfirmed pay, protects cash, and includes no invented spending',()=>{
 const r=forecastCash({today,data:data({income:[{name:'Maybe',amount:5000,confirmed:false,cadence:'monthly',due_day:10}],settings:{buffer_floor:100},setAsides:[{amount:50}]})})
 assert.equal(r.opening,850);assert.equal(r.ending,850);assert.equal(r.expectedIncome,0)
})
test('forecast retains every recurrence after a future first date and honors partial payments',()=>{
 const r=forecastCash({today,horizon:90,data:data({bills:[{id:'rent',name:'Rent',amount:100,cadence:'monthly',due_day:15,start_date:'2026-10-15',partial_for:'2026-10-15',partial_paid:20}]})})
 assert.equal(r.ending,720)
 assert.deepEqual(r.points.flatMap(p=>p.entries).filter(e=>e.kind==='bill').map(e=>e.delta),[-80,-100,-100])
})
test('forecast flags same-day shortfalls before assuming a paycheck posts',()=>{
 const r=forecastCash({today,data:data({balances:[{account_id:'cash',balance:50,as_of:today}],income:[{name:'Pay',amount:1000,cadence:'monthly',due_day:2,confirmed:true}],bills:[{id:'bill',name:'Bill',amount:100,cadence:'monthly',due_day:2,start_date:'2026-10-02'}]}),horizon:2})
 assert.equal(r.firstShortfall,'2026-10-02');assert.equal(r.ending,950);assert.equal(r.lowest,-50)
})
test('forecast debt payments stop at remaining balance and optional switches are honored',()=>{
 const d=data({debts:[{id:'loan',name:'Loan',balance:120,plan_payment:100,due_day:15,start_date:'2026-10-15'}]})
 assert.equal(forecastCash({today,data:d}).ending,880)
 assert.equal(forecastCash({today,data:d,state:{planOff:{'d-loan':true}}}).ending,1000)
})
test('daily assumptions and missing available balances are explicit',()=>{
 const r=forecastCash({today,horizon:10,dailySpend:10,data:data({accounts:[{id:'cash',name:'Bank',kind:'spending',include_in_spendable:true,plaid_account_id:'x'}]})})
 assert.equal(r.ending,-100);assert.deepEqual(r.missing,['Bank'])
})
test('payoff handles zero interest, extra payments, missing APR and impossible payments',()=>{
 assert.equal(estimatePayoff({balance:1000,payment:100,apr:0,today}).months,10)
 assert.equal(estimatePayoff({balance:1000,payment:100,extraMonthly:100,apr:0,today}).months,5)
 assert.equal(estimatePayoff({balance:1000,payment:1,apr:12,today}).paidOff,false)
 assert.equal(estimatePayoff({balance:1000,payment:100,today}).unknownApr,true)
 assert.equal(estimatePayoff({balance:1000,payment:100,extraNow:2000,apr:12,today,firstDate:'2026-12-01'}).date,today)
 assert.equal(estimatePayoff({balance:1000,payment:100,apr:NaN}),null)
})
test('interest comparisons decrease with extra principal without mutating inputs',()=>{
 const input={balance:5000,payment:200,apr:18,today}
 const base=estimatePayoff(input), extra=estimatePayoff({...input,extraMonthly:50})
 assert.ok(extra.months<base.months);assert.ok(extra.interest<base.interest);assert.equal(input.balance,5000)
})

test('weekly payoff uses scheduled weeks and monthly extra is converted to weekly',()=>{
 const input={balance:1000,payment:100,apr:0,today,firstDate:'2026-10-02',frequency:'weekly'}
 assert.equal(estimatePayoff(input).periods,10)
 assert.equal(estimatePayoff(input).date,'2026-12-04')
 assert.equal(estimatePayoff({...input,extraMonthly:1300/3}).periods,5)
})
test('next debt date advances recurring anchors and clamps month-end dates',()=>{
 assert.equal(nextDebtDate({pay_frequency:'weekly',next_payment_date:'2026-09-25'},today),'2026-10-02')
 assert.equal(nextDebtDate({due_day:31},'2026-02-01'),'2026-02-28')
 assert.equal(nextDebtDate({start_date:'2027-01-15',due_day:15},today),'2027-01-15')
})
