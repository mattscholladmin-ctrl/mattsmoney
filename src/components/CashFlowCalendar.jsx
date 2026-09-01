// @ts-nocheck
import { money, shortDate, isoDate } from '../lib/format'

// A day-by-day view of dated money in (paychecks, expected) and out (bills,
// planned items) over the next 30 days, with the running balance and the
// lowest day flagged. Everyday food/gas/pet spending isn't shown here — these
// are the discrete, scheduled events.
//
// Phones get the original list. Desktop (lg+) gets a real month grid: 7
// weekday columns, one cell per day, money in/out on the days it happens.
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_MS = 24 * 60 * 60 * 1000

// A short, always-fits amount for a narrow calendar cell — whole dollars, and
// abbreviated to "k" above $1,000 (the full precise figure is still in the hover
// tooltip). Truncating with an ellipsis was clipping real numbers off entirely;
// this guarantees something readable renders instead.
function compactMoney(n) {
  const v = Math.abs(Number(n) || 0)
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return `$${Math.round(v)}`
}

function MonthGrid({ byDate, lowestDate }) {
  // Cells run from the Sunday of the current week. Size the grid to whole weeks
  // that cover the full 30-day horizon — otherwise, on a Fri/Sat, the last days
  // of the horizon (a far-out bill/paycheck, even the "lowest day") fall past a
  // fixed 5-week grid and silently vanish.
  const today = new Date(isoDate() + 'T00:00:00')
  const start = new Date(today.getTime() - today.getDay() * DAY_MS)
  const horizonEnd = new Date(today.getTime() + 30 * DAY_MS)
  const cellCount = Math.ceil((today.getDay() + 31) / 7) * 7
  const cells = []
  for (let i = 0; i < cellCount; i++) {
    const d = new Date(start.getTime() + i * DAY_MS)
    const iso = isoDate(d)
    cells.push({
      iso,
      day: d.getDate(),
      monthShort:
        d.getDate() === 1 || i === 0
          ? d.toLocaleDateString('en-US', { month: 'short' })
          : null,
      items: byDate[iso] || [],
      inWindow: d >= today && d <= horizonEnd,
      isToday: iso === isoDate(today),
      isLow: iso === lowestDate,
    })
  }

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs uppercase tracking-wide text-slate-400 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden bg-slate-200 border border-slate-200">
        {cells.map((c) => {
          const totalIn = c.items.filter((p) => p.delta > 0).reduce((s, p) => s + p.delta, 0)
          const totalOut = c.items.filter((p) => p.delta < 0).reduce((s, p) => s - p.delta, 0)
          const balAfter = c.items.length ? c.items[c.items.length - 1].balanceAfter : null
          const tip = c.items.length
            ? c.items
                .map((p) => `${p.delta > 0 ? '+' : '−'}${money(Math.abs(p.delta))} ${p.name}`)
                .join('\n') + (balAfter != null ? `\nbalance after ${money(balAfter)}` : '')
            : undefined
          return (
            <div
              key={c.iso}
              title={tip}
              className={`min-h-[4.5rem] p-1 text-left align-top bg-white ${
                c.inWindow ? '' : 'opacity-45'
              } ${c.isLow ? 'ring-2 ring-inset ring-red-400' : ''}`}
            >
              <div className="flex items-baseline gap-1">
                <span
                  className={`text-xs leading-none ${
                    c.isToday
                      ? 'font-bold text-white bg-emerald-700 rounded-full px-1.5 py-0.5'
                      : c.inWindow
                      ? 'text-slate-500'
                      : 'text-slate-300'
                  }`}
                >
                  {c.day}
                </span>
                {c.monthShort && (
                  <span className="text-[0.7rem] uppercase text-slate-400">{c.monthShort}</span>
                )}
              </div>
              {totalIn > 0 && (
                <p className="mt-0.5 text-xs font-semibold leading-tight text-emerald-700 break-words">
                  +{compactMoney(totalIn)}
                </p>
              )}
              {totalOut > 0 && (
                <p
                  className="mt-0.5 text-xs font-semibold leading-tight break-words"
                  style={{ color: '#a8573f' }}
                >
                  −{compactMoney(totalOut)}
                </p>
              )}
              {c.isLow && (
                <p className="text-[0.7rem] font-medium text-red-600 leading-tight">lowest</p>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-400 mt-2">
        Amounts are rounded to fit — hover a day for the exact breakdown. Red outline
        = your lowest day.
      </p>
    </div>
  )
}

export default function CashFlowCalendar({ cashflow }) {
  if (!cashflow || !cashflow.points || cashflow.points.length === 0) return null
  const { points, start, lowestDate } = cashflow

  const byDate = {}
  for (const p of points) (byDate[p.date] ||= []).push(p)
  const days = Object.keys(byDate).sort()

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <h2 className="font-semibold text-slate-800 mb-1">Cash-flow calendar</h2>
      <p className="text-xs text-slate-400 mb-3">
        Scheduled money in &amp; out over the next 30 days. Your lowest day is flagged.
        (Everyday spending isn&apos;t shown here.)
      </p>

      <div className="flex justify-between text-sm mb-3 pb-3 border-b border-slate-100">
        <span className="text-slate-500">Starting balance</span>
        <span className="font-medium text-slate-800">{money(start)}</span>
      </div>

      {/* Desktop: month grid */}
      <div className="hidden lg:block">
        <MonthGrid byDate={byDate} lowestDate={lowestDate} />
      </div>

      {/* Phone: day list */}
      <ul className="space-y-3 lg:hidden">
        {days.map((d) => {
          const items = byDate[d]
          const balAfter = items[items.length - 1].balanceAfter
          const isLow = d === lowestDate
          return (
            <li key={d} className="flex gap-3">
              <div className="w-12 shrink-0 text-xs text-slate-400 pt-0.5">{shortDate(d)}</div>
              <div className="flex-1 min-w-0">
                {items.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm gap-2">
                    <span className="min-w-0 text-slate-700 truncate">
                      {p.name || (p.kind === 'income' ? 'Income' : 'Payment')}
                    </span>
                    <span
                      className={p.delta >= 0 ? 'text-emerald-700 shrink-0' : 'shrink-0'}
                      style={p.delta < 0 ? { color: '#a8573f' } : undefined}
                    >
                      {p.delta >= 0 ? '+' : '−'}
                      {money(Math.abs(p.delta))}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between text-xs mt-0.5">
                  <span className={isLow ? 'text-red-600 font-medium' : 'text-slate-400'}>
                    {isLow ? '▼ lowest day' : 'balance after'}
                  </span>
                  <span className={isLow ? 'text-red-600 font-medium' : 'text-slate-500'}>
                    {money(balAfter)}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
