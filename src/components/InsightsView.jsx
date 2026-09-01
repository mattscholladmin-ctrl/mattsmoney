// @ts-nocheck
import { useMemo, useState } from 'react'
import { money, monthKey, shortDate } from '../lib/format'
import { monthlyTotals, netWorthSeries, recurringOutflows, payoffPlan, projectBalance, spendByCategory, cleanCategory, categoriesInUse, NON_SPENDING } from '../lib/budget'
import { DonutChart, LineChart, BarChart, CHART_COLORS, abbrevMoney } from './Charts'
import CategoryBudgets from './CategoryBudgets'
import { renameBudget, setTransactionsCategory, upsertCategoryAlias } from '../lib/api'
import RecurringBillsCard from './RecurringBillsCard'
import UnusualChargesCard from './UnusualChargesCard'
import { TileColumns } from './TileFrame'
import { useTileLayout } from '../lib/tileLayout'

const INSIGHTS_TILE_NAMES = {
  wheregoes: 'Where it goes',
  monthly: 'Month by month',
  setbudgets: 'Budgets',
  recurringbills: 'Recurring bills',
  budget: 'Budget vs actual',
  merchants: 'Top merchants',
  payoff: 'Debt payoff plan',
  whatif: 'What if?',
  newnormal: 'New Normal',
  subscriptions: 'Subscriptions & recurring',
  unusual: 'Unusual charges',
  networth: 'Net worth over time',
}
const INSIGHTS_TILE_IDS = Object.keys(INSIGHTS_TILE_NAMES)
const DEFAULT_INSIGHTS_LAYOUT = {
  left: ['wheregoes', 'setbudgets', 'recurringbills', 'monthly'],
  right: ['budget', 'merchants', 'payoff', 'whatif', 'newnormal', 'subscriptions', 'unusual', 'networth'],
}

// "New Normal" scenario tool: how often each income/expense line recurs.
const NN_CADENCES = [
  { v: 'monthly', label: '/mo', perYear: 12, days: 30 },
  { v: 'biweekly', label: '/2 wks', perYear: 26, days: 14 },
  { v: 'weekly', label: '/wk', perYear: 52, days: 7 },
]
const nnAddDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const RANGES = [
  { id: 'this', label: 'This month', months: 1 },
  { id: 'last', label: 'Last month', months: 1 },
  { id: '3m', label: '3 mo', months: 3 },
  { id: '6m', label: '6 mo', months: 6 },
  { id: '12m', label: '12 mo', months: 12 },
  { id: 'all', label: 'All', months: 999 },
]

function monthShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short' })
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// Sum spending for transactions whose date falls in [from, to). Same
// convention as spendByCategory: a refund (amount < 0, not tagged income)
// nets against the category/merchant it refunds instead of being ignored —
// each net floored at 0 (not the transaction itself), so it can't turn into
// a phantom negative. `total` is the sum of that already-floored breakdown,
// not a separately-netted figure, so an untagged deposit can't offset an
// unrelated category's real spend.
function totalsIn(transactions, from, to) {
  let count = 0
  const byCat = {}
  const byMerchant = {}
  for (const t of transactions) {
    const d = new Date(t.txn_date + 'T00:00:00')
    if (!(d >= from && d < to)) continue
    if (t.income_source) continue // tagged income isn't spend, refund or not
    const amt = Number(t.amount || 0)
    const c = cleanCategory(t, transactions)
    if (NON_SPENDING.has(c.trim().toLowerCase())) continue // transfers/debt aren't spending
    byCat[c] = (byCat[c] || 0) + amt
    const m = t.merchant || '—'
    byMerchant[m] = (byMerchant[m] || 0) + amt
    if (amt > 0) count++
  }
  for (const k of Object.keys(byCat)) byCat[k] = Math.max(0, byCat[k])
  for (const k of Object.keys(byMerchant)) byMerchant[k] = Math.max(0, byMerchant[k])
  const total = Object.values(byCat).reduce((s, v) => s + v, 0)
  return { total, byCat, byMerchant, count }
}

