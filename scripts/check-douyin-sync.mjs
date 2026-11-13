// Checks the 抖店 stock sync on this server without changing 抖店: runs one sync of server/douyin-stock.mjs in dry-run
// mode (everything but the import: login check, pop-ups, 库存模版 export and download, plan) against throwaway copies of
// the live browser profile, catalogue and product mapping, and reports what it would change.
// Usage, as the service user with the service's environment: node scripts/check-douyin-sync.mjs
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'

const liveData = resolve(process.env.DATA_DIR || fileURLToPath(new URL('../server/data', import.meta.url)))
const scratch = mkdtempSync(join(dirname(liveData), 'douyin-check-'))
for (const name of ['douyin-browser', 'douyin-products.json']) {
  if (existsSync(join(liveData, name))) cpSync(join(liveData, name), join(scratch, name), { recursive: true, filter: source => !/Singleton/.test(source) && !source.split(/[\\/]/).some(part => ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'Crashpad', 'BrowserMetrics'].includes(part)) })
}
const source = new DatabaseSync(join(liveData, 'catalog.db'), { readOnly: true })
try { await backup(source, join(scratch, 'catalog.db')) } finally { source.close() }
process.env.DATA_DIR = scratch // before the module (and db.mjs) read it
process.env.DOUYIN_SYNC_DRY_RUN = '1'
const { douyinSyncStatus, requestDouyinSync } = await import(process.env.DOUYIN_CHECK_MODULE || '../server/douyin-stock.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const t0 = Date.now()
requestDouyinSync('同步检查')
let run = null
for (let i = 0; i < 20 * 60 && !run; i++) {
  await sleep(1000)
  const status = douyinSyncStatus()
  if (!status.running && !status.scheduled && status.lastRun) run = status.lastRun
}
if (run?.status !== 'ok' && existsSync(join(scratch, 'douyin-sync/sync-last.png'))) {
  mkdirSync(join(liveData, 'douyin-sync'), { recursive: true })
  copyFileSync(join(scratch, 'douyin-sync/sync-last.png'), join(liveData, 'douyin-sync/check-last.png'))
}
try { rmSync(scratch, { recursive: true, force: true }) } catch {} // Windows keeps the copied catalog.db locked
const secs = Math.round((Date.now() - t0) / 1000)
if (run?.status === 'ok') {
  console.log(`同步检查正常（${secs} 秒）：${run.message}${run.unmatchedSample?.length ? `｜对不上的例子：${run.unmatchedSample.join('；')}` : ''}`)
  process.exit(0)
}
console.log(`同步检查失败（${secs} 秒）：${run ? run.message : '20 分钟内没有结束'}`)
process.exit(1)
