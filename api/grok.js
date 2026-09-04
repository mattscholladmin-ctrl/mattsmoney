// Grok chat reads/updates Budget. Auth is GROK_SECRET (Vercel env).
// GET or POST { action: "snapshot" }
// POST { action: "pause_goal" | "unpause_goal" | "update_card" | "set_buffer", ... }
import crypto from 'node:crypto'
import { adminClient } from '../src/lib/googleServer.js'
import { readBody } from '../src/lib/plaidServer.js'
import { accountSummaries, spendableToday, currentBalance } from '../src/lib/budget.js'
import { isoDate } from '../src/lib/format.js'

function secretOk(req) {
  const secret = process.env.GROK_SECRET
  if (!secret) return false
  const header = req.headers.authorization || req.headers.Authorization || ''
  const got = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.headers['x-grok-secret']
  if (!got) return false
  const a = crypto.createHash('sha256').update(String(got)).digest()
  const b = crypto.createHash('sha256').update(String(secret)).digest()
  return crypto.timingSafeEqual(a, b)
}

async function uidOf(db) {
  const { data, error } = await db.from('settings').select('user_id').limit(1)
  if (error) throw new Error(error.message)
  if (!data?.[0]?.user_id) throw new Error('no user')
  return data[0].user_id
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
  ] = await Promise.all([
    db.from('accounts').select('id,name,kind,include_in_spendable,mask,institution,sort_order').eq('user_id', uid).order('sort_order'),
    db.from('balance_entries').select('id,account_id,balance,as_of,note').eq('user_id', uid).order('as_of', { ascending: false }),
    db.from('debts').select('id,name,kind,balance,credit_limit,min_payment,plan_payment,due_day,apr,active,reserved,autopay,next_payment_date').eq('user_id', uid),
    db.from('recurring_bills').select('id,name,amount,due_day,cadence,active,category').eq('user_id', uid),
    db.from('goals').select('id,name,target,current,monthly_contribution,status,reserved,target_date,sort_order').eq('user_id', uid).order('sort_order'),
    db.from('income_sources').select('id,name,amount,cadence,confirmed,anchor_date,due_day').eq('user_id', uid),
    db.from('set_asides').select('id,name,amount,due_date').eq('user_id', uid),
    db.from('settings').select('buffer_floor').eq('user_id', uid).maybeSingle(),
  ])
  const first = [accounts, balances, debts, bills, goals, income, settings].find((r) => r.error)
  if (first?.error) throw new Error(first.error.message)

  const accts = accounts.data || []
  const bals = balances.data || []
  const sums = accountSummaries(accts, bals)
  const bufferFloor = Number(settings.data?.buffer_floor || 0)
  const latest = currentBalance(bals)
  let spendable = null
  if (latest) {
    try {
      const info = spendableToday(Number(latest.balance), {
        bills: bills.data || [],
        incomes: income.data || [],
        buckets: [],
        bufferFloor,
        transactions: [],
        fromIso: today,
      })
      spendable = info?.spendable ?? null
    } catch {
      spendable = null
    }
  }

  return {
    as_of: today,
    spendable,
    buffer_floor: bufferFloor,
    cash: sums.map((a) => ({
      name: a.name,
      kind: a.kind,
      balance: a.balance,
      as_of: a.asOf,
    })),
    cards: (debts.data || [])
      .filter((d) => d.kind === 'card' && d.active !== false)
      .map((d) => ({
        id: d.id,
        name: d.name,
        balance: Number(d.balance || 0),
        limit: d.credit_limit == null ? null : Number(d.credit_limit),
        min_payment: Number(d.min_payment || 0),
        plan_payment: Number(d.plan_payment || 0),
        due_day: d.due_day,
      })),
    debts: (debts.data || [])
      .filter((d) => d.kind !== 'card' && d.active !== false)
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        balance: Number(d.balance || 0),
        min_payment: Number(d.min_payment || 0),
        due_day: d.due_day,
      })),
    bills: (bills.data || [])
      .filter((b) => b.active !== false)
      .map((b) => ({
        id: b.id,
        name: b.name,
        amount: Number(b.amount || 0),
        due_day: b.due_day,
        cadence: b.cadence,
      })),
    goals: (goals.data || []).map((g) => ({
      id: g.id,
      name: g.name,
      target: Number(g.target || 0),
      current: Number(g.current || 0),
      status: g.status,
      reserved: !!g.reserved,
      target_date: g.target_date,
    })),
    income: (income.data || []).map((i) => ({
      name: i.name,
      amount: Number(i.amount || 0),
      cadence: i.cadence,
      confirmed: !!i.confirmed,
    })),
    set_asides: (setAsides.error ? [] : setAsides.data || []).map((s) => ({
      name: s.name,
      amount: Number(s.amount || 0),
      due_date: s.due_date,
    })),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!process.env.GROK_SECRET) {
    return res.status(503).json({ error: 'grok is not connected yet' })
  }
  if (!secretOk(req)) return res.status(401).json({ error: 'unauthorized' })

  const body = req.method === 'GET' ? { action: 'snapshot' } : await readBody(req)
  const action = body.action || 'snapshot'

  try {
    const db = adminClient()
    const uid = await uidOf(db)

    if (action === 'snapshot') {
      return res.status(200).json(await snapshot(db, uid))
    }

    if (action === 'pause_goal' || action === 'unpause_goal') {
      if (!body.id) return res.status(400).json({ error: 'missing id' })
      const reserved = action === 'unpause_goal'
      const { error } = await db.from('goals').update({ reserved }).eq('id', body.id).eq('user_id', uid)
      if (error) throw new Error(error.message)
      return res.status(200).json({ ok: true, action, id: body.id, reserved })
    }

    if (action === 'update_card') {
      if (!body.id) return res.status(400).json({ error: 'missing id' })
      const fields = {}
      if (body.balance != null) fields.balance = Number(body.balance)
      if (body.credit_limit != null) fields.credit_limit = Number(body.credit_limit)
      if (body.min_payment != null) fields.min_payment = Number(body.min_payment)
      if (body.due_day != null) fields.due_day = Number(body.due_day)
      if (!Object.keys(fields).length) return res.status(400).json({ error: 'nothing to update' })
      const { error } = await db.from('debts').update(fields).eq('id', body.id).eq('user_id', uid)
      if (error) throw new Error(error.message)
      return res.status(200).json({ ok: true, action, id: body.id, fields })
    }

    if (action === 'set_buffer') {
      if (body.buffer_floor == null) return res.status(400).json({ error: 'missing buffer_floor' })
      const { error } = await db
        .from('settings')
        .update({ buffer_floor: Number(body.buffer_floor) })
        .eq('user_id', uid)
      if (error) throw new Error(error.message)
      return res.status(200).json({ ok: true, action, buffer_floor: Number(body.buffer_floor) })
    }

    return res.status(400).json({ error: 'unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed' })
  }
}
