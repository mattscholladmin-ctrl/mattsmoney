import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { debtPaycheckShare } from './paycheck-plan.js'

describe('debt paycheck share', () => {
  it('uses the monthly payment spread across paychecks', () => {
    const share = debtPaycheckShare({ plan_payment: 750, balance: 20000 }, 26)
    assert.equal(share, 346.15)
  })

  it('holds only the remaining balance once it is below one monthly payment', () => {
    const share = debtPaycheckShare({ plan_payment: 750, balance: 400 }, 26)
    assert.equal(share, 400)
  })

  it('does not hold more than the balance', () => {
    const share = debtPaycheckShare({ plan_payment: 100, balance: 20 }, 26)
    assert.equal(share, 20)
  })

  it('holds nothing when the monthly payment is zero', () => {
    assert.equal(debtPaycheckShare({ plan_payment: 0, balance: 500 }, 26), 0)
  })

  it('holds nothing when the balance is already zero', () => {
    assert.equal(debtPaycheckShare({ plan_payment: 750, balance: 0 }, 26), 0)
  })
})
