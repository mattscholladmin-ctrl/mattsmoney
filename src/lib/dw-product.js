// @ts-nocheck
// Dollarwise-style product math for Matt's Money.
// Spending insights are monthly; safe to spend always uses the cash/paycheck plan.

import { countsAsSpendable, accountSummaries } from './budget.js'
import { computePaycheckPlan } from './paycheck-plan.js'

export const PLAN_DEFAULT = { needs: 50, wants: 30, savings: 20 }

export const PURPOSES = [
  { id: 'unreviewed', label: 'Unreviewed' },
  { id: 'paid', label: 'Reviewed (no bucket)' },
  { id: 'needs', label: 'Needs', solid: '#3d90de', soft: '#c8e4fd', text: '#164c7f' },
  { id: 'wants', label: 'Wants', solid: '#eed813', soft: '#eef6b2', text: '#756b11' },
  { id: 'savings', label: 'Savings', solid: '#2bc458', soft: '#8ef5ac', text: '#0d5222' },
]

export const CATEGORY_CATALOG = [
  { name: 'Housing', color: '#159b8a' },
  { name: 'Transportation', color: '#9c6fff' },
  { name: 'Groceries', color: '#76d422' },
  { name: 'Dining Out', color: '#1ba3c6' },
  { name: 'Utilities & Bills', color: '#f06719' },
  { name: 'Shopping', color: '#e040fb' },
  { name: 'Health', color: '#ab877a' },
  { name: 'Entertainment', color: '#4f7cba' },
  { name: 'Family & Care', color: '#664971' },
  { name: 'Pets', color: '#eb73b3' },
  { name: 'Travel', color: '#d5bb21' },
  { name: 'Education', color: '#2979ff' },
  { name: 'Gifts & Donations', color: '#fc719e' },
  { name: 'Subscription', color: '#21b087' },
  { name: 'Savings & Investing', color: '#57a337' },
  { name: 'Debt Payments', color: '#7873c0' },
  { name: 'Fees', color: '#e03426' },
  { name: 'Other', color: '#ce69be' },
]

const SPEND_CATS = CATEGORY_CATALOG.map((c) => c.name)

export function moneyFull(n) {
  const v = Number(n || 0)
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}

