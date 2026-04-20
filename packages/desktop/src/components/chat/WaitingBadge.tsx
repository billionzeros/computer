import { HelpCircle } from 'lucide-react'

interface Props {
  label?: string
  onClick?: () => void
}

export function WaitingBadge({ label = 'Waiting on you', onClick }: Props) {
  return (
    <button type="button" className="ix-waiting" onClick={onClick} title="Scroll to question">
      <span className="ix-waiting__pulse" aria-hidden />
      <HelpCircle size={11} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  )
}
