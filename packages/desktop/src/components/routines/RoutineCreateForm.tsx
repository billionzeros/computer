import type { RoutineSession } from '@anton/protocol'
import { Check, ChevronLeft, Folder } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SCHEDULE_PRESETS, presetFromCron } from './schedulePresets.js'

export type RoutineTemplate = {
  id: string
  name: string
  blurb: string
  instructions: string
  presetId: string
}

export type RoutineDraft = {
  name: string
  description: string
  instructions: string
  presetId: string
}

type Mode = 'create' | 'edit'

interface Props {
  mode: Mode
  initial?: RoutineSession | RoutineTemplate | null
  isFirst?: boolean
  folderLabel?: string
  onCancel: () => void
  onSave: (draft: RoutineDraft) => void
}

function seedFromInitial(
  mode: Mode,
  initial: RoutineSession | RoutineTemplate | null | undefined,
): RoutineDraft {
  if (!initial) {
    return { name: '', description: '', instructions: '', presetId: 'weekday-morn' }
  }

  if (mode === 'edit' && 'sessionId' in initial) {
    const meta = initial.agent
    return {
      name: meta.name,
      description: meta.description ?? '',
      instructions: meta.instructions ?? '',
      presetId: presetFromCron(meta.schedule?.cron ?? null),
    }
  }

  const tpl = initial as RoutineTemplate
  return {
    name: tpl.name,
    description: tpl.blurb,
    instructions: tpl.instructions,
    presetId: tpl.presetId,
  }
}

export function RoutineCreateForm({ mode, initial, isFirst, folderLabel, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<RoutineDraft>(() => seedFromInitial(mode, initial))
  const nameRef = useRef<HTMLInputElement>(null)
  const isFromTemplate = mode === 'create' && initial && !('sessionId' in initial)

  useEffect(() => {
    if (mode === 'create' && !isFromTemplate && nameRef.current) nameRef.current.focus()
  }, [mode, isFromTemplate])

  const canSave = draft.name.trim().length > 0 && draft.instructions.trim().length > 0

  const title =
    mode === 'edit' ? 'Edit routine' : isFromTemplate ? 'Adapt this template' : 'New routine'
  const blurbText =
    mode === 'edit'
      ? 'Changes apply to the next run.'
      : isFromTemplate
        ? "Everything's filled in — tweak what you want and save."
        : 'Describe what Anton should do and when. You can edit any of this later.'
  const saveLabel = mode === 'edit' ? 'Save changes' : 'Save routine'

  const handleSave = () => {
    if (!canSave) return
    onSave(draft)
  }

  return (
    <div className="rt-detail rt-create">
      {(!isFirst || mode === 'edit') && (
        <button type="button" className="conv-back" onClick={onCancel}>
          <ChevronLeft size={14} strokeWidth={1.5} /> Cancel
        </button>
      )}

      <div className="rt-create__head">
        <h1 className="rt-head__title">{title}</h1>
        <div className="rt-head__blurb">{blurbText}</div>
      </div>

      <div className="rt-field">
        <label className="rt-field__label" htmlFor="rt-name">
          Name
        </label>
        <input
          ref={nameRef}
          id="rt-name"
          className="rt-input"
          placeholder="e.g. Morning focus"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <div className="rt-field">
        <label className="rt-field__label" htmlFor="rt-inst">
          What should Anton do?
        </label>
        <textarea
          id="rt-inst"
          className="rt-input rt-input--area"
          rows={5}
          placeholder="Describe the routine in plain language. Anton will figure out which tools to use."
          value={draft.instructions}
          onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
        />
        <div className="rt-hint">
          Tip: mention specific apps by name — Gmail, Slack, GitHub — and Anton will use them.
        </div>
      </div>

      <div className="rt-field">
        <div className="rt-field__label">Schedule</div>
        <div className="rt-sched">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rt-sched__opt${draft.presetId === p.id ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, presetId: p.id }))}
            >
              <span className="rt-sched__opt-label">{p.label}</span>
              {draft.presetId === p.id && <Check size={11} strokeWidth={1.5} />}
            </button>
          ))}
        </div>
      </div>

      {folderLabel && (
        <div className="rt-field rt-field--inline">
          <div className="rt-field__label">Folder</div>
          <div className="rt-field__value rt-field__folder">
            <Folder size={13} strokeWidth={1.5} />
            <span>{folderLabel}</span>
          </div>
          <div className="rt-hint">Files written by this routine land here.</div>
        </div>
      )}

      <div className="rt-create__footer">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSave}
          onClick={handleSave}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}
