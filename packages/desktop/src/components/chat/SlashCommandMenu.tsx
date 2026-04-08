import { motion } from 'framer-motion'
import { Activity, Box, Clock, Database, FileText, Globe, Rocket, Shield } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { type Skill, getSkillCommand, getSkills } from '../../lib/skills.js'
import { skillIconMap } from '../skills/SkillCard.js'

const fallbackIconMap: Record<string, React.ElementType> = {
  rocket: Rocket,
  activity: Activity,
  globe: Globe,
  box: Box,
  'file-text': FileText,
  shield: Shield,
  database: Database,
  clock: Clock,
}

interface Props {
  filter: string
  onSelect: (skill: Skill) => void
  onClose: () => void
  visible: boolean
}

export function SlashCommandMenu({ filter, onSelect, onClose, visible }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const skills = getSkills().filter((s) => {
    const cmd = getSkillCommand(s)
    return (
      cmd.toLowerCase().includes(filter.toLowerCase()) ||
      s.name.toLowerCase().includes(filter.toLowerCase())
    )
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: filter drives index reset
  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, skills.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && skills[selectedIndex]) {
        e.preventDefault()
        onSelect(skills[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, skills, selectedIndex, onSelect, onClose])

  if (!visible || skills.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.1 }}
      className="slash-menu"
    >
      <div className="slash-menu__header">
        <span className="slash-menu__headerLabel">Skills</span>
      </div>
      {skills.map((skill, i) => {
        const Icon = skillIconMap[skill.icon || ''] || fallbackIconMap[skill.icon || ''] || Activity
        const command = getSkillCommand(skill)
        return (
          <button
            type="button"
            key={skill.name}
            onClick={() => onSelect(skill)}
            className={
              i === selectedIndex ? 'slash-menu__item slash-menu__item--active' : 'slash-menu__item'
            }
          >
            <Icon className="slash-menu__itemIcon" />
            <div className="slash-menu__itemCopy">
              <div className="slash-menu__itemRow">
                <span className="slash-menu__itemName">{skill.name}</span>
                <span className="slash-menu__itemCommand">{command}</span>
              </div>
              <p className="slash-menu__itemDescription">{skill.description}</p>
            </div>
          </button>
        )
      })}
    </motion.div>
  )
}
