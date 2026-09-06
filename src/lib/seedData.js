// @ts-nocheck
// Authoritative loader for Matt's current budget "source of truth".
// Mirrors supabase/SETUP_AND_LOAD.sql but runs server-side via the service-role
// client, so the data can be pushed without anyone pasting SQL.
//
// runSeed(db) clears the planning tables for the (single) account, reloads them,
// replaces only trip-window transactions, and returns a reconciliation object.

async function getUid(db) {
  const { data, error } = await db.auth.admin.listUsers()
  if (error) throw new Error('list users: ' + error.message)
  const users = [...(data?.users || [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  )
  if (!users.length) throw new Error('No user found.')
  return users[0]
}

// Replace the whole transaction log with an imported set (e.g. from bank CSVs).
export async function importTransactions(db, transactions) {
  const user = await getUid(db)
  const uid = user.id
  const del = await db.from('transactions').delete().eq('user_id', uid)
  if (del.error) throw new Error('clear transactions: ' + del.error.message)

  const rows = (transactions || []).map((t) => ({
    user_id: uid,
    txn_date: t.txn_date,
    merchant: String(t.merchant || '').slice(0, 120),
    amount: Number(t.amount) || 0,
    category: t.category || 'Other',
    note: t.note || null,
  }))
  const SIZE = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE)
    const { error } = await db.from('transactions').insert(chunk)
    if (error) throw new Error(`insert chunk @${i}: ${error.message}`)
    inserted += chunk.length
  }
  const { count } = await db.from('transactions').select('*', { count: 'exact', head: true }).eq('user_id', uid)
  const byCat = {}
  let total = 0
  for (const r of rows) { byCat[r.category] = (byCat[r.category] || 0) + r.amount; total += r.amount }
  return {
    user: user.email,
    inserted,
    totalInDb: count,
    totalSpend: Number(total.toFixed(2)),
    byCategory: Object.fromEntries(Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Number(v.toFixed(2))])),
  }
}

// Insert one or more transactions WITHOUT clearing the log (e.g. a manual
// charge like the disputed Intuit fee). Refunds later post as their own row.
export async function appendTransactions(db, transactions) {
  const user = await getUid(db)
  const uid = user.id
  const rows = (transactions || []).map((t) => ({
    user_id: uid,
    txn_date: t.txn_date,
    merchant: String(t.merchant || '').slice(0, 120),
    amount: Number(t.amount) || 0,
    category: t.category || 'Other',
    note: t.note || null,
  }))
  const { error } = await db.from('transactions').insert(rows)
  if (error) throw new Error('append transactions: ' + error.message)
  const { count } = await db.from('transactions').select('*', { count: 'exact', head: true }).eq('user_id', uid)
  return { appended: rows.length, totalInDb: count }
}

