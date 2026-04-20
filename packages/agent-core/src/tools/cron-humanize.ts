/**
 * Tiny cron → human-readable helper, shared between the inline
 * Pi SDK `routine` tool (agent.ts) and the harness factory
 * (`routine-factory.ts`). Identical behavior — extracted only so the
 * two callers don't drift.
 */

/** Turn a 5-field cron expression into a short human-readable string. */
export function humanizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  const [min, hour, dom, mon, dow] = parts

  // Every N minutes
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(min.slice(2))
    return n === 1 ? 'every minute' : `every ${n} minutes`
  }
  // Every N hours
  if (min !== '*' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(hour.slice(2))
    return n === 1 ? 'every hour' : `every ${n} hours`
  }
  // Daily at HH:MM
  if (
    min !== '*' &&
    hour !== '*' &&
    !hour.includes('/') &&
    dom === '*' &&
    mon === '*' &&
    dow === '*'
  ) {
    const h = Number(hour)
    const m = String(min).padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `daily at ${h12}:${m} ${ampm}`
  }
  // Weekdays
  if (dow === '1-5' && dom === '*' && mon === '*') {
    return `weekdays at ${hour}:${String(min).padStart(2, '0')}`
  }
  return expr
}
