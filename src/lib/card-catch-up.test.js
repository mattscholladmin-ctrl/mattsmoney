// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import {catchUpSchedule,validateCatchUpPlan,validatePlanPayment,planMonth} from './card-catch-up.js'
import {computePaycheckPlan} from './paycheck-plan.js'
import {forecastCash} from './planning.js'
const venture={id:'v',name:'Example Card A',kind:'card',active:true,balance:500.00,min_payment:200,plan_payment:0,due_day:17,apr:25.00,catch_up_plan:{amount:80,first_due:'2027-03-17',count:3,source:'Synthetic provider confirmation'}}
const quick={...venture,id:'q',name:'Example Card B',balance:850.00,min_payment:210,due_day:2,apr:26.00,catch_up_plan:{...venture.catch_up_plan,amount:100,first_due:'2027-04-02'}}
const income=[{name:'Pay',amount:2000,cadence:'biweekly',anchor_date:'2027-03-20',confirmed:true}]
test('exact three-payment schedules preserve full card balances and normal APRs',()=>{
 const v=catchUpSchedule(venture,'2027-03-10'),q=catchUpSchedule(quick,'2027-03-10')
 assert.deepEqual(v.installments.map(p=>p.due),['2027-03-17','2027-04-17','2027-05-17'])
 assert.deepEqual(q.installments.map(p=>p.due),['2027-04-02','2027-05-02','2027-06-02'])
 assert.equal(v.monthly,80);assert.equal(q.monthly,100);assert.equal(v.completed,0)
 assert.equal(venture.balance,500.00);assert.equal(venture.apr,25.00)
 assert.equal(planMonth('2026-01-31',1),'2026-02-28');assert.equal(planMonth('2028-01-31',1),'2028-02-29')
})
test('paycheck plan replaces the 200 and 210 statement minimums instead of adding them',()=>{
 const p=computePaycheckPlan({data:{debts:[venture,quick],income},todayIso:'2027-03-10'})
 assert.equal(p.planRows.find(r=>r.id==='d-v').share,80)
 assert.equal(p.planRows.find(r=>r.id==='d-q').share,46.15)
 assert.equal(p.planRows.length,2)
 const noIncome=computePaycheckPlan({data:{debts:[venture,quick]},todayIso:'2027-03-10'})
 assert.equal(noIncome.debtReserve,180)
})
test('forecast includes only agreed payments during the plan and then flags regular minimum estimates',()=>{
 const r=forecastCash({today:'2027-03-10',horizon:90,data:{debts:[venture,quick],income:[]}})
 const events=r.points.flatMap(p=>p.entries).filter(e=>e.kind==='bill')
 assert.deepEqual(events.filter(e=>e.name.includes('Example Card A')).map(e=>e.delta),[-80,-80,-80])
 assert.deepEqual(events.filter(e=>e.name.includes('Example Card B')).map(e=>e.delta),[-100,-100,-100])
 const after=catchUpSchedule(venture,'2027-05-18',[],60)
 assert.equal(after.needsMinimumReview,true);assert.equal(after.installments.filter(p=>p.remaining>0).length,3)
 assert.ok(after.items.some(p=>p.originalDate==='2027-06-17' && !p.temporary && p.estimated))
 assert.equal(after.items.filter(p=>p.temporary).length,3)
})
test('only explicitly allocated completed payments count; partials sum and missed installments stay overdue',()=>{
 const payments=[{debt_id:'v',amount:40,paid_on:'2027-03-17',note:'catch-up:2027-03-17'},{debt_id:'v',amount:40,paid_on:'2027-03-18',note:'catch-up:2027-03-17'},{debt_id:'v',amount:80,paid_on:'2027-05-17',note:'catch-up:2027-05-17'},{debt_id:'q',amount:80,paid_on:'2027-04-17',note:'catch-up:2027-04-17'},{debt_id:'v',amount:80,paid_on:'2027-04-17',note:'extra payment'}]
 const s=catchUpSchedule(venture,'2027-04-20',payments)
 assert.equal(s.completed,1);assert.equal(s.installments[1].remaining,80);assert.equal(s.installments[2].remaining,80)
 assert.equal(s.next_due,'2027-04-17');assert.equal(s.status,'late')
 assert.equal(catchUpSchedule(venture,'2027-07-01',payments).installments[1].remaining,80)
 assert.throws(()=>validatePlanPayment(venture,'2027-03-17',1,payments))
 assert.throws(()=>validatePlanPayment(venture,'2027-04-02',80,[]))
 validatePlanPayment(venture,'2027-04-17',80,payments)
})
test('completing the plan retains the card and remaining balance, with a statement review rather than payoff',()=>{
 const pays=[0,1,2].map(i=>({debt_id:'v',amount:80,paid_on:planMonth('2027-03-17',i),note:`catch-up:${planMonth('2027-03-17',i)}`}))
 const s=catchUpSchedule({...venture,balance:260.00},'2027-05-18',pays)
 assert.equal(s.completed,3);assert.equal(s.needsMinimumReview,true);assert.equal(s.next_due,'2027-06-17')
 assert.equal(s.items.some(p=>p.temporary),false)
 const verified=catchUpSchedule({...venture,min_payment:25,catch_up_plan:{...venture.catch_up_plan,regular_minimum_verified_on:'2027-05-18'}},'2027-05-18',pays)
 assert.equal(verified.needsMinimumReview,false);assert.equal(verified.monthly,25)
 assert.equal(verified.items.find(p=>!p.temporary).estimated,false)
 const future=catchUpSchedule({...venture,catch_up_plan:{...venture.catch_up_plan,regular_minimum_verified_on:'2027-07-01'}},'2027-05-18',pays)
 assert.equal(future.needsMinimumReview,true)
 const regularPartial=catchUpSchedule({...venture,due_day:14},'2027-06-15',[...pays,{debt_id:'v',amount:30,paid_on:'2027-06-14',note:null}])
 assert.equal(regularPartial.items.find(p=>p.originalDate==='2027-06-14').amount,170)
})
test('invalid plan values and invalid payment allocations are rejected',()=>{
 for(const patch of [{amount:0},{amount:80.001},{count:0},{count:61},{count:2.5},{first_due:'2026-02-30'},{source:''},{regular_minimum_verified_on:'wrong'}]) assert.throws(()=>validateCatchUpPlan({...venture.catch_up_plan,...patch}))
 for(const n of [-1,0,81,NaN,Infinity,0.001])assert.throws(()=>validatePlanPayment(venture,'2027-03-17',n))
 assert.equal(validateCatchUpPlan(null),null)
})
