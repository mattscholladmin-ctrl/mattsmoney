// Read-only: returns the user's upcoming Google Calendar events for display in
// the app (used by the dashboard when "pull" is on). Does not write anything.
import {
  getUserFromRequest,
  getConnection,
  getValidAccessToken,
  listUpcomingEvents,
} from '../../src/lib/googleServer.js'

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const conn = await getConnection(user.id)
  if (!conn || !conn.refresh_token || !conn.pull_enabled) {
    return res.status(200).json({ events: [] })
  }

  const token = await getValidAccessToken(user.id)
  if (!token) return res.status(200).json({ events: [] })

  try {
    const events = await listUpcomingEvents(token, 60)
    return res.status(200).json({ events })
  } catch {
    return res.status(200).json({ events: [] })
  }
}
