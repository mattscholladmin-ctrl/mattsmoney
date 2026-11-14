// @ts-nocheck
import { billOccurrences, isAppleMerchant, merchantMatchesBill, normalizeMerchant } from './budget.js'
import { catchUpSchedule, validatePlanPayment } from './card-catch-up.js'
import { isoDate } from './format.js'

const day = 86400000
const cents = n => Math.round(Number(n) * 100)
const distance = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / day
export const paymentUsed = t => !!(t.payment_match || t.bill_id || /(?:^|\s)(?:paid:|payment-review:one-off|apple-(?:split|paid|reviewed):)/.test(t.note || ''))
const eligible = (t, today) => t.source === 'plaid' && t.pending === false && t.txn_date <= today &&
  Number.isFinite(Date.parse(t.txn_date)) && distance(t.txn_date, today) <= 60 &&
  Number(t.amount) > 0 && !paymentUsed(t) && !isAppleMerchant(t.merchant)

export function paymentSnapshot(t) {
  return { amount: Number(t.amount), txn_date: t.txn_date, merchant: t.merchant ?? null, note: t.note ?? null }
}

export function paymentMatchOptions(data, t, today = isoDate()) {
  if (!eligible(t, today)) return []
  const options = []
  const amount = cents(t.amount)
  const from = isoDate(new Date(Date.parse(t.txn_date + 'T12:00:00') - 22 * day))
  for (const b of data.bills || []) {
    if (b.active === false || !merchantMatchesBill(b.name, t.merchant)) continue
    if (b.outstanding_amount != null && t.txn_date > b.outstanding_as_of && amount <= cents(b.outstanding_amount)) {
      options.push({ kind:'balance', id:b.id, due:b.outstanding_through, label:b.name, remaining:Number(b.outstanding_amount), asOf:b.outstanding_as_of })
    }
    for (const due of billOccurrences(b, from, 46)) {
      if (due <= (b.paid_through || '') || due <= (b.outstanding_through || '') || distance(due,t.txn_date) > (b.cadence === 'monthly' ? 15 : b.cadence === 'biweekly' ? 6 : 3)) continue
      if (b.partial_paid > 0 && b.partial_for !== due && b.partial_for > (b.paid_through || '')) continue
      if ((data.transactions || []).some(row => row.payment_match?.kind === 'bill' && row.payment_match.id === b.id && row.payment_match.due === due && row.payment_match.complete)) continue
      if ((data.transactions || []).some(row => !row.pending && String(row.note || '').split(/\s+/).some(note => note === `paid:${b.id}@${due}` || (note === `paid:${b.id}` && distance(row.txn_date,due) <= 15)))) continue
      const remaining = cents(b.amount) - (b.partial_for === due ? cents(b.partial_paid || 0) : 0)
      if (amount <= remaining) options.push({kind:'bill', id:b.id, due, label:b.name, remaining:remaining/100})
    }
  }
  for (const d of data.debts || []) {
    if (d.active === false || !d.catch_up_plan || !merchantMatchesBill(d.name,t.merchant)) continue
    const last4 = String(d.name).match(/\b\d{4}$/)?.[0]
    const bankSuffix = String(t.merchant).match(/\b\d{4}$/)?.[0]
    if (last4 && bankSuffix && last4 !== bankSuffix) continue
    if ((data.debtPayments || []).some(p => p.debt_id === d.id && cents(p.amount) === amount && distance(p.paid_on,t.txn_date) <= 5 && !(data.transactions || []).some(row => row.id === p.id && row.payment_match?.kind === 'card'))) continue
    for (const p of catchUpSchedule(d,today,data.debtPayments || []).installments) {
      if (distance(p.due,t.txn_date) <= 15 && amount <= cents(p.remaining)) {
        options.push({kind:'card',id:d.id,due:p.due,label:d.name,remaining:p.remaining})
      }
    }
  }
  return options
}

