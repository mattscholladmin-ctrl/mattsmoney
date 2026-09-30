// @ts-nocheck
// Matt's Money — paycheck-first shell.
// Four pages: Home (paycheck plan), Bills, Activity, Settings.
// No Dollarwise-isms: no purposes, no review queue, no insights rail.
import { useMemo, useState } from 'react'
import { signOut } from '../auth/AuthProvider'
import { computePaycheckPlan } from '../lib/paycheck-plan'
import { upcomingIncome } from '../lib/budget'
import { isoDate, shortDate } from '../lib/format'
import PaycheckHome from './PaycheckHome'
import RecurringBillsCard from './RecurringBillsCard'
import IncomeCard from './IncomeCard'
import ConnectBankCard from './ConnectBankCard'
import '../paycheck-home.css'

function Icon({ d, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
const ICONS = {
  home: 'M3 12l9-9 9 9M5 10v10h14V10',
  bills: 'M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM9 8h6M9 12h6M9 16h4',
  activity: 'M4 6h16M4 12h16M4 18h10',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 20h-4l-.5-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 4h4l.5 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6c.06.4.1.8.1 1.2z',
}

function money(n) {
  const v = Number(n || 0)
  return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function DwApp({ data, setData, load, session, demo, syncing }) {
  const [page, setPage] = useState('home')

  const pay = useMemo(() => computePaycheckPlan({ data }), [data])

  const upcoming = useMemo(
    () => upcomingIncome(data.income || [], isoDate(), 90, data.transactions || []),
    [data]
  )

  function go(id) {
    setPage(id)
    try { window.scrollTo({ top: 0 }) } catch { /* noop */ }
  }

  const nav = [
    { id: 'home', label: 'Home', icon: ICONS.home },
    { id: 'bills', label: 'Bills', icon: ICONS.bills },
    { id: 'activity', label: 'Activity', icon: ICONS.activity },
    { id: 'settings', label: 'Settings', icon: ICONS.settings },
  ]

  return (
    <div className="ph-page">
      {page === 'home' && <PaycheckHome pay={pay} onGo={go} />}

      {page === 'bills' && (
        <div className="ph">
          <section className="ph-card">
            <div className="ph-card-head">
              <h2>Bills</h2>
            </div>
            <p className="ph-mute" style={{ marginTop: 0 }}>
              These feed your paycheck plan — the app sets aside enough from each check to cover them.
            </p>
            <RecurringBillsCard
              bills={data.bills || []}
              transactions={data.transactions || []}
              onChanged={load}
              embedded
            />
          </section>
        </div>
      )}

      {page === 'activity' && <Activity data={data} />}

      {page === 'settings' && (
        <div className="ph">
          <section className="ph-card">
            <div className="ph-card-head"><h2>Income</h2></div>
            <IncomeCard
              income={data.income || []}
              upcomingIncome={upcoming}
              transactions={data.transactions || []}
              onChanged={load}
            />
          </section>
          <section className="ph-card">
            <div className="ph-card-head"><h2>Bank connection</h2></div>
            {(data.accounts || []).map((a) => (
              <div key={a.id} className="ph-list-row">
                <span>{a.name} {a.mask || ''}</span>
                <b>{a.kind || a.type || ''}</b>
              </div>
            ))}
            <ConnectBankCard />
            <button className="ph-link" onClick={() => load()}>
              Refresh bank data {syncing ? '…' : ''}
            </button>
          </section>
          <section className="ph-card">
            <div className="ph-card-head"><h2>Account</h2></div>
            <p className="ph-mute">
              {session?.user?.email || 'Signed in'}
              {demo ? ' · demo mode' : ''}
            </p>
            <button className="ph-link" onClick={() => signOut()}>
              Log out
            </button>
          </section>
        </div>
      )}

      <nav className="ph-nav">
        {nav.map((n) => (
          <button key={n.id} className={page === n.id ? 'on' : ''} onClick={() => go(n.id)}>
            <Icon d={n.icon} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function Activity({ data }) {
  const tx = useMemo(() => {
    const list = [...(data.transactions || [])]
    list.sort((a, b) => String(b.txn_date || '').localeCompare(String(a.txn_date || '')))
    return list.slice(0, 100)
  }, [data])
  return (
    <div className="ph">
      <section className="ph-card">
        <div className="ph-card-head"><h2>Recent activity</h2></div>
        {tx.length === 0 ? (
          <p className="ph-mute">No transactions yet. Connect your bank to see them here.</p>
        ) : (
          <ul className="ph-list">
            {tx.map((t) => (
              <li key={t.id}>
                <span className="ph-list-main">
                  <b>{t.merchant || t.name || '—'}</b>
                  <em>{t.txn_date ? shortDate(t.txn_date) : ''}{t.pending ? ' · pending' : ''}</em>
                </span>
                <b className="ph-list-amt">{money(t.amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
