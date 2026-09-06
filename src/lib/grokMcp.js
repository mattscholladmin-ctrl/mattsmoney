// MCP (Custom Grok connector) in front of the Budget door.
import { grokSecretOk, runGrokAction } from './grokApi.js'

const str = { type: 'string' }
const num = { type: 'number' }
const integer = { type: 'integer' }
const bool = { type: 'boolean' }

function tool(name, description, properties = {}, required = []) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  }
}

const TOOLS = [
  tool('budget_snapshot', 'Full read of Matt’s Money: cash, cards, debts (start_date, next_due, status pre_start|due|late), bills, goals, income, set-asides, recent transactions, budgets, credit scores, phases, buffer, safe to spend.'),
  tool('log_purchase', 'Log a purchase or other transaction.', { txn_date: str, merchant: str, amount: num, category: str, note: str, account_id: str, goal_id: str, income_source: str }, ['merchant', 'amount']),
  tool('update_transaction', 'Edit a transaction. Requires id from budget_snapshot.', { id: str, txn_date: str, merchant: str, amount: num, category: str, note: str, account_id: str, goal_id: str, income_source: str }, ['id']),
  tool('delete_transaction', 'Delete a transaction.', { id: str }, ['id']),
  tool('add_bill', 'Add a recurring bill.', { name: str, amount: num, category: str, cadence: str, due_day: integer, start_date: str }, ['name', 'amount']),
  tool('update_bill', 'Edit a bill. Requires id. start_date is first due (YYYY-MM-DD); omit to leave it.', { id: str, name: str, amount: num, category: str, cadence: str, due_day: integer, active: bool, start_date: str }, ['id']),
  tool('delete_bill', 'Delete a bill.', { id: str }, ['id']),
  tool('add_income', 'Add an income source.', { name: str, amount: num, cadence: str, due_day: integer, anchor_date: str, confirmed: bool }, ['name']),
  tool('update_income', 'Edit income. Requires id.', { id: str, name: str, amount: num, cadence: str, due_day: integer, anchor_date: str, confirmed: bool, active: bool }, ['id']),
  tool('delete_income', 'Delete an income source.', { id: str }, ['id']),
  tool('add_account', 'Add a bank/cash account.', { name: str, kind: str, include_in_spendable: bool }, ['name']),
  tool('update_account', 'Edit an account. Requires id.', { id: str, name: str, kind: str, include_in_spendable: bool, hidden: bool }, ['id']),
  tool('delete_account', 'Delete an account.', { id: str }, ['id']),
  tool('set_account_balance', 'Set an account cash balance.', { account_id: str, balance: num, as_of: str, note: str }, ['account_id', 'balance']),
  tool('add_goal', 'Create a savings goal.', { name: str, target: num, current: num, monthly_contribution: num, note: str, target_date: str, status: str }, ['name', 'target']),
  tool('update_goal', 'Edit a goal (name, target, saved, status, reserved). Requires id.', { id: str, name: str, target: num, current: num, monthly_contribution: num, note: str, target_date: str, status: str, reserved: bool }, ['id']),
  tool('delete_goal', 'Delete a goal.', { id: str }, ['id']),
  tool('pause_goal', 'Pause a goal (not reserved). Requires id.', { id: str }, ['id']),
  tool('unpause_goal', 'Unpause a goal (reserved again). Requires id.', { id: str }, ['id']),
  tool('add_card', 'Add a credit card.', { name: str, balance: num, credit_limit: num, min_payment: num, plan_payment: num, due_day: integer, apr: num }, ['name']),
  tool('add_debt', 'Add a loan or other debt. start_date is first payment (YYYY-MM-DD).', { name: str, kind: str, balance: num, min_payment: num, plan_payment: num, due_day: integer, apr: num, start_date: str }, ['name']),
  tool('update_card', 'Update a credit card. Requires id.', { id: str, name: str, balance: num, credit_limit: num, min_payment: num, plan_payment: num, due_day: integer, apr: num, autopay: bool, active: bool }, ['id']),
  tool('update_debt', 'Update a loan/debt. Requires id. start_date is first payment (YYYY-MM-DD); other fields only change if sent.', { id: str, name: str, kind: str, balance: num, min_payment: num, plan_payment: num, due_day: integer, apr: num, active: bool, start_date: str }, ['id']),
  tool('delete_card', 'Delete a credit card.', { id: str }, ['id']),
  tool('delete_debt', 'Delete a loan/debt.', { id: str }, ['id']),
  tool('add_set_aside', 'Hold money aside for a date.', { name: str, amount: num, due_date: str }, ['name', 'amount']),
  tool('remove_set_aside', 'Remove a set-aside.', { id: str }, ['id']),
  tool('set_buffer', 'Set the buffer floor.', { buffer_floor: num }, ['buffer_floor']),
  tool('set_budget', 'Set a monthly category budget.', { category: str, monthly_limit: num }, ['category', 'monthly_limit']),
  tool('delete_budget', 'Delete a category budget.', { id: str }, ['id']),
  tool('add_credit_score', 'Log a credit score.', { bureau: str, score: integer, model: str, source: str, checked_on: str, note: str }, ['bureau', 'score']),
  tool('delete_credit_score', 'Delete a credit score log.', { id: str }, ['id']),
]

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, x-grok-secret, mcp-protocol-version, mcp-session-id, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
    ...extra,
  }
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function respond(payload, { sse, status = 200, sessionId } = {}) {
  const headers = corsHeaders({
    'MCP-Protocol-Version': '2025-03-26',
  })
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  if (sse) {
    headers['Content-Type'] = 'text/event-stream; charset=utf-8'
    headers['Cache-Control'] = 'no-cache'
    const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`
    return new Response(body, { status, headers })
  }
  headers['Content-Type'] = 'application/json'
  return new Response(JSON.stringify(payload), { status, headers })
}

async function dispatch(msg) {
  const { id, method, params } = msg || {}
  if (method === 'initialize') {
    const version = params?.protocolVersion || '2025-03-26'
    return rpcResult(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'matts-money', title: "Matt's Money", version: '2.0.0' },
      instructions:
        'Full read/write for Matt’s Money. Always budget_snapshot first. Confirm with the user in chat before any write.',
    })
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null
  }
  if (method === 'ping') return rpcResult(id, {})
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS })
  if (method === 'resources/list') return rpcResult(id, { resources: [] })
  if (method === 'prompts/list') return rpcResult(id, { prompts: [] })
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments || {}
    const known = TOOLS.some((t) => t.name === name)
    if (!known) {
      return rpcResult(id, {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      })
    }
    const action = name === 'budget_snapshot' ? 'snapshot' : name
    const result = await runGrokAction({ action, ...args })
    if (!result.ok) {
      return rpcResult(id, {
        content: [{ type: 'text', text: result.error || 'failed' }],
        isError: true,
      })
    }
    return rpcResult(id, {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
    })
  }
  if (id == null) return null
  return rpcError(id, -32601, `Method not found: ${method}`)
}

export async function handleMcpRequest(request) {
  const method = (request.method || 'GET').toUpperCase()
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (!process.env.GROK_SECRET) {
    return new Response(JSON.stringify({ error: 'grok is not connected yet' }), {
      status: 503,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    })
  }
  if (!grokSecretOk(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: corsHeaders({
        'Content-Type': 'application/json',
      }),
    })
  }

  const accept = request.headers.get('accept') || ''

  if (method === 'GET') {
    return new Response(null, { status: 405, headers: corsHeaders({ Allow: 'POST, OPTIONS' }) })
  }
  if (method === 'DELETE') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (method !== 'POST') {
    return new Response(null, { status: 405, headers: corsHeaders({ Allow: 'POST, OPTIONS' }) })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return respond(rpcError(null, -32700, 'Parse error'), { sse: accept.includes('text/event-stream') })
  }

  const sessionId = request.headers.get('mcp-session-id') || crypto.randomUUID()
  const useSse = accept.includes('text/event-stream')

  try {
    if (Array.isArray(payload)) {
      const out = []
      for (const msg of payload) {
        const r = await dispatch(msg)
        if (r) out.push(r)
      }
      if (!out.length) return new Response(null, { status: 202, headers: corsHeaders() })
      return respond(out, { sse: useSse, sessionId })
    }
    const r = await dispatch(payload)
    if (!r) return new Response(null, { status: 202, headers: corsHeaders({ 'Mcp-Session-Id': sessionId }) })
    return respond(r, { sse: useSse, sessionId })
  } catch (e) {
    return respond(rpcError(payload?.id ?? null, -32603, e.message || 'failed'), { sse: useSse, sessionId })
  }
}
