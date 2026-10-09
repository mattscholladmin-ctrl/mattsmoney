// @ts-nocheck
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import { adminClient } from './googleServer.js'
import { normalizeMerchant, isPendingPostedTwin } from './budget.js'

export function plaidClient() {
  const env = process.env.PLAID_ENV || 'sandbox'
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID, 'PLAID-SECRET': process.env.PLAID_SECRET } },
  })
  return new PlaidApi(config)
}
export function plaidError(e) { return e?.response?.data?.error_message || e?.message || 'plaid request failed' }
export function localToday() {
  const tz = process.env.USER_TIMEZONE || 'America/Denver'
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}
export async function saveItem(uid, fields, db = adminClient()) {
  const { error } = await db.from('plaid_items').upsert({ user_id: uid, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'item_id' })
  if (error) throw new Error(error.message)
}
export async function listItems(uid, db = adminClient()) {
  const { data, error } = await db.from('plaid_items').select('*').eq('user_id', uid)
  if (error) throw new Error(error.message)
  return data || []
}
export async function rawPlaidBalances(db = adminClient()) {
  const client = plaidClient()
  const { data: items } = await db.from('plaid_items').select('*')
  const today = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const out = []
  for (const item of items || []) {
    try {
      let itemError = null, itemUpdated = null
      try {
        const it = await client.itemGet({ access_token: item.access_token })
        itemError = it.data.item?.error?.error_code || null
        itemUpdated = it.data.status?.last_successful_update || it.data.status?.transactions?.last_successful_update || null
      } catch (e) { itemError = plaidError(e) }
      out.push({ _item: item.institution_name, itemError, itemUpdated })
      const acc = await client.accountsBalanceGet({ access_token: item.access_token, options: { min_last_updated_datetime: new Date(Date.now() - 60000).toISOString() } })
      const pendingByAcct = {}
      try {
        const tx = await client.transactionsGet({ access_token: item.access_token, start_date: start, end_date: today, options: { count: 500 } })
        for (const t of tx.data.transactions) if (t.pending) pendingByAcct[t.account_id] = (pendingByAcct[t.account_id] || 0) + Number(t.amount || 0)
      } catch {}
      for (const a of acc.data.accounts) out.push({ institution: item.institution_name, name: a.name, mask: a.mask, subtype: a.subtype, available: a.balances.available, current: a.balances.current, balanceUpdated: a.balances.last_updated_datetime || null, pendingSum: Math.round((pendingByAcct[a.account_id] || 0) * 100) / 100 })
    } catch (e) { out.push({ institution: item.institution_name, error: plaidError(e) }) }
  }
  return out
}
const SAVINGS_SUBTYPES = ['savings', 'cd', 'money market', 'hsa']
async function findOrCreateAccount(db, uid, item, a, institution) {
  const mask = a.mask || ''
  const { data: linked } = await db.from('accounts').select('id').eq('user_id', uid).eq('plaid_account_id', a.account_id).maybeSingle()
  if (linked) return linked.id
  if (mask) {
    const { data: manual } = await db.from('accounts').select('id').eq('user_id', uid).is('plaid_account_id', null).ilike('name', `%${mask}%`).limit(1)
    if (manual && manual.length) {
      await db.from('accounts').update({ plaid_account_id: a.account_id, plaid_item_id: item.item_id, mask, institution }).eq('id', manual[0].id)
      return manual[0].id
    }
  }
  const kind = SAVINGS_SUBTYPES.includes(a.subtype) ? 'savings' : 'spending'
  const bank = String(institution || '').trim()
  const rawName = String(a.name || '').trim()
  const name = bank && rawName.toLowerCase().startsWith(bank.toLowerCase()) ? rawName : `${bank} ${rawName}`.trim()
  const { data: ins, error } = await db.from('accounts').insert({ user_id: uid, name, kind, plaid_account_id: a.account_id, plaid_item_id: item.item_id, mask, institution, sort_order: 100 }).select('id').single()
  if (error) throw new Error(error.message)
  return ins.id
}
async function upsertDebt(db, uid, item, a) {
  const owed = a.balances.current ?? 0
  const { data: linked } = await db.from('debts').select('id').eq('user_id', uid).eq('plaid_account_id', a.account_id).maybeSingle()
  if (linked) { await db.from('debts').update({ balance: owed }).eq('id', linked.id); return }
  const mask = a.mask || ''
  if (mask) {
    const { data: manual } = await db.from('debts').select('id').eq('user_id', uid).is('plaid_account_id', null).ilike('name', `%${mask}%`).limit(1)
    if (manual && manual.length) { await db.from('debts').update({ balance: owed, plaid_account_id: a.account_id, plaid_item_id: item.item_id }).eq('id', manual[0].id); return }
  }
  await db.from('debts').insert({ user_id: uid, name: a.name, balance: owed, kind: a.type === 'loan' ? 'loan' : 'card', plaid_account_id: a.account_id, plaid_item_id: item.item_id })
}
export async function syncItemAccounts(uid, item, db = adminClient()) {
  const client = plaidClient()
  const lastSync = item.updated_at ? new Date(item.updated_at).getTime() : 0
  const forceLive = Date.now() - lastSync > 10 * 60 * 1000
  let acc
  try {
    acc = forceLive ? await client.accountsBalanceGet({ access_token: item.access_token, options: { min_last_updated_datetime: new Date(Date.now() - 60 * 1000).toISOString() } }) : await client.accountsBalanceGet({ access_token: item.access_token })
  } catch { acc = await client.accountsBalanceGet({ access_token: item.access_token }) }
  const today = localToday()
  const institution = item.institution_name || ''
  const needsAvailable = acc.data.accounts.some((a) => a.type === 'depository' && a.balances && a.balances.available == null)
  if (needsAvailable) {
    try {
      const snap = await client.accountsGet({ access_token: item.access_token })
      const byId = {}
      for (const s of snap.data.accounts) byId[s.account_id] = s
      for (const a of acc.data.accounts) {
        const fromSnap = byId[a.account_id]
        if (a.balances && a.balances.available == null && fromSnap?.balances?.available != null) a.balances.available = fromSnap.balances.available
      }
    } catch {}
  }
  let depository = 0, credit = 0
  for (const a of acc.data.accounts) {
    if (a.type === 'depository') {
      const id = await findOrCreateAccount(db, uid, item, a, institution)
      const current = a.balances.current
      const available = a.balances.available
      const missing = available == null
      const cash = missing ? null : Number(available)
      let note = missing ? 'Auto-synced · available missing' : 'Auto-synced · available'
      if (current != null) note += ` · current $${Number(current).toFixed(2)}`
      const { data: prev } = await db.from('balance_entries').select('id,balance,as_of,note').eq('account_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const prevBal = prev && prev.balance != null && prev.balance !== '' ? Number(prev.balance) : null
      const same = prev && prev.as_of === today && (prev.note || '') === note && prevBal === cash
      if (!same) {
        const inserted = await db.from('balance_entries').insert({ user_id: uid, account_id: id, balance: cash, as_of: today, note }).select('id').single()
        if (!inserted.error && inserted.data?.id) await db.from('balance_entries').delete().eq('account_id', id).eq('as_of', today).neq('id', inserted.data.id)
      }
      depository++
    } else if (a.type === 'credit' || a.type === 'loan') { await upsertDebt(db, uid, item, a); credit++ }
  }
  await db.from('plaid_items').update({ updated_at: new Date().toISOString() }).eq('item_id', item.item_id).eq('user_id', uid)
  return { depository, credit }
}
export async function cleanupUnlinkedAccounts(uid, db = adminClient()) {
  await db.from('accounts').delete().eq('user_id', uid).is('plaid_account_id', null).neq('manual', true)
}
export async function syncItemTransactions(uid, item, db = adminClient()) {
  const client = plaidClient()
  let cursor = item.cursor || null, added = [], modified = [], removed = [], hasMore = true
  try {
    while (hasMore) {
      const r = await client.transactionsSync({ access_token: item.access_token, cursor: cursor || undefined })
      added = added.concat(r.data.added); modified = modified.concat(r.data.modified); removed = removed.concat(r.data.removed)
      hasMore = r.data.has_more; cursor = r.data.next_cursor
    }
  } catch (e) { return { added: 0, ready: false } }
  const ups = [...added, ...modified]
  if (ups.length) {
    const ids = ups.map((t) => t.transaction_id)
    const pendingIds = ups.map((t) => t.pending_transaction_id).filter(Boolean)
    const { data: existing } = await db.from('transactions').select('plaid_transaction_id').in('plaid_transaction_id', ids)
    const have = new Set((existing || []).map((e) => e.plaid_transaction_id))
    let pendingHave = new Set()
    if (pendingIds.length) {
      const { data: pendingRows } = await db.from('transactions').select('plaid_transaction_id').in('plaid_transaction_id', pendingIds)
      pendingHave = new Set((pendingRows || []).map((e) => e.plaid_transaction_id))
    }
    const promote = ups.filter((t) => t.pending_transaction_id && pendingHave.has(t.pending_transaction_id))
    for (const t of promote) {
      const patch = { plaid_transaction_id: t.transaction_id, txn_date: t.authorized_date || t.date, amount: t.amount, pending: !!t.pending }
      let { error } = await db.from('transactions').update(patch).eq('plaid_transaction_id', t.pending_transaction_id).eq('user_id', uid)
      if (error && /pending/.test(error.message || '')) {
        const { pending, ...rest } = patch
        ;({ error } = await db.from('transactions').update(rest).eq('plaid_transaction_id', t.pending_transaction_id).eq('user_id', uid))
      }
      if (error) throw new Error(error.message)
      have.add(t.transaction_id)
    }
    const tagByMerchant = {}
    try {
      const { data: tagged } = await db.from('transactions').select('merchant,income_source').eq('user_id', uid).not('income_source', 'is', null).lt('amount', 0).order('created_at', { ascending: false }).limit(500)
      for (const t of tagged || []) { const key = normalizeMerchant(t.merchant); if (key && !tagByMerchant[key]) tagByMerchant[key] = t.income_source }
    } catch {}
    const rows = ups.filter((t) => !have.has(t.transaction_id)).map((t) => {
      const merchant = t.merchant_name || t.name || 'Transaction'
      const row = { user_id: uid, txn_date: t.authorized_date || t.date, merchant, amount: t.amount, category: t.personal_finance_category?.primary || (t.category && t.category[0]) || null, source: 'plaid', plaid_transaction_id: t.transaction_id, plaid_item_id: item.item_id, pending: !!t.pending }
      if (Number(t.amount) < 0) { const learned = tagByMerchant[normalizeMerchant(merchant)]; if (learned) row.income_source = learned }
      return row
    })
    if (rows.length) {
      let { error } = await db.from('transactions').insert(rows)
      if (error && /pending/.test(error.message || '')) ({ error } = await db.from('transactions').insert(rows.map(({ pending, ...r }) => r)))
      if (error) throw new Error(error.message)
    }
    const updates = ups.filter((t) => have.has(t.transaction_id))
    for (const t of updates) {
      const patch = { txn_date: t.authorized_date || t.date, amount: t.amount, pending: !!t.pending }
      let { error } = await db.from('transactions').update(patch).eq('plaid_transaction_id', t.transaction_id).eq('user_id', uid)
      if (error && /pending/.test(error.message || '')) { const { pending, ...rest } = patch; ({ error } = await db.from('transactions').update(rest).eq('plaid_transaction_id', t.transaction_id).eq('user_id', uid)) }
      if (error) throw new Error(error.message)
    }
  }
  if (removed.length) await db.from('transactions').delete().in('plaid_transaction_id', removed.map((t) => t.transaction_id))
  await collapsePostedTwins(uid, db)
  await db.from('plaid_items').update({ cursor }).eq('item_id', item.item_id).eq('user_id', uid)
  return { added: added.length, ready: true }
}

function familyName(a, b) {
  const na = normalizeMerchant(a)
  const nb = normalizeMerchant(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  const wa = na.split(' ').filter((w) => w.length > 2)
  const wb = nb.split(' ').filter((w) => w.length > 2)
  if (!wa.length || !wb.length) return false
  return wa.every((w) => wb.includes(w)) || wb.every((w) => wa.includes(w))
}

function preferRow(a, b) {
  if (Boolean(a.pending) !== Boolean(b.pending)) return a.pending ? b : a
  const aBills = String(a.category || '').toLowerCase() === 'bills' || /paid:/.test(String(a.note || ''))
  const bBills = String(b.category || '').toLowerCase() === 'bills' || /paid:/.test(String(b.note || ''))
  if (aBills !== bBills) return aBills ? a : b
  return a
}

async function collapsePostedTwins(uid, db) {
  const { data: rows } = await db.from('transactions').select('id,merchant,amount,txn_date,pending,category,note').eq('user_id', uid).order('txn_date', { ascending: false }).limit(400)
  const list = rows || []
  const drop = []
  const used = new Set()
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (used.has(a.id)) continue
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]
      if (used.has(b.id)) continue
      if (Number(a.amount || 0).toFixed(2) !== Number(b.amount || 0).toFixed(2)) continue
      const da = Date.parse(a.txn_date)
      const dbv = Date.parse(b.txn_date)
      if (!Number.isFinite(da) || !Number.isFinite(dbv) || Math.abs(da - dbv) > 5 * 86400000) continue
      if (!familyName(a.merchant, b.merchant)) continue
      if (!isPendingPostedTwin(a, b)) continue
      const keep = preferRow(a, b)
      const loser = keep === a ? b : a
      drop.push(loser.id)
      used.add(loser.id)
    }
  }
  if (drop.length) await db.from('transactions').delete().in('id', drop)
}
export async function alignBillAmountsFromCharges(uid, db = adminClient()) {
  const { data: bills } = await db.from('recurring_bills').select('id,name,amount,active').eq('user_id', uid)
  const { data: txns } = await db.from('transactions').select('merchant,amount,txn_date').eq('user_id', uid).order('txn_date', { ascending: false }).limit(300)
  for (const b of bills || []) {
    if (b.active === false) continue
    const bill = String(b.name || '').toLowerCase()
    if (!/\bnetflix\b/.test(bill)) continue
    const hit = (txns || []).find((t) => Number(t.amount || 0) > 0 && /\bnetflix\b/.test(String(t.merchant || '').toLowerCase()))
    if (!hit) continue
    const amt = Number(hit.amount)
    if (Math.abs(amt - Number(b.amount || 0)) < 0.01) continue
    await db.from('recurring_bills').update({ amount: amt }).eq('id', b.id).eq('user_id', uid)
  }
}
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
}
export async function refreshLinkedBanks(uid, db = adminClient()) {
  try {
    const items = await listItems(uid, db)
    for (const it of items) { try { await syncItemAccounts(uid, it, db); await syncItemTransactions(uid, it, db) } catch {} }
    return { ok: true, items: items.length }
  } catch { return { ok: false, items: 0 } }
}
