// Explicit operator-authorized catch-up; does not change the daily 21:00 schedule or retry itself.
if (!process.argv.includes('--authorized-once') || process.env.DOUYIN_SYNC_DRY_RUN) {
  throw new Error('仅允许明确授权的一次实际同步；请使用 --authorized-once，且不能设置试算模式')
}
const { douyinSyncStatus, requestDouyinSync } = await import('../server/douyin-stock.mjs')
const previous = douyinSyncStatus().lastRun?.at
requestDouyinSync('用户授权补同步')
for (let second = 0; second < 21 * 60; second++) {
  await new Promise(resolve => setTimeout(resolve, 1000))
  const status = douyinSyncStatus()
  if (status.running || status.scheduled || !status.lastRun || status.lastRun.at === previous) continue
  console.log(JSON.stringify({ event: 'authorized_sync_result', ...status.lastRun }))
  process.exit(status.lastRun.status === 'ok' ? 0 : 1)
}
console.error('一次补同步超时，请核对抖店批量操作记录后再决定是否重试')
process.exit(1)
