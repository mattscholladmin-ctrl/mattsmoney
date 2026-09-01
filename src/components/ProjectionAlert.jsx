// @ts-nocheck
import { money, shortDate } from '../lib/format'

const WINDOWS = [
  { id: 'paycheck', label: 'Next paycheck' },
  { id: '14', label: '2 weeks' },
  { id: '30', label: '30 days' },
]

// Little segmented control to switch the forecast window. Lives above the
// alert so it works whether the outlook is green, amber, or red.
function WindowToggle({ horizon, onHorizonChange }) {
  if (!onHorizonChange) return null
  return (
    <div className="flex mb-2 rounded-lg border border-slate-300 overflow-hidden">
      {WINDOWS.map((w, i) => {
        const active = horizon === w.id
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onHorizonChange(w.id)}
            className={`flex-1 px-2 py-2 text-xs font-semibold transition ${
              i > 0 ? 'border-l border-slate-300' : ''
            } ${active ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}
          >
            {w.label}
          </button>
        )
      })}
    </div>
  )
}

// Rule 3/4 lives here: the forecast never hides a coming shortfall — but instead
// of replacing the whole card with a banner, we always keep the numbers visible
// and flag any value that crosses the reserve floor or goes negative with small
// red text right under that value.
export default function ProjectionAlert({
  projection,
  spendableLowest,
  runway,
  netWindow,
  netBasis,
  beforePaycheck = null,
  paydayDate = null,
  horizonLabel = 'next paycheck',
  horizon,
  onHorizonChange,
  asOf,
  asOfStale,
  bufferFloor,
  hasBudgets = true,
}) {
  if (!projection) return null

  const toggle = (
    <WindowToggle horizon={horizon} onHorizonChange={onHorizonChange} />
  )

  // #2: when the trough hits, and (if it's a real bill/goal) what causes it.
  const trough = projection.lowestPoint
  const troughWhen = trough ? shortDate(trough.date) : 'today'
  const troughCause =
    trough && (trough.kind === 'bill' || trough.kind === 'goal')
      ? trough.name
      : null

  // The header + box color are the loudest signal on this card — they have to
  // match reality, not just say "On track" unconditionally. Danger (goes
  // negative) outranks warning (dips under your reserve), which outranks ok.
  const goesNegative = projection.lowest < 0
  const dipsIntoReserve =
    (spendableLowest != null && spendableLowest < 0) ||
    (bufferFloor != null && projection.lowest < bufferFloor)
  const status = goesNegative ? 'danger' : dipsIntoReserve ? 'warning' : 'ok'
  const STATUS = {
    danger: {
      box: 'bg-red-50 border-red-200',
      header: 'text-red-800',
      label: `Goes negative — ${horizonLabel}`,
    },
    warning: {
      box: 'bg-amber-50 border-amber-200',
      header: 'text-amber-800',
      label: `Dips into your reserve — ${horizonLabel}`,
    },
    ok: {
      box: 'bg-emerald-50 border-emerald-200',
      header: 'text-slate-800',
      label: `On track — ${horizonLabel}`,
    },
  }[status]

  return (
    <div>
      {toggle}
      <div className={`rounded-xl text-slate-700 p-4 border ${STATUS.box}`}>
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <p className={`font-semibold min-w-0 ${STATUS.header}`}>{STATUS.label}</p>
          {asOf && (
            <p
              className={`text-[0.75rem] shrink-0 whitespace-nowrap ${
                asOfStale ? 'text-amber-600' : 'text-slate-400'
              }`}
            >
              {asOfStale ? 'est. ' : 'as of '}{shortDate(asOf)}
            </p>
          )}
        </div>

        {/* The two trough numbers, side by side — no mental math needed. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {spendableLowest != null && (
            <div className="min-w-0 rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5">
              <p className="text-[0.75rem] uppercase tracking-wide text-slate-400">
                Lowest safe to spend
              </p>
              <p className={`text-xl font-bold cp-mono truncate ${spendableLowest < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {money(spendableLowest)}
              </p>
              {spendableLowest < 0 && (
                <p className="text-[0.75rem] text-red-600 mt-1">
                  ▼ dips into your reserve
                </p>
              )}
            </div>
          )}
          <div className="min-w-0 rounded-lg bg-slate-100 border border-slate-200 px-3 py-2.5">
            <p className="text-[0.75rem] uppercase tracking-wide text-slate-400">
              Lowest in the bank
            </p>
            <p className={`text-xl font-bold cp-mono truncate ${projection.lowest < 0 ? 'text-red-600' : 'text-slate-800'}`}>
              {money(projection.lowest)}
            </p>
            {projection.lowest < 0 ? (
              <p className="text-[0.75rem] text-red-600 mt-1">
                ▼ goes negative {troughWhen}
              </p>
            ) : projection.lowest < bufferFloor ? (
              <p className="text-[0.75rem] text-red-600 mt-1">
                ▼ under your {money(bufferFloor)} reserve
              </p>
            ) : null}
          </div>
        </div>

        <dl className="mt-3 space-y-1.5 text-sm">
          {/* #2 — when + cause of the dip */}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Lowest day</dt>
            <dd className="font-semibold text-right">
              {troughWhen}
              {troughCause ? (
                <span className="text-slate-400 font-normal">
                  {' '}· after {troughCause}
                </span>
              ) : null}
            </dd>
          </div>
          {/* #4 — where you land. On the paycheck view, split it into the low
              right BEFORE payday (spending done, deposit not in) and after the
              paycheck lands, so an incoming paycheck can't mask your spending. */}
          {beforePaycheck != null ? (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">
                  Right before payday{paydayDate ? ` · ${shortDate(paydayDate)}` : ''}
                </dt>
                <dd
                  className={`font-semibold text-right ${
                    beforePaycheck < (bufferFloor || 0) ? 'text-red-600' : ''
                  }`}
                >
                  {money(beforePaycheck)}
                </dd>
              </div>
              {netWindow != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">After your paycheck lands</dt>
                  <dd className="font-semibold text-right">
                    {money(projection.endingBalance)}{' '}
                    <span className={netWindow >= 0 ? 'text-emerald-800' : 'text-red-600'}>
                      ({netWindow >= 0 ? '▲' : '▼'} {money(Math.abs(netWindow))}
                      {netBasis ? <span className="font-normal opacity-70"> {netBasis}</span> : null})
                    </span>
                  </dd>
                </div>
              )}
            </>
          ) : (
            netWindow != null && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Balance by {horizonLabel}</dt>
                <dd className="font-semibold text-right">
                  {money(projection.endingBalance)}{' '}
                  <span className={netWindow >= 0 ? 'text-emerald-800' : 'text-red-600'}>
                    ({netWindow >= 0 ? '▲' : '▼'} {money(Math.abs(netWindow))}
                    {netBasis ? <span className="font-normal opacity-70"> {netBasis}</span> : null})
                  </span>
                </dd>
              </div>
            )
          )}
          {/* #3 — cash runway if income stopped, counted down to $0 */}
          {runway != null && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Cash lasts (if income stops)</dt>
              <dd className="font-semibold text-right">~{runway} days</dd>
            </div>
          )}
        </dl>

        {hasBudgets ? (
          <p className="text-xs mt-3 text-slate-400">
            Includes everyday food/gas/pet spending and ignores any unconfirmed
            income. “Safe to spend” already sets aside your buffer, goals, and
            trip funds.
          </p>
        ) : (
          <p className="text-xs mt-3 text-amber-700">
            No spending budgets set, so this forecast doesn't hold anything
            back for everyday spending (groceries, gas, etc.) — it's likely
            more optimistic than reality. Set budgets on the Insights page to
            fix that.
          </p>
        )}
      </div>
    </div>
  )
}
