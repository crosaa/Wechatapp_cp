import assert from 'node:assert/strict'
import { scheduledSyncDay } from './douyin-schedule.mjs'

assert.equal(scheduledSyncDay(new Date('2026-11-02T12:59:59Z')), '')
assert.equal(scheduledSyncDay(new Date('2026-11-02T13:00:00Z')), '2026-11-02')
assert.equal(scheduledSyncDay(new Date('2026-11-02T13:00:59Z')), '2026-11-02')
assert.equal(scheduledSyncDay(new Date('2026-11-02T13:01:00Z')), '')
assert.equal(scheduledSyncDay(new Date('2026-11-02T13:00:10Z'), '2026-11-02'), '')
assert.equal(scheduledSyncDay(new Date('2026-11-03T13:00:00Z'), '2026-11-02'), '2026-11-03')
// Beijing date and time stay fixed across the client's US daylight saving transition.
assert.equal(scheduledSyncDay(new Date('2026-11-01T13:00:00Z')), '2026-11-01')
assert.equal(scheduledSyncDay(new Date('2026-12-31T13:00:00Z')), '2026-12-31')
console.log('每日21:00、北京时间、跨日、重复触发和禁止补跑验证通过')
