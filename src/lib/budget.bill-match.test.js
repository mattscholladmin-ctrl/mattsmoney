import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { suggestBillPayment, rejectKey, isBillOccurrencePaid, uniqueBillForCharge, unpaidBills, isPendingPostedTwin, rememberedAppleSplit } from './budget.js'

const youtube = { billId: 'yt', name: 'YouTube Premium', amount: 11.99, date: '2026-08-08' }

describe('bill payment matcher', () => {
  it('does not match a nearby-dollar coffee charge', () => {
    const txns = [{ id: 'c', merchant: 'Veya Coffee Bar', amount: 12.17, txn_date: '2026-09-05' }]
    assert.equal(suggestBillPayment(youtube, txns, '2026-09-06'), null)
  })

  it('does not treat every Apple charge as YouTube', () => {
    const txns = [{ id: 'a', merchant: 'APPLE.COM/BILL', amount: 11.99, txn_date: '2026-08-08' }]
    assert.equal(suggestBillPayment(youtube, txns, '2026-09-06'), null)
  })

  it('matches an Apple charge only when one bill has that amount', () => {
    const icloud = { id: 'ic', name: 'iCloud', amount: 2.99, active: true }
    const yt = { id: 'yt', name: 'YouTube Premium', amount: 11.99, active: true }
    const other = { id: 'o', name: 'Other', amount: 11.99, active: true }
    assert.equal(uniqueBillForCharge([icloud, yt], 11.99).id, 'yt')
    assert.equal(uniqueBillForCharge([yt, other], 11.99), null)
  })

  it('keeps the rest of a partial payment and does not call a smaller charge paid in full', () => {
    const bill = { id: 'ins', name: 'Progressive', amount: 138, due_day: 1, cadence: 'monthly', active: true, partial_paid: 69, partial_for: '2026-10-01' }
    const owed = unpaidBills([bill], [], '2026-10-02', 40)
    const row = owed.find((b) => b.billId === 'ins')
    assert.equal(row.amount, 69)
    assert.equal(row.fullAmount, 138)
    const half = [{ id: 'p', merchant: 'Progressive', amount: 69, txn_date: '2026-10-02' }]
    assert.equal(isBillOccurrencePaid({ ...row, date: '2026-10-01' }, half, '2026-10-02'), false)
  })

  it('does not delete two posted charges', () => {
    const a = { merchant: 'Apple', amount: 9.99, txn_date: '2026-10-01', pending: false, category: 'Bills' }
    const b = { merchant: 'Apple', amount: 9.99, txn_date: '2026-10-03', pending: false, category: 'Shopping' }
    assert.equal(isPendingPostedTwin(a, b), false)
    assert.equal(isPendingPostedTwin({ ...a, pending: true }, b), true)
  })

  it('remembers a saved Apple split for the same total', () => {
    const txns = [{ id: 'a', merchant: 'APPLE.COM/BILL', amount: 14.98, txn_date: '2026-09-01', note: 'apple-split:yt=11.99,ic=2.99' }]
    const rule = rememberedAppleSplit(txns, 14.98)
    assert.deepEqual(rule.parts, [{ id: 'yt', amount: 11.99 }, { id: 'ic', amount: 2.99 }])
  })

  it('does not rematch a rejected pair', () => {
    const txns = [{ id: 'a', merchant: 'APPLE.COM/BILL', amount: 11.99, txn_date: '2026-08-08' }]
    const rejected = [rejectKey('yt', 'a')]
    assert.equal(suggestBillPayment(youtube, txns, '2026-09-06', rejected), null)
  })

  it('does not match same merchant at a different plan amount', () => {
    const star = { billId: 'sl', name: 'Starlink', amount: 26.5, date: '2026-08-28' }
    const txns = [{ id: 's', merchant: 'Starlink', amount: 97.42, txn_date: '2026-08-29' }]
    assert.equal(suggestBillPayment(star, txns, '2026-09-06'), null)
  })
})

describe('amazon prime payment', () => {
  it('counts a same-day Amazon charge as Prime paid', () => {
    const occ = { billId: 'ap', name: 'Amazon Prime', amount: 16.32, date: '2026-09-17' }
    const txns = [{ id: 'a', merchant: 'Amazon', amount: 16.32, txn_date: '2026-09-17' }]
    assert.equal(isBillOccurrencePaid(occ, txns, '2026-09-17'), true)
  })
})
