// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { monthlyInterest, totalMonthlyInterest, payoffPlan, debtBar, debtPaymentPlan, singleDebtPayoff, groupSeries, balanceFromStart, nextDueDate, monthlyDebtPayment, obligationSchedule, obligationAmount } from '../lib/budget'
import { EditPlanModal } from './GoalsCard'
import { addDebt, updateDebt, updateDebtBalance, decrementDebtBalance, addDebtPayment, deleteDebtPayment, deleteDebt, setDebtSmooth, setDebtActive } from '../lib/api'
import Modal from './Modal'

// The kinds of debt you can track. Only "card" drives the utilization bar (when a
// credit limit is known); every other type shows payoff progress toward the
// total. The rest is a clearer label so debts read like what they actually are.
export const DEBT_TYPES = [
  { value: 'card', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'bnpl', label: 'Buy now, pay later' },
  { value: 'medical', label: 'Medical' },
  { value: 'collection', label: 'Collections' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
]
const debtTypeLabel = (k) => DEBT_TYPES.find((t) => t.value === k)?.label || 'Other'

// "$75/mo" / "$75 every 2 wks" / "$75/wk" — how much and how often you pay.
function paymentSummary(d) {
  const pay = Math.max(Number(d.plan_payment || 0), Number(d.min_payment || 0))
  if (pay <= 0) return ''
  const f = d.pay_frequency || 'monthly'
  const suffix = f === 'biweekly' ? ' every 2 wks' : f === 'weekly' ? '/wk' : '/mo'
  return `${money(pay)}${suffix}`
}

export default function DebtsCard({ debts, goals = [], debtPayments = [], ppy = 26, onChanged }) {
  const [open, setOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [payFocusId, setPayFocusId] = useState(null) // "+ Log a payment" under a debt
  const [focusId, setFocusId] = useState(null)
  const [planEdit, setPlanEdit] = useState(null) // debt's payment plan → editor
  // Payment-plan series (e.g. "InDebted payment 2 of 4") shown under their debt.
  const seriesMap = groupSeries(goals)
  // Assign each plan to exactly one debt (first match wins) so a plan never shows
  // under two debts that happen to share a significant word.
  const planByDebtId = {}
  const claimedBases = new Set()
  for (const d of debts) {
    const p = debtPaymentPlan(d, seriesMap, debts)
    if (p && p.base && !claimedBases.has(p.base)) {
      claimedBases.add(p.base)
      planByDebtId[d.id] = p
    }
  }
  const total = debts.reduce((s, d) => s + Number(d.balance || 0), 0)
  const interest = totalMonthlyInterest(debts)
  const plan = debts.length ? payoffPlan(debts, 0, 'avalanche', goals) : null
  const monthYear = (iso) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Debt</h2>
        <div className="flex gap-3">
          {debts.length > 0 && (
            <button
              onClick={() => setPayOpen(true)}
              className="text-sm text-emerald-700 font-medium"
            >
              Log payment
            </button>
          )}
          <button
            onClick={() => setOpen(true)}
            className="text-sm text-slate-500 font-medium"
          >
            Manage
          </button>
        </div>
      </div>

      {debts.length === 0 ? (
        <p className="text-sm text-slate-400">
          No debts tracked. Tap Manage to add a card or loan.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {debts.map((d) => {
              const int = monthlyInterest(d)
              // planByDebtId (computed above) gives each plan to exactly ONE debt,
              // so a plan can't render under two debts that share a word.
              const payPlan = planByDebtId[d.id] || null
              const bar = debtBar(d, payPlan)
              const po = singleDebtPayoff(d)
              const nextDue = nextDueDate(d)
              const sched = obligationSchedule(d)
              const payAmt = obligationAmount(d)
              const pays = debtPayments
                .filter((p) => p.debt_id === d.id)
                .sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1))
              const bankLinked = !!(d.plaid_account_id || d.plaid_item_id)
              return (
                <li
                  key={d.id}
                  onClick={() => {
                    setFocusId(d.id)
                    setOpen(true)
                  }}
                  className={`py-3 cursor-pointer rounded-lg -mx-2 px-2 hover:bg-slate-100/60 ${
                    d.active === false ? 'opacity-60' : ''
                  }`}
                  title="Tap to edit"
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-sm text-slate-700 min-w-0">
                      {d.name}
                      <span className="block text-xs text-slate-400">
                        {debtTypeLabel(d.kind)}
                        {d.apr > 0 ? ` · ${d.apr}% APR` : ''}
                        {paymentSummary(d) ? ` · ${paymentSummary(d)}` : ''}
                        {d.kind !== 'card' && sched.status === 'pre_start' && payAmt > 0
                          ? ` · First payment ${shortDate(sched.next_due)} — save ${money(payAmt)}`
                          : d.kind !== 'card' && sched.status === 'late' && payAmt > 0
                            ? ` · Late · due ${shortDate(sched.next_due)} · ${money(payAmt)}`
                            : !payPlan?.next && nextDue
                              ? ` · Next payment ${shortDate(nextDue)}`
                              : ''}
                        {int > 0 ? ` · ~${money(int)}/mo interest` : ''}
                      </span>
                      {d.kind !== 'card' && sched.status === 'pre_start' && (
                        <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-1.5 py-0.5">
                          Starts {shortDate(sched.next_due)}
                        </span>
                      )}
                    </span>
                    <span className="text-slate-800 font-medium shrink-0">
                      {money(d.balance)}
                    </span>
                  </div>
                  {bar && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs mb-1">
                        {bar.kind === 'payoff' ? (
                          <>
                            <span className="text-emerald-700">Paid back {money(bar.paid)}</span>
                            <span className="text-slate-400">of {money(bar.total)} · {bar.pct}%</span>
                          </>
                        ) : (
                          <>
                            <span className="text-slate-500">{bar.pct}% of limit used</span>
                            <span className="text-slate-400">{money(bar.balance)} of {money(bar.limit)}</span>
                          </>
                        )}
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                            bar.kind === 'payoff'
                              ? 'bg-emerald-600'
                              : bar.pct >= 70
                              ? 'bg-amber-500'
                              : 'bg-sky-500'
                          }`}
                          style={{ width: `${Math.max(2, bar.pct)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {payPlan && payPlan.next && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPlanEdit({ base: payPlan.base, members: payPlan.members })
                      }}
                      className="mt-2 w-full flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200/70"
                      title="Edit payment plan"
                    >
                      <span>
                        Next payment {money(payPlan.next.target)} · {shortDate(payPlan.next.target_date)}
                      </span>
                      <span className="shrink-0">
                        {payPlan.doneCount} of {payPlan.total} paid
                      </span>
                    </button>
                  )}
                  {!payPlan?.next && nextDue && d.active !== false && (
                    <p className="mt-2 text-xs font-medium rounded-lg px-2.5 py-1.5 bg-emerald-50 text-emerald-800">
                      Next: pay {paymentSummary(d) || money(d.plan_payment || d.min_payment || 0)} on {shortDate(nextDue)}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-slate-400">
                    {d.active === false
                      ? 'Inactive — sits out of your bills, forecast, safe to spend, and payoff plan.'
                      : po.done
                      ? 'Paid off 🎉'
                      : po.months
                      ? `Paid off ~${monthYear(po.date)} at ${paymentSummary(d) || `${money(po.payment)}/mo`}`
                      : d.plan_end_date
                      ? `Paid off by ${monthYear(d.plan_end_date)} (settlement plan)`
                      : po.stuck
                      ? 'Payment barely covers interest — raise it to make headway'
                      : 'Add a monthly payment to see a payoff date'}
                  </p>
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await setDebtActive(d.id, d.active === false)
                        onChanged()
                      }}
                      className={`text-[0.7rem] font-medium rounded-full px-2.5 py-0.5 ${
                        d.active !== false ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
                      }`}
                      title={
                        d.active !== false
                          ? 'Active — counted in your bills, forecast, safe to spend, and payoff plan. Tap to make it Inactive.'
                          : 'Inactive — sits out of your bills, forecast, safe to spend, and payoff plan. Tap to make it Active.'
                      }
                    >
                      {d.active !== false ? '● Active' : '○ Inactive'}
                    </button>
                  </div>
                  {!payPlan?.next && (pays.length > 0 || Number(d.balance || 0) > 0) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      {pays.length > 0 && (
                        <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 mb-1">
                          {pays.slice(0, 4).map((p) => (
                            <div key={p.id} className="flex items-center justify-between px-2.5 py-1 text-xs">
                              <span className="text-slate-500">{shortDate(p.paid_on)}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-slate-600">−{money(p.amount)}</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteDebtPayment(p.id, { bankLinked })
                                    onChanged()
                                  }}
                                  className="text-slate-300 hover:text-red-500 text-sm leading-none"
                                  title="Remove this payment"
                                >
                                  ×
                                </button>
                              </span>
                            </div>
                          ))}
                          {pays.length > 4 && (
                            <div className="px-2.5 py-1 text-xs text-slate-400">
                              +{pays.length - 4} more
                            </div>
                          )}
                        </div>
                      )}
                      {Number(d.balance || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayFocusId(d.id)
                            setPayOpen(true)
                          }}
                          className="text-xs font-medium text-emerald-700"
                        >
                          + Log a payment
                        </button>
                      )}
                      {monthlyDebtPayment(d) > 0 && d.active !== false && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            await setDebtSmooth(d.id, !d.smooth)
                            onChanged()
                          }}
                          className={`ml-3 text-xs font-medium ${d.smooth ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600'}`}
                          title="Set aside a share of this payment out of every paycheck instead of it hitting all at once"
                        >
                          {d.smooth
                            ? `● Saving ${money((monthlyDebtPayment(d) * 12) / ppy)}/paycheck`
                            : '○ Save each paycheck'}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex justify-between pt-3 mt-1 border-t border-slate-200 font-semibold text-slate-800">
            <span>Total owed</span>
            <span>{money(total)}</span>
          </div>
          {interest > 0 && (
            <div className="flex justify-between pt-1 text-sm text-slate-500">
              <span>Interest cost</span>
              <span>~{money(interest)}/mo</span>
            </div>
          )}
          {plan && plan.capped && (
            <p className="mt-2 text-sm font-medium text-red-600">
              At your current payments, this debt isn't on track to pay off —
              interest is outpacing what you're paying. Increase a payment or
              use the payoff planner on Insights to find a plan that works.
            </p>
          )}
          {plan && !plan.capped && (
            <div className="mt-2">
              <p className="text-sm font-medium text-emerald-700">
                Debt-free by {monthYear(plan.debtFreeDate)} — about {plan.months}{' '}
                {plan.months === 1 ? 'month' : 'months'} at your current payments
                {plan.order.length > 1 ? ' (avalanche order, no extra payment)' : ''}.
              </p>
              {plan.order.length > 1 && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Assumes you redirect each payment to the next debt as one gets
                  paid off — this won't happen automatically. The payoff planner
                  on Insights lets you try snowball or add extra — those numbers
                  can differ from this one on purpose.
                </p>
              )}
            </div>
          )}
        </>
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
      {open && (
        <ManageDebtsModal
          debts={debts}
          focusId={focusId}
          onClose={() => {
            setOpen(false)
            setFocusId(null)
          }}
          onChanged={onChanged}
        />
      )}
      {payOpen && (
        <LogPaymentModal
          debts={debts}
          focusId={payFocusId}
          onClose={() => {
            setPayOpen(false)
            setPayFocusId(null)
          }}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}

// Record any payment toward a debt — planned or extra, today or backdated. It
// lowers the balance AND keeps a dated record that shows under the debt; the
// progress bar, payoff date, and payoff plan all re-project automatically.
function LogPaymentModal({ debts, focusId = null, onClose, onChanged }) {
  const active = debts.filter((d) => d.active !== false && Number(d.balance || 0) > 0)
  // Only seed to the tapped debt if it's actually one of the options — otherwise
  // a $0/inactive debt's id would leave the <select> showing a different debt
  // than the state points at.
  const [debtId, setDebtId] = useState(active.some((d) => d.id === focusId) ? focusId : active[0]?.id || '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(isoDate())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const debt = active.find((d) => d.id === debtId)
  const amt = Number(amount) || 0
  const bankLinked = !!(debt && (debt.plaid_account_id || debt.plaid_item_id))
  const newBalance = debt ? Math.max(0, Number(debt.balance || 0) - amt) : 0

  async function submit(e) {
    e.preventDefault()
    if (!debt || amt <= 0) return setError('Enter the amount you paid.')
    setBusy(true)
    setError(null)
    try {
      // Records the dated payment and (for a manual debt) lowers the balance.
      // Live-read inside so a payment can't clobber a balance that changed since
      // the modal opened.
      await addDebtPayment({ debt_id: debt.id, amount: amt, paid_on: date, bankLinked })
      onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Log a debt payment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-slate-700">
        <label className="block text-sm">
          <span className="text-slate-500">Which debt</span>
          <select
            value={debtId}
            onChange={(e) => setDebtId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
          >
            {active.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {money(d.balance)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Amount paid</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            autoFocus
            placeholder="0.00"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Date paid <span className="text-slate-400">(today, or a past date you already paid)</span></span>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </label>
        {debt && amt > 0 && (
          <p className="text-sm text-slate-600">
            {debt.name}: {money(debt.balance)} →{' '}
            <span className="font-medium text-emerald-700">{money(newBalance)}</span>
            {newBalance === 0 && ' — paid off 🎉'}
          </p>
        )}
        <p className="text-xs text-slate-400">
          Works for any payment — your planned one or an extra $20. The progress
          bar and payoff date update automatically.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Log payment'}
        </button>
      </form>
    </Modal>
  )
}


function ManageDebtsModal({ debts, focusId = null, onClose, onChanged }) {
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  const [apr, setApr] = useState('')
  const [payment, setPayment] = useState('')
  const [frequency, setFrequency] = useState('monthly')
  const [nextDate, setNextDate] = useState('')
  const [kind, setKind] = useState('card')
  const [originalBalance, setOriginalBalance] = useState('')
  const [startDate, setStartDate] = useState('')
  const [firstPay, setFirstPay] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // If you enter where + when it started, work today's balance forward for you.
  const computed =
    startDate && Number(originalBalance) > 0 && Number(payment) > 0
      ? balanceFromStart({
          original: Number(originalBalance),
          payment: Number(payment),
          frequency,
          apr: Number(apr || 0),
          startDate,
        })
      : null
  // A diverging result (payment doesn't cover interest) isn't a real balance —
  // don't auto-fill or preview it; ask for the balance instead.
  const computedOk = computed && !computed.diverges
  // The balance you typed wins; otherwise use the one calculated from the start.
  const effectiveBalance = balance !== '' ? Number(balance) : computedOk ? computed.balance : null

  async function add(e) {
    e.preventDefault()
    if (effectiveBalance == null) {
      setError('Enter the balance, or a start date + original amount + payment so I can calculate it.')
      return
    }
    // A payment with no date (next OR start) wouldn't schedule into the forecast.
    if (Number(payment) > 0 && !nextDate && !startDate && !firstPay) {
      setError('Add a start date or next payment date so this shows up in your forecast.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Schedule anchors on the next payment date, or the start date rolled
      // forward if that's all you gave.
      const anchor = nextDate || startDate || null
      await addDebt({
        name: name.trim(),
        balance: effectiveBalance,
        apr: Number(apr || 0),
        min_payment: Number(payment || 0),
        plan_payment: Number(payment || 0),
        due_day: frequency === 'monthly' && anchor ? Number(anchor.slice(8, 10)) : null,
        pay_frequency: frequency,
        next_payment_date: nextDate || firstPay || startDate || null,
        start_date: firstPay || nextDate || null,
        kind,
        original_balance: originalBalance,
      })
      setName('')
      setBalance('')
      setApr('')
      setPayment('')
      setFrequency('monthly')
      setNextDate('')
      setOriginalBalance('')
      setStartDate('')
      setFirstPay('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Debt" onClose={onClose}>
      <form onSubmit={add} className="space-y-3 text-slate-700">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Savor card, Friend Loan"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Balance — what you still owe</label>
            <input
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder={computedOk ? `${money(computed.balance)} (calculated)` : '$'}
              type="number"
              step="0.01"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              {DEBT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">What you pay each time</label>
            <input
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              placeholder="$"
              type="number"
              step="0.01"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">How often</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="monthly">Monthly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">First payment</label>
            <input
              type="date"
              value={firstPay}
              onChange={(e) => setFirstPay(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Next payment date</label>
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Interest rate (APR)</label>
            <input
              value={apr}
              onChange={(e) => setApr(e.target.value)}
              placeholder="0 if none"
              type="number"
              step="0.01"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Original amount <span className="font-normal text-slate-400">(optional — shows a payoff bar)</span>
          </label>
          <input
            value={originalBalance}
            onChange={(e) => setOriginalBalance(e.target.value)}
            placeholder="$"
            type="number"
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Started on <span className="font-normal text-slate-400">(optional — if it began in the past, I'll work out today's balance)</span>
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        {computedOk && balance === '' && (
          <p className="text-xs text-emerald-700">
            Calculated balance today: <span className="font-semibold">{money(computed.balance)}</span> — after{' '}
            {computed.periods} payment{computed.periods === 1 ? '' : 's'} since {shortDate(startDate)}. Leave Balance
            blank to use this, or type your own to override.
          </p>
        )}
        {computed?.diverges && (
          <p className="text-xs text-amber-700">
            Your payment doesn't cover the interest at that rate, so the balance can't be worked out
            from the start date. Enter the current balance above instead.
          </p>
        )}
        <p className="text-xs text-slate-400">
          Your payment (and how often) is treated as a bill — it lowers your
          safe-to-spend and shows up in your projection. Add the original amount to
          see a “paid back” progress bar. Started in the past? Enter the original
          amount + start date and I’ll calculate today’s balance for you.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Add debt'}
        </button>
      </form>

      {debts.length > 0 && (
        <ul className="mt-4 divide-y-2 divide-slate-200 border-t-2 border-slate-200">
          {debts.map((d) => (
            <DebtRow key={d.id} debt={d} autoEdit={d.id === focusId} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function DebtRow({ debt, autoEdit = false, onChanged }) {
  const [editing, setEditing] = useState(!!autoEdit)
  const [flash, setFlash] = useState(false)
  const rowRef = useRef(null)
  useEffect(() => {
    if (autoEdit && rowRef.current) rowRef.current.scrollIntoView({ block: 'center' })
  }, [autoEdit])
  const [name, setName] = useState(debt.name)
  const [balance, setBalance] = useState(String(debt.balance))
  const [apr, setApr] = useState(String(debt.apr ?? ''))
  // "What you pay each time" = the larger of plan/minimum (they used to be split).
  const [payment, setPayment] = useState(
    String(Math.max(Number(debt.plan_payment || 0), Number(debt.min_payment || 0)) || '')
  )
  const [frequency, setFrequency] = useState(debt.pay_frequency || 'monthly')
  const [nextDate, setNextDate] = useState(debt.next_payment_date || '')
  const [firstPay, setFirstPay] = useState(debt.start_date || '')
  const [kind, setKind] = useState(debt.kind || 'card')
  const [originalBalance, setOriginalBalance] = useState(
    debt.original_balance != null ? String(debt.original_balance) : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const bankLinked = !!debt.plaid_account_id
  async function saveBalance(value) {
    // A bank-linked debt's balance is owned by the sync; a hand-edit would just
    // get reverted on the next refresh, so don't pretend to save it.
    if (bankLinked) return
    await updateDebtBalance(debt.id, Number(value))
    setFlash(true)
    setTimeout(() => setFlash(false), 1800)
    onChanged()
  }

  async function save(e) {
    e.preventDefault()
    // A payment with no schedule would silently vanish from the forecast. Weekly
    // and biweekly have no fallback; a monthly debt can fall back to its legacy
    // due-day, so it's only required when there isn't one.
    if (Number(payment) > 0 && !nextDate && !firstPay && (frequency !== 'monthly' || debt.due_day == null)) {
      setError('Add the next payment date so this shows up in your forecast.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateDebt(debt.id, {
        name: name.trim(),
        // Bank-linked debts keep the synced balance — don't overwrite it here.
        balance: bankLinked ? undefined : Number(balance),
        apr: Number(apr || 0),
        // One payment field now feeds both (they were confusingly split).
        min_payment: Number(payment || 0),
        plan_payment: Number(payment || 0),
        // Keep the legacy due_day as a monthly fallback; scheduling now uses
        // frequency + next payment date.
        due_day: debt.due_day ?? (frequency === 'monthly' && (firstPay || nextDate) ? Number(String(firstPay || nextDate).slice(8, 10)) : null),
        pay_frequency: frequency,
        next_payment_date: nextDate || null,
        start_date: firstPay || null,
        kind,
        original_balance: originalBalance,
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
    await deleteDebt(debt.id)
    onChanged()
  }

  if (!editing) {
    return (
      <li ref={rowRef} className="py-2">
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm text-slate-700 min-w-0 truncate">
            {debt.name}
            {debt.apr > 0 && (
              <span className="text-slate-400"> · {debt.apr}%</span>
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
        <label className="flex items-center gap-2 mt-1 text-sm">
          <span className="text-slate-500">Balance:</span>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            defaultValue={debt.balance}
            onBlur={(e) => saveBalance(e.target.value)}
            readOnly={bankLinked}
            className={`w-28 rounded-lg border border-slate-300 px-2 py-1 text-base ${
              bankLinked ? 'bg-slate-100 text-slate-500' : ''
            }`}
          />
          <span className={`text-xs ${flash ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>
            {bankLinked ? 'synced from your bank' : flash ? '✓ saved' : 'tap away to save'}
          </span>
        </label>
      </li>
    )
  }

  return (
    <li ref={rowRef} className="py-3">
      <div className="rounded-xl border-2 border-sky-300 bg-slate-50 p-3">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-sky-700 mb-2">
          ✎ Editing
        </p>
        <form onSubmit={save} className="space-y-2">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chase Sapphire"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Balance — what you still owe</label>
            <input
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="$"
              type="number"
              step="0.01"
              inputMode="decimal"
              required
              readOnly={bankLinked}
              title={bankLinked ? 'This balance updates automatically from your bank' : undefined}
              className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-base ${
                bankLinked ? 'bg-slate-100 text-slate-500' : ''
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              {DEBT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">What you pay each time</label>
            <input
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              placeholder="$"
              type="number"
              step="0.01"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">How often</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="monthly">Monthly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">First payment</label>
            <input
              type="date"
              value={firstPay}
              onChange={(e) => setFirstPay(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Next payment date</label>
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Interest rate (APR)</label>
            <input
              value={apr}
              onChange={(e) => setApr(e.target.value)}
              placeholder="0 if none"
              type="number"
              step="0.01"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Original amount <span className="font-normal text-slate-400">(optional — shows a payoff bar)</span>
          </label>
          <input
            value={originalBalance}
            onChange={(e) => setOriginalBalance(e.target.value)}
            placeholder="$"
            type="number"
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
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
      </div>
    </li>
  )
}
