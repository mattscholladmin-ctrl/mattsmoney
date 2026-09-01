// @ts-nocheck
import { supabase } from './supabase'

// All tables use Postgres Row Level Security keyed to the logged-in user, and
// user_id defaults to auth.uid(), so inserts below don't pass user_id manually.

// Hosted Supabase caps a single select at ~1000 rows with no error, so an
// unbounded fetch silently drops the oldest rows once you cross that — and every
// total, goal-spent, and long-range insight would quietly undercount. Page
// through in 1000-row chunks.
//
// The first page also asks for the exact total row count in the same round
// trip, so every remaining page can fire in parallel instead of waiting on
// each other one at a time — for a few-thousand-row transaction history
// that's the difference between ~1 round trip and ~3 sequential ones. If the
// count ever comes back unavailable for some reason, this falls back to the
// original "keep going until a short page" sequential loop — slower, but
// still fully correct (never silently drops rows).
async function fetchAllRows(table, orderCol, opts = {}) {
  const PAGE = 1000
  const first = await supabase
    .from(table)
    .select('*', { count: 'exact' })
    .order(orderCol, opts)
    .range(0, PAGE - 1)
  if (first.error) return { data: [], error: first.error }
  const all = [...(first.data || [])]
  const total = first.count

  if (total != null) {
    if (all.length < PAGE || total <= all.length) return { data: all, error: null }
    const pages = []
    for (let from = PAGE; from < total; from += PAGE) {
      pages.push(supabase.from(table).select('*').order(orderCol, opts).range(from, from + PAGE - 1))
    }
    const results = await Promise.all(pages)
    for (const r of results) {
      if (r.error) return { data: all, error: r.error }
      all.push(...(r.data || []))
    }
    return { data: all, error: null }
  }

  // Fallback: count wasn't available — page sequentially, as before.
  if (all.length < PAGE) return { data: all, error: null }
  for (let from = PAGE; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderCol, opts)
      .range(from, from + PAGE - 1)
    if (error) return { data: all, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: all, error: null }
}

export async function fetchAll() {
  const [
    balances,
    transactions,
    bills,
    budgets,
    settings,
    income,
    goals,
    debts,
    phases,
    buckets,
    accounts,
    creditScores,
    creditMilestones,
    creditTasks,
    setAsides,
    debtPayments,
    categoryAliases,
  ] = await Promise.all([
    supabase
      .from('balance_entries')
      .select('*')
      .order('as_of', { ascending: false }),
    fetchAllRows('transactions', 'txn_date', { ascending: false }),
    supabase.from('recurring_bills').select('*').order('due_day'),
    supabase.from('budgets').select('*').order('category'),
    supabase.from('settings').select('*').limit(1).maybeSingle(),
    supabase.from('income_sources').select('*').order('created_at'),
    supabase.from('goals').select('*').order('sort_order'),
    supabase.from('debts').select('*').order('balance', { ascending: false }),
    supabase.from('phases').select('*').order('starts_on'),
    supabase.from('buckets').select('*').order('event_date'),
    supabase.from('accounts').select('*').order('sort_order'),
    supabase.from('credit_scores').select('*').order('checked_on', { ascending: true }),
    supabase.from('credit_milestones').select('*').order('sort_order'),
    supabase.from('credit_tasks').select('*').order('sort_order'),
    supabase.from('set_asides').select('*').order('created_at'),
    supabase.from('debt_payments').select('*').order('paid_on', { ascending: false }),
    supabase.from('category_aliases').select('from_name, to_name'),
  ])

  const firstError =
    balances.error ||
    transactions.error ||
    bills.error ||
    budgets.error ||
    settings.error ||
    income.error ||
    goals.error ||
    debts.error ||
    phases.error ||
    buckets.error
  if (firstError) throw firstError

  return {
    balances: balances.data || [],
    transactions: transactions.data || [],
    bills: bills.data || [],
    budgets: budgets.data || [],
    settings: settings.data || null,
    income: income.data || [],
    goals: goals.data || [],
    debts: debts.data || [],
    phases: phases.data || [],
    buckets: buckets.data || [],
    // accounts table may not exist yet (added in a later migration) — tolerate it.
    accounts: accounts.error ? [] : accounts.data || [],
    // credit tables are added by credit.sql — tolerate them being absent.
    creditScores: creditScores.error ? [] : creditScores.data || [],
    creditMilestones: creditMilestones.error ? [] : creditMilestones.data || [],
    creditTasks: creditTasks.error ? [] : creditTasks.data || [],
    // set_asides table is added by set_asides.sql — tolerate it being absent.
    setAsides: setAsides.error ? [] : setAsides.data || [],
    // debt_payments table is added by debt_payments.sql — tolerate it being absent.
    debtPayments: debtPayments.error ? [] : debtPayments.data || [],
    // category_aliases table is added by category_aliases.sql — tolerate it absent.
    categoryAliases: categoryAliases.error ? [] : categoryAliases.data || [],
  }
}

