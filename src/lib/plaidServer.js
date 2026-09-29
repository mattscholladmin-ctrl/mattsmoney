// @ts-nocheck
// Server-side Plaid helpers (run inside Vercel functions only — they use the
// secret key). Mirrors the Google integration's service-role pattern.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import { adminClient } from './googleServer.js'
import { normalizeMerchant, merchantMatchesBill } from './budget.js'

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

export function plaidError(e) {
  return e?.response?.data?.error_message || e?.message || 'plaid request failed'
}

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
  const { data, error } = await db.from('plaid_items').select('*').eq('user_id', uid)
  if (error) throw new Error(error.message)
  return data || []
}
