// @ts-nocheck
// Core budgeting logic. This file is where the non-negotiable rules live.
//
// Rule 1 (anchor to bank): "what I have" ALWAYS comes from the latest balance
//   the user entered from their bank. We never sum transactions to invent it.
// Rule 2 (side income is $0 until received): only income marked `confirmed`
//   (e.g. the steady paycheck) is counted in projections. Side income is left
//   out until the user logs it as actually received.
// Rule 3 (never project negative silently): projectBalance() walks the merged
//   timeline of bills (money out) and confirmed income (money in) and loudly
//   flags the first date the balance would fall below the buffer floor or zero.
// Rule 4 (buffer floor): the floor is treated as not spendable.

import { isoDate, monthKey } from './format.js'

const DAY_MS = 24 * 60 * 60 * 1000

function parseISO(iso) {
  return new Date(iso + 'T00:00:00')
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

// The current balance is the most recent balance entry the user logged.
export function currentBalance(balanceEntries = []) {
  if (!balanceEntries.length) return null
  const sorted = [...balanceEntries].sort((a, b) => {
    if (a.as_of !== b.as_of) return a.as_of < b.as_of ? 1 : -1
    return (a.created_at || '') < (b.created_at || '') ? 1 : -1
  })
  return sorted[0]
}

// Most recent balance entry for each account (keyed by account_id).
export function latestByAccount(balanceEntries = []) {
  const map = {}
  for (const e of balanceEntries) {
    if (!e.account_id) continue
    const cur = map[e.account_id]
    if (!cur) {
      map[e.account_id] = e
      continue
    }
    const newer =
      e.as_of > cur.as_of ||
      (e.as_of === cur.as_of && (e.created_at || '') > (cur.created_at || ''))
    if (newer) map[e.account_id] = e
  }
  return map
}

// Each account with its current balance and the date that balance is from.
export function accountSummaries(accounts = [], balanceEntries = []) {
  const latest = latestByAccount(balanceEntries)
  return accounts.map((a) => ({
    ...a,
    balance: latest[a.id] ? Number(latest[a.id].balance) : 0,
    asOf: latest[a.id]?.as_of || null,
    // "in bank $X · pending $Y" detail carried in the sync note, if any.
    balanceDetail:
      (latest[a.id]?.note || '').split('Auto-synced · ')[1] || null,
  }))
}

// A Quick-add cash transaction tags which manual account it hit in its note
// ("Paid with X" for money out, "Deposited to X" for money in). Given such a
// transaction, work out the account and the balance it should be set back to if
// the transaction is removed — so deleting or editing it keeps that account
// honest instead of leaving the old adjustment stuck.
export function cashReversal(txn, accounts = [], balances = []) {
  const sums = accountSummaries(accounts, balances)
  // Resolve by the real account_id link first (survives renames and duplicate
  // names). Fall back to the account name parsed from the note only for legacy
  // rows saved before the link existed.
  let acct = null
  if (txn?.account_id) {
    acct = sums.find((a) => a.id === txn.account_id && !a.plaid_account_id)
  }
  if (!acct) {
    const m = /^(?:Paid with|Deposited to) (.+)$/.exec((txn?.note || '').trim())
    if (m) acct = sums.find((a) => a.name === m[1] && !a.plaid_account_id)
  }
  if (!acct) return null
  // amount is signed: + was money out (we'd subtracted it), − was money in (we
  // added it). Undoing the effect means moving the balance back by +amount.
  const amount = Number(txn.amount || 0)
  return {
    account: acct,
    amount,
    restoreTo: Number((acct.balance + amount).toFixed(2)),
  }
}

// Headline money figures across all accounts.
//   spendableCash = sum of accounts marked "spending" (drives safe-to-spend)
//   savingsCash   = sum of accounts marked "savings"
//   totalCash     = every account combined
//   totalDebt     = active debts combined
//   netWorth      = totalCash − totalDebt
// Whether an account counts toward "safe to spend". Driven by an explicit
// per-account toggle (include_in_spendable); if that's never been set, fall
// back to the old behavior (spending counts, savings doesn't).
export function countsAsSpendable(a) {
  return a.include_in_spendable ?? (a.kind === 'spending')
}

// Money you're deliberately holding OUT of "safe to spend" for a known near-term
// expense you already have the cash for (e.g. a vet visit). Not a goal, not a
// debt — just a labeled reserve. Sum of the active holds.
export function totalSetAside(setAsides = []) {
  return (setAsides || []).reduce((sum, s) => sum + Math.max(0, Number(s.amount || 0)), 0)
}

// Sum of this paycheck's set-aside across RESERVED dated goals — the goal
// contributions you're committing to, held out of safe-to-spend just like bills.
// "Someday" goals (reserved === false) are targets only and never counted here.
export function goalPaceReserve(goals = [], transactions = [], ppy = 26, incomeSources = []) {
  let sum = 0
  for (const g of goals) {
    if (g.status !== 'active' || !g.target_date) continue
    if (g.reserved === false) continue
    const saved = Math.max(Number(g.current || 0), goalSpent(g.id, transactions))
    const p = goalPace(g, saved, undefined, ppy, incomeSources, transactions)
    sum += Math.max(0, p.reserveNow || 0)
  }
  return Number(sum.toFixed(2))
}

// This paycheck's piece of each reserved dated goal. Full remaining if the
// target is on or before next paycheck; otherwise one share.
export function goalPaycheckShare(goals = [], transactions = [], ppy = 26, incomeSources = [], fromIso = isoDate(), nextPayIso = null) {
  let sum = 0
  const items = []
  for (const g of goals || []) {
    if (g.status !== 'active' || !g.target_date || g.reserved === false) continue
    const saved = Math.max(Number(g.current || 0), goalSpent(g.id, transactions))
    const p = goalPace(g, saved, fromIso, ppy, incomeSources, transactions)
    const remaining = Math.max(0, p.remaining || 0)
    if (!(remaining > 0)) continue
    const hold =
      nextPayIso && g.target_date <= nextPayIso
        ? remaining
        : Number(p.neededPerPaycheck || 0)
    if (hold > 0) {
      sum += hold
      items.push({ id: g.id, name: g.name, perPaycheck: Number(hold.toFixed(2)) })
    }
  }
  return { total: Number(sum.toFixed(2)), items }
}

export function moneyTotals(accounts = [], balanceEntries = [], debts = []) {
  const summaries = accountSummaries(accounts, balanceEntries)
  const spendableCash = summaries
    .filter(countsAsSpendable)
    .reduce((s, a) => s + a.balance, 0)
  const savingsCash = summaries
    .filter((a) => !countsAsSpendable(a))
    .reduce((s, a) => s + a.balance, 0)
  const totalCash = summaries.reduce((s, a) => s + a.balance, 0)
  // Net worth is a REALITY figure, not a planning one — an Inactive (paused)
  // debt is still money you owe, same as DebtsCard's own "Total owed". Only
  // the forward-looking planning numbers (bills, forecast, safe-to-spend,
  // payoff plan, debt-free date) drop an inactive debt, deliberately.
  const totalDebt = (debts || []).reduce((s, d) => s + Number(d.balance || 0), 0)
  return {
    spendableCash,
    savingsCash,
    totalCash,
    totalDebt,
    netWorth: totalCash - totalDebt,
  }
}

// Estimated interest one debt accrues per month at its current balance & APR.
//   balance × (APR/100) ÷ 12  →  the "cost of carrying it" each month.
export function monthlyInterest(debt = {}) {
  const bal = Number(debt.balance || 0)
  const apr = Number(debt.apr || 0)
  if (bal <= 0 || apr <= 0) return 0
  return (bal * (apr / 100)) / 12
}

// Combined monthly interest across all active debts.
export function totalMonthlyInterest(debts = []) {
  return (debts || [])
    .filter((d) => d.active !== false)
    .reduce((s, d) => s + monthlyInterest(d), 0)
}

// How far a debt is paid down from its original amount. Collections with a
// settlement plan fall back to the settlement amount as the "original", so
// their bars light up without extra data entry. Otherwise falls back to the
// current balance (0% paid) when nothing was recorded.
export function debtProgress(debt = {}) {
  const balance = Number(debt.balance || 0)
  const recorded = Number(debt.original_balance || 0) || Number(debt.settlement_amount || 0)
  const original = recorded || balance
  const paid = Math.max(0, original - balance)
  const pct = original > 0 ? Math.min(100, Math.round((paid / original) * 100)) : 0
  return { original, paid, balance, pct, tracked: recorded > 0 }
}

// "InDebted payment 2 of 4" → series base "InDebted". Groups a whole payment
// plan so it can be edited/shown as one thing.
const SERIES_RE = /^(.*?)\s+(?:payment|installment)\s+(\d+)\s+of\s+(\d+)$/i
export function seriesBase(name) {
  const m = SERIES_RE.exec(String(name || '').trim())
  return m ? m[1] : null
}
export function groupSeries(goals = []) {
  const map = {}
  for (const g of goals) {
    const base = seriesBase(g.name)
    if (!base) continue
    ;(map[base] ||= []).push(g)
  }
  // Only real plans (2+ payments) count as a series.
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v.length >= 2))
}

// Does a debt belong to a payment-plan series? Match on a SHARED significant
// whole word (≥3 chars, not a filler word) — never a bare substring, so "Car"
// doesn't match "Carpet Loan" and an empty debt name can't match everything.
const PLAN_STOPWORDS = new Set(['loan', 'card', 'credit', 'the', 'and', 'for', 'payment', 'plan', 'account'])
function planTokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !PLAN_STOPWORDS.has(w))
}
export function debtMatchesPlanBase(debtName, base) {
  const bt = new Set(planTokens(base))
  if (!bt.size) {
    // Base is all short/filler words — fall back to a normalized name compare.
    const b = String(base || '').trim().toLowerCase()
    const d = String(debtName || '').trim().toLowerCase()
    return !!b && (d === b || d.includes(b))
  }
  return planTokens(debtName).some((w) => bt.has(w))
}

// A payment-plan series belongs to exactly ONE debt: the active debt whose name
// shares the MOST significant tokens with the series base. Returns null when the
// best match is a tie between two debts (ambiguous) or nothing matches — so a
// plan on one card can never suppress an unrelated same-issuer card from bills,
// the payoff sim, or the display, and an ambiguous match never writes to a debt.
export function bestDebtForPlanBase(base, debts = []) {
  const bt = new Set(planTokens(base))
  let best = null
  let bestScore = 0
  let tie = false
  for (const d of debts || []) {
    if (!d || d.active === false) continue
    const score = bt.size
      ? planTokens(d.name).filter((w) => bt.has(w)).length
      : debtMatchesPlanBase(d.name, base)
        ? 1
        : 0
    if (score <= 0) continue
    if (score > bestScore) {
      best = d
      bestScore = score
      tie = false
    } else if (score === bestScore) {
      tie = true
    }
  }
  return best && !tie ? best : null
}

// A progress bar for ANY debt. Revolving cards show credit-used (utilization,
// balance ÷ limit); fixed debts (loans, collections, BNPL) show paid-down
// toward their original or settlement total. Returns null only when the number
// it needs isn't recorded yet (a card with no limit, a loan with no original).
export function debtBar(debt = {}, plan = null) {
  const balance = Number(debt.balance || 0)
  // A payment plan is the single source of truth: total and paid come from its
  // own payments, so the bar always agrees with "N of M paid" and the balance —
  // never a stale settlement figure that's drifted out of sync.
  if (plan && plan.members && plan.members.length) {
    const planTotal = plan.members.reduce((s, m) => s + Number(m.target || 0), 0)
    // Use the largest known original as the denominator so a live balance above
    // the summed installments (stale/settlement data) can't force a bogus 0%.
    const total = Math.max(planTotal, Number(debt.settlement_amount || 0), Number(debt.original_balance || 0)) || planTotal
    if (total > 0) {
      // Paid = total minus the live balance, so the bar always reconciles with
      // the balance shown next to it (even after an off-plan "Log payment").
      const paid = Math.max(0, Math.min(total, total - balance))
      const pct = Math.max(0, Math.min(100, Math.round((paid / total) * 100)))
      return { kind: 'payoff', pct, paid, total }
    }
  }
  const isCard = debt.kind === 'card'
  const limit = Number(debt.credit_limit || 0)
  // A user-entered "Original amount" wins the payoff-bar denominator — that field
  // is labeled as the thing that drives the bar, so it must beat a leftover
  // settlement figure from an old plan.
  const total = Number(debt.original_balance || 0) || Number(debt.settlement_amount || 0)
  if (isCard && limit > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((balance / limit) * 100)))
    return { kind: 'utilization', pct, balance, limit }
  }
  if (total > 0) {
    const paid = Math.max(0, total - balance)
    const pct = Math.max(0, Math.min(100, Math.round((paid / total) * 100)))
    return { kind: 'payoff', pct, paid, total }
  }
  return null
}