// A "money set aside" hold: cash you already have, fenced off from safe-to-spend
// for a known near-term expense. due_date is optional.
export async function addSetAside({ name, amount, due_date }) {
  const { error } = await supabase
    .from('set_asides')
    .insert({ name, amount: Number(amount) || 0, due_date: due_date || null })
  if (error) throw error
}

export async function removeSetAside(id) {
  const { error } = await supabase.from('set_asides').delete().eq('id', id)
  if (error) throw error
}

export async function addBalanceEntry({ account_id, balance, as_of, note }) {
  const { error } = await supabase
    .from('balance_entries')
    .insert({ account_id: account_id || null, balance, as_of, note: note || null })
  if (error) throw error
}

// Move a manual account's balance by `delta`, reading the LIVE latest balance
// first (never a stale client snapshot) so two quick cash entries — or an edit
// racing another — can't clobber each other into a wrong balance.
export async function adjustAccountBalance(accountId, delta, { as_of, note } = {}) {
  const { data, error: readErr } = await supabase
    .from('balance_entries')
    .select('balance')
    .eq('account_id', accountId)
    .order('as_of', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readErr) throw readErr
  const next = Number((Number(data?.balance || 0) + Number(delta || 0)).toFixed(2))
  const { error } = await supabase.from('balance_entries').insert({
    account_id: accountId,
    balance: next,
    as_of: as_of || new Date().toISOString().slice(0, 10),
    note: note || 'Adjustment',
  })
  if (error) throw error
}

// ---- Accounts ---------------------------------------------------------------
export async function addAccount({ name, kind, sort_order, include_in_spendable }) {
  // manual: true marks it as intentionally hand-added so the connection cleanup
  // never removes it.
  const row = { name, kind: kind || 'spending', sort_order: sort_order ?? 0, manual: true }
  if (include_in_spendable !== undefined) row.include_in_spendable = include_in_spendable
  const { error } = await supabase.from('accounts').insert(row)
  if (error) throw error
}

export async function updateAccount(id, { name, kind, include_in_spendable, hidden }) {
  const fields = {}
  if (name !== undefined) fields.name = name
  if (kind !== undefined) fields.kind = kind || 'spending'
  if (include_in_spendable !== undefined) fields.include_in_spendable = include_in_spendable
  if (hidden !== undefined) fields.hidden = hidden
  const { error } = await supabase.from('accounts').update(fields).eq('id', id)
  if (error) throw error
}

// Persist a new display order for the accounts (index = sort_order).
export async function setAccountOrder(ids = []) {
  const results = await Promise.all(
    ids.map((id, i) =>
      supabase.from('accounts').update({ sort_order: i + 1 }).eq('id', id)
    )
  )
  const failed = results.find((r) => r.error)
  if (failed) throw failed.error
}

export async function deleteAccount(id) {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw error
}

