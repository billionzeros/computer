import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../lib/store.js'
import { TaskDetailView } from './TaskDetailView.js'
import { TaskListView } from './TaskListView.js'

export function HomeView() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const hasMessages = (activeConv?.messages?.length || 0) > 0
  const hasOpenTask = !!activeConv && hasMessages
  const [leftWidth, setLeftWidth] = useState(() =>
    Math.max(400, Math.floor(window.innerWidth * 0.32)),
  )
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: leftWidth }
      setIsDragging(true)
    },
    [leftWidth],
  )

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const minW = Math.max(360, Math.floor(window.innerWidth * 0.25))
      const maxW = Math.floor(window.innerWidth * 0.75)
      setLeftWidth(Math.min(maxW, Math.max(minW, dragRef.current.startW + delta)))
    }
    const onUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  return (
    <div className="home-layout">
      <div
        className="home-layout__left"
        style={{
          width: hasOpenTask ? leftWidth : '100%',
          flexShrink: hasOpenTask ? 0 : 1,
        }}
      >
        <TaskListView mode={hasOpenTask ? 'compact' : 'full'} />
      </div>

      {hasOpenTask && (
        <div
          className={`home-layout__divider${isDragging ? ' home-layout__divider--active' : ''}`}
          onMouseDown={handleDragStart}
        />
      )}

      {hasOpenTask && (
        <div className="home-layout__right">
          <TaskDetailView />
        </div>
      )}
    </div>
  )
}
