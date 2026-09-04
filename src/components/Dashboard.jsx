// @ts-nocheck
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchAll,
  saveSettings,
  moveToSmoothing,
  addTransaction,
  adjustAccountBalance,
  setGoalReserved,
} from '../lib/api'
import { signOut } from '../auth/AuthProvider'
import {
  currentBalance,
  spendThisMonth,
  spendByCategory,
  upcomingBills,
  unpaidBills,
  upcomingIncome,
  mergeTimeline,
  datedGoalEvents,
  variableSpendEvents,
  runwayDays,
  projectBalance,
  phaseStatus,
  spendableToday,
  accountSummaries,
  moneyTotals,
  debtsAsBills,
  monthlyDebtPayment,
  totalEarmarked,
  totalSetAside,
  goalPaceReserve,
  goalPace,
  goalSpent,
  everydayHoldback,
  smoothedReserve,
  dedupeTransactions,
  payPeriodsPerYear,
  payoffPlan,
  countsAsSpendable,
  setCategoryAliases,
  categoriesInUse,
  mostRecentPaydayIso,
  incomeShortfalls,
  paycheckSplit,
  gapClosers,
} from '../lib/budget'
import { money, isoDate, monthKey } from '../lib/format'
import AccountsCard from './AccountsCard'
import SpendableCard from './SpendableCard'
import PaycheckAssignment from './PaycheckAssignment'
import SetAsideCard from './SetAsideCard'
import ProjectionAlert from './ProjectionAlert'
import CashFlowCalendar from './CashFlowCalendar'
import { TileColumns } from './TileFrame'
import { useTileLayout } from '../lib/tileLayout'
import { downloadBackup } from '../lib/export'
import PhaseCard from './PhaseCard'
import IncomeCard from './IncomeCard'
import UpcomingBillsCard from './UpcomingBillsCard'
import GoalsCard from './GoalsCard'
import DebtsCard from './DebtsCard'
import TransactionsCard from './TransactionsCard'
import QuickAddFab from './QuickAddFab'
import SetupGuide from './SetupGuide'
import NotificationsCard from './NotificationsCard'
import GoogleCalendarCard from './GoogleCalendarCard'
import ThemeCard from './ThemeCard'
import GrokConnectCard from './GrokConnectCard'
import { refreshPlaid } from '../lib/plaidClient'
import { demoData } from '../lib/demoData'

// Only needed once you actually visit that page/section — loading them on
// demand instead of upfront keeps the initial bundle (and first paint) small.
// None of these change what's shown, just when their code arrives.
const TransactionsView = lazy(() => import('./TransactionsView'))
const CreditView = lazy(() => import('./CreditView'))
const CheckInView = lazy(() => import('./CheckInView'))
const InsightsView = lazy(() => import('./InsightsView'))
const GuideCard = lazy(() => import('./GuideCard'))
const AccountOrderCard = lazy(() => import('./AccountOrderCard'))
const ConnectBankCard = lazy(() => import('./ConnectBankCard'))

// Bottom-tab icons. The phone nav used to be a horizontally-scrolling strip of
// text pills, which hid 4 of the 6 pages off-screen with no hint they existed —
// including Check-in, the app's core habit. A fixed bottom bar shows all six at
// once, the standard phone pattern.
const NAV_ICONS = {
  dashboard: <path d="M3 12l9-9 9 9M5 10v10h14V10" />,
  transactions: <path d="M4 7h16M4 12h16M4 17h10" />,
  checkin: <path d="M9 11l3 3 8-8M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />,
  credit: <path d="M2 7h20v12H2zM2 11h20" />,
  insights: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 004.6 19l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H.5a2 2 0 110-4h.1A1.7 1.7 0 001.8 4.6l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V.5a2 2 0 114 0v.1A1.7 1.7 0 0019.4 4.6l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9h.1a2 2 0 110 4h-.1a1.7 1.7 0 00-1.2 1.2z" />,
}

function BottomNav({ view, setView, shortfall }) {
  return (
    <nav
      className={`lg:hidden fixed bottom-0 inset-x-0 z-20 text-white border-t border-white/10 flex ${
        shortfall ? 'bg-red-900' : 'bg-emerald-800'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {PAGES.map((p) => {
        const active = view === p.id
        return (
          <button
            key={p.id}
            onClick={() => setView(p.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 min-w-0 min-h-11 flex flex-col items-center justify-center gap-1 py-2.5 px-0.5 transition ${
              active ? 'text-white' : 'text-white/60'
            }`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={active ? 2.4 : 1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {NAV_ICONS[p.id]}
            </svg>
            <span className={`text-[0.7rem] leading-none truncate max-w-full ${active ? 'font-bold' : 'font-medium'}`}>
              {p.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// Brief placeholder shown the moment you switch to a page whose code hasn't
// loaded yet — normally invisible (arrives in well under a second) except on
// a slow connection.
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-slate-400 text-sm">Loading…</p>
    </div>
  )
}
function TileFallback() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <p className="text-slate-400 text-sm">Loading…</p>
    </div>
  )
}

const DEFAULT_BUFFER = 200

function SlidersIcon({ arranging }) {
  return arranging ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  )
}

