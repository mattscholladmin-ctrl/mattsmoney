// Admin loader (service-role, runs inside Vercel). Protected by SEED_SECRET.
//   POST with no body            -> full budget seed (runSeed)
//   POST { transactions: [...] } -> replace transaction log (importTransactions)
import { adminClient } from '../../src/lib/googleServer.js'
import { runSeed, importTransactions, appendTransactions } from '../../src/lib/seedData.js'
import { rawPlaidBalances, syncItemAccounts, syncItemTransactions } from '../../src/lib/plaidServer.js'
import { cleanCategory, setCategoryAliases } from '../../src/lib/budget.js'

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!process.env.SEED_SECRET || token !== process.env.SEED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  // Read-only diagnostics: GET dumps accounts + their recent balance history so
  // we can see exactly what's writing a balance and when (note tells the source).
  if (req.method === 'GET') {
    try {
      // ?plaid=1 → live raw balances straight from the banks (what they expose).
      if (/[?&]plaid=/.test(req.url || '')) {
        return res.status(200).json({ plaid: await rawPlaidBalances(adminClient()) })
      }
      // ?debts=1 → id/name/balance for every debt, to spot duplicate or null ids
      // (which would make clicking one debt open another's editor).
      if (/[?&]debts=/.test(req.url || '')) {
        const db = adminClient()
        const { data } = await db
          .from('debts')
          .select('id,name,balance,kind,active')
          .order('balance', { ascending: false })
        return res.status(200).json({ debts: data })
      }
      // ?debtdetail=NAME → the FULL row for debts matching NAME plus any goal
      // "payment plan" series that attaches to them, to see why a debt's tile
      // shows a total/schedule that doesn't match what was typed.
      if (/[?&]debtdetail=/.test(req.url || '')) {
        const db = adminClient()
        const m = (req.url || '').match(/[?&]debtdetail=([^&]*)/)
        const needle = decodeURIComponent(m?.[1] || '').toLowerCase()
        const [debtsRes, goalsRes] = await Promise.all([
          db.from('debts').select('*'),
          db.from('goals').select('id,name,target,current,status,target_date,account_id'),
        ])
        const debts = (debtsRes.data || []).filter((d) => (d.name || '').toLowerCase().includes(needle))
        const goals = (goalsRes.data || []).filter((g) => (g.name || '').toLowerCase().includes(needle) || /payment \d+ of \d+/i.test(g.name || ''))
        return res.status(200).json({ debts, planGoals: goals })
      }
      // ?income=1 → income sources + recent money-in rows with their merchant and
      // income_source tag, to diagnose why an already-landed paycheck isn't being
      // recognized (tagging gap vs merchant-match gap).
      if (/[?&]income=/.test(req.url || '')) {
        const db = adminClient()
        const [srcs, deposits] = await Promise.all([
          db.from('income_sources').select('name,amount,cadence,anchor_date,active,confirmed'),
          db
            .from('transactions')
            .select('txn_date,merchant,amount,income_source,pending')
            .lt('amount', 0)
            .order('txn_date', { ascending: false })
            .limit(15),
        ])
        return res.status(200).json({ sources: srcs.data, deposits: deposits.data })
      }
      // ?cats=1 → every spending category (cleaned, with the user's renames applied)
      // and the merchants inside it, so a one-time category cleanup can see exactly
      // what's in the vague buckets (General services, Uncategorized, etc.).
      if (/[?&]cats=/.test(req.url || '')) {
        const db = adminClient()
        const [{ data: txns }, { data: aliasRows }] = await Promise.all([
          db.from('transactions').select('merchant,amount,category,income_source'),
          db.from('category_aliases').select('from_name,to_name'),
        ])
        setCategoryAliases(Object.fromEntries((aliasRows || []).map((a) => [a.from_name, a.to_name])))
        const rows = (txns || []).filter((t) => !t.income_source && Number(t.amount || 0) > 0)
        const cats = {}
        for (const t of rows) {
          const cat = cleanCategory(t, rows)
          const c = (cats[cat] = cats[cat] || { category: cat, count: 0, total: 0, merchants: {} })
          c.count++
          c.total += Number(t.amount || 0)
          const name = t.merchant || '(no merchant)'
          const m = (c.merchants[name] = c.merchants[name] || { merchant: name, count: 0, total: 0 })
          m.count++
          m.total += Number(t.amount || 0)
        }
        const round = (n) => Math.round(n * 100) / 100
        const out = Object.values(cats)
          .map((c) => ({
            category: c.category,
            count: c.count,
            total: round(c.total),
            merchants: Object.values(c.merchants).sort((a, b) => b.total - a.total).map((m) => ({ merchant: m.merchant, count: m.count, total: round(m.total) })),
          }))
          .sort((a, b) => b.total - a.total)
        return res.status(200).json({ categories: out })
      }
      // ?splits=1 → every merchant whose spending transactions resolve to MORE THAN
      // ONE category (the inconsistency to eliminate). Merchant variants (store #,
      // location) are collapsed so "SAFEWAY 0836 FRISCO CO" and "Safeway" count as one.
      if (/[?&]splits=/.test(req.url || '')) {
        const db = adminClient()
        const [{ data: txns }, { data: aliasRows }] = await Promise.all([
          db.from('transactions').select('merchant,amount,category,income_source'),
          db.from('category_aliases').select('from_name,to_name'),
        ])
        setCategoryAliases(Object.fromEntries((aliasRows || []).map((a) => [a.from_name, a.to_name])))
        const spend = (txns || []).filter((t) => !t.income_source && Number(t.amount || 0) > 0)
        const norm = (m) => (m || '').toLowerCase().replace(/[#0-9].*$/, '').replace(/\s+/g, ' ').trim() || '(none)'
        const byMer = {}
        for (const t of spend) {
          const cat = cleanCategory(t, spend)
          const k = norm(t.merchant)
          const e = (byMer[k] = byMer[k] || { merchant: t.merchant, cats: {}, count: 0 })
          e.cats[cat] = (e.cats[cat] || 0) + 1
          e.count++
        }
        const splits = Object.values(byMer)
          .filter((m) => Object.keys(m.cats).length > 1)
          .sort((a, b) => b.count - a.count)
          .map((m) => ({ merchant: m.merchant, count: m.count, categories: m.cats }))
        return res.status(200).json({ splitMerchants: splits.length, splits })
      }
      // ?merchant=NAME → every transaction (money IN and OUT) whose merchant contains
      // NAME, to settle definitively whether a name is income or spending.
      if (/[?&]merchant=/.test(req.url || '')) {
        const db = adminClient()
        const m = (req.url || '').match(/[?&]merchant=([^&]*)/)
        const needle = decodeURIComponent(m?.[1] || '').toLowerCase()
        const { data } = await db
          .from('transactions')
          .select('txn_date,merchant,amount,category,income_source')
          .order('txn_date', { ascending: false })
        const rows = (data || []).filter((t) => (t.merchant || '').toLowerCase().includes(needle))
        const round = (n) => Math.round(n * 100) / 100
        const moneyIn = round(rows.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + -Number(t.amount), 0))
        const moneyOut = round(rows.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0))
        return res.status(200).json({ count: rows.length, moneyIn, moneyOut, rows: rows.slice(0, 40) })
      }
      // ?rawtxns=1 → what Plaid actually returns for the newest transactions:
      // date vs authorized_date vs datetime, and the pending flag. Diagnoses
      // why stored dates look off.
      if (/[?&]rawtxns=/.test(req.url || '')) {
        const db = adminClient()
        const { plaidClient } = await import('../../src/lib/plaidServer.js')
        const client = plaidClient()
        const { data: items } = await db.from('plaid_items').select('*')
        const out = []
        for (const item of items || []) {
          try {
            const r = await client.transactionsSync({ access_token: item.access_token, cursor: undefined })
            const rows = [...r.data.added]
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .slice(0, 8)
              .map((t) => ({
                name: t.merchant_name || t.name,
                date: t.date,
                authorized_date: t.authorized_date,
                datetime: t.datetime,
                authorized_datetime: t.authorized_datetime,
                pending: t.pending,
              }))
            out.push({ institution: item.institution_name, sample: rows })
          } catch (e) {
            out.push({ institution: item.institution_name, error: e.message })
          }
        }
        return res.status(200).json({ rawtxns: out })
      }
      // ?compare=1 → for the newest transactions, put Plaid's own date /
      // authorized_date / pending flag next to what we actually stored, so we can
      // see exactly where a date is off and why.
      if (/[?&]compare=/.test(req.url || '')) {
        const db = adminClient()
        const { plaidClient } = await import('../../src/lib/plaidServer.js')
        const client = plaidClient()
        const { data: items } = await db.from('plaid_items').select('*')
        const out = []
        for (const item of items || []) {
          let cursor = null
          let added = []
          let hasMore = true
          try {
            while (hasMore) {
              const r = await client.transactionsSync({ access_token: item.access_token, cursor: cursor || undefined })
              added = added.concat(r.data.added, r.data.modified)
              hasMore = r.data.has_more
              cursor = r.data.next_cursor
            }
          } catch (e) {
            out.push({ institution: item.institution_name, error: e.message })
            continue
          }
          const newest = added.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15)
          const ids = newest.map((t) => t.transaction_id)
          const { data: stored } = await db.from('transactions').select('plaid_transaction_id,txn_date').in('plaid_transaction_id', ids)
          const smap = {}
          for (const s of stored || []) smap[s.plaid_transaction_id] = s.txn_date
          out.push({
            institution: item.institution_name,
            sample: newest.map((t) => ({
              name: t.merchant_name || t.name,
              plaidDate: t.date,
              authDate: t.authorized_date,
              stored: smap[t.transaction_id] || null,
              pending: t.pending,
            })),
          })
        }
        return res.status(200).json({ compare: out })
      }
      // ?tokenenv=1 → which Plaid environment is actually in use: the PLAID_ENV
      // var, what the code resolves it to, and the environment baked into each
      // stored access token (sandbox / development / production). No full tokens.
      if (/[?&]tokenenv=/.test(req.url || '')) {
        const db = adminClient()
        const { data: items } = await db.from('plaid_items').select('institution_name,access_token,created_at')
        return res.status(200).json({
          PLAID_ENV: process.env.PLAID_ENV ?? null,
          resolvedEnv: process.env.PLAID_ENV || 'sandbox',
          items: (items || []).map((i) => ({
            institution: i.institution_name,
            tokenEnv: String(i.access_token || '').split('-')[1] || null,
            created_at: i.created_at,
          })),
        })
      }
      // ?txns=1 → transaction pipeline health: newest rows, per-day counts for
      // the last 14 days, and each item's sync cursor state.
      if (/[?&]txns=/.test(req.url || '')) {
        const db = adminClient()
        const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
        const [newest, recent, items] = await Promise.all([
          db
            .from('transactions')
            .select('txn_date,merchant,amount,source,created_at')
            .order('txn_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(12),
          db.from('transactions').select('txn_date,source').gte('txn_date', twoWeeksAgo),
          db.from('plaid_items').select('item_id,institution_name,updated_at,cursor'),
        ])
        const perDay = {}
        for (const t of recent.data || []) {
          perDay[t.txn_date] = (perDay[t.txn_date] || 0) + 1
        }
        return res.status(200).json({
          newest: newest.data,
          perDayLast14: Object.fromEntries(Object.entries(perDay).sort()),
          items: (items.data || []).map((i) => ({
            institution: i.institution_name,
            updated_at: i.updated_at,
            hasCursor: !!i.cursor,
          })),
        })
      }
      const db = adminClient()
      const [accts, bals, items] = await Promise.all([
        db.from('accounts').select('id,name,mask,kind,manual,plaid_account_id,plaid_item_id,hidden,created_at').order('sort_order'),
        db.from('balance_entries').select('account_id,balance,as_of,created_at,note').order('created_at', { ascending: false }).limit(80),
        db.from('plaid_items').select('item_id,institution_name,updated_at,created_at'),
      ])
      const byAcct = {}
      for (const b of bals.data || []) (byAcct[b.account_id] ||= []).push(b)
      const accounts = (accts.data || []).map((a) => ({
        name: a.name,
        mask: a.mask,
        kind: a.kind,
        manual: a.manual,
        hidden: a.hidden || false,
        plaid_linked: !!a.plaid_account_id,
        plaid_item_id: a.plaid_item_id || null,
        created_at: a.created_at,
        latest: (byAcct[a.id] || []).slice(0, 4),
      }))
      return res.status(200).json({ accounts, items: items.data })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  try {
    const body = await readBody(req)
    // One-time cleanup: delete 'Auto-synced' balance entries for accounts whose
    // name matches (e.g. "Capital One") so the user's last MANUAL balance for
    // those accounts resurfaces as the latest. Non-destructive to manual data.
    if (body.purgeAutoSynced) {
      const db = adminClient()
      const filter = String(body.purgeAutoSynced).toLowerCase()
      const { data: accts } = await db.from('accounts').select('id,name')
      const ids = (accts || [])
        .filter((a) => (a.name || '').toLowerCase().includes(filter))
        .map((a) => a.id)
      let deleted = 0
      if (ids.length) {
        const { data: del, error } = await db
          .from('balance_entries')
          .delete()
          .in('account_id', ids)
          .eq('note', 'Auto-synced')
          .select('id')
        if (error) throw error
        deleted = (del || []).length
      }
      return res.status(200).json({ ok: true, mode: 'purge', matchedAccounts: ids.length, deleted })
    }
    // Remove one bank connection AND everything it created (accounts, balance
    // history, imported transactions). Used to surgically undo a duplicate
    // connection without touching the original's data.
    if (body.removeItem) {
      const db = adminClient()
      const itemId = String(body.removeItem)
      const { data: item } = await db
        .from('plaid_items')
        .select('*')
        .eq('item_id', itemId)
        .maybeSingle()
      if (!item) return res.status(404).json({ error: 'item not found' })
      // Tell Plaid to drop the connection (non-fatal if it refuses).
      try {
        const { plaidClient } = await import('../../src/lib/plaidServer.js')
        await plaidClient().itemRemove({ access_token: item.access_token })
      } catch {
        /* still clean up locally */
      }
      const { data: accts } = await db
        .from('accounts')
        .select('id')
        .eq('plaid_item_id', itemId)
        .eq('user_id', item.user_id)
      const ids = (accts || []).map((a) => a.id)
      let entries = 0
      if (ids.length) {
        const { data: del } = await db
          .from('balance_entries')
          .delete()
          .in('account_id', ids)
          .select('id')
        entries = (del || []).length
      }
      const { data: txDel } = await db
        .from('transactions')
        .delete()
        .eq('plaid_item_id', itemId)
        .eq('user_id', item.user_id)
        .select('id')
      await db.from('accounts').delete().eq('plaid_item_id', itemId).eq('user_id', item.user_id)
      await db.from('plaid_items').delete().eq('item_id', itemId).eq('user_id', item.user_id)
      return res.status(200).json({
        ok: true,
        mode: 'removeItem',
        institution: item.institution_name,
        accountsDeleted: ids.length,
        balanceEntriesDeleted: entries,
        transactionsDeleted: (txDel || []).length,
      })
    }
    // Repair account metadata (kind / include_in_spendable) for accounts whose
    // name matches. Used to undo the old bug where excluding an account from
    // spendable also relabeled its type. Body: { setAccount: { nameLike, kind,
    // include_in_spendable } }.
    if (body.setAccount) {
      const db = adminClient()
      const { nameLike, kind, include_in_spendable, user_id } = body.setAccount
      // Must target a single user — otherwise a name match would update matching
      // accounts across every user (service-role bypasses RLS).
      if (!user_id) {
        return res.status(400).json({ ok: false, mode: 'setAccount', error: 'user_id required' })
      }
      const fields = {}
      if (kind !== undefined) fields.kind = kind
      if (include_in_spendable !== undefined) fields.include_in_spendable = include_in_spendable
      const { data, error } = await db
        .from('accounts')
        .update(fields)
        .eq('user_id', user_id)
        .ilike('name', `%${nameLike}%`)
        .select('name,kind,include_in_spendable')
      if (error) return res.status(200).json({ ok: false, mode: 'setAccount', error: error.message })
      return res.status(200).json({ ok: true, mode: 'setAccount', updated: data })
    }
    // Clear a stale settlement PLAN off a debt so it behaves like a plain debt:
    // delete its "<name> payment N of M" goal series and null its settlement /
    // plan-end fields, so the debt's own balance + payment drive everything and a
    // typed Original amount drives the payoff bar. Body:
    //   { clearDebtPlan: { user_id, nameLike } }
    if (body.clearDebtPlan) {
      const db = adminClient()
      const { user_id, nameLike } = body.clearDebtPlan
      if (!user_id || !nameLike) {
        return res.status(400).json({ ok: false, mode: 'clearDebtPlan', error: 'user_id and nameLike required' })
      }
      const series = new RegExp(`payment\\s+\\d+\\s+of\\s+\\d+`, 'i')
      const startsWith = (s) => (s || '').toLowerCase().startsWith(String(nameLike).toLowerCase())
      const { data: goals } = await db.from('goals').select('id,name').eq('user_id', user_id)
      const doomed = (goals || []).filter((g) => startsWith(g.name) && series.test(g.name || ''))
      const goalIds = doomed.map((g) => g.id)
      if (goalIds.length) await db.from('goals').delete().in('id', goalIds)
      const { data: debts } = await db.from('debts').select('id,name').eq('user_id', user_id)
      const debtIds = (debts || []).filter((d) => startsWith(d.name)).map((d) => d.id)
      let clearedDebts = 0
      if (debtIds.length) {
        const { data } = await db
          .from('debts')
          .update({ settlement_amount: null, plan_end_date: null })
          .in('id', debtIds)
          .select('id')
        clearedDebts = (data || []).length
      }
      return res.status(200).json({ ok: true, mode: 'clearDebtPlan', deletedGoals: doomed.map((g) => g.name), clearedDebts })
    }
    // Force a live bank sync now (service-role) — used to test the sync.
    if (body.syncNow) {
      const db = adminClient()
      const { data: items } = await db.from('plaid_items').select('*')
      const results = []
      for (const item of items || []) {
        try {
          const r = await syncItemAccounts(item.user_id, item, db)
          results.push({ institution: item.institution_name, ...r })
        } catch (e) {
          results.push({ institution: item.institution_name, error: e.message })
        }
      }
      return res.status(200).json({ ok: true, mode: 'syncNow', results })
    }
    // Re-pull every synced transaction from scratch (cursor reset) so already-
    // stored rows get their dates corrected to the authorization date. Only
    // txn_date + amount are updated; categories, tags, and goal links are kept.
    if (body.resyncTxns) {
      const db = adminClient()
      const { data: items } = await db.from('plaid_items').select('*')
      const results = []
      for (const item of items || []) {
        try {
          const r = await syncItemTransactions(item.user_id, { ...item, cursor: null }, db)
          results.push({ institution: item.institution_name, ...r })
        } catch (e) {
          results.push({ institution: item.institution_name, error: e.message })
        }
      }
      return res.status(200).json({ ok: true, mode: 'resyncTxns', results })
    }
    // One-time category cleanup. Re-tags spending transactions:
    //   merchantMap: { "substring": "Category" }  (first match wins, checked in order)
    //   categoryMap: { "old clean category": "Category" }  (for whatever the merchant
    //                 rules didn't catch)
    //   incomeTag:   { "substring": "Source" }  (tag money-IN rows as an income source)
    //   aliases:     { "from": "to" }  (permanent renames so future stays clean)
    //   dryRun:      true → report what WOULD change, write nothing
    if (body.recategorize) {
      const db = adminClient()
      const cfg = body.recategorize
      const dry = !!cfg.dryRun
      const { data: aliasRows } = await db.from('category_aliases').select('from_name,to_name')
      setCategoryAliases(Object.fromEntries((aliasRows || []).map((a) => [a.from_name, a.to_name])))
      const { data: all } = await db.from('transactions').select('id,merchant,amount,category,income_source,user_id')
      const spend = (all || []).filter((t) => !t.income_source && Number(t.amount || 0) > 0)
      const mMap = Object.entries(cfg.merchantMap || {})
      const cMap = cfg.categoryMap || {}
      // amountRules: [{merchant, threshold, above, below}] → split ONE merchant by
      // amount (e.g. 7-Eleven ≥ $10 = fuel/Gas, under = snacks). Checked first.
      const amtRules = cfg.amountRules || []
      const plan = {} // targetCategory -> [ids]
      const byRule = {} // rule -> sample merchants
      for (const t of spend) {
        const mer = (t.merchant || '').toLowerCase()
        const cur = cleanCategory(t, spend)
        let target = null, rule = null
        for (const r of amtRules) {
          if (r.merchant && mer.includes(String(r.merchant).toLowerCase())) {
            target = Number(t.amount) >= Number(r.threshold) ? r.above : r.below
            rule = 'amount:' + r.merchant
            break
          }
        }
        if (!target) for (const [sub, cat] of mMap) {
          if (sub && mer.includes(sub.toLowerCase())) { target = cat; rule = 'merchant:' + sub; break }
        }
        if (!target) {
          const ck = Object.keys(cMap).find((k) => k.toLowerCase() === cur.trim().toLowerCase())
          if (ck) { target = cMap[ck]; rule = 'category:' + ck }
        }
        // Skip only a genuine no-op (already STORED as the target). Comparing the
        // stored category — not the cleaned one — so a merchant the app's keywords
        // read differently (e.g. Verizon → Utilities) still gets forced to the target.
        if (!target || target.trim().toLowerCase() === (t.category || '').trim().toLowerCase()) continue
        ;(plan[target] = plan[target] || []).push(t.id)
        byRule[rule] = byRule[rule] || []
        if (byRule[rule].length < 6) byRule[rule].push(t.merchant)
      }
      // income tagging (money IN whose merchant matches → tag as a source)
      const incTag = Object.entries(cfg.incomeTag || {})
      const incoming = (all || []).filter((t) => Number(t.amount || 0) < 0)
      const incPlan = [] // {id, source}
      for (const t of incoming) {
        const mer = (t.merchant || '').toLowerCase()
        for (const [sub, src] of incTag) {
          if (sub && mer.includes(sub.toLowerCase()) && t.income_source !== src) { incPlan.push({ id: t.id, source: src }); break }
        }
      }
      const byTarget = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length]))
      if (dry) {
        return res.status(200).json({ dryRun: true, wouldRetag: Object.values(plan).reduce((s, a) => s + a.length, 0), byTarget, byRule, incomeToTag: incPlan.length })
      }
      let retagged = 0
      for (const [target, ids] of Object.entries(plan)) {
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200)
          if (chunk.length) { const { error } = await db.from('transactions').update({ category: target }).in('id', chunk); if (error) throw error; retagged += chunk.length }
        }
      }
      let incomeTagged = 0
      for (const p of incPlan) { const { error } = await db.from('transactions').update({ income_source: p.source }).eq('id', p.id); if (!error) incomeTagged++ }
      // permanent aliases so future auto-categorized rows follow the same renames
      const uid = (all || [])[0]?.user_id || null
      let aliasesSet = 0
      if (uid && cfg.aliases) {
        for (const [from, to] of Object.entries(cfg.aliases)) {
          const { error } = await db.from('category_aliases').upsert({ user_id: uid, from_name: String(from).trim().toLowerCase(), to_name: to }, { onConflict: 'user_id,from_name' })
          if (!error) aliasesSet++
        }
      }
      return res.status(200).json({ ok: true, mode: 'recategorize', retagged, byTarget, incomeTagged, aliasesSet })
    }
    if (Array.isArray(body.transactions)) {
      const recon = await importTransactions(adminClient(), body.transactions)
      return res.status(200).json({ ok: true, mode: 'transactions', recon })
    }
    if (Array.isArray(body.addTransactions)) {
      const recon = await appendTransactions(adminClient(), body.addTransactions)
      return res.status(200).json({ ok: true, mode: 'append', recon })
    }
    const recon = await runSeed(adminClient())
    return res.status(200).json({ ok: true, mode: 'seed', recon })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
