// Flip the push and/or pull sync toggles on/off, independently.
import { getUserFromRequest, getConnection, saveConnection } from '../../src/lib/googleServer.js'

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const conn = await getConnection(user.id)
  if (!conn) return res.status(400).json({ error: 'not connected' })

  const body = req.body || {}
  const fields = {}
  if (typeof body.push_enabled === 'boolean') fields.push_enabled = body.push_enabled
  if (typeof body.pull_enabled === 'boolean') fields.pull_enabled = body.pull_enabled
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'nothing to update' })
  }

  await saveConnection(user.id, fields)
  return res.status(200).json({ ok: true, ...fields })
}
