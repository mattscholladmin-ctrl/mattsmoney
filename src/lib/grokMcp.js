// MCP (Custom Grok connector) in front of the Budget door.
import { grokSecretOk, runGrokAction } from './grokApi.js'

const TOOLS = [
  {
    name: 'budget_snapshot',
    description: 'Read Matt’s Money: cash, cards, debts, bills, goals, income, set-asides, buffer, safe to spend.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pause_goal',
    description: 'Pause a goal so it is not reserved. Requires the goal id from budget_snapshot.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'unpause_goal',
    description: 'Unpause a goal so it is reserved again. Requires the goal id from budget_snapshot.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_card',
    description: 'Update a credit card. Requires id from budget_snapshot. Only send fields to change.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        balance: { type: 'number' },
        credit_limit: { type: 'number' },
        min_payment: { type: 'number' },
        due_day: { type: 'integer' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_buffer',
    description: 'Set the buffer floor amount.',
    inputSchema: {
      type: 'object',
      properties: { buffer_floor: { type: 'number' } },
      required: ['buffer_floor'],
      additionalProperties: false,
    },
  },
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
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'matts-money', title: "Matt's Money", version: '1.0.0' },
      instructions:
        'Personal budget app. Read with budget_snapshot. Change only after the user says yes in chat.',
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
    const map = {
      budget_snapshot: { action: 'snapshot' },
      pause_goal: { action: 'pause_goal', id: args.id },
      unpause_goal: { action: 'unpause_goal', id: args.id },
      update_card: { action: 'update_card', ...args },
      set_buffer: { action: 'set_buffer', buffer_floor: args.buffer_floor },
    }
    const body = map[name]
    if (!body) {
      return rpcResult(id, {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      })
    }
    const result = await runGrokAction(body)
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
        'WWW-Authenticate': 'Bearer realm="Budget"',
      }),
    })
  }

  const accept = request.headers.get('accept') || ''
  const sse = accept.includes('text/event-stream') && !accept.includes('application/json')
    ? true
    : accept.includes('text/event-stream') && method === 'GET'

  if (method === 'GET') {
    // Stateless: no server-push stream.
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
