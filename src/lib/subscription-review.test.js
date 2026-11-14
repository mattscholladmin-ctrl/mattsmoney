import assert from 'node:assert/strict'
import test from 'node:test'
import { subscriptionReview } from './subscription-review.js'

test('subscription review distinguishes posted renewals, possible price changes and dues', () => {
  const bills = [
    {id:'music',name:'Example Music',category:'Subscriptions',cadence:'monthly',amount:10,due_day:17},
    {id:'video',name:'Example Video',category:'Subscriptions',cadence:'monthly',amount:15,due_day:12},
    {id:'storage',name:'Example Storage',category:'Subscriptions',cadence:'monthly',amount:8,due_day:18,active:false},
    {id:'utility',name:'Example Electric',category:'Utilities',cadence:'monthly',amount:20,due_day:19},
  ]
  const transactions = [
    {id:'price',merchant:'Example Music',txn_date:'2026-11-13',amount:12},
    {id:'pending',merchant:'Example Music',txn_date:'2026-11-14',amount:10,pending:true},
    {id:'apple',merchant:'Apple',txn_date:'2026-11-12',amount:20,note:'apple-split:video=15,other=5 paid:video@2026-11-12'},
    {id:'one-off',merchant:'Example Music',txn_date:'2026-11-14',amount:13,note:'payment-review:one-off'},
  ]
  const {rows,due} = subscriptionReview(bills,transactions,'2026-11','2026-11-14','2026-11-19')
  assert.deepEqual(rows.map(row=>row.bill.id),['music','video','storage'])
  assert.deepEqual(rows[0].changes.map(change=>change.amount),[12])
  assert.equal(rows[0].renewal,undefined)
  assert.equal(rows[1].renewal?.amount,15)
  assert.deepEqual(due.map(item=>item.originalDate || item.date),['2026-10-17','2026-11-17'])
})
