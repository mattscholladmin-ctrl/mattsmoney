// @ts-nocheck
// Dollarwise-style product math for Matt's Money.
// Safe to spend = monthly income × wants plan % − visible Wants spend in the selected month.

export const PLAN_DEFAULT = { needs: 50, wants: 30, savings: 20 }

export const PURPOSES = [
  { id: 'unreviewed', label: 'Unreviewed' },
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
  const v = Math.abs(Number(n || 0))
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return moneyFull(n)
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
  const pm = note.match(/purpose:(needs|wants|savings|unreviewed)/i)
  if (pm) fromNote.purpose = pm[1].toLowerCase()
  const fm = note.match(/feeling:(happy|neutral|sad)/i)
  if (fm) fromNote.feeling = fm[1].toLowerCase()
  const hm = note.match(/hidden:(1|true)/i)
  if (hm) fromNote.hidden = true
  return {
    purpose: stored.purpose || fromNote.purpose || 'unreviewed',
    feeling: stored.feeling || fromNote.feeling || 'neutral',
    hidden: stored.hidden ?? fromNote.hidden ?? false,
    category: stored.category || t.category || 'Other',
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
  if (amt > 0 && Number(t.amount) && t.direction === 'in') return false
  const cat = String(t.category || t.income_source || '')
  if (/income|payroll|deposit|transfer in/i.test(cat + ' ' + (t.merchant || ''))) return amt < 0 ? true : false
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

export function computeProduct({ data, state, month }) {
  const plan = { ...PLAN_DEFAULT, ...(state.plan || {}) }
  const txns = decorateTxns(data.transactions, state)
  const visible = (t) => !t.hidden
  const monthTx = txns.filter((t) => inMonth(t, month))
  const classified = monthTx.filter((t) => visible(t) && t.purpose !== 'unreviewed' && isExpense(t) && t.category !== 'Transfers' && t.category !== 'Income')
  const byPurpose = { needs: 0, wants: 0, savings: 0 }
  for (const t of classified) byPurpose[t.purpose] = (byPurpose[t.purpose] || 0) + spendAmount(t)
  const classifiedTotal = byPurpose.needs + byPurpose.wants + byPurpose.savings
  const actual = {
    needs: classifiedTotal ? Math.round((byPurpose.needs / classifiedTotal) * 100) : 0,
    wants: classifiedTotal ? Math.round((byPurpose.wants / classifiedTotal) * 100) : 0,
    savings: classifiedTotal ? Math.round((byPurpose.savings / classifiedTotal) * 100) : 0,
  }
  const monthlyIncome = monthlyFromIncome(data.income, state)
  const safeToSpend = monthlyIncome * (Number(plan.wants) / 100) - byPurpose.wants
  const recentSpend = monthTx.filter((t) => isExpense(t) && t.category !== 'Transfers').reduce((s, t) => s + spendAmount(t), 0)

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
  const latestByAcct = {}
  for (const b of balances) {
    const id = b.account_id
    if (!latestByAcct[id] || String(b.as_of) > String(latestByAcct[id].as_of)) latestByAcct[id] = b
  }
  const checking = []
  const savings = []
  const credit = []
  for (const a of accounts) {
    if (a.hidden) continue
    const bal = latestByAcct[a.id]
    const available = bal?.available_balance ?? bal?.available
    const current = bal?.current_balance ?? bal?.balance ?? a.balance
    const shown = available != null ? Number(available) : Number(current || 0)
    const row = { ...a, shown, available: available != null ? Number(available) : null, current: current != null ? Number(current) : null }
    const kind = String(a.kind || a.type || '').toLowerCase()
    if (/credit|card/.test(kind)) credit.push(row)
    else if (/sav/.test(kind)) savings.push(row)
    else checking.push(row)
  }
  const sum = (arr) => arr.reduce((s, a) => s + Number(a.shown || 0), 0)
  const checkingTotal = sum(checking)
  const savingsTotal = sum(savings)
  const creditOwed = credit.reduce((s, a) => s + Math.max(0, Number(a.shown || 0)), 0)
  const netCash = checkingTotal + savingsTotal - creditOwed

  const queue = txns
    .filter((t) => t.purpose === 'unreviewed' && isExpense(t) && t.category !== 'Transfers')
    .sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)))

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
    queue,
    classifiedTotal,
  }
}

export function insightCards(product, month) {
  const cards = []
  const entries = Object.entries(product.catSpend).sort((a, b) => b[1] - a[1])
  const top = entries[0]
  if (top && top[1] >= 200) {
    cards.push({
      id: 'unusual',
      name: 'Unusual Purchases',
      severity: 'red',
      body: `Unusual spending detected: ${moneyFull(top[1])} in ${top[0]}.`,
    })
  }
  const dining = product.catSpend['Dining Out'] || 0
  if (dining > 0) {
    cards.push({
      id: 'dining',
      name: 'Dining Frequency',
      severity: 'amber',
      body: `Dining Out is ${moneyFull(dining)} this month.`,
    })
  }
  const util = product.catSpend['Utilities & Bills'] || 0
  if (util === 0) {
    cards.push({
      id: 'freeze',
      name: 'Spending Freeze',
      severity: 'green',
      body: 'Zero Utilities & Bills spend recorded this month so far.',
    })
  }
  const shop = product.catSpend.Shopping || 0
  if (shop > 0) {
    cards.push({
      id: 'annual',
      name: 'Annual Impact',
      severity: 'blue',
      body: `Shopping annualizes to about ${moneyFull(shop * 12)} from this month.`,
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
