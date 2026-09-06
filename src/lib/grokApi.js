// Shared Grok door: full read + writes. Used by /api/grok and the MCP connector.
import crypto from 'node:crypto'
import { adminClient } from './googleServer.js'
import {
  accountSummaries,
  spendableToday,
  currentBalance,
  debtsAsBills,
  obligationSchedule,
  moneyTotals,
  totalEarmarked,
  totalSetAside,
  goalPaycheckShare,
  everydayHoldback,
  smoothedReserve,
  payPeriodsPerYear,
  mostRecentPaydayIso,
  upcomingBills,
  upcomingIncome,
} from './budget.js'
import { isoDate } from './format.js'

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
  const got = bearer || extra || query
  if (!got) return false
  const a = crypto.createHash('sha256').update(String(got)).digest()
  const b = crypto.createHash('sha256').update(String(secret)).digest()
  return crypto.timingSafeEqual(a, b)
}

function secretOk(request) {
  return grokSecretOk(request)
}

function json(status, body) {
  return Response.json(body, { status })
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k]
  }
  return out
}

async function uidOf(db) {
  const { data, error } = await db.from('settings').select('user_id').limit(1)
  if (error) throw new Error(error.message)
  if (!data?.[0]?.user_id) throw new Error('no user')
  return data[0].user_id
}