export async function addTransaction({ txn_date, merchant, amount, category, note, goal_id, income_source, account_id, bucket_goal_id }) {
  const row = { txn_date, merchant, amount, category, note: note || null }
  // Only include optional links when set, so this still works before their
  // column migrations have been run.
  if (goal_id) row.goal_id = goal_id
  if (income_source) row.income_source = income_source
  if (account_id) row.account_id = account_id
  if (bucket_goal_id) row.bucket_goal_id = bucket_goal_id
  let { error } = await supabase.from('transactions').insert(row)
  // account_id / bucket_goal_id columns not migrated yet? drop them and retry so
  // the transaction still saves (the balance/bucket side effects still run).
  if (error && isMissingAccountIdColumn(error)) {
    delete row.account_id
    delete row.bucket_goal_id
    ;({ error } = await supabase.from('transactions').insert(row))
  }
  if (error) throw error
}

export async function updateTransaction(id, { txn_date, merchant, amount, category, note, goal_id, income_source }) {
  const fields = {}
  if (txn_date !== undefined) fields.txn_date = txn_date
  if (merchant !== undefined) fields.merchant = merchant
  if (amount !== undefined) fields.amount = amount
  if (category !== undefined) fields.category = category
  if (note !== undefined) fields.note = note || null
  // '' clears the link; an id sets it; undefined leaves it untouched.
  if (goal_id !== undefined) fields.goal_id = goal_id || null
  // '' clears the tag; a name sets it; undefined leaves it untouched.
  if (income_source !== undefined) fields.income_source = income_source || null
  const { error } = await supabase.from('transactions').update(fields).eq('id', id)
  if (error) throw error
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

// Apply many category changes at once (used by auto-categorize). Each update is
// { id, to }. Runs them in parallel and throws on the first failure.
export async function setTransactionCategories(updates = []) {
  const results = await Promise.all(
    updates.map(({ id, to }) =>
      supabase.from('transactions').update({ category: to }).eq('id', id)
    )
  )
  const failed = results.find((r) => r.error)
  if (failed) throw failed.error
}

// Tag many deposits with an income source at once (auto-spread of a manual
// tag across the same depositor). Never overwrites an existing tag — callers
// pass only untagged rows.
export async function setIncomeSources(ids = [], source) {
  if (!ids.length) return
  const { error } = await supabase
    .from('transactions')
    .update({ income_source: source || null })
    .in('id', ids)
    .is('income_source', null)
  if (error) throw error
}

// The `smooth` column is added by smooth_bills_debts.sql — tolerate it not being
// there yet so saving still works before the migration is pasted.
function isMissingColumn(error) {
  return error?.code === '42703' || /column .* does not exist|could not find the .* column|schema cache/i.test(error?.message || '')
}

export async function addBill({ name, amount, category, cadence, due_day, smooth }) {
  const row = { name, amount, category, cadence, due_day, active: true }
  if (smooth !== undefined) row.smooth = smooth
  let { error } = await supabase.from('recurring_bills').insert(row)
  if (error && smooth !== undefined && isMissingColumn(error)) {
    delete row.smooth
    ;({ error } = await supabase.from('recurring_bills').insert(row))
  }
  if (error) throw error
}

export async function updateBill(id, { name, amount, category, cadence, due_day, smooth }) {
  const fields = { name, amount, category, cadence, due_day }
  if (smooth !== undefined) fields.smooth = smooth
  let { error } = await supabase.from('recurring_bills').update(fields).eq('id', id)
  if (error && smooth !== undefined && isMissingColumn(error)) {
    delete fields.smooth
    ;({ error } = await supabase.from('recurring_bills').update(fields).eq('id', id))
  }
  if (error) throw error
}

export async function deleteBill(id) {
  const { error } = await supabase.from('recurring_bills').delete().eq('id', id)
  if (error) throw error
}

// Toggle "save each paycheck" (smoothing) on a bill or a debt. Tolerant of the
// column not being migrated yet — the toggle just won't persist until the SQL is
// pasted (same as setGoalReserved).
async function setSmooth(table, id, smooth) {
  // Turning it ON stamps the date so the sinking-fund starts building from now (not
  // retroactively). Tolerant of smooth_since not being migrated yet: fall back to
  // just the flag, then to nothing (the toggle simply won't persist until the SQL
  // is pasted, same as setGoalReserved).
  const patch = { smooth }
  if (smooth) patch.smooth_since = new Date().toISOString().slice(0, 10)
  let { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error && isMissingColumn(error)) {
    ;({ error } = await supabase.from(table).update({ smooth }).eq('id', id))
  }
  if (error && !isMissingColumn(error)) throw error
}
export async function setBillSmooth(id, smooth) {
  return setSmooth('recurring_bills', id, smooth)
}
export async function setDebtSmooth(id, smooth) {
  return setSmooth('debts', id, smooth)
}

// Mark a debt Active or Inactive. An Inactive debt drops out of your bills, forecast,
// safe-to-spend, and payoff plan (the math already skips active === false) but stays
// listed so you don't lose track of it. The `active` column already exists (addDebt
// sets it on every insert), so no migration is needed.
export async function setDebtActive(id, active) {
  const { error } = await supabase.from('debts').update({ active }).eq('id', id)
  if (error) throw error
}

// Record that money was physically moved into savings for a smoothed item. Bumps its
// running "saved so far" AND moves the cash — out of checking, into savings — so
// Safe-to-spend nets to zero: the money left the spendable pool and the reserve
// releases it by the same amount. BOTH legs always move together, so the hold can
// never drop without the cash actually leaving. `dir` = 1 to move in, -1 to undo.
export async function moveToSmoothing({ table, id, amount, currentSaved = 0, fromAccountId, toAccountId, itemName = '', dir = 1 }) {
  const amt = Number(amount) || 0
  if (amt <= 0) return
  // Record the claim FIRST. If the smooth_saved column isn't migrated yet we must
  // NOT move the cash — otherwise checking would drop with no matching release and
  // Safe to spend would fall twice. Signal the caller to run the DB update first.
  const nextSaved = Number(Math.max(0, Number(currentSaved || 0) + dir * amt).toFixed(2))
  const { error } = await supabase.from(table).update({ smooth_saved: nextSaved }).eq('id', id)
  if (error) {
    if (isMissingColumn(error)) {
      const e = new Error('needs-migration')
      e.code = 'needs-migration'
      throw e
    }
    throw error
  }
  const note = dir > 0 ? `Set aside${itemName ? ' · ' + itemName : ''}` : `Undo set aside${itemName ? ' · ' + itemName : ''}`
  if (fromAccountId) await adjustAccountBalance(fromAccountId, -dir * amt, { note })
  if (toAccountId) await adjustAccountBalance(toAccountId, dir * amt, { note })
}

export async function upsertBudget({ category, monthly_limit }) {
  const { error } = await supabase
    .from('budgets')
    .upsert({ category, monthly_limit }, { onConflict: 'user_id,category' })
  if (error) throw error
}

export async function deleteBudget(id) {
  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) throw error
}

