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
  countsAsSpendable,
  accountSummaries,
  totalEarmarked,
  everydayHoldback,
  mostRecentPaydayIso,
  payPeriodsPerYear,
  goalPaycheckShare,
  goalSpent,
  debtsAsBills,
} from './budget.js'
import { isoDate } from './format.js'

// Cash that is actually in Safe to spend.
// The account switch decides which accounts count.
// A missing available balance is not replaced with the current balance.
export function checkingBalance(data) {
  return accountSummaries(data.accounts || [], data.balances || [])
    .filter((a) => !a.hidden && countsAsSpendable(a) && !/credit|card|loan/i.test(a.kind || a.type || ''))
    .reduce((sum, a) => sum + (Number.isFinite(a.balance) ? a.balance : 0), 0)
}

// This paycheck's hold for a debt.
// The monthly payment is unchanged by an extra payment.
// If the balance is now below one monthly payment, this check holds only what's left.
export function debtPaycheckShare(debt, periodsPerYear) {
  const monthly = Number(debt?.plan_payment || 0)
  if (!(monthly > 0)) return 0
  const periods = Math.max(1, Number(periodsPerYear) || 12)
  const slice = (monthly * 12) / periods
  const owed = Math.max(0, Number(debt?.balance || 0))
  const share = owed < monthly ? owed : Math.min(slice, owed)
  return Math.round(share * 100) / 100
}

/** @param {{ data?: any, todayIso?: string, state?: any }} [options] */
export function computePaycheckPlan({ data, todayIso, state = {} } = {}) {
  const d = data || {}
  const today = todayIso || isoDate()
  const bills = (d.bills || []).filter((b) => b.active !== false)
  const incomes = d.income || []
  const transactions = d.transactions || []
  const buckets = d.buckets || []
  const goals = d.goals || []
  const held = totalSetAside(d.setAsides)

  const start = checkingBalance(d)
  const ppy = payPeriodsPerYear(incomes)
  const nextPay = upcomingIncome(incomes, today, 60, transactions).find((i) => i.date > today)
  const goalShares = goalPaycheckShare(goals, transactions, ppy, incomes, today, nextPay?.date)
  const planRows = []
  for (const g of goals) {
    if (g.status === 'done' || g.status === 'paused' || g.reserved === false || (g.status === 'planned' && !g.reserved)) continue
    const remaining = Math.max(0, Number(g.target || 0) - Math.max(Number(g.current || 0), goalSpent(g.id, transactions)))
    const paced = goalShares.items.find((x) => x.id === g.id)?.perPaycheck || 0
    const share = Math.min(remaining, Math.max(0, paced, Number(g.monthly_contribution || 0) * 12 / ppy))
    if (share > 0) planRows.push({ id: `g-${g.id}`, name: g.name, share, kind: 'Goal', note: 'Each paycheck' })
  }
  for (const debt of d.debts || []) {
    if (debt.active === false) continue
    // The regular share prepares for later payments. An actual due payment
    // needs its full remaining amount, counted once rather than plus its share.
    const asBills = debtsAsBills([{ ...debt, smooth: false }])
    const due = spendableToday(0, { bills: asBills, incomes, transactions, fromIso: today })
    const remaining = Math.max(0, Number(debt.balance || 0))
    const share = Math.min(remaining, Math.max(debtPaycheckShare(debt, ppy), due.billsBeforePay + due.laterShare))
    if (share > 0) planRows.push({ id: `d-${debt.id}`, name: debt.name, share, kind: 'Debt', note: debt.start_date > today ? `Starts ${debt.start_date} · saving now` : due.billsBeforePay > 0 ? 'Includes payment due before payday' : 'Each paycheck' })
  }
  const goalReserve = planRows.filter((r) => r.kind === 'Goal' && !state.planOff?.[r.id]).reduce((n, r) => n + r.share, 0)
  const debtReserve = planRows.filter((r) => r.kind === 'Debt' && !state.planOff?.[r.id]).reduce((n, r) => n + r.share, 0)
  const everyday = everydayHoldback(d.budgets || [], transactions, { ppy, periodStartIso: mostRecentPaydayIso(incomes, today), today })
  const info = spendableToday(start, {
    bills, incomes, buckets, transactions, goals, setAside: held, fromIso: today,
    bufferFloor: d.settings?.buffer_floor || 0,
    earmarked: totalEarmarked(goals, transactions, d.accounts || []),
    goalReserve, everyday: everyday.total, smoothed: debtReserve,
  })
  if (state.spreadBills === false) info.spendable = Math.round((info.spendable + info.laterShare) * 100) / 100

  // Next few paydays (all income sources, unreceived occurrences).
  const paydays = upcomingIncome(incomes, today, 45, transactions).slice(0, 4)

  const setAsideTotal = Math.max(0, Number(info.billsBeforePay || 0)) + Math.max(0, Number(info.laterShare || 0))
  const safeToSpend = Number(info.spendable || 0)

  // Days left until the next payday, for a simple per-day number.
  const nextIncome = info.nextIncome || null
  const daysLeft = nextIncome
    ? Math.max(1, Math.ceil((new Date(nextIncome.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000))
    : null
  const perDay = daysLeft && safeToSpend > 0 ? safeToSpend / daysLeft : null

  // "This paycheck" assignment: each line is this paycheck's share of a need.
  const lines = [
    ...(info.windowItems || []).map((b) => ({
      id: `due-${b.id}-${b.due}`,
      name: b.name,
      detail: b.due ? `due ${b.due.slice(5)}` : 'due soon',
      amount: b.amount,
      kind: 'due',
    })),
    ...(info.laterItems || []).map((b) => ({
      id: `share-${b.id}-${b.due}`,
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
    planRows,
    debtReserve,
    everyday,
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
