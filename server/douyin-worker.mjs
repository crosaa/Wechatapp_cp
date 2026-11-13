// Runs outside the public API's process and systemd resource group, including Chromium and XLSX work.
import { createServer } from 'node:http'
import { createDiagnostics } from './diagnostics.mjs'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { workerSocket } from './douyin-worker-client.mjs'
import { douyinSyncStatus, startDouyinLogin, douyinLoginAction, runScheduledDouyinSync } from './douyin-stock.mjs'

if (process.platform !== 'win32' && existsSync(workerSocket)) unlinkSync(workerSocket)
const diagnostics = createDiagnostics({ service: 'douyin' })
const server = createServer(async (req, res) => {
  diagnostics.observe(req, res)
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 4096) return send(413, { error: '请求过大' })
    }
    let data
    if (req.url === '/status' && req.method === 'GET') data = douyinSyncStatus()
    else if (req.url === '/login' && req.method === 'POST') data = await startDouyinLogin()
    else if (req.url === '/login/action' && req.method === 'POST') data = await douyinLoginAction(JSON.parse(body || '{}'))
    else if (req.url === '/scheduled-sync' && req.method === 'POST') data = runScheduledDouyinSync()
    else return send(404, { error: '接口不存在' })
    send(200, { data: { ...data, available: true, schedule: '每天北京时间 21:00' } })
  } catch (error) {
    diagnostics.recordError(req, error)
    send(409, { error: error.message.split('\n')[0] })
  }
})
server.listen(workerSocket, () => {
  if (process.platform !== 'win32') chmodSync(workerSocket, 0o600)
  console.log('抖店独立服务已启动：仅每天北京时间 21:00 同步库存')
})