// Rename a budget's category in place (macro-level, from Insights). Just changes the
// budget's category name so it lines up with whatever spending category you point it
// at — no transaction hunting.
export async function renameBudget(id, category) {
  const { error } = await supabase.from('budgets').update({ category }).eq('id', id)
  if (error) throw error
}

// Bulk-set the category on a list of transactions (used when renaming a whole
// category so all the spending under it follows). Chunked so a big category can't
// blow past query limits.
export async function setTransactionsCategory(ids = [], category) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    if (!chunk.length) continue
    const { error } = await supabase.from('transactions').update({ category }).in('id', chunk)
    if (error) throw error
  }
}

// Record a PERMANENT category rename (from_name → to_name) so it applies to every
// transaction going forward, including brand-new merchants. Tolerant of the
// category_aliases table not being pasted yet (the rename still re-tags existing
// spending; it just won't auto-apply to future new merchants until the SQL is run).
export async function upsertCategoryAlias(from_name, to_name) {
  const from = String(from_name || '').trim().toLowerCase()
  const to = String(to_name || '').trim()
  if (!from || !to) return
  const { error } = await supabase
    .from('category_aliases')
    .upsert({ from_name: from, to_name: to }, { onConflict: 'user_id,from_name' })
  if (error && error.code !== '42P01' && error.code !== 'PGRST205' && !/relation .* does not exist|could not find the table/i.test(error.message || '')) {
    throw error
  }
}