export function moneyCompact(n) {
  const v = Number(n || 0)
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`
  return moneyFull(v)
}

export function monthKeyFrom(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })
}

export function loadDwState() {
  try {
    return JSON.parse(localStorage.getItem('mm.dw.v1') || 'null') || {}
  } catch {
    return {}
  }
}

export function saveDwState(next) {
  try {
    localStorage.setItem('mm.dw.v1', JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function txnMeta(state, t) {
  const id = String(t.id)
  const stored = state.meta?.[id] || {}
  const note = String(t.note || '')
  const fromNote = {}
  const pm = note.match(/purpose:(needs|wants|savings|unreviewed|paid)/i)
  if (pm) fromNote.purpose = pm[1].toLowerCase()
  const fm = note.match(/feeling:(happy|neutral|sad)/i)
  if (fm) fromNote.feeling = fm[1].toLowerCase()
  const hm = note.match(/hidden:(1|true|0|false)/i)
  if (hm) fromNote.hidden = /^(1|true)$/i.test(hm[1])
  return {
    purpose: fromNote.purpose || 'unreviewed',
    feeling: stored.feeling || fromNote.feeling || 'neutral',
    hidden: fromNote.hidden ?? false,
    category: t.category || 'Other',
  }
}

export function mapCategory(raw) {
  const s = String(raw || 'Other').toLowerCase()
  if (/rent|mortgage|housing|lease|boulder/.test(s)) return 'Housing'
  if (/uber|lyft|gas|fuel|parking|transit|car/.test(s)) return 'Transportation'
  if (/groc|safeway|walmart|king sooper|whole food/.test(s)) return 'Groceries'
  if (/dining|restaurant|cafe|coffee|bar|olive|hinge|food/.test(s)) return 'Dining Out'
  if (/util|electric|starlink|verizon|internet|phone|bill/.test(s)) return 'Utilities & Bills'
  if (/shop|amazon|target|apple/.test(s)) return 'Shopping'
  if (/health|doctor|pharm|dental/.test(s)) return 'Health'
  if (/netflix|prime|youtube|spotify|entertain|game/.test(s)) return 'Entertainment'
  if (/pet/.test(s)) return 'Pets'
  if (/travel|hotel|airbnb|airline/.test(s)) return 'Travel'
  if (/edu|tuition|udemy/.test(s)) return 'Education'
  if (/gift|donat|church/.test(s)) return 'Gifts & Donations'
  if (/subscr/.test(s)) return 'Subscription'
  if (/invest|broker|vanguard/.test(s)) return 'Savings & Investing'
  if (/debt|loan|capital one|card payment/.test(s)) return 'Debt Payments'
  if (/fee|atm|overdraft/.test(s)) return 'Fees'
  if (/transfer|venmo|zelle/.test(s)) return 'Transfers'
  if (/payroll|income|intandem|deposit|paycheck/.test(s)) return 'Income'
  const hit = CATEGORY_CATALOG.find((c) => c.name.toLowerCase() === s)
  return hit ? hit.name : 'Other'
}

export function monthlyFromIncome(income = [], state = {}) {
  if (state.estAmount) {
    const a = Number(state.estAmount)
    const f = state.estFreq || 'two-weeks'
    if (f === 'week') return a * (52 / 12)
    if (f === 'two-weeks') return a * 2
    if (f === 'year') return a / 12
    return a
  }
  let monthly = 0
  for (const row of income) {
    const amt = Number(row.amount || row.typical || 0)
    if (!amt) continue
    const cad = String(row.cadence || row.frequency || row.every || 'month').toLowerCase()
    if (/week/.test(cad) && !/two|bi|14/.test(cad)) monthly += amt * (52 / 12)
    else if (/two|bi|14/.test(cad)) monthly += amt * 2
    else if (/year/.test(cad)) monthly += amt / 12
    else monthly += amt
  }
  return monthly
}

function inMonth(t, ym) {
  return String(t.txn_date || t.date || '').startsWith(ym)
}

export function isExpense(t) {
  const amt = Number(t.amount || 0)
  if (t.direction === 'in' || t.income_source) return false
  if (['Transfers', 'Debt Payments', 'Income'].includes(mapCategory(t.category))) return false
  const blob = `${t.category || ''} ${t.merchant || ''}`
  if (/income|payroll|deposit|transfer in/i.test(blob)) return false
  return amt > 0
}

export function spendAmount(t) {
  return Math.abs(Number(t.amount || 0))
}

export function decorateTxns(transactions, state) {
  return (transactions || []).map((t) => {
    const meta = txnMeta(state, t)
    const category = mapCategory(meta.category)
    const pending = !!(t.pending || t.status === 'pending')
    return { ...t, ...meta, category, pending }
  })
}

export function accountReviewBank(account) {
  const blob = `${account?.name || ''} ${account?.institution || ''}`.toLowerCase()
  if (blob.includes('capital one') || blob.includes('capitalone')) return 'capital'
  if (blob.includes('sofi')) return 'sofi'
  return ''
}

export function computeProduct({ data, state, month }) {
  const plan = { ...PLAN_DEFAULT, ...(state.plan || {}) }
  const txns = decorateTxns(data.transactions, state)
  const visible = (t) => !t.hidden
  const monthTx = txns.filter((t) => inMonth(t, month))
  const classified = monthTx.filter((t) => visible(t) && ['needs', 'wants', 'savings'].includes(t.purpose) && isExpense(t) && t.category !== 'Transfers' && t.category !== 'Income')
  const byPurpose = { needs: 0, wants: 0, savings: 0 }
  for (const t of classified) byPurpose[t.purpose] = (byPurpose[t.purpose] || 0) + spendAmount(t)
  const classifiedTotal = byPurpose.needs + byPurpose.wants + byPurpose.savings
  const actual = {
    needs: classifiedTotal ? Math.round((byPurpose.needs / classifiedTotal) * 100) : 0,
    wants: classifiedTotal ? Math.round((byPurpose.wants / classifiedTotal) * 100) : 0,
    savings: classifiedTotal ? Math.round((byPurpose.savings / classifiedTotal) * 100) : 0,
  }
  const monthlyIncome = monthlyFromIncome(data.income, state)
  const safeToSpend = computePaycheckPlan({ data, state }).safeToSpend
  const recentSpend = monthTx.filter((t) => visible(t) && isExpense(t) && t.category !== 'Transfers').reduce((s, t) => s + spendAmount(t), 0)

  const catSpend = {}
  for (const name of SPEND_CATS) catSpend[name] = 0
  for (const t of monthTx) {
    if (!visible(t) || !isExpense(t)) continue
    if (!SPEND_CATS.includes(t.category)) continue
    catSpend[t.category] += spendAmount(t)
  }
  const budgets = {}
  for (const b of data.budgets || []) budgets[mapCategory(b.category)] = Number(b.monthly_limit || 0)
  Object.assign(budgets, state.budgets || {})

  const accounts = data.accounts || []
  const balances = data.balances || []
  const summaries = accountSummaries(accounts, balances)
  const checking = []
  const savings = []
  const credit = []
  for (const a of accounts) {
    if (a.hidden) continue
    const summary = summaries.find((row) => row.id === a.id)
    const availableMissing = summary.availableMissing || summary.balance == null
    const shown = summary.balance
    const row = { ...a, shown, availableMissing, available: shown, current: summary.bankCurrent, asOf: summary.asOf, counts: countsAsSpendable(a) }
    const kind = String(a.kind || a.type || '').toLowerCase()
    if (/credit|card/.test(kind)) credit.push(row)
    else if (/sav/.test(kind)) savings.push(row)
    else checking.push(row)
  }
  const sum = (arr) => arr.reduce((s, a) => s + (a.shown == null ? 0 : Number(a.shown)), 0)
  const checkingTotal = sum(checking)
  const savingsTotal = sum(savings)
  const creditOwed = credit.reduce((s, a) => s + (a.shown == null ? 0 : Math.max(0, Number(a.shown))), 0)
  const netCash = checkingTotal + savingsTotal - creditOwed
  const missingAvailable = [...checking, ...savings].filter((a) => a.counts && a.availableMissing).map((a) => a.name)

  const sofiAccts = new Set()
  const sofiItems = new Set()
  for (const a of accounts) {
    if (accountReviewBank(a) !== 'sofi') continue
    sofiAccts.add(a.id)
    if (a.plaid_item_id) sofiItems.add(a.plaid_item_id)
  }
  const sofiOnly = sofiAccts.size > 0 || sofiItems.size > 0
  const onSofi = (t) => (t.account_id && sofiAccts.has(t.account_id)) || (t.plaid_item_id && sofiItems.has(t.plaid_item_id))

  const queue = txns
    .filter((t) => t.purpose === 'unreviewed' && !t.pending && isExpense(t) && t.category !== 'Transfers' && (!sofiOnly || onSofi(t)))
    .sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)) || String(a.id).localeCompare(String(b.id)))

  return {
    plan,
    actual,
    byPurpose,
    monthlyIncome,
    safeToSpend,
    recentSpend,
    catSpend,
    budgets,
    txns,
    monthTx,
    checking,
    savings,
    credit,
    checkingTotal,
    savingsTotal,
    creditOwed,
    netCash,
    missingAvailable,
    queue,
    classifiedTotal,
  }
}

export function insightCards(product, month) {
  const cards = []
  const dining = product.catSpend['Dining Out'] || 0
  if (dining > 0) {
    cards.push({
      id: 'dining',
      name: 'Dining Out',
      severity: 'amber',
      body: `Dining Out is ${moneyFull(dining)} this month.`,
    })
  }
  if (!cards.length) {
    cards.push({
      id: 'caught',
      name: 'On track',
      severity: 'green',
      body: 'Review transactions so Insights can rank Wants vs Needs.',
    })
  }
  return cards
}
