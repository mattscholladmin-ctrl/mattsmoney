// @ts-nocheck
import { useEffect, useMemo, useState } from 'react'
import { updateTransaction, addTransaction, upsertBudget } from '../lib/api'
import { signOut } from '../auth/AuthProvider'
import ConnectBankCard from './ConnectBankCard'
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
    { id: 'insights', label: 'Insights', icon: ICONS.pie, badge: insights.length },
    { id: 'activity', label: 'Activity', icon: ICONS.grid },
    { id: 'review', label: 'Review', icon: ICONS.tray, badge: queue.length, desktopOnly: true },
    { id: 'profile', label: 'Profile', icon: ICONS.person },
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
              <span className="dw-dol-n">{Math.floor(Math.abs(product.safeToSpend)).toLocaleString()}</span>
              <span className="dw-dol-c">.{String(Math.round((Math.abs(product.safeToSpend) % 1) * 100)).padStart(2, '0')}</span>
            </div>
            <div className="dw-sts-row">
              <button className="dw-link" onClick={() => setInfoOpen((v) => !v)}>
                {month === monthKeyFrom(new Date()) ? 'This month' : monthLabel(month)} ▾
              </button>
              <button className="dw-i" onClick={() => setInfoOpen((v) => !v)} aria-label="About Safe to Spend">
                i
              </button>
            </div>
            {infoOpen && (
              <div className="dw-pop">
                <select value={month} onChange={(e) => setMonth(e.target.value)}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)} {m.slice(0, 4)}
                    </option>
                  ))}
                </select>
                <p>{STS_COPY}</p>
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
    const emptyDonut = product.classifiedTotal === 0
    return (
      <div className="dw-home">
        <div className="dw-hero dw-phone-only">
          <div className="dw-k" style={{ color: '#fff' }}>
            safe to spend
          </div>
          <div className="dw-hero-n">{moneyFull(product.safeToSpend)}</div>
          <button className="dw-link" style={{ color: '#fff' }} onClick={() => setInfoOpen((v) => !v)}>
            this month
          </button>
        </div>
        <section className="dw-avgs">
          <div className="dw-k">Monthly average</div>
          <div className="dw-avg-row">
            <div className="dw-card">
              <div className="dw-k">Income</div>
              <div className="dw-n">{moneyFull(product.monthlyIncome)}</div>
              <p className="dw-mute">From your income plan</p>
            </div>
            <div className="dw-card">
              <div className="dw-k">Fixed spend</div>
              <div className="dw-n">{moneyFull(product.byPurpose.needs)}</div>
              <p className="dw-mute">Needs this month</p>
            </div>
            <div className="dw-card">
              <div className="dw-k">Savings</div>
              <div className="dw-n">{moneyFull(product.monthlyIncome - product.recentSpend)}</div>
              <p className="dw-mute">Income minus expenses</p>
            </div>
          </div>
        </section>
        <section className="dw-card dw-plan">
          <div className="dw-k">Spending plan vs actual</div>
          <div className="dw-plan-grid">
            <div className={`dw-donut ${emptyDonut ? 'empty' : ''}`}>
              {emptyDonut ? (
                <p className="dw-mute">No spending recorded for this month yet.</p>
              ) : (
                <div
                  className="dw-ring"
                  style={{
                    background: `conic-gradient(#3d90de 0 ${product.actual.needs}%, #eed813 ${product.actual.needs}% ${product.actual.needs + product.actual.wants}%, #2bc458 ${product.actual.needs + product.actual.wants}% 100%)`,
                  }}
                />
              )}
            </div>
            <div>
              {['needs', 'wants', 'savings'].map((id) => {
                const p = PURPOSES.find((x) => x.id === id)
                return (
                  <div key={id} className="dw-plan-row">
                    <span className="dw-dot" style={{ background: p.solid }} />
                    <button className="dw-link" onClick={() => { setFilterPurpose(id); setPage('activity') }}>
                      {p.label}
                    </button>
                    <input
                      className="dw-pct"
                      type="number"
                      min="0"
                      max="100"
                      value={product.plan[id]}
                      onChange={(e) => patchState({ plan: { ...product.plan, [id]: Number(e.target.value) } })}
                    />
                    <b>{product.actual[id]}%</b>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
        <section className="dw-card">
          <div className="dw-row-head">
            <div className="dw-k">Recent transactions</div>
            <span className="dw-mute">Total spent: {moneyFull(product.recentSpend)}</span>
            <button className="dw-link" onClick={() => setPage('activity')}>
              View All
            </button>
          </div>
          <div className="dw-tx-list">
            {product.monthTx.slice(0, 12).map((t) => (
              <button key={t.id} className="dw-tx" onClick={() => setSheet(t)}>
                <span className="dw-mark sm">{(t.merchant || '?')[0]}</span>
                <span className="grow">
                  <b>{t.merchant || '—'}</b>
                  <em>
                    {t.category} · {t.txn_date?.slice(5)}
                  </em>
                </span>
                <span className={`dw-chip ${t.purpose}`}>{t.pending ? 'PENDING' : t.purpose.toUpperCase()}</span>
                <b className="dw-mono">{moneyFull(Math.abs(Number(t.amount || 0)))}</b>
              </button>
            ))}
          </div>
        </section>
        <aside className="dw-rail">
          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Insights</div>
              <b className="dw-badge">{insights.length}</b>
            </div>
            {insights.slice(0, 3).map((c) => (
              <div key={c.id} className="dw-insight">
                <b>{c.name}</b>
                <p>{c.body}</p>
                <button className="dw-x sm" onClick={() => patchState({ dismissed: [...(state.dismissed || []), c.id] })}>
                  ×
                </button>
              </div>
            ))}
            <button className="dw-btn" onClick={() => setPage('insights')}>
              Review all insights
            </button>
          </section>
          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Accounts</div>
            </div>
            <div className="dw-acct">
              <span>Checking</span>
              <b>{moneyFull(product.checkingTotal)}</b>
            </div>
            {product.checking.map((a) => (
              <div key={a.id} className="dw-acct sub">
                <span>
                  {a.name} {a.mask || a.last4 || ''}
                </span>
                <b>{moneyFull(a.shown)}</b>
              </div>
            ))}
            <div className="dw-acct">
              <span>Savings</span>
              <b>{moneyFull(product.savingsTotal)}</b>
            </div>
            {product.savings.map((a) => (
              <div key={a.id} className="dw-acct sub">
                <span>{a.name}</span>
                <b>{moneyFull(a.shown)}</b>
              </div>
            ))}
            <div className="dw-acct">
              <span>Net Cash</span>
              <b>{moneyFull(product.netCash)}</b>
            </div>
          </section>
          <section className="dw-card dw-desk-only">
            <div className="dw-row-head">
              <div className="dw-k">Review</div>
              <b className="dw-badge">{queue.length}</b>
            </div>
            <button className="dw-btn" onClick={() => setPage('review')}>
              Review {queue.length} transactions
            </button>
          </section>
        </aside>
      </div>
    )
  }

  function Insights() {
    const max = Math.max(1, ...catRows.map((c) => c.amt))
    return (
      <div className="dw-insights">
        <header className="dw-page-h">
          <h1>Insights</h1>
          <div>
            <button onClick={() => setMonth(months[Math.min(months.length - 1, months.indexOf(month) + 1)])}>‹</button>
            <b>{monthLabel(month)}</b>
            <button disabled={month === months[0]} onClick={() => setMonth(months[0])}>
              ›
            </button>
          </div>
        </header>
        <div className="dw-ins-top">
          <section className="dw-card">
            {visibleCats.map((c) => (
              <div key={c.name} className="dw-cat-row">
                <span>{c.name}</span>
                <span className="dw-bar">
                  <i style={{ width: `${(c.amt / max) * 100}%`, background: c.color }} />
                </span>
                <b>{moneyCompact(c.amt)}</b>
                <em>/ {moneyCompact(c.budget)}</em>
              </div>
            ))}
            <button className="dw-link" onClick={() => setPhoneMoreCats((v) => !v)}>
              {phoneMoreCats ? 'Show less' : 'Show more'}
            </button>
          </section>
          <section className="dw-card dw-arc">
            <div className="dw-k">Spent</div>
            <div className="dw-n">{moneyCompact(product.recentSpend)}</div>
            <p className="dw-mute">No budget set</p>
          </section>
        </div>
        <section className="dw-card">
          <div className="dw-k">Insights · Live</div>
          <div className="dw-ins-grid">
            {insights.map((c) => (
              <div key={c.id} className="dw-insight">
                <b>{c.name}</b>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </section>
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
        <div className="dw-grid-tx">
          {list.slice(0, 80).map((t) => (
            <button key={t.id} className={`dw-tile ${t.purpose} ${t.pending ? 'pending' : ''}`} onClick={() => setSheet(t)}>
              <b>{moneyFull(Math.abs(Number(t.amount || 0)))}</b>
              <span>{t.merchant || '—'}</span>
              <em>{t.txn_date?.slice(5)}</em>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function Review() {
    if (showIntro) {
      return (
        <div className="dw-intro">
          <h1>Sort your transactions based on their purpose.</h1>
          <p>We'll use this to give you meaningful insights and encourage mindful spending.</p>
          <div className="dw-dirs">
            <span className="wants">WANTS · swipe left</span>
            <span className="needs">NEEDS · swipe right</span>
            <span className="savings">SAVINGS · swipe down</span>
          </div>
          <button
            className="dw-btn"
            onClick={() => {
              setShowIntro(false)
              try {
                localStorage.setItem('mm.dw.reviewIntro', '1')
              } catch {
                /* ignore */
              }
            }}
          >
            Start Sorting
          </button>
        </div>
      )
    }
    if (!front) {
      return (
        <div className="dw-card">
          <p className="dw-k">Review queue</p>
          <h1>All caught up</h1>
          <p>You've reviewed all your transactions.</p>
          <button className="dw-btn" onClick={() => setPage('activity')}>
            View activity
          </button>
        </div>
      )
    }
    return (
      <div className="dw-review">
        <header className="dw-page-h">
          <h1>Review Transactions</h1>
          <p className="dw-mute">Sort transactions into Needs, Wants, or Savings.</p>
        </header>
        <div className="dw-card-stack">
          <div className="dw-front">
            <div className="dw-mark">{(front.merchant || '?')[0]}</div>
            <h2>{front.merchant}</h2>
            <p>{front.txn_date}</p>
            <div className="dw-big">{moneyFull(Math.abs(Number(front.amount || 0)))}</div>
            <select value={front.category} onChange={(e) => setCat(front, e.target.value)}>
              {CATEGORY_CATALOG.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="dw-rev-ctrl">
          <button disabled={!reviewHist.length} onClick={undoReview}>
            Undo
          </button>
          <span>
            {Math.min(reviewIdx + 1, queue.length)} of {queue.length}
          </span>
          <button onClick={skipReview}>Skip</button>
        </div>
        <div className="dw-rev-btns">
          <button className="wants" onClick={() => goReview('wants')}>
            ← Wants
            <em>{moneyFull(reviewTotals.wants)}</em>
          </button>
          <button className="savings" onClick={() => goReview('savings')}>
            ↓ Saving
            <em>{moneyFull(reviewTotals.savings)}</em>
          </button>
          <button className="needs" onClick={() => goReview('needs')}>
            Needs →
            <em>{moneyFull(reviewTotals.needs)}</em>
          </button>
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

  return (
    <div className="dw-app">
      <Sidebar />
      <main className="dw-main">
        {page === 'home' && <Home />}
        {page === 'insights' && <Insights />}
        {page === 'activity' && <Activity />}
        {page === 'review' && <Review />}
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
