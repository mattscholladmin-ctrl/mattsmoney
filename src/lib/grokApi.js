import { billFields } from './bill-write.js'
import { unpricedBillCosts } from './purchase-check.js'
import { fetchUserRows } from './fetch-user-rows.js'
import { applyPreferences } from './app-preferences.js'
import { computePaycheckPlan } from './paycheck-plan.js'
// Shared Grok door: full read + writes. Used by /api/grok and the MCP connector.
/** @typedef {Record<string, any>} BudgetRecord */
/** @typedef {import('@supabase/supabase-js').SupabaseClient<any>} BudgetDb */
import crypto from 'node:crypto'
import { adminClient } from './googleServer.js'
import { refreshLinkedBanks, localToday } from './plaidServer.js'
import { accountSummaries, obligationSchedule, isBillOccurrencePaid, moneyTotals } from './budget.js'
import { isoDate } from './format.js'

/** @param {Request} request */
export function grokSecretOk(request) {
  const secret = process.env.GROK_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const extra = request.headers.get('x-grok-secret') || ''
  let query = ''
  try {
    query = new URL(request.url).searchParams.get('key') || ''
  } catch {
    query = ''
  }
  const apiKey = request.headers.get('x-api-key') || request.headers.get('api-key') || ''
  const rawAuth = header && !header.startsWith('Bearer ') ? header.trim() : ''
  const got = bearer || extra || query || apiKey || rawAuth
  if (!got) return false
  const a = crypto.createHash('sha256').update(String(got)).digest()
  const b = crypto.createHash('sha256').update(String(secret)).digest()
  return crypto.timingSafeEqual(a, b)
}

/** @param {Request} request */
function secretOk(request) {
  return grokSecretOk(request)
}

/** @param {number} status @param {unknown} body */
function json(status, body) {
  return Response.json(body, { status })
}

/** @param {BudgetRecord} obj @param {string[]} keys @returns {BudgetRecord} */
function pick(obj, keys) {
  /** @type {BudgetRecord} */
  const out = {}
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k]
  }
  return out
}

/** @param {BudgetDb} db */
async function uidOf(db) {
  let query = db.from('settings').select('user_id')
  if (process.env.GROK_OWNER_USER_ID) query = query.eq('user_id', process.env.GROK_OWNER_USER_ID)
  const { data, error } = await query.limit(2)
  if (error) throw new Error(error.message)
  if (!data?.[0]?.user_id) throw new Error('no connector owner configured')
  if (data.length !== 1) throw new Error('Connector owner is ambiguous. Configure GROK_OWNER_USER_ID before using this connection.')
  return data[0].user_id
}

/** @param {BudgetDb} db @param {string} table @param {string} uid @param {BudgetRecord} row */
async function insert(db, table, uid, row) {
  const { data, error } = await db.from(table).insert({ ...row, user_id: uid }).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/** @param {BudgetDb} db @param {string} table @param {string} uid @param {string} id @param {BudgetRecord} fields */
async function patch(db, table, uid, id, fields) {
  if (!id) return { ok: false, error: 'missing id' }
  /** @type {BudgetRecord} */
  const clean = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) clean[k] = v
  }
  if (!Object.keys(clean).length) return { ok: false, error: 'nothing to update' }
  const { data, error } = await db.from(table).update(clean).eq('id', id).eq('user_id', uid).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ok: false, error: 'not found — nothing saved' }
  return { ok: true, data: { id, ...clean } }
}

/** @param {BudgetDb} db @param {string} table @param {string} uid @param {string} id */
async function remove(db, table, uid, id) {
  if (!id) return { ok: false, error: 'missing id' }
  const { data, error } = await db.from(table).delete().eq('id', id).eq('user_id', uid).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return {ok:false,error:'Record not found — nothing deleted'}
  return { ok: true, data: { id, deleted: true } }
}