// A saved bill supplies the usual amount. A previously confirmed payment
// can also identify the bank's descriptor when it differs from the bill name.
function differentRecurringCharges(data, txn) {
  const merchant = normalizeMerchant(txn.merchant)
  if (!merchant) return []
  return (data.bills || []).filter(bill => {
    const usual = Number(bill.amount)
    if (bill.active === false || txn.txn_date <= (bill.outstanding_as_of || '') || !(usual > 0) || Math.abs(Number(txn.amount)-usual) <= Math.max(0.5,usual*0.03)) return false
    return merchant === normalizeMerchant(bill.name) || (data.transactions || []).some(previous =>
      previous.pending === false && previous.txn_date < txn.txn_date &&
      previous.payment_match?.kind === 'bill' && previous.payment_match.id === bill.id &&
      merchant === normalizeMerchant(previous.merchant)
    )
  }).map(bill => ({name:bill.name,amount:Number(bill.amount)}))
}

export function paymentSuggestions(data, today = isoDate()) {
  return (data.transactions || []).filter(t => eligible(t,today))
    .slice().sort((a,b) => b.txn_date.localeCompare(a.txn_date))
    .map(txn => ({
      txn,
      options:paymentMatchOptions(data,txn,today),
      differentBills:differentRecurringCharges(data,txn),
    }))
    .filter(row => row.options.length || row.differentBills.length)
}

export function paymentBillState(bill, kind) {
  const keys = kind === 'balance'
    ? ['outstanding_amount','outstanding_note','outstanding_as_of','outstanding_through','outstanding_due_date','outstanding_estimated']
    : ['amount','cadence','due_day','start_date','paid_through','outstanding_through','partial_paid','partial_for']
  return Object.fromEntries(keys.map(key => [key,bill[key] ?? null]))
}

export function applyDemoPaymentMatch(data, payload, today = isoDate()) {
  const t = data.transactions.find(row => row.id === payload.p_transaction_id)
  const {kind,id,due,remaining,as_of} = payload.p_target
  if (t?.payment_match?.kind === kind && t.payment_match.id === id && t.payment_match.due === due) return data
  if (!t || JSON.stringify(paymentSnapshot(t)) !== JSON.stringify(payload.p_expected_transaction)) throw new Error('The bank transaction changed. Reload and review it again.')
  const option = paymentMatchOptions(data,t,today).find(o => o.kind===kind && o.id===id && o.due===due && o.remaining===remaining && (o.asOf || null)===as_of)
  if (!option) throw new Error('The payment or balance changed. Reload and review it again.')
  const next = structuredClone(data)
  const tx = next.transactions.find(row => row.id === t.id)
  const amount = Number(tx.amount)
  const complete = cents(remaining) === cents(amount)
  const match = {kind,id,due,amount,complete,confirmed_at:Date.now()}
  if (kind === 'card') {
    const debt = next.debts.find(d => d.id === id)
    const note = `catch-up:${due}`
    const payments = next.debtPayments ||= []
    validatePlanPayment(debt,due,amount,payments)
    const effect = debt.plaid_account_id || debt.plaid_item_id ? 0 : amount
    if (effect > Number(debt.balance || 0)) throw new Error('Payment exceeds the recorded card balance.')
    debt.balance = Number(debt.balance || 0) - effect
    payments.push({id:tx.id,debt_id:id,paid_on:tx.txn_date,amount,note,balance_effect:effect})
  } else {
    const bill = next.bills.find(b => b.id === id)
    match.before = paymentBillState(bill,kind)
    if (kind === 'balance') {
      bill.outstanding_amount = (cents(remaining) - cents(amount))/100
      bill.outstanding_note = `${bill.outstanding_note}\nBank payment of $${amount.toFixed(2)} matched on ${tx.txn_date}.`.slice(-1500)
    }
    else {
      bill.partial_paid = complete ? null : (bill.partial_for === due ? cents(bill.partial_paid || 0) + cents(amount) : cents(amount))/100
      bill.partial_for = complete ? null : due
    }
    match.after = paymentBillState(bill,kind)
  }
  tx.payment_match = match
  return next
}
