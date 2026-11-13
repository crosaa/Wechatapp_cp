// Only the 21:00 Beijing timer may claim a daily attempt. No restart catch-up or retries.
export function scheduledSyncDay(now = new Date(), lastDay = '') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]))
  const day = `${parts.year}-${parts.month}-${parts.day}`
  return parts.hour === '21' && parts.minute === '00' && day !== lastDay ? day : ''
}
