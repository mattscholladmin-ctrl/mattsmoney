// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { goalSpent, goalSpentMap, goalPace, countsAsSpendable, seriesBase, groupSeries, debtMatchesPlanBase, bestDebtForPlanBase } from '../lib/budget'
import { addGoal, updateGoal, updateGoalCurrent, deleteGoal, updateTransaction, updateDebtBalance, setGoalReserved } from '../lib/api'
import Modal from './Modal'

// status 'active' (or missing) = ongoing savings goal; everything else is a
// one-time dated item (a planned purchase/payoff or an expected inflow).
const DATED = ['planned', 'pending_inflow', 'deferred', 'done']
const isDated = (g) => DATED.includes(g.status)

// Whether a goal is currently eligible for its per-paycheck hold-out (matches
// goalPaceReserve's own filter exactly). Used to detect the MOMENT a goal becomes
// newly eligible — via any path (status reopened, a date just added, flipped back
// to Active) — so pace_since can be re-stamped and the hold-out starts building
// from your next paycheck instead of jumping to a stale, backdated amount.
const isPaceEligible = (g) => g?.status === 'active' && g?.reserved !== false && !!g?.target_date

// One-line pace projection under a goal's bars (finish date / what's needed).
function GoalPaceNote({ pace }) {
  if (!pace || pace.done) return null
  const parts = []
  if (pace.targetDate && pace.overdue) {
    parts.push(`Target date ${shortDate(pace.targetDate)} has passed`)
  } else if (pace.neededPerPaycheck != null) {
    // The number you actually act on: set this aside each paycheck to hit the date.
    parts.push(`Set aside ${money(pace.neededPerPaycheck)}/paycheck (${money(pace.neededMonthly)}/mo) to hit ${shortDate(pace.targetDate)}`)
    if (pace.onTrack) parts.push('on pace ✓')
  } else if (pace.etaDate) {
    parts.push(`At ${money(pace.monthly)}/mo, done by ${shortDate(pace.etaDate)}`)
  }
  if (!parts.length) return null
  const offPace = pace.targetDate && !pace.onTrack && !pace.overdue
  return (
    <p className={`text-xs mt-2 rounded-lg px-2.5 py-1.5 font-medium ${
      pace.overdue ? 'bg-red-50 text-red-600' : offPace ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'
    }`}>
      Next: {parts.join(' · ')}
    </p>
  )
}