async function insert(db, table, uid, row) {
  const { data, error } = await db.from(table).insert({ ...row, user_id: uid }).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function patch(db, table, uid, id, fields) {
  if (!id) return { ok: false, error: 'missing id' }
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

async function remove(db, table, uid, id) {
  if (!id) return { ok: false, error: 'missing id' }
  const { error } = await db.from(table).delete().eq('id', id).eq('user_id', uid)
  if (error) throw new Error(error.message)
  return { ok: true, data: { id, deleted: true } }
}

async function snapshot(db, uid) {
  const today = isoDate()
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
  ] = await Promise.all([
    db.from('accounts').select('id,name,kind,include_in_spendable,mask,institution,sort_order,hidden').eq('user_id', uid).order('sort_order'),
    db.from('balance_entries').select('id,account_id,balance,as_of,note').eq('user_id', uid).order('as_of', { ascending: false }),
    db.from('debts').select('id,name,kind,balance,credit_limit,min_payment,plan_payment,due_day,apr,active,autopay,next_payment_date,original_balance,start_date,smooth').eq('user_id', uid),
    db.from('recurring_bills').select('id,name,amount,due_day,cadence,active,category,start_date,smooth').eq('user_id', uid),
    db.from('goals').select('id,name,target,current,monthly_contribution,status,reserved,target_date,note,sort_order').eq('user_id', uid).order('sort_order'),
    db.from('income_sources').select('id,name,amount,cadence,confirmed,anchor_date,due_day,active').eq('user_id', uid),
    db.from('set_asides').select('id,name,amount,due_date').eq('user_id', uid),
    db.from('settings').select('buffer_floor').eq('user_id', uid).maybeSingle(),
    db.from('transactions').select('id,txn_date,merchant,amount,category,note,account_id,goal_id,income_source').eq('user_id', uid).order('txn_date', { ascending: false }).limit(500),
    db.from('budgets').select('id,category,monthly_limit').eq('user_id', uid),
    db.from('credit_scores').select('id,bureau,score,model,source,checked_on,note').eq('user_id', uid).order('checked_on', { ascending: false }).limit(12),
    db.from('phases').select('id,name,starts_on,ends_on').eq('user_id', uid).order('starts_on'),
    db.from('debt_payments').select('debt_id,paid_on').eq('user_id', uid),
  ])
  const first = [accounts, balances, goals, income, settings].find((r) => r.error)
  if (first?.error) throw new Error(first.error.message)

  let debtRows = debts.data || []
  if (debts.error) {
    const retry = await db.from('debts').select('id,name,kind,balance,credit_limit,min_payment,plan_payment,due_day,apr,active,autopay,next_payment_date,original_balance').eq('user_id', uid)
    if (retry.error) throw new Error(retry.error.message)
    debtRows = retry.data || []
  }
  let billRows = bills.data || []
  if (bills.error) {
    const retry = await db.from('recurring_bills').select('id,name,amount,due_day,cadence,active,category').eq('user_id', uid)
    if (retry.error) throw new Error(retry.error.message)
    billRows = retry.data || []
  }
  const payRows = payments?.error ? [] : payments?.data || []
  const paidByDebt = {}
  for (const p of payRows) {
    ;(paidByDebt[p.debt_id] ||= []).push(p.paid_on)
  }
  const allBills = [...billRows.filter((b) => !b.smooth), ...debtsAsBills(debtRows, goals.data || [])]
  const acctRows = (accounts.data || []).filter((a) => !a.hidden)
  const txnRows = txns.error ? [] : txns.data || []
  const goalRows = goals.data || []
  const incomeRows = income.data || []
  const budgetRows = budgets.error ? [] : budgets.data || []
  const setAsideRows = setAsides.error ? [] : setAsides.data || []

  const sums = accountSummaries(acctRows, balances.data || [])
  const totals = moneyTotals(acctRows, balances.data || [], debtRows)
  const bufferFloor = Number(settings.data?.buffer_floor || 0)
  const latest = currentBalance(balances.data || [])
  const hasAccounts = acctRows.length > 0
  const checkinBal = hasAccounts ? totals.spendableCash : latest ? Number(latest.balance) : 0
  const hasBalance = hasAccounts || !!latest
  const anchorDate = latest?.as_of || today
  const elapsedDays = Math.max(
    0,
    Math.round((new Date(today) - new Date(anchorDate)) / (24 * 60 * 60 * 1000))
  )
  const ppy = payPeriodsPerYear(incomeRows)
  const monthlyVariable = budgetRows.reduce((s, b) => s + Number(b.monthly_limit || 0), 0)
  const billsSince = upcomingBills(allBills, anchorDate, elapsedDays)
    .filter((b) => b.date < today)
    .reduce((s, b) => s + Number(b.amount || 0), 0)
  const assumedSince = elapsedDays * (monthlyVariable / 30) + billsSince
  const startBal = checkinBal - assumedSince
  const earmarked = totalEarmarked(goalRows, txnRows, acctRows)
  const setAside = totalSetAside(setAsideRows)
  const nextPay = upcomingIncome(incomeRows, today, 60, txnRows).find((i) => i.date > today)
  const goalReserve = goalPaycheckShare(goalRows, txnRows, ppy, incomeRows, today, nextPay && nextPay.date).total
  const everyday = everydayHoldback(budgetRows, txnRows, {
    ppy,
    periodStartIso: mostRecentPaydayIso(incomeRows, today),
    today,
  })
  const smoothed = smoothedReserve(billRows, debtRows, ppy, {
    accounts: sums,
    goals: goalRows,
    today,
    incomeSources: incomeRows,
    transactions: txnRows,
  })
  const smoothedForSpend =
    (smoothed.byItem || []).reduce((sum, x) => {
      const n = String(x.id || '').startsWith('debt-')
        ? Number(x.slice || x.perPaycheck || 0)
        : Number(x.perPaycheck || 0)
      return sum + n
    }, 0)
  let spendable = null
  if (hasBalance) {
    try {
      const info = spendableToday(startBal, {
        bills: allBills,
        incomes: incomeRows,
        buckets: [],
        bufferFloor,
        earmarked,
        setAside,
        goalReserve,
        everyday: everyday.total,
        smoothed: smoothedForSpend,
        transactions: txnRows,
        fromIso: today,
        goals: goalRows,
      })
      spendable = info?.spendable ?? null
    } catch {
      spendable = null
    }
  }

  const byId = Object.fromEntries((accounts.data || []).map((a) => [a.id, a]))
  return {
    as_of: today,
    spendable,
    buffer_floor: bufferFloor,
    cash: sums.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      balance: a.balance,
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
        status: sched.status,
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
    recent_transactions: (txns.error ? [] : txns.data || []).map((t) => ({
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
    return json(500, { error: e.message || 'failed' })
  }
}

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
    const row = { ...pick(body, ['name', 'amount', 'category', 'cadence', 'due_day', 'start_date']), active: true }
    row.amount = Number(row.amount)
    const data = await insert(db, 'recurring_bills', uid, row)
    return { ok: true, data }
  }
  if (action === 'update_bill') {
    return patch(db, 'recurring_bills', uid, body.id, pick(body, ['name', 'amount', 'category', 'cadence', 'due_day', 'active', 'start_date']))
  }
  if (action === 'delete_bill') return remove(db, 'recurring_bills', uid, body.id)

  if (action === 'add_income') {
    if (!body.name) return { ok: false, error: 'need name' }
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
