// @ts-nocheck
import { useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { accountSummaries, checkInRecap, goalPace, goalSpent } from '../lib/budget'
import { addBalanceEntry } from '../lib/api'

function buildVerdict({ spendable, upcoming, assignment, closers, goals, transactions, ppy }) {
  const today = isoDate()
  const sts = spendable ? Number(spendable.spendable) : 0
  const payday = spendable?.nextIncome?.date
  const overdue = (upcoming || []).filter((b) => b.overdue || b.date < today)

  if (sts < 0) {
    const first = (closers?.plan || [])[0]
    return {
      tone: 'red',
      kicker: 'Short this period',
      headline: `${money(Math.abs(sts))} short until payday${payday ? ` ${shortDate(payday)}` : ''}.`,
      detail: first
        ? `${first.label} frees ${money(first.frees)}.`
        : 'Bills and holds are bigger than cash on hand.',
      action: first && first.kind === 'pause-goal'
        ? { kind: 'pause-goal', label: `Pause ${first.name}`, closer: first }
        : { kind: 'done', label: 'Done' },
    }
  }

  if (overdue.length) {
    const first = overdue[0]
    return {
      tone: 'amber',
      kicker: overdue.length === 1 ? 'Unmatched bill' : 'Unmatched bills',
      headline: `${first.name} is still holding ${money(first.amount)}.`,
      detail: overdue.length === 1
        ? 'Confirm the likely payment on the dashboard, or tap I paid this.'
        : `${overdue.length} unmatched. Start with this one on the dashboard.`,
      action: { kind: 'done', label: overdue.length === 1 ? `Go match ${first.name}` : 'Go match them' },
    }
  }

  if (assignment && assignment.free < 0) {
    return {
      tone: 'amber',
      kicker: 'This paycheck',
      headline: `${money(Math.abs(assignment.free))} over-assigned.`,
      detail: 'Stretch a goal deadline or cut everyday leftover so the next check isn’t already spent.',
      action: { kind: 'done', label: 'Done' },
    }
  }

  let behind = null
  for (const g of goals || []) {
    if (g.status !== 'active' || !g.target_date || g.reserved === false) continue
    const saved = Math.max(Number(g.current || 0), goalSpent(g.id, transactions))
    const p = goalPace(g, saved, undefined, ppy)
    if (!p || p.done || p.onTrack || p.overdue) continue
    if (p.neededPerPaycheck && (!behind || p.neededPerPaycheck > behind.needed)) {
      behind = { name: g.name, needed: p.neededPerPaycheck }
    }
  }
  if (behind) {
    return {
      tone: 'amber',
      kicker: 'Goal pace',
      headline: `${behind.name} is behind.`,
      detail: `Set aside ${money(behind.needed)}/paycheck to hit the date.`,
      action: { kind: 'done', label: 'Done' },
    }
  }

  return {
    tone: 'green',
    kicker: 'Clear',
    headline: `${money(sts)} is free until payday${payday ? ` ${shortDate(payday)}` : ''}.`,
    detail: 'Nothing else needs a decision today.',
    action: { kind: 'done', label: 'Done' },
  }
}

export default function CheckInView({
  accounts = [],
  balances = [],
  transactions = [],
  spendable,
  upcoming,
  goals = [],
  debts: _debts = [],
  assignment,
  closers,
  ppy = 26,
  onChanged,
  onDone,
  onPauseGoal,
}) {
  const [step, setStep] = useState(1)
  const hasAccounts = accounts.length > 0
  const summaries = accountSummaries(accounts, balances)
  const recap = checkInRecap(transactions, balances)
  const manualSummaries = summaries.filter((a) => !(a.plaid_account_id) || a.manual)

  const [values, setValues] = useState(() => {
    const init = {}
    for (const a of summaries) init[a.id] = String(a.balance ?? '')
    return init
  })
  const [single, setSingle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function saveBalance(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (hasAccounts) {
        for (const a of summaries) {
          const linked = !!a.plaid_account_id && !a.manual
          if (linked) continue
          await addBalanceEntry({
            account_id: a.id,
            balance: Number(values[a.id]),
            as_of: isoDate(),
            note: 'Weekly check-in',
          })
        }
      } else {
        await addBalanceEntry({
          balance: Number(single),
          as_of: isoDate(),
          note: 'Weekly check-in',
        })
      }
      await onChanged()
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const cutoff = isoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  const soon = (upcoming || []).filter((b) => b.date <= cutoff)
  const verdict = buildVerdict({
    spendable,
    upcoming,
    assignment,
    closers,
    goals,
    transactions,
    ppy,
  })
  const toneBox =
    verdict.tone === 'red'
      ? 'bg-red-50 border-red-200'
      : verdict.tone === 'amber'
        ? 'bg-amber-50 border-amber-200'
        : 'bg-emerald-50 border-emerald-200'
  const toneKicker =
    verdict.tone === 'red'
      ? 'text-red-700'
      : verdict.tone === 'amber'
        ? 'text-amber-800'
        : 'text-emerald-800'
  const toneHead =
    verdict.tone === 'red'
      ? 'text-red-900'
      : verdict.tone === 'amber'
        ? 'text-amber-950'
        : 'text-emerald-900'

  const dayBars = []
  const todayD = new Date()
  for (let i = 9; i >= 0; i--) {
    const d = new Date(todayD)
    d.setDate(todayD.getDate() - i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let inn = 0
    let out = 0
    for (const t of transactions) {
      if (t.txn_date !== iso) continue
      const a = Number(t.amount || 0)
      if (a < 0) inn += -a
      else out += a
    }
    dayBars.push({ label: String(d.getDate()), inn, out })
  }
  const dayMax = Math.max(1, ...dayBars.flatMap((d) => [d.inn, d.out]))

  return (
    <div className="mm-stack">
    {recap && (
      <section className="mm-metrics cols-2">
        <div className="mm-card">
          <p className="mm-k">Since last check-in</p>
          <p className={`mm-n ${recap.net < 0 ? 'text-red-500' : ''}`}>{recap.net < 0 ? '−' : '+'}{money(Math.abs(recap.net))}</p>
          <p className="mm-muted">Income {money(recap.income)} · spent {money(recap.spent)}</p>
        </div>
        <div className="mm-card">
          <p className="mm-k">Spent</p>
          <p className="mm-n">{money(recap.spent)}</p>
          <p className="mm-muted">Income {money(recap.income)}</p>
        </div>
      </section>
    )}
    {recap && (
      <section className="mm-card">
        <p className="mm-k">Last 10 days</p>
        <div className="mm-flow mm-flow-lg">
          {dayBars.map((d) => (
            <div key={d.label} className="mm-flow-col">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 190 }}>
                <div className="mm-flow-bar" style={{ height: `${Math.max(4, (d.inn / dayMax) * 180)}px`, background: '#059669' }} />
                <div className="mm-flow-bar" style={{ height: `${Math.max(4, (d.out / dayMax) * 180)}px`, background: '#9f1239' }} />
              </div>
              <span>{d.label}</span>
            </div>
          ))}
        </div>
        <p className="mm-muted">Green is money in. Wine is money out.</p>
      </section>
    )}
    <section className="mm-card">
      <p className="mm-k">Accounts</p>
      <p className="mm-muted" style={{ margin: '6px 0 14px' }}>Bank balances stay. Type cash the bank does not sync. Have receipts, side income, and any bill changes ready.</p>

      {step === 1 ? (
        <form onSubmit={saveBalance} className="space-y-4 text-slate-700">
          <p className="text-sm text-slate-500">
            {hasAccounts
              ? "Bank-linked accounts already have today's balance. Confirm them, and only type cash or anything the bank does not see."
              : 'One quick step: open your bank app and type in the balance of the account you spend from, right now. That keeps everything else honest.'}
          </p>

          {hasAccounts ? (
            <div className="mm-check-grid">
              {summaries.map((a) => {
                const linked = !!(a.plaid_account_id) && !a.manual
                return (
                <div key={a.id} className="mm-acct-line">
                  <div className="min-w-0">
                    <div className="truncate">{a.name}</div>
                    <div className="mm-muted">
                      {a.kind === 'savings' ? 'Savings · ' : ''}
                      {linked ? 'Bank synced' : 'Type this one'}
                    </div>
                  </div>
                  {linked ? (
                    <div className="text-right shrink-0">
                      <b>{a.balance == null ? '—' : money(a.balance)}</b>
                      <div className="mm-muted">
                        {a.availableMissing ? 'current' : 'Available'}
                        {!a.availableMissing && a.bankCurrent != null ? ` · current ${money(a.bankCurrent)}` : ''}
                      </div>
                    </div>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={values[a.id] ?? ''}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [a.id]: e.target.value }))
                      }
                      placeholder="0.00"
                      className="w-32 rounded-lg border px-3 py-2 text-base text-right"
                    />
                  )}
                </div>
              )})}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">
                Checking balance (the account you spend from)
              </label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                required
                autoFocus
                value={single}
                onChange={(e) => setSingle(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2.5 min-h-11"
          >
            {busy ? 'Saving…' : manualSummaries.length ? 'Save & see where I stand' : 'See where I stand'}
          </button>
        </form>
      ) : (
        <div className="space-y-4 text-slate-700">
          <div className={`rounded-xl border p-4 ${toneBox}`}>
            <p className={`text-[0.7rem] uppercase tracking-widest font-semibold ${toneKicker}`}>
              {verdict.kicker}
            </p>
            <p className={`text-2xl font-bold mt-1 leading-tight ${toneHead}`}>{verdict.headline}</p>
            <p className={`text-sm mt-2 ${toneKicker}`}>{verdict.detail}</p>
          </div>

          {assignment && (
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Where the last paycheck went</p>
              <p className="text-sm text-slate-700">
                {assignment.name || 'Paycheck'} {assignment.date ? `· ${shortDate(assignment.date)}` : ''} · {money(assignment.amount)}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                Left free {money(assignment.free)}
              </p>
            </div>
          )}

          {soon.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                Next 7 days
              </p>
              <ul className="divide-y divide-slate-100">
                {soon.map((b) => (
                  <li key={`${b.billId || b.name}-${b.date}`} className="flex justify-between py-2 text-sm gap-2">
                    <span className="min-w-0 flex items-center text-slate-600">
                      <span className="shrink-0 text-slate-400 w-12 inline-block">
                        {shortDate(b.originalDate || b.date)}
                      </span>
                      <span className="min-w-0 truncate">{b.name}</span>
                    </span>
                    <span className="shrink-0 text-slate-700">{money(b.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {verdict.action.kind === 'pause-goal' && onPauseGoal ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={async () => {
                  await onPauseGoal(verdict.action.closer.goalId)
                }}
                className="w-full bg-red-800 text-white font-semibold rounded-lg px-4 py-2.5 min-h-11"
              >
                {verdict.action.label}
              </button>
              <button
                type="button"
                onClick={onDone}
                className="w-full text-slate-500 font-medium rounded-lg px-4 py-2 min-h-11"
              >
                Back to dashboard
              </button>
            </div>
          ) : (
            <button
              onClick={onDone}
              className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 min-h-11"
            >
              {verdict.action.label}
            </button>
          )}
        </div>
      )}
    </section>
    <section className="mm-card">
      <p className="mm-k">Still open</p>
      {(upcoming || []).slice(0, 8).length === 0 ? (
        <p className="mm-muted" style={{ marginTop: 8 }}>Nothing open.</p>
      ) : (
        <ul className="mm-check-grid">
          {(upcoming || []).slice(0, 8).map((b) => (
            <li key={`${b.billId || b.name}-${b.date}`} className="mm-row">
              <span className="truncate">{b.name}</span>
              <b>{money(b.amount)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
    </div>
  )
}
