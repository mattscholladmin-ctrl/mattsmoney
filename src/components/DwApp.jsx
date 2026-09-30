// @ts-nocheck
import { useEffect, useMemo, useState } from 'react'
import { updateTransaction, addTransaction, upsertBudget } from '../lib/api'
import { signOut } from '../auth/AuthProvider'
import { computePaycheckPlan } from '../lib/paycheck-plan'
import { shortDate, isoDate } from '../lib/format'
import ConnectBankCard from './ConnectBankCard'
import RecurringBillsCard from './RecurringBillsCard'
import IncomeCard from './IncomeCard'
import { upcomingIncome } from '../lib/budget'
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
  isExpense,
  spendAmount,
} from '../lib/dw-product'

function Icon({ d, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  review: 'M4 12.5 9.5 18 20 6.5',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}

const PURPOSE_META = {
  needs: { label: 'Needs', color: '#3b82f6' },
  wants: { label: 'Wants', color: '#eab308' },
  savings: { label: 'Savings', color: '#22c55e' },
}

function applyTheme(mode) {
  const root = document.documentElement
  root.dataset.dw = '1'
  root.dataset.dwtheme = 'dark'
}

/* Monthly spending history for Insights (last 6 months, expenses only) */
function monthlyHistory(txns) {
  const out = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKeyFrom(d)
    const total = (txns || [])
      .filter((t) => {
        const td = String(t.txn_date || '')
        if (!td.startsWith(key)) return false
        if (t.hidden) return false
        const cat = String(t.category || '')
        if (cat === 'Transfers' || cat === 'Income') return false
        const amt = Number(t.amount || 0)
        return amt < 0
      })
      .reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0)
    out.push({ key, label: d.toLocaleString('en-US', { month: 'short' }), total })
  }
  return out
}

function topMerchants(txns, month, n = 5) {
  const map = {}
  for (const t of txns || []) {
    const td = String(t.txn_date || '')
    if (!td.startsWith(month)) continue
    if (t.hidden) continue
    const amt = Number(t.amount || 0)
    if (amt >= 0) continue
    const cat = String(t.category || '')
    if (cat === 'Transfers' || cat === 'Income') continue
    const name = t.merchant || 'Unknown'
    map[name] = (map[name] || 0) + Math.abs(amt)
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, total]) => ({ name, total }))
}

/* Spending within the current paycheck window */
function paycheckWindowSpend(txns, pay) {
  if (!pay || !pay.nextIncome) return 0
  const end = String(pay.nextIncome.date || '').slice(0, 10)
  const start = pay.prevIncomeDate ? String(pay.prevIncomeDate).slice(0, 10) : null
  return (txns || [])
    .filter((t) => {
      const td = String(t.txn_date || '').slice(0, 10)
      if (!td || td >= end) return false
      if (start && td < start) return false
      if (t.hidden) return false
      const amt = Number(t.amount || 0)
      if (amt >= 0) return false
      const cat = String(t.category || '')
      if (cat === 'Transfers' || cat === 'Income') return false
      return true
    })
    .reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0)
}