export async function saveSettings({ buffer_floor }) {
  // One settings row per user (user_id is unique). Upsert keeps it singular.
  const { error } = await supabase
    .from('settings')
    .upsert({ buffer_floor }, { onConflict: 'user_id' })
  if (error) throw error
}

// ---- Notifications ----------------------------------------------------------
export async function saveNotificationPrefs(prefs) {
  // Notification toggles live on the single settings row per user.
  const { error } = await supabase
    .from('settings')
    .upsert(prefs, { onConflict: 'user_id' })
  if (error) throw error
}

export async function addPushSubscription({ endpoint, p256dh, auth }) {
  // One row per device endpoint; upsert so re-enabling doesn't duplicate.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh, auth }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function removePushSubscription(endpoint) {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
  if (error) throw error
}

// ---- Income sources ---------------------------------------------------------
export async function addIncome({ name, amount, cadence, anchor_date, due_day, confirmed }) {
  const { error } = await supabase.from('income_sources').insert({
    name,
    amount,
    cadence,
    anchor_date: anchor_date || null,
    due_day: due_day ?? null,
    confirmed: confirmed ?? true,
    active: true,
  })
  if (error) throw error
}

export async function updateIncome(id, { name, amount, cadence, anchor_date, due_day, confirmed }) {
  // Grab the old name first so we can re-tag its transactions if it's renamed —
  // otherwise "received by source" lists the same payer twice.
  const { data: prev } = await supabase.from('income_sources').select('name').eq('id', id).maybeSingle()
  const { error } = await supabase
    .from('income_sources')
    .update({
      name,
      amount,
      cadence,
      anchor_date: anchor_date || null,
      due_day: due_day ?? null,
      confirmed: confirmed ?? true,
    })
    .eq('id', id)
  if (error) throw error
  if (prev?.name && name && prev.name !== name) {
    await supabase.from('transactions').update({ income_source: name }).eq('income_source', prev.name)
  }
}

export async function deleteIncome(id) {
  // Clear this source's tag off its transactions first, so no deposit points at a
  // deleted source (which would show a phantom "received" row).
  const { data: prev } = await supabase.from('income_sources').select('name').eq('id', id).maybeSingle()
  if (prev?.name) {
    await supabase.from('transactions').update({ income_source: null }).eq('income_source', prev.name)
  }
  const { error } = await supabase.from('income_sources').delete().eq('id', id)
  if (error) throw error
}

// ---- Savings goals ----------------------------------------------------------
// Only retry-without-account_id when the column genuinely isn't there yet — NOT
// for a real FK/constraint failure (which mentions account_id but must surface).
function isMissingAccountIdColumn(e) {
  return !!e && (e.code === '42703' || /column .*account_id.* does not exist/i.test(e.message || '') || /schema cache/i.test(e.message || ''))
}

export async function addGoal({ name, target, current, monthly_contribution, note, target_date, status, account_id }) {
  const row = {
    name,
    target,
    current: current ?? 0,
    monthly_contribution: monthly_contribution ?? 0,
    note: note || null,
    target_date: target_date || null,
    status: status || 'active',
    // A brand-new dated goal is eligible for its per-paycheck hold-out from the
    // moment it exists — stamp today so it starts building at your NEXT paycheck,
    // never backdated to before this goal existed.
    ...(target_date ? { pace_since: new Date().toISOString().slice(0, 10) } : {}),
  }
  if (account_id !== undefined) row.account_id = account_id || null
  let { error } = await supabase.from('goals').insert(row)
  if (error && isMissingAccountIdColumn(error)) {
    delete row.pace_since
    if (account_id !== undefined) delete row.account_id
    ;({ error } = await supabase.from('goals').insert(row))
  }
  if (error) throw error
}