// Match a debt to its payment-plan series (goal rows named "<base> payment N of
// M"), so the plan can be shown under the debt instead of as loose planned
// items. Returns { members, remaining, next, doneCount, total } or null.
export function debtPaymentPlan(debt, seriesMap = {}, debts = null) {
  let members = null
  let base = null
  for (const key of Object.keys(seriesMap)) {
    // When the full debt list is provided, only claim a series this debt is the
    // UNIQUE best match for (so a same-issuer sibling never steals it). Falls
    // back to the loose match when debts aren't passed (legacy callers).
    const owns = debts
      ? bestDebtForPlanBase(key, debts)?.id === debt?.id
      : debtMatchesPlanBase(debt?.name, key)
    if (owns) {
      members = seriesMap[key]
      base = key
      break
    }
  }
  if (!members) return null
  const remaining = members
    .filter((g) => g.status === 'planned' && g.target_date)
    .sort((a, b) => (a.target_date < b.target_date ? -1 : 1))
  const doneCount = members.filter((g) => g.status === 'done').length
  return { base, members, remaining, next: remaining[0] || null, doneCount, total: members.length }
}

// How many times a debt's payment happens per month, by pay frequency.
const DEBT_FREQ_PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 }
// The debt's payment expressed as a MONTHLY figure — used for payoff math and
// the "$X/mo" display. A $75 payment every 2 weeks is ~$162.50/mo.
export function monthlyDebtPayment(debt = {}) {
  const pay = Math.max(Number(debt.plan_payment || 0), Number(debt.min_payment || 0))
  return pay * (DEBT_FREQ_PER_MONTH[debt.pay_frequency] || 1)
}

// Standalone payoff projection for a single debt paid at its own payment.
// `months: null` means it can't be projected (no payment, or the payment barely
// covers interest).
export function singleDebtPayoff(debt = {}, today = new Date()) {
  const balance = Number(debt.balance || 0)
  if (balance <= 0) return { months: 0, date: null, done: true, payment: 0 }
  const payment = monthlyDebtPayment(debt)
  const monthlyRate = Number(debt.apr || 0) / 100 / 12
  if (payment <= 0) return { months: null, date: null, done: false, payment: 0 }
  if (payment <= balance * monthlyRate)
    return { months: null, date: null, done: false, payment, stuck: true }
  let bal = balance
  let months = 0
  while (bal > 0 && months < 1200) {
    bal += bal * monthlyRate
    bal -= payment
    months++
  }
  const d = new Date(today.getFullYear(), today.getMonth() + months, 1)
  return { months, date: d.toISOString().slice(0, 10), done: false, payment }
}

// Estimate a debt's balance TODAY from where and WHEN it started — assuming its
// scheduled payment was made every period since the start date. Lets you add a
// debt you've already been paying by its ORIGINAL amount + a start date in the
// past and let the app work the balance forward, instead of hand-computing it.
const AMORT_PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12 }
export function balanceFromStart({ original = 0, payment = 0, frequency = 'monthly', apr = 0, startDate, today = isoDate() } = {}) {
  const orig = Number(original) || 0
  const pay = Number(payment) || 0
  if (!startDate || orig <= 0) return { balance: orig, periods: 0 }
  const start = parseISO(startDate)
  const now = parseISO(today)
  if (now <= start) return { balance: orig, periods: 0 }
  // How many scheduled payments have come due between the start and today.
  let periods = 0
  if (frequency === 'weekly') periods = Math.floor((now - start) / (7 * DAY_MS))
  else if (frequency === 'biweekly') periods = Math.floor((now - start) / (14 * DAY_MS))
  else {
    periods = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
    if (now.getDate() < start.getDate()) periods -= 1
  }
  periods = Math.max(0, periods)
  const rate = (Number(apr) || 0) / 100 / (AMORT_PERIODS_PER_YEAR[frequency] || 12)
  // If the payment doesn't cover the interest, the balance GROWS every period and
  // would diverge to a nonsensical figure (billions). It's not calculable — say so
  // and let the caller ask for the current balance instead of showing garbage.
  if (rate > 0 && pay <= orig * rate) {
    return { balance: orig, periods: 0, diverges: true }
  }
  let bal = orig
  let made = 0
  for (let i = 0; i < periods; i++) {
    bal = bal * (1 + rate) - pay
    made += 1
    if (bal <= 0) { bal = 0; break }
  }
  return { balance: Math.round(bal * 100) / 100, periods: made }
}

// The next payment date for a debt (today or later), rolled forward from its
// schedule so a next-payment date set in the past still lands on the real next
// one. Returns an ISO date or null when the debt has no schedule.
//
// start_date (first collectible) wins when it is still in the future: a loan
// that starts Oct 1 must not look late on Sep 1. After start_date, due_day
// drives the monthly cycle. If unpaid, next_due stays on the missed cycle
// (status `late`) instead of jumping to next month.
export function nextDueDate(debt = {}, today = isoDate(), { unpaid = true } = {}) {
  const sched = obligationSchedule(debt, today, { unpaid })
  return sched.next_due
}

function dueDayOf(item) {
  if (item.due_day != null && item.due_day !== '') {
    const n = Number(item.due_day)
    if (!Number.isNaN(n)) return n
  }
  if (item.start_date) return Number(String(item.start_date).slice(8, 10))
  if (item.next_payment_date) return Number(String(item.next_payment_date).slice(8, 10))
  return null
}

function dateOnDueDay(year, monthIndex, dueDay) {
  const dim = daysInMonth(year, monthIndex)
  return new Date(year, monthIndex, Math.min(dueDay, dim))
}

// Cycle dates from first due (start_date) then due_day each following month.
export function obligationCycles(item, throughIso) {
  const start = item.start_date || null
  const dueDay = dueDayOf(item)
  const out = []
  if (start) {
    out.push(start)
    let y = parseISO(start).getFullYear()
    let m = parseISO(start).getMonth() + 1
    for (let i = 0; i < 36; i++) {
      if (m > 11) {
        m = 0
        y += 1
      }
      const iso = isoDate(dueDay != null ? dateOnDueDay(y, m, dueDay) : new Date(y, m, parseISO(start).getDate()))
      if (iso !== start) out.push(iso)
      if (iso > throughIso) break
      m += 1
    }
    return out
  }
  return out
}

export function obligationSchedule(item = {}, today = isoDate(), { unpaid = true, paidDates = [] } = {}) {
  const start = item.start_date || null
  const paid = new Set((paidDates || []).map((d) => String(d).slice(0, 10)))
  const monthPaid = (cycle) =>
    paid.has(cycle) || [...paid].some((d) => d.slice(0, 7) === String(cycle).slice(0, 7))

  if (start && today < start) {
    return { next_due: start, status: 'pre_start' }
  }

  const freq = item.pay_frequency || item.cadence || 'monthly'

  if (start && freq !== 'weekly' && freq !== 'biweekly') {
    const through = isoDate(new Date(parseISO(today).getTime() + 400 * DAY_MS))
    const cycles = obligationCycles(item, through).filter((c) => c >= start)
    const last = [...cycles].reverse().find((c) => c <= today)
    const upcoming = cycles.find((c) => c >= today) || start
    if (unpaid && last && last < today && !monthPaid(last)) {
      return { next_due: last, status: 'late' }
    }
    return { next_due: upcoming, status: 'due' }
  }

  const from = parseISO(today)
  const npd = item.next_payment_date || item.anchor || item.anchor_date || start || null
  if (npd && freq === 'biweekly') {
    const d = parseISO(npd)
    while (d < from) d.setDate(d.getDate() + 14)
    if (start && isoDate(d) < start) {
      const s = parseISO(start)
      while (s < from) s.setDate(s.getDate() + 14)
      return { next_due: isoDate(s), status: today < start ? 'pre_start' : 'due' }
    }
    return { next_due: isoDate(d), status: 'due' }
  }
  if (freq === 'weekly') {
    const targetDow = Number(item.due_day)
    if (Number.isInteger(targetDow) && targetDow >= 0 && targetDow <= 6) {
      const d = new Date(from)
      while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1)
      if (start && isoDate(d) < start) return { next_due: start, status: today < start ? 'pre_start' : 'due' }
      return { next_due: isoDate(d), status: 'due' }
    }
    if (npd) {
      const d = parseISO(npd)
      while (d < from) d.setDate(d.getDate() + 7)
      return { next_due: isoDate(d), status: 'due' }
    }
  }
  if (npd && freq !== 'weekly') {
    const d = parseISO(npd)
    while (d < from) d.setMonth(d.getMonth() + 1)
    return { next_due: isoDate(d), status: 'due' }
  }
  const dueDay = item.due_day != null ? Number(item.due_day) : null
  if (dueDay == null || Number.isNaN(dueDay)) return { next_due: null, status: 'due' }
  let year = from.getFullYear()
  let month = from.getMonth()
  for (let i = 0; i < 13; i++) {
    const occ = dateOnDueDay(year, month, dueDay)
    if (occ >= from) return { next_due: isoDate(occ), status: 'due' }
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  return { next_due: null, status: 'due' }
}

export function obligationAmount(item = {}) {
  if (item.plan_payment != null || item.min_payment != null) {
    return Math.max(Number(item.min_payment || 0), Number(item.plan_payment || 0))
  }
  return Number(item.amount || 0)
}

// Turn each active debt's minimum payment into a recurring monthly "bill" so it
// flows through safe-to-spend, the projection, and the upcoming list just like
// any other obligation. Needs a min_payment and a due_day to be schedulable.
export function debtsAsBills(debts = [], goals = []) {
  // A debt with a payment plan already contributes its scheduled installments to
  // the forecast (via datedGoalEvents), so don't ALSO bill its minimum — that
  // would count the same paydown twice.
  const seriesMap = groupSeries(goals)
  // Only the ONE debt a plan actually belongs to is excused from being billed —
  // never an unrelated same-issuer debt that shares a word.
  const hasPlan = (d) => Object.keys(seriesMap).some((base) => bestDebtForPlanBase(base, debts)?.id === d.id)
  const out = []
  for (const d of debts || []) {
    // Smoothed debts are reserved per-paycheck (smoothedReserve) instead of
    // hitting as a lump on their due date — so keep them out of the bills list.
    if (d.active === false || hasPlan(d) || d.smooth) continue
    // The per-payment amount you actually pay each time.
    const amount = Math.max(Number(d.min_payment || 0), Number(d.plan_payment || 0))
    if (amount <= 0) continue
    const freq = d.pay_frequency || 'monthly'
    const npd = d.next_payment_date || null
    const base = { id: `debt-${d.id}`, name: `${d.name} payment`, amount, category: 'Debt', active: true }
    if (freq === 'biweekly') {
      if (!npd) continue
      out.push({ ...base, cadence: 'biweekly', anchor: npd })
    } else if (freq === 'weekly') {
      if (!npd) continue
      out.push({ ...base, cadence: 'weekly', due_day: parseISO(npd).getDay(), anchor: npd })
    } else {
      // Monthly — derive the day of month from the next-payment date, or fall
      // back to the legacy due_day for debts saved before this change. The anchor
      // (first payment date) stops occurrences from being scheduled before it —
      // so a first payment set in a future month isn't billed a month early.
      const dueDay = npd ? Number(npd.slice(8, 10)) : d.due_day
      if (dueDay == null) continue
      out.push({
        ...base,
        cadence: 'monthly',
        due_day: Number(dueDay),
        start_date: d.start_date || null,
        anchor: d.start_date || npd || null,
      })
    }
  }
  return out
}

export function spendThisMonth(transactions = [], mk = monthKey()) {
  // Derived from spendByCategory (defined below) so the headline "spent this
  // month" figure can never disagree with the category breakdown it's shown
  // next to. Crucially, spendByCategory nets a refund PER CATEGORY and floors
  // each one individually before this sums them — netting the whole month as
  // one flat total instead would let an unrelated deposit (say, an untagged
  // side-income deposit) silently offset real spend in a totally different
  // category.
  return Object.values(spendByCategory(transactions, mk)).reduce((s, v) => s + v, 0)
}

