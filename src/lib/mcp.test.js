// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import {handleMcpRequest} from './grokMcp.js'
const call=(payload,accept='application/json')=>handleMcpRequest(new Request('https://example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:accept},body:JSON.stringify(payload)}))
test('MCP advertises read-only snapshot and approval-requiring mutation tools',async()=>{
 const response=await call({jsonrpc:'2.0',id:1,method:'tools/list'})
 const {result}=await response.json()
 assert.equal(result.tools.find(t=>t.name==='budget_snapshot').annotations.readOnlyHint,true)
 for(const t of result.tools.filter(t=>t.name!=='budget_snapshot'))assert.equal(t.annotations.readOnlyHint,false)
 assert.equal(result.tools.find(t=>t.name==='delete_bill').annotations.destructiveHint,true)
})
test('MCP supports SSE framing and keeps calls protected including mixed batches',async()=>{
 const response=await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},'text/event-stream')
 assert.match(response.headers.get('Content-Type'),/text\/event-stream/)
 assert.match(await response.text(),/^event: message\ndata: /)
 const batch=await call([{jsonrpc:'2.0',id:1,method:'tools/list'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'delete_bill',arguments:{id:'test'}}}])
 assert.ok([401,503].includes(batch.status))
})
test('read-only tool cannot be redirected to a mutation through injected arguments',async()=>{
 const before=process.env.GROK_SECRET
 try {
  process.env.GROK_SECRET='test-only-secret'
  const response=await handleMcpRequest(new Request('https://example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer test-only-secret'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'budget_snapshot',arguments:{action:'delete_bill',id:'never-delete'}}})}))
  const body=await response.json()
  assert.equal(body.result.isError,true);assert.match(body.result.content[0].text,/Invalid argument/)
 }finally{if(before===undefined)delete process.env.GROK_SECRET;else process.env.GROK_SECRET=before}
})
