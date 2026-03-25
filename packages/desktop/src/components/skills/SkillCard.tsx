import {
  Activity,
  Ban,
  BarChart,
  Box,
  Clock,
  Database,
  Download,
  Eye,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  Key,
  Lock,
  RefreshCw,
  Rocket,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Wifi,
  Zap,
} from 'lucide-react'
import type React from 'react'
import type { Skill } from '../../lib/skills.js'

const iconMap: Record<string, React.ElementType> = {
  rocket: Rocket,
  activity: Activity,
  globe: Globe,
  box: Box,
  'file-text': FileText,
  shield: Shield,
  'shield-check': ShieldCheck,
  database: Database,
  clock: Clock,
  lock: Lock,
  key: Key,
  ban: Ban,
  'hard-drive': HardDrive,
  wifi: Wifi,
  gauge: Gauge,
  users: Users,
  download: Download,
  settings: Settings,
  eye: Eye,
  'bar-chart': BarChart,
  'refresh-cw': RefreshCw,
  zap: Zap,
}

interface Props {
  skill: Skill
  onClick: () => void
}

export function SkillCard({ skill, onClick }: Props) {
  const Icon = iconMap[skill.icon] || Activity

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-white/7 bg-white/[0.03] p-3.5 text-left transition-colors hover:bg-white/[0.05]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-[#171615]">
          <Icon className="h-4.5 w-4.5 text-zinc-300" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-zinc-100">
              {skill.name}
            </p>
            <span className="shrink-0 rounded-full border border-white/8 bg-[#171615] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {skill.category}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-zinc-400">{skill.description}</p>
        </div>
      </div>
    </button>
  )
}
