// Returns the user's Google Calendar connection state for the Settings UI.
// Never returns tokens — only whether they're connected, which account, and
// the two sync toggles.
import { getUserFromRequest, getConnection } from '../../src/lib/googleServer.js'

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const conn = await getConnection(user.id)
  if (!conn || !conn.refresh_token) {
    return res.status(200).json({ connected: false })
  }
  return res.status(200).json({
    connected: true,
    email: conn.email || null,
    push_enabled: conn.push_enabled,
    pull_enabled: conn.pull_enabled,
  })
}
