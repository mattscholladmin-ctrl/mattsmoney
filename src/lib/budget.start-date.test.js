import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { obligationSchedule, debtsAsBills, unpaidBills, spendableToday } from './budget.js'

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

  it('Sep 6 unpaid list is not overdue and holds $750', () => {
    const asBills = debtsAsBills([loan])
    const unpaid = unpaidBills(asBills, [], '2026-09-06', 30)
    assert.ok(unpaid.some((u) => u.preStart && u.originalDate === '2026-10-01'))
    assert.ok(!unpaid.some((u) => u.overdue))
    const info = spendableToday(10000, {
      bills: asBills,
      fromIso: '2026-09-06',
      bufferFloor: 0,
      transactions: [],
    })
    assert.equal(info.billsBeforePay, 750)
  })
})
