// @ts-nocheck
// Do not calculate a budget from a silently truncated bank history.
export async function fetchUserRows(db, table, userId, orderColumn, pageSize = 1000) {
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from(table).select('*').eq('user_id', userId)
      .order(orderColumn, { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) return { data: [], error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return { data: rows, error: null }
  }
}
