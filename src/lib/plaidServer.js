// @ts-nocheck
// Server-side Plaid helpers (run inside Vercel functions only — they use the
// secret key). Mirrors the Google integration's service-role pattern.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import { adminClient } from './googleServer.js'
import { normalizeMerchant } from './budget.js'

export function plaidClient() {
  const env = process.env.PLAID_ENV || 'sandbox'
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
  return new PlaidApi(config)
}

// Pull a human message out of a Plaid SDK error (they nest it in response.data).
export function plaidError(e) {
  return e?.response?.data?.error_message || e?.message || 'plaid request failed'
}

// "Today" in the user's timezone. Vercel runs in UTC, so an evening sync would
// otherwise stamp tomorrow's date on balances and look like time travel.
export function localToday() {
  const tz = process.env.USER_TIMEZONE || 'America/Denver'
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

export async function saveItem(uid, fields, db = adminClient()) {
  const { error } = await db
    .from('plaid_items')
    .upsert(
      { user_id: uid, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'item_id' }
    )
  if (error) throw new Error(error.message)
}

export async function listItems(uid, db = adminClient()) {
  const { data, error } = await db
    .from('plaid_items')
    .select('*')
    .eq('user_id', uid)
  if (error) throw new Error(error.message)
  return data || []
}

// Diagnostics: pull the RAW live balances Plaid is sharing per account, plus the
// sum of pending charges from the last 30 days — so we can see exactly what a
// bank (e.g. Capital One) does and doesn't expose.
export async function rawPlaidBalances(db = adminClient()) {
  const client = plaidClient()
  const { data: items } = await db.from('plaid_items').select('*')
  const today = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const out = []
  for (const item of items || []) {
    try {
      // Item status tells us if the connection is broken / needs re-auth.
      let itemError = null
      let itemUpdated = null
      try {
        const it = await client.itemGet({ access_token: item.access_token })
        itemError = it.data.item?.error?.error_code || null
        itemUpdated = it.data.status?.last_successful_update || it.data.status?.transactions?.last_successful_update || null
      } catch (e) {
        itemError = plaidError(e)
      }
      out.push({ _item: item.institution_name, itemError, itemUpdated })
      const acc = await client.accountsBalanceGet({
        access_token: item.access_token,
        options: { min_last_updated_datetime: new Date(Date.now() - 60000).toISOString() },
      })
      const pendingByAcct = {}
      try {
        const tx = await client.transactionsGet({
          access_token: item.access_token,
          start_date: start,
          end_date: today,
          options: { count: 500 },
        })
        for (const t of tx.data.transactions) {
          if (t.pending) pendingByAcct[t.account_id] = (pendingByAcct[t.account_id] || 0) + Number(t.amount || 0)
        }
      } catch { /* transactions not ready */ }
      for (const a of acc.data.accounts) {
        out.push({
          institution: item.institution_name,
          name: a.name,
          mask: a.mask,
          subtype: a.subtype,
          available: a.balances.available,
          current: a.balances.current,
          balanceUpdated: a.balances.last_updated_datetime || null,
          pendingSum: Math.round((pendingByAcct[a.account_id] || 0) * 100) / 100,
        })
      }
    } catch (e) {
      out.push({ institution: item.institution_name, error: plaidError(e) })
    }
  }
  return out
}

const SAVINGS_SUBTYPES = ['savings', 'cd', 'money market', 'hsa']

// Find the app account linked to this Plaid account; if none, ADOPT a manual
// account whose name contains the same last-4 (so we don't duplicate what the
// user already typed in); otherwise create a fresh one. Returns the account id.
async function findOrCreateAccount(db, uid, item, a, institution) {
  const mask = a.mask || ''
  const { data: linked } = await db
    .from('accounts')
    .select('id')
    .eq('user_id', uid)
    .eq('plaid_account_id', a.account_id)
    .maybeSingle()
  if (linked) return linked.id

  if (mask) {
    const { data: manual } = await db
      .from('accounts')
      .select('id')
      .eq('user_id', uid)
      .is('plaid_account_id', null)
      .ilike('name', `%${mask}%`)
      .limit(1)
    if (manual && manual.length) {
      await db
        .from('accounts')
        .update({ plaid_account_id: a.account_id, plaid_item_id: item.item_id, mask, institution })
        .eq('id', manual[0].id)
      return manual[0].id
    }
  }

  const kind = SAVINGS_SUBTYPES.includes(a.subtype) ? 'savings' : 'spending'
  const name = `${institution} ${a.name}`.trim()
  const { data: ins, error } = await db
    .from('accounts')
    .insert({
      user_id: uid,
      name,
      kind,
      plaid_account_id: a.account_id,
      plaid_item_id: item.item_id,
      mask,
      institution,
      sort_order: 100,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return ins.id
}

async function upsertDebt(db, uid, item, a) {
  const owed = a.balances.current ?? 0
  const { data: linked } = await db
    .from('debts')
    .select('id')
    .eq('user_id', uid)
    .eq('plaid_account_id', a.account_id)
    .maybeSingle()
  if (linked) {
    await db.from('debts').update({ balance: owed }).eq('id', linked.id)
    return
  }
  const mask = a.mask || ''
  if (mask) {
    const { data: manual } = await db
      .from('debts')
      .select('id')
      .eq('user_id', uid)
      .is('plaid_account_id', null)
      .ilike('name', `%${mask}%`)
      .limit(1)
    if (manual && manual.length) {
      await db
        .from('debts')
        .update({ balance: owed, plaid_account_id: a.account_id, plaid_item_id: item.item_id })
        .eq('id', manual[0].id)
      return
    }
  }
  await db.from('debts').insert({
    user_id: uid,
    name: a.name,
    balance: owed,
    kind: a.type === 'loan' ? 'loan' : 'card',
    plaid_account_id: a.account_id,
    plaid_item_id: item.item_id,
  })
}

// Pull live balances for one connected item and write them into the app's real
// accounts (as a fresh balance entry) and debts. Idempotent per account.
export async function syncItemAccounts(uid, item, db = adminClient()) {
  const client = plaidClient()
  // Force a TRUE real-time fetch from the bank at most every 10 minutes —
  // banks rate-limit forced pulls (we've hit 429s), and hammering them on
  // every app open makes syncs silently fail. Between forced pulls, Plaid's
  // recent snapshot is plenty fresh. If the forced call fails anyway, fall
  // back to the snapshot — an older number beats silently keeping yesterday's.
  const lastSync = item.updated_at ? new Date(item.updated_at).getTime() : 0
  const forceLive = Date.now() - lastSync > 10 * 60 * 1000
  let acc
  try {
    acc = forceLive
      ? await client.accountsBalanceGet({
          access_token: item.access_token,
          options: {
            min_last_updated_datetime: new Date(Date.now() - 60 * 1000).toISOString(),
          },
        })
      : await client.accountsBalanceGet({ access_token: item.access_token })
  } catch {
    acc = await client.accountsBalanceGet({ access_token: item.access_token })
  }
  const today = localToday()
  const institution = item.institution_name || ''

  // Some banks (Capital One) don't send an `available` balance — only `current`
  // (the ledger). To match what you actually see, compute available ourselves:
  // current minus pending (authorized-but-not-posted) charges, per account. This
  // is what other finance apps do. Plaid `amount` is positive for outflows.
  const pendingByAccount = {}
  try {
    const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const tx = await client.transactionsGet({
      access_token: item.access_token,
      start_date: start,
      end_date: today,
      options: { count: 500 },
    })
    for (const t of tx.data.transactions) {
      if (t.pending) {
        pendingByAccount[t.account_id] =
          (pendingByAccount[t.account_id] || 0) + Number(t.amount || 0)
      }
    }
  } catch {
    /* transactions not ready yet — fall back to current with no adjustment */
  }

  let depository = 0
  let credit = 0
  for (const a of acc.data.accounts) {
    if (a.type === 'depository') {
      const id = await findOrCreateAccount(db, uid, item, a, institution)
      // Use the bank's available balance when it shares one (SoFi). When it
      // doesn't (Capital One only sends `current`), use current minus any
      // pending charges — `current` IS the real, updating balance there.
      const current = a.balances.current ?? 0
      const pending = pendingByAccount[a.account_id] || 0
      const spendable =
        a.balances.available != null ? a.balances.available : current - pending
      // Carry the bank's headline number + pending in the note so the app can
      // show "in bank $X · pending $Y" — the number the user sees in their
      // bank's own app — next to the usable balance. (No schema change needed.)
      let note = 'Auto-synced'
      if (Math.abs(current - (spendable ?? 0)) >= 0.01) {
        note += ` · in bank $${current.toFixed(2)}`
        if (pending > 0) note += ` · pending $${pending.toFixed(2)}`
        else if (a.balances.available != null)
          note += ` · pending $${(current - a.balances.available).toFixed(2)}`
      }
      // Only write a new entry when something actually changed — otherwise
      // every app-open piles up identical rows (hundreds a month of junk).
      const { data: prev } = await db
        .from('balance_entries')
        .select('balance,as_of,note')
        .eq('account_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const unchanged =
        prev &&
        Number(prev.balance) === Number(spendable ?? 0) &&
        prev.as_of === today &&
        (prev.note || '') === note
      if (!unchanged) {
        await db.from('balance_entries').insert({
          user_id: uid,
          account_id: id,
          balance: spendable ?? 0,
          as_of: today,
          note,
        })
      }
      depository++
    } else if (a.type === 'credit' || a.type === 'loan') {
      await upsertDebt(db, uid, item, a)
      credit++
    }
  }
  await db
    .from('plaid_items')
    .update({ updated_at: new Date().toISOString() })
    .eq('item_id', item.item_id)
    .eq('user_id', uid)
  return { depository, credit }
}

// Connected accounts are the source of truth: drop legacy bank accounts that
// aren't linked to a connection and weren't intentionally hand-added (manual).
// Debts (credit cards) are never auto-removed — those stay manual.
export async function cleanupUnlinkedAccounts(uid, db = adminClient()) {
  await db
    .from('accounts')
    .delete()
    .eq('user_id', uid)
    .is('plaid_account_id', null)
    .neq('manual', true)
}

// Pull this item's transactions incrementally (cursor-based) and write them into
// the app's transactions, deduped by Plaid's transaction id. Plaid `amount` is
// positive for money leaving the account — same sign the app uses for spend.
export async function syncItemTransactions(uid, item, db = adminClient()) {
  const client = plaidClient()
  let cursor = item.cursor || null
  let added = []
  let modified = []
  let removed = []
  let hasMore = true
  try {
    while (hasMore) {
      const r = await client.transactionsSync({
        access_token: item.access_token,
        cursor: cursor || undefined,
      })
      added = added.concat(r.data.added)
      modified = modified.concat(r.data.modified)
      removed = removed.concat(r.data.removed)
      hasMore = r.data.has_more
      cursor = r.data.next_cursor
    }
  } catch (e) {
    // First sync right after connecting often returns PRODUCT_NOT_READY; the
    // next refresh will pick them up. Don't treat as fatal.
    return { added: 0, ready: false }
  }

  const ups = [...added, ...modified]
  if (ups.length) {
    const ids = ups.map((t) => t.transaction_id)
    const { data: existing } = await db
      .from('transactions')
      .select('plaid_transaction_id')
      .in('plaid_transaction_id', ids)
    const have = new Set((existing || []).map((e) => e.plaid_transaction_id))
    // Learned income tags: once the user tags a deposit from a depositor
    // (e.g. their payroll or Mountain Dweller), every future deposit from
    // that same depositor tags itself. Manual tags always win — this only
    // fills brand-new rows.
    const tagByMerchant = {}
    try {
      const { data: tagged } = await db
        .from('transactions')
        .select('merchant,income_source')
        .eq('user_id', uid)
        .not('income_source', 'is', null)
        .lt('amount', 0)
        .order('created_at', { ascending: false })
        .limit(500)
      for (const t of tagged || []) {
        const key = normalizeMerchant(t.merchant)
        if (key && !tagByMerchant[key]) tagByMerchant[key] = t.income_source
      }
    } catch {
      /* income_source column not migrated yet — skip learning */
    }
    const rows = ups
      .filter((t) => !have.has(t.transaction_id))
      .map((t) => {
        const merchant = t.merchant_name || t.name || 'Transaction'
        const row = {
          user_id: uid,
          // authorized_date = the day you actually made the purchase; t.date is
          // the day it posted/cleared (often 1–3 days later). Prefer the former
          // so dates reflect when you spent, not when the bank settled it.
          txn_date: t.authorized_date || t.date,
          merchant,
          amount: t.amount,
          category:
            t.personal_finance_category?.primary ||
            (t.category && t.category[0]) ||
            null,
          source: 'plaid',
          plaid_transaction_id: t.transaction_id,
          plaid_item_id: item.item_id,
          pending: !!t.pending,
        }
        if (Number(t.amount) < 0) {
          const learned = tagByMerchant[normalizeMerchant(merchant)]
          if (learned) row.income_source = learned
        }
        return row
      })
    if (rows.length) {
      let { error } = await db.from('transactions').insert(rows)
      // `pending` column not migrated yet? drop it and retry so syncing still works.
      if (error && /pending/.test(error.message || '')) {
        ;({ error } = await db.from('transactions').insert(rows.map(({ pending, ...r }) => r)))
      }
      if (error) throw new Error(error.message)
    }
    // Correct transactions we already have: when a pending charge posts (or on a
    // full re-pull), refresh the date, amount, and pending flag. Only these —
    // never touch the user's category / tags / goal link.
    const updates = ups.filter((t) => have.has(t.transaction_id))
    for (const t of updates) {
      const patch = { txn_date: t.authorized_date || t.date, amount: t.amount, pending: !!t.pending }
      let { error } = await db
        .from('transactions')
        .update(patch)
        .eq('plaid_transaction_id', t.transaction_id)
        .eq('user_id', uid)
      if (error && /pending/.test(error.message || '')) {
        const { pending, ...rest } = patch
        ;({ error } = await db.from('transactions').update(rest).eq('plaid_transaction_id', t.transaction_id).eq('user_id', uid))
      }
      if (error) throw new Error(error.message)
    }
  }
  if (removed.length) {
    await db
      .from('transactions')
      .delete()
      .in(
        'plaid_transaction_id',
        removed.map((t) => t.transaction_id)
      )
  }
  await db
    .from('plaid_items')
    .update({ cursor })
    .eq('item_id', item.item_id)
    .eq('user_id', uid)
  return { added: added.length, ready: true }
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}