// ---- Duplicate-transaction cleanup -----------------------------------------
// The same purchase can land twice: once from the old manual import (clean name
// like "Safeway") and once from Plaid (raw descriptor "SAFEWAY 0836 FRISCO CO").
// These share a date + amount and a significant word, but have DIFFERENT name
// strings — that's the fingerprint of an import/Plaid dup (genuine repeat buys
// have the SAME string, so they're left alone). We collapse them at read time
// so totals/insights/alerts never double-count, keeping the cleaner record.
const MERCHANT_STOPWORDS = new Set([
  'tst', 'sq', 'py', 'pos', 'the', 'co', 'us', 'ca', 'inc', 'llc', 'ltd',
  'com', 'www', 'purchase', 'debit', 'card', 'payment', 'store',
])
function significantWords(merchant) {
  return normalizeMerchant(merchant)
    .split(' ')
    .filter((w) => w.length >= 4 && !MERCHANT_STOPWORDS.has(w))
}
function looksRaw(merchant) {
  const m = String(merchant || '')
  if (/\d{3,}/.test(m)) return true // long digit strings (store #, phone)
  const letters = m.replace(/[^a-zA-Z]/g, '')
  return letters.length > 3 && letters === letters.toUpperCase() // ALL CAPS descriptor
}
function merchantRawness(t) {
  const m = String(t.merchant || '')
  let score = m.length / 100
  if (looksRaw(m)) score += 2
  return score
}
export function dedupeTransactions(transactions = []) {
  const groups = {}
  for (const t of transactions || []) {
    const key = `${t.txn_date}|${Number(t.amount || 0).toFixed(2)}`
    ;(groups[key] ||= []).push(t)
  }
  const drop = new Set()
  for (const rows of Object.values(groups)) {
    if (rows.length < 2) continue
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]
        const b = rows[j]
        if (drop.has(a.id) || drop.has(b.id)) continue
        const ma = String(a.merchant || '')
        const mb = String(b.merchant || '')
        if (ma === mb) continue // identical name = real repeat purchase, keep both
        // One side must be a raw bank descriptor — that's the import/Plaid dup
        // fingerprint. Two clean names that merely coincide are left alone.
        if (!looksRaw(ma) && !looksRaw(mb)) continue
        const wa = significantWords(ma)
        const wb = significantWords(mb)
        // EVERY word of the cleaner name must appear in the other ("Safeway" ⊆
        // "SAFEWAY 0836 FRISCO"). One shared word isn't enough — "Mountain
        // Coffee" and "MOUNTAIN HARDWARE" are different real merchants.
        const clean = !looksRaw(ma) ? wa : !looksRaw(mb) ? wb : wa.length <= wb.length ? wa : wb
        const other = clean === wa ? wb : wa
        if (!clean.length || !clean.every((w) => other.includes(w))) continue
        // Same purchase under two name formats. Keep a tagged one if present,
        // else the cleaner-looking name; drop the other.
        let loser
        if (a.goal_id && !b.goal_id) loser = b
        else if (b.goal_id && !a.goal_id) loser = a
        else loser = merchantRawness(a) >= merchantRawness(b) ? a : b
        drop.add(loser.id)
      }
    }
  }
  return drop.size ? (transactions || []).filter((t) => !drop.has(t.id)) : transactions
}

// ---- Auto-categorization ---------------------------------------------------
// Gives a synced/uncategorized transaction one of the user's spending
// categories so it fills the right budget instead of landing in "Other".
// Three layers, most specific first: (1) learn from the user's own history for
// that merchant, (2) keyword match on the merchant name, (3) map Plaid's own
// category code. Pure functions — the caller decides whether to apply.

// A category "needs help" when it's blank, a catch-all, or one of Plaid's
// ALL_CAPS codes (FOOD_AND_DRINK, GENERAL_MERCHANDISE…) which aren't the user's
// own category names.
export function needsCategory(category) {
  const c = String(category || '').trim()
  if (!c) return true
  if (/^(uncategorized|other)$/i.test(c)) return true
  if (/^[A-Z][A-Z0-9_]+$/.test(c)) return true
  return false
}

export function normalizeMerchant(m) {
  return String(m || '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// merchant keyword → category. Single words match a whole token; phrases match
// as a substring. Order matters (first hit wins) — Gas before Groceries so
// "Costco Gas" is fuel, and Dining before Groceries so a "market" cafe reads as
// eating out only via its own words.
const KEYWORD_CATEGORY = [
  ['Gas', ['shell', 'chevron', 'exxon', 'conoco', 'phillips', 'sinclair', 'maverik', 'holiday', 'fuel', 'gas', 'bp', 'texaco', 'marathon', 'circle k', 'valero', 'arco', 'sunoco', 'speedway', 'loaf n jug']],
  ['Dining', ['mcdonald', 'starbucks', 'taco', 'chipotle', 'subway', 'pizza', 'burger', 'wendy', 'dunkin', 'cafe', 'coffee', 'restaurant', 'grill', 'diner', 'deli', 'brewing', 'sonic', 'kfc', 'panera', 'sushi', 'bbq', 'bakery']],
  ['Groceries', ['market', 'grocery', 'grocer', 'safeway', 'kroger', 'king soopers', 'city market', 'walmart', 'target', 'trader joe', 'whole foods', 'aldi', 'costco', 'sams club', 'natural grocers', 'sprouts']],
  ['Pet', ['petsmart', 'petco', 'chewy', 'vet', 'veterin']],
  ['Subscriptions', ['netflix', 'spotify', 'hulu', 'disney', 'youtube', 'adobe', 'dropbox', 'patreon', 'squarespace', 'icloud', 'hbo', 'paramount', 'audible']],
  ['Utilities', ['verizon', 'comcast', 'xfinity', 'centurylink', 'utility', 'electric', 'internet']],
  ['Auto', ['geico', 'progressive', 'state farm', 'allstate', 'autozone', 'napa', 'jiffy', 'tire', 'mechanic', 'car wash']],
  ['Health', ['pharmacy', 'cvs', 'walgreens', 'rite aid', 'dental', 'clinic', 'gym', 'fitness', 'medical', 'hospital']],
  ['Housing', ['storage', 'rent', 'mortgage', 'hoa']],
  ['Shopping', ['amazon', 'ebay', 'etsy', 'best buy', 'home depot', 'lowes', 'rei']],
]

// Plaid personal_finance_category.primary → user category (last-resort). Plaid's
// FOOD_AND_DRINK lumps groceries + restaurants under one primary code, so without
// a grocery keyword we treat it as Dining (grocery stores nearly always keyword-
// match on their name, so those still land in Groceries).
const PLAID_CATEGORY = {
  GROCERIES: 'Groceries',
  FOOD_AND_DRINK: 'Dining',
  TRANSPORTATION: 'Gas',
  GENERAL_MERCHANDISE: 'Shopping',
  RENT_AND_UTILITIES: 'Utilities',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Health',
  ENTERTAINMENT: 'Subscriptions',
  HOME_IMPROVEMENT: 'Shopping',
}

// One pass over the transaction history, building normalized-merchant → the
// category the user gave it most often. autoCategory's "learn from history"
// step used to re-scan the ENTIRE history array for every single transaction
// it categorized — fine for a handful of rows, but O(n²) once someone has a
// couple thousand transactions (2,000 real transactions = ~4 million
// comparisons), and it re-runs from scratch every time transactions reload
// (which happens on every edit). Precomputing this map once turns cleaning a
// whole transaction list into a single O(n) pass instead.
export function buildLearnedCategoryMap(history = []) {
  const counts = {} // normalizedMerchant -> { category: count }
  for (const h of history) {
    const norm = normalizeMerchant(h.merchant)
    if (!norm || needsCategory(h.category)) continue
    const byCat = (counts[norm] = counts[norm] || {})
    byCat[h.category] = (byCat[h.category] || 0) + 1
  }
  const best = {}
  for (const norm of Object.keys(counts)) {
    const byCat = counts[norm]
    best[norm] = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0]
  }
  return best
}

// `learnedMap`, if provided (see buildLearnedCategoryMap), replaces the O(n)
// per-call history scan with an O(1) lookup — pass it when cleaning many
// transactions at once. Omit it (as every existing single-transaction caller
// does) and this scans `history` itself, unchanged from before.
export function autoCategory(txn, history = [], learnedMap = null) {
  const norm = normalizeMerchant(txn.merchant)
  // 1. Learn from history — most common category the user gave this merchant.
  if (norm) {
    if (learnedMap) {
      const best = learnedMap[norm]
      if (best) return best
    } else {
      const counts = {}
      for (const h of history) {
        if (h.id === txn.id) continue
        if (normalizeMerchant(h.merchant) !== norm) continue
        if (needsCategory(h.category)) continue
        counts[h.category] = (counts[h.category] || 0) + 1
      }
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
      if (best) return best
    }
  }
  // 2. Keyword match on the merchant name.
  const words = norm.split(' ').filter(Boolean)
  const hasWord = (w) => (w.includes(' ') ? norm.includes(w) : words.includes(w))
  for (const [cat, keywords] of KEYWORD_CATEGORY) {
    if (keywords.some(hasWord)) return cat
  }
  // 3. Plaid's own category code.
  const plaid = String(txn.category || '').toUpperCase()
  if (PLAID_CATEGORY[plaid]) return PLAID_CATEGORY[plaid]
  return null
}

// The category to actually SHOW and MATCH for a transaction: the user's own
// category if they set a real one, otherwise a cleaned name (learned → keyword →
// Plaid), and as a last resort a prettified version of the bank's raw code — so
// "GENERAL_SERVICES" reads "General services" and never an ugly ALL-CAPS code.
// This lets budgets and reports line up on real names even when the stored
// category is still the bank's raw code.
// The user's PERMANENT category renames, applied as the very last step of
// cleanCategory. Because every category in the app flows through cleanCategory, a
// rename here sticks for EVERYTHING — past, present, and every future transaction,
// including a brand-new merchant the auto-categorizer labels with the old name. Set
// once when data loads (setCategoryAliases). Keyed by lowercased "from" name.
let CATEGORY_ALIASES = {}
export function setCategoryAliases(map = {}) {
  const clean = {}
  for (const k of Object.keys(map || {})) {
    const from = String(k || '').trim().toLowerCase()
    const to = String(map[k] || '').trim()
    if (from && to) clean[from] = to
  }
  CATEGORY_ALIASES = clean
}
// Resolve a name through the rename rules, following chains (Dining→Restaurants→
// Eating out) with a hop cap + cycle guard so it can never loop.
function applyAlias(name) {
  let out = String(name || '')
  const seen = new Set()
  for (let i = 0; i < 8; i++) {
    const key = out.trim().toLowerCase()
    const next = CATEGORY_ALIASES[key]
    if (!next || next.trim().toLowerCase() === key || seen.has(key)) break
    seen.add(key)
    out = next
  }
  return out
}

export function cleanCategory(txn = {}, history = [], learnedMap = null) {
  const raw = String(txn.category || '').trim()
  let result
  if (raw && !needsCategory(raw)) result = raw
  else {
    const guess = autoCategory(txn, history, learnedMap)
    if (guess) result = guess
    else if (/^[A-Z][A-Z0-9_]+$/.test(raw)) {
      const s = raw.replace(/_/g, ' ').toLowerCase()
      result = s.charAt(0).toUpperCase() + s.slice(1)
    } else result = raw || 'Uncategorized'
  }
  return applyAlias(result)
}

// Clean EVERY transaction's category in one pass — O(n) instead of the O(n²)
// you'd get calling cleanCategory(t, transactions) once per transaction (each
// call would otherwise re-scan the whole list to "learn" the merchant's usual
// category). Returns { id: cleanedCategory }. Use this whenever you need the
// clean category for a whole transaction list — a per-row dropdown, a
// category breakdown, a budget match — not the single-transaction form.
export function cleanCategoriesFor(transactions = []) {
  const learnedMap = buildLearnedCategoryMap(transactions)
  const out = {}
  for (const t of transactions) out[t.id] = cleanCategory(t, transactions, learnedMap)
  return out
}

// For every transaction that needs a category and gets a confident guess,
// return { id, merchant, from, to }. Income/credits (amount < 0) are left alone.
export function categorySuggestions(transactions = []) {
  const out = []
  for (const t of transactions) {
    if (!needsCategory(t.category)) continue
    if (Number(t.amount || 0) < 0) continue
    const to = autoCategory(t, transactions)
    if (to && to !== t.category) {
      out.push({ id: t.id, merchant: t.merchant, from: t.category || null, to })
    }
  }
  return out
}

// ---- Recurring outflows / subscriptions ------------------------------------
// One unified view of money that goes out on a schedule: the bills the user
// tracks plus anything detectRecurring spots in the feed, each normalized to a
// monthly cost so they're comparable. Biggest drains first.
function monthlyEquiv(amount, cadence) {
  const a = Number(amount || 0)
  if (cadence === 'weekly') return (a * 52) / 12
  if (cadence === 'biweekly') return (a * 26) / 12
  return a // monthly (and anything unrecognized)
}

export function recurringOutflows(bills = [], transactions = []) {
  const fromBills = (bills || [])
    .filter((b) => b.active !== false)
    .map((b) => ({
      name: b.name,
      amount: Number(b.amount || 0),
      cadence: b.cadence || 'monthly',
      monthly: monthlyEquiv(b.amount, b.cadence),
      category: b.category || null,
      isSub: /subscription/i.test(b.category || ''),
      source: 'bill',
    }))
  const detected = detectRecurring(transactions, bills).map((d) => ({
    name: d.merchant,
    amount: d.amount,
    cadence: d.cadence,
    monthly: monthlyEquiv(d.amount, d.cadence),
    category: d.category || null,
    isSub: /subscription/i.test(d.category || ''),
    source: 'detected',
  }))
  const items = [...fromBills, ...detected].sort((a, b) => b.monthly - a.monthly)
  const monthlyTotal = items.reduce((s, x) => s + x.monthly, 0)
  return { items, monthlyTotal, yearlyTotal: monthlyTotal * 12 }
}

// "Save each paycheck": for bills/debts flagged smooth, hold out their per-paycheck
// share (monthly cost ÷ paychecks/month) so a big obligation is set aside a bit at
// a time instead of hitting as a lump when due. Returns { total, byItem } for the
// breakdown. Smoothed items are excluded from the lump treatment elsewhere
// (debtsAsBills skips them; the caller filters smoothed bills), so this reserve is
// counted exactly once. Goals smooth via their own Active/pace reserve.
// How many days one occurrence-interval spans, by cadence / pay frequency.
const SMOOTH_INTERVAL_DAYS = { weekly: 7, biweekly: 14, monthly: 365 / 12 }

// "Save each paycheck" — turn a big recurring bill or debt payment into an
// ACCUMULATING sinking fund instead of a lump. Each item builds up its per-paycheck
// slice toward the full amount due, so by the due date the whole thing is set aside
// and it never blindsides you. The amount HELD OUT of Safe-to-spend for an item is:
//
//     what you should have saved by now  MINUS  what you've actually moved to savings
//
// While a dollar is still in checking it's held here (kept out of Safe-to-spend); the
// moment it's physically in a savings account (which is already outside the spendable
// balance) this reserve releases it — so the same dollar is counted once, never twice,
// and never dropped. The release is CAPPED by the real money sitting in your (non-goal)
// savings, so a move you've logged but not actually made — or a bank transfer that
// hasn't cleared yet — can never inflate Safe-to-spend. Smoothed items are excluded
// from the lump treatment elsewhere (debtsAsBills skips them; the caller drops smoothed
// bills), so nothing is double-counted. Goals smooth via their own Active/pace reserve.
export function smoothedReserve(
  bills = [],
  debts = [],
  ppy = 26,
  { accounts = [], goals = [], today = isoDate(), incomeSources = [], transactions = [] } = {}
) {
  // Real, un-spoken-for cash sitting in savings (accounts kept OUT of spendable),
  // after whatever goals already claim on them. This caps how much of the reserve
  // we're allowed to treat as "already moved" — the key that stops a logged-but-not-
  // yet-cleared move from inflating Safe-to-spend.
  const savingsAvail = (accounts || []).reduce((sum, a) => {
    if (!a || a.hidden || countsAsSpendable(a)) return sum
    const { allocated } = accountBuckets(a, goals)
    return sum + Math.max(0, Number(a.balance || 0) - allocated)
  }, 0)

  const raw = []
  const consider = (item, kind) => {
    if (!item.smooth || item.active === false) return
    // The lump for one occurrence (what's actually due at once).
    const cap =
      kind === 'bill'
        ? Number(item.amount || 0)
        : Math.max(Number(item.plan_payment || 0), Number(item.min_payment || 0))
    if (!(cap > 0)) return
    const cadence = kind === 'bill' ? item.cadence : item.pay_frequency
    const intervalDays = SMOOTH_INTERVAL_DAYS[cadence] || SMOOTH_INTERVAL_DAYS.monthly
    const nextDue =
      kind === 'bill' ? billOccurrences(item, today, 400)[0] || null : nextDueDate(item, today)
    // "Should be saved by now": nothing is held until the NEXT real paycheck after
    // this cycle's start lands, then one slice per landed paycheck, reaching the
    // full amount by the due date. The cycle starts at the LATER of when you
    // turned smoothing on (smooth_since) and the natural start of this interval —
    // never backdated to before smoothing was actually turned on, and never
    // stretched earlier than the current billing cycle.
    let target, slice
    if (nextDue) {
      const naturalStart = isoDate(new Date(parseISO(nextDue).getTime() - intervalDays * DAY_MS))
      const since = item.smooth_since || naturalStart
      const cycleStart = since > naturalStart ? since : naturalStart
      const acc = paycheckAccrual(incomeSources, { startIso: cycleStart, dueIso: nextDue, cap, today, transactions, ppyFallback: ppy })
      target = acc.held
      slice = acc.slice
    } else {
      target = cap // no schedule on file → reserve the full lump, safely
      slice = cap
    }
    // The RAW amount you've claimed to have moved — never clamped to this item's
    // own target here. Clamping early would silently drop real dollars (still
    // physically sitting in savings from a prior cycle) out of the shared pool
    // below, letting OTHER items get credited against money that isn't really free.
    const savedRaw = Math.max(0, Number(item.smooth_saved || 0))
    raw.push({ id: `${kind}-${item.id}`, name: kind === 'bill' ? item.name : `${item.name} payment`, slice, cap, target, savedRaw, nextDue })
  }

  for (const b of bills || []) consider(b, 'bill')
  for (const d of debts || []) consider(d, 'debt')

  const totalTarget = raw.reduce((s, x) => s + x.target, 0)
  const totalClaimed = raw.reduce((s, x) => s + x.savedRaw, 0)
  const released = Math.min(totalClaimed, savingsAvail) // only credit money truly in savings
  const relRatio = totalClaimed > 0 ? released / totalClaimed : 0

  const byItem = raw.map((x) => {
    // This item's share of the released pool, capped at what IT currently needs —
    // an item that's already over its (freshly-reset) target doesn't hoard credit
    // that belongs to another item still building toward its own cap.
    const moved = Math.min(x.savedRaw * relRatio, x.target)
    const held = Math.max(0, x.target - moved)
    const toMove = Math.max(0, Math.min(x.target - Math.min(x.savedRaw, x.target), x.slice)) // one paycheck still to bank
    return {
      id: x.id,
      name: x.name,
      perPaycheck: Math.round(held * 100) / 100, // amount this item currently holds
      slice: Math.round(x.slice * 100) / 100,
      target: Math.round(x.target * 100) / 100,
      saved: Math.round(Math.min(x.savedRaw, x.target) * 100) / 100,
      moved: Math.round(moved * 100) / 100,
      toMove: Math.round(toMove * 100) / 100,
      nextDue: x.nextDue,
    }
  })

  const total = Math.round(Math.max(0, totalTarget - released) * 100) / 100
  return {
    total,
    byItem,
    target: Math.round(totalTarget * 100) / 100,
    saved: Math.round(totalClaimed * 100) / 100,
    savingsAvail: Math.round(savingsAvail * 100) / 100,
    released: Math.round(released * 100) / 100,
  }
}

// ---- Goal pace projection --------------------------------------------------
// Given a goal and its current progress, estimate when it'll be reached at the
// planned monthly contribution, and (if it has a target date) what monthly
// amount is needed to hit that date. Pure.
function addMonthsIso(iso, months) {
  const d = parseISO(iso)
  d.setMonth(d.getMonth() + months)
  return isoDate(d)
}

// How many paychecks a year, from the user's confirmed paycheck cadence —
// used to phrase goal pacing as "set aside $X per paycheck".
export function payPeriodsPerYear(income = []) {
  const paycheck = (income || []).find(
    (i) => i.confirmed && i.active !== false && i.cadence
  )
  switch (paycheck && paycheck.cadence) {
    case 'weekly':
      return 52
    case 'biweekly':
      return 26
    case 'semimonthly':
      return 24
    case 'monthly':
      return 12
    default:
      return 26 // sensible default: biweekly
  }
}

export function goalPace(goal, progress, today = isoDate(), ppy = 26, incomeSources = [], transactions = []) {
  const target = Number(goal.target || 0)
  const remaining = Math.max(0, target - Number(progress || 0))
  const monthly = Number(goal.monthly_contribution || 0)
  const out = { remaining, done: remaining <= 0, monthly }
  if (out.done || target <= 0) return out

  // Finish date at the current monthly pace.
  if (monthly > 0) {
    out.months = Math.ceil(remaining / monthly)
    out.etaDate = addMonthsIso(today, out.months)
  }

  // What it takes to hit a target date, and whether the pace is enough. The
  // per-paycheck SLICE (neededPerPaycheck) is a steady pace commitment — the same
  // math as before. What's actually HELD out of Safe-to-spend right now
  // (reserveNow) doesn't start until your next real paycheck lands, then builds
  // one slice per landed paycheck — see paycheckAccrual.
  if (goal.target_date) {
    out.targetDate = goal.target_date
    out.overdue = today >= goal.target_date
    const startIso = (goal.pace_since || (goal.created_at || today).slice(0, 10))
    const acc = paycheckAccrual(incomeSources, {
      startIso,
      dueIso: goal.target_date,
      cap: remaining,
      today,
      transactions,
      ppyFallback: ppy,
    })
    out.paychecksLeft = Math.max(1, acc.paychecksTotal - acc.paychecksLanded)
    out.dueThisCycle = acc.dueThisCycle
    out.neededPerPaycheck = acc.slice
    out.reserveNow = acc.held
    out.neededMonthly = out.neededPerPaycheck * (ppy / 12)
    out.onTrack = monthly >= out.neededMonthly - 0.005
    out.shortfall = Math.max(0, out.neededMonthly - monthly)
  }
  return out
}

// ---- Unusual-charge alerts -------------------------------------------------
// Scans recent (last 30 days) spending for two easy-to-miss problems: a likely
// duplicate charge (same merchant + amount within 3 days) and a charge that's
// much bigger than normal for that merchant. Pure — returns raw facts; the UI
// formats them.
export function unusualCharges(transactions = []) {
  const recentCutoff = isoDate(new Date(Date.now() - 30 * DAY_MS))
  const byMerchant = {}
  for (const t of transactions || []) {
    if (Number(t.amount || 0) <= 0) continue
    const m = normalizeMerchant(t.merchant)
    if (!m) continue
    ;(byMerchant[m] ||= []).push(t)
  }
  const out = []
  for (const rows of Object.values(byMerchant)) {
    const sorted = [...rows].sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1))
    // Likely duplicates: same amount, within 3 days.
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]
      const b = sorted[i]
      if (!b.txn_date || b.txn_date < recentCutoff) continue
      const sameAmt = Math.abs(Number(a.amount) - Number(b.amount)) <= 0.5
      const days = Math.round((parseISO(b.txn_date) - parseISO(a.txn_date)) / DAY_MS)
      // Only flag duplicates worth caring about — small repeat buys (coffee,
      // snacks) are normal, not errors.
      if (sameAmt && days <= 2 && Number(b.amount) >= 25) {
        out.push({ id: b.id, merchant: b.merchant, amount: Number(b.amount), kind: 'duplicate', days })
      }
    }
    // Bigger than usual: needs enough history to know "normal", and must be a
    // real outlier (variable merchants like groceries naturally swing).
    if (rows.length >= 5) {
      const med = median(rows.map((r) => Number(r.amount)))
      for (const t of rows) {
        if (!t.txn_date || t.txn_date < recentCutoff) continue
        if (Number(t.amount) > med * 2.5 && Number(t.amount) - med > 40) {
          out.push({ id: t.id, merchant: t.merchant, amount: Number(t.amount), kind: 'high', median: med })
        }
      }
    }
  }
  const seen = new Set()
  const deduped = out.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
  // Biggest first, and never overwhelm — a handful at most.
  return deduped.sort((a, b) => b.amount - a.amount).slice(0, 8)
}

