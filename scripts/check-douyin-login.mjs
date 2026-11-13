// Checks the 抖店 QR login on this server without anyone scanning: runs server/douyin-stock.mjs against a throwaway
// copy of the live browser profile (DATA_DIR/douyin-browser) and reports, for each run, whether the QR code shows up
// and how fast, and whether clicks on the login-box picture reach 抖店's page (switch to phone login and back).
// A profile that is still logged in is reported as such: then no QR code is needed.
// Usage, as the service user with the service's environment: node scripts/check-douyin-login.mjs [runs=3]
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runs = Number(process.argv[2]) || 3
const liveData = resolve(process.env.DATA_DIR || fileURLToPath(new URL('../server/data', import.meta.url)))
const scratch = mkdtempSync(join(dirname(liveData), 'douyin-check-'))
if (existsSync(join(liveData, 'douyin-browser'))) {
  cpSync(join(liveData, 'douyin-browser'), join(scratch, 'douyin-browser'), { recursive: true, filter: source => !/Singleton/.test(source) })
}
process.env.DATA_DIR = scratch // before the module (and db.mjs) read it
const { douyinLoginAction, douyinSyncStatus, startDouyinLogin, stopDouyinLogin } = await import('../server/douyin-stock.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Waits until the login reaches one of the given steps (or ends); returns its status and how long it took.
async function waitFor(steps, seconds) {
  const start = Date.now()
  while (Date.now() - start < seconds * 1000) {
    const status = douyinSyncStatus()
    const step = status.login?.status
    if (steps.includes(step) && (step !== 'waiting' || status.login.qr)) return { step, secs: (Date.now() - start) / 1000, status }
    if (!status.running && ['error', 'expired', 'done'].includes(step)) return { step, secs: (Date.now() - start) / 1000, status }
    await sleep(500)
  }
  return { step: 'timeout', secs: seconds, status: douyinSyncStatus() }
}

let failures = 0
try {
  for (let run = 1; run <= runs; run++) {
    const t0 = Date.now()
    await startDouyinLogin()
    const shown = await waitFor(['waiting', 'done'], 90)
    const total = ((Date.now() - t0) / 1000).toFixed(1)
    if (shown.step === 'done') {
      // A login is followed by a sync a few seconds later; this check must not run one, so it ends here.
      console.log(`第 ${run} 次：已经是登录状态，不用扫码（${total} 秒）：${shown.status.login.message}`)
      break
    } else if (shown.step === 'waiting' && /^data:image\//.test(shown.status.login.qr)) {
      // The relay: the corner of the login box switches 抖店 to phone login, the same corner switches back.
      await douyinLoginAction({ action: 'click', x: 0.95, y: 0.07 })
      const switched = await waitFor(['other', 'verify'], 20)
      await douyinLoginAction({ action: 'click', x: 0.95, y: 0.07 })
      const back = await waitFor(['waiting'], 20)
      const relayOk = ['other', 'verify'].includes(switched.step) && back.step === 'waiting'
      console.log(`第 ${run} 次：二维码 ${total} 秒出现（${Math.round(shown.status.login.qr.length / 1024)} KB）；点图片转发${relayOk ? '正常' : `不正常（切换后 ${switched.step}，切回 ${back.step}）`}`)
      if (!relayOk) failures++
    } else {
      console.log(`第 ${run} 次：失败（${shown.step}，${total} 秒）：${shown.status.login?.message || ''}`)
      failures++
    }
    stopDouyinLogin()
    for (let i = 0; i < 60 && douyinSyncStatus().running; i++) await sleep(500)
  }
} finally {
  stopDouyinLogin()
  for (let i = 0; i < 60 && douyinSyncStatus().running; i++) await sleep(500)
  // Windows keeps the throwaway catalog.db locked while this process runs; Linux removes it.
  try { rmSync(scratch, { recursive: true, force: true }) } catch {}
}
console.log(failures ? `有 ${failures} 次不正常` : `全部 ${runs} 次正常`)
process.exit(failures ? 1 : 0)
