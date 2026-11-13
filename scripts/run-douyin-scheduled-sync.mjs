import { callDouyinWorker } from '../server/douyin-worker-client.mjs'
try {
  let status
  // systemd may be starting the worker at the same time as the timer client.
  for (let attempt = 0; ; attempt++) {
    try { status = await callDouyinWorker('/scheduled-sync', {}); break } catch (error) {
      if (attempt >= 20 || !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  console.log(status.running === 'sync' ? '已启动每日 21:00 库存同步' : '本次无需启动同步')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
