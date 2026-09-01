// Daily auto-sync — Vercel Cron hits this once a day (see vercel.json). For
// every connected user who has "Push to Google Calendar" on, it refreshes their
// budget events on the dedicated "Budget" calendar. No user action needed.
import {
  adminClient,
  getValidAccessToken,
  pushBudgetEvents,
} from '../../src/lib/googleServer.js'

export default async function handler(req, res) {
  // Only Vercel Cron (or someone with the secret) may trigger this.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const db = adminClient()
  const { data: conns, error } = await db
    .from('google_calendar')
    .select('user_id, push_enabled, refresh_token')
  if (error) return res.status(500).json({ error: error.message })

  let users = 0
  let pushed = 0
  for (const c of conns || []) {
    if (!c.push_enabled || !c.refresh_token) continue
    try {
      const token = await getValidAccessToken(c.user_id, db)
      if (!token) continue // refresh token dead — they'll reconnect in-app
      pushed += await pushBudgetEvents(token, c.user_id, db)
      users++
    } catch {
      // Skip one bad user rather than failing the whole run.
    }
  }

  return res.status(200).json({ ok: true, users, pushed })
}
