// @ts-nocheck
import { useEffect, useMemo, useState } from 'react'
import { updateTransaction, addTransaction, upsertBudget } from '../lib/api'
import { signOut } from '../auth/AuthProvider'
import { computePaycheckPlan } from '../lib/paycheck-plan'
import { shortDate } from '../lib/format'
import ConnectBankCard from './ConnectBankCard'
import RecurringBillsCard from './RecurringBillsCard'
import IncomeCard from './IncomeCard'
import { upcomingIncome } from '../lib/budget'
import { isoDate } from '../lib/format'
import '../dw.css'
import {
  PLAN_DEFAULT,
  PURPOSES,
  CATEGORY_CATALOG,
  moneyFull,
  moneyCompact,
  monthKeyFrom,
  monthLabel,
  loadDwState,
  saveDwState,
  computeProduct,
  insightCards,
  mapCategory,
} from '../lib/dw-product'

const STS_COPY =
  "Safe to Spend is calculated from your estimated monthly income, multiplied by your 'wants' percentage from your spending plan, minus what you've already spent on wants this month."

function Icon({ d, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  home: 'M3 12l9-9 9 9M5 10v10h14V10',
  pie: 'M12 2v10l8 4A10 10 0 1112 2z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0',
  tray: 'M3 7h18M5 7l2 12h10l2-12',
}

function applyTheme(mode) {
  const root = document.documentElement
  root.dataset.dw = '1'
  if (mode === 'system') {
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.dwtheme = dark ? 'dark' : 'light'
  } else {
    root.dataset.dwtheme = mode
  }
}

export default function DwApp({ data, setData, load, session, demo, syncing }) {
  const [state, setState] = useState(() => ({
    plan: PLAN_DEFAULT,
    theme: 'system',
    estFreq: 'two-weeks',
    meta: {},
    budgets: {},
    dismissed: [],
    ...loadDwState(),
  }))
  const [page, setPage] = useState(() => {
    try {
      return localStorage.getItem('mm.dw.page') || 'home'
    } catch {
      return 'home'
    }
  })
  const [month, setMonth] = useState(() => monthKeyFrom(new Date()))
  const [collapsed, setCollapsed] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [filterPurpose, setFilterPurpose] = useState('all')
  const [query, setQuery] = useState('')
  const [reviewIdx, setReviewIdx] = useState(0)
  const [reviewHist, setReviewHist] = useState([])
  const [reviewTotals, setReviewTotals] = useState({ needs: 0, wants: 0, savings: 0 })
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return localStorage.getItem('mm.dw.reviewIntro') !== '1'
    } catch {
      return true
    }
  })
  const [phoneMoreCats, setPhoneMoreCats] = useState(false)

  useEffect(() => {
    saveDwState(state)
    applyTheme(state.theme || 'system')
  }, [state])
  useEffect(() => {
    try {
      localStorage.setItem('mm.dw.page', page)
    } catch {
      /* ignore */
    }
  }, [page])

  const product = useMemo(() => computeProduct({ data, state, month }), [data, state, month])
  const pay = useMemo(() => computePaycheckPlan({ data }), [data])
  const upcoming = useMemo(
    () => upcomingIncome(data.income || [], isoDate(), 90, data.transactions || []),
    [data]
  )
  const insights = useMemo(
    () => insightCards(product, month).filter((c) => !state.dismissed?.includes(c.id)),
    [product, month, state.dismissed]
  )

  function patchState(partial) {
    setState((s) => ({ ...s, ...partial }))
  }

  function setMeta(id, patch) {
    setState((s) => ({
      ...s,
      meta: { ...(s.meta || {}), [String(id)]: { ...(s.meta?.[String(id)] || {}), ...patch } },
    }))
  }

  async function classify(t, purpose) {
    setMeta(t.id, { purpose })
    try {
      const note = String(t.note || '').replace(/purpose:(needs|wants|savings|unreviewed)/i, '').trim()
      await updateTransaction({ id: t.id, note: `${note} purpose:${purpose}`.trim() })
    } catch {
      /* local meta still applies */
    }
  }

  async function setCat(t, category) {
    setMeta(t.id, { category })
    try {
      await updateTransaction({ id: t.id, category })
    } catch {
      /* local */
    }
  }

  const months = useMemo(() => {
    const out = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push(monthKeyFrom(d))
    }
    return out
  }, [])

  const queue = product.queue
  const front = queue[reviewIdx] || null

  function goReview(dir) {
    if (!front) return
    classify(front, dir)
    setReviewHist((h) => [...h, { id: front.id, purpose: dir, amount: Math.abs(Number(front.amount || 0)) }])
    setReviewTotals((t) => ({ ...t, [dir]: t[dir] + Math.abs(Number(front.amount || 0)) }))
    setReviewIdx((i) => i + 1)
  }

  function skipReview() {
    setReviewIdx((i) => i + 1)
  }

  function undoReview() {
    const last = reviewHist[reviewHist.length - 1]
    if (!last) return
    setMeta(last.id, { purpose: 'unreviewed' })
    setReviewHist((h) => h.slice(0, -1))
    setReviewTotals((t) => ({ ...t, [last.purpose]: Math.max(0, t[last.purpose] - last.amount) }))
    setReviewIdx((i) => Math.max(0, i - 1))
  }

  const nav = [
    { id: 'home', label: 'Home', icon: ICONS.home },
    { id: 'bills', label: 'Bills', icon: ICONS.pie },
    { id: 'activity', label: 'Activity', icon: ICONS.grid },
    { id: 'profile', label: 'Settings', icon: ICONS.person },
  ]

  const catRows = Object.entries(product.catSpend)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amt]) => ({
      name,
      amt,
      color: CATEGORY_CATALOG.find((c) => c.name === name)?.color || '#ce69be',
      budget: Number(product.budgets[name] || 0),
    }))

  const visibleCats = phoneMoreCats ? catRows : catRows.slice(0, 10)

  function TxSheet({ t, onClose }) {
    if (!t) return null
    const purpose = PURPOSES.find((p) => p.id === t.purpose) || PURPOSES[0]
    return (
      <div className="dw-sheet-dim" onClick={onClose}>
        <aside className="dw-sheet" onClick={(e) => e.stopPropagation()}>
          <button className="dw-x" onClick={onClose}>
            ×
          </button>
          <div className="dw-mark">{(t.merchant || '?')[0]}</div>
          <h2>
            {t.merchant || 'Transaction'}{' '}
            <span className="dw-mono">{t.pending ? '' : '-'}{moneyFull(Math.abs(Number(t.amount || 0)))}</span>
          </h2>
          <p className="dw-mute">{t.txn_date}</p>
          {t.pending && <span className="dw-chip">PENDING</span>}
          <label className="dw-field">
            Purpose
            <select value={t.purpose} onChange={(e) => classify(t, e.target.value)} disabled={t.pending}>
              {PURPOSES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dw-field">
            Category
            <select value={t.category} onChange={(e) => setCat(t, e.target.value)} disabled={t.pending}>
              {CATEGORY_CATALOG.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
              <option>Transfers</option>
              <option>Income</option>
            </select>
          </label>
          <p className="dw-mute" style={{ marginTop: 12 }}>
            Visibility: {t.hidden ? 'Hidden from Insights' : 'SHOW'}
          </p>
          <button className="dw-text" onClick={() => setMeta(t.id, { hidden: !t.hidden })}>
            {t.hidden ? 'Show in budgets' : 'Hide from budgets'}
          </button>
        </aside>
      </div>
    )
  }

  function Sidebar() {
    return (
      <aside className={`dw-side ${collapsed ? 'is-thin' : ''}`}>
        <div className="dw-brand">
          {!collapsed && (
            <div className="dw-word">
              matt’s <em>money</em>
            </div>
          )}
          <button className="dw-collapse" onClick={() => setCollapsed((c) => !c)} aria-label="Collapse">
            ☰
          </button>
        </div>
        {!collapsed && (
          <div className="dw-sts">
            <div className="dw-k">Safe to spend</div>
            <div className="dw-sts-amt">
              <span className="dw-dol">$</span>
              <span className="dw-dol-n">{Math.floor(Math.abs(pay.safeToSpend)).toLocaleString()}</span>
              <span className="dw-dol-c">.{String(Math.round((Math.abs(pay.safeToSpend) % 1) * 100)).padStart(2, '0')}</span>
            </div>
            <div className="dw-sts-row">
              <button className="dw-link" onClick={() => setInfoOpen((v) => !v)} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>
                {pay.nextIncome ? `Until ${shortDate(pay.nextIncome.date)}` : 'Add payday'} ▾
              </button>
              <button className="dw-i" onClick={() => setInfoOpen((v) => !v)} aria-label="About Safe to Spend">
                i
              </button>
            </div>
            {infoOpen && (
              <div className="dw-pop">
                <p>Safe to spend is your checking balance minus bills due before your next payday, minus this paycheck's share of later bills, minus anything held aside. It's what's OK to spend until payday.</p>
              </div>
            )}
          </div>
        )}
        <nav className="dw-nav">
          {nav.map((n) => (
            <button
              key={n.id}
              className={`dw-nav-item ${page === n.id ? 'on' : ''}`}
              onClick={() => setPage(n.id)}
            >
              <Icon d={n.icon} />
              {!collapsed && <span>{n.label}</span>}
              {n.badge ? <b className="dw-badge">{n.badge}</b> : null}
            </button>
          ))}
          <button className="dw-nav-item" onClick={() => signOut()}>
            <span>{collapsed ? '→' : 'Log out'}</span>
          </button>
        </nav>
        {!collapsed && (
          <div className="dw-foot">
            <div className="dw-k">Accounts</div>
            <div className="dw-acct">
              <span>Checking</span>
              <b>{moneyCompact(product.checkingTotal)}</b>
            </div>
            <div className="dw-acct">
              <span>Savings</span>
              <b>{moneyCompact(product.savingsTotal)}</b>
            </div>
            <div className="dw-acct">
              <span>Net Cash</span>
              <b>{moneyCompact(product.netCash)}</b>
            </div>
          </div>
        )}
      </aside>
    )
  }

  function Home() {
    const dueNow = pay.info.windowItems || []
    const shares = pay.info.laterItems || []
    const next = pay.nextIncome
    const segs = [
      { label: 'Safe to spend', amount: Math.max(0, pay.safeToSpend), color: '#2bc458' },
      { label: 'Bills due before payday', amount: Math.max(0, Number(pay.info.billsBeforePay || 0)), color: '#eed813' },
      { label: "Later bills' share", amount: Math.max(0, Number(pay.info.laterShare || 0)), color: '#ce69be' },
      { label: 'Held aside', amount: Math.max(0, Number(pay.info.setAside || 0)), color: '#3d90de' },
    ].filter((s) => s.amount > 0.005)
    const segTotal = segs.reduce((t, s) => t + s.amount, 0) || 1
    return (
      <div className="dw-home">
        <div className="dw-hero dw-phone-only">
          <div className="dw-k" style={{ color: '#fff' }}>
            safe to spend
          </div>
          <div className="dw-hero-n">{moneyFull(pay.safeToSpend)}</div>
          <button className="dw-link" style={{ color: '#fff' }} onClick={() => setInfoOpen((v) => !v)}>
            {next ? `until payday ${shortDate(next.date)}` : 'add payday'}
          </button>
        </div>

        <section className="dw-card">
          <div className="dw-row-head">
            <div className="dw-k">This paycheck</div>
            {next && pay.daysLeft != null && (
              <span className="dw-mute" style={{ whiteSpace: 'nowrap' }}>
                {pay.daysLeft === 1 ? '1 day' : `${pay.daysLeft} days`} until payday
              </span>
            )}
          </div>
          <div className="dw-n">{moneyFull(pay.safeToSpend)}</div>
          <p className="dw-mute" style={{ margin: '4px 0 0' }}>
            Safe to spend
            {next && pay.perDay != null && <> · about {moneyFull(pay.perDay)} a day</>}
          </p>
          <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--dw-track, #1e1e22)', marginTop: 16 }}>
            {segs.map((s) => (
              <div key={s.label} title={`${s.label}: ${moneyFull(s.amount)}`} style={{ width: `${(s.amount / segTotal) * 100}%`, background: s.color, minWidth: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 12 }}>
            {segs.map((s) => (
              <span key={s.label} className="dw-mute" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span className="dw-dot" style={{ background: s.color }} />
                {s.label} <b style={{ color: 'inherit' }}>{moneyFull(s.amount)}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="dw-card">
          <div className="dw-row-head">
            <div className="dw-k">Set aside from this paycheck</div>
            <b>{moneyFull(pay.setAsideTotal)}</b>
          </div>
          {dueNow.length > 0 && (
            <>
              <p className="dw-k" style={{ margin: '0 0 4px' }}>
                Due before payday — hold the full amount
              </p>
              <div className="dw-tx-list">
                {dueNow.map((b) => (
                  <div key={b.id} className="dw-tx" style={{ cursor: 'default' }}>
                    <span className="grow">
                      <b>{b.name}</b>
                      <em>due {b.due ? shortDate(b.due) : 'soon'}</em>
                    </span>
                    <b className="dw-mono">{moneyFull(b.amount)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          {shares.length > 0 && (
            <>
              <p className="dw-k" style={{ margin: '12px 0 4px' }}>
                Due later — this paycheck's share
              </p>
              <div className="dw-tx-list">
                {shares.map((b) => (
                  <div key={b.id} className="dw-tx" style={{ cursor: 'default' }}>
                    <span className="grow">
                      <b>{b.name}</b>
                      <em>{moneyFull(b.share)} of {moneyFull(b.amount)}{b.due ? ` · due ${shortDate(b.due)}` : ''}</em>
                    </span>
                    <b className="dw-mono">{moneyFull(b.share)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          {dueNow.length === 0 && shares.length === 0 && (
            <p className="dw-mute">Nothing needs setting aside right now.</p>
          )}
          <button className="dw-link" onClick={() => setPage('bills')} style={{ marginTop: 8 }}>
            Manage bills →
          </button>
        </section>

        <aside className="dw-rail">
          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Upcoming paydays</div>
            </div>
            {pay.paydays.length === 0 ? (
              <p className="dw-mute">
                No paydays on the calendar.{' '}
                <button className="dw-link" onClick={() => setPage('profile')}>Add your income</button>
              </p>
            ) : (
              <div className="dw-tx-list">
                {pay.paydays.slice(0, 4).map((pd, i) => (
                  <div key={`${pd.date}-${pd.name}-${i}`} className="dw-tx" style={{ cursor: 'default' }}>
                    <span className="grow">
                      <b>{pd.name}</b>
                      <em>{shortDate(pd.date)}</em>
                    </span>
                    <b className="dw-mono">{moneyFull(pd.amount)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Recent transactions</div>
              <button className="dw-link dw-spread" onClick={() => setPage('activity')}>
                View All
              </button>
            </div>
            <div className="dw-tx-list">
              {product.monthTx.slice(0, 6).map((t) => (
                <button key={t.id} className="dw-tx" onClick={() => setSheet(t)}>
                  <span className="dw-mark sm">{(t.merchant || '?')[0]}</span>
                  <span className="grow">
                    <b>{t.merchant || '—'}</b>
                    <em>
                      {t.category} · {t.txn_date?.slice(5)}
                    </em>
                  </span>
                  <b className="dw-mono">{moneyFull(Math.abs(Number(t.amount || 0)))}</b>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    )
  }

  function Activity() {
    const list = product.txns.filter((t) => {
      if (filterPurpose !== 'all' && t.purpose !== filterPurpose) return false
      if (query && !String(t.merchant || '').toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    return (
      <div className="dw-activity">
        <header className="dw-page-h">
          <h1 className="dw-desk-only">Transaction Activity</h1>
          <input placeholder="Search transactions" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="dw-btn dw-phone-only" onClick={() => setPage('review')}>
            Review {queue.length}
          </button>
        </header>
        <div className="dw-chips">
          {['all', 'needs', 'wants', 'savings'].map((id) => (
            <button key={id} className={filterPurpose === id ? 'on' : ''} onClick={() => setFilterPurpose(id)}>
              {id}
            </button>
          ))}
        </div>
        <div className="dw-tx-list">
          {list.slice(0, 80).map((t) => (
            <button key={t.id} className="dw-tx" onClick={() => setSheet(t)}>
              <span className="dw-mark sm">{(t.merchant || '?')[0]}</span>
              <span className="grow">
                <b>{t.merchant || '—'}</b>
                <em>
                  {t.txn_date?.slice(5)}
                  {t.purpose && t.purpose !== 'all' && <> · <span className={`dw-chip ${t.purpose}`}>{t.purpose}</span></>}
                  {t.pending && ' · pending'}
                </em>
              </span>
              <b className="dw-mono">{moneyFull(Math.abs(Number(t.amount || 0)))}</b>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function Profile() {
    const cycle = () => {
      const order = ['system', 'dark', 'light']
      const i = order.indexOf(state.theme || 'system')
      patchState({ theme: order[(i + 1) % 3] })
    }
    return (
      <div className="dw-profile">
        <section className="dw-card">
          <div className="dw-ident">
            <div className="dw-ava">MS</div>
            <div>
              <h2>{session?.user?.email ? session.user.email.split('@')[0] : 'Matt'}</h2>
              <p className="dw-mute">Member</p>
            </div>
          </div>
        </section>
        <section className="dw-card">
          <div className="dw-k">Connected accounts</div>
          {(data.accounts || []).map((a) => (
            <div key={a.id} className="dw-acct">
              <span>
                {a.name} {a.mask || ''}
              </span>
              <b>{a.kind || a.type || ''}</b>
            </div>
          ))}
          <ConnectBankCard />
        </section>
        <section className="dw-card">
          <div className="dw-k">Settings</div>
          <label className="dw-field">
            Estimated income
            <input
              type="number"
              value={state.estAmount || ''}
              placeholder={String(Math.round(product.monthlyIncome / 2) || '')}
              onChange={(e) => patchState({ estAmount: Number(e.target.value) })}
            />
          </label>
          <label className="dw-field">
            Frequency
            <select value={state.estFreq || 'two-weeks'} onChange={(e) => patchState({ estFreq: e.target.value })}>
              <option value="week">every week</option>
              <option value="two-weeks">every two weeks</option>
              <option value="month">every month</option>
              <option value="year">every year</option>
            </select>
          </label>
          <button className="dw-field-row" onClick={cycle}>
            Theme <b>{state.theme || 'system'}</b>
          </button>
          <button className="dw-field-row" onClick={() => load()}>
            Refresh bank data {syncing ? '…' : ''}
          </button>
          <button className="dw-field-row" onClick={() => signOut()}>
            Log out
          </button>
        </section>
      </div>
    )
  }

  function Bills() {
    return (
      <div className="dw-home">
        <section className="dw-card">
          <div className="dw-row-head">
            <div className="dw-k">Bills</div>
          </div>
          <p className="dw-mute" style={{ marginTop: 0 }}>
            These feed your paycheck plan — the app sets aside enough from each check to cover them.
          </p>
          <RecurringBillsCard
            bills={data.bills || []}
            transactions={data.transactions || []}
            onChanged={load}
            embedded
          />
        </section>
        <section className="dw-card">
          <div className="dw-row-head">
            <div className="dw-k">Income</div>
          </div>
          <IncomeCard
            income={data.income || []}
            upcomingIncome={upcoming}
            transactions={data.transactions || []}
            onChanged={load}
          />
        </section>
      </div>
    )
  }

  return (
    <div className="dw-app">
      <Sidebar />
      <main className="dw-main">
        {page === 'home' && <Home />}
        {page === 'bills' && <Bills />}
        {page === 'activity' && <Activity />}
        {page === 'profile' && <Profile />}
      </main>
      <nav className="dw-tabs">
        {nav
          .filter((n) => !n.desktopOnly)
          .map((n) => (
            <button key={n.id} className={page === n.id ? 'on' : ''} onClick={() => setPage(n.id)}>
              <Icon d={n.icon} size={22} />
              {n.label}
            </button>
          ))}
      </nav>
      {sheet && <TxSheet t={sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}
