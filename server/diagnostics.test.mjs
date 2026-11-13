import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'
import { once } from 'node:events'
import { createDiagnostics } from './diagnostics.mjs'

const logs = []
const diagnostics = createDiagnostics({ service: 'test', slowRequestMs: 5, log: text => logs.push(JSON.parse(text)) })
let abortedArrived
const abortedReady = new Promise(resolve => { abortedArrived = resolve })
const server = createServer((req, res) => {
  diagnostics.observe(req, res)
  if (req.url.startsWith('/abort')) { abortedArrived(); return }
  if (req.url.startsWith('/error')) {
    diagnostics.recordError(req, new Error('private-message'))
    res.writeHead(500); res.end(); return
  }
  setTimeout(() => res.end('ok'), 15)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
try {
  const response = await fetch(`${base}/slow?password=private-value`, { headers: { 'x-request-id': 'test-request-id-1234' } })
  await response.text()
  assert.equal(response.headers.get('x-request-id'), 'test-request-id-1234')
  await (await fetch(`${base}/error`)).text()
  const aborted = get(`${base}/abort?token=private-value`)
  aborted.on('error', () => {})
  await abortedReady
  aborted.destroy()
  for (let i = 0; i < 30 && !logs.some(item => item.event === 'request_aborted'); i++) await new Promise(resolve => setTimeout(resolve, 10))
  diagnostics.snapshot()
  const stats = logs.find(item => item.event === 'resource')
  assert.equal(stats.requests, 3)
  assert.equal(stats.finished, 2)
  assert.equal(stats.aborted, 1)
  assert.equal(stats.errors, 1)
  assert.equal(stats.status5xx, 1)
  assert.equal(stats.active_requests, 0)
  assert.ok(stats.rss_mb > 0)
  assert.ok(Number.isFinite(stats.event_loop_p99_ms))
  assert.ok(logs.some(item => item.path === '/slow' && item.duration_ms >= 5))
  assert.ok(!JSON.stringify(logs).includes('private-'))
  // A surge cannot make the application's detailed diagnostics grow without limit.
  for (let i = 0; i < 40; i++) diagnostics.recordError({ url: '/bad?secret=private-value' }, new Error())
  diagnostics.snapshot()
  assert.equal(logs.at(-1).dropped_details, 10)
  console.log('诊断验证通过：耗时、请求ID、客户端中断、异常、资源指标、敏感信息过滤和日志限流')
} finally {
  diagnostics.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