// ---- Debt payoff planner ---------------------------------------------------
// Simulates paying the debts off month by month: interest accrues, every debt
// gets its minimum, and any leftover (freed-up minimums + an optional extra)
// piles onto the focus debt. avalanche = highest APR first (least interest);
// snowball = smallest balance first (fastest wins). Pure.
export function payoffPlan(debts = [], extraPerMonth = 0, strategy = 'avalanche', goals = []) {
  const seriesMap = groupSeries(goals)
  const planEndFor = (d) => {
    if (d.plan_end_date) return d.plan_end_date
    for (const b of Object.keys(seriesMap)) {
      if (bestDebtForPlanBase(b, debts)?.id === d.id) {
        return seriesMap[b].reduce((mx, m) => (m.target_date && m.target_date > mx ? m.target_date : mx), '') || null
      }
    }
    return null
  }
  const activeAll = (debts || []).filter((d) => d.active !== false && Number(d.balance) > 0)
  // Debts on a fixed schedule (a settlement plan_end_date or a payment-plan
  // series) clear by their OWN deadline — don't drag them through the revolving
  // sim, where a 0%-APR / no-minimum debt would sort to the very end.
  const scheduledEnds = []
  const revolving = []
  for (const d of activeAll) {
    const end = planEndFor(d)
    if (end) scheduledEnds.push(end)
    else revolving.push(d)
  }
  const scheduledMonths = scheduledEnds.reduce((mx, end) => {
    const m = Math.max(0, Math.ceil((parseISO(end) - parseISO(isoDate())) / (30.44 * DAY_MS)))
    return Math.max(mx, m)
  }, 0)
  const active = revolving.map((d) => ({
    name: d.name,
    balance: Number(d.balance),
    apr: Number(d.apr || 0),
    // "Current payments" = what's actually paid monthly: the plan payment
    // when one is set, never less than the minimum.
    min: monthlyDebtPayment(d),
  }))
  if (!active.length) {
    // Only scheduled debts left (or none): debt-free when the last plan ends.
    if (!scheduledMonths) return null
    return {
      months: scheduledMonths,
      debtFreeDate: addMonthsIso(isoDate(), scheduledMonths),
      totalInterest: 0,
      monthlyPayment: 0,
      strategy,
      order: [],
      capped: false,
    }
  }
  const baseMin = active.reduce((s, d) => s + d.min, 0)
  const pool = baseMin + Math.max(0, Number(extraPerMonth || 0))
  const order = [...active].sort((a, b) =>
    strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr
  )
  const sim = order.map((d) => ({ ...d }))
  const paidMonth = {}
  let month = 0
  let totalInterest = 0
  const MAX = 600 // 50-year guard against an unpayable plan
  while (sim.some((d) => d.balance > 0.01) && month < MAX) {
    month++
    for (const d of sim) {
      if (d.balance <= 0) continue
      const interest = d.balance * (d.apr / 100 / 12)
      d.balance += interest
      totalInterest += interest
    }
    let avail = pool
    for (const d of sim) {
      if (d.balance <= 0 || avail <= 0) continue
      const pay = Math.min(d.balance, d.min)
      d.balance -= pay
      avail -= pay
    }
    for (const d of sim) {
      if (avail <= 0) break
      if (d.balance <= 0) continue
      const pay = Math.min(d.balance, avail)
      d.balance -= pay
      avail -= pay
    }
    for (const d of sim) {
      if (d.balance <= 0.01 && !paidMonth[d.name]) paidMonth[d.name] = month
    }
  }
  // Debt-free only once the scheduled-plan debts have also cleared.
  const months = Math.max(month, scheduledMonths)
  return {
    months,
    debtFreeDate: addMonthsIso(isoDate(), months),
    totalInterest,
    monthlyPayment: pool,
    strategy,
    order: order.map((d) => ({ name: d.name, balance: d.balance, apr: d.apr, paidMonth: paidMonth[d.name] || month })),
    capped: month >= MAX,
  }
}

