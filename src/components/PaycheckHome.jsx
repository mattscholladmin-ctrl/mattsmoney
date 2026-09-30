// @ts-nocheck
// Paycheck-first home screen. One question: "what can I spend until payday?"
// No Dollarwise-isms: no purposes, no review queue, no insights rail.
// Just the paycheck plan, a visual breakdown, and what's due.
import { useState } from 'react'
import { shortDate } from '../lib/format'

function money(n) {
  const v = Number(n || 0)
  return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function money0(n) {
  const v = Number(n || 0)
  return `$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

const STS_COPY =
  "Safe to spend is your checking balance minus the bills due before your next payday, minus this paycheck's share of bills due later, minus anything you've set aside. It's what's genuinely OK to spend until payday."

function BreakdownBar({ pay }) {
  const segs = [
    { label: 'Safe to spend', amount: Math.max(0, pay.safeToSpend), cls: 'ph-seg-safe' },
    { label: 'Bills due before payday', amount: Math.max(0, Number(pay.info.billsBeforePay || 0)), cls: 'ph-seg-due' },
    { label: "Later bills' share", amount: Math.max(0, Number(pay.info.laterShare || 0)), cls: 'ph-seg-share' },
    { label: 'Held aside', amount: Math.max(0, Number(pay.info.setAside || 0)), cls: 'ph-seg-held' },
  ].filter((s) => s.amount > 0.005)
  const total = segs.reduce((t, s) => t + s.amount, 0) || 1
  return (
    <div className="ph-breakdown">
      <div className="ph-bar" role="img" aria-label="Where your checking balance goes">
        {segs.map((s) => (
          <div
            key={s.label}
            className={`ph-seg ${s.cls}`}
            style={{ width: `${(s.amount / total) * 100}%` }}
            title={`${s.label}: ${money(s.amount)}`}
          />
        ))}
      </div>
      <div className="ph-legend">
        {segs.map((s) => (
          <div key={s.label} className="ph-legend-item">
            <span className={`ph-dot ${s.cls}`} />
            <span className="ph-legend-label">{s.label}</span>
            <b className="ph-legend-amt">{money0(s.amount)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PaycheckHome({ pay, onGo }) {
  const [showHow, setShowHow] = useState(false)
  const dueNow = pay.info.windowItems || []
  const shares = pay.info.laterItems || []
  const next = pay.nextIncome

  const daysLabel = pay.daysLeft != null
    ? pay.daysLeft === 1 ? '1 day left' : `${pay.daysLeft} days left`
    : null

  return (
    <div className="ph">
      {/* Hero */}
      <section className="ph-hero">
        <div className="ph-hero-top">
          <span className="ph-eyebrow">Safe to spend</span>
          {next && (
            <span className="ph-payday-pill">
              Payday {shortDate(next.date)}{daysLabel ? ` · ${daysLabel}` : ''}
            </span>
          )}
        </div>
        <div className="ph-amount">{money(pay.safeToSpend)}</div>
        <div className="ph-sub">
          {next ? (
            <>Good until <b>{shortDate(next.date)}</b>{pay.perDay != null && <> · about <b>{money(pay.perDay)}</b> a day</>}</>
          ) : (
            <>Add your payday in Settings so this plans against your next check.</>
          )}
        </div>
        <BreakdownBar pay={pay} />
        <button className="ph-how-toggle" onClick={() => setShowHow((v) => !v)}>
          {showHow ? 'Hide the math' : 'How is this figured?'}
        </button>
        {showHow && (
          <div className="ph-how">
            <p>{STS_COPY}</p>
            <p className="ph-math">
              {money(pay.start)} checking
              {' '}− {money(pay.info.billsBeforePay)} bills due
              {' '}− {money(pay.info.laterShare)} later shares
              {Number(pay.info.setAside || 0) > 0 && <> − {money(pay.info.setAside)} held</>}
              {' '} = <b>{money(pay.safeToSpend)}</b>
            </p>
          </div>
        )}
      </section>

      {/* Set aside */}
      <section className="ph-card">
        <div className="ph-card-head">
          <h2>Set aside from this paycheck</h2>
          <b className="ph-total">{money(pay.setAsideTotal)}</b>
        </div>
        {!pay.hasIncome && (
          <p className="ph-mute">
            Add your payday in <button className="ph-link" onClick={() => onGo('settings')}>Settings</button> and
            each paycheck gets its own set-aside plan.
          </p>
        )}
        {dueNow.length > 0 && (
          <>
            <p className="ph-section-label">
              Due before {next ? `payday ${shortDate(next.date)}` : 'payday'} — hold the full amount
            </p>
            <ul className="ph-list">
              {dueNow.map((b) => (
                <li key={b.id}>
                  <span className="ph-list-main">
                    <b>{b.name}</b>
                    <em>due {b.due ? shortDate(b.due) : 'soon'}</em>
                  </span>
                  <b className="ph-list-amt">{money(b.amount)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
        {shares.length > 0 && (
          <>
            <p className="ph-section-label">Due later — this paycheck's share</p>
            <ul className="ph-list">
              {shares.map((b) => (
                <li key={b.id}>
                  <span className="ph-list-main">
                    <b>{b.name}</b>
                    <em>
                      {money(b.share)} of {money(b.amount)}
                      {b.due ? ` · due ${shortDate(b.due)}` : ''}
                    </em>
                  </span>
                  <b className="ph-list-amt">{money(b.share)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
        {dueNow.length === 0 && shares.length === 0 && (
          <p className="ph-mute">Nothing needs setting aside right now.</p>
        )}
        <button className="ph-link" onClick={() => onGo('bills')}>
          Manage bills →
        </button>
      </section>

      {/* Paydays */}
      <section className="ph-card">
        <div className="ph-card-head">
          <h2>Upcoming paydays</h2>
        </div>
        {pay.paydays.length === 0 ? (
          <p className="ph-mute">
            No paydays on the calendar.{' '}
            <button className="ph-link" onClick={() => onGo('settings')}>
              Add your income
            </button>
          </p>
        ) : (
          <ul className="ph-list">
            {pay.paydays.map((pd, i) => (
              <li key={`${pd.date}-${pd.name}-${i}`}>
                <span className="ph-list-main">
                  <b>{pd.name}</b>
                  <em>{shortDate(pd.date)}</em>
                </span>
                <b className="ph-list-amt">{money(pd.amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
