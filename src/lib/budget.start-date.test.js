import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { obligationSchedule, debtsAsBills, unpaidBills, spendableToday, paydayCount } from './budget.js'

const loan = {
  id: 'friend',
  name: 'Friend Loan',
  kind: 'loan',
  balance: 20000,
  min_payment: 750,
  plan_payment: 750,
  due_day: 1,
  start_date: '2026-10-01',
  active: true,
}

const smr = {
  name: 'Summit Mountain Rentals',
  amount: 1691.55,
  cadence: 'biweekly',
  confirmed: true,
  anchor_date: '2026-06-18',
  active: true,
}

describe('obligation start_date', () => {
  it('Sep 6: pre_start, next_due Oct 1, not late', () => {
    const s = obligationSchedule(loan, '2026-09-06')
    assert.equal(s.status, 'pre_start')
    assert.equal(s.next_due, '2026-10-01')
  })

  it('Oct 1: live, next_due Oct 1', () => {
    const s = obligationSchedule(loan, '2026-10-01')
    assert.equal(s.status, 'due')
    assert.equal(s.next_due, '2026-10-01')
  })

  it('Oct 2 unpaid: late against Oct 1', () => {
    const s = obligationSchedule(loan, '2026-10-02')
    assert.equal(s.status, 'late')
    assert.equal(s.next_due, '2026-10-01')
  })

  it('Nov 1 paid Oct: next_due Nov 1, not late', () => {
    const s = obligationSchedule(loan, '2026-11-01', { paidDates: ['2026-10-01'] })
    assert.equal(s.status, 'due')
    assert.equal(s.next_due, '2026-11-01')
  })

  it('null start_date keeps current due_day behavior', () => {
    const s = obligationSchedule({ due_day: 1, plan_payment: 750 }, '2026-09-06')
    assert.equal(s.status, 'due')
    assert.equal(s.next_due, '2026-10-01')
  })

  it('weekly bill next_due is the next weekday, not next month', () => {
    const s = obligationSchedule({ name: 'Hinge+', amount: 19.99, cadence: 'weekly', due_day: 3 }, '2026-09-06')
    assert.equal(s.next_due, '2026-09-09')
  })

  it('Sep 6 hold is dated Oct 1 and is not late', () => {
    const asBills = debtsAsBills([loan])
    const unpaid = unpaidBills(asBills, [], '2026-09-06', 30)
    const hold = unpaid.find((u) => u.preStart)
    assert.ok(hold)
    assert.equal(hold.date, '2026-10-01')
    assert.ok(!unpaid.some((u) => u.overdue))
  })

  it('overdue goal covers the missed cycle so the bill is not held twice', () => {
    const verizon = { id: 'vz', name: 'Verizon', amount: 280, cadence: 'monthly', due_day: 1, active: true }
    const goals = [{ name: 'Overdue — Verizon Aug bill', status: 'active', reserved: true, target: 313.68 }]
    const unpaid = unpaidBills([verizon], [], '2026-09-06', 30, goals)
    assert.ok(!unpaid.some((u) => u.overdue && String(u.name).includes('Verizon')))
  })
})

describe('paycheck-share safe to spend', () => {
  it('two SMR paydays remain between Sep 6 and Oct 1', () => {
    assert.equal(paydayCount([smr], '2026-09-06', '2026-10-01', []), 2)
  })

  it('Sep 6: later Oct 1 loan takes a share, not the full $750', () => {
    const asBills = debtsAsBills([loan])
    const info = spendableToday(10000, {
      bills: asBills,
      incomes: [smr],
      fromIso: '2026-09-06',
      bufferFloor: 0,
      transactions: [],
    })
    assert.equal(info.billsBeforePay, 0)
    assert.equal(info.laterShare, 375)
    assert.ok(info.laterItems.some((x) => x.name.includes('Friend') && x.share === 375))
  })

  it('Sep 6: bill due before next paycheck is held in full', () => {
    const hinge = { id: 'h', name: 'Hinge+', amount: 19.99, cadence: 'monthly', due_day: 9, start_date: '2026-08-09', active: true }
    const info = spendableToday(10000, {
      bills: [hinge],
      incomes: [smr],
      fromIso: '2026-09-06',
      bufferFloor: 0,
      transactions: [{ merchant: 'Hinge+', amount: 19.99, txn_date: '2026-08-09' }],
    })
    assert.equal(info.billsBeforePay, 19.99)
    assert.equal(info.laterShare, 0)
  })
})
