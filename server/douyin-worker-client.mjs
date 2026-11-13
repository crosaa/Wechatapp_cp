import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)))
export const workerSocket = process.env.DOUYIN_WORKER_SOCKET || (process.platform === 'win32'
  ? `\\\\.\\pipe\\cpminiapp-douyin-${createHash('sha1').update(dataDir).digest('hex')}`
  : join(dataDir, 'douyin-worker.sock'))

export function callDouyinWorker(path, body, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: workerSocket, path, method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('error', reject)
      res.on('end', () => {
        try {
          const result = JSON.parse(text)
          if (res.statusCode >= 400) reject(new Error(result.error || '抖店独立服务请求失败'))
          else resolve(result.data)
        } catch (error) { reject(error) }
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error('抖店独立服务响应超时')))
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

export async function douyinSyncStatus() {
  try { return await callDouyinWorker('/status', undefined, 2000) } catch {
    return { available: false, shopName: process.env.DOUYIN_SHOP_NAME || '普润户外服饰店',
      syncedToday: false, loggedIn: null, running: null, scheduled: null, login: null,
      lastRun: null, lastSuccessAt: null, history: [], mappingCount: 0,
      schedule: '每天北京时间 21:00', message: '抖店独立服务暂不可用，请检查同步服务' }
  }
}
export const startDouyinLogin = () => callDouyinWorker('/login', {})
export const douyinLoginAction = body => callDouyinWorker('/login/action', body)