// One consistent goal row: target, Saved bar, Spent bar, and either a
// per-paycheck plan (active — has a deadline) or a muted "add a date" hint
// (dormant — no deadline, fund anytime, left out of the forecast).
function GoalProgress({ goal, transactions, spentMap, dormant = false, payPeriodsPerYear = 26, onOpen, onChanged, accounts = [] }) {
  const reserved = goal.reserved !== false
  // A dated savings goal you can flip Active/Inactive. Inactive hides its
  // per-paycheck number and sits out of your safe-to-spend.
  const canToggle = goal.status === 'active' && !!goal.target_date
  async function toggleReserved(e) {
    e.stopPropagation()
    try {
      const turningOn = !reserved
      await setGoalReserved(goal.id, turningOn, turningOn ? { pace_since: isoDate() } : {})
      onChanged && onChanged()
    } catch {
      /* keep the UI responsive even if the write fails */
    }
  }
  const target = Number(goal.target) || 0
  const spent = spentMap ? spentMap[goal.id] || 0 : goalSpent(goal.id, transactions)
  const setAside = Number(goal.current) || 0
  const acct = accounts.find((a) => a.id === goal.account_id)
  const inBucket = !!(acct && !countsAsSpendable(acct))
  // What goalPace treats as "progress toward the target" — the larger of
  // set-aside vs. spent, so spending beyond what's saved (funded some other
  // way) still counts toward the goal instead of demanding you ALSO save the
  // part you already covered by spending. This is deliberately NOT what the
  // "Saved" bar/label shows below — that has to mean literally money held
  // aside (what the guide promises, and what's actually excluded from Safe to
  // spend), or it misrepresents how much is really protected.
  const progressTowardTarget = Math.max(setAside, spent)
  const pctOf = (v) => (target > 0 ? Math.min(100, Math.round((v / target) * 100)) : 0)
  return (
    <li
      onClick={onOpen}
      className="cursor-pointer rounded-lg -mx-2 px-2 py-1 hover:bg-slate-100/60"
      title="Tap to edit"
    >
      <div className="flex justify-between text-sm mb-2 gap-2 min-w-0">
        <span className="text-slate-700 font-medium min-w-0 flex items-center gap-2">
          <span className="truncate">{goal.name}</span>
          {dormant && (
            <span className="shrink-0 align-middle text-[0.7rem] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-px">
              no deadline
            </span>
          )}
        </span>
        <span className="text-slate-400 shrink-0">target {money(target)}</span>
      </div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-emerald-700">Saved</span>
        <span className="text-slate-500">{money(setAside)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div className="h-full bg-emerald-600 rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pctOf(setAside)}%` }} />
      </div>
      {setAside > 0 && (
        <p className="text-[0.7rem] text-slate-400 -mt-1 mb-2">
          {inBucket
            ? `In ${acct.name}`
            : 'Earmarked only — not sitting in a savings account'}
        </p>
      )}
      <div className="flex justify-between text-xs mb-0.5">
        <span style={{ color: '#a8573f' }}>Spent</span>
        <span className="text-slate-500">{money(spent)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pctOf(spent)}%`, backgroundColor: '#a8573f' }} />
      </div>
      {dormant ? (
        <p className="text-xs mt-1.5 text-slate-400">
          No deadline yet — add one and the app works out what to save each
          paycheck. Until then it sits out of your forecast.
        </p>
      ) : (
        <>
          {(!canToggle || reserved) ? (
            <GoalPaceNote pace={goalPace(goal, progressTowardTarget, undefined, payPeriodsPerYear)} />
          ) : (
            <p className="text-xs mt-1.5 text-slate-400">
              Paused — still a target, but nothing is being held from your paycheck.
            </p>
          )}
          {canToggle && (
            <button
              onClick={toggleReserved}
              className={`mt-1.5 text-[0.7rem] font-medium rounded-full px-2.5 py-0.5 ${
                reserved ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
              }`}
              title={
                reserved
                  ? 'Saving: money is held from each paycheck and kept out of your safe to spend. Tap to pause.'
                  : 'Paused: nothing is being held. Tap to start saving again.'
              }
            >
              {reserved ? '● Saving' : '○ Paused'}
            </button>
          )}
        </>
      )}
    </li>
  )
}

const STATUS_META = {
  planned: { label: 'Planned', badge: 'bg-amber-100 text-amber-700', sign: -1, amt: 'text-red-600' },
  pending_inflow: { label: 'Pending', badge: 'bg-sky-100 text-sky-700', sign: 1, amt: 'text-emerald-700' },
  deferred: { label: 'Deferred', badge: 'bg-slate-100 text-slate-500', sign: 0, amt: 'text-slate-400' },
  done: { label: 'Done', badge: 'bg-emerald-100 text-emerald-700', sign: 0, amt: 'text-slate-400' },
}

// Dated items sorted by date (deferred / undated fall to the bottom).
function byDate(a, b) {
  if (!a.target_date && !b.target_date) return 0
  if (!a.target_date) return 1
  if (!b.target_date) return -1
  return a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : 0
}

function signedAmount(g) {
  const meta = STATUS_META[g.status] || STATUS_META.planned
  const n = Number(g.target || 0)
  const prefix = meta.sign < 0 ? '−' : meta.sign > 0 ? '+' : ''
  return { text: `${prefix}${money(n)}`, cls: meta.amt }
}

export default function GoalsCard({ goals, transactions = [], debts = [], accounts = [], balances = [], payPeriodsPerYear = 26, countingGoals = true, onChanged }) {
  const [open, setOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [linking, setLinking] = useState(null) // planned item being paid
  const [focusId, setFocusId] = useState(null) // row tapped → edit THAT item
  const [planEdit, setPlanEdit] = useState(null) // series tapped → whole-plan editor
  const [itemEdit, setItemEdit] = useState(null) // single item tapped → control center
  const seriesMap = groupSeries(goals)
  // One pass over transactions for every goal's spent total, instead of each
  // goal re-scanning the whole list (goalSpent per goal = O(goals × txns)).
  const spentMap = useMemo(() => goalSpentMap(transactions), [transactions])

  // A finished ('done') item stays in the main list for a week after its date,
  // then drops into the collapsed "Completed" section below.
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const isOldDone = (g) => g.status === 'done' && (!g.target_date || g.target_date < weekAgo)

  // Payment-plan series that match a debt now live UNDER that debt (Debt tile),
  // so keep them out of the goals list — nothing shows twice.
  const debtBases = new Set(
    Object.keys(seriesMap).filter((base) => !!bestDebtForPlanBase(base, debts))
  )
  const isDebtSeries = (g) => {
    const b = seriesBase(g.name)
    return !!(b && debtBases.has(b))
  }

  const mine = goals.filter((g) => !isDebtSeries(g))
  const completed = mine.filter(isOldDone).sort(byDate)
  const live = mine.filter((g) => !isOldDone(g))
  // Active = has a deadline → per-paycheck plan, counted in your forecast.
  // Dormant = no deadline → fund anytime, left out of the forecast.
  const active = live
    .filter((g) => g.target_date && g.status !== 'done' && g.status !== 'pending_inflow')
    .sort(byDate)
  const dormant = live.filter((g) => !g.target_date && g.status !== 'done' && g.status !== 'pending_inflow')
  const inflows = live.filter((g) => g.status === 'pending_inflow').sort(byDate)
  const recentlyDone = live.filter((g) => g.status === 'done').sort(byDate)

  // Combined per-paycheck across every active goal — the "am I over-committed?"
  // number. Big total vs. your paycheck = deadlines that need stretching out.
  const goalTotals = active
    // Only true savings goals (status 'active') count toward the per-paycheck
    // set-aside. One-time 'planned' items are already scheduled as forecast
    // outflows, so including them here would count them twice.
    .filter((g) => g.status === 'active')
    .reduce(
    (acc, g) => {
      const saved = Math.max(Number(g.current || 0), spentMap[g.id] || 0)
      const p = goalPace(g, saved, undefined, payPeriodsPerYear)
      const per = p.neededPerPaycheck || 0
      const isReserved = g.reserved !== false // reserved by default
      return {
        // Active goals (reserved) are held out of safe-to-spend; Inactive goals
        // are shown as a target only, nothing set aside.
        reserved: acc.reserved + (isReserved ? per : 0),
        someday: acc.someday + (isReserved ? 0 : per),
        perPaycheck: acc.perPaycheck + per,
        monthly: acc.monthly + (p.neededMonthly || 0),
        count: acc.count + (per > 0 ? 1 : 0),
      }
    },
    { reserved: 0, someday: 0, perPaycheck: 0, monthly: 0, count: 0 }
  )

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Goals</h2>
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-emerald-700 font-medium"
        >
          Manage
        </button>
      </div>

      {goals.length === 0 ? (
        <p className="text-sm text-slate-400">
          No goals yet. Tap Manage to add one.
        </p>
      ) : (
        <div className="space-y-4">
          {goalTotals.perPaycheck > 0 && (
            <div className="rounded-lg bg-slate-100 border border-slate-200 p-3">
              {goalTotals.reserved > 0 && (
                <>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-500">Saving toward goals, each paycheck</span>
                    <span className="text-base font-semibold text-slate-800">
                      {money(goalTotals.reserved)}
                      <span className="text-xs font-normal text-slate-500">/paycheck</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {countingGoals
                      ? 'held out of your safe to spend'
                      : 'paused — turn on the Goals chip to hold it out'}
                  </p>
                </>
              )}
              {goalTotals.someday > 0 && (
                <p className={`text-xs text-slate-400 ${goalTotals.reserved > 0 ? 'mt-1' : ''}`}>
                  {money(goalTotals.someday)}/paycheck in inactive goals — not set aside.
                </p>
              )}
            </div>
          )}
          {active.length > 0 && (
            <ul className="space-y-4">
              {active.map((g) => (
                <GoalProgress
                  key={g.id}
                  goal={g}
                  transactions={transactions}
                  spentMap={spentMap}
                  payPeriodsPerYear={payPeriodsPerYear}
                  onOpen={() => setItemEdit(g)}
                  onChanged={onChanged}
                  accounts={accounts}
                />
              ))}
            </ul>
          )}

          {dormant.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                No deadline · fund these anytime
              </p>
              <ul className="space-y-4">
                {dormant.map((g) => (
                  <GoalProgress
                    key={g.id}
                    goal={g}
                    transactions={transactions}
                    spentMap={spentMap}
                    dormant
                    payPeriodsPerYear={payPeriodsPerYear}
                    onOpen={() => setItemEdit(g)}
                    onChanged={onChanged}
                    accounts={accounts}
                  />
                ))}
              </ul>
            </div>
          )}

          {inflows.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                Expected money in
              </p>
              <ul className="divide-y divide-slate-100">
                {inflows.map((g) => (
                  <li
                    key={g.id}
                    onClick={() => setItemEdit(g)}
                    className="py-2 cursor-pointer rounded-lg -mx-2 px-2 hover:bg-slate-100/60"
                    title="Tap to edit"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-sm text-slate-700 min-w-0 pr-2">
                        <span className="block truncate">{g.name}</span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {g.target_date ? shortDate(g.target_date) : 'no date'} · not counted until it lands
                        </span>
                      </span>
                      <span className="text-sm font-medium shrink-0 text-emerald-700">
                        +{money(Number(g.target || 0))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recentlyDone.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {recentlyDone.map((g) => (
                <li key={g.id} className="flex justify-between items-center py-2 opacity-70">
                  <span className="text-sm text-slate-700 min-w-0 pr-2">
                    <span className="block truncate">{g.name}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      {g.target_date ? shortDate(g.target_date) : 'no date'}
                      <span className="px-1.5 py-px rounded text-[0.7rem] leading-4 font-medium bg-emerald-100 text-emerald-700">
                        Done
                      </span>
                    </span>
                  </span>
                  <span className="text-sm font-medium shrink-0 text-slate-400">
                    {money(Number(g.target || 0))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted((s) => !s)}
                className="flex items-center gap-1 text-xs font-medium text-slate-400 uppercase tracking-wide"
                aria-expanded={showCompleted}
              >
                Completed ({completed.length})
                <span className={`transition-transform ${showCompleted ? 'rotate-180' : ''}`}>⌄</span>
              </button>
              {showCompleted && (
                <ul className="divide-y divide-slate-100 mt-2">
                  {completed.map((g) => {
                    const meta = STATUS_META[g.status] || STATUS_META.planned
                    const amt = signedAmount(g)
                    return (
                      <li key={g.id} className="flex justify-between items-center py-2 opacity-70">
                        <span className="text-sm text-slate-700 min-w-0 pr-2">
                          <span className="block truncate">{g.name}</span>
                          <span className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                            {g.target_date ? shortDate(g.target_date) : 'no date'}
                            <span className={`px-1.5 py-px rounded text-[0.7rem] leading-4 font-medium ${meta.badge}`}>
                              {meta.label}
                            </span>
                          </span>
                        </span>
                        <span className={`text-sm font-medium shrink-0 ${amt.cls}`}>{amt.text}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <ManageGoalsModal
          goals={goals}
          debts={debts}
          focusId={focusId}
          onClose={() => {
            setOpen(false)
            setFocusId(null)
          }}
          onChanged={onChanged}
        />
      )}
      {linking && (
        <LinkPaymentModal
          item={linking}
          transactions={transactions}
          onClose={() => setLinking(null)}
          onChanged={onChanged}
        />
      )}
      {planEdit && (
        <EditPlanModal
          base={planEdit.base}
          members={planEdit.members}
          debts={debts}
          onClose={() => setPlanEdit(null)}
          onChanged={onChanged}
        />
      )}
      {itemEdit && (
        <ItemModal
          item={itemEdit}
          transactions={transactions}
          spentMap={spentMap}
          debts={debts}
          accounts={accounts}
          payPeriodsPerYear={payPeriodsPerYear}
          onClose={() => setItemEdit(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}

// One control center for a single planned/deferred item: every field, its
// payments, and its lifecycle actions in one place.
function ItemModal({ item, transactions = [], spentMap, debts = [], accounts = [], payPeriodsPerYear = 26, onClose, onChanged }) {
  const [name, setName] = useState(item.name)
  const [target, setTarget] = useState(String(item.target ?? ''))
  const [current, setCurrent] = useState(String(item.current ?? 0))
  const mountedCurrent = useRef(String(item.current ?? 0))
  const [date, setDate] = useState(item.target_date || '')
  const [accountId, setAccountId] = useState(item.account_id || '')
  const [linkOpen, setLinkOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Savings accounts this goal's money can live in (buckets). One account can
  // hold several goals; the account tile shows the split.
  const savingsAccounts = accounts.filter((a) => !a.hidden && !countsAsSpendable(a))

  const paid = spentMap ? spentMap[item.id] || 0 : goalSpent(item.id, transactions)
  const linked = transactions.filter((t) => t.goal_id === item.id).slice(0, 5)
  // Unique best match only — null when ambiguous, so editing "Total still owed"
  // can never overwrite the wrong same-issuer debt's balance.
  const debt = bestDebtForPlanBase(item.name, debts)
  const [totalOwed, setTotalOwed] = useState(debt ? String(debt.balance ?? '') : '')

  // Enter a target + a deadline and the app works out the per-paycheck set-aside
  // for you — no typing a contribution. No deadline = dormant (no plan).
  const saved = Math.max(Number(current || 0), paid)
  const pace = goalPace(
    { target: Number(target || 0), current: saved, target_date: date || null, monthly_contribution: 0 },
    saved,
    undefined,
    payPeriodsPerYear
  )

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (debt && totalOwed !== '' && Number(totalOwed) !== Number(debt.balance)) {
        await updateDebtBalance(debt.id, Number(totalOwed))
      }
      await updateGoal(item.id, {
        name: name.trim(),
        target: Number(target),
        // Only write "saved" if you actually changed it, so a deposit that landed
        // while this editor was open doesn't get reverted.
        ...(current !== mountedCurrent.current ? { current: Number(current || 0) } : {}),
        monthly_contribution: 0,
        status: item.status || 'active',
        target_date: date || null,
        account_id: accountId || null,
      })
      onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function markDone() {
    setBusy(true)
    try {
      await updateGoal(item.id, {
        name: item.name,
        target: item.target,
        current: item.current || 0,
        monthly_contribution: item.monthly_contribution || 0,
        status: 'done',
        target_date: item.target_date || null,
      })
      onChanged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${item.name}"?`)) return
    setBusy(true)
    try {
      await deleteGoal(item.id)
      onChanged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={item.name} onClose={onClose}>
      <form onSubmit={save} className="space-y-3 text-slate-700">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <div className="flex gap-2">
          <label className="block text-sm flex-1">
            <span className="text-slate-500">Target</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              type="number"
              step="0.01"
              inputMode="decimal"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm flex-1">
            <span className="text-slate-500">Deadline (optional)</span>
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-500">Saved so far</span>
          <input
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            type="number"
            step="0.01"
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </label>
        {savingsAccounts.length > 0 && (
          <label className="block text-sm">
            <span className="text-slate-500">Held in (savings account)</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="">Not assigned to an account</option>
              {savingsAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Keeps this goal's money in one account with your others — the account
              tile shows each goal's share.
            </span>
          </label>
        )}
        {date && pace.neededPerPaycheck != null && !pace.done ? (
          <div className="rounded-lg border border-emerald-500 p-3">
            <p className="text-[0.7rem] font-medium text-emerald-700 uppercase tracking-wide">
              The app works this out — you don't type it
            </p>
            <p className="mt-1 text-emerald-700 font-semibold text-base">
              Set aside {money(pace.neededPerPaycheck)}/paycheck
            </p>
            <p className="text-xs text-slate-500">
              ({money(pace.neededMonthly)}/mo) to hit {shortDate(date)}
            </p>
          </div>
        ) : date && pace.overdue ? (
          <p className="text-xs text-amber-700">
            Deadline {shortDate(date)} has passed — pick a new date.
          </p>
        ) : (
          <p className="text-xs text-slate-400">
            No deadline: fund it anytime, no paycheck plan, and it's left
            out of your forecast. Add a date to start a plan.
          </p>
        )}
        {debt && (
          <label className="block text-sm">
            <span className="text-slate-500">Total still owed ({debt.name})</span>
            <input
              value={totalOwed}
              onChange={(e) => setTotalOwed(e.target.value)}
              type="number"
              step="0.01"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
        )}

        <div className="rounded-lg bg-slate-100 border border-slate-200 p-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Paid so far</span>
            <span className="font-medium text-slate-800">
              {money(paid)} · {money(Math.max(0, Number(item.target || 0) - paid))} left
            </span>
          </div>
          {linked.length > 0 && (
            <ul className="mt-2 space-y-1">
              {linked.map((t) => (
                <li key={t.id} className="flex justify-between text-xs text-slate-500">
                  <span className="min-w-0 truncate pr-2">
                    {t.merchant} · {shortDate(t.txn_date)}
                  </span>
                  <span className="shrink-0">{money(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className="mt-2 text-sm text-emerald-700 font-medium"
          >
            + Link a payment
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {item.status !== 'done' && (
            <button
              type="button"
              onClick={markDone}
              disabled={busy}
              className="border border-emerald-500 text-emerald-700 font-semibold rounded-lg px-4 py-2"
            >
              Mark done
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-red-600 px-2"
          >
            Delete
          </button>
        </div>
      </form>
      {linkOpen && (
        <LinkPaymentModal
          item={item}
          transactions={transactions}
          onClose={() => setLinkOpen(false)}
          onChanged={onChanged}
        />
      )}
    </Modal>
  )
}

// Connect a real transaction to a planned item, so partial / off-cycle /
// different-amount payments count toward it and shrink what the forecast
// still sets aside. (Works from the other side too: edit a transaction and
// pick the item under "Counts toward goal".)
function LinkPaymentModal({ item, transactions, onClose, onChanged }) {
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState(null)
  const q = query.trim().toLowerCase()
  const candidates = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            Number(t.amount || 0) > 0 &&
            t.goal_id !== item.id &&
            (!q || `${t.merchant || ''}`.toLowerCase().includes(q))
        )
        .slice(0, 25),
    [transactions, item.id, q]
  )

  async function link(t) {
    setBusyId(t.id)
    try {
      await updateTransaction(t.id, { goal_id: item.id })
      onChanged()
      onClose()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal title={`Link a payment — ${item.name}`} onClose={onClose}>
      <p className="text-xs text-slate-400 mb-2">
        Pick the transaction that paid toward this. Any amount works — partial
        payments reduce what the forecast still holds back.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name"
        autoFocus
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base mb-2"
      />
      {candidates.length === 0 ? (
        <p className="text-sm text-slate-400">No matching transactions.</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {candidates.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => link(t)}
                disabled={busyId === t.id}
                className="w-full flex justify-between items-center py-2 text-sm text-left disabled:opacity-50"
              >
                <span className="min-w-0 text-slate-700 truncate pr-2">
                  {t.merchant}
                  <span className="text-slate-400"> · {shortDate(t.txn_date)}</span>
                  {t.goal_id && (
                    <span className="text-amber-600"> · linked to another item — picking it moves it here</span>
                  )}
                </span>
                <span className="text-slate-800 font-medium shrink-0">{money(t.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function ManageGoalsModal({ goals, debts = [], focusId = null, onClose, onChanged }) {
  const [planEditing, setPlanEditing] = useState(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [current, setCurrent] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await addGoal({
        name: name.trim(),
        target: Number(target),
        current: Number(current || 0),
        monthly_contribution: 0,
        status: 'active',
        target_date: date || null,
      })
      setName('')
      setTarget('')
      setCurrent('')
      setDate('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Goals" onClose={onClose}>
      <form onSubmit={add} className="space-y-3 text-slate-700">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Emergency Fund, EcoFlow)"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target $"
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <input
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Saved so far $"
            type="number"
            step="0.01"
            inputMode="decimal"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <label className="block text-sm">
          <span className="text-slate-500">
            Deadline (optional) — with a date, the app tells you what to set aside per paycheck
          </span>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      </form>

      {(() => {
        const series = groupSeries(goals)
        const names = Object.keys(series)
        if (!names.length) return null
        return (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Payment plans
            </p>
            {names.map((base) => {
              const members = series[base]
              const remaining = members.filter((g) => g.status === 'planned')
              const doneCount = members.filter((g) => g.status === 'done').length
              const next = [...remaining].sort((a, b) => (a.target_date || '') < (b.target_date || '') ? -1 : 1)[0]
              return (
                <div key={base} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-700 min-w-0">
                    <span className="block font-medium truncate">{base}</span>
                    <span className="block text-xs text-slate-400">
                      {doneCount} paid · {remaining.length} left
                      {next ? ` · next ${money(next.target)} on ${next.target_date ? shortDate(next.target_date) : '—'}` : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => setPlanEditing({ base, members })}
                    className="text-sm text-emerald-700 font-medium shrink-0"
                  >
                    Edit plan
                  </button>
                </div>
              )
            })}
            <p className="text-[0.7rem] text-slate-400">
              Edit plan lays out the whole schedule from the first payment's date —
              anything on or before today counts as already paid, and the balance
              left updates to match.
            </p>
          </div>
        )
      })()}

      {goals.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} autoEdit={g.id === focusId} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {planEditing && (
        <EditPlanModal
          base={planEditing.base}
          members={planEditing.members}
          debts={debts}
          onClose={() => setPlanEditing(null)}
          onChanged={onChanged}
        />
      )}
    </Modal>
  )
}

// Lay out a plan's payments from a chosen first date. Any payment dated on or
// before today counts as already paid (records payments you've already made);
// the rest stay upcoming. Rebuilds the whole series so the split is consistent.
function planDates(firstDate, freq, n) {
  const out = []
  const base0 = new Date(firstDate + 'T00:00:00')
  for (let i = 0; i < n; i++) {
    let d
    if (freq === 'weekly') {
      d = new Date(base0.getTime() + 7 * i * 86400000)
    } else if (freq === 'biweekly') {
      d = new Date(base0.getTime() + 14 * i * 86400000)
    } else {
      // Monthly: clamp so a plan starting Jan 31 hits Feb 28, not Mar 3.
      const dim = new Date(base0.getFullYear(), base0.getMonth() + i + 1, 0).getDate()
      d = new Date(base0.getFullYear(), base0.getMonth() + i, Math.min(base0.getDate(), dim))
    }
    out.push(isoDate(d))
  }
  return out
}

export function EditPlanModal({ base, members, debts = [], onClose, onChanged }) {
  // The matching debt (plan "InDebted" ↔ debt "InDebted (Afterpay)") so the
  // remaining balance updates itself when payments are recorded.
  const debt = bestDebtForPlanBase(base, debts)
  const allSorted = [...members].sort((a, b) => ((a.target_date || '') < (b.target_date || '') ? -1 : 1))
  const guessFreq = () => {
    const dated = allSorted.filter((g) => g.target_date)
    if (dated.length >= 2) {
      const gap = Math.round((new Date(dated[1].target_date) - new Date(dated[0].target_date)) / 86400000)
      if (gap >= 5 && gap <= 9) return 'weekly'
      if (gap >= 12 && gap <= 16) return 'biweekly'
    }
    return 'monthly'
  }
  const amtDefault = Number(allSorted[0]?.target ?? 0)
  // The whole plan's total (every payment added up). Prefer the debt's known
  // settlement/total; otherwise rebuild it from the payments already on file.
  const totalDefault = debt?.settlement_amount || amtDefault * (members.length || 1) || 0
  const [totalOwed, setTotalOwed] = useState(totalDefault ? String(Number(totalDefault).toFixed(2)) : '')
  const [count, setCount] = useState(String(members.length || 1))
  const [firstDate, setFirstDate] = useState(allSorted[0]?.target_date || isoDate())
  const [freq, setFreq] = useState(guessFreq)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Live preview: you give the total and how many payments; each payment is
  // worked out for you (total ÷ count). Then we lay them out from the first date
  // and split into already-paid (on/before today) vs. still-to-pay.
  const today = isoDate()
  const total = Number(totalOwed) || 0
  // Cap the payment count: a typo/paste of a huge number would otherwise build a
  // giant array and fire thousands of sequential DB writes on save, freezing the
  // app and dumping junk rows.
  const n = Math.min(500, Math.max(1, Math.round(Number(count) || 1)))
  const amt = n > 0 ? Number((total / n).toFixed(2)) : 0
  // Per-payment amounts: all equal to `amt` except the LAST, which absorbs the
  // rounding remainder so the payments add up to the total exactly (a fully-paid
  // plan reaches $0, not $0.01 off).
  const amounts = Array.from({ length: n }, (_, i) =>
    i === n - 1 ? Math.max(0, Number((total - amt * (n - 1)).toFixed(2))) : amt
  )
  const dates = firstDate ? planDates(firstDate, freq, n) : []
  const paidCount = dates.filter((d) => d <= today).length
  const leftCount = n - paidCount
  const paidSum = amounts.slice(0, paidCount).reduce((s, a) => s + a, 0)
  const remainingOwed = Math.max(0, Number((total - paidSum).toFixed(2)))

  async function save(e) {
    e.preventDefault()
    if (!total || total <= 0) return setError('Enter the total owed.')
    if (!n || n < 1) return setError('Enter how many payments.')
    if (!firstDate) return setError('Pick the first payment date.')
    setBusy(true)
    setError(null)
    try {
      // Rebuild the whole plan from the first date. Payments dated on or before
      // today are marked done (already paid); the rest stay upcoming.
      for (const g of members) await deleteGoal(g.id)
      for (let i = 0; i < n; i++) {
        await addGoal({
          name: `${base} payment ${i + 1} of ${n}`,
          target: amounts[i],
          current: 0,
          monthly_contribution: 0,
          status: dates[i] <= today ? 'done' : 'planned',
          target_date: dates[i],
        })
      }
      // What's still owed = the total minus what's already been paid.
      if (debt && remainingOwed !== Number(debt.balance)) {
        await updateDebtBalance(debt.id, remainingOwed)
      }
      onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit plan — ${base}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3 text-slate-700">
        <p className="text-xs text-slate-400">
          Enter the total owed and how many payments — each payment is worked out
          for you. Set the first payment's real date (past dates are fine); any
          payment on or before today counts as already paid.
        </p>
        <div className="flex gap-2">
          <label className="block text-sm flex-1">
            <span className="text-slate-500">Total owed</span>
            <input
              value={totalOwed}
              onChange={(e) => setTotalOwed(e.target.value)}
              type="number"
              step="0.01"
              inputMode="decimal"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm flex-1">
            <span className="text-slate-500">Number of payments</span>
            <input
              value={count}
              onChange={(e) => setCount(e.target.value)}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
        </div>
        <div className="rounded-lg border border-emerald-500 p-3">
          <p className="text-[0.7rem] font-medium text-emerald-700 uppercase tracking-wide">
            The app works this out — you don't type it
          </p>
          <p className="mt-1 text-emerald-700 font-semibold text-base">
            Each payment ≈ {money(amt)}
          </p>
          <p className="text-xs text-slate-500">
            {n} {n === 1 ? 'payment' : 'payments'} total
          </p>
        </div>
        <div className="flex gap-2">
          <label className="block text-sm flex-1">
            <span className="text-slate-500">First payment date</span>
            <input
              value={firstDate}
              onChange={(e) => setFirstDate(e.target.value)}
              type="date"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm flex-1">
            <span className="text-slate-500">How often</span>
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Already paid</span>
            <span className="font-medium text-slate-800">{paidCount} of {n}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-slate-500">Still to pay</span>
            <span className="font-medium text-slate-800">
              {leftCount} · {money(remainingOwed)}
            </span>
          </div>
          {debt && (
            <p className="mt-1 text-xs text-slate-400">
              Sets {debt.name} balance to {money(remainingOwed)}.
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : `Save plan (${paidCount} paid · ${leftCount} left)`}
        </button>
      </form>
    </Modal>
  )
}

function GoalRow({ goal, autoEdit = false, onChanged }) {
  const [editing, setEditing] = useState(!!autoEdit)
  const [flash, setFlash] = useState(false)
  const rowRef = useRef(null)
  useEffect(() => {
    if (autoEdit && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'center' })
    }
  }, [autoEdit])
  const [name, setName] = useState(goal.name)
  const [target, setTarget] = useState(String(goal.target))
  const [current, setCurrent] = useState(String(goal.current))
  const mountedCurrent = useRef(String(goal.current))
  const [monthly, setMonthly] = useState(String(goal.monthly_contribution ?? 0))
  const [status, setStatus] = useState(goal.status || 'active')
  const [date, setDate] = useState(goal.target_date || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const ongoing = status === 'active'
  const dated = isDated(goal)

  async function saveCurrent(value) {
    await updateGoalCurrent(goal.id, Number(value))
    setFlash(true)
    setTimeout(() => setFlash(false), 1800)
    onChanged()
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // If this save is what makes the goal newly eligible for its per-paycheck
      // hold-out — reopened from done/deferred, a date just added, etc. — restart
      // its pace clock at today, so it starts building from your NEXT paycheck
      // rather than jumping straight to a stale, backdated amount.
      const wasEligible = isPaceEligible(goal)
      const willBeEligible = isPaceEligible({ ...goal, status, target_date: date || null })
      await updateGoal(goal.id, {
        name: name.trim(),
        target: Number(target),
        monthly_contribution: ongoing ? Number(monthly || 0) : 0,
        status,
        target_date: date || null,
        ...(!wasEligible && willBeEligible ? { pace_since: isoDate() } : {}),
        // Only write "saved" if you actually changed it here, so a deposit that
        // landed while this editor was open doesn't get reverted.
        ...(current !== mountedCurrent.current ? { current: Number(current || 0) } : {}),
      })
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await deleteGoal(goal.id)
    onChanged()
  }

  if (!editing) {
    const meta = STATUS_META[goal.status]
    return (
      <li ref={rowRef} className="py-2">
        <div className="flex justify-between items-center gap-2 min-w-0">
          <span className="text-sm text-slate-700 min-w-0 truncate">
            {goal.name}{' '}
            {dated ? (
              <span className="text-slate-400">
                {goal.target_date ? shortDate(goal.target_date) : 'no date'} ·{' '}
                {meta?.label || goal.status} · {money(goal.target)}
              </span>
            ) : (
              <span className="text-slate-400">target {money(goal.target)}</span>
            )}
          </span>
          <div className="flex gap-3 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-emerald-700 font-medium"
            >
              Edit
            </button>
            <button onClick={remove} className="text-xs text-red-600">
              Delete
            </button>
          </div>
        </div>
        {!dated && (
          <label className="flex items-center gap-2 mt-1 text-sm">
            <span className="text-slate-500">Saved:</span>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              defaultValue={goal.current}
              onBlur={(e) => saveCurrent(e.target.value)}
              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-base"
            />
            <span className={`text-xs ${flash ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>
              {flash ? '✓ saved' : 'tap away to save'}
            </span>
          </label>
        )}
      </li>
    )
  }

  return (
    <li ref={rowRef} className="py-3">
      <form onSubmit={save} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
        >
          <option value="active">Saving up for this</option>
          {status !== 'active' && (
            <option value={status}>
              {status === 'done'
                ? 'Done'
                : status === 'deferred'
                ? 'Wishlist (no date)'
                : status === 'planned'
                ? 'One-time (legacy)'
                : 'Expected money in'}
            </option>
          )}
        </select>
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={ongoing ? 'Target $' : 'Amount $'}
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          {ongoing ? (
            <input
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Saved so far $"
              type="number"
              step="0.01"
              inputMode="decimal"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          ) : (
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              type="date"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          )}
        </div>
        {ongoing && (
          <>
            <input
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="Monthly contribution $ (optional)"
              type="number"
              step="0.01"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            <label className="block text-sm">
              <span className="text-slate-500">Deadline (optional) — shows what to set aside per paycheck</span>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
              />
            </label>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex-1 border border-slate-300 text-slate-600 rounded-lg px-4 py-2"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  )
}
