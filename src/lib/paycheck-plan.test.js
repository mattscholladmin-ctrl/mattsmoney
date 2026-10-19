// @ts-nocheck
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computePaycheckPlan, checkingBalance } from './paycheck-plan.js'
import { accountSummaries, moneyTotals, isBillOccurrencePaid, unpaidBills } from './budget.js'
import { computeProduct } from './dw-product.js'

const today = '2026-10-18'
const account = { id: 'cash', name: 'Checking', kind: 'spending', include_in_spendable: true }
const income = [{ name: 'Salary', amount: 2000, cadence: 'biweekly', anchor_date: '2026-10-09', confirmed: true }]
function data(overrides = {}) {
  return { accounts: [account], balances: [{ account_id: 'cash', balance: 2000, as_of: today }], income, transactions: [], ...overrides }
}
const calculate = (d, state) => computePaycheckPlan({ data: d, state, todayIso: today })

describe('cash-first paycheck plan', () => {
  it('reserves buffer, saved goals, set-asides and remaining everyday budgets', () => {
    const p = calculate(data({ settings: { buffer_floor: 100 }, goals: [{ id: 'trip', target: 1000, current: 200 }], setAsides: [{ amount: 50 }], budgets: [{ category: 'Groceries', monthly_limit: 260 }] }))
    assert.equal(p.info.floor, 100)
    assert.equal(p.info.earmarked, 200)
    assert.equal(p.info.everyday, 120)
    assert.equal(p.safeToSpend, 1530)
    assert.equal(p.daysLeft, 5)
  })
  it('never adds a received variable deposit a second time', () => {
    const d = data({ transactions: [{ id: 'bonus', txn_date: today, merchant: 'Bonus', amount: -500 }] })
    assert.equal(calculate(d, { extraId: 'bonus' }).safeToSpend, 2000)
  })
  it('honors excluded and hidden accounts even when they have cash', () => {
    const d = data({ accounts: [account, { id: 'other', kind: 'savings', include_in_spendable: false }, { id: 'hidden', kind: 'spending', hidden: true }], balances: [{ account_id: 'cash', balance: 2000, as_of: today }, { account_id: 'other', balance: 9000, as_of: today }, { account_id: 'hidden', balance: 3000, as_of: today }] })
    assert.equal(checkingBalance(d), 2000)
  })
  it('does not reserve savings in an excluded account twice', () => {
    const d = data({ accounts: [account, { id: 'savings', kind: 'savings', include_in_spendable: false }], goals: [{ id: 'trip', account_id: 'savings', current: 200, target: 1000 }] })
    assert.equal(calculate(d).info.earmarked, 0)
  })
  it('caps contributions at the goal remainder and honors its plan switch', () => {
    const d = data({ goals: [{ id: 'goal', name: 'Trip', status: 'active', target: 100, current: 95, monthly_contribution: 260 }] })
    assert.equal(calculate(d).info.goalReserve, 5)
    assert.equal(calculate(d, { planOff: { 'g-goal': true } }).info.goalReserve, 0)
    assert.equal(calculate(d, { planOff: { 'g-goal': true } }).info.earmarked, 95)
  })
  it('reserves a debt due before payday in full, without adding its regular share again', () => {
    const d = data({ debts: [{ id: 'loan', name: 'Loan', balance: 5000, plan_payment: 600, due_day: 20, start_date: '2026-10-20' }] })
    assert.equal(calculate(d).debtReserve, 600)
    assert.equal(calculate(d).safeToSpend, 1400)
    assert.equal(calculate(d, { planOff: { 'd-loan': true } }).debtReserve, 0)
  })
  it('uses no more than the final debt balance', () => {
    const d = data({ debts: [{ id: 'loan', name: 'Loan', balance: 80, plan_payment: 600, due_day: 20, start_date: '2026-10-20' }] })
    assert.equal(calculate(d).debtReserve, 80)
  })
  it('allows negative safe to spend so a shortage remains visible', () => {
    assert.equal(calculate(data({ settings: { buffer_floor: 2500 } })).safeToSpend, -500)
  })
  it('uses the same cash definition in spending insights regardless of wants percentage', () => {
    const d = data()
    const a = computeProduct({ data: d, state: { plan: { wants: 1 } }, month: '2026-10' })
    const b = computeProduct({ data: d, state: { plan: { wants: 99 } }, month: '2026-10' })
    assert.equal(a.safeToSpend, b.safeToSpend)
    assert.equal(a.safeToSpend, 2000)
  })
})

describe('available cash and bill occurrences', () => {
  it('reports a missing available balance instead of using bank current', () => {
    const entries = [{ account_id: 'cash', balance: 800, as_of: today, note: 'Auto-synced · available missing · current $800.00' }]
    assert.equal(accountSummaries([account], entries)[0].balance, null)
    assert.equal(moneyTotals([account], entries).spendableCash, 0)
  })
  it('does not use a linked current-only entry as available', () => {
    const d = data({ accounts: [{ ...account, plaid_account_id: 'linked' }] })
    assert.equal(checkingBalance(d), 0)
  })
  it('picks the latest same-day entry and uses explicit available over current', () => {
    const d = data({ balances: [{ account_id: 'cash', balance: 2000, as_of: today, created_at: '2026-10-18T01:00:00Z' }, { account_id: 'cash', available: 450, current_balance: 700, as_of: today, created_at: '2026-10-18T02:00:00Z' }] })
    assert.equal(checkingBalance(d), 450)
  })
  it('a dated payment marker cannot pay the next weekly cycle', () => {
    const tx = [{ txn_date: '2026-10-14', merchant: 'Weekly Service', amount: 20, note: 'paid:weekly@2026-10-14' }]
    assert.equal(isBillOccurrencePaid({ billId: 'weekly', date: '2026-10-14', name: 'Weekly Service', amount: 20 }, tx, today), true)
    assert.equal(isBillOccurrencePaid({ billId: 'weekly', date: '2026-10-21', name: 'Weekly Service', amount: 20 }, tx, today), false)
  })
  it('partial payments keep the remaining amount late and retain their original due date', () => {
    const bills = [{ id: 'b', name: 'Bill', cadence: 'monthly', due_day: 15, start_date: '2026-10-15', amount: 100, partial_for: '2026-10-15', partial_paid: 40 }]
    const overdue = unpaidBills(bills, [], today, 30).find((b) => b.overdue)
    assert.equal(overdue.amount, 60)
    assert.equal(overdue.originalDate, '2026-10-15')
  })
})
