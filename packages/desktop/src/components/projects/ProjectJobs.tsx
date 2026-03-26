import { Plus, Zap } from 'lucide-react'

interface Props {
  activeJobs?: number
}

export function ProjectJobs({ activeJobs = 0 }: Props) {
  return (
    <div className="config-section-inline">
      <div className="config-section-inline__header">
        <Zap size={14} strokeWidth={1.5} />
        <span>Jobs</span>
        {activeJobs > 0 && (
          <span className="config-section-inline__badge">{activeJobs}</span>
        )}
      </div>
      {activeJobs > 0 ? (
        <p className="config-section-inline__value">
          {activeJobs} active job{activeJobs !== 1 ? 's' : ''} running
        </p>
      ) : (
        <p className="config-section-inline__hint">
          Automate tasks like scraping, syncing, and monitoring.
        </p>
      )}
      <button type="button" className="config-section-inline__add">
        <Plus size={14} strokeWidth={1.5} />
        <span>Add job</span>
      </button>
    </div>
  )
}
