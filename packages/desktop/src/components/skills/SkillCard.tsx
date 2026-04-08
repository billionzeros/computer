import {
  BookOpen,
  Braces,
  CheckCircle,
  Code,
  FileText,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Layout,
  LayoutDashboard,
  MessageSquare,
  Server,
  Shield,
  Sparkles,
  TestTube,
  Wand,
  Zap,
} from 'lucide-react'
import type React from 'react'
import type { Skill } from '../../lib/skills.js'

const iconMap: Record<string, React.ElementType> = {
  code: Code,
  wand: Wand,
  shield: Shield,
  layout: Layout,
  'layout-dashboard': LayoutDashboard,
  server: Server,
  braces: Braces,
  'test-tube': TestTube,
  'check-circle': CheckCircle,
  'book-open': BookOpen,
  'git-branch': GitBranch,
  'git-commit': GitCommit,
  'git-pull-request': GitPullRequest,
  'git-merge': GitMerge,
  'file-text': FileText,
  'message-square': MessageSquare,
  sparkles: Sparkles,
  zap: Zap,
}

interface Props {
  skill: Skill
  onClick: () => void
}

export function SkillCard({ skill, onClick }: Props) {
  const Icon = iconMap[skill.icon || ''] || Sparkles

  return (
    <button type="button" onClick={onClick} className="skill-card">
      <div className="skill-card__icon-wrap">
        <Icon size={18} strokeWidth={1.5} className="skill-card__icon" />
      </div>
      <div className="skill-card__info">
        <p className="skill-card__name">{skill.name}</p>
        <p className="skill-card__desc">{skill.description}</p>
      </div>
    </button>
  )
}

export { iconMap as skillIconMap }