/** @param {BudgetDb} db @param {string} uid */
async function snapshot(db, uid) {
  const bankSync = await refreshLinkedBanks(uid, db)
  const today = localToday()
  const [
    accounts,
    balances,
    debts,
    bills,
    goals,
    income,
    setAsides,
    settings,
    txns,
    budgets,
    scores,
    phases,
    payments,
    preferences,
    buckets,
  ] = await Promise.all([
    db.from('accounts').select('*').eq('user_id', uid).order('sort_order'),
    fetchUserRows(db, 'balance_entries', uid, 'as_of'),
    db.from('debts').select('*').eq('user_id', uid),
    db.from('recurring_bills').select('*').eq('user_id', uid),
    db.from('goals').select('*').eq('user_id', uid).order('sort_order'),
    db.from('income_sources').select('id,name,amount,cadence,confirmed,anchor_date,due_day,active').eq('user_id', uid),
    db.from('set_asides').select('id,name,amount,due_date').eq('user_id', uid),
    db.from('settings').select('buffer_floor').eq('user_id', uid).maybeSingle(),
    fetchUserRows(db, 'transactions', uid, 'txn_date'),
    db.from('budgets').select('id,category,monthly_limit').eq('user_id', uid),
    db.from('credit_scores').select('id,bureau,score,model,source,checked_on,note').eq('user_id', uid).order('checked_on', { ascending: false }).limit(12),
    db.from('phases').select('id,name,starts_on,ends_on').eq('user_id', uid).order('starts_on'),
    db.from('debt_payments').select('debt_id,paid_on').eq('user_id', uid),
    db.from('app_preferences').select('preferences,revision,updated_at').eq('user_id', uid).maybeSingle(),
    db.from('buckets').select('*').eq('user_id', uid),
  ])
  const first = [accounts, balances, goals, income, settings, txns, budgets, setAsides, preferences, buckets].find((r) => r.error)
  if (first?.error) throw new Error(first.error.message)

  if (debts.error) throw new Error(debts.error.message)
  if (bills.error) throw new Error(bills.error.message)
  /** @type {BudgetRecord[]} */
  const debtRows = debts.data || []
  /** @type {BudgetRecord[]} */
  const billRows = bills.data || []
  const payRows = payments?.error ? [] : payments?.data || []
  /** @type {Record<string,string[]>} */
  const paidByDebt = {}
  for (const p of payRows) {
    ;(paidByDebt[p.debt_id] ||= []).push(p.paid_on)
  }
  /** @type {BudgetRecord[]} */
  const acctRows = (accounts.data || []).filter((a) => !a.hidden)
  // Match Home: every saved transaction is an input to the shared paycheck plan.
  const txnRows = txns.data || []
  /** @type {BudgetRecord[]} */
  const goalRows = goals.data || []
  /** @type {BudgetRecord[]} */
  const incomeRows = income.data || []
  /** @type {BudgetRecord[]} */
  const budgetRows = budgets.error ? [] : budgets.data || []
  /** @type {BudgetRecord[]} */
  const setAsideRows = setAsides.error ? [] : setAsides.data || []

  const sums = accountSummaries(acctRows, balances.data || [])
  const totals = moneyTotals(acctRows, balances.data || [], debtRows)
  const bufferFloor = Number(settings.data?.buffer_floor || 0)
  // Shared with Home: use actual available cash, without invented spending
  // deductions since the last bank sync or re-adding received income.
  const savedPreferences = applyPreferences({}, preferences.data?.preferences || {})
  const plan = computePaycheckPlan({ data: {
    accounts: acctRows, balances: balances.data || [], bills: billRows,
    debts: debtRows, goals: goalRows, income: incomeRows, transactions: txnRows,
    budgets: budgetRows, setAsides: setAsideRows, settings: settings.data, buckets: buckets.data || [],
  }, todayIso: today, state: savedPreferences })
  const spendable = plan.safeToSpend

  const byId = Object.fromEntries((accounts.data || []).map((a) => [a.id, a]))
  return {
    as_of: today,
    bank_sync: bankSync,
    spendable,
    spendable_breakdown: { available_cash: plan.start, bills_due: plan.info.billsBeforePay,
      later_bills: savedPreferences.spreadBills === false ? 0 : plan.info.laterShare, goals: plan.info.goalReserve, debts: plan.debtReserve,
      buffer: plan.info.floor, saved_goals: plan.info.earmarked, set_asides: plan.info.setAside,
      everyday: plan.info.everyday },
    unpriced_costs: unpricedBillCosts(billRows),
    planning_note: 'Uses account-saved planning switches. Unsaved device changes appear after syncing.' + (unpricedBillCosts(billRows).length ? ' Bills marked + tax use base prices; additional tax is not included and estimates are incomplete.' : ''),
    preference_revision: Number(preferences.data?.revision || 0),
    buffer_floor: bufferFloor,
    cash_total: Number(Number(totals.totalCash || 0).toFixed(2)),
    cards_count: debtRows.filter((d) => d.kind === 'card').length,
    cash: sums.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      balance: a.balance,
      current: a.bankCurrent,
      available_missing: !!a.availableMissing,
      as_of: a.asOf,
      include_in_spendable: byId[a.id]?.include_in_spendable !== false,
    })),
    cards: debtRows
      .filter((d) => d.kind === 'card')
      .map((d) => ({
        id: d.id,
        name: d.name,
        balance: Number(d.balance || 0),
        limit: d.credit_limit == null ? null : Number(d.credit_limit),
        min_payment: Number(d.min_payment || 0),
        plan_payment: Number(d.plan_payment || 0),
        due_day: d.due_day,
        apr: d.apr,
        active: d.active !== false,
        autopay: !!d.autopay,
      })),
    debts: debtRows
      .filter((d) => d.kind !== 'card')
      .map((d) => {
        const sched = obligationSchedule(d, today, { paidDates: paidByDebt[d.id] || [] })
        return {
          id: d.id,
          name: d.name,
          kind: d.kind,
          balance: Number(d.balance || 0),
          min_payment: Number(d.min_payment || 0),
          plan_payment: Number(d.plan_payment || 0),
          due_day: d.due_day,
          start_date: d.start_date || null,
          next_due: sched.next_due,
          status: sched.status,
          apr: d.apr,
          active: d.active !== false,
        }
      }),
    bills: billRows.map((b) => {
      const sched = obligationSchedule({ ...b, plan_payment: b.amount }, today)
      const occ = { ...b, billId: b.id, date: sched.next_due, amount: b.amount, name: b.name }
      const paid = sched.next_due && isBillOccurrencePaid(occ, txnRows, today)
      return {
        id: b.id,
        name: b.name,
        amount: Number(b.amount || 0),
        due_day: b.due_day,
        cadence: b.cadence,
        category: b.category,
        active: b.active !== false,
        start_date: b.start_date || null,
        next_due: sched.next_due,
        status: paid ? 'paid' : sched.status,
      }
    }),
    goals: (goals.data || []).map((g) => ({
      id: g.id,
      name: g.name,
      target: Number(g.target || 0),
      current: Number(g.current || 0),
      monthly_contribution: Number(g.monthly_contribution || 0),
      status: g.status,
      reserved: !!g.reserved,
      target_date: g.target_date,
      note: g.note,
    })),
    income: (income.data || []).map((i) => ({
      id: i.id,
      name: i.name,
      amount: Number(i.amount || 0),
      cadence: i.cadence,
      confirmed: !!i.confirmed,
      due_day: i.due_day,
      anchor_date: i.anchor_date,
      active: i.active !== false,
    })),
    set_asides: (setAsides.error ? [] : setAsides.data || []).map((s) => ({
      id: s.id,
      name: s.name,
      amount: Number(s.amount || 0),
      due_date: s.due_date,
    })),
    transaction_count: txnRows.length,
    recent_transactions: txnRows.slice(0, 500).map((t) => ({
      id: t.id,
      date: t.txn_date,
      merchant: t.merchant,
      amount: Number(t.amount || 0),
      category: t.category,
      note: t.note,
      account_id: t.account_id,
    })),
    budgets: (budgets.error ? [] : budgets.data || []).map((b) => ({
      id: b.id,
      category: b.category,
      monthly_limit: Number(b.monthly_limit || 0),
    })),
    credit_scores: (scores.error ? [] : scores.data || []).map((s) => ({
      id: s.id,
      bureau: s.bureau,
      score: s.score,
      model: s.model,
      source: s.source,
      checked_on: s.checked_on,
    })),
    phases: (phases.error ? [] : phases.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      starts_on: p.starts_on,
      ends_on: p.ends_on,
    })),
  }
}