export default function InsightsView({
  transactions = [],
  budgets = [],
  accounts = [],
  balances = [],
  debts = [],
  goals = [],
  bills = [],
  safeToSpend = null,
  newNormal = null,
  periodStartIso = null,
  onChanged = () => {},
  arranging = false,
}) {
  const tilesState = useTileLayout('insights', INSIGHTS_TILE_IDS, DEFAULT_INSIGHTS_LAYOUT)
  const recurring = useMemo(() => recurringOutflows(bills, transactions), [bills, transactions])
  const [extraPay, setExtraPay] = useState('')
  const [strategy, setStrategy] = useState('avalanche')
  const plan = useMemo(
    () => payoffPlan(debts, Number(extraPay) || 0, strategy, goals),
    [debts, extraPay, strategy, goals]
  )
  // "What if?" scenario — a one-time income bump and/or extra monthly debt
  // payment, compared against the baseline. Nothing here is saved.
  const [wiIncome, setWiIncome] = useState('')
  const [wiDebt, setWiDebt] = useState('')
  const basePlan = useMemo(() => payoffPlan(debts, 0, 'avalanche', goals), [debts, goals])
  const scenPlan = useMemo(() => payoffPlan(debts, Number(wiDebt) || 0, 'avalanche', goals), [debts, wiDebt, goals])
  const wiNewSafe = (Number(safeToSpend) || 0) + (Number(wiIncome) || 0) - (Number(wiDebt) || 0)
  const wiMonthsSaved =
    basePlan && scenPlan && !basePlan.capped && !scenPlan.capped
      ? basePlan.months - scenPlan.months
      : null
  const wiInterestSaved = basePlan && scenPlan ? basePlan.totalInterest - scenPlan.totalInterest : null

  // ---- "New Normal": add income/expense lines on top of a NORMALIZED per-paycheck
  // baseline (independent of the current cycle), and toggle whether goals / debt
  // payments count — to model life during vs. after a goal or a paid-off debt.
  const [nnIncome, setNnIncome] = useState([])
  const [nnExpense, setNnExpense] = useState([])
  // "Spend less" lines model cutting your spending by an amount — numerically the
  // same lift as income (more money free each paycheck), just a different mental model.
  const [nnSpendLess, setNnSpendLess] = useState([])
  const [nnCount, setNnCount] = useState({ goals: true, debt: true })
  const nnPpy = newNormal?.ppy || 26
  const nnPP = newNormal?.perPaycheck || { income: 0, bills: 0, everyday: 0, debt: 0, goal: 0 }
  const nnPerPaycheck = (amount, cadence) => {
    const c = NN_CADENCES.find((x) => x.v === cadence) || NN_CADENCES[0]
    return ((Number(amount) || 0) * c.perYear) / nnPpy
  }
  const nnIncPP = nnIncome.reduce((s, l) => s + nnPerPaycheck(l.amount, l.cadence), 0)
  const nnExpPP = nnExpense.reduce((s, l) => s + nnPerPaycheck(l.amount, l.cadence), 0)
  // Spending you'd cut frees up money just like income does, so it adds to the net.
  const nnSpendPP = nnSpendLess.reduce((s, l) => s + nnPerPaycheck(l.amount, l.cadence), 0)
  const nnNetPP = nnIncPP + nnSpendPP - nnExpPP
  // Steady baseline: regular paycheck − recurring bills − everyday spending −
  // (debt) − (goals), per paycheck. Not tied to the current cycle. Everyday
  // spending always counts; only debt and goals have chips.
  const nnBaseline =
    nnPP.income - nnPP.bills - (nnPP.everyday || 0) - (nnCount.debt ? nnPP.debt : 0) - (nnCount.goals ? nnPP.goal : 0)
  const nnNewSafe = nnBaseline + nnNetPP
  const nnHasEntries = nnIncPP > 0 || nnExpPP > 0 || nnSpendPP > 0
  const nnHasBaseline = newNormal != null
  const nnUpdate = (setList, id, patch) => setList((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const nnRemove = (setList, id) => setList((rows) => rows.filter((r) => r.id !== id))
  const nnAdd = (setList) =>
    setList((rows) => [...rows, { id: Math.max(0, ...rows.map((r) => r.id)) + 1, label: '', amount: '', cadence: 'monthly' }])

  // Re-project the next few paycheck cycles: base timeline (income + bills), plus
  // debt and goal drains only when their chip is on, plus the hypothetical lines.
  const nnCycles = useMemo(() => {
    if (!newNormal) return []
    const { startBal, bufferFloor = 0, events = {}, paydays = [], today } = newNormal
    const synth = []
    const emit = (line, sign) => {
      const amt = Number(line.amount) || 0
      if (amt <= 0) return
      const step = (NN_CADENCES.find((c) => c.v === line.cadence) || NN_CADENCES[0]).days
      for (let d = step; d <= 90; d += step) synth.push({ date: nnAddDays(today, d), delta: sign * amt, kind: 'scenario' })
    }
    nnIncome.forEach((l) => emit(l, 1))
    nnSpendLess.forEach((l) => emit(l, 1))
    nnExpense.forEach((l) => emit(l, -1))
    const evs = [
      ...(events.base || []),
      ...(nnCount.debt ? events.debt || [] : []),
      ...(nnCount.goals ? events.goal || [] : []),
      ...synth,
    ].sort((a, b) => (a.date < b.date ? -1 : 1))
    const pts = projectBalance(startBal, evs, bufferFloor).points
    const cyc = []
    for (let k = 0; k < paydays.length - 1 && k < 5; k++) {
      const start = paydays[k]
      const end = paydays[k + 1]
      const before = pts.filter((p) => p.date < start).slice(-1)[0]
      let low = before ? before.balanceAfter : startBal
      for (const p of pts) if (p.date >= start && p.date < end) low = Math.min(low, p.balanceAfter)
      const floor = Number(bufferFloor) || 0
      cyc.push({ start, end, low, status: low < 0 ? 'short' : low < floor ? 'tight' : 'ok' })
    }
    return cyc
  }, [newNormal, nnIncome, nnSpendLess, nnExpense, nnCount])
  const nnRowInputs = (line, setList, placeholder) => (
    <div key={line.id} className="flex gap-1.5 items-center">
      <input
        type="text"
        value={line.label}
        onChange={(e) => nnUpdate(setList, line.id, { label: e.target.value })}
        placeholder={placeholder}
        className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm"
      />
      <span className="flex items-center rounded-lg border border-slate-300 px-2 py-2 text-sm shrink-0">
        <span className="text-slate-400">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={line.amount}
          onChange={(e) => nnUpdate(setList, line.id, { amount: e.target.value })}
          placeholder="0"
          className="w-14 text-right outline-none"
        />
      </span>
      <select
        value={line.cadence}
        onChange={(e) => nnUpdate(setList, line.id, { cadence: e.target.value })}
        className="rounded-lg border border-slate-300 px-1 py-2 text-sm bg-white shrink-0"
      >
        {NN_CADENCES.map((c) => (
          <option key={c.v} value={c.v}>{c.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => nnRemove(setList, line.id)}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 text-lg leading-none"
        title="Remove this line"
        aria-label="Remove this line"
      >
        ×
      </button>
    </div>
  )
  const monthYear = (iso) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  const inMonths = (m) => {
    const d = new Date()
    d.setMonth(d.getMonth() + m)
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }
  const [range, setRange] = useState('this')
  const [selectedCat, setSelectedCat] = useState(null)

  const now = new Date()
  const cfg = RANGES.find((r) => r.id === range)

  const { from, to, prevFrom, prevTo, rangeLabel } = useMemo(() => {
    const startThis = startOfMonth(now)
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    if (range === 'this') {
      return { from: startThis, to: nextMonth, prevFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1), prevTo: startThis, rangeLabel: 'this month' }
    }
    if (range === 'last') {
      const ls = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return { from: ls, to: startThis, prevFrom: new Date(now.getFullYear(), now.getMonth() - 2, 1), prevTo: ls, rangeLabel: 'last month' }
    }
    if (range === 'all') {
      return { from: new Date(2000, 0, 1), to: nextMonth, prevFrom: null, prevTo: null, rangeLabel: 'all time' }
    }
    const m = cfg.months
    const f = new Date(now.getFullYear(), now.getMonth() - (m - 1), 1)
    const pf = new Date(now.getFullYear(), now.getMonth() - (2 * m - 1), 1)
    return { from: f, to: nextMonth, prevFrom: pf, prevTo: f, rangeLabel: `last ${m} months` }
    // `now` is re-created every render, so it can't be a dep directly (the memo would
    // never actually memoize) — monthKey(now) only changes when the calendar month
    // actually rolls over, which is the one time this really needs to recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, monthKey(now)])

  const cur = useMemo(() => totalsIn(transactions, from, to), [transactions, from, to])
  const prev = useMemo(
    () => (prevFrom ? totalsIn(transactions, prevFrom, prevTo) : null),
    [transactions, prevFrom, prevTo]
  )

  const catRows = Object.entries(cur.byCat)
    .map(([category, spent]) => ({ category, spent }))
    .sort((a, b) => b.spent - a.spent)
    .map((row, i) => ({ ...row, color: CHART_COLORS[i % CHART_COLORS.length] }))

  const merchants = Object.entries(cur.byMerchant)
    .map(([merchant, total]) => ({ merchant, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)

  const barCount = Math.min(12, range === 'this' || range === 'last' ? 6 : cfg.months)
  const months = useMemo(() => monthlyTotals(transactions, barCount), [transactions, barCount])
  const thisMk = monthKey()
  const bars = months.map((m) => ({
    label: monthShort(m.date),
    value: m.total,
    highlight: monthKey(m.date) === thisMk,
  }))

  const nwSeries = useMemo(() => netWorthSeries(accounts, balances, debts), [accounts, balances, debts])
  // For the Budgets tile — spendByCategory defaults to the current month;
  // categoriesInUse is all-time (your full set of real spending categories).
  // Memoized because cleanCategory's per-transaction work adds up on a real
  // multi-year transaction history — no reason to redo it every render.
  const budgetsSpendByCat = useMemo(
    () => spendByCategory(transactions, monthKey(), periodStartIso),
    [transactions, periodStartIso]
  )
  const budgetsCategories = useMemo(() => categoriesInUse(transactions), [transactions])

  const totalBudget = budgets.reduce((s, b) => s + Number(b.monthly_limit || 0), 0)
  const showBudget = (range === 'this' || range === 'last') && totalBudget > 0
  const overBudget = totalBudget > 0 && cur.total > totalBudget
  // Budget per spending category, so "Where it goes" can show each category against
  // its limit. Only meaningful for a single month — a multi-month total vs. a
  // monthly limit would mislead — so we only reflect it for this/last month.
  const budgetByCat = {}
  for (const b of budgets) budgetByCat[(b.category || '').trim().toLowerCase()] = Number(b.monthly_limit) || 0
  const showCatBudget = range === 'this' || range === 'last'

  // Rename a whole category from the budget editor: the budget's name changes AND
  // every transaction currently filed under the old name (explicit or auto-cleaned,
  // excluding tagged income) is re-tagged to the new name — so your spending, "Where
  // it goes," and everything else reflect it. Not just the budget label.
  const onRenameCategory = async (oldName, newName, budgetId) => {
    const from = (oldName || '').trim()
    const to = (newName || '').trim()
    if (!to || to.toLowerCase() === from.toLowerCase()) return
    const ids = transactions
      .filter((t) => !t.income_source && cleanCategory(t, transactions).trim().toLowerCase() === from.toLowerCase())
      .map((t) => t.id)
    if (budgetId != null) await renameBudget(budgetId, to)
    if (ids.length) await setTransactionsCategory(ids, to)
    // Record it as a PERMANENT rule so future transactions (incl. brand-new merchants
    // the app auto-labels with the old name) also show the new name — no re-checking.
    await upsertCategoryAlias(from, to)
    onChanged()
  }

  const monthsInRange = useMemo(
    () =>
      range === 'all'
        ? Math.max(1, new Set(transactions.map((t) => (t.txn_date || '').slice(0, 7))).size)
        : cfg.months,
    [range, transactions, cfg.months]
  )
  const avgMonth = cur.total / monthsInRange

  let changeLabel = null
  if (prev && prev.total > 0) {
    const pct = Math.round(((cur.total - prev.total) / prev.total) * 100)
    const up = pct >= 0
    changeLabel = (
      <span className={up ? 'text-red-600' : 'text-emerald-700'}>
        {up ? '▲' : '▼'} {Math.abs(pct)}%
      </span>
    )
  }

  const drillTxns = useMemo(
    () =>
      selectedCat
        ? transactions
            .filter((t) => {
              const d = new Date(t.txn_date + 'T00:00:00')
              return d >= from && d < to && cleanCategory(t, transactions) === selectedCat
            })
            .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
            .slice(0, 50)
        : [],
    [selectedCat, transactions, from, to]
  )

  if (transactions.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow text-center">
        <h2 className="font-semibold text-slate-800 mb-2">Spending insights</h2>
        <p className="text-sm text-slate-500">
          Once you've logged transactions, this page shows where your money goes — by
          category, month to month, and over time.
        </p>
      </section>
    )
  }

  const card = 'rounded-2xl bg-white p-5 shadow'

  return (
    <div className="space-y-4">
      {/* Timeframe selector */}
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              setRange(r.id)
              setSelectedCat(null)
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              range === r.id ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 shadow-sm'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={card}>
          <p className="text-xs text-slate-400">Spent ({rangeLabel})</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{money(cur.total)}</p>
          {changeLabel && <p className="text-xs mt-1">{changeLabel} vs prior</p>}
        </div>
        <div className={card}>
          <p className="text-xs text-slate-400">Avg / month</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{money(avgMonth)}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-slate-400">Transactions</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{cur.count}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-slate-400">Top category</p>
          <p className="text-lg font-bold text-slate-800 mt-1 truncate">
            {catRows[0] ? catRows[0].category : '—'}
          </p>
          {catRows[0] && <p className="text-xs text-slate-400">{money(catRows[0].spent)}</p>}
        </div>
      </div>

      {(() => {
        const tiles = {
        wheregoes: catRows.length === 0 ? null : (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-1">Where it goes</h2>
            <p className="text-xs text-slate-400 mb-3">Tap a category to see the purchases ({rangeLabel}).</p>
            <DonutChart
              data={catRows.map((r) => ({ label: r.category, value: r.spent, color: r.color }))}
              centerLabel={abbrevMoney(cur.total)}
              centerSub={rangeLabel}
              activeLabel={selectedCat}
              onSlice={(label) => setSelectedCat((c) => (c === label ? null : label))}
            />
            <ul className="mt-4 space-y-3">
              {catRows.map((r) => {
                const share = cur.total > 0 ? Math.round((r.spent / cur.total) * 100) : 0
                const active = selectedCat === r.category
                return (
                  <li key={r.category}>
                    <button
                      onClick={() => setSelectedCat((c) => (c === r.category ? null : r.category))}
                      className={`w-full text-left rounded-lg -mx-1 px-1 py-0.5 ${active ? 'bg-slate-50' : ''}`}
                    >
                      <div className="flex justify-between text-sm mb-1 items-center gap-2 min-w-0">
                        <span className="text-slate-700 flex items-center gap-2 min-w-0">
                          <span className="shrink-0 inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                          <span className="truncate">{r.category}</span>
                          <span className="text-slate-400 shrink-0">· {share}%</span>
                        </span>
                        <span className="text-slate-600 shrink-0">{money(r.spent)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${share}%`, background: r.color }} />
                      </div>
                      {showCatBudget && (() => {
                        const lim = budgetByCat[r.category.trim().toLowerCase()]
                        if (lim === undefined) {
                          return <div className="text-xs text-slate-300 mt-1 text-right">no budget set</div>
                        }
                        if (!(lim > 0)) return null
                        const over = r.spent > lim
                        const pct = Math.round((r.spent / lim) * 100)
                        return (
                          <div className={`text-xs mt-1 text-right ${over ? 'text-red-600' : 'text-slate-400'}`}>
                            {over ? `over ${money(lim)} budget` : `${pct}% of ${money(lim)} budget`}
                          </div>
                        )
                      })()}
                    </button>
                  </li>
                )
              })}
            </ul>
            {selectedCat && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">{selectedCat}</h3>
                  <button onClick={() => setSelectedCat(null)} className="text-xs text-slate-400">Close</button>
                </div>
                {drillTxns.length === 0 ? (
                  <p className="text-sm text-slate-400">No purchases.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {drillTxns.map((t) => (
                      <li key={t.id} className="flex justify-between py-1.5 text-sm gap-2">
                        <span className="min-w-0 flex items-baseline">
                          <span className="text-slate-600 truncate">{t.merchant}</span>
                          <span className="shrink-0 text-slate-400">&nbsp;· {shortDate(t.txn_date)}</span>
                        </span>
                        <span className="text-slate-700 shrink-0">{money(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        ),

        monthly: (
        <section className={card}>
          <h2 className="font-semibold text-slate-800 mb-1">Month by month</h2>
          <p className="text-xs text-slate-400 mb-3">Total spending per month (current month highlighted).</p>
          <BarChart bars={bars} color="#22d3ee" />
        </section>
        ),

        setbudgets: (
          <CategoryBudgets
            budgets={budgets}
            spendByCat={budgetsSpendByCat}
            categories={budgetsCategories}
            onRenameCategory={onRenameCategory}
            onChanged={onChanged}
            periodStartIso={periodStartIso}
            ppy={newNormal?.ppy || 26}
          />
        ),

        recurringbills: (
          <RecurringBillsCard bills={bills} transactions={transactions} ppy={newNormal?.ppy || 26} onChanged={onChanged} />
        ),

        budget: !showBudget ? null : (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-3">Budget vs actual</h2>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-500">Budgeted</span>
                  <span className="text-slate-600">{money(totalBudget)}</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-500">Spent</span>
                  <span className={overBudget ? 'text-red-600 font-medium' : 'text-slate-600'}>{money(cur.total)}</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${overBudget ? 'bg-red-500' : 'bg-emerald-600'}`}
                    style={{ width: `${Math.min(100, Math.round((cur.total / totalBudget) * 100))}%` }}
                  />
                </div>
              </div>
            </div>
            <p className={`text-sm mt-3 ${overBudget ? 'text-red-600' : 'text-emerald-700'}`}>
              {overBudget
                ? `${money(cur.total - totalBudget)} over budget`
                : `${money(totalBudget - cur.total)} left this month`}
            </p>
          </section>
        ),

        merchants: merchants.length === 0 ? null : (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-3">Top merchants ({rangeLabel})</h2>
            <ul className="divide-y divide-slate-100">
              {merchants.map((m) => (
                <li key={m.merchant} className="flex justify-between py-2 text-sm">
                  <span className="min-w-0 text-slate-700 truncate pr-2">{m.merchant}</span>
                  <span className="text-slate-700 shrink-0">{money(m.total)}</span>
                </li>
              ))}
            </ul>
          </section>
        ),

        payoff: !plan ? null : (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-1">Debt payoff plan</h2>
            <p className="text-xs text-slate-400 mb-3">
              Pay {strategy === 'avalanche' ? 'highest-interest' : 'smallest-balance'} first,
              minimums on the rest.
            </p>
            <div className="flex mb-3 rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setStrategy('avalanche')}
                className={`flex-1 px-2 py-2 ${strategy === 'avalanche' ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}
              >
                Avalanche (less interest)
              </button>
              <button
                onClick={() => setStrategy('snowball')}
                className={`flex-1 px-2 py-2 border-l border-slate-300 ${strategy === 'snowball' ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}
              >
                Snowball (fast wins)
              </button>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Extra payment $/mo</span>
                <input
                  type="number"
                  step="1"
                  inputMode="decimal"
                  value={extraPay}
                  onChange={(e) => setExtraPay(e.target.value)}
                  placeholder="0"
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-base"
                />
              </div>
              {safeToSpend != null && Number(extraPay) > safeToSpend && (
                <p className="text-xs text-amber-700 mt-1">
                  That's more than your current Safe to spend ({money(safeToSpend)}) — this plan assumes you'll have it free every month, not just this one.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5">
                <p className="text-[0.75rem] uppercase tracking-wide text-slate-400">Debt-free</p>
                <p className="text-xl font-bold text-slate-800 cp-mono">
                  {plan.capped ? '50+ yrs' : monthYear(plan.debtFreeDate)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5">
                <p className="text-[0.75rem] uppercase tracking-wide text-slate-400">Total interest</p>
                <p className="text-xl font-bold text-slate-800 cp-mono">{money(plan.totalInterest)}</p>
              </div>
            </div>
            {plan.order.length > 1 && (
              <p className="text-xs text-slate-400 mb-2">
                Assumes each debt's payment gets redirected to the next one in
                line below as it's paid off — you have to actually do that
                each time, it's not automatic.
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {plan.order.map((d, i) => (
                <li key={i} className="flex justify-between items-center py-2 text-sm gap-2">
                  <span className="min-w-0 flex items-baseline gap-1">
                    <span className="text-slate-700 truncate">{i + 1}. {d.name}</span>
                    <span className="shrink-0 text-slate-400">{d.apr}%</span>
                  </span>
                  <span className="text-slate-500 shrink-0">paid by {inMonths(d.paidMonth)}</span>
                </li>
              ))}
            </ul>
          </section>
        ),

        whatif: safeToSpend == null && debts.length === 0 ? null : (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-1">What if?</h2>
            <p className="text-xs text-slate-400 mb-3">
              Try a change and see the effect. Nothing here is saved.
            </p>
            <div className="space-y-2.5">
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Extra income this month (a gig)</span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="text-slate-400">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={wiIncome}
                    onChange={(e) => setWiIncome(e.target.value)}
                    placeholder="0"
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-base text-right"
                  />
                </span>
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Extra toward debt / month</span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="text-slate-400">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={wiDebt}
                    onChange={(e) => setWiDebt(e.target.value)}
                    placeholder="0"
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-base text-right"
                  />
                </span>
              </label>
            </div>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
              {safeToSpend != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Safe to spend</span>
                  <span className="text-slate-700">
                    {money(safeToSpend)}
                    {(Number(wiIncome) > 0 || Number(wiDebt) > 0) && (
                      <span className={wiNewSafe >= safeToSpend ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                        {' '}
                        → {money(wiNewSafe)}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {basePlan && !basePlan.capped && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Debt-free</span>
                  <span className="text-slate-700">
                    {monthYear(basePlan.debtFreeDate)}
                    {Number(wiDebt) > 0 && !scenPlan.capped && (
                      <span className="text-emerald-700 font-medium">
                        {' '}
                        → {monthYear(scenPlan.debtFreeDate)}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {Number(wiDebt) > 0 && wiMonthsSaved > 0 && (
                <p className="text-xs text-emerald-700">
                  {wiMonthsSaved} {wiMonthsSaved === 1 ? 'month' : 'months'} sooner · saves{' '}
                  {money(wiInterestSaved)} in interest
                </p>
              )}
            </div>
          </section>
        ),

        newnormal: (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-1">New Normal</h2>
            <p className="text-xs text-slate-400 mb-3">
              Add income and expenses you're expecting — a move, a raise, a new bill — and see
              your new safe-to-spend per paycheck. Nothing here is saved.
            </p>

            {nnHasBaseline && (
              <>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs text-slate-500">Count in baseline:</span>
                  {[
                    { k: 'goals', label: 'Goals' },
                    { k: 'debt', label: 'Debt' },
                  ].map(({ k, label }) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setNnCount((c) => ({ ...c, [k]: !c[k] }))}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                        nnCount[k]
                          ? 'bg-sky-100 text-sky-700 border-sky-200'
                          : 'bg-slate-100 text-slate-400 border-slate-200'
                      }`}
                    >
                      {nnCount[k] ? '●' : '○'} {label}
                    </button>
                  ))}
                </div>
                <p className="text-[0.7rem] text-slate-400 mb-3">
                  Drop them to model life after a goal's funded or a debt's paid off.
                </p>

                <p className="text-[0.7rem] font-semibold tracking-wide text-slate-500 mb-1.5">
                  YOUR BASELINE, EACH PAYCHECK
                </p>
                <div className="rounded-lg border border-slate-100 p-3 text-[0.8rem] space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Regular paycheck</span>
                    <span className="text-emerald-700">+{money(nnPP.income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Recurring bills</span>
                    <span className="text-[#a8573f]">−{money(nnPP.bills)}</span>
                  </div>
                  {nnPP.everyday > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Everyday spending (budgets)</span>
                      <span className="text-[#a8573f]">−{money(nnPP.everyday)}</span>
                    </div>
                  )}
                  {nnCount.debt && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Debt payments</span>
                      <span className="text-[#a8573f]">−{money(nnPP.debt)}</span>
                    </div>
                  )}
                  {nnCount.goals && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Goal set-asides</span>
                      <span className="text-[#a8573f]">−{money(nnPP.goal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 mt-1 pt-1.5 font-semibold text-slate-800">
                    <span>Steady safe-to-spend (hypothetical)</span>
                    <span className={nnBaseline < 0 ? 'text-red-600' : ''}>{money(nnBaseline)}</span>
                  </div>
                </div>
                <p className="text-[0.7rem] text-slate-400 mt-1.5 mb-3">
                  A steady average, not your real number — it doesn't matter
                  where you are in the current pay cycle. Your actual Safe to
                  spend is on the Dashboard.
                </p>
              </>
            )}

            <p className="text-[0.7rem] font-semibold tracking-wide text-emerald-700 mb-1.5">
              NEW INCOME (a raise, a gig)
            </p>
            <div className="space-y-1.5">
              {nnIncome.map((l) => nnRowInputs(l, setNnIncome, 'e.g. Side gig, raise'))}
            </div>
            <button
              type="button"
              onClick={() => nnAdd(setNnIncome)}
              className="mt-1.5 text-sm font-semibold text-emerald-700"
            >
              + Add income
            </button>

            <p className="text-[0.7rem] font-semibold tracking-wide text-[#a8573f] mt-4 mb-1.5">
              NEW EXPENSE (rent, a bill)
            </p>
            <div className="space-y-1.5">
              {nnExpense.map((l) => nnRowInputs(l, setNnExpense, 'e.g. Rent, car payment'))}
            </div>
            <button
              type="button"
              onClick={() => nnAdd(setNnExpense)}
              className="mt-1.5 text-sm font-semibold text-[#a8573f]"
            >
              + Add expense
            </button>

            <p className="text-[0.7rem] font-semibold tracking-wide text-[#534AB7] mt-4 mb-1.5">
              SPEND LESS (cut a category)
            </p>
            <div className="space-y-1.5">
              {nnSpendLess.map((l) => nnRowInputs(l, setNnSpendLess, 'e.g. Dining out, subscriptions'))}
            </div>
            <button
              type="button"
              onClick={() => nnAdd(setNnSpendLess)}
              className="mt-1.5 text-sm font-semibold text-[#534AB7]"
            >
              + Spend less
            </button>

            <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
              {nnHasEntries ? (
                <>
                  <div className="flex flex-wrap justify-between items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-slate-500 min-w-0">With these changes, each paycheck</span>
                    <span className="font-medium text-slate-700 text-right whitespace-nowrap">
                      {money(nnBaseline)}
                      <span className={`whitespace-nowrap ${nnNewSafe < nnBaseline ? 'text-red-600' : 'text-emerald-700'}`}>
                        {' → '}
                        {money(nnNewSafe)}
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {nnNetPP < 0 ? `−${money(Math.abs(nnNetPP))}` : `+${money(nnNetPP)}`} from every
                    paycheck (you're paid ~{nnPpy}×/yr).
                  </p>
                  {nnNewSafe < 0 && (
                    <p className="text-xs text-red-600 mt-1">
                      That doesn't fit — you'd be {money(Math.abs(nnNewSafe))} short each paycheck.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400">
                  Add a new income or expense above to see how it changes the number.
                </p>
              )}
            </div>

            {nnHasBaseline && nnCycles.length > 0 && (nnHasEntries || !nnCount.goals || !nnCount.debt) && (
              <>
                <p className="text-[0.7rem] font-semibold tracking-wide text-slate-500 mt-4 mb-1.5">
                  ACROSS YOUR NEXT PAYCHECK CYCLES
                </p>
                <div className="rounded-lg border border-slate-100 overflow-hidden">
                  {nnCycles.map((c, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 text-sm ${
                        i > 0 ? 'border-t border-slate-100' : ''
                      } ${c.status === 'short' ? 'bg-red-50' : c.status === 'tight' ? 'bg-amber-50' : ''}`}
                    >
                      <span className="text-slate-600">
                        {shortDate(c.start)} – {shortDate(c.end)}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span
                          className={
                            c.status === 'short'
                              ? 'text-red-600 font-medium'
                              : c.status === 'tight'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }
                        >
                          low {money(c.low)}
                        </span>
                        <span
                          className={`text-[0.7rem] font-semibold px-2 py-0.5 rounded-full ${
                            c.status === 'short'
                              ? 'bg-red-600 text-white'
                              : c.status === 'tight'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {c.status === 'short' ? 'Short' : c.status === 'tight' ? 'Tight' : 'OK'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[0.7rem] text-slate-400 mt-2">
                  Lowest projected balance in each pay period, with your changes starting now.
                </p>
              </>
            )}
          </section>
        ),

        subscriptions: recurring.items.length === 0 ? null : (
          <section className={card}>
            <h2 className="font-semibold text-slate-800 mb-1">Subscriptions &amp; recurring</h2>
            <p className="text-xs text-slate-400 mb-3">
              Everything that goes out on a schedule, biggest first.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5">
                <p className="text-[0.75rem] uppercase tracking-wide text-slate-400">Per month</p>
                <p className="text-xl font-bold text-slate-800 cp-mono">{money(recurring.monthlyTotal)}</p>
              </div>
              <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5">
                <p className="text-[0.75rem] uppercase tracking-wide text-slate-400">Per year</p>
                <p className="text-xl font-bold text-slate-800 cp-mono">{money(recurring.yearlyTotal)}</p>
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {recurring.items.map((r, i) => (
                <li key={i} className="flex justify-between items-center py-2 text-sm gap-2">
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="text-slate-700 truncate">{r.name}</span>
                    {r.source === 'detected' && (
                      <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-amber-700">spotted</span>
                    )}
                  </span>
                  <span className="text-slate-500 shrink-0">
                    {money(r.amount)}/{r.cadence === 'weekly' ? 'wk' : 'mo'}
                    <span className="text-slate-800 font-medium"> · {money(r.monthly)}/mo</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ),

        unusual: <UnusualChargesCard transactions={transactions} />,

        networth: (
        <section className={card}>
          <h2 className="font-semibold text-slate-800 mb-1">Net worth over time</h2>
          <p className="text-xs text-slate-400 mb-3">Cash across your accounts, minus current debt.</p>
          <LineChart
            points={nwSeries.map((p) => ({ label: shortDate(p.date), value: p.netWorth }))}
            color="#34d399"
            format={money}
          />
        </section>
        ),
        }
        return (
          <TileColumns
            names={INSIGHTS_TILE_NAMES}
            tiles={tiles}
            tilesState={tilesState}
            arranging={arranging}
          />
        )
      })()}
    </div>
  )
}
