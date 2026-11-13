import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cpus, freemem, totalmem, loadavg } from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

const round = value => Math.round(value * 100) / 100
const cpuTotals = () => cpus().reduce((total, cpu) => ({
  idle: total.idle + cpu.times.idle,
  all: total.all + Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
}), { idle: 0, all: 0 })
function cgroupUsage() {
  try {
    const group = readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3)
    if (!group || group.includes('..')) return null
    const root = `/sys/fs/cgroup${group}`
    const cpu = readFileSync(`${root}/cpu.stat`, 'utf8').match(/^usage_usec (\d+)/m)
    return { cpuUs: Number(cpu?.[1] || 0), memoryBytes: Number(readFileSync(`${root}/memory.current`, 'utf8')) }
  } catch { return null }
}

// No query strings, request bodies, cookies, login codes or authorization headers enter these logs.
export function createDiagnostics({ service, intervalMs = 60_000, slowRequestMs = 1000, log = console.log } = {}) {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  let lastTime = performance.now(), lastCpu = process.cpuUsage(), lastHost = cpuTotals(), lastGroup = cgroupUsage()
  let active = 0, details = 0, droppedDetails = 0
  let counts = { requests: 0, finished: 0, aborted: 0, slow: 0, errors: 0, status4xx: 0, status5xx: 0 }
  const emit = record => log(JSON.stringify({ at: new Date().toISOString(), service, pid: process.pid, ...record }))
  const detail = record => { if (details++ < 30) emit(record); else droppedDetails++ }
  const path = req => String(req.url || '/').split('?')[0].slice(0, 240)
  const snapshot = () => {
    const now = performance.now(), elapsed = now - lastTime
    const cpu = process.cpuUsage(), host = cpuTotals(), group = cgroupUsage(), memory = process.memoryUsage()
    emit({ event: 'resource', interval_ms: round(elapsed), ...counts, active_requests: active,
      cpu_process_pct: round((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / (elapsed * 10)),
      cpu_host_pct: host.all > lastHost.all ? round(100 * (1 - (host.idle - lastHost.idle) / (host.all - lastHost.all))) : 0,
      cpu_group_pct: group && lastGroup ? round((group.cpuUs - lastGroup.cpuUs) / (elapsed * 10)) : null,
      group_memory_mb: group ? round(group.memoryBytes / 1048576) : null,
      rss_mb: round(memory.rss / 1048576), heap_mb: round(memory.heapUsed / 1048576),
      host_free_mb: round(freemem() / 1048576), host_total_mb: round(totalmem() / 1048576),
      load_1m: loadavg()[0], event_loop_p99_ms: round(delay.percentile(99) / 1e6),
      event_loop_max_ms: round(delay.max / 1e6), dropped_details: droppedDetails })
    lastTime = now; lastCpu = cpu; lastHost = host; lastGroup = group
    counts = { requests: 0, finished: 0, aborted: 0, slow: 0, errors: 0, status4xx: 0, status5xx: 0 }
    details = 0; droppedDetails = 0; delay.reset()
  }
  const timer = setInterval(snapshot, intervalMs)
  timer.unref()
  return {
    observe(req, res) {
      const id = String(req.headers['x-request-id'] || '')
      req.diagnosticId = /^[a-zA-Z0-9-]{16,64}$/.test(id) ? id : randomUUID()
      res.setHeader('x-request-id', req.diagnosticId)
      const start = performance.now()
      counts.requests++; active++
      let done = false
      const finish = aborted => {
        if (done) return
        done = true; active--
        const ms = round(performance.now() - start)
        if (aborted) counts.aborted++; else counts.finished++
        if (!aborted && res.statusCode >= 500) counts.status5xx++
        else if (!aborted && res.statusCode >= 400) counts.status4xx++
        if (ms >= slowRequestMs) counts.slow++
        if (aborted || ms >= slowRequestMs || res.statusCode >= 500) detail({
          event: aborted ? 'request_aborted' : 'slow_or_failed_request', request_id: req.diagnosticId,
          method: req.method, path: path(req), status: aborted ? 499 : res.statusCode, duration_ms: ms })
      }
      res.once('finish', () => finish(false))
      res.once('close', () => finish(!res.writableFinished))
    },
    recordError(req, error) {
      counts.errors++
      detail({ event: 'app_error', request_id: req.diagnosticId, path: path(req),
        error_type: error?.name || 'Error', code: String(error?.code || '').slice(0, 80) })
    },
    snapshot,
    close() { clearInterval(timer); delay.disable() }
  }
}