// ---- Recurring-charge detection --------------------------------------------
// Spots merchants charging on a regular cadence (weekly / monthly) that aren't
// already tracked as bills, so the app can offer to add them. Heuristic: 3+
// charges of a similar amount at a roughly regular interval. Pure.
function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function detectRecurring(transactions = [], bills = []) {
  const billNames = (bills || []).map((b) => normalizeMerchant(b.name)).filter(Boolean)
  const isKnownBill = (m) =>
    billNames.some((b) => b === m || b.includes(m) || m.includes(b))

  const groups = {}
  for (const t of transactions || []) {
    if (Number(t.amount || 0) <= 0) continue // outflows only
    const m = normalizeMerchant(t.merchant)
    if (!m) continue
    ;(groups[m] ||= []).push(t)
  }

  // Discretionary categories that repeat often but aren't bills (coffee,
  // groceries, gas, the pet store). Includes both the current names (Dining,
  // Groceries) and the older ones, and we match on the CLEANED category so a raw
  // bank code like "FOOD_AND_DRINK" (which resolves to Dining) is caught too.
  const DISCRETIONARY = new Set(['dining', 'groceries', 'gas', 'pet', 'food', 'eating out'])
  const candidates = []
  for (const [m, rows] of Object.entries(groups)) {
    if (rows.length < 3 || isKnownBill(m)) continue
    const discCount = rows.filter((r) => DISCRETIONARY.has(cleanCategory(r, transactions).toLowerCase())).length
    if (discCount > rows.length / 2) continue
    const sorted = [...rows].sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1))
    const amounts = sorted.map((r) => Number(r.amount))
    const amt = median(amounts)
    if (amt <= 0) continue
    // Real bills charge a near-exact amount every time; discretionary spend
    // varies. Require almost all charges within ~3% of the median.
    const consistent = amounts.filter((a) => Math.abs(a - amt) <= Math.max(0.25, amt * 0.03))
    if (consistent.length < Math.max(3, sorted.length - 1)) continue
    // Gaps between charges must be roughly regular.
    const gaps = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(Math.round((parseISO(sorted[i].txn_date) - parseISO(sorted[i - 1].txn_date)) / DAY_MS))
    }
    const gap = median(gaps)
    const last = sorted[sorted.length - 1]
    let cadence = null
    let due_day = null
    if (gap >= 6 && gap <= 8) {
      cadence = 'weekly'
      due_day = parseISO(last.txn_date).getDay()
    } else if (gap >= 26 && gap <= 32) {
      cadence = 'monthly'
      due_day = Number(last.txn_date.slice(8, 10))
    }
    if (!cadence) continue
    candidates.push({
      merchant: last.merchant,
      // Stable normalized key (the display merchant varies charge-to-charge, e.g.
      // "NETFLIX #4821" → "#4822", which used to resurrect a dismissed charge).
      key: m,
      amount: Math.round(amt * 100) / 100,
      cadence,
      due_day,
      count: sorted.length,
      lastDate: last.txn_date,
      category: last.category || 'Subscriptions',
    })
  }
  return candidates.sort((a, b) => b.count - a.count)
}

// Recap of what happened since the previous check-in (the most recent balance
// snapshot before today). Pure money-in vs money-out from transactions in the
// window, so it never needs to reconstruct historical balances.
export function checkInRecap(transactions = [], balances = [], today = isoDate()) {
  const prior = (balances || [])
    .map((b) => b.as_of)
    .filter((d) => d && d < today)
    .sort()
  const since = prior.length ? prior[prior.length - 1] : null
  if (!since) return null
  const inWindow = (transactions || []).filter(
    (t) => t.txn_date && t.txn_date > since && t.txn_date <= today
  )
  let spent = 0
  let income = 0
  for (const t of inWindow) {
    const a = Number(t.amount || 0)
    if (a >= 0) spent += a
    else income += -a
  }
  const days = Math.max(1, Math.round((parseISO(today) - parseISO(since)) / DAY_MS))
  return { since, days, spent, income, net: income - spent, count: inWindow.length }
}

// Other deposits from the same depositor that haven't been tagged yet — used
// to spread a manual income-source tag across that depositor's history, and to
// keep one manual override from being clobbered (only blanks are returned).
// Generic peer-to-payment processors whose merchant string doesn't reliably
// identify WHO actually sent the money — a friend paying you back and a real
// client can both post as plain "Venmo". Bulk-tagging every untagged deposit
// with the same generic name is unsafe (nothing here confirms they're all
// from the SAME income source), so these are excluded from the automatic
// "tag once, tagged forever" match — tag them one at a time instead.
const GENERIC_DEPOSITOR_WORDS = ['venmo', 'zelle', 'cash app', 'cashapp', 'paypal', 'apple cash']
function isGenericDepositor(normalizedMerchant) {
  return GENERIC_DEPOSITOR_WORDS.some((w) => normalizedMerchant.includes(w))
}

export function sameDepositorUntagged(transactions = [], merchant, excludeId = null) {
  const key = normalizeMerchant(merchant)
  if (!key || isGenericDepositor(key)) return []
  return (transactions || [])
    .filter(
      (t) =>
        t.id !== excludeId &&
        Number(t.amount || 0) < 0 &&
        !t.income_source &&
        normalizeMerchant(t.merchant) === key
    )
    .map((t) => t.id)
}

// Categories that are NOT real spending — moving your own money (transfers) or
// paying down debt (tracked separately in Debts). They're kept out of every spending
// total and the category breakdown so they can't inflate "where it goes".
export const NON_SPENDING = new Set(['transfer', 'transfers', 'transfer out', 'debt', 'debt payment', 'debt payments', 'loan payments'])

export function spendByCategory(transactions = [], mk = monthKey(), fromIso = null) {
  const learnedMap = buildLearnedCategoryMap(transactions)
  const map = {}
  for (const t of transactions) {
    const d = t.txn_date || ''
    if (fromIso) {
      if (d < fromIso) continue
    } else if (!d.startsWith(mk)) continue
    if (t.income_source) continue // tagged income isn't category spend
    const amt = Number(t.amount || 0)
    // Net signed: a refund (amt < 0) reduces the category it was spent in. Match
    // on the CLEANED category (so a raw "FOOD_AND_DRINK" lands in "Groceries" /
    // "Dining"), lower-cased so a budget "groceries" matches "Groceries".
    const cat = cleanCategory(t, transactions, learnedMap).trim().toLowerCase()
    if (NON_SPENDING.has(cat)) continue // transfers / debt payments aren't spending
    map[cat] = (map[cat] || 0) + amt
  }
  for (const k of Object.keys(map)) map[k] = Math.max(0, map[k]) // never negative
  return map
}

// Every spending category currently in use, as clean DISPLAY names, biggest first.
// This is the single list both the dashboard sorts spending into AND budgets are set
// from — so a budget always matches a real spending category instead of a name typed
// out of thin air. Spending only (money out); tagged income is skipped.
export function categoriesInUse(transactions = []) {
  const learnedMap = buildLearnedCategoryMap(transactions)
  const totals = {}
  for (const t of transactions || []) {
    if (t.income_source) continue
    if (Number(t.amount || 0) <= 0) continue
    const cat = cleanCategory(t, transactions, learnedMap)
    if (!cat || NON_SPENDING.has(cat.trim().toLowerCase())) continue
    totals[cat] = (totals[cat] || 0) + Number(t.amount || 0)
  }
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
}

// Money received this month, grouped by the income source it was tagged with.
// Only counts money-in (amount < 0, the deposit convention) on tagged rows.
// Returns [{ source, total }] sorted high → low, plus a `total` of everything.
export function incomeReceivedBySource(transactions = [], mk = monthKey()) {
  const map = {}
  let total = 0
  for (const t of transactions) {
    if (!t.income_source) continue
    if (!(t.txn_date || '').startsWith(mk)) continue
    const amt = Number(t.amount || 0)
    if (amt >= 0) continue // spending/refunds aren't income
    const received = -amt
    map[t.income_source] = (map[t.income_source] || 0) + received
    total += received
  }
  const rows = Object.entries(map)
    .map(([source, sum]) => ({ source, total: sum }))
    .sort((a, b) => b.total - a.total)
  return { rows, total }
}

// Total spend for each of the last `count` calendar months, oldest → newest.
export function monthlyTotals(transactions = [], count = 6, today = new Date()) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const mk = monthKey(d)
    out.push({ mk, date: d, total: spendThisMonth(transactions, mk) })
  }
  return out
}

// Net worth over time, one point per balance-snapshot date. Cash at each date
// is the latest balance per account on/before that date (carried forward).
// NOTE: debts aren't tracked historically yet, so debt is held at its current
// total across the whole series — early points show cash growth, not paydown.
export function netWorthSeries(accounts = [], balanceEntries = [], debts = []) {
  if (!balanceEntries.length) return []
  // Only count entries that belong to the accounts we were given (hidden
  // accounts are filtered by the caller; entries orphaned by a deleted
  // account shouldn't haunt the chart). Legacy single-balance entries
  // (no account_id) are kept for users from before accounts existed.
  const ids = new Set((accounts || []).map((a) => a.id))
  balanceEntries = balanceEntries.filter((e) => !e.account_id || ids.has(e.account_id))
  if (!balanceEntries.length) return []
  // Reality, not planning — matches moneyTotals (see its comment).
  const currentDebt = (debts || []).reduce((s, d) => s + Number(d.balance || 0), 0)

  const dates = [...new Set(balanceEntries.map((e) => e.as_of))].sort()
  const series = []
  for (const date of dates) {
    const latest = {}
    for (const e of balanceEntries) {
      if (e.as_of > date) continue
      const key = e.account_id || 'single'
      const cur = latest[key]
      const newer =
        !cur ||
        e.as_of > cur.as_of ||
        (e.as_of === cur.as_of && (e.created_at || '') > (cur.created_at || ''))
      if (newer) latest[key] = e
    }
    let cash = 0
    for (const k in latest) cash += Number(latest[k].balance || 0)
    series.push({ date, cash, netWorth: cash - currentDebt })
  }
  return series
}


// All occurrences of one recurring bill within [fromIso, fromIso + horizonDays].
export function billOccurrences(bill, fromIso, horizonDays) {
  const from = parseISO(fromIso)
  const end = new Date(from.getTime() + horizonDays * DAY_MS)
  const out = []
  const start = bill.start_date || bill.anchor || null

  if (bill.cadence === 'biweekly') {
    // Every 14 days from an anchor date (e.g. a debt paid every 2 weeks).
    if (!bill.anchor) return out
    const d = parseISO(bill.anchor)
    while (d < from) d.setDate(d.getDate() + 14)
    while (d <= end) {
      out.push(isoDate(d))
      d.setDate(d.getDate() + 14)
    }
  } else if (bill.cadence === 'weekly') {
    const targetDow = Number(bill.due_day) // 0=Sun ... 6=Sat
    // Guard against corrupt data (a weekday must be 0–6); an invalid value
    // would otherwise spin the search below forever and freeze the app.
    if (!Number.isInteger(targetDow) || targetDow < 0 || targetDow > 6) return out
    const d = new Date(from)
    while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1)
    while (d <= end) {
      // Skip occurrences before the anchor (first payment date) — same reason
      // as monthly below: a payment starting weeks out shouldn't be billed now.
      if (!start || isoDate(d) >= start) out.push(isoDate(d))
      d.setDate(d.getDate() + 7)
    }
  } else {
    // monthly
    const dueDay = Number(bill.due_day) // 1..31
    let year = from.getFullYear()
    let month = from.getMonth()
    for (let i = 0; i < 13; i++) {
      const dim = daysInMonth(year, month)
      const day = Math.min(dueDay, dim)
      const occ = new Date(year, month, day)
      // Skip occurrences before the anchor (first payment date) so a payment
      // starting in a future month isn't listed a month early.
      if (occ >= from && occ <= end && (!start || isoDate(occ) >= start)) out.push(isoDate(occ))
      month += 1
      if (month > 11) {
        month = 0
        year += 1
      }
    }
  }
  return out
}