export async function updateGoalCurrent(id, current) {
  const { error } = await supabase.from('goals').update({ current }).eq('id', id)
  if (error) throw error
}

// Toggle whether a dated goal's per-paycheck pace is reserved out of safe-to-spend
// (true) or left as a "Someday" target (false). Tolerates the column not being
// migrated yet — the toggle just won't persist until goal_reserved.sql is run.
// Pass pace_since when flipping to reserved so the hold-out starts building from
// your next paycheck, not backdated to whenever the goal was first created.
export async function setGoalReserved(id, reserved, { pace_since } = {}) {
  const fields = { reserved }
  if (pace_since !== undefined) fields.pace_since = pace_since
  let { error } = await supabase.from('goals').update(fields).eq('id', id)
  if (error && pace_since !== undefined && isMissingAccountIdColumn(error)) {
    delete fields.pace_since
    ;({ error } = await supabase.from('goals').update(fields).eq('id', id))
  }
  if (error && !isMissingAccountIdColumn(error)) throw error
}

// Add to a goal's saved amount based on the LIVE value in the DB (not a stale
// client snapshot), so two deposits in quick succession can't clobber each other.
export async function incrementGoalCurrent(id, delta, noteEntry) {
  const { data, error: readErr } = await supabase
    .from('goals')
    .select('current, note')
    .eq('id', id)
    .maybeSingle()
  if (readErr) throw readErr
  if (!data) return // goal was deleted — nothing to fill, don't throw
  const update = { current: Number(data.current || 0) + Number(delta || 0) }
  if (noteEntry) update.note = data.note ? `${data.note} · ${noteEntry}` : noteEntry
  const { error } = await supabase.from('goals').update(update).eq('id', id)
  if (error) throw error
}

// Subtract a payment from a debt's balance using the LIVE value in the DB (never
// a stale client snapshot), clamped at 0, so two quick payments — or a payment
// racing a bank sync — can't clobber each other into a wrong balance.
export async function decrementDebtBalance(id, delta) {
  const { data, error: readErr } = await supabase
    .from('debts')
    .select('balance')
    .eq('id', id)
    .maybeSingle()
  if (readErr) throw readErr
  if (!data) return
  const next = Math.max(0, Number(data.balance || 0) - Number(delta || 0))
  const { error } = await supabase.from('debts').update({ balance: next }).eq('id', id)
  if (error) throw error
}

function isMissingDebtPaymentsTable(error) {
  // ONLY the genuine "relation absent / not in the schema cache" signals — never
  // the bare table name, or a real RLS / FK / NOT NULL / check-constraint failure
  // (whose message also contains "debt_payments") would be silently swallowed and
  // lower the balance without ever saving the payment.
  const code = error?.code
  const msg = error?.message || ''
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    /could not find the table .*debt_payments|relation .*debt_payments.* does not exist/i.test(msg)
  )
}

// A logged debt payment: a dated record (today or backdated) that lowers the
// debt's balance and shows in a history under the debt. For a bank-linked debt
// the bank owns the balance, so we record the payment but don't touch it (the
// sync will reflect it) — pass bankLinked so the balance isn't double-counted.
export async function addDebtPayment({ debt_id, amount, paid_on, note, bankLinked }) {
  let amt = Number(amount) || 0
  // For a manual debt, never record more than actually comes off the balance
  // (which clamps at 0). Otherwise an over-payment stores the full amount but the
  // balance only drops to 0 — and deleting it later would restore more than was
  // subtracted, inflating the balance above where it started.
  if (!bankLinked) {
    const { data } = await supabase.from('debts').select('balance').eq('id', debt_id).maybeSingle()
    if (data) amt = Math.min(amt, Math.max(0, Number(data.balance || 0)))
  }
  const row = {
    debt_id,
    amount: amt,
    paid_on: paid_on || new Date().toISOString().slice(0, 10),
    note: note || null,
  }
  const { error } = await supabase.from('debt_payments').insert(row)
  // debt_payments table not created yet? Still lower the balance so logging a
  // payment works — the dated history just won't persist until the SQL is run.
  if (error && !isMissingDebtPaymentsTable(error)) throw error
  if (!bankLinked) await decrementDebtBalance(debt_id, amt)
}

