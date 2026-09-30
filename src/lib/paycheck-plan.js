// @ts-nocheck
// Paycheck-cycle planning for Matt's Money.
//
// This wires the app's existing paycheck engine (src/lib/budget.js) to the
// data shape the dashboard loads, so every screen can answer the one question
// that matters: "what do I do with THIS paycheck?"
//
// Per paycheck the plan says:
//   1. what must be set aside  (bills due before the next payday, in full,
//      plus this paycheck's share of bills due later)
//   2. what is genuinely safe to spend (checking balance minus everything
//      already spoken for)
//   3. when the next paydays land
import {
  spendableToday,
  upcomingIncome,
  totalSetAside,
} from './budget.js'
import { isoDate } from './format.js'

// Latest known balance per account, checking-kind accounts summed.
export function checkingBalance(data) {
  const accounts = data.accounts || []
  const balances = data.balances || []
  const latestByAcct = {}
  for (const b of balances) {
    const id = b.account_id
    if (!latestByAcct[id] || String(b.as_of) > String(latestByAcct[id].as_of)) latestByAcct[id] = b
  }
  let total = 0
  for (const a of accounts) {
    if (a.hidden) continue
    const kind = String(a.kind || a.type || '').toLowerCase()
    if (/credit|card|loan/.test(kind)) continue
    const bal = latestByAcct[a.id]
    const available = bal?.available_balance ?? bal?.available
    const current = bal?.current_balance ?? bal?.balance ?? a.balance
    const shown = available != null ? Number(available) : Number(current || 0)
    if (/sav/.test(kind)) continue // savings are spoken for elsewhere
    total += shown
  }
  return total
}

export function computePaycheckPlan({ data, todayIso } = {}) {
  const d = data || {}
  const today = todayIso || isoDate()
  const bills = (d.bills || []).filter((b) => b.active !== false)
  const incomes = d.income || []
  const transactions = d.transactions || []
  const buckets = d.buckets || []
  const goals = d.goals || []
  const held = totalSetAside(d.setAsides)

  const start = checkingBalance(d)
  const info = spendableToday(start, {
    bills,
    incomes,
    buckets,
    transactions,
    goals,
    setAside: held,
    fromIso: today,
  })

  // Next few paydays (all income sources, unreceived occurrences).
  const paydays = upcomingIncome(incomes, today, 45, transactions).slice(0, 4)

  const setAsideTotal = Math.max(0, Number(info.billsBeforePay || 0)) + Math.max(0, Number(info.laterShare || 0))
  const safeToSpend = Number(info.spendable || 0)

  // Days left until the next payday, for a simple per-day number.
  const nextIncome = info.nextIncome || null
  const daysLeft = nextIncome
    ? Math.max(1, Math.ceil((new Date(nextIncome.date + 'T00:00:00') - new Date()) / 86400000))
    : null
  const perDay = daysLeft && safeToSpend > 0 ? safeToSpend / daysLeft : null

  // "This paycheck" assignment: each line is this paycheck's share of a need.
  const lines = [
    ...(info.windowItems || []).map((b) => ({
      id: `due-${b.id}`,
      name: b.name,
      detail: b.due ? `due ${b.due.slice(5)}` : 'due soon',
      amount: b.amount,
      kind: 'due',
    })),
    ...(info.laterItems || []).map((b) => ({
      id: `share-${b.id}`,
      name: b.name,
      detail: b.due ? `due ${b.due.slice(5)} · ${moneyShort(b.amount)} total` : `${moneyShort(b.amount)} total`,
      amount: b.share,
      kind: 'share',
    })),
  ]
  const assignment = nextIncome
    ? {
        amount: Number(nextIncome.amount || 0),
        name: nextIncome.name,
        date: nextIncome.date,
        lines,
        total: setAsideTotal,
        free: Number(nextIncome.amount || 0) - setAsideTotal,
      }
    : null

  return {
    today,
    start,
    info,
    paydays,
    nextIncome,
    setAsideTotal,
    safeToSpend,
    daysLeft,
    perDay,
    assignment,
    hasIncome: incomes.some((s) => s.active !== false),
    hasBills: bills.length > 0,
  }
}

function moneyShort(n) {
  const v = Number(n || 0)
  return `$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: v % 1 ? 2 : 0 })}`
}
