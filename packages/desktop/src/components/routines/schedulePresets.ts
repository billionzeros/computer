export type SchedulePreset = {
  id: string
  label: string
  human: string
  cron: string | null
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: 'weekday-morn', label: 'Weekdays · 8:00', human: 'Mon–Fri at 8:00', cron: '0 8 * * 1-5' },
  { id: 'daily-morn', label: 'Daily · 9:00', human: 'Every day at 9:00', cron: '0 9 * * *' },
  {
    id: 'weekday-eve',
    label: 'Weekdays · 18:00',
    human: 'Weekdays at 18:00',
    cron: '0 18 * * 1-5',
  },
  { id: 'weekly-fri', label: 'Fridays · 16:00', human: 'Fridays at 16:00', cron: '0 16 * * 5' },
  { id: 'manual', label: 'Manual only', human: 'Run on demand', cron: null },
]

export function cronForPreset(presetId: string): string | null {
  const preset = SCHEDULE_PRESETS.find((p) => p.id === presetId)
  return preset?.cron ?? null
}

export function presetFromCron(cron: string | null): string {
  if (!cron) return 'manual'
  const hit = SCHEDULE_PRESETS.find((p) => p.cron === cron)
  return hit?.id ?? 'weekday-morn'
}