// "Spent this month" with a small cumulative spending line: solid = what's
// happened so far, dotted = where this pace lands by month-end.
function SpentThisMonthTile({ transactions = [], total = 0 }) {
  const mk = monthKey()
  const now = new Date()
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayNow = now.getDate()

  const perDay = useMemo(() => {
    const days = new Array(dim + 1).fill(0)
    for (const t of transactions) {
      if (!(t.txn_date || '').startsWith(mk)) continue
      const amt = Number(t.amount || 0)
      if (amt <= 0) continue
      days[Number(t.txn_date.slice(8, 10))] += amt
    }
    return days
  }, [transactions, mk, dim])
  const cum = []
  let run = 0
  for (let d = 1; d <= dayNow; d++) {
    run += perDay[d]
    cum.push(run)
  }
  const pace = dayNow > 0 ? (run / dayNow) * dim : 0
  const max = Math.max(pace, run, 1)
  const x = (d) => 2 + ((d - 1) / Math.max(dim - 1, 1)) * 96
  const y = (v) => 30 - (v / max) * 27
  const solid = cum
    .map((v, i) => `${i ? 'L' : 'M'} ${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), dim)

  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <div className="flex justify-between items-center">
        <span className="text-slate-600 text-sm">Spent this month</span>
        <span className="text-xl font-bold text-slate-800">{money(total)}</span>
      </div>
      {cum.length > 1 && (
        <>
          <svg
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            className="w-full h-12 mt-2 text-emerald-700"
            aria-hidden="true"
          >
            <path d={solid} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {dayNow < dim && (
              <path
                d={`M ${x(dayNow).toFixed(1)} ${y(run).toFixed(1)} L ${x(dim).toFixed(1)} ${y(pace).toFixed(1)}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.35"
                strokeWidth="1.5"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle cx={x(dayNow)} cy={y(run)} r="2" fill="currentColor" />
          </svg>
          <div className="flex justify-between text-[0.75rem] text-slate-400 mt-1">
            <span>{shortDateLabel(new Date(now.getFullYear(), now.getMonth(), 1))}</span>
            <span>
              ≈ {money(pace)} by {shortDateLabel(monthEnd)} at this pace
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function shortDateLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// One number in the glance strip at the top of the dashboard.
function Stat({ label, value, tone = 'ink' }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.7rem] uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p
        className={`text-lg font-bold truncate ${
          tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', title: 'Budget' },
  { id: 'transactions', label: 'Transactions', title: 'Transactions' },
  { id: 'checkin', label: 'Check-in', title: 'Check-in' },
  { id: 'credit', label: 'Credit', title: 'Credit recovery' },
  { id: 'insights', label: 'Insights', title: 'Spending insights' },
  { id: 'settings', label: 'Settings', title: 'Settings' },
]

// The reorderable dashboard tiles, their display names, and the default layout.
const TILE_NAMES = {
  accounts: 'Accounts',
  income: 'Income',
  goals: 'Goals',
  setaside: 'Held for known expenses',
  monthspend: 'Spent this month',
  bills: 'Upcoming bills',
  debts: 'Debt',
  transactions: 'Recent spending',
  cashflow: 'Cash-flow calendar',
}
const DASH_TILE_IDS = Object.keys(TILE_NAMES)
const DEFAULT_DASH_LAYOUT = {
  left: ['accounts', 'income', 'goals', 'setaside'],
  right: ['monthspend', 'bills', 'debts', 'transactions', 'cashflow'],
}

// Settings-page tiles. The guide defaults to the very bottom.
const SETTINGS_TILE_NAMES = {
  bank: 'Bank & card connections',
  grok: 'Grok',
  calendar: 'Google Calendar',
  theme: 'Theme',
  dashprefs: 'Dashboard',
  buffer: 'Buffer floor',
  notifications: 'Notifications',
  yourdata: 'Your data',
  account: 'Account',
  acctorder: 'Account order',
  guide: 'How this app works',
}
const SETTINGS_TILE_IDS = Object.keys(SETTINGS_TILE_NAMES)
const DEFAULT_SETTINGS_LAYOUT = {
  left: ['bank', 'grok', 'calendar'],
  right: ['theme', 'dashprefs', 'buffer', 'notifications', 'yourdata', 'account', 'guide'],
}

// Show the last-synced snapshot immediately, instead of a blank "Loading…"
// screen on every single open — load() below still fetches fresh data in the
// background and swaps it in the moment it arrives (see `syncing`).
function loadCachedData() {
  try {
    return JSON.parse(localStorage.getItem('budget.cache') || 'null')
  } catch {
    return null
  }
}

export default function Dashboard({ session, demo = false }) {
  const [data, setData] = useState(() => {
    if (!demo) return loadCachedData()
    const d = demoData()
    const cleaned = dedupeTransactions(d.transactions)
    return { ...d, transactions: cleaned }
  })
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  // How many transactions the last load collapsed as likely duplicates — shown
  // as a small, non-blocking note on the Transactions page so the automatic
  // merge isn't completely invisible (there's no undo for it, see the guide).
  const [dedupedCount, setDedupedCount] = useState(0)
  const [view, setView] = useState(() => {
    try {
      // Returning from an OAuth bank (Capital One) lands here with ?oauth_state_id
      // — show Settings so ConnectBankCard mounts and resumes the connection.
      if (window.location.search.includes('oauth_state_id')) return 'settings'
      return localStorage.getItem('budget.view') || 'dashboard'
    } catch {
      return 'dashboard'
    }
  })
  const [notice, setNotice] = useState(null)
  // Forecast window: 'paycheck' (today → next payday), '14', or '30' days.
  // Defaults to the current pay-period squeeze — the number that matters most.
  const [horizon, setHorizon] = useState('paycheck')
  // On-the-fly "Counting:" toggles on the Safe-to-spend tile — include/exclude
  // goal reserves and debt payments from the number without changing settings.
  const [counting, setCounting] = useState(() => {
    try {
      return { goals: true, debt: true, ...JSON.parse(localStorage.getItem('budget.counting') || '{}') }
    } catch {
      return { goals: true, debt: true }
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('budget.counting', JSON.stringify(counting))
    } catch {
      /* ignore */
    }
  }, [counting])
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // Phase plan is hidden by default (Matt found it too noisy); opt back in via
  // Settings if ever wanted.
  const [showPhase, setShowPhase] = useState(() => {
    try {
      return localStorage.getItem('budget.showPhase') === '1'
    } catch {
      return false
    }
  })

  // Text size (desktop): user-picked level applied as a root font override.
  const [fontSize, setFontSize] = useState(() => {
    try {
      return localStorage.getItem('budget.fontSize') || ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    if (fontSize) document.documentElement.dataset.fs = fontSize
    else delete document.documentElement.dataset.fs
  }, [fontSize])

  // Compact density: tighter padding/type app-wide (Settings → Dashboard).
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem('budget.compact') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (compact) document.documentElement.dataset.compact = '1'
    else delete document.documentElement.dataset.compact
  }, [compact])

  // Tile layout (order, columns, collapsed) per page, persisted. The nav
  // sliders icon toggles "Customize" on whichever page you're viewing.
  const [arranging, setArranging] = useState(false)
  const dashTiles = useTileLayout('dashboard', DASH_TILE_IDS, DEFAULT_DASH_LAYOUT, {
    layout: 'budget.dashLayout',
    collapsed: 'budget.dashCollapsed',
  })

  // Suggest budget categories plus every category already used in transactions —
  // via categoriesInUse, same as Insights' budget picker, so a raw Plaid code or a
  // category since renamed away from doesn't show up as a stale/ugly option here.
  // Has to live before any conditional return below (data may still be null while
  // loading) since hooks can't be called conditionally.
  const categories = useMemo(() => {
    if (!data) return []
    return [...new Set([...data.budgets.map((b) => b.category), ...categoriesInUse(data.transactions)])].sort()
  }, [data])

  // Remember the open page across refreshes (so a refresh doesn't kick you home).
  // Leaving a page also exits Customize mode.
  useEffect(() => {
    setArranging(false)
    try {
      localStorage.setItem('budget.view', view)
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, [view])

  // Handle the redirect back from connecting Google Calendar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const g = params.get('google')
    if (!g) return
    if (g === 'connected') {
      setView('settings')
      setNotice({ kind: 'ok', text: 'Google Calendar connected.' })
    } else if (g === 'error') {
      setView('settings')
      setNotice({ kind: 'err', text: "Couldn't connect Google Calendar. Please try again." })
    }
    // Clean the URL so a refresh doesn't re-trigger this.
    window.history.replaceState({}, '', window.location.pathname)
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [])

  const load = useCallback(async () => {
    // Your permanent category renames must be in place BEFORE anything reads a
    // category (cleanCategory applies them), so set them right before setData.
    const applyAliases = (arr) =>
      setCategoryAliases(Object.fromEntries((arr || []).map((a) => [a.from_name, a.to_name])))
    if (demo) {
      const d = await fetchAll()
      applyAliases(d.categoryAliases)
      const cleaned = dedupeTransactions(d.transactions)
      setDedupedCount((d.transactions || []).length - cleaned.length)
      setData({ ...d, transactions: cleaned, fetchedAt: new Date().toISOString() })
      return
    }
    // If a cached snapshot is already showing (loadCachedData on mount, or a
    // prior successful load), this fetch happens quietly behind it — no blank
    // screen, just the small syncing dot next to "Budget" while it's in flight.
    setSyncing(true)
    try {
      setError(null)
      const raw = await fetchAll()
      // Collapse import/Plaid duplicate purchases before anything sees them.
      // Stamp when this live pull happened so Settings can show data freshness
      // (a cached fallback keeps its OLDER stamp, so stale numbers show their age).
      const cleaned = dedupeTransactions(raw.transactions)
      setDedupedCount(raw.transactions.length - cleaned.length)
      const d = {
        ...raw,
        transactions: cleaned,
        fetchedAt: new Date().toISOString(),
      }
      applyAliases(raw.categoryAliases)
      setData(d)
      // Keep a snapshot so the app still shows real numbers with no signal.
      try {
        localStorage.setItem('budget.cache', JSON.stringify(d))
      } catch {
        /* storage full / private mode — fine, just no offline cache */
      }
    } catch (err) {
      // Offline or the request failed — fall back to the last synced snapshot
      // (already showing, in the common case, since we render from cache
      // first — this just covers the rarer case where load() was retried).
      let cached = null
      try {
        cached = JSON.parse(localStorage.getItem('budget.cache') || 'null')
      } catch {
        cached = null
      }
      if (cached) {
        applyAliases(cached.categoryAliases)
        setData(cached)
      } else setError(err.message)
    } finally {
      setSyncing(false)
    }
  }, [demo])

  // Manual "refresh now" — force a live pull from the banks, then reload.
  const refreshNow = useCallback(async () => {
    if (demo) return load()
    setRefreshing(true)
    try {
      await refreshPlaid()
      await load()
    } catch {
      /* leave the last-known numbers in place */
    } finally {
      setRefreshing(false)
    }
  }, [demo, load])

  useEffect(() => {
    load()
  }, [load])

  // For "Save each paycheck": the default accounts a move flows between — from your
  // main spendable account, into your main savings (non-spendable) account. Null if
  // you have no savings account yet (then the app can't offer the "I moved it" step).
  const smoothingAccounts = useMemo(() => {
    if (!data) return { from: null, to: null }
    const sums = accountSummaries(data.accounts, data.balances).filter((a) => !a.hidden)
    const spend = sums.filter((a) => countsAsSpendable(a)).sort((a, b) => b.balance - a.balance)
    const save = sums.filter((a) => !countsAsSpendable(a)).sort((a, b) => b.balance - a.balance)
    return { from: spend[0] || null, to: save[0] || null }
  }, [data])

  // Record that a smoothed item's per-paycheck slice was physically moved to savings
  // (dir 1) or undo it (dir -1). Moves BOTH legs so Safe-to-spend nets to zero.
  const handleSmoothingMove = useCallback(
    async (item, amount, dir = 1) => {
      if (!data || !(amount > 0)) return
      const kind = item.id.startsWith('debt-') ? 'debt' : 'bill'
      const rawId = item.id.replace(/^(bill|debt)-/, '')
      const table = kind === 'debt' ? 'debts' : 'recurring_bills'
      const list = kind === 'debt' ? data.debts : data.bills
      const rec = (list || []).find((x) => String(x.id) === rawId)
      const currentSaved = Number(rec?.smooth_saved || 0)
      const from = smoothingAccounts.from
      const to = smoothingAccounts.to
      if (demo) {
        // No backend in demo — mutate local state so the release + net-zero is visible.
        setData((prev) => {
          if (!prev) return prev
          const nextSaved = Math.max(0, currentSaved + dir * amount)
          const bumpSaved = (arr) =>
            (arr || []).map((x) => (String(x.id) === rawId ? { ...x, smooth_saved: nextSaved } : x))
          const stamp = new Date().toISOString()
          const sums = accountSummaries(prev.accounts, prev.balances)
          const balFor = (id) => Number(sums.find((a) => a.id === id)?.balance || 0)
          const entries = [...(prev.balances || [])]
          if (from) entries.push({ id: `demo-mv-f-${stamp}`, account_id: from.id, balance: Number((balFor(from.id) - dir * amount).toFixed(2)), as_of: isoDate(), created_at: stamp })
          if (to) entries.push({ id: `demo-mv-t-${stamp}`, account_id: to.id, balance: Number((balFor(to.id) + dir * amount).toFixed(2)), as_of: isoDate(), created_at: stamp })
          return {
            ...prev,
            balances: entries,
            bills: kind === 'bill' ? bumpSaved(prev.bills) : prev.bills,
            debts: kind === 'debt' ? bumpSaved(prev.debts) : prev.debts,
          }
        })
        return
      }
      try {
        await moveToSmoothing({ table, id: rawId, amount, currentSaved, fromAccountId: from?.id, toAccountId: to?.id, itemName: rec?.name || '', dir })
        await load()
      } catch (err) {
        setNotice(
          err?.code === 'needs-migration'
            ? { kind: 'err', text: 'One-time setup needed first: paste supabase/smooth_bills_debts.sql in Supabase, then try again.' }
            : { kind: 'err', text: "Couldn't record that move. Please try again." }
        )
      }
    },
    [data, demo, smoothingAccounts, load]
  )

  const handleLogSpend = useCallback(
    async ({ amount, merchant }) => {
      const amt = Number(amount)
      if (!(amt > 0) || !data) return
      const name = String(merchant || 'Spend').trim() || 'Spend'
      await addTransaction({
        txn_date: isoDate(),
        merchant: name,
        amount: amt,
        category: 'Other',
      })
      const sums = accountSummaries(data.accounts, data.balances).filter((a) => !a.hidden && countsAsSpendable(a))
      const primary = [...sums].sort((a, b) => b.balance - a.balance)[0]
      if (primary) {
        await adjustAccountBalance(primary.id, -amt, { note: name })
      }
      await load()
    },
    [data, load]
  )

  const handlePauseGoal = useCallback(
    async (id) => {
      await setGoalReserved(id, false, {})
      await load()
    },
    [load]
  )

  // Track connectivity so we can tell the user when numbers are last-synced.
  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Bank refresh, gated: mount + foreground events all funnel through one
  // 60-second throttle so a single app-open doesn't fire the bank sync 3-4
  // times (that burned Plaid's rate limits and made refreshes silently fail).
  const lastPlaidRef = useRef(0)
  const maybeRefreshPlaid = useCallback(() => {
    if (demo) return
    const now = Date.now()
    if (now - lastPlaidRef.current < 60000) return
    lastPlaidRef.current = now
    refreshPlaid()
      .then((r) => {
        if (r?.synced) load()
      })
      .catch(() => {})
  }, [demo, load])

  // Auto-pull latest balances + transactions from connected banks on app open.
  useEffect(() => {
    maybeRefreshPlaid()
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-sync whenever the app comes back to the foreground. Installed PWAs keep
  // the page alive in the background, so reopening from the home screen would
  // otherwise show stale numbers until a manual refresh.
  useEffect(() => {
    if (demo) return
    let lastLoad = 0
    const resync = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastLoad >= 3000) {
        lastLoad = now
        load()
      }
      maybeRefreshPlaid()
    }
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('pageshow', resync)
    return () => {
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('pageshow', resync)
    }
  }, [demo, load, maybeRefreshPlaid])

  const derived = useMemo(() => {
    if (!data) return null
    const latest = currentBalance(data.balances)
    const bufferFloor = data.settings?.buffer_floor ?? DEFAULT_BUFFER
    const today = isoDate()
    // The date of your last check-in (the "as of" of your newest balance).
    const anchorDate = latest?.as_of || today
    // Credit-card minimums are real obligations: fold them in alongside bills so
    // they lower safe-to-spend and show up in the projection and upcoming list.
    // Smoothed bills/debts are reserved per-paycheck (below), not billed as lumps,
    // so keep them out of the forecast's bill list. debtsAsBills already skips
    // smoothed debts; filter smoothed bills here.
    const lumpBills = data.bills.filter((b) => !b.smooth)
    const allBills = counting.debt
      ? [...lumpBills, ...debtsAsBills(data.debts, data.goals)]
      : [...lumpBills]
    // Resolve the chosen forecast window into a number of days. "Next paycheck"
    // counts to your real next payday (so it tightens as payday nears); the
    // others are fixed rolling windows. Fall back to 14 days if no paycheck is
    // scheduled.
    const upPay = upcomingIncome(data.income, today, 90, data.transactions)
    // Next FUTURE paycheck — on payday itself, plan to the following one
    // (same rule spendableToday uses), not a stale 14-day fallback.
    const nextPay = upPay.find((i) => i.date > today) || upPay[0] || null
    const daysToPay = nextPay
      ? Math.round(
          (new Date(nextPay.date) - new Date(today)) / (24 * 60 * 60 * 1000)
        )
      : null
    let horizonDays
    let horizonLabel
    if (horizon === '14') {
      horizonDays = 14
      horizonLabel = '2 weeks'
    } else if (horizon === '30') {
      horizonDays = 30
      horizonLabel = '30 days'
    } else {
      horizonDays = daysToPay && daysToPay >= 1 ? daysToPay : 14
      horizonLabel = 'next paycheck'
    }
    // Bills that still need paying — occurrences with a matching payment
    // already in the transactions feed drop out (they've left the balance).
    const upcoming = unpaidBills(allBills, data.transactions, today, horizonDays)
    const income = upcomingIncome(data.income, today, horizonDays, data.transactions)
    // Dated "planned" goals are real one-time outflows — fold them into the
    // forecast so the running balance sets them aside like any bill.
    const goalEvents = datedGoalEvents(data.goals, today, horizonDays, data.transactions)
    // Everyday spending (food/gas/pet ceilings) as a daily drain so the forecast
    // reflects real life instead of assuming $0 variable spend.
    const spendEvents = variableSpendEvents(data.budgets, today, horizonDays)
    const events = mergeTimeline(upcoming, income, [...goalEvents, ...spendEvents])
    const monthlyVariable = data.budgets.reduce(
      (s, b) => s + Number(b.monthly_limit || 0),
      0
    )
    // Hidden accounts are OUT of everything: totals, safe-to-spend, forecast.
    // (They remain reachable in Accounts → Manage to unhide.)
    const visibleAccounts = data.accounts.filter((a) => !a.hidden)
    const summaries = accountSummaries(visibleAccounts, data.balances)
    const totals = moneyTotals(visibleAccounts, data.balances, data.debts)
    // With accounts set up, "safe to spend" rests on spendable-account cash.
    // Before any account exists, fall back to the latest single balance entry.
    const hasAccounts = data.accounts.length > 0
    const checkinBal = hasAccounts
      ? totals.spendableCash
      : latest
        ? Number(latest.balance)
        : 0
    const hasBalance = hasAccounts || latest
    // Estimate TODAY's balance by rolling your last check-in forward through the
    // spending + bills that have happened since — then forecast from today. This
    // keeps the projected low STABLE between check-ins: the assumed spend we trim
    // off the start exactly offsets the spend-days that drop out of the shrinking
    // window, so the number no longer drifts optimistic just because a day passed.
    // When you check in, anchorDate === today, the estimate is zero, and startBal
    // is simply your real balance again.
    const elapsedDays = Math.max(
      0,
      Math.round(
        (new Date(today) - new Date(anchorDate)) / (24 * 60 * 60 * 1000)
      )
    )
    const billsSince = upcomingBills(allBills, anchorDate, elapsedDays)
      .filter((b) => b.date < today)
      .reduce((s, b) => s + Number(b.amount || 0), 0)
    const assumedSince = elapsedDays * (monthlyVariable / 30) + billsSince
    const startBal = checkinBal - assumedSince
    const projection = hasBalance
      ? projectBalance(startBal, events, bufferFloor)
      : null
    // Money saved into goals (net of what's been spent on them) is held out of
    // safe-to-spend, just like the buffer floor.
    const earmarked = totalEarmarked(data.goals, data.transactions, data.accounts)
    const setAside = totalSetAside(data.setAsides)
    // This paycheck's set-aside across your RESERVED dated goals — held out of
    // safe-to-spend so goal contributions are money you can't also spend. Nothing
    // is held for a goal until your NEXT real paycheck lands; from then, one slice
    // builds per landed paycheck until the full amount is set aside by its date.
    const goalReservePotential = goalPaceReserve(data.goals, data.transactions, payPeriodsPerYear(data.income), data.income)
    const goalReserve = counting.goals ? goalReservePotential : 0
    // Per-goal breakdown of that reserve — shows what's CURRENTLY held for each
    // goal (not the flat pace), so the numbers under the "Toward goals each
    // paycheck" line always add up to the total above them.
    const goalReserveByItem = (data.goals || [])
      .filter((g) => g.status === 'active' && g.target_date && g.reserved !== false)
      .map((g) => {
        const saved = Math.max(Number(g.current || 0), goalSpent(g.id, data.transactions))
        const p = goalPace(g, saved, undefined, payPeriodsPerYear(data.income), data.income, data.transactions)
        return { id: g.id, name: g.name, perPaycheck: Math.round((p.reserveNow || 0) * 100) / 100 }
      })
      .filter((x) => x.perPaycheck > 0)
    // A forward preview, not a second hold: what each goal WILL be holding once
    // your next real paycheck lands — same math as above, just evaluated as of
    // that future date instead of today. Purely informational; it does NOT
    // change what's actually subtracted from Safe to spend right now (that stays
    // based on today's real hold — the "nothing held before it's earned" fix).
    // Naturally excludes a fully-funded goal too (its cap is already $0, so it
    // holds nothing either today OR at the next paycheck) without needing a
    // separate "done" case.
    const goalNextPaycheckByItem = nextPay
      ? (data.goals || [])
          .filter((g) => g.status === 'active' && g.target_date && g.reserved !== false)
          .map((g) => {
            const saved = Math.max(Number(g.current || 0), goalSpent(g.id, data.transactions))
            const p = goalPace(g, saved, nextPay.date, payPeriodsPerYear(data.income), data.income, data.transactions)
            return { id: g.id, name: g.name, perPaycheck: Math.round((p.reserveNow || 0) * 100) / 100 }
          })
          .filter((x) => x.perPaycheck > 0)
      : goalReserveByItem
    const goalNextPaycheckTotal = Math.round(goalNextPaycheckByItem.reduce((s, x) => s + x.perPaycheck, 0) * 100) / 100
    const hasDebtBills = debtsAsBills(data.debts, data.goals).length > 0
    // Everyday spending: what's still reserved in this pay-period's category
    // budgets (each budget's per-paycheck share minus what's been spent). Held out
    // of safe-to-spend so it reads as "free for extras". Nets actual spending, so
    // it's never double-counted; the forecast trough already reflects everyday
    // spending via variableSpendEvents, so this only feeds the headline.
    const everyday = everydayHoldback(data.budgets, data.transactions, {
      ppy: payPeriodsPerYear(data.income),
      periodStartIso: mostRecentPaydayIso(data.income, today),
      today,
    })
    // "Save each paycheck": an accumulating sinking-fund reserve for bills/debts
    // flagged smooth. They're excluded from the lump bills above (counted once), and
    // the reserve releases whatever's genuinely been moved to savings — so it needs
    // the real account balances + goals to know how much is truly banked already.
    const smoothed = smoothedReserve(data.bills, data.debts, payPeriodsPerYear(data.income), {
      accounts: accountSummaries(data.accounts, data.balances),
      goals: data.goals,
      today,
      incomeSources: data.income,
      transactions: data.transactions,
    })
    // Split "Save each paycheck" into BILLS and DEBT — they used to share one
    // "(big bills)" line, which was wrong (a smoothed debt payment isn't a bill).
    // The Debt "Counting" chip governs ALL your debt — lump payments AND anything
    // you've smoothed — so it stays a quick on/off even when every active debt is
    // smoothed; the Bills portion is never affected by that chip.
    const billSmoothedItems = (smoothed.byItem || []).filter((s) => String(s.id).startsWith('bill-'))
    const debtSmoothedItems = (smoothed.byItem || []).filter((s) => String(s.id).startsWith('debt-'))
    const billSmoothedTotal = Math.round(billSmoothedItems.reduce((s, x) => s + Number(x.perPaycheck || 0), 0) * 100) / 100
    const debtSmoothedPotential = Math.round(debtSmoothedItems.reduce((s, x) => s + Number(x.perPaycheck || 0), 0) * 100) / 100
    const debtSmoothedTotal = counting.debt ? debtSmoothedPotential : 0
    const hasDebt = hasDebtBills || debtSmoothedPotential > 0
    const spendable = hasBalance
      ? spendableToday(startBal, {
          bills: allBills,
          incomes: data.income,
          // Trip funds were folded into Goals — a trip is a goal with a
          // deadline; its set-aside is held via the goal earmark instead.
          buckets: [],
          bufferFloor,
          earmarked,
          setAside,
          goalReserve,
          everyday: everyday.total,
          smoothed: billSmoothedTotal + debtSmoothedTotal,
          transactions: data.transactions,
          fromIso: today,
        })
      : null
    // The forecast walks the *total* balance. To show the spendable trough too,
    // apply the same held-out reserves (buffer + goal earmarks + trip funds) to
    // the lowest point — the bills are already subtracted by the walk itself.
    const holdbacks = spendable
      ? spendable.floor + spendable.tripFunds + spendable.earmarked + spendable.setAside + spendable.goalReserve + spendable.smoothed
      : 0
    const spendableLowest =
      projection != null ? projection.lowest - holdbacks : null
    // Cash runway: days until spendable cash falls to your buffer floor with
    // no income coming in — the same untouchable line the rest of this card
    // protects (Rule 4), not a further, more optimistic $0.
    const runway = hasBalance
      ? runwayDays(startBal, allBills, monthlyVariable, bufferFloor, today)
      : null
    // Where you land at the end of the window, and the net change. On the
    // "next paycheck" view we compare payday-to-payday (vs your last check-in /
    // cycle start) — the real "am I getting ahead?" signal. On the rolling
    // windows there's no clean payday anchor, so we compare vs today's estimate.
    const isPaycheckView = horizon === 'paycheck'
    const netWindow =
      projection != null
        ? projection.endingBalance - (isPaycheckView ? checkinBal : startBal)
        : null
    const netBasis = isPaycheckView ? 'vs last payday' : 'vs today'
    // Split "where you land" into the balance right BEFORE the paycheck deposit
    // and after it, so an incoming paycheck can't make a spent-down balance look
    // flush. Read the balance from the trajectory point just before the paycheck
    // lands (balanceAfter − its deposit) so it always reconciles with the low —
    // subtracting the paycheck from the ending would over-count post-payday bills.
    let beforePaycheck = null
    if (isPaycheckView && projection != null && nextPay) {
      const payPoint = [...(projection.points || [])]
        .reverse()
        .find((p) => p.kind === 'income' && p.date === nextPay.date)
      beforePaycheck = payPoint
        ? Number((payPoint.balanceAfter - payPoint.delta).toFixed(2))
        : projection.endingBalance - Number(nextPay.amount || 0)
    }
    // Cash-flow calendar: a fixed 30-day view of dated money in/out (bills,
    // paychecks, planned items), no everyday-spending estimate so it shows
    // discrete events. Same starting balance as the forecast.
    const calEvents = mergeTimeline(
      unpaidBills(allBills, data.transactions, today, 30),
      upcomingIncome(data.income, today, 30, data.transactions),
      datedGoalEvents(data.goals, today, 30, data.transactions)
    )
    const calProjection = hasBalance ? projectBalance(startBal, calEvents, bufferFloor) : null
    const cashflow = calProjection
      ? { points: calProjection.points, start: startBal, lowestDate: calProjection.lowestPoint?.date }
      : null
    // "New Normal" scenario tool. Passes the pieces for a NORMALIZED per-paycheck
    // baseline (regular income − recurring bills − debt payments − goal set-asides,
    // each converted to per-paycheck) — deliberately independent of where you are
    // in the current cycle. Plus separate 90-day event lists so the tool's own
    // Goals/Debt toggles can include or drop each in the cycle re-projection.
    const nnHorizon = 90
    const nnPpy = payPeriodsPerYear(data.income)
    const nnIncomeOcc = upcomingIncome(data.income, today, nnHorizon, data.transactions)
    const nnBillOcc = unpaidBills(data.bills, data.transactions, today, nnHorizon)
    const nnDebtBills = debtsAsBills(data.debts, data.goals)
    const nnDebtOcc = unpaidBills(nnDebtBills, data.transactions, today, nnHorizon)
    // The Debt chip must govern the SAME debts in the baseline and the cycle walk.
    // debtsAsBills already excludes debts whose paydown flows through an installment
    // plan (those ride the goal timeline instead), so the baseline debt sum must
    // exclude them too — otherwise a plan-debt would sit under Debt in the baseline
    // but under Goals in the projection.
    const nnBilledDebtIds = new Set(nnDebtBills.map((b) => String(b.id).replace(/^debt-/, '')))
    const perYearOf = (c) => ({ weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[c] || 12)
    const billMonthly = (b) => (Number(b.amount) || 0) * ({ biweekly: 26 / 12, weekly: 52 / 12 }[b.cadence] || 1)
    const newNormal = hasBalance
      ? {
          startBal,
          bufferFloor,
          today,
          ppy: nnPpy,
          perPaycheck: {
            // Regular income = CONFIRMED sources only (unconfirmed side gigs out).
            income: (data.income || [])
              .filter((s) => s.confirmed !== false)
              .reduce((s, src) => s + ((Number(src.amount) || 0) * perYearOf(src.cadence)) / nnPpy, 0),
            bills: (data.bills || []).reduce((s, b) => s + (billMonthly(b) * 12) / nnPpy, 0),
            // Everyday spending = your category budgets, per paycheck (the full
            // budgeted rate — a "new normal" is a steady state, not this period's
            // remaining). Always counts; only debt/goals have chips.
            everyday: (data.budgets || []).reduce((s, b) => s + ((Number(b.monthly_limit) || 0) * 12) / nnPpy, 0),
            debt: (data.debts || [])
              .filter((d) => d.active !== false && nnBilledDebtIds.has(d.id))
              .reduce((s, d) => s + (monthlyDebtPayment(d) * 12) / nnPpy, 0),
            // The flat committed PACE across active/reserved goals — not the ramped
            // reserveNow amount feeding today's Safe to spend, which starts at $0
            // and builds toward the pace over your next few paychecks. New Normal is
            // explicitly a steady, cycle-independent baseline, so it uses the same
            // steady per-goal slice regardless of where any single goal is in its
            // own build-up right now.
            goal: (data.goals || [])
              .filter((g) => g.status === 'active' && g.target_date && g.reserved !== false)
              .reduce((s, g) => {
                const saved = Math.max(Number(g.current || 0), goalSpent(g.id, data.transactions))
                const p = goalPace(g, saved, undefined, nnPpy, data.income, data.transactions)
                return s + (p.neededPerPaycheck || 0)
              }, 0),
          },
          events: {
            // Base = income, bills, AND everyday spending (spread from budgets),
            // so the cycle walk drains groceries/gas/dining like the real forecast.
            base: mergeTimeline(nnBillOcc, nnIncomeOcc, variableSpendEvents(data.budgets, today, nnHorizon)),
            debt: mergeTimeline(nnDebtOcc, [], []),
            goal: datedGoalEvents(data.goals, today, nnHorizon, data.transactions),
          },
          // Dedupe consecutive-equal dates so an income occurrence that lands on
          // `today` doesn't create a zero-length first cycle (today–today).
          paydays: [today, ...nnIncomeOcc.map((i) => i.date)].filter(
            (d, i, arr) => i === 0 || d !== arr[i - 1]
          ),
        }
      : null
    // The Dashboard "Next 30 days of bills" tile: view-only, always shows recurring
    // bills PLUS arranged debt payments (not goals), independent of the counting
    // chip. 30-day window regardless of the horizon toggle.
    const upcomingBills30 = unpaidBills(
      [...lumpBills, ...debtsAsBills(data.debts, data.goals)],
      data.transactions,
      today,
      30
    )
    // The Income tile's own "Expected next 30 days" label is a fixed promise,
    // so back it with an actual 30-day window too — not the horizon toggle's
    // (usually shorter) one.
    const upcomingIncome30 = upcomingIncome(data.income, today, 30, data.transactions)
    const incomeShortfallList = incomeShortfalls(data.income, data.transactions, today)
    const ppy = payPeriodsPerYear(data.income)
    const everydayPerPaycheck = (data.budgets || []).reduce(
      (s, b) => s + ((Number(b.monthly_limit) || 0) * 12) / ppy,
      0
    )
    const confirmedPay = (data.income || []).find((i) => i.confirmed) || (data.income || [])[0]
    const assignment = paycheckSplit({
      amount: nextPay ? Number(nextPay.amount || 0) : Number(confirmedPay?.amount || 0),
      name: nextPay?.name || confirmedPay?.name || 'Paycheck',
      date: nextPay?.date || null,
      goals: goalNextPaycheckByItem,
      bills: billSmoothedItems,
      debts: counting.debt ? debtSmoothedItems : [],
      everyday: everydayPerPaycheck,
    })
    const gap = spendable && spendable.spendable < 0 ? Math.abs(spendable.spendable) : 0
    const closers = gapClosers({
      gap,
      goalLines: counting.goals ? goalReserveByItem : [],
      everydayTotal: everyday.total,
      debtHeld: debtSmoothedTotal,
      counting,
    })
    return {
      newNormal,
      upcomingBills30,
      upcomingIncome30,
      incomeShortfallList,
      everydayByCat: everyday.byCat,
      billSmoothed: billSmoothedTotal,
      billSmoothedByItem: billSmoothedItems,
      debtSmoothed: debtSmoothedTotal,
      debtSmoothedByItem: counting.debt ? debtSmoothedItems : [],
      goalNextPaycheckByItem,
      goalNextPaycheckTotal,
      hasGoalReserve: goalReservePotential > 0,
      hasDebtBills: hasDebt,
      latest,
      summaries,
      totals,
      bufferFloor,
      upcoming,
      income,
      projection,
      cashflow,
      spendableLowest,
      runway,
      netWindow,
      netBasis,
      beforePaycheck,
      paydayDate: nextPay ? nextPay.date : null,
      horizonLabel,
      asOf: anchorDate,
      asOfStale: anchorDate < today,
      spendable,
      phaseInfo: phaseStatus(data.phases, today),
      plan: data.debts.length ? payoffPlan(data.debts, 0, 'avalanche', data.goals) : null,
      monthSpend: spendThisMonth(data.transactions),
      spendByCat: spendByCategory(data.transactions),
      assignment,
      closers,
    }
  }, [data, horizon, counting])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md bg-white rounded-xl shadow p-5">
          <p className="font-semibold text-red-600 mb-2">Couldn't load data</p>
          <p className="text-sm text-slate-600">{error}</p>
          <p className="text-xs text-slate-400 mt-2">
            If this mentions a missing table, the database schema may not be set
            up yet.
          </p>
          <button
            onClick={load}
            className="mt-3 bg-emerald-700 text-white text-sm rounded-lg px-4 py-2"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data || !derived) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-500">Loading your budget…</p>
      </div>
    )
  }

  const safeNow = derived.spendable ? derived.spendable.spendable : null
  const shortfall = safeNow != null && safeNow < 0
  const chrome = shortfall ? 'bg-red-900' : 'bg-emerald-800'
  // First-run: until there's an account, an income source AND at least one
  // bill, Safe to spend can't mean anything — so show the setup path instead
  // of leaving a new account staring at a page of empty tiles.
  const needsSetup =
    !demo &&
    (data.accounts.length === 0 || data.income.length === 0 || data.bills.length === 0)

  return (
    <div className="min-h-screen bg-slate-100 lg:pl-56">
      {/* Phone/tablet: top bar. Desktop gets the sidebar below instead. */}
      <header className={`${chrome} text-white px-4 py-2.5 flex items-center gap-3 sticky top-0 z-10 lg:hidden`}>
        <span className="font-bold text-lg shrink-0 flex items-center gap-1.5">
          Budget
          {syncing && <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse" title="Syncing…" />}
        </span>
        <span className="flex-1" />
        {/* Safe-to-spend stays visible everywhere (tap → dashboard). */}
        {safeNow != null && (
          <button onClick={() => setView('dashboard')} className="shrink-0 text-right leading-tight">
            <span className="block text-[0.65rem] uppercase tracking-wider text-white/60">Safe</span>
            <span className={`text-sm font-bold ${safeNow < 0 ? 'text-red-300' : ''}`}>
              {money(safeNow)}
            </span>
          </button>
        )}
        {['dashboard', 'settings', 'insights', 'credit'].includes(view) && (
          <button
            onClick={() => setArranging((a) => !a)}
            aria-label={arranging ? 'Done customizing layout' : 'Customize layout'}
            title={arranging ? 'Done' : 'Customize layout'}
            className={`shrink-0 rounded-full p-1.5 border transition ${
              arranging
                ? 'bg-white/15 border-white/50'
                : 'border-transparent text-white/70 hover:text-white'
            }`}
          >
            <SlidersIcon arranging={arranging} />
          </button>
        )}
      </header>

      {/* Desktop: fixed left sidebar — classic finance-app layout. */}
      <aside className={`hidden lg:flex fixed inset-y-0 left-0 z-20 w-56 flex-col ${chrome} text-white px-3 py-5`}>
        <span className="font-bold text-xl px-3 flex items-center gap-1.5">
          Budget
          {syncing && <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse" title="Syncing…" />}
        </span>
        {safeNow != null && (
          <button
            onClick={() => setView('dashboard')}
            className="text-left px-3 mt-4 pb-4 border-b border-white/10"
          >
            <span className="block text-[0.7rem] uppercase tracking-widest text-white/50">
              Safe to spend
            </span>
            <span className={`text-2xl font-bold ${safeNow < 0 ? 'text-red-300' : ''}`}>
              {money(safeNow)}
            </span>
          </button>
        )}
        <nav className="flex flex-col gap-1 mt-4">
          {PAGES.map((p) => {
            const active = view === p.id
            return (
              <button
                key={p.id}
                onClick={() => setView(p.id)}
                className={`text-left text-sm rounded-lg px-3 py-2 transition ${
                  active
                    ? 'bg-white/10 font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </nav>
        {['dashboard', 'settings', 'insights', 'credit'].includes(view) && (
          <button
            onClick={() => setArranging((a) => !a)}
            className={`mt-auto flex items-center gap-2 text-sm rounded-lg px-3 py-2 transition ${
              arranging ? 'bg-white/15 font-semibold' : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <SlidersIcon arranging={arranging} />
            {arranging ? 'Done' : 'Customize layout'}
          </button>
        )}
      </aside>

      {offline && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-center text-xs py-1.5 px-4">
          Offline — showing your last synced numbers. They'll refresh when you're back online.
        </div>
      )}


      <main
        className={`mx-auto p-4 sm:p-5 space-y-5 pb-28 lg:pb-12 ${
          ['dashboard', 'insights', 'credit', 'transactions', 'settings'].includes(view)
            ? 'max-w-xl lg:max-w-none lg:px-8'
            : 'max-w-xl lg:max-w-3xl'
        }`}
      >
        {notice && (
          <div
            className={`rounded-xl px-4 py-3 text-sm font-medium ${
              notice.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-red-50 text-red-600'
            }`}
          >
            {notice.text}
          </div>
        )}

        {view === 'dashboard' && needsSetup && (
          <SetupGuide
            hasAccounts={data.accounts.length > 0}
            hasIncome={data.income.length > 0}
            hasBills={data.bills.length > 0}
            onGoToBills={() => setView('insights')}
          />
        )}

        {view === 'dashboard' && (
          <>
            {/* Glance strip: the four vitals in one slim row. */}
            <div className="rounded-2xl bg-white shadow px-5 py-3 grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Stat label="Total cash" value={money(derived.totals.totalCash)} />
              <Stat label="Spent this month" value={money(derived.monthSpend)} />
              <Stat
                label="Debt-free"
                value={
                  derived.plan && !derived.plan.capped
                    ? new Date(derived.plan.debtFreeDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                    : '—'
                }
              />
            </div>

            {/* Desktop: hero and forecast share the top row instead of
                stacking in a narrow strip. Phones keep the single column. */}
            <div className="space-y-5 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start">
              <div className="space-y-5 min-w-0">
              <SpendableCard
                info={derived.spendable}
                everydayByCat={derived.everydayByCat}
                onEditBudgets={() => setView('insights')}
                billSmoothed={derived.billSmoothed}
                billSmoothedByItem={derived.billSmoothedByItem}
                debtSmoothed={derived.debtSmoothed}
                debtSmoothedByItem={derived.debtSmoothedByItem}
                goalNextPaycheckByItem={derived.goalNextPaycheckByItem}
                goalNextPaycheckTotal={derived.goalNextPaycheckTotal}
                onSmoothingMove={handleSmoothingMove}
                canMoveSmoothing={!!smoothingAccounts.to}
                lowest={{
                  safe: derived.spendableLowest,
                  bank: derived.projection ? derived.projection.lowest : null,
                  date: derived.projection && derived.projection.lowestPoint
                    ? derived.projection.lowestPoint.date
                    : null,
                }}
                counting={counting}
                onCounting={setCounting}
                hasGoalReserve={derived.hasGoalReserve}
                hasDebtBills={derived.hasDebtBills}
                asOf={derived.asOf}
                asOfStale={derived.asOfStale}
                closers={derived.closers}
                onPauseGoal={handlePauseGoal}
                onLogSpend={handleLogSpend}
              />
              <PaycheckAssignment assignment={derived.assignment} />
              </div>

              <div className="space-y-5 min-w-0">
                <ProjectionAlert
                  projection={derived.projection}
                  spendableLowest={derived.spendableLowest}
                  runway={derived.runway}
                  netWindow={derived.netWindow}
                  netBasis={derived.netBasis}
                  beforePaycheck={derived.beforePaycheck}
                  paydayDate={derived.paydayDate}
                  horizonLabel={derived.horizonLabel}
                  horizon={horizon}
                  onHorizonChange={setHorizon}
                  asOf={derived.asOf}
                  asOfStale={derived.asOfStale}
                  bufferFloor={derived.bufferFloor}
                  hasBudgets={data.budgets.length > 0}
                />

                {showPhase && (
                  <PhaseCard
                    phaseInfo={derived.phaseInfo}
                    phases={data.phases}
                    onChanged={load}
                  />
                )}
              </div>
            </div>

            {/* Two columns on wide screens, one on phones. Tiles are placed by the
                saved layout and can be reordered/collapsed via Customize. */}
            {(() => {
              const tileNodes = {
                accounts: (
                  <AccountsCard
                    accounts={data.accounts}
                    balances={data.balances}
                    debts={data.debts}
                    goals={data.goals}
                    transactions={data.transactions}
                    onRefresh={refreshNow}
                    refreshing={refreshing}
                    onChanged={load}
                  />
                ),
                income: (
                  <IncomeCard
                    income={data.income}
                    upcomingIncome={derived.upcomingIncome30}
                    shortfalls={derived.incomeShortfallList}
                    goals={data.goals}
                    debts={data.debts}
                    transactions={data.transactions}
                    onChanged={load}
                  />
                ),
                goals: (
                  <GoalsCard
                    goals={data.goals}
                    transactions={data.transactions}
                    debts={data.debts}
                    accounts={data.accounts}
                    balances={data.balances}
                    payPeriodsPerYear={payPeriodsPerYear(data.income)}
                    countingGoals={counting.goals}
                    onChanged={load}
                  />
                ),
                setaside: (
                  <SetAsideCard setAsides={data.setAsides} onChanged={load} />
                ),
                monthspend: (
                  <SpentThisMonthTile
                    transactions={data.transactions}
                    total={derived.monthSpend}
                  />
                ),
                bills: (
                  <UpcomingBillsCard
                    upcoming={derived.upcomingBills30}
                    bills={data.bills}
                    transactions={data.transactions}
                    ppy={derived.newNormal?.ppy || 26}
                    onChanged={load}
                  />
                ),
                debts: <DebtsCard debts={data.debts} goals={data.goals} debtPayments={data.debtPayments} ppy={payPeriodsPerYear(data.income)} onChanged={load} />,
                transactions: (
                  <TransactionsCard
                    transactions={data.transactions}
                    categories={categories}
                    goals={data.goals}
                    income={data.income}
                    accounts={data.accounts}
                    balances={data.balances}
                    onOpenAll={() => setView('transactions')}
                    onChanged={load}
                  />
                ),
                cashflow: <CashFlowCalendar cashflow={derived.cashflow} />,
              }
              return (
                <TileColumns
                  names={TILE_NAMES}
                  tiles={tileNodes}
                  tilesState={dashTiles}
                  arranging={arranging}
                />
              )
            })()}
          </>
        )}

        {view === 'transactions' && (
          <Suspense fallback={<PageFallback />}>
            <TransactionsView
              transactions={data.transactions}
              categories={categories}
              goals={data.goals}
              income={data.income}
              accounts={data.accounts}
              balances={data.balances}
              dedupedCount={dedupedCount}
              onChanged={load}
            />
          </Suspense>
        )}

        {view === 'checkin' && (
          <Suspense fallback={<PageFallback />}>
            <CheckInView
              accounts={data.accounts.filter((a) => !a.hidden)}
              balances={data.balances}
              transactions={data.transactions}
              spendable={derived.spendable}
              upcoming={derived.upcomingBills30}
              goals={data.goals}
              debts={data.debts}
              assignment={derived.assignment}
              closers={derived.closers}
              ppy={payPeriodsPerYear(data.income)}
              onChanged={load}
              onDone={() => setView('dashboard')}
              onPauseGoal={handlePauseGoal}
            />
          </Suspense>
        )}

        {view === 'credit' && (
          <Suspense fallback={<PageFallback />}>
            <CreditView
              scores={data.creditScores}
              milestones={data.creditMilestones}
              tasks={data.creditTasks}
              debts={data.debts}
              arranging={arranging}
              onChanged={load}
            />
          </Suspense>
        )}

        {view === 'insights' && (
          <Suspense fallback={<PageFallback />}>
            <InsightsView
              transactions={data.transactions}
              budgets={data.budgets}
              accounts={data.accounts.filter((a) => !a.hidden)}
              balances={data.balances}
              debts={data.debts}
              goals={data.goals}
              bills={data.bills}
              safeToSpend={derived.spendable ? derived.spendable.spendable : null}
              newNormal={derived.newNormal}
              periodStartIso={derived.periodStartIso}
              onChanged={load}
              arranging={arranging}
            />
          </Suspense>
        )}

        {view === 'settings' && (
          <SettingsView
            settings={data.settings}
            bufferFloor={derived.bufferFloor}
            email={session.user.email}
            showPhase={showPhase}
            onTogglePhase={(v) => {
              setShowPhase(v)
              try {
                localStorage.setItem('budget.showPhase', v ? '1' : '0')
              } catch {
                /* ignore */
              }
            }}
            data={data}
            arranging={arranging}
            compact={compact}
            fontSize={fontSize}
            onFontSize={(v) => {
              setFontSize(v)
              try {
                localStorage.setItem('budget.fontSize', v)
              } catch {
                /* ignore */
              }
            }}
            onToggleCompact={(v) => {
              setCompact(v)
              try {
                localStorage.setItem('budget.compact', v ? '1' : '0')
              } catch {
                /* ignore */
              }
            }}
            onChanged={load}
          />
        )}
      </main>

      <BottomNav view={view} setView={setView} shortfall={shortfall} />

      {(view === 'dashboard' || view === 'transactions') && (
        <QuickAddFab categories={categories} goals={data.goals} income={data.income} accounts={data.accounts} balances={data.balances} onChanged={load} />
      )}
    </div>
  )
}


function SettingsView({ settings, bufferFloor, email, showPhase, onTogglePhase, data, arranging, compact, onToggleCompact, fontSize, onFontSize, onChanged }) {
  const tilesState = useTileLayout('settings', SETTINGS_TILE_IDS, DEFAULT_SETTINGS_LAYOUT)
  const tiles = {
    bank: (
      <Suspense fallback={<TileFallback />}>
        <ConnectBankCard onChanged={onChanged} />
      </Suspense>
    ),
    grok: <GrokConnectCard data={data} />,
    calendar: <GoogleCalendarCard />,
    theme: <ThemeCard />,
    dashprefs: (
      <section className="rounded-2xl bg-white p-5 shadow space-y-3">
        <h2 className="font-semibold text-slate-800">Dashboard</h2>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>Show the “Current phase” card</span>
          <input
            type="checkbox"
            checked={showPhase}
            onChange={(e) => onTogglePhase(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>Text size (computer screens)</span>
          <select
            value={fontSize}
            onChange={(e) => onFontSize(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white"
          >
            <option value="s">Small</option>
            <option value="">Default</option>
            <option value="l">Large</option>
            <option value="xl">Extra large</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>Compact layout (denser cards, more on screen)</span>
          <input
            type="checkbox"
            checked={compact}
            onChange={(e) => onToggleCompact(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
        </label>
      </section>
    ),
    buffer: <BufferFloorCard current={bufferFloor} onSaved={onChanged} />,
    notifications: <NotificationsCard settings={settings} onChanged={onChanged} />,
    yourdata: (
      <section className="rounded-2xl bg-white p-5 shadow space-y-3">
        <h2 className="font-semibold text-slate-800">Your data</h2>
        <p className="text-xs text-slate-500">
          Download a complete copy of everything — accounts, transactions,
          goals, debts, bills, and income — as a file you keep. Peace of mind
          that your record isn't trapped in one place.
        </p>
        <button
          onClick={() => downloadBackup(data)}
          className="w-full border border-slate-300 text-slate-700 font-semibold rounded-lg px-4 py-2.5"
        >
          Download backup
        </button>
      </section>
    ),
    account: (
      <AccountCard email={email} signOut={signOut} fetchedAt={data.fetchedAt} />
    ),
    acctorder: (
      <Suspense fallback={<TileFallback />}>
        <AccountOrderCard accounts={data.accounts} onChanged={onChanged} />
      </Suspense>
    ),
    guide: (
      <Suspense fallback={<TileFallback />}>
        <GuideCard />
      </Suspense>
    ),
  }
  return (
    <TileColumns
      names={SETTINGS_TILE_NAMES}
      tiles={tiles}
      tilesState={tilesState}
      arranging={arranging}
    />
  )
}

// Account + app-health card. The "Update now" button is the escape hatch for
// the classic PWA trap: an installed app keeps running the version it cached
// and can show numbers computed by old code. This wipes the service worker and
// every cache, then reloads fresh from the network — no fiddling with browser
// settings. The version + "data as of" lines make staleness visible instead of
// silent, so you can always tell whether you're looking at the latest.
function AccountCard({ email, signOut, fetchedAt }) {
  const [updating, setUpdating] = useState(false)
  const fmt = (iso) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  async function forceUpdate() {
    setUpdating(true)
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if (window.caches) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      /* best effort — reload anyway */
    }
    window.location.reload()
  }
  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <h2 className="font-semibold text-slate-800">Account</h2>
      <p className="text-sm text-slate-500">Signed in as {email}</p>
      <button
        onClick={signOut}
        className="w-full border border-slate-300 text-slate-700 font-semibold rounded-lg px-4 py-2.5"
      >
        Sign out
      </button>
      <button
        onClick={forceUpdate}
        disabled={updating}
        className="w-full bg-slate-800 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-60"
      >
        {updating ? 'Updating…' : 'Update now (get the latest version)'}
      </button>
      <div className="text-xs text-slate-400 space-y-0.5 pt-1">
        <p>App version: {typeof __BUILD_TIME__ !== 'undefined' ? fmt(__BUILD_TIME__) : 'preview'}</p>
        {fetchedAt && <p>Data as of: {fmt(fetchedAt)}</p>}
      </div>
    </section>
  )
}

function BufferFloorCard({ current, onSaved }) {
  const [floor, setFloor] = useState(String(current))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await saveSettings({ buffer_floor: Number(floor) })
      await onSaved()
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <h2 className="font-semibold text-slate-800 mb-3">Buffer floor</h2>
      <form onSubmit={submit} className="space-y-3 text-slate-700">
        <p className="text-xs text-slate-500">
          This amount is treated as not spendable (your untouchable reserve).
          It's subtracted from your "safe to spend" number and is used to warn
          you before your balance drops into it.
        </p>
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          required
          value={floor}
          onChange={(e) => {
            setFloor(e.target.value)
            setSaved(false)
          }}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2.5"
        >
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </form>
    </section>
  )
}