/** @param {Request} request */
export async function handleGrokRequest(request) {
  const method = (request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    return json(405, { error: 'method not allowed' })
  }
  if (!process.env.GROK_SECRET) {
    return json(503, { error: 'grok is not connected yet' })
  }
  if (!secretOk(request)) return json(401, { error: 'unauthorized' })

  let body = { action: 'snapshot' }
  if (method === 'POST') {
    try {
      body = await request.json()
    } catch {
      body = { action: 'snapshot' }
    }
  }

  try {
    const result = await runGrokAction(body)
    if (!result.ok) return json(400, { error: result.error })
    return json(200, result.data)
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'failed' })
  }
}

/** @param {BudgetRecord} [body] @returns {Promise<{ok:boolean,error?:string,data?:any}>} */
export async function runGrokAction(body = {}) {
  const action = body.action || 'snapshot'
  const db = adminClient()
  const uid = await uidOf(db)

  if (action === 'snapshot') return { ok: true, data: await snapshot(db, uid) }

  if (action === 'pause_goal' || action === 'unpause_goal') {
    return patch(db, 'goals', uid, body.id, { reserved: action === 'unpause_goal' })
  }

  if (action === 'log_purchase' || action === 'add_transaction') {
    if (!body.merchant || body.amount == null) return { ok: false, error: 'need merchant and amount' }
    const row = pick(body, ['txn_date', 'merchant', 'amount', 'category', 'note', 'account_id', 'goal_id', 'income_source'])
    row.txn_date = row.txn_date || isoDate()
    row.amount = Number(row.amount)
    const data = await insert(db, 'transactions', uid, row)
    return { ok: true, data }
  }
  if (action === 'update_transaction') {
    return patch(db, 'transactions', uid, body.id, pick(body, ['txn_date', 'merchant', 'amount', 'category', 'note', 'account_id', 'goal_id', 'income_source']))
  }
  if (action === 'delete_transaction') return remove(db, 'transactions', uid, body.id)

  if (action === 'add_bill') {
    if (!body.name || body.amount == null) return { ok: false, error: 'need name and amount' }
    /** @type {BudgetRecord} */
    const row = { ...billFields(pick(body, ['name', 'amount', 'category', 'cadence', 'due_day', 'start_date'])), active: true }
    row.amount = Number(row.amount)
    const data = await insert(db, 'recurring_bills', uid, row)
    return { ok: true, data }
  }
  if (action === 'update_bill') {
    return patch(db, 'recurring_bills', uid, body.id, billFields(pick(body, ['name', 'amount', 'category', 'cadence', 'due_day', 'active', 'start_date'])))
  }
  if (action === 'delete_bill') return remove(db, 'recurring_bills', uid, body.id)

  if (action === 'add_income') {
    if (!body.name) return { ok: false, error: 'need name' }
    /** @type {BudgetRecord} */
    const row = { ...pick(body, ['name', 'amount', 'cadence', 'anchor_date', 'due_day', 'confirmed']), active: true }
    if (row.amount != null) row.amount = Number(row.amount)
    const data = await insert(db, 'income_sources', uid, row)
    return { ok: true, data }
  }
  if (action === 'update_income') {
    return patch(db, 'income_sources', uid, body.id, pick(body, ['name', 'amount', 'cadence', 'anchor_date', 'due_day', 'confirmed', 'active']))
  }
  if (action === 'delete_income') return remove(db, 'income_sources', uid, body.id)

  if (action === 'add_account') {
    if (!body.name) return { ok: false, error: 'need name' }
    const data = await insert(db, 'accounts', uid, pick(body, ['name', 'kind', 'include_in_spendable', 'sort_order']))
    return { ok: true, data }
  }
  if (action === 'update_account') {
    return patch(db, 'accounts', uid, body.id, pick(body, ['name', 'kind', 'include_in_spendable', 'hidden']))
  }
  if (action === 'delete_account') return remove(db, 'accounts', uid, body.id)

  if (action === 'set_account_balance') {
    if (!body.account_id || body.balance == null) return { ok: false, error: 'need account_id and balance' }
    const data = await insert(db, 'balance_entries', uid, {
      account_id: body.account_id,
      balance: Number(body.balance),
      as_of: body.as_of || isoDate(),
      note: body.note || 'Grok',
    })
    return { ok: true, data }
  }

  if (action === 'add_goal') {
    if (!body.name || body.target == null) return { ok: false, error: 'need name and target' }
    const row = pick(body, ['name', 'target', 'current', 'monthly_contribution', 'note', 'target_date', 'status'])
    row.current = Number(row.current || 0)
    row.target = Number(row.target)
    const data = await insert(db, 'goals', uid, row)
    return { ok: true, data }
  }
  if (action === 'update_goal') {
    return patch(db, 'goals', uid, body.id, pick(body, ['name', 'target', 'current', 'monthly_contribution', 'note', 'target_date', 'status', 'reserved']))
  }
  if (action === 'delete_goal') return remove(db, 'goals', uid, body.id)

  if (action === 'add_debt' || action === 'add_card') {
    if (!body.name) return { ok: false, error: 'need name' }
    const row = pick(body, ['name', 'balance', 'apr', 'plan_payment', 'min_payment', 'due_day', 'kind', 'original_balance', 'credit_limit', 'next_payment_date', 'start_date'])
    row.kind = row.kind || (action === 'add_card' ? 'card' : 'loan')
    row.active = true
    const data = await insert(db, 'debts', uid, row)
    return { ok: true, data }
  }
  if (action === 'update_card' || action === 'update_debt') {
    return patch(
      db,
      'debts',
      uid,
      body.id,
      pick(body, ['name', 'balance', 'apr', 'plan_payment', 'min_payment', 'due_day', 'kind', 'credit_limit', 'autopay', 'active', 'next_payment_date', 'start_date'])
    )
  }
  if (action === 'delete_debt' || action === 'delete_card') return remove(db, 'debts', uid, body.id)

  if (action === 'add_set_aside') {
    if (!body.name || body.amount == null) return { ok: false, error: 'need name and amount' }
    const data = await insert(db, 'set_asides', uid, pick(body, ['name', 'amount', 'due_date']))
    return { ok: true, data }
  }
  if (action === 'remove_set_aside') return remove(db, 'set_asides', uid, body.id)

  if (action === 'set_buffer') {
    if (body.buffer_floor == null) return { ok: false, error: 'missing buffer_floor' }
    const { error } = await db.from('settings').update({ buffer_floor: Number(body.buffer_floor) }).eq('user_id', uid)
    if (error) throw new Error(error.message)
    return { ok: true, data: { action, buffer_floor: Number(body.buffer_floor) } }
  }

  if (action === 'set_budget') {
    if (!body.category || body.monthly_limit == null) return { ok: false, error: 'need category and monthly_limit' }
    const { error } = await db
      .from('budgets')
      .upsert({ user_id: uid, category: body.category, monthly_limit: Number(body.monthly_limit) }, { onConflict: 'user_id,category' })
    if (error) throw new Error(error.message)
    return { ok: true, data: { category: body.category, monthly_limit: Number(body.monthly_limit) } }
  }
  if (action === 'delete_budget') return remove(db, 'budgets', uid, body.id)

  if (action === 'add_credit_score') {
    if (!body.bureau || body.score == null) return { ok: false, error: 'need bureau and score' }
    const data = await insert(db, 'credit_scores', uid, pick(body, ['bureau', 'score', 'model', 'source', 'checked_on', 'note']))
    return { ok: true, data }
  }
  if (action === 'delete_credit_score') return remove(db, 'credit_scores', uid, body.id)

  return { ok: false, error: 'unknown action' }
}