export default function DwApp({ data, setData, load, session, demo, syncing }) {
  const [state, setState] = useState(() => {
    const saved = loadDwState()
    return {
      plan: PLAN_DEFAULT,
      theme: 'dark',
      estFreq: 'two-weeks',
      meta: {},
      budgets: {},
      dismissed: [],
      ...saved,
      theme: 'dark',
    }
  })
  const [page, setPage] = useState(() => {
    try {
      return localStorage.getItem('mm.dw.page') || 'home'
    } catch {
      return 'home'
    }
  })
  const [month, setMonth] = useState(() => monthKeyFrom(new Date()))
  const [infoOpen, setInfoOpen] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [filterPurpose, setFilterPurpose] = useState('all')
  const [query, setQuery] = useState('')
  const [reviewIdx, setReviewIdx] = useState(0)
  const [reviewHist, setReviewHist] = useState([])
  const [reviewTotals, setReviewTotals] = useState({ needs: 0, wants: 0, savings: 0 })

  useEffect(() => {
    saveDwState(state)
    applyTheme()
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
  const history = useMemo(() => monthlyHistory(product.txns), [product.txns])
  const merchants = useMemo(() => topMerchants(product.txns, month), [product.txns, month])
  const windowSpend = useMemo(() => paycheckWindowSpend(product.txns, pay), [product.txns, pay])

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
    { id: 'insights', label: 'Insights', icon: ICONS.chart },
    { id: 'activity', label: 'Activity', icon: ICONS.grid },
    { id: 'review', label: 'Review', icon: ICONS.review, badge: queue.length || null },
    { id: 'bills', label: 'Bills', icon: ICONS.receipt },
    { id: 'profile', label: 'Profile', icon: ICONS.person },
  ]

  function TxSheet({ t, onClose }) {
    if (!t) return null
    return (
      <div className="dw-sheet-dim" onClick={onClose}>
        <aside className="dw-sheet" onClick={(e) => e.stopPropagation()}>
          <button className="dw-x" onClick={onClose}>×</button>
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
                <option key={p.id} value={p.id}>{p.label}</option>
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
            Visibility: {t.hidden ? 'Hidden from Insights' : 'Shown'}
          </p>
          <button className="dw-text" onClick={() => setMeta(t.id, { hidden: !t.hidden })}>
            {t.hidden ? 'Show in budgets' : 'Hide from budgets'}
          </button>
        </aside>
      </div>
    )
  }

  function Sidebar() {
    const sts = Math.max(0, pay.safeToSpend)
    return (
      <aside className="dw-side">
        <div className="dw-brand">
          <div className="dw-word">matt's <em>money</em></div>
        </div>
        <div className="dw-sts">
          <div className="dw-k">Safe to spend</div>
          <div className="dw-sts-amt">
            <span className="dw-dol">$</span>
            <span className="dw-dol-n">{Math.floor(sts).toLocaleString()}</span>
            <span className="dw-dol-c">.{String(Math.round((sts % 1) * 100)).padStart(2, '0')}</span>
          </div>
          <div className="dw-sts-row">
            <button className="dw-sts-until" onClick={() => setInfoOpen((v) => !v)}>
              {pay.nextIncome ? `Until ${shortDate(pay.nextIncome.date)}` : 'Add payday'} ▾
            </button>
            <button className="dw-i" onClick={() => setInfoOpen((v) => !v)} aria-label="About Safe to Spend">i</button>
          </div>
          {infoOpen && (
            <div className="dw-pop">
              <p>Safe to spend is your checking balance minus bills due before your next payday, minus this paycheck's share of later bills, minus anything held aside. It's what's OK to spend until payday.</p>
            </div>
          )}
        </div>
        <nav className="dw-nav">
          {nav.map((n) => (
            <button
              key={n.id}
              className={`dw-nav-item ${page === n.id ? 'on' : ''}`}
              onClick={() => setPage(n.id)}
            >
              <Icon d={n.icon} />
              <span>{n.label}</span>
              {n.badge ? <b className="dw-badge">{n.badge}</b> : null}
            </button>
          ))}
          <button className="dw-nav-item" onClick={() => signOut()}>
            <Icon d={ICONS.logout} />
            <span>Log out</span>
          </button>
        </nav>
        <div className="dw-foot">
          <div className="dw-k">Accounts</div>
          <div className="dw-acct"><span>Checking</span><b>{moneyCompact(product.checkingTotal)}</b></div>
          <div className="dw-acct"><span>Savings</span><b>{moneyCompact(product.savingsTotal)}</b></div>
          <div className="dw-acct"><span>Net Cash</span><b>{moneyCompact(product.netCash)}</b></div>
        </div>
      </aside>
    )
  }

  /* ================= HOME (paycheck-first overview) ================= */
  function Home() {
    const dueNow = pay.info.windowItems || []
    const shares = pay.info.laterItems || []
    const next = pay.nextIncome
    const segs = [
      { label: 'Safe to spend', amount: Math.max(0, pay.safeToSpend), color: '#22c55e' },
      { label: 'Bills due before payday', amount: Math.max(0, Number(pay.info.billsBeforePay || 0)), color: '#eab308' },
      { label: "Later bills' share", amount: Math.max(0, Number(pay.info.laterShare || 0)), color: '#a78bfa' },
      { label: 'Held aside', amount: Math.max(0, Number(pay.info.setAside || 0)), color: '#3b82f6' },
    ].filter((s) => s.amount > 0.005)
    const segTotal = segs.reduce((t, s) => t + s.amount, 0) || 1
    const paycheckTotal = segTotal + windowSpend

    const purposeRows = ['needs', 'wants', 'savings'].map((p) => ({
      id: p,
      ...PURPOSE_META[p],
      total: product.byPurpose?.[p] || 0,
    }))
    const maxPurpose = Math.max(...purposeRows.map((r) => r.total), 1)

    const firstName = session?.user?.email ? session.user.email.split('@')[0] : 'there'

    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Welcome back, {firstName}</h1>
            <p className="dw-sub">Here's what's happening with your money.</p>
          </div>
        </header>

        <div className="dw-2col">
          <div className="dw-col-stack">
            <section className="dw-card">
              <div className="dw-row-head">
                <div className="dw-k">This paycheck's spending plan</div>
                {next && pay.daysLeft != null && (
                  <span className="dw-mute" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    {pay.daysLeft === 1 ? '1 day' : `${pay.daysLeft} days`} left
                  </span>
                )}
              </div>
              <div className="dw-plan-nums">
                <span className="dw-big-n">{moneyFull(pay.safeToSpend)}</span>
                <span className="dw-vs">safe of {moneyFull(paycheckTotal)} this check</span>
              </div>
              <div className="dw-stackbar">
                {segs.map((s) => (
                  <div key={s.label} title={`${s.label}: ${moneyFull(s.amount)}`}
                    style={{ width: `${(s.amount / segTotal) * 100}%`, background: s.color }} />
                ))}
              </div>
              <div className="dw-legend">
                {segs.map((s) => (
                  <div key={s.label} className="dw-legend-row">
                    <span className="dw-dot" style={{ background: s.color }} />
                    {s.label}
                    <b>{moneyFull(s.amount)}</b>
                  </div>
                ))}
              </div>
              {pay.perDay != null && next && (
                <p className="dw-mute" style={{ margin: '14px 0 0' }}>
                  About {moneyFull(pay.perDay)} a day until {shortDate(next.date)} · spent {moneyFull(windowSpend)} so far
                </p>
              )}
            </section>

            <section className="dw-card">
              <div className="dw-row-head">
                <div className="dw-k">Spending this month</div>
                <button className="dw-link dw-spread" onClick={() => setPage('insights')}>Insights →</button>
              </div>
              <div style={{ marginTop: 12 }}>
                {purposeRows.map((r) => (
                  <div key={r.id} className="dw-catbar">
                    <div className="dw-catbar-top">
                      <span className="dw-catname">
                        <span className="dw-dot" style={{ background: r.color }} />
                        {r.label}
                      </span>
                      <span className="dw-catvals"><b>{moneyFull(r.total)}</b></span>
                    </div>
                    <div className="dw-track"><div style={{ width: `${(r.total / maxPurpose) * 100}%`, background: r.color }} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="dw-card">
              <div className="dw-row-head">
                <div className="dw-k">Set aside from this paycheck</div>
                <b className="dw-mono" style={{ marginLeft: 'auto', fontSize: 14 }}>{moneyFull(pay.setAsideTotal)}</b>
              </div>
              {dueNow.length > 0 && (
                <>
                  <p className="dw-k" style={{ margin: '12px 0 2px' }}>Due before payday — hold the full amount</p>
                  <div className="dw-tx-list">
                    {dueNow.map((b) => (
                      <div key={b.id} className="dw-tx" style={{ cursor: 'default' }}>
                        <span className="grow"><b>{b.name}</b><em>due {b.due ? shortDate(b.due) : 'soon'}</em></span>
                        <span className="dw-amt">{moneyFull(b.amount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {shares.length > 0 && (
                <>
                  <p className="dw-k" style={{ margin: '14px 0 2px' }}>Due later — this paycheck's share</p>
                  <div className="dw-tx-list">
                    {shares.map((b) => (
                      <div key={b.id} className="dw-tx" style={{ cursor: 'default' }}>
                        <span className="grow">
                          <b>{b.name}</b>
                          <em>{moneyFull(b.share)} of {moneyFull(b.amount)}{b.due ? ` · due ${shortDate(b.due)}` : ''}</em>
                        </span>
                        <span className="dw-amt">{moneyFull(b.share)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {dueNow.length === 0 && shares.length === 0 && (
                <p className="dw-mute" style={{ marginTop: 8 }}>Nothing needs setting aside right now.</p>
              )}
              <div style={{ marginTop: 12 }}>
                <button className="dw-link" onClick={() => setPage('bills')}>Manage bills →</button>
              </div>
            </section>
          </div>

          <div className="dw-col-stack">
            <section className="dw-card">
              <div className="dw-row-head">
                <div className="dw-k">Upcoming bills</div>
                <button className="dw-link dw-spread" onClick={() => setPage('bills')}>View all →</button>
              </div>
              {dueNow.length === 0 ? (
                <p className="dw-mute" style={{ marginTop: 8 }}>No bills due before payday.</p>
              ) : (
                <div className="dw-tx-list" style={{ marginTop: 6 }}>
                  {dueNow.slice(0, 5).map((b) => (
                    <div key={b.id} className="dw-tx" style={{ cursor: 'default' }}>
                      <span className="grow"><b>{b.name}</b><em>Due {b.due ? shortDate(b.due) : 'soon'}</em></span>
                      <span className="dw-amt">{moneyFull(b.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="dw-card">
              <div className="dw-row-head">
                <div className="dw-k">Recent transactions</div>
                <button className="dw-link dw-spread" onClick={() => setPage('activity')}>View all →</button>
              </div>
              <div className="dw-tx-list" style={{ marginTop: 6 }}>
                {product.monthTx.slice(0, 5).map((t) => {
                  const amt = Number(t.amount || 0)
                  const isPos = amt > 0
                  return (
                    <button key={t.id} className="dw-tx" onClick={() => setSheet(t)}>
                      <span className="dw-mark">{(t.merchant || '?')[0]}</span>
                      <span className="grow">
                        <b>{t.merchant || '—'}</b>
                        <em>{t.txn_date?.slice(5)}</em>
                      </span>
                      <span className={`dw-amt${isPos ? ' pos' : ''}`}>
                        {isPos ? '+' : '-'}{moneyFull(Math.abs(amt)).replace('$', '$')}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="dw-card">
              <div className="dw-k" style={{ marginBottom: 6 }}>Upcoming paydays</div>
              {pay.paydays.length === 0 ? (
                <p className="dw-mute">
                  No paydays on the calendar.{' '}
                  <button className="dw-link" onClick={() => setPage('bills')}>Add your income</button>
                </p>
              ) : (
                <div className="dw-tx-list">
                  {pay.paydays.slice(0, 3).map((pd, i) => (
                    <div key={`${pd.date}-${pd.name}-${i}`} className="dw-tx" style={{ cursor: 'default' }}>
                      <span className="grow"><b>{pd.name}</b><em>{shortDate(pd.date)}</em></span>
                      <span className="dw-amt">{moneyFull(pd.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="dw-card">
              <div className="dw-k" style={{ marginBottom: 6 }}>Money movement</div>
              <div className="dw-tx-list">
                <div className="dw-tx" style={{ cursor: 'default' }}>
                  <span className="grow"><b>Checking</b><em>available cash</em></span>
                  <span className="dw-amt">{moneyFull(product.checkingTotal || 0)}</span>
                </div>
                <div className="dw-tx" style={{ cursor: 'default' }}>
                  <span className="grow"><b>Savings</b><em>reserved</em></span>
                  <span className="dw-amt">{moneyFull(product.savingsTotal || 0)}</span>
                </div>
                <div className="dw-tx" style={{ cursor: 'default' }}>
                  <span className="grow"><b>Net cash</b><em>across accounts</em></span>
                  <span className="dw-amt">{moneyFull(product.netCash || 0)}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    )
  }

  /* ================= INSIGHTS (monthly patterns) ================= */
  function Insights() {
    const maxMonth = Math.max(...history.map((h) => h.total), 1)
    const avg = history.reduce((s, h) => s + h.total, 0) / (history.length || 1)
    const top = history.reduce((a, b) => (b.total > a.total ? b : a), history[0] || { total: 0, label: '—' })
    const catRows = Object.entries(product.catSpend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, amt]) => ({
        name,
        amt,
        color: CATEGORY_CATALOG.find((c) => c.name === name)?.color || '#a78bfa',
      }))
    const maxCat = Math.max(...catRows.map((c) => c.amt), 1)
    const maxMerch = Math.max(...merchants.map((m) => m.total), 1)

    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Insights</h1>
            <p className="dw-sub">Your money patterns at a glance.</p>
          </div>
          <button className="dw-link" onClick={() => setPage('activity')}>Compare months</button>
        </header>

        {insights.length > 0 && (
          <div className="dw-col-stack">
            {insights.slice(0, 2).map((c) => (
              <section key={c.id} className="dw-card" style={{ borderLeft: '3px solid #eab308' }}>
                <div className="dw-h2">{c.title}</div>
                <p className="dw-mute" style={{ margin: '6px 0 0' }}>{c.body}</p>
              </section>
            ))}
          </div>
        )}

        <div className="dw-ins-grid">
          <section className="dw-card dw-span2">
            <div className="dw-k">Spending by month</div>
            <div className="dw-monthchart">
              {history.map((h, i) => (
                <div key={h.key} className="dw-monthbar-wrap">
                  <div
                    className={`dw-monthbar${i === history.length - 1 ? ' sel' : ''}`}
                    style={{ height: `${Math.max(3, (h.total / maxMonth) * 100)}%` }}
                  >
                    <span className="dw-tip">{moneyFull(h.total)}</span>
                  </div>
                  <span className="dw-monthlbl">{h.label}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="dw-stat-row"><span>Average monthly spend</span><b>{moneyFull(avg)}</b></div>
              <div className="dw-stat-row"><span>Highest spending month</span><b>{top.label} · {moneyFull(top.total)}</b></div>
            </div>
          </section>

          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>Top categories</div>
            {catRows.map((c) => (
              <div key={c.name} className="dw-catbar">
                <div className="dw-catbar-top">
                  <span className="dw-catname">
                    <span className="dw-catico" style={{ background: `${c.color}22`, color: c.color }}>
                      {(c.name || '?')[0]}
                    </span>
                    {c.name}
                  </span>
                  <span className="dw-catvals"><b>{moneyFull(c.amt)}</b></span>
                </div>
                <div className="dw-track"><div style={{ width: `${(c.amt / maxCat) * 100}%`, background: c.color }} /></div>
              </div>
            ))}
          </section>

          <section className="dw-card dw-span2">
            <div className="dw-k" style={{ marginBottom: 8 }}>Top merchants · {monthLabel(month)}</div>
            {merchants.length === 0 ? (
              <p className="dw-mute">No merchant data this month.</p>
            ) : (
              merchants.map((m) => (
                <div key={m.name} className="dw-catbar">
                  <div className="dw-catbar-top">
                    <span className="dw-catname">
                      <span className="dw-mark" style={{ width: 26, height: 26, fontSize: 12 }}>{m.name[0]}</span>
                      {m.name}
                    </span>
                    <span className="dw-catvals"><b>{moneyFull(m.total)}</b></span>
                  </div>
                  <div className="dw-track"><div style={{ width: `${(m.total / maxMerch) * 100}%`, background: '#3b82f6' }} /></div>
                </div>
              ))
            )}
          </section>

          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>Month so far</div>
            <div className="dw-stat-row"><span>Spent in {monthLabel(month)}</span><b>{moneyFull(product.classifiedTotal || 0)}</b></div>
            {['needs', 'wants', 'savings'].map((p) => (
              <div key={p} className="dw-stat-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dw-dot" style={{ background: PURPOSE_META[p].color }} />
                  {PURPOSE_META[p].label}
                </span>
                <b>{moneyFull(product.byPurpose?.[p] || 0)}</b>
              </div>
            ))}
          </section>
        </div>
      </div>
    )
  }

  /* ================= ACTIVITY ================= */
  function weekKey(d) {
    const dt = new Date(d + 'T12:00:00')
    const day = (dt.getDay() + 6) % 7
    dt.setDate(dt.getDate() - day)
    return dt.toISOString().slice(0, 10)
  }
  function weekLabel(key) {
    const start = new Date(key + 'T12:00:00')
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const fmt = (d) => d.toLocaleString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
    return `${fmt(start)} – ${fmt(end)}`
  }

  function Activity() {
    const list = product.txns.filter((t) => {
      if (filterPurpose !== 'all' && t.purpose !== filterPurpose) return false
      if (query && !String(t.merchant || '').toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    const groups = {}
    for (const t of list.slice(0, 120)) {
      const k = weekKey(String(t.txn_date || '').slice(0, 10))
      if (!groups[k]) groups[k] = []
      groups[k].push(t)
    }
    const sortedWeeks = Object.keys(groups).sort().reverse()

    function Tile({ t }) {
      const amt = Number(t.amount || 0)
      const isPos = amt > 0
      const pm = PURPOSE_META[t.purpose]
      return (
        <button className="dw-tile" onClick={() => setSheet(t)}>
          <div className="dw-tile-top">
            <span className="dw-mark" style={{ width: 30, height: 30, fontSize: 13 }}>{(t.merchant || '?')[0]}</span>
            <span className={`dw-tile-amt${isPos ? ' pos' : ''}`}>{isPos ? '+' : '−'}{moneyFull(Math.abs(amt))}</span>
          </div>
          <div className="dw-tile-name">{t.merchant || '—'}</div>
          <div className="dw-tile-meta">
            {String(t.txn_date || '').slice(5)}
            {pm && t.purpose !== 'unreviewed' && <span className={`dw-chip ${t.purpose}`}>{pm.label}</span>}
            {t.purpose === 'unreviewed' && <span className="dw-chip unreviewed">Review</span>}
            {t.pending && ' · pending'}
          </div>
        </button>
      )
    }

    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Transaction Activity</h1>
            <p className="dw-sub">{list.length} transactions</p>
          </div>
          {queue.length > 0 && (
            <button className="dw-ctl-btn" onClick={() => { setReviewIdx(0); setPage('review') }}>
              Review {queue.length} →
            </button>
          )}
        </header>
        <div className="dw-toolbar">
          <input className="dw-search" placeholder="Search transactions" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="dw-chips">
            {['all', 'needs', 'wants', 'savings'].map((id) => (
              <button key={id} className={filterPurpose === id ? 'on' : ''} onClick={() => setFilterPurpose(id)}>
                {id !== 'all' && <span className="dw-dot" style={{ background: PURPOSE_META[id].color }} />}
                {id === 'all' ? 'All' : PURPOSE_META[id].label}
              </button>
            ))}
          </div>
        </div>
        {sortedWeeks.map((wk, wi) => {
          const items = groups[wk]
          const total = items.reduce((s, t) => s + (Number(t.amount || 0) < 0 ? Math.abs(Number(t.amount)) : 0), 0)
          return (
            <div key={wk}>
              <div className="dw-week-h">
                <span className="dw-k">{wi === 0 ? 'This week' : weekLabel(wk)}</span>
                <span className="dw-total">Spent {moneyFull(total)}</span>
              </div>
              <div className="dw-txgrid">
                {items.map((t) => <Tile key={t.id} t={t} />)}
              </div>
            </div>
          )
        })}
        {sortedWeeks.length === 0 && <p className="dw-mute">No transactions match.</p>}
      </div>
    )
  }

  /* ================= REVIEW (categorize flow) ================= */
  function Review() {
    if (!front) {
      return (
        <div className="dw-page">
          <header className="dw-page-h">
            <div>
              <h1>Review Transactions</h1>
              <p className="dw-sub">Sort your spending into buckets.</p>
            </div>
          </header>
          <div className="dw-review-wrap">
            <div className="dw-review-done">
              <div className="dw-big-check">✓</div>
              <div className="dw-h2">All caught up</div>
              <p className="dw-mute">Every transaction is sorted. Nice work.</p>
              {(reviewTotals.needs + reviewTotals.wants + reviewTotals.savings) > 0 && (
                <div style={{ marginTop: 16, display: 'flex', gap: 16, justifyContent: 'center' }}>
                  {['needs', 'wants', 'savings'].map((p) => (
                    <span key={p} className="dw-mute">
                      <span className="dw-dot" style={{ background: PURPOSE_META[p].color, marginRight: 6 }} />
                      {moneyFull(reviewTotals[p])}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }
    const amt = Math.abs(Number(front.amount || 0))
    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Review Transactions</h1>
            <p className="dw-sub">Tap a bucket to sort each transaction.</p>
          </div>
        </header>
        <div className="dw-review-wrap">
          <div className="dw-review-stack">
            <div className="dw-review-behind b2" />
            <div className="dw-review-behind" />
            <div className="dw-review-card">
              <div className="dw-mark">{(front.merchant || '?')[0]}</div>
              <div className="dw-review-merchant">{front.merchant || 'Unknown'}</div>
              <div className="dw-review-amt">{moneyFull(amt)}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                <span className="dw-chip">{front.category}</span>
                <span className="dw-review-date">{front.txn_date}</span>
              </div>
            </div>
          </div>
          <div className="dw-bucket-btns">
            <button className="bw-wants" onClick={() => goReview('wants')}>Wants<small>{moneyFull(reviewTotals.wants)}</small></button>
            <button className="bw-savings" onClick={() => goReview('savings')}>Saving<small>{moneyFull(reviewTotals.savings)}</small></button>
            <button className="bw-needs" onClick={() => goReview('needs')}>Needs<small>{moneyFull(reviewTotals.needs)}</small></button>
          </div>
          <div className="dw-review-ctrl">
            <button className="dw-ctl-btn" onClick={undoReview} disabled={reviewHist.length === 0}>↩ Undo</button>
            <span className="dw-progress">{reviewIdx + 1} of {queue.length}</span>
            <button className="dw-ctl-btn" onClick={skipReview}>Skip →</button>
          </div>
        </div>
      </div>
    )
  }

  /* ================= BILLS ================= */
  function Bills() {
    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Bills</h1>
            <p className="dw-sub">These feed your paycheck plan — the app sets aside enough from each check to cover them.</p>
          </div>
        </header>
        <div className="dw-2col">
          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>Recurring bills</div>
            <RecurringBillsCard
              bills={data.bills || []}
              transactions={data.transactions || []}
              onChanged={load}
              embedded
            />
          </section>
          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>Income</div>
            <IncomeCard
              income={data.income || []}
              upcomingIncome={upcoming}
              transactions={data.transactions || []}
              onChanged={load}
            />
          </section>
        </div>
      </div>
    )
  }

  /* ================= PROFILE ================= */
  function Profile() {
    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Profile</h1>
            <p className="dw-sub">Manage your account details and preferences.</p>
          </div>
        </header>
        <div className="dw-profile-grid">
          <div className="dw-col-stack">
            <section className="dw-card">
              <div className="dw-ident">
                <div className="dw-ava">{(session?.user?.email?.[0] || 'M').toUpperCase()}</div>
                <div>
                  <div className="dw-h2">{session?.user?.email ? session.user.email.split('@')[0] : 'Matt'}</div>
                  <p className="dw-mute" style={{ margin: '2px 0 0' }}>{session?.user?.email || ''}</p>
                </div>
              </div>
            </section>
            <section className="dw-card">
              <div className="dw-k" style={{ marginBottom: 4 }}>Connected accounts</div>
              {(data.accounts || []).map((a) => (
                <div key={a.id} className="dw-acct" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <span>{a.name} {a.mask || ''}</span>
                  <b>{moneyCompact(a.balance || 0)}</b>
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                <ConnectBankCard />
              </div>
            </section>
          </div>
          <div className="dw-col-stack">
            <section className="dw-card">
              <div className="dw-k" style={{ marginBottom: 4 }}>Paycheck settings</div>
              <label className="dw-field">
                Estimated paycheck amount
                <input
                  type="number"
                  value={state.estAmount || ''}
                  placeholder={String(Math.round(product.monthlyIncome / 2) || '')}
                  onChange={(e) => patchState({ estAmount: Number(e.target.value) })}
                />
              </label>
              <label className="dw-field">
                Pay frequency
                <select value={state.estFreq || 'two-weeks'} onChange={(e) => patchState({ estFreq: e.target.value })}>
                  <option value="week">Every week</option>
                  <option value="two-weeks">Every two weeks</option>
                  <option value="month">Every month</option>
                  <option value="year">Every year</option>
                </select>
              </label>
            </section>
            <section className="dw-card">
              <div className="dw-k" style={{ marginBottom: 4 }}>Preferences</div>
              <button className="dw-field-row" onClick={() => load()}>
                <span>Refresh bank data {syncing ? '…' : ''}</span><b>↻</b>
              </button>
              <button className="dw-field-row" onClick={() => signOut()}>
                <span>Log out</span><b>→</b>
              </button>
            </section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dw-app">
      <Sidebar />
      <main className="dw-main">
        {page === 'home' && <Home />}
        {page === 'insights' && <Insights />}
        {page === 'activity' && <Activity />}
        {page === 'review' && <Review />}
        {page === 'bills' && <Bills />}
        {page === 'profile' && <Profile />}
      </main>
      <nav className="dw-tabs">
        {nav.map((n) => (
          <button key={n.id} className={page === n.id ? 'on' : ''} onClick={() => setPage(n.id)}>
            <Icon d={n.icon} size={22} />
            {n.label}
            {n.badge ? <b className="dw-badge" style={{ position: 'absolute', marginTop: -18, marginLeft: 18 }}>{n.badge}</b> : null}
          </button>
        ))}
      </nav>
      {sheet && <TxSheet t={sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}