// All occurrences of one income source within [fromIso, fromIso + horizonDays].
// Supports biweekly/weekly (counted from an anchor payday), monthly (due_day),
// and one-time (anchor_date). Rule 2: unconfirmed (side) income never counts.
export function incomeOccurrences(src, fromIso, horizonDays) {
  const from = parseISO(fromIso)
  const end = new Date(from.getTime() + horizonDays * DAY_MS)
  const out = []
  if (src.confirmed === false) return out

  if (src.cadence === 'biweekly' || src.cadence === 'weekly') {
    if (!src.anchor_date) return out
    const step = src.cadence === 'biweekly' ? 14 : 7
    const d = parseISO(src.anchor_date)
    // Walk from the anchor payday to the first occurrence on/after `from` — in
    // EITHER direction. The anchor is usually in the past relative to `from`
    // (walk forward), but a caller asking about a window that starts before the
    // anchor (e.g. "how many paydays landed since this goal was created," which
    // can predate when the income source's anchor was last set) needs the anchor
    // walked backward too, or it would wrongly miss every occurrence before it.
    while (d < from) d.setDate(d.getDate() + step)
    while (true) {
      const prev = new Date(d.getTime() - step * DAY_MS)
      if (prev < from) break
      d.setTime(prev.getTime())
    }
    while (d <= end) {
      out.push(isoDate(d))
      d.setDate(d.getDate() + step)
    }
  } else if (src.cadence === 'monthly') {
    const dueDay = Number(src.due_day)
    let year = from.getFullYear()
    let month = from.getMonth()
    for (let i = 0; i < 13; i++) {
      const dim = daysInMonth(year, month)
      const day = Math.min(dueDay, dim)
      const occ = new Date(year, month, day)
      if (occ >= from && occ <= end) out.push(isoDate(occ))
      month += 1
      if (month > 11) {
        month = 0
        year += 1
      }
    }
  } else if (src.cadence === 'one_time' && src.anchor_date) {
    const d = parseISO(src.anchor_date)
    if (d >= from && d <= end) out.push(isoDate(d))
  }
  return out
}

const INCOME_EARLY_DAYS = 4
const INCOME_LATE_DAYS = 3

// Which merchant(s) actually pay out a scheduled paycheck. Real paychecks often
// post from a payroll processor whose name looks nothing like the income source
// (Matt's "Summit Mountain Rentals" pay lands from "INTANDEM"), and Plaid rarely
// tags them — so matching on the source name or a manual tag alone misses them.
// We LEARN the vendor from history: money-in deposits that both match the
// source's amount AND fall on a past scheduled payday. Detection then keys off
// that vendor, not the amount — and because learning requires schedule
// alignment, a one-off same-size deposit can never establish a false vendor.
export function inferSourceDepositors(source, transactions = [], today = isoDate()) {
  const amt = Number(source?.amount || 0)
  // No anchor_date requirement: monthly sources schedule off due_day, so they can
  // learn their payroll vendor too (incomeOccurrences just returns [] if a
  // biweekly/weekly source has no anchor, degrading to "no vendor learned").
  if (!amt) return new Set()
  const tol = Math.max(2, amt * 0.05)
  const back = isoDate(new Date(parseISO(today).getTime() - 180 * DAY_MS))
  const paydays = incomeOccurrences(source, back, 180).filter((d) => d <= today)
  const onSchedule = (d) =>
    paydays.some((o) => {
      const from = isoDate(new Date(parseISO(o).getTime() - INCOME_EARLY_DAYS * DAY_MS))
      const to = isoDate(new Date(parseISO(o).getTime() + INCOME_LATE_DAYS * DAY_MS))
      return d >= from && d <= to
    })
  const set = new Set()
  for (const t of transactions) {
    if (t.pending) continue // provisional — don't learn a vendor from it
    const a = Number(t.amount || 0)
    if (a >= 0) continue // deposits are stored amount < 0
    if (Math.abs(-a - amt) > tol) continue
    const d = t.txn_date || ''
    if (!onSchedule(d)) continue
    const m = normalizeMerchant(t.merchant)
    if (m) set.add(m)
  }
  return set
}

// Flags a landed paycheck whose actual deposit came in meaningfully below the
// source's configured amount (an hours-cut / reduced-pay scenario). The
// received/not-received check above never compares amounts once a vendor is
// learned (a shrinking paycheck from an already-known payroll company still
// counts as "received"), so without this a real income shortfall gets no
// signal anywhere — unlike unusualCharges on the spending side.
const SHORTFALL_LOOKBACK_DAYS = 35
const SHORTFALL_THRESHOLD = 0.85 // flag when the actual deposit is under 85% of expected
export function incomeShortfalls(sources = [], transactions = [], today = isoDate()) {
  const out = []
  for (const src of sources || []) {
    if (src.active === false || src.confirmed === false) continue
    const expected = Number(src.amount || 0)
    if (expected <= 0) continue
    const depositors = inferSourceDepositors(src, transactions, today)
    if (!depositors.size) continue // no learned vendor yet — nothing to compare against
    const since = isoDate(new Date(parseISO(today).getTime() - SHORTFALL_LOOKBACK_DAYS * DAY_MS))
    let latest = null
    for (const t of transactions) {
      if (t.pending) continue
      const a = Number(t.amount || 0)
      if (a >= 0) continue // deposits are stored amount < 0
      const d = t.txn_date || ''
      if (d < since || d > today) continue
      if (!depositors.has(normalizeMerchant(t.merchant))) continue
      if (!latest || d > latest.txn_date) latest = t
    }
    if (!latest) continue
    const received = -Number(latest.amount || 0)
    if (received < expected * SHORTFALL_THRESHOLD) {
      out.push({ name: src.name, expected, received, date: latest.txn_date })
    }
  }
  return out
}

// Has this scheduled paycheck already landed? True when a money-in transaction
// within a few days of the payday either carries this source's tag OR comes from
// its learned payroll vendor (see inferSourceDepositors). Never matched on amount
// alone. Covers paychecks that post a couple days early. Pass the source object;
// a bare name string still works (tag-only, for callers that have no amount).
export function isIncomeOccurrenceReceived(source, dateIso, transactions = [], depositors = null) {
  const src = typeof source === 'string' ? { name: source } : source || {}
  const key = String(src.name || '').trim().toLowerCase()
  const vendors = depositors || inferSourceDepositors(src, transactions)
  if (!key && vendors.size === 0) return false
  const from = isoDate(new Date(parseISO(dateIso).getTime() - INCOME_EARLY_DAYS * DAY_MS))
  const to = isoDate(new Date(parseISO(dateIso).getTime() + INCOME_LATE_DAYS * DAY_MS))
  return transactions.some((t) => {
    if (t.pending) return false // provisional deposit — wait until it settles
    if (Number(t.amount || 0) >= 0) return false // deposits are stored amount < 0
    const d = t.txn_date || ''
    if (d < from || d > to) return false
    const tagged = key && String(t.income_source || '').trim().toLowerCase() === key
    const byVendor = vendors.size > 0 && vendors.has(normalizeMerchant(t.merchant))
    return tagged || byVendor
  })
}