// Remove a logged payment and (for a manual debt) add its amount back to the
// balance, so a mistaken entry fully reverses.
export async function deleteDebtPayment(id, { bankLinked } = {}) {
  const { data: p, error: readErr } = await supabase
    .from('debt_payments')
    .select('debt_id,amount')
    .eq('id', id)
    .maybeSingle()
  if (readErr) throw readErr
  const { error } = await supabase.from('debt_payments').delete().eq('id', id)
  if (error) throw error
  if (p && !bankLinked) await decrementDebtBalance(p.debt_id, -Number(p.amount || 0))
}

export async function updateGoal(id, { name, target, current, monthly_contribution, note, target_date, status, account_id, pace_since }) {
  // Only write fields that are actually provided — so a caller that omits
  // `current` (because the user didn't touch it) can't clobber a deposit that
  // landed in the meantime.
  const fields = {}
  if (name !== undefined) fields.name = name
  if (target !== undefined) fields.target = target
  if (current !== undefined) fields.current = current
  if (monthly_contribution !== undefined) fields.monthly_contribution = monthly_contribution
  if (note !== undefined) fields.note = note || null
  if (target_date !== undefined) fields.target_date = target_date || null
  if (status !== undefined) fields.status = status || 'active'
  if (account_id !== undefined) fields.account_id = account_id || null
  // Passed by the caller only when this save just made the goal newly eligible
  // for its per-paycheck hold-out (e.g. reopened, or a date was just added) — so
  // the hold-out starts building from your next paycheck, not backdated.
  if (pace_since !== undefined) fields.pace_since = pace_since
  let { error } = await supabase.from('goals').update(fields).eq('id', id)
  // account_id / pace_since column not migrated yet? drop the optional ones and
  // retry so the save still lands.
  if (error && isMissingAccountIdColumn(error)) {
    delete fields.account_id
    delete fields.pace_since
    ;({ error } = await supabase.from('goals').update(fields).eq('id', id))
  }
  if (error) throw error
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw error
}

// ---- Debts (credit cards + loan) -------------------------------------------
export async function addDebt({ name, balance, apr, plan_payment, min_payment, due_day, kind, original_balance, pay_frequency, next_payment_date }) {
  const row = {
    name,
    balance,
    apr: apr ?? 0,
    plan_payment: plan_payment ?? 0,
    min_payment: min_payment ?? 0,
    due_day: due_day ?? null,
    kind: kind || 'card',
    // The Credit tab's Collections tile filters on this flag specifically —
    // picking "Collections" as the type has to actually set it, or the debt
    // silently never shows up there.
    is_collection: kind === 'collection',
    active: true,
  }
  // Optional so it still works before the original_balance column migration.
  if (original_balance != null && original_balance !== '')
    row.original_balance = Number(original_balance)
  if (pay_frequency) row.pay_frequency = pay_frequency
  if (next_payment_date) row.next_payment_date = next_payment_date
  let { error } = await supabase.from('debts').insert(row)
  // pay_frequency / next_payment_date / is_collection not migrated yet? drop
  // and retry.
  if (error && isMissingAccountIdColumn(error)) {
    delete row.pay_frequency
    delete row.next_payment_date
    delete row.is_collection
    ;({ error } = await supabase.from('debts').insert(row))
  }
  if (error) throw error
}

export async function updateDebtBalance(id, balance) {
  const { error } = await supabase.from('debts').update({ balance }).eq('id', id)
  if (error) throw error
}

// Credit-specific fields on a debt (card limit, autopay, assigned charge).
export async function updateDebtCredit(id, { credit_limit, activity_charge, autopay }) {
  const fields = {}
  if (credit_limit !== undefined) fields.credit_limit = credit_limit === '' ? null : credit_limit
  if (activity_charge !== undefined) fields.activity_charge = activity_charge || null
  if (autopay !== undefined) fields.autopay = autopay
  const { error } = await supabase.from('debts').update(fields).eq('id', id)
  if (error) throw error
}

