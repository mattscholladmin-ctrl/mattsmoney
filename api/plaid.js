// All Plaid actions in ONE serverless function (Hobby plan caps at 12), routed
// by body.action: link-token | exchange | status | refresh | disconnect.
import { getUserFromRequest, adminClient } from '../src/lib/googleServer.js'
import {
  plaidClient,
  plaidError,
  saveItem,
  listItems,
  syncItemAccounts,
  syncItemTransactions,
  cleanupUnlinkedAccounts,
  readBody,
} from '../src/lib/plaidServer.js'
import { Products, CountryCode } from 'plaid'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const body = await readBody(req)
  const db = adminClient()
  const client = plaidClient()

  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  try {
    switch (body.action) {
      case 'link-token': {
        const opts = {
          user: { client_user_id: user.id },
          client_name: "Matt's Money",
          products: [Products.Transactions],
          // Liabilities optional so bank-only logins still connect.
          optional_products: [Products.Liabilities],
          country_codes: [CountryCode.Us],
          language: 'en',
        }
        if (process.env.PLAID_REDIRECT_URI) opts.redirect_uri = process.env.PLAID_REDIRECT_URI
        const r = await client.linkTokenCreate(opts)
        return res.status(200).json({ link_token: r.data.link_token })
      }

      case 'exchange': {
        if (!body.public_token) return res.status(400).json({ error: 'missing public_token' })
        const ex = await client.itemPublicTokenExchange({ public_token: body.public_token })
        const access_token = ex.data.access_token
        const item_id = ex.data.item_id
        const acc = await client.accountsGet({ access_token })
        const institution_id = acc.data.item.institution_id || null
        let institution_name = null
        if (institution_id) {
          try {
            const inst = await client.institutionsGetById({
              institution_id,
              country_codes: [CountryCode.Us],
            })
            institution_name = inst.data.institution.name
          } catch {
            /* non-fatal */
          }
        }
        await saveItem(user.id, { item_id, access_token, institution_id, institution_name })
        const item = { item_id, access_token, institution_name, cursor: null }
        const counts = await syncItemAccounts(user.id, item, db)
        await syncItemTransactions(user.id, item, db)
        await cleanupUnlinkedAccounts(user.id, db)
        return res.status(200).json({ ok: true, institution: institution_name, ...counts })
      }

      case 'status': {
        const items = await listItems(user.id, db)
        const out = []
        for (const it of items) {
          let accounts = []
          let txnNote = null
          // Sum pending charges per account so we can see why available differs.
          const pendingByAccount = {}
          let pendingCount = 0
          try {
            const start = new Date(Date.now() - 30 * 86400000)
              .toISOString()
              .slice(0, 10)
            const end = new Date().toISOString().slice(0, 10)
            const tx = await client.transactionsGet({
              access_token: it.access_token,
              start_date: start,
              end_date: end,
              options: { count: 500 },
            })
            for (const t of tx.data.transactions) {
              if (t.pending) {
                pendingByAccount[t.account_id] =
                  (pendingByAccount[t.account_id] || 0) + Number(t.amount || 0)
                pendingCount++
              }
            }
            txnNote = `${tx.data.transactions.length} txns, ${pendingCount} pending`
          } catch (e) {
            txnNote = `txn fetch failed: ${plaidError(e)}`
          }
          try {
            const acc = await client.accountsBalanceGet({
              access_token: it.access_token,
              options: {
                min_last_updated_datetime: new Date(Date.now() - 60 * 1000).toISOString(),
              },
            })
            accounts = acc.data.accounts.map((a) => ({
              name: a.name,
              mask: a.mask,
              type: a.type,
              subtype: a.subtype,
              current: a.balances.current,
              available: a.balances.available,
              pending: pendingByAccount[a.account_id] || 0,
            }))
          } catch {
            /* stale/sandbox item — skip its live balances */
          }
          out.push({
            item_id: it.item_id,
            institution: it.institution_name,
            updated_at: it.updated_at,
            txnNote,
            accounts,
          })
        }
        return res.status(200).json({ items: out })
      }

      case 'refresh': {
        const items = await listItems(user.id, db)
        let synced = 0
        for (const it of items) {
          try {
            await syncItemAccounts(user.id, it, db)
            await syncItemTransactions(user.id, it, db)
            synced++
          } catch {
            /* one bad item shouldn't block the rest */
          }
        }
        await cleanupUnlinkedAccounts(user.id, db)
        return res.status(200).json({ ok: true, items: items.length, synced })
      }

      case 'disconnect': {
        if (!body.item_id) return res.status(400).json({ error: 'missing item_id' })
        const items = await listItems(user.id, db)
        const item = items.find((i) => i.item_id === body.item_id)
        if (!item) return res.status(404).json({ error: 'connection not found' })
        try {
          await client.itemRemove({ access_token: item.access_token })
        } catch {
          /* unlink locally even if Plaid removal fails */
        }
        const unlink = { plaid_account_id: null, plaid_item_id: null }
        await db.from('accounts').update(unlink).eq('user_id', user.id).eq('plaid_item_id', body.item_id)
        await db.from('debts').update(unlink).eq('user_id', user.id).eq('plaid_item_id', body.item_id)
        await db.from('plaid_items').delete().eq('user_id', user.id).eq('item_id', body.item_id)
        return res.status(200).json({ ok: true })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: plaidError(e) })
  }
}
