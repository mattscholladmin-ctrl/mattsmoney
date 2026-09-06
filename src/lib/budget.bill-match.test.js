import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { suggestBillPayment, rejectKey } from './budget.js'

const youtube = { billId: 'yt', name: 'YouTube Premium', amount: 11.99, date: '2026-08-08' }

describe('bill payment matcher', () => {
  it('does not match a nearby-dollar coffee charge', () => {
    const txns = [{ id: 'c', merchant: 'Veya Coffee Bar', amount: 12.17, txn_date: '2026-09-05' }]
    assert.equal(suggestBillPayment(youtube, txns, '2026-09-06'), null)
  })

  it('matches Apple.com/bill for YouTube', () => {
    const txns = [{ id: 'a', merchant: 'APPLE.COM/BILL', amount: 11.99, txn_date: '2026-08-08' }]
    const hit = suggestBillPayment(youtube, txns, '2026-09-06')
    assert.equal(hit.id, 'a')
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