// ---- Credit recovery (scores, milestones, action tasks) --------------------
export async function addCreditScore({ bureau, score, model, source, checked_on, note }) {
  const { error } = await supabase.from('credit_scores').insert({
    bureau,
    score,
    model: model || 'FICO 8',
    source: source || null,
    checked_on: checked_on || new Date().toISOString().slice(0, 10),
    note: note || null,
  })
  if (error) throw error
}

export async function deleteCreditScore(id) {
  const { error } = await supabase.from('credit_scores').delete().eq('id', id)
  if (error) throw error
}

export async function toggleMilestone(id, achieved) {
  const { error } = await supabase
    .from('credit_milestones')
    .update({ achieved, achieved_on: achieved ? new Date().toISOString().slice(0, 10) : null })
    .eq('id', id)
  if (error) throw error
}

export async function toggleCreditTask(id, done) {
  const { error } = await supabase.from('credit_tasks').update({ done }).eq('id', id)
  if (error) throw error
}

export async function updateDebt(id, { name, balance, apr, plan_payment, min_payment, due_day, kind, original_balance, pay_frequency, next_payment_date }) {
  const fields = {
    name,
    apr: apr ?? 0,
    plan_payment: plan_payment ?? 0,
    min_payment: min_payment ?? 0,
    due_day: due_day ?? null,
    kind: kind || 'card',
    // Keep in sync with the type picker — see addDebt's comment.
    is_collection: kind === 'collection',
  }
  // Only write balance when provided — a bank-linked debt's balance is owned by
  // the sync, so its editor omits it rather than reverting a fresh value.
  if (balance !== undefined) fields.balance = balance
  if (original_balance !== undefined)
    fields.original_balance = original_balance === '' ? null : Number(original_balance)
  if (pay_frequency !== undefined) fields.pay_frequency = pay_frequency
  if (next_payment_date !== undefined) fields.next_payment_date = next_payment_date || null
  let { error } = await supabase.from('debts').update(fields).eq('id', id)
  // pay_frequency / next_payment_date / is_collection columns not migrated
  // yet? drop and retry.
  if (error && isMissingAccountIdColumn(error)) {
    delete fields.pay_frequency
    delete fields.next_payment_date
    delete fields.is_collection
    ;({ error } = await supabase.from('debts').update(fields).eq('id', id))
  }
  if (error) throw error
}

export async function deleteDebt(id) {
  const { error } = await supabase.from('debts').delete().eq('id', id)
  if (error) throw error
}

// ---- Phases -----------------------------------------------------------------
export async function addPhase({ name, starts_on, ends_on, allocations, sort_order }) {
  const { error } = await supabase.from('phases').insert({
    name,
    starts_on,
    ends_on: ends_on || null,
    allocations: allocations || null,
    sort_order: sort_order ?? 0,
  })
  if (error) throw error
}

export async function updatePhase(id, { name, starts_on, ends_on, allocations }) {
  const { error } = await supabase
    .from('phases')
    .update({
      name,
      starts_on,
      ends_on: ends_on || null,
      allocations: allocations || null,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deletePhase(id) {
  const { error } = await supabase.from('phases').delete().eq('id', id)
  if (error) throw error
}

// ---- Trip / event funds (buckets) ------------------------------------------
export async function addBucket({ name, target, current, event_date, note }) {
  const { error } = await supabase.from('buckets').insert({
    name,
    target: target ?? 0,
    current: current ?? 0,
    event_date: event_date || null,
    note: note || null,
  })
  if (error) throw error
}

export async function updateBucketCurrent(id, current) {
  const { error } = await supabase.from('buckets').update({ current }).eq('id', id)
  if (error) throw error
}

export async function deleteBucket(id) {
  const { error } = await supabase.from('buckets').delete().eq('id', id)
  if (error) throw error
}
