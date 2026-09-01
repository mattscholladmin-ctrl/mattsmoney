// @ts-nocheck
import { useState } from 'react'
import { money, shortDate } from '../lib/format'

// Per-item build-up for a "Save each paycheck" line (bills OR debt) — how much of
// each item is set aside so far vs its target, and a "move it" action once it's
// genuinely sitting in savings. Shared so the Bills and Debt lines render identically.
function SmoothBreakdown({ items = [], onSmoothingMove, canMoveSmoothing }) {
  if (!items.length) return null
  return (
    <ul className="mt-1 mb-1 ml-3 pl-2 border-l-2 border-slate-100 space-y-2">
      {items.map((s) => {
        const pct = s.target > 0 ? Math.min(100, Math.round((s.saved / s.target) * 100)) : 0
        return (
          <li key={s.id} className="text-xs">
            <div className="flex justify-between text-slate-400">
              <span className="min-w-0 truncate pr-2">{s.name}</span>
              <span className="shrink-0">−{money(s.perPaycheck)}</span>
            </div>
            {s.target > 0 && (
              <>
                <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-slate-400">
                  <span className="min-w-0 truncate">{money(s.saved)} of {money(s.target)} in savings</span>
                  {onSmoothingMove && canMoveSmoothing && s.toMove >= 1 && (
                    <button
                      type="button"
                      onClick={() => onSmoothingMove(s, s.toMove, 1)}
                      className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
                    >
                      I moved {money(s.toMove)} →
                    </button>
                  )}
                </div>
                {onSmoothingMove && s.saved >= 1 && (
                  <button
                    type="button"
                    onClick={() => onSmoothingMove(s, Math.min(s.saved, s.slice || s.saved), -1)}
                    className="mt-0.5 text-[0.7rem] text-slate-300 hover:text-slate-500"
                  >
                    undo
                  </button>
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function SpendableCard({ info, everydayByCat = [], billSmoothed = 0, billSmoothedByItem = [], debtSmoothed = 0, debtSmoothedByItem = [], goalNextPaycheckByItem = [], goalNextPaycheckTotal = 0, onSmoothingMove = null, canMoveSmoothing = false, lowest = null, counting = { goals: true, debt: true }, onCounting = null, hasGoalReserve = false, hasDebtBills = false, asOf = null, asOfStale = false, onEditBudgets = null, closers = null, onPauseGoal = null, onLogSpend = null }) {
  const [showAfford, setShowAfford] = useState(false)
  const [afford, setAfford] = useState('')
  const [what, setWhat] = useState('')
  const [logging, setLogging] = useState(false)
  const [showEveryday, setShowEveryday] = useState(false)
  const [showBillsBreak, setShowBillsBreak] = useState(false)
  const [showDebtBreak, setShowDebtBreak] = useState(false)
  const [showGoalsBreak, setShowGoalsBreak] = useState(false)

  // Nothing set up yet. This used to render nothing at all — which meant a new
  // account never saw the single number the whole app is built around, and had
  // no idea it was the goal of setting anything up. Show it as a placeholder
  // that explains what it will become instead of hiding it.
  if (!info) {
    return (
      <section className="rounded-2xl p-5 shadow bg-white">
        <p className="text-xs uppercase tracking-widest text-slate-500 whitespace-nowrap">
          Safe to spend
        </p>
        <p className="text-5xl font-bold mt-2 cp-mono text-slate-300 whitespace-nowrap">$—</p>
        <p className="text-sm mt-3 text-slate-600">
          This is the one number to check before you spend anything. It's your
          real balance, minus the bills coming before your next paycheck, minus
          your buffer and anything you're saving for.
        </p>
        <p className="text-sm mt-2 text-slate-500">
          Add an account and your paycheck above and it starts working.
        </p>
      </section>
    )
  }

  const { spendable, start, floor, billsBeforePay, tripFunds, earmarked = 0, setAside = 0, everyday = 0, nextIncome } = info
  const negative = spendable <= 0

  // #1 Daily allowance: split what's safe to spend evenly over the days left
  // until the next paycheck, so there's a simple "spend this much a day" number.
  const daysUntil = nextIncome
    ? Math.max(1, Math.ceil((new Date(nextIncome.date + 'T00:00:00') - new Date()) / 86400000))
    : null
  const perDay = !negative && daysUntil ? spendable / daysUntil : null

  // #2 "Can I afford this?": the full picture after a purchase.
  const amt = Number(afford) || 0
  const afterSpend = afford !== '' ? spendable - amt : null
  const oldPerDay = daysUntil ? spendable / daysUntil : null
  const newPerDay = daysUntil ? Math.max(0, afterSpend) / daysUntil : null

  // #2b The number that really answers "can I afford it": a purchase today drags
  // your whole forecast down by that amount, so the lowest point before payday
  // drops by the same. That trough — not today's balance — is where a buy can
  // quietly cross your buffer.
  const lowSafe = lowest && lowest.safe != null ? lowest.safe : null
  const lowBank = lowest && lowest.bank != null ? lowest.bank : null
  const lowSafeAfter = lowSafe != null ? lowSafe - amt : null
  const lowBankAfter = lowBank != null ? lowBank - amt : null
  // Today's number can still say "yes" while the low dips into the buffer — but
  // only warn when THIS purchase is what crosses it. If the trough was already
  // under the buffer before the purchase (lowSafe < 0), don't blame the buy.
  const dipsBuffer =
    afford !== '' &&
    afterSpend != null &&
    afterSpend >= 0 &&
    lowSafe != null &&
    lowSafe >= 0 &&
    lowSafeAfter != null &&
    lowSafeAfter < 0

  return (
    <section className="@container min-w-0 rounded-2xl p-5 sm:p-6 shadow-xl bg-white">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.7rem] uppercase tracking-widest text-slate-500 whitespace-nowrap">
          Safe to spend
        </p>
        {asOf && (
          <p className={`text-[0.7rem] shrink-0 whitespace-nowrap ${asOfStale ? 'text-amber-600' : 'text-slate-400'}`}>
            {asOfStale ? 'est. ' : 'as of '}{shortDate(asOf)}
          </p>
        )}
      </div>
      <p
        className={`mt-2 text-5xl font-bold cp-mono leading-none whitespace-nowrap tracking-tight [font-size:clamp(2.375rem,14cqi,3.25rem)] ${
          negative ? 'text-red-600' : 'cp-glow-cyan'
        }`}
      >
        {negative ? `\u2212${money(Math.abs(spendable))}` : money(spendable)}
      </p>

      {perDay != null && (
        <p className="text-sm mt-2 font-medium text-emerald-700">
          ≈ {money(perDay)}/day until your {shortDate(nextIncome.date)} paycheck
        </p>
      )}

      {negative ? (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-800 font-medium">
            {money(Math.abs(spendable))} short of covering bills and reserve before payday.
          </p>
          {closers && closers.plan.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {closers.plan.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-red-800 min-w-0">
                    {a.label}
                    <span className="text-red-600/80"> · frees {money(a.frees)}</span>
                  </span>
                  {a.kind === 'pause-goal' && onPauseGoal && (
                    <button
                      type="button"
                      onClick={() => onPauseGoal(a.goalId)}
                      className="shrink-0 text-xs font-semibold text-red-800 border border-red-300 rounded-full px-2.5 py-1 min-h-11"
                    >
                      Pause
                    </button>
                  )}
                  {a.kind === 'hide-debt' && onCounting && (
                    <button
                      type="button"
                      onClick={() => onCounting((c) => ({ ...c, debt: false }))}
                      className="shrink-0 text-xs font-semibold text-red-800 border border-red-300 rounded-full px-2.5 py-1 min-h-11"
                    >
                      Leave out
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm mt-3 text-slate-600">
          {nextIncome
            ? `What's free until payday ${shortDate(nextIncome.date)} — bank balance minus bills, buffer, and money already spoken for.`
            : `What's free to spend — bank balance minus bills, buffer, and money already spoken for.`}
        </p>
      )}

      <ul className="mt-4 space-y-1 text-sm border-t border-slate-200 pt-3">
        <li className="flex justify-between">
          <span className="text-slate-500">Total Balance</span>
          <span className="text-slate-800 font-medium">{money(start)}</span>
        </li>
        <li className="flex justify-between">
          <span className="text-slate-500">Bills before next paycheck</span>
          <span className="text-slate-800">−{money(billsBeforePay)}</span>
        </li>
        {everyday > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setShowEveryday((v) => !v)}
              className="w-full flex justify-between items-center text-left"
            >
              <span className="text-slate-500">
                Everyday spending (budgets left)
                <span className="text-slate-400 text-xs"> {showEveryday ? '▾' : '▸'}</span>
              </span>
              <span className="text-slate-800">−{money(everyday)}</span>
            </button>
            {showEveryday && everydayByCat.length > 0 && (
              <ul className="mt-1 mb-1 ml-3 pl-2 border-l-2 border-slate-100 space-y-0.5">
                {everydayByCat.map((c) => (
                  <li key={c.category} className="flex justify-between text-xs text-slate-400">
                    <span className="min-w-0 truncate pr-2">
                      {c.category}
                      {c.spent > 0 ? ` · ${money(c.spent)} of ${money(c.perPeriod)} spent` : ''}
                    </span>
                    <span className="shrink-0">−{money(c.remaining)}</span>
                  </li>
                ))}
                {onEditBudgets && (
                  <li className="pt-1">
                    <button
                      type="button"
                      onClick={onEditBudgets}
                      className="text-xs font-medium text-emerald-700"
                    >
                      Edit budgets →
                    </button>
                  </li>
                )}
              </ul>
            )}
          </li>
        ) : (
          everydayByCat.length === 0 && (
            <li className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-800">
              No spending budgets set — this number doesn't hold anything back
              for groceries, gas, or other everyday spending yet, so it's
              probably higher than what's really free. Set budgets on the
              Insights page to fix that.
            </li>
          )
        )}
        {floor > 0 && (
          <li className="flex justify-between">
            <span className="text-slate-500">Your buffer (untouchable)</span>
            <span className="text-slate-800">−{money(floor)}</span>
          </li>
        )}
        {earmarked > 0 && (
          <li className="flex justify-between">
            <span className="text-slate-500">Already saved in goals</span>
            <span className="text-slate-800">−{money(earmarked)}</span>
          </li>
        )}
        {setAside > 0 && (
          <li className="flex justify-between">
            <span className="text-slate-500">Held for a known expense</span>
            <span className="text-slate-800">−{money(setAside)}</span>
          </li>
        )}
        {goalNextPaycheckTotal > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setShowGoalsBreak((v) => !v)}
              className="w-full flex justify-between items-center text-left"
            >
              <span className="text-slate-500">
                Saving toward goals
                {goalNextPaycheckByItem.length > 0 && (
                  <span className="text-slate-400 text-xs"> {showGoalsBreak ? '▾' : '▸'}</span>
                )}
              </span>
              <span className="text-slate-800">−{money(goalNextPaycheckTotal)}</span>
            </button>
            {showGoalsBreak && goalNextPaycheckByItem.length > 0 && (
              <ul className="mt-1 mb-1 ml-3 pl-2 border-l-2 border-slate-100 space-y-0.5">
                {goalNextPaycheckByItem.map((g) => (
                  <li key={g.id} className="flex justify-between text-xs text-slate-400">
                    <span className="min-w-0 truncate pr-2">{g.name}</span>
                    <span className="shrink-0">−{money(g.perPaycheck)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {billSmoothed > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setShowBillsBreak((v) => !v)}
              className="w-full flex justify-between items-center text-left"
            >
              <span className="text-slate-500">
                Toward bills each paycheck
                <span className="text-slate-400 text-xs"> {showBillsBreak ? '▾' : '▸'}</span>
              </span>
              <span className="text-slate-800">−{money(billSmoothed)}</span>
            </button>
            {showBillsBreak && (
              <SmoothBreakdown items={billSmoothedByItem} onSmoothingMove={onSmoothingMove} canMoveSmoothing={canMoveSmoothing} />
            )}
          </li>
        )}
        {debtSmoothed > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setShowDebtBreak((v) => !v)}
              className="w-full flex justify-between items-center text-left"
            >
              <span className="text-slate-500">
                Toward debt each paycheck
                <span className="text-slate-400 text-xs"> {showDebtBreak ? '▾' : '▸'}</span>
              </span>
              <span className="text-slate-800">−{money(debtSmoothed)}</span>
            </button>
            {showDebtBreak && (
              <SmoothBreakdown items={debtSmoothedByItem} onSmoothingMove={onSmoothingMove} canMoveSmoothing={canMoveSmoothing} />
            )}
          </li>
        )}
        {tripFunds > 0 && (
          <li className="flex justify-between">
            <span className="text-slate-500">Held for a trip</span>
            <span className="text-slate-800">−{money(tripFunds)}</span>
          </li>
        )}
      </ul>

      {/* On-the-fly toggles: include/exclude goals & debt from the number above,
          without changing your saved settings. */}
      {onCounting && (hasGoalReserve || hasDebtBills) && (
        <div className="mt-3 flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-500">Counting:</span>
          {hasGoalReserve && (
            <button
              onClick={() => onCounting((c) => ({ ...c, goals: !c.goals }))}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                counting.goals
                  ? 'bg-sky-100 text-sky-700 border-sky-200'
                  : 'bg-slate-100 text-slate-400 border-slate-200'
              }`}
              title="Include your goal set-asides in Safe to spend"
            >
              {counting.goals ? '● Goals' : '○ Goals'}
            </button>
          )}
          {hasDebtBills && (
            <button
              onClick={() => onCounting((c) => ({ ...c, debt: !c.debt }))}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                counting.debt
                  ? 'bg-sky-100 text-sky-700 border-sky-200'
                  : 'bg-slate-100 text-slate-400 border-slate-200'
              }`}
              title="Include your debt payments in Safe to spend"
            >
              {counting.debt ? '● Debt' : '○ Debt'}
            </button>
          )}
        </div>
      )}

      {/* #2 Can I afford this? — always on the card, not tucked behind a tap. */}
      <div className="mt-3 border-t border-slate-200 pt-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 mb-2">Can I afford this?</p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">If I spend</span>
              <span className="text-slate-500">$</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={afford}
                onChange={(e) => setAfford(e.target.value)}
                placeholder="0.00"
                className="w-28 rounded-lg border border-slate-300 px-3 py-2.5 text-base min-h-11"
              />
              {afford !== '' && (
              <button
                onClick={() => {
                  setAfford('')
                }}
                className="text-sm text-slate-400 ml-auto"
              >
                Clear
              </button>
              )}
            </div>
            {afterSpend != null && afford !== '' && (
              <div className="mt-3">
                <p className={`text-sm font-medium ${afterSpend >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {afterSpend >= 0
                    ? `✓ Yes — you'd still have ${money(afterSpend)} safe to spend.`
                    : `✗ That's ${money(Math.abs(afterSpend))} past your safe-to-spend — it dips into your reserve.`}
                </p>
                {dipsBuffer && (
                  <p className="text-sm mt-1 text-amber-600">
                    ⚠ Heads up — this pushes your lowest day
                    {lowest.date ? ` (${shortDate(lowest.date)})` : ''} {money(Math.abs(lowSafeAfter))} into
                    your buffer before payday.
                  </p>
                )}
                <ul className="mt-2 space-y-1 text-sm">
                  <li className="flex justify-between">
                    <span className="text-slate-500">Safe to spend</span>
                    <span>
                      <span className="text-slate-400">{money(spendable)} → </span>
                      <span className={`font-medium ${afterSpend < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                        {money(afterSpend)}
                      </span>
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-500">Total cash</span>
                    <span>
                      <span className="text-slate-400">{money(start)} → </span>
                      <span className="font-medium text-slate-800">{money(start - amt)}</span>
                    </span>
                  </li>
                  {daysUntil && (
                    <li className="flex justify-between">
                      <span className="text-slate-500">Per day till paycheck</span>
                      <span>
                        <span className="text-slate-400">{money(oldPerDay)} → </span>
                        <span className="font-medium text-slate-800">{money(newPerDay)}/day</span>
                      </span>
                    </li>
                  )}
                  {lowSafe != null && (
                    <li className="pt-2 mt-1 border-t border-slate-100">
                      <p className="text-xs text-slate-400 mb-1">
                        At your lowest point{lowest.date ? ` (${shortDate(lowest.date)})` : ''} before payday:
                      </p>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Lowest safe to spend</span>
                        <span>
                          <span className="text-slate-400">{money(lowSafe)} → </span>
                          <span className={`font-medium ${lowSafeAfter < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                            {money(lowSafeAfter)}
                          </span>
                        </span>
                      </div>
                      {lowBank != null && (
                        <div className="flex justify-between mt-1">
                          <span className="text-slate-500">Lowest in the bank</span>
                          <span>
                            <span className="text-slate-400">{money(lowBank)} → </span>
                            <span className={`font-medium ${lowBankAfter < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                              {money(lowBankAfter)}
                            </span>
                          </span>
                        </div>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            )}
            {afterSpend != null && afford !== '' && amt > 0 && onLogSpend && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={what}
                  onChange={(e) => setWhat(e.target.value)}
                  placeholder="What for?"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-base min-h-11"
                />
                <button
                  type="button"
                  disabled={logging}
                  onClick={async () => {
                    setLogging(true)
                    try {
                      await onLogSpend({ amount: amt, merchant: what })
                      setAfford('')
                      setWhat('')
                    } finally {
                      setLogging(false)
                    }
                  }}
                  className="shrink-0 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 min-h-11 disabled:opacity-60"
                >
                  {logging ? 'Saving…' : 'Log this spend'}
                </button>
              </div>
            )}
          </div>
      </div>
    </section>
  )
}
