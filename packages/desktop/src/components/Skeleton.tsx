interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string | number
  className?: string
  variant?: 'text' | 'circle' | 'rect'
}

export function Skeleton({
  width,
  height,
  borderRadius,
  className = '',
  variant = 'text',
}: SkeletonProps) {
  const style: React.CSSProperties = {}

  if (width) style.width = typeof width === 'number' ? `${width}px` : width
  if (height) style.height = typeof height === 'number' ? `${height}px` : height

  if (variant === 'circle') {
    style.borderRadius = '50%'
    if (!width) style.width = '32px'
    if (!height) style.height = style.width
  } else if (variant === 'rect') {
    style.borderRadius = typeof borderRadius === 'number' ? `${borderRadius}px` : (borderRadius || '8px')
  } else {
    style.borderRadius = typeof borderRadius === 'number' ? `${borderRadius}px` : (borderRadius || '4px')
    if (!height) style.height = '14px'
  }

  return <div className={`skeleton ${className}`} style={style} />
}

/** Multiple skeleton lines for text blocks */
export function SkeletonLines({ count = 3, gap = 8 }: { count?: number; gap?: number }) {
  const widths = ['100%', '85%', '70%', '90%', '60%']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={`skeleton-line-${widths[i % widths.length]}-${i}`} width={widths[i % widths.length]} />
      ))}
    </div>
  )
}
