import { motion } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'

interface Props {
  command: string
  reason: string
  onApprove: () => void
  onDeny: () => void
}

export function ConfirmDialog({ command, reason, onApprove, onDeny }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="ix ix--accent"
    >
      <div className="ix__head">
        <div className="ix__head-left">
          <div className="ix__glyph ix__glyph--danger">
            <ShieldAlert size={14} strokeWidth={1.5} />
          </div>
          <div className="ix__head-text">
            <div className="ix__title">Approval required</div>
            <div className="ix__sub">{reason}</div>
          </div>
        </div>
      </div>
      <pre className="ix__command">{command}</pre>
      <div className="ix__actions">
        <button type="button" className="ix-btn ix-btn--ghost" onClick={onDeny}>
          Cancel
        </button>
        <button type="button" className="ix-btn ix-btn--primary" onClick={onApprove}>
          Approve
        </button>
      </div>
    </motion.div>
  )
}