export async function runSeed(db) {
  const { data: usersData, error: usersErr } = await db.auth.admin.listUsers()
  if (usersErr) throw new Error('list users: ' + usersErr.message)
  const users = [...(usersData?.users || [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  )
  if (!users.length) throw new Error('No user found.')
  const uid = users[0].id
  const withUid = (rows) => rows.map((r) => ({ ...r, user_id: uid }))
  const guard = (label, error) => {
    if (error) throw new Error(`${label}: ${error.message}`)
  }

  // NEVER wipe data the user maintains live. Once they have any accounts or
  // balances, this loader is a no-op — it only bootstraps a brand-new, empty
  // account. Balances, accounts, bills, goals, etc. are edited in-app (and by
  // Plaid); the loader must not reset those out from under the user.
  const [acctCheck, balCheck] = await Promise.all([
    db.from('accounts').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    db.from('balance_entries').select('id', { count: 'exact', head: true }).eq('user_id', uid),
  ])
  if ((acctCheck.count || 0) > 0 || (balCheck.count || 0) > 0) {
    return { skipped: true, reason: 'existing user data left untouched' }
  }

  for (const t of [
    'balance_entries', 'budgets', 'recurring_bills', 'income_sources', 'goals',
    'debts', 'phases', 'buckets', 'accounts', 'credit_scores',
    'credit_milestones', 'credit_tasks',
  ]) {
    guard(`clear ${t}`, (await db.from(t).delete().eq('user_id', uid)).error)
  }
  // NOTE: runSeed no longer touches the transactions table. Transactions are
  // the imported bank history (see importTransactions / appendTransactions),
  // so a planning reseed must leave them untouched.

  const { data: accts, error: acctErr } = await db.from('accounts').insert(withUid([
    { name: 'Capital One 360 Checking ...2369', kind: 'spending', sort_order: 1 },
    { name: 'Capital One Performance Savings ...1661', kind: 'savings', sort_order: 2 },
    { name: 'Relay Business Checking ...8282', kind: 'spending', sort_order: 3 },
  ])).select()
  guard('accounts', acctErr)
  const acctId = (frag) => accts.find((a) => a.name.includes(frag)).id

  guard('balances', (await db.from('balance_entries').insert(withUid([
    { account_id: acctId('Checking'), balance: 843.74, as_of: '2026-06-18', note: 'Available (Jun 18, after Verizon paid; BLUETTI still pending)' },
    { account_id: acctId('Performance Savings'), balance: 0.00, as_of: '2026-06-18', note: 'Performance Savings (Jun 18)' },
    { account_id: acctId('Relay'), balance: 3.72, as_of: '2026-06-18', note: 'Relay available (Jun 18)' },
  ]))).error)

  guard('settings', (await db.from('settings').upsert({ user_id: uid, buffer_floor: 200 }, { onConflict: 'user_id' })).error)

  guard('budgets', (await db.from('budgets').insert(withUid([
    { category: 'Food', monthly_limit: 660 },
    { category: 'Gas', monthly_limit: 200 },
    { category: 'Pet', monthly_limit: 150 },
  ]))).error)

  guard('recurring_bills', (await db.from('recurring_bills').insert(withUid([
    { name: 'Storage Leadville (Silver Rush)', amount: 179.00, category: 'Storage', cadence: 'monthly', due_day: 2 },
    { name: 'Storage NY', amount: 100.00, category: 'Storage', cadence: 'monthly', due_day: 18 },
    { name: 'Amazon Prime', amount: 14.99, category: 'Subscriptions', cadence: 'monthly', due_day: 15 },
    { name: 'Progressive Insurance', amount: 112.67, category: 'Insurance', cadence: 'monthly', due_day: 12 },
    // Verizon is on installments now (Jun 18 paid, Jul 2 = $359.69 planned item).
    // The normal ~$280/mo bill resumes after installments — re-add at Aug check-in.
    { name: 'iCloud+ 6TB', amount: 29.99, category: 'Subscriptions', cadence: 'monthly', due_day: 9 },
    { name: 'Squarespace', amount: 25.00, category: 'Subscriptions', cadence: 'monthly', due_day: 1 },
    { name: 'Claude.ai', amount: 20.00, category: 'Subscriptions', cadence: 'monthly', due_day: 9 },
    { name: 'QuickBooks', amount: 19.00, category: 'Business', cadence: 'monthly', due_day: 8 },
    { name: 'Paramount+', amount: 13.99, category: 'Subscriptions', cadence: 'monthly', due_day: 7 },
    { name: 'Spotify', amount: 13.95, category: 'Subscriptions', cadence: 'monthly', due_day: 29 },
    { name: 'Weekly PRO (camera)', amount: 12.95, category: 'Subscriptions', cadence: 'monthly', due_day: 6 },
    { name: 'YouTube Premium', amount: 11.99, category: 'Subscriptions', cadence: 'monthly', due_day: 6 },
    { name: 'AppleCare+', amount: 9.99, category: 'Subscriptions', cadence: 'monthly', due_day: 26 },
    { name: 'Netflix', amount: 8.99, category: 'Subscriptions', cadence: 'monthly', due_day: 28 },
    { name: 'ChatGPT', amount: 8.00, category: 'Subscriptions', cadence: 'monthly', due_day: 28 },
    { name: 'Ground News', amount: 3.99, category: 'Subscriptions', cadence: 'monthly', due_day: 12 },
    { name: 'Lens Buddy', amount: 2.99, category: 'Subscriptions', cadence: 'monthly', due_day: 14 },
    { name: 'Frameo+', amount: 1.99, category: 'Subscriptions', cadence: 'monthly', due_day: 4 },
  ]))).error)

  guard('income_sources', (await db.from('income_sources').insert(withUid([
    { name: 'Summit Mountain Rentals', amount: 1691.55, cadence: 'biweekly', anchor_date: '2026-06-18', due_day: null, confirmed: true },
    { name: 'Mountain Dweller Coffee', amount: 0.00, cadence: 'one_time', anchor_date: null, due_day: null, confirmed: false },
    { name: 'Cloud City Photo', amount: 0.00, cadence: 'one_time', anchor_date: null, due_day: null, confirmed: false },
    { name: 'Other (odd jobs / gifts)', amount: 0.00, cadence: 'one_time', anchor_date: null, due_day: null, confirmed: false },
  ]))).error)

  guard('goals', (await db.from('goals').insert(withUid([
    { name: 'Emergency Fund', target: 4500, current: 0, monthly_contribution: 205, sort_order: 1, status: 'active', target_date: null, note: 'Reduced from $280 to absorb Midland' },
    { name: 'Vehicle Fund', target: 6000, current: 0, monthly_contribution: 0, sort_order: 2, status: 'active', target_date: null, note: 'Side income only — never from W2' },
    { name: 'InDebted payment 1 of 4', target: 61.20, current: 0, monthly_contribution: 0, sort_order: 10, status: 'done', target_date: '2026-06-18', note: 'Afterpay 40% settlement ($244.80 total, saves $163.20). Paid Jun 18.' },
    { name: 'InDebted payment 2 of 4', target: 61.20, current: 0, monthly_contribution: 0, sort_order: 10, status: 'planned', target_date: '2026-07-02', note: 'Afterpay settlement payment 2 of 4.' },
    { name: 'InDebted payment 3 of 4', target: 61.20, current: 0, monthly_contribution: 0, sort_order: 10, status: 'planned', target_date: '2026-07-16', note: 'Afterpay settlement payment 3 of 4.' },
    { name: 'InDebted payment 4 of 4', target: 61.20, current: 0, monthly_contribution: 0, sort_order: 10, status: 'planned', target_date: '2026-07-30', note: 'Afterpay settlement final payment; clears the account.' },
    { name: 'TrueAccord payment 1 of 2', target: 36.07, current: 0, monthly_contribution: 0, sort_order: 10, status: 'done', target_date: '2026-06-18', note: 'Klarna 30% settlement ($72.14 total, saves $30.92). Paid Jun 18.' },
    { name: 'TrueAccord payment 2 of 2', target: 36.07, current: 0, monthly_contribution: 0, sort_order: 10, status: 'planned', target_date: '2026-07-18', note: 'Klarna settlement final payment; clears the account.' },
    { name: 'Verizon installment 2 of 2', target: 359.69, current: 0, monthly_contribution: 0, sort_order: 9, status: 'planned', target_date: '2026-07-02', note: 'Final device installment. Normal $280/mo Verizon resumes after.' },
    { name: 'August Family Trip', target: 800.00, current: 0, monthly_contribution: 0, sort_order: 13, status: 'planned', target_date: '2026-07-30', note: 'Set aside full $800 before departure (Rule 5).' },
    { name: 'Apple Watch Ultra 2 buyout', target: 466.62, current: 0, monthly_contribution: 0, sort_order: 14, status: 'planned', target_date: '2026-07-30', note: 'Pay off Verizon device; resale logged under Other income when it sells.' },
    { name: 'MacBook Neo', target: 699.00, current: 0, monthly_contribution: 0, sort_order: 15, status: 'deferred', target_date: null, note: 'Buy later; $475 trade-in rebate comes back after sending in MacBook Air.' },
    { name: 'iPad Pro 13" M4 buyout', target: 1420.01, current: 0, monthly_contribution: 0, sort_order: 20, status: 'deferred', target_date: null, note: 'Sep+ earliest. Pay off, sell ~$950.' },
    { name: 'EcoFlow Alternator Charger', target: 199.00, current: 0, monthly_contribution: 0, sort_order: 21, status: 'deferred', target_date: null, note: 'Charge while driving. Re-add when ready.' },
  ]))).error)

  // Every row carries the same keys (incl. the NOT NULL is_collection/autopay)
  // so the bulk insert doesn't send NULL for a column missing on some rows.
  guard('debts', (await db.from('debts').insert(withUid([
    { name: 'VentureOne ...0885', balance: 471.70, apr: 28.99, plan_payment: 75.00, min_payment: 75.00, due_day: 16, kind: 'card', active: true, is_collection: false, autopay: false, credit_limit: null, original_creditor: null, settlement_amount: null, plan_end_date: '2026-08-16', activity_charge: 'Streaming services' },
    { name: 'Savor ...5887', balance: 470.42, apr: 28.74, plan_payment: 25.00, min_payment: 25.00, due_day: 9, kind: 'card', active: true, is_collection: false, autopay: false, credit_limit: null, original_creditor: null, settlement_amount: null, plan_end_date: '2026-08-09', activity_charge: 'Car insurance (Progressive)' },
    { name: 'QuicksilverOne ...3678', balance: 1168.82, apr: 28.21, plan_payment: 126.00, min_payment: 126.00, due_day: 1, kind: 'card', active: true, is_collection: false, autopay: false, credit_limit: null, original_creditor: null, settlement_amount: null, plan_end_date: '2026-09-01', activity_charge: 'Verizon bill' },
    { name: 'Friend Loan', balance: 20000.00, apr: 0.00, plan_payment: 750.00, min_payment: 750.00, due_day: 1, start_date: '2026-10-01', kind: 'loan', active: true, is_collection: false, autopay: false, credit_limit: null, original_creditor: null, settlement_amount: null, plan_end_date: null, activity_charge: null },
    { name: 'Midland Credit Management', balance: 1575.08, apr: 0.00, plan_payment: 75.00, min_payment: 75.00, due_day: 2, kind: 'loan', active: true, is_collection: true, autopay: false, credit_limit: null, original_creditor: 'Synchrony Bank', settlement_amount: null, plan_end_date: '2028-03-01', activity_charge: null },
    { name: 'InDebted (Afterpay)', balance: 244.80, apr: 0.00, plan_payment: 0.00, min_payment: 0.00, due_day: null, kind: 'loan', active: true, is_collection: true, autopay: false, credit_limit: null, original_creditor: 'Afterpay', settlement_amount: 244.80, plan_end_date: '2026-07-30', activity_charge: null },
    { name: 'TrueAccord (Klarna)', balance: 72.14, apr: 0.00, plan_payment: 0.00, min_payment: 0.00, due_day: null, kind: 'loan', active: true, is_collection: true, autopay: false, credit_limit: null, original_creditor: 'Klarna', settlement_amount: 72.14, plan_end_date: '2026-07-18', activity_charge: null },
  ]))).error)

  guard('credit_scores', (await db.from('credit_scores').insert(withUid([
    { bureau: 'Experian', score: 434, model: 'FICO 8', source: 'Experian.com', checked_on: '2026-06-16' },
    { bureau: 'TransUnion', score: 403, model: 'VantageScore 3.0', source: 'Credit Karma', checked_on: '2026-06-16' },
    { bureau: 'Equifax', score: 425, model: 'VantageScore 3.0', source: 'Credit Karma', checked_on: '2026-06-16' },
    { bureau: 'Equifax', score: 576, model: 'FICO 8', source: 'Experian.com', checked_on: '2023-07-01' },
    { bureau: 'TransUnion', score: 612, model: 'FICO 8', source: 'Experian.com', checked_on: '2023-07-01' },
  ]))).error)

  guard('credit_milestones', (await db.from('credit_milestones').insert(withUid([
    { name: 'Today (baseline)', target_score: 434, target_date: '2026-06-16', achieved: true, sort_order: 1 },
    { name: 'On-time payments showing', target_score: 480, target_date: '2026-08-01', achieved: false, sort_order: 2 },
    { name: 'Settlements aged, utilization dropping', target_score: 540, target_date: '2026-12-01', achieved: false, sort_order: 3 },
    { name: 'Cards paid off, utilization ~0%', target_score: 600, target_date: '2027-06-01', achieved: false, sort_order: 4 },
    { name: '2+ yrs clean, collections aging off', target_score: 670, target_date: '2028-06-01', achieved: false, sort_order: 5 },
  ]))).error)

  const TASKS = [
    ['Phase 1 — Stop the bleeding', 'Keep all three Capital One plans current — zero missed payments'],
    ['Phase 1 — Stop the bleeding', 'Complete InDebted settlement (4 payments, last Jul 30)'],
    ['Phase 1 — Stop the bleeding', 'Complete TrueAccord settlement (2 payments, last Jul 18)'],
    ['Phase 1 — Stop the bleeding', 'Pull full report at AnnualCreditReport.com — confirm delinquency dates'],
    ['Phase 1 — Stop the bleeding', 'Activate Experian Boost (add Verizon) — free ~10-20 pt bump'],
    ['Phase 1 — Stop the bleeding', 'Do not open any new credit accounts'],
    ['Phase 2 — Reduce utilization', 'CC snowball $278/mo from Sep 2026 (VentureOne → Savor → Platinum Secured)'],
    ['Phase 2 — Reduce utilization', 'Pay each card to $0 (utilization drops on that card)'],
    ['Phase 2 — Reduce utilization', 'When first card hits $0, request a limit increase on another card'],
    ['Phase 2 — Reduce utilization', 'Continue Midland $75/mo on time'],
    ['Phase 3 — Build positive history', 'One card per recurring charge, autopay full balance'],
    ['Phase 3 — Build positive history', 'Assess credit products once score hits ~580'],
    ['Phase 3 — Build positive history', 'Verify Experian Boost includes utility/phone bills'],
    ['Phase 4 — Apartment-ready', 'Target score 620-650 for apartment applications'],
    ['Phase 4 — Apartment-ready', 'Midland finishes ~Q2 2027 — closed in good standing'],
    ['Phase 4 — Apartment-ready', 'Reach 670+ by end of 2028'],
  ]
  guard('credit_tasks', (await db.from('credit_tasks').insert(withUid(
    TASKS.map(([phase, label], i) => ({ phase, label, sort_order: i + 1 }))
  ))).error)

  guard('phases', (await db.from('phases').insert(withUid([
    { name: '1 — Survival', starts_on: '2026-06-01', ends_on: '2026-07-01', allocations: 'Cover bills · EF to $1,000 · cut subscriptions', sort_order: 1 },
    { name: '2 — Build', starts_on: '2026-07-02', ends_on: '2026-09-01', allocations: 'EF to $4,500 ($205/mo) · Friend loan starts Aug $1,000', sort_order: 2 },
    { name: '3 — Snowball', starts_on: '2026-09-02', ends_on: '2027-12-31', allocations: 'CC plans cleared · Friend loan up to $1,200/mo', sort_order: 3 },
    { name: '4 — Accelerate', starts_on: '2028-01-01', ends_on: null, allocations: 'Friend loan paid off · Travel fund $3,000 · investing', sort_order: 4 },
  ]))).error)

  // ---- reconciliation --------------------------------------------------------
  const count = async (t) =>
    (await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count
  const { data: bal } = await db.from('balance_entries').select('balance, account_id').eq('user_id', uid)
  const spendingIds = accts.filter((a) => a.kind === 'spending').map((a) => a.id)
  const totalCash = bal.reduce((s, b) => s + Number(b.balance), 0)
  const spendable = bal.filter((b) => spendingIds.includes(b.account_id)).reduce((s, b) => s + Number(b.balance), 0)
  const { data: billRows } = await db.from('recurring_bills').select('amount').eq('user_id', uid)
  const billsTotal = billRows.reduce((s, b) => s + Number(b.amount), 0)
  const { count: txnWindow } = await db.from('transactions').select('*', { count: 'exact', head: true })
    .eq('user_id', uid).gte('txn_date', '2026-06-14').lte('txn_date', '2026-06-17')

  return {
    user: users[0].email,
    balances: accts.map((a) => ({
      account: a.name,
      balance: Number((bal.find((b) => b.account_id === a.id) || {}).balance || 0),
    })),
    totalCash: Number(totalCash.toFixed(2)),
    spendableCash: Number(spendable.toFixed(2)),
    monthlyFixedBills: Number(billsTotal.toFixed(2)),
    counts: {
      accounts: await count('accounts'),
      recurring_bills: await count('recurring_bills'),
      budgets: await count('budgets'),
      income_sources: await count('income_sources'),
      goals: await count('goals'),
      debts: await count('debts'),
      phases: await count('phases'),
      credit_scores: await count('credit_scores'),
      credit_milestones: await count('credit_milestones'),
      credit_tasks: await count('credit_tasks'),
      transactions_trip_window: txnWindow,
    },
  }
}