// Flattened, date-sorted list of upcoming confirmed income within the horizon.
// A scheduled paycheck that already landed (e.g. posted early) is skipped — it's
// already in the balance, so projecting it again would double-count.
export function upcomingIncome(sources = [], fromIso = isoDate(), horizonDays = 30, transactions = []) {
  const items = []
  for (const src of sources) {
    if (src.active === false) continue
    const depositors = inferSourceDepositors(src, transactions, fromIso)
    for (const date of incomeOccurrences(src, fromIso, horizonDays)) {
      if (isIncomeOccurrenceReceived(src, date, transactions, depositors)) continue
      items.push({ date, name: src.name, amount: Number(src.amount || 0) })
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return items
}

// Cadences incomeOccurrences actually knows how to walk. A source with anything
// else (e.g. a future cadence value the scheduler hasn't been taught yet) can't be
// trusted to produce a real payday count — paycheckAccrual falls back safely for it.
const KNOWN_PAY_CADENCES = new Set(['biweekly', 'weekly', 'monthly', 'one_time'])

// How many REAL scheduled paydays (from any active income source) fall strictly
// AFTER sinceIso and up to/including throughIso — a payday ON sinceIso itself
// doesn't count (ambiguous whether it happened before or after the obligation
// started). Credits a payday as soon as it's genuinely landed: either its
// scheduled date has passed, or (reusing the app's own early-posting detector)
// real deposit money already shows up a few days early — the same signal
// upcomingIncome already relies on to avoid double-counting a paycheck.
export function paydayCount(sources = [], sinceIso, throughIso, transactions = []) {
  if (!sinceIso || !throughIso || throughIso < sinceIso) return 0
  const widenedThrough = isoDate(new Date(parseISO(throughIso).getTime() + INCOME_EARLY_DAYS * DAY_MS))
  const horizonDays = Math.ceil((parseISO(widenedThrough) - parseISO(sinceIso)) / DAY_MS)
  if (horizonDays < 0) return 0
  const dates = new Set()
  for (const src of sources || []) {
    if (src.active === false) continue
    const depositors = inferSourceDepositors(src, transactions, throughIso)
    for (const d of incomeOccurrences(src, sinceIso, horizonDays)) {
      if (d <= sinceIso || d > widenedThrough) continue
      // Early-credit a real deposit that's already landed — but only if that
      // real money ALSO arrived after sinceIso. Without this, a scheduled date
      // just past sinceIso could get "credited" by a genuine paycheck that
      // actually landed BEFORE this obligation existed (its early-posting
      // window can reach back before sinceIso even though its nominal
      // schedule date doesn't), wrongly crediting a paycheck the goal never
      // saw any of.
      const landed = d <= throughIso || receivedSince(src, d, sinceIso, transactions, depositors)
      if (landed) dates.add(d)
    }
  }
  return dates.size
}

// Same early-posting match as isIncomeOccurrenceReceived, plus one constraint:
// the matching real deposit must have landed strictly after sinceIso.
function receivedSince(source, dateIso, sinceIso, transactions, depositors) {
  const src = typeof source === 'string' ? { name: source } : source || {}
  const key = String(src.name || '').trim().toLowerCase()
  const vendors = depositors || new Set()
  if (!key && vendors.size === 0) return false
  const from = isoDate(new Date(parseISO(dateIso).getTime() - INCOME_EARLY_DAYS * DAY_MS))
  const to = isoDate(new Date(parseISO(dateIso).getTime() + INCOME_LATE_DAYS * DAY_MS))
  return (transactions || []).some((t) => {
    if (t.pending) return false
    if (Number(t.amount || 0) >= 0) return false
    const d = t.txn_date || ''
    if (d < from || d > to) return false
    if (d <= sinceIso) return false // this deposit landed before the obligation started — doesn't count
    const tagged = key && String(t.income_source || '').trim().toLowerCase() === key
    const byVendor = vendors.size > 0 && vendors.has(normalizeMerchant(t.merchant))
    return tagged || byVendor
  })
}

// Shared per-paycheck build-up for a per-paycheck obligation (a goal's
// remaining-to-target, or one bill/debt's smoothing cap): nothing is held until
// the NEXT real paycheck after `startIso` lands; from then, one slice accrues per
// landed real payday, capped at `cap`, guaranteed full by `dueIso`. Pure function
// of its inputs — no persisted "paychecks counted" state.
export function paycheckAccrual(sources, { startIso, dueIso, cap, today = isoDate(), transactions = [], ppyFallback = 26 } = {}) {
  if (!(cap > 0)) return { slice: 0, held: 0, paychecksTotal: 0, paychecksLanded: 0, dueThisCycle: false }
  if (!dueIso || today >= dueIso) {
    return { slice: cap, held: cap, paychecksTotal: 0, paychecksLanded: 0, dueThisCycle: true }
  }
  const start = !startIso || startIso > today ? today : startIso
  // Only trust a real payday count when at least one source has a cadence the
  // scheduler actually understands — otherwise fall back to the old months-based
  // approximation, so an unrecognized cadence degrades to today's existing
  // behavior instead of regressing to "hold everything immediately."
  const hasKnownCadence = (sources || []).some((s) => s.active !== false && KNOWN_PAY_CADENCES.has(s.cadence))
  if (!hasKnownCadence) {
    const months = (parseISO(dueIso) - parseISO(today)) / DAY_MS / 30.44
    const paychecksLeft = Math.max(1, Math.round(months * (ppyFallback / 12)))
    const slice = cap / paychecksLeft
    return { slice, held: slice, paychecksTotal: paychecksLeft, paychecksLanded: 0, dueThisCycle: paychecksLeft <= 1, approximate: true }
  }
  const paychecksTotal = paydayCount(sources, start, dueIso, transactions)
  if (paychecksTotal === 0) {
    // No real payday lands before the due date — nothing to ramp against, so
    // (same floor as today's Math.max(1, paychecksLeft)) the full amount is due now.
    return { slice: cap, held: cap, paychecksTotal: 0, paychecksLanded: 0, dueThisCycle: true }
  }
  const paychecksLanded = paydayCount(sources, start, today, transactions)
  const slice = cap / paychecksTotal
  const held = Math.min(slice * paychecksLanded, cap)
  return { slice, held, paychecksTotal, paychecksLanded, dueThisCycle: paychecksTotal <= 1 }
}

// Flattened, date-sorted list of upcoming bill payments within the horizon.
export function upcomingBills(bills = [], fromIso = isoDate(), horizonDays = 30) {
  const items = []
  for (const bill of bills) {
    if (bill.active === false) continue
    for (const date of billOccurrences(bill, fromIso, horizonDays)) {
      items.push({
        date,
        name: bill.name,
        amount: Number(bill.amount || 0),
        category: bill.category || 'Bills',
        billId: bill.id,
      })
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return items
}

// Has this bill occurrence already been paid? True when a transaction near the
// due date (up to `windowDays` before, through today) matches the amount
// within 2% AND shares a merchant word with the bill name. Conservative on
// purpose: if we can't confidently match a payment, the bill keeps reducing
// safe-to-spend.
const PAID_WINDOW_DAYS = 5
export function isBillOccurrencePaid(occ, transactions = [], todayIso = isoDate(), windowDays = PAID_WINDOW_DAYS) {
  if (occ.date > todayIso) return false // future bills can't be paid off yet
  const from = isoDate(new Date(parseISO(occ.date).getTime() - windowDays * DAY_MS))
  const billWords = significantWords(occ.name || '')
  if (!billWords.length) return false
  const amt = Number(occ.amount || 0)
  return transactions.some((t) => {
    const ta = Number(t.amount || 0)
    if (ta <= 0) return false // outflows only
    if (Math.abs(ta - amt) > Math.max(0.5, amt * 0.02)) return false
    const d = t.txn_date || ''
    if (d < from || d > todayIso) return false
    const words = significantWords(t.merchant || '')
    return words.some((w) => billWords.includes(w))
  })
}

// Long enough to guarantee finding the most recent past occurrence of any
// supported cadence (monthly's worst case is ~31 days between occurrences).
const OVERDUE_LOOKBACK_DAYS = 40
// A wider payment-match window than the normal 5 days (PAID_WINDOW_DAYS),
// used only for the overdue backfill below — someone who reliably pays a
// bill 1-2 weeks ahead of its due date shouldn't get flagged as "still
// might owe this" every single cycle just because the match window is
// narrower than their actual habit.
const OVERDUE_PAID_WINDOW_DAYS = 21

// upcomingBills minus occurrences that already have a matching payment in the
// transactions feed. Use this anywhere "money still owed" is what matters
// (safe-to-spend, projections, the cash-flow calendar, due reminders).
//
// billOccurrences only looks forward from `fromIso` — once a bill's due date
// passes, that occurrence is gone for good and the *next* period's occurrence
// takes its place. If the overdue one was never actually paid, that silently
// stops holding money for something still genuinely owed. So also look back
// for each bill's most recent occurrence before `fromIso`; if it's unpaid,
// re-surface it — dated `fromIso` (not its real past date) so every consumer
// (the calendar, New Normal's cycle walk, safe-to-spend) can treat it like
// any other upcoming item without needing to understand a past-dated event.
// Skipped when `forward` already has a same-bill occurrence due exactly
// today — that already covers it, so this doesn't double the bill up.
export function unpaidBills(bills = [], transactions = [], fromIso = isoDate(), horizonDays = 30, goals = []) {
  const preStartIds = new Set()
  const preStartHolds = []
  for (const bill of bills) {
    if (bill.active === false) continue
    const start = bill.start_date || null
    if (start && fromIso < start) {
      preStartIds.add(bill.id)
      preStartHolds.push({
        date: start,
        name: bill.name,
        amount: Number(bill.amount || 0),
        category: bill.category || 'Bills',
        billId: bill.id,
        overdue: false,
        preStart: true,
        originalDate: start,
      })
    }
  }

  const forward = upcomingBills(bills, fromIso, horizonDays).filter(
    (occ) => !preStartIds.has(occ.billId) && !isBillOccurrencePaid(occ, transactions, fromIso)
  )
  const dueTodayBillIds = new Set(forward.filter((o) => o.date === fromIso).map((o) => o.billId))

  const overdue = []
  const lookbackFrom = isoDate(new Date(parseISO(fromIso).getTime() - OVERDUE_LOOKBACK_DAYS * DAY_MS))
  for (const bill of bills) {
    if (bill.active === false || dueTodayBillIds.has(bill.id) || preStartIds.has(bill.id)) continue
    if (overdueGoalCovers(bill, goals)) continue
    const past = billOccurrences(bill, lookbackFrom, OVERDUE_LOOKBACK_DAYS).filter((d) => d < fromIso)
    const mostRecent = past[past.length - 1]
    if (!mostRecent) continue
    if (bill.start_date && mostRecent < bill.start_date) continue
    const occ = {
      date: mostRecent,
      name: bill.name,
      amount: Number(bill.amount || 0),
      category: bill.category || 'Bills',
      billId: bill.id,
    }
    if (!isBillOccurrencePaid(occ, transactions, fromIso, OVERDUE_PAID_WINDOW_DAYS)) {
      overdue.push({ ...occ, date: fromIso, overdue: true, originalDate: mostRecent })
    }
  }
  return [...preStartHolds, ...overdue, ...forward].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function overdueGoalCovers(bill, goals = []) {
  const billWords = significantWords(bill.name || '').filter(
    (w) => w.length > 2 && !['overdue', 'bill', 'unpaid', 'payment', 'the', 'and'].includes(w)
  )
  if (!billWords.length) return false
  return (goals || []).some((g) => {
    if (g.status !== 'active' || g.reserved === false) return false
    const n = String(g.name || '').toLowerCase()
    if (!n.includes('overdue')) return false
    const gWords = significantWords(g.name || '')
    const shared = billWords.filter((w) => gWords.includes(w) || n.includes(w))
    if (shared.length >= 2) return true
    return shared.some((w) => w.length >= 5 || /\d/.test(w))
  })
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

// How this paycheck is spoken for: each goal, smoothed bill, smoothed debt,
// and everyday budgets. `free` is what's left after those assignments.
export function paycheckSplit({
  amount = 0,
  name = '',
  date = null,
  goals = [],
  bills = [],
  debts = [],
  everyday = 0,
} = {}) {
  const lines = []
  for (const g of goals) {
    const n = round2(g.perPaycheck)
    if (n > 0) lines.push({ id: g.id, name: g.name, amount: n, kind: 'goal' })
  }
  for (const b of bills) {
    const n = round2(b.perPaycheck)
    if (n > 0) lines.push({ id: b.id, name: b.name, amount: n, kind: 'bill' })
  }
  for (const d of debts) {
    const n = round2(d.perPaycheck)
    if (n > 0) lines.push({ id: d.id, name: d.name, amount: n, kind: 'debt' })
  }
  const ev = round2(everyday)
  if (ev > 0) lines.push({ id: 'everyday', name: 'Everyday spending', amount: ev, kind: 'everyday' })
  const assigned = round2(lines.reduce((s, l) => s + l.amount, 0))
  const pay = round2(amount)
  return { amount: pay, name, date, lines, assigned, free: round2(pay - assigned) }
}

// What would close a negative Safe-to-spend, largest holds first. Pause-goal
// and hide-debt are real actions; everyday is informational (spend less).
export function gapClosers({ gap, goalLines = [], everydayTotal = 0, debtHeld = 0, counting = {} } = {}) {
  const g = Math.max(0, Number(gap) || 0)
  const actions = []
  const goals = [...goalLines].sort((a, b) => Number(b.perPaycheck || 0) - Number(a.perPaycheck || 0))
  for (const x of goals) {
    const frees = Number(x.perPaycheck || 0)
    if (frees >= 1) {
      actions.push({
        id: `goal-${x.id}`,
        kind: 'pause-goal',
        goalId: x.id,
        name: x.name,
        frees,
        label: `Pause ${x.name}`,
      })
    }
  }
  if (counting.debt !== false && debtHeld >= 1) {
    actions.push({
      id: 'debt',
      kind: 'hide-debt',
      frees: debtHeld,
      label: 'Leave debt out this period',
    })
  }
  if (everydayTotal >= 1) {
    actions.push({
      id: 'everyday',
      kind: 'everyday',
      frees: everydayTotal,
      label: 'Cut everyday leftover',
    })
  }
  let covered = 0
  const plan = []
  for (const a of actions) {
    if (covered >= g - 0.5) break
    plan.push(a)
    covered += a.frees
  }
  return { gap: g, plan, covered: round2(covered), remaining: Math.max(0, round2(g - covered)) }
}

// Best nearby charge that looks like this unpaid bill, even if the match isn't
// strict enough to count as paid. Null if nothing is close.
export function suggestBillPayment(occ, transactions = [], todayIso = isoDate()) {
  const amt = Number(occ.amount || 0)
  const billWords = significantWords(occ.name || '')
  const from = isoDate(new Date(parseISO(occ.date).getTime() - OVERDUE_PAID_WINDOW_DAYS * DAY_MS))
  let best = null
  let bestScore = 0
  for (const t of transactions) {
    const ta = Number(t.amount || 0)
    if (ta <= 0) continue
    const d = t.txn_date || ''
    if (d < from || d > todayIso) continue
    const words = significantWords(t.merchant || '')
    const wordHit = billWords.length > 0 && words.some((w) => billWords.includes(w))
    const exactAmt = Math.abs(ta - amt) <= Math.max(0.5, amt * 0.02)
    const closeAmt = Math.abs(ta - amt) <= Math.max(1, amt * 0.2)
    if (!exactAmt && !wordHit && !closeAmt) continue
    let score = 0
    if (wordHit) score += 3
    if (exactAmt) score += 3
    else if (closeAmt) score += 1
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  if (bestScore < 3) return null
  return best
}

// "Safe to spend right now": the honest number the user wants each morning.
// Start from the bank balance (Rule 1), then set aside everything that isn't
// truly free to spend before the next paycheck arrives:
//   - bills due before the next confirmed paycheck (Rule 2: only confirmed income)
//   - the untouchable buffer floor (Rule 4)
//   - money already set aside in trip/event funds (Rule 5)
// Money spent against a specific goal (sum of transactions tagged to it).
export function goalSpent(goalId, transactions = []) {
  if (!goalId) return 0
  return transactions.reduce(
    (s, t) => (t.goal_id === goalId ? s + Number(t.amount || 0) : s),
    0
  )
}

// Spent-per-goal for EVERY goal in one pass, instead of calling goalSpent once
// per goal (each of which re-scans the whole transaction list) — turns
// O(goals × transactions) into O(transactions). Returns { goalId: total }.
export function goalSpentMap(transactions = []) {
  const map = {}
  for (const t of transactions) {
    if (!t.goal_id) continue
    map[t.goal_id] = (map[t.goal_id] || 0) + Number(t.amount || 0)
  }
  return map
}

// Money earmarked across all goals that is still being held (saved but not yet
// spent). Once you spend earmarked money it has left the account, so it stops
// being held out of "safe to spend" — that's the (saved − spent) per goal.
export function totalEarmarked(goals = [], transactions = [], accounts = []) {
  const byId = {}
  for (const a of accounts) byId[a.id] = a
  return goals.reduce((sum, g) => {
    // A finished goal's money is no longer reserved (matches accountBuckets,
    // which drops done goals from a bucket's allocation).
    if (g.status === 'done') return sum
    // Money that physically lives in a non-spendable OR hidden account is already
    // out of the spendable base — don't hold it out of Safe to spend a 2nd time.
    const acct = g.account_id ? byId[g.account_id] : null
    if (acct && (acct.hidden || !countsAsSpendable(acct))) return sum
    const reserved = Number(g.current || 0) - goalSpent(g.id, transactions)
    return sum + Math.max(0, reserved)
  }, 0)
}

// A savings account "buckets" view: the goals tied to it and how much of the
// account each holds (their saved amount). Balance − allocated = unassigned.
export function accountBuckets(account, goals = []) {
  const tied = goals.filter((g) => g.account_id === account?.id && g.status !== 'done')
  const allocated = tied.reduce((s, g) => s + Math.max(0, Number(g.current || 0)), 0)
  return { tied, allocated }
}

// Conservative window (calendar days) to wait for a Capital One transfer to show
// up via Plaid before treating an over-assigned bucket as a likely-failed move.
export const BUCKET_SYNC_DAYS = 7

// Reconciliation status for a savings account whose buckets hold more than the
// bank has synced. Returns null when the balance already covers every bucket
// (confirmed). Otherwise 'pending' (still within the sync window) or 'failed'
// (a logged transfer that never showed up — check it went through). The age is
// taken from the OLDEST logged bucket-fill needed to cover the shortfall, so a
// transfer that has had time to arrive doesn't raise a false alarm.
export function bucketReconcile(account, goals = [], transactions = [], today = isoDate()) {
  if (!account) return null
  const { allocated } = accountBuckets(account, goals)
  const balance = Number(account.balance || 0)
  const over = Math.round((allocated - balance) * 100) / 100
  if (over <= 0) return null
  // Logged transfers INTO this account, newest first — money Matt says he moved.
  const fills = (transactions || [])
    .filter((t) => t.bucket_goal_id && t.account_id === account.id && Number(t.amount || 0) > 0)
    .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
  let acc = 0
  let since = null
  for (const f of fills) {
    acc += Number(f.amount || 0)
    since = f.txn_date
    if (acc >= over) break
  }
  // No logged transfer covers the shortfall → this isn't money in flight, it's a
  // data mismatch (a goal's "Saved so far" set higher than the bank shows). Flag
  // it neutrally so we never claim a phantom transfer is "on the way" forever.
  if (since === null) {
    return { status: 'unfunded', amount: over, since: null, days: null, windowDays: BUCKET_SYNC_DAYS }
  }
  const days = Math.floor((parseISO(today) - parseISO(since)) / DAY_MS)
  const status = days > BUCKET_SYNC_DAYS ? 'failed' : 'pending'
  return { status, amount: over, since, days, windowDays: BUCKET_SYNC_DAYS }
}

// The most recent real payday across all income sources, on or before
// `todayIso` — used to anchor "this pay period" to a REAL payday instead of an
// approximate day-count. Looks back 40 days (enough for any cadence). Returns
// null if no source has a determinable past occurrence (e.g. a brand-new
// source whose first payday hasn't landed yet).
export function mostRecentPaydayIso(sources = [], todayIso = isoDate()) {
  const lookback = isoDate(new Date(parseISO(todayIso).getTime() - 40 * DAY_MS))
  let latest = null
  for (const src of sources || []) {
    if (src.active === false) continue
    const occs = incomeOccurrences(src, lookback, 40).filter((d) => d <= todayIso)
    const last = occs[occs.length - 1]
    if (last && (!latest || last > latest)) latest = last
  }
  return latest
}

// "Everyday spending" held out of safe-to-spend: the money still reserved in this
// pay-period's category budgets — each budget's per-paycheck share minus what
// you've already spent in that category this period, floored at 0. This makes
// safe-to-spend "what's free for extras" rather than the whole pot. Because it
// nets out actual spending, buying $50 of groceries lowers your balance AND this
// reserve by $50 — the same money is never counted twice. Categories you haven't
// budgeted aren't held back at all (they just spend from safe-to-spend normally).
export function everydayHoldback(budgets = [], transactions = [], { ppy = 26, periodStartIso, today = isoDate() } = {}) {
  if (!budgets.length) return { total: 0, byCat: [] }
  // Anchor to the real last payday when the caller has one — a day-count
  // approximation drifts by a day every day (with no real event behind it),
  // and disagrees with the calendar-month window every other budget view uses.
  const start = periodStartIso || isoDate(new Date(parseISO(today).getTime() - Math.round(365 / ppy) * DAY_MS))
  // Match spending to budgets by category name, case-insensitively and ignoring
  // tagged income — exactly how spendByCategory / the Insights budget bars match,
  // so the "budgets left" here always agrees with what those show. Precompute the
  // learned-category map once (O(n)) instead of letting cleanCategory re-scan the
  // whole transaction history for every in-period transaction.
  const learnedMap = buildLearnedCategoryMap(transactions)
  const spent = {}
  for (const t of transactions || []) {
    const d = t.txn_date || ''
    if (d < start || d > today) continue
    if (t.income_source) continue // tagged income isn't category spend
    const cat = cleanCategory(t, transactions, learnedMap).trim().toLowerCase()
    spent[cat] = (spent[cat] || 0) + Number(t.amount || 0)
  }
  const byCat = budgets.map((b) => {
    const perPeriod = ((Number(b.monthly_limit) || 0) * 12) / ppy
    const s = Math.max(0, spent[(b.category || '').trim().toLowerCase()] || 0)
    return { category: b.category, perPeriod, spent: s, remaining: Math.max(0, perPeriod - s) }
  })
  const total = Math.round(byCat.reduce((s, c) => s + c.remaining, 0) * 100) / 100
  return { total, byCat }
}

export function spendableToday(
  startBalance,
  { bills = [], incomes = [], buckets = [], bufferFloor = 0, earmarked = 0, setAside = 0, goalReserve = 0, everyday = 0, smoothed = 0, transactions = [], fromIso = isoDate(), horizonDays = 60, goals = [] } = {}
) {
  const start = Number(startBalance || 0)
  const floor = Number(bufferFloor || 0)
  const reserved = Number(earmarked || 0)
  const held = Number(setAside || 0)
  const goalHeld = Number(goalReserve || 0)
  const everydayHeld = Number(everyday || 0)
  const smoothedHeld = Number(smoothed || 0)

  // Plan against the next FUTURE paycheck. On payday itself the paycheck is
  // (or is about to be) in the balance, so the planning window runs to the
  // following one — otherwise bills due today would fall outside the window
  // and money already spoken for would look spendable.
  const upIncome = upcomingIncome(incomes, fromIso, horizonDays, transactions)
  const nextIncome = upIncome.find((i) => i.date > fromIso) || upIncome[0] || null

  // Only bills that haven't actually been paid yet hold money back — once a
  // matching payment shows up in the transactions feed, the bill lets go.
  // With no paycheck on the calendar, plan one month ahead (not the whole
  // horizon — that would double-count monthly bills).
  const windowEnd = nextIncome
    ? nextIncome.date
    : isoDate(new Date(parseISO(fromIso).getTime() + 31 * DAY_MS))
  const upBills = unpaidBills(bills, transactions, fromIso, horizonDays, goals)
  const thisWindow = []
  const later = []
  const windowBillIds = new Set()
  for (const b of upBills) {
    const due = b.originalDate || b.date
    if (b.overdue) continue
    if (b.preStart) {
      later.push({ ...b, due })
      continue
    }
    if (due <= windowEnd) {
      thisWindow.push(b)
      windowBillIds.add(b.billId || b.id)
    }
  }
  const laterOnly = later.filter((b) => !windowBillIds.has(b.billId || b.id))
  const billsBeforePay = thisWindow.reduce((sum, b) => sum + Number(b.amount || 0), 0)
  const soonest = new Map()
  for (const b of laterOnly) {
    const id = b.billId || b.id || b.name
    const prev = soonest.get(id)
    if (!prev || b.due < prev.due) soonest.set(id, b)
  }
  const laterItems = [...soonest.values()].map((b) => {
    const amount = Number(b.amount || 0)
    const n = Math.max(1, paydayCount(incomes, fromIso, b.due, transactions))
    return {
      id: b.billId || b.id || b.name,
      name: b.name,
      amount,
      due: b.due,
      share: amount / n,
      category: b.category || 'Bills',
    }
  })
  const laterShare = laterItems.reduce((sum, x) => sum + x.share, 0)

  const tripFunds = buckets.reduce((sum, b) => sum + Number(b.current || 0), 0)

  const spendable =
    start - billsBeforePay - laterShare - floor - tripFunds - reserved - held - goalHeld - everydayHeld - smoothedHeld

  return {
    spendable,
    start,
    floor,
    billsBeforePay,
    laterShare,
    laterItems,
    tripFunds,
    earmarked: reserved,
    setAside: held,
    goalReserve: goalHeld,
    everyday: everydayHeld,
    smoothed: smoothedHeld,
    nextIncome,
  }
}

// Rule 6: figure out which spending phase we're in today, and whether the next
// phase boundary is coming up soon (so the app can flag the transition early).
export function phaseStatus(phases = [], todayIso = isoDate(), warnWithinDays = 7) {
  if (!phases.length) return null
  const sorted = [...phases].sort((a, b) =>
    a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0
  )
  const today = parseISO(todayIso)

  let current = null
  for (const p of sorted) {
    const start = parseISO(p.starts_on)
    const end = p.ends_on ? parseISO(p.ends_on) : null
    if (start <= today && (!end || today <= end)) {
      current = p
      break
    }
  }
  // Before the first phase starts, treat the earliest as "upcoming current".
  if (!current && today < parseISO(sorted[0].starts_on)) current = null

  const next = sorted.find((p) => parseISO(p.starts_on) > today) || null
  let daysToNext = null
  if (next) {
    daysToNext = Math.round(
      (parseISO(next.starts_on) - today) / DAY_MS
    )
  }
  const transitionSoon = next && daysToNext !== null && daysToNext <= warnWithinDays

  return { current, next, daysToNext, transitionSoon }
}

// One-time dated goals turned into scheduled cashflow events for the projection.
//   status 'planned'        -> money OUT on target_date. Always counted: an
//     outflow you've decided on is real, so the forecast should set it aside.
//   status 'pending_inflow' -> money IN, but treated like unconfirmed side
//     income (Rule 2): shown in the app, NOT counted here until it lands. We
//     never let an expected sale make the balance look safe before it arrives.
//   'deferred' / 'active' / 'done' never generate projection events.
export function datedGoalEvents(goals = [], fromIso = isoDate(), horizonDays = 30, transactions = []) {
  const from = parseISO(fromIso)
  const end = new Date(from.getTime() + horizonDays * DAY_MS)
  const out = []
  for (const g of goals) {
    if (g.status !== 'planned' || !g.target_date) continue
    const d = parseISO(g.target_date)
    if (d < from || d > end) continue
    // Payments already made toward the item (transactions linked to it) come
    // off the top — an off-cycle or partial payment shrinks what the forecast
    // still sets aside. Fully paid → nothing left to hold.
    // Net out BOTH money already saved into the goal (current) and money already
    // spent on it. The saved portion is held separately via totalEarmarked, so
    // the forecast must only project the still-unfunded remainder — otherwise the
    // saved dollars get held out twice (once here, once as an earmark).
    const remaining = Math.max(
      0,
      Number(g.target || 0) - Number(g.current || 0) - goalSpent(g.id, transactions)
    )
    if (remaining <= 0) continue
    out.push({
      date: g.target_date,
      name: g.name,
      amount: remaining,
      delta: -remaining,
      kind: 'goal',
    })
  }
  return out
}

// Everyday/discretionary spending (food, gas, pet, etc.) modeled as a steady
// daily drain so the forecast isn't falsely rosy. Without this the projection
// silently assumes you spend $0 on variable categories for the whole window.
// We spread each category's monthly ceiling evenly across the month (~1/30 a
// day) and emit one small outflow per day.
export function variableSpendEvents(budgets = [], fromIso = isoDate(), horizonDays = 30) {
  const monthlyTotal = budgets.reduce((s, b) => s + Number(b.monthly_limit || 0), 0)
  if (monthlyTotal <= 0) return []
  const perDay = monthlyTotal / 30
  const from = parseISO(fromIso)
  const out = []
  for (let i = 1; i <= horizonDays; i++) {
    const d = isoDate(new Date(from.getTime() + i * DAY_MS))
    out.push({
      date: d,
      name: 'Everyday spending',
      amount: perDay,
      delta: -perDay,
      kind: 'spend',
    })
  }
  return out
}

// Cash runway: if all income stopped today, how many days until spendable cash
// would fall to the buffer floor — counting fixed bills plus the everyday-spend
// drain. Answers "how long could I coast if work dried up?" Capped at `cap`.
export function runwayDays(
  startBalance,
  bills = [],
  monthlyVariable = 0,
  floor = 0,
  fromIso = isoDate(),
  cap = 365
) {
  let running = Number(startBalance || 0)
  const stop = Number(floor || 0)
  if (running <= stop) return 0
  const perDay = Number(monthlyVariable || 0) / 30
  const byDate = {}
  for (const b of upcomingBills(bills, fromIso, cap)) {
    byDate[b.date] = (byDate[b.date] || 0) + Number(b.amount || 0)
  }
  const from = parseISO(fromIso)
  for (let i = 1; i <= cap; i++) {
    const d = isoDate(new Date(from.getTime() + i * DAY_MS))
    running -= perDay
    if (byDate[d]) running -= byDate[d]
    if (running <= stop) return i
  }
  return cap // lasts beyond the horizon we bother to simulate
}

// Merge bills (money out) and confirmed income (money in) — plus any extra
// pre-signed events (e.g. dated goals) — into one date-sorted timeline. On the
// same day, income is applied before money-out events (a paycheck posts, then
// bills/payments clear) to avoid false "dip" alarms.
export function mergeTimeline(bills = [], incomes = [], extra = []) {
  const events = [
    ...bills.map((b) => ({ ...b, delta: -Math.abs(Number(b.amount || 0)), kind: 'bill' })),
    ...incomes.map((i) => ({ ...i, delta: Math.abs(Number(i.amount || 0)), kind: 'income' })),
    ...extra,
  ]
  const rank = (k) => (k === 'income' ? 0 : 1)
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return rank(a.kind) - rank(b.kind)
  })
  return events
}

// Rule 3 + Rule 4: walk the balance forward through the merged timeline and
// report the first point it crosses the buffer floor (warning) or zero
// (critical). `events` are signed (negative = bill, positive = income).
export function projectBalance(startBalance, events, bufferFloor = 0) {
  let running = Number(startBalance || 0)
  const points = []
  let breachFloor = null
  let breachZero = null
  let lowest = running
  let lowestPoint = null

  for (const ev of events) {
    running += ev.delta
    const point = { ...ev, balanceAfter: running }
    points.push(point)
    if (running < lowest) {
      lowest = running
      lowestPoint = point
    }
    if (breachZero === null && running < 0) {
      breachZero = point
    }
    if (breachFloor === null && bufferFloor > 0 && running < bufferFloor) {
      breachFloor = point
    }
  }

  return {
    points,
    lowest,
    lowestPoint, // the event at which the trough is reached (date + cause)
    endingBalance: running,
    breachFloor, // first time it dips below the untouchable reserve
    breachZero, // first time it would actually go negative
  }
}
