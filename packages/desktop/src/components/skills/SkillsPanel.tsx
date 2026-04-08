import { Sparkles, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '../../lib/skills.js'
import { useStore } from '../../lib/store.js'
import { skillStore } from '../../lib/store/skillStore.js'
import { SearchInput } from '../ui/SearchInput.js'
import { SkillCard } from './SkillCard.js'
import { SkillDetail } from './SkillDetail.js'

const CATEGORY_ORDER = [
  'Code Quality',
  'Generation',
  'Testing',
  'Understanding',
  'Git & Workflow',
  'Documentation',
]

export function SkillsPanel() {
  const [search, setSearch] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  const skills = skillStore((s) => s.skills)
  const loaded = skillStore((s) => s.loaded)
  const connectionStatus = useStore((s) => s.connectionStatus)

  // Request skills from server on mount
  useEffect(() => {
    if (connectionStatus === 'connected') {
      skillStore.getState().requestSkills()
    }
  }, [connectionStatus])

  const filtered = useMemo(() => {
    if (!search) return skills
    const q = search.toLowerCase()
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q),
    )
  }, [search, skills])

  const featured = useMemo(() => filtered.filter((s) => s.featured), [filtered])

  const categories = useMemo(() => {
    const cats = new Map<string, Skill[]>()
    for (const skill of filtered) {
      if (skill.featured && !search) continue // featured shown separately
      const cat = skill.category || 'Other'
      const list = cats.get(cat) || []
      list.push(skill)
      cats.set(cat, list)
    }
    // Sort by predefined order
    const sorted = new Map<string, Skill[]>()
    for (const cat of CATEGORY_ORDER) {
      const list = cats.get(cat)
      if (list) sorted.set(cat, list)
    }
    // Append any remaining categories
    for (const [cat, list] of cats) {
      if (!sorted.has(cat)) sorted.set(cat, list)
    }
    return sorted
  }, [filtered, search])

  return (
    <div className="skills-page">
      <div className="skills-header">
        <SearchInput value={search} onChange={setSearch} placeholder="Search skills" />
      </div>

      <div className="skills-content">
        {filtered.length === 0 && (
          <div className="skills-empty">
            <Zap size={32} strokeWidth={1.5} />
            <p className="skills-empty__title">No matching skills</p>
            <p className="skills-empty__subtitle">
              Try a different search term or category.
            </p>
          </div>
        )}

        {/* Recommended section */}
        {featured.length > 0 && !search && (
          <div className="skills-category">
            <div className="skills-category__header">
              <Sparkles size={12} strokeWidth={1.5} className="skills-category__star" />
              <span className="skills-category__label">Recommended</span>
              <div className="skills-category__line" />
            </div>
            <div className="skills-grid">
              {featured.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onClick={() => setSelectedSkill(skill)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Category sections */}
        {Array.from(categories.entries()).map(([cat, catSkills]) => (
          <div key={cat} className="skills-category">
            <div className="skills-category__header">
              <span className="skills-category__label">{cat}</span>
              <div className="skills-category__line" />
            </div>
            <div className="skills-grid">
              {catSkills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onClick={() => setSelectedSkill(skill)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <SkillDetail skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
    </div>
  )
}
