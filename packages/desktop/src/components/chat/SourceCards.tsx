import type { CitationSource } from '../../lib/store.js'

interface Props {
  sources: CitationSource[]
}

export function SourceCards({ sources }: Props) {
  // Show up to 6 sources max — keeps the row short; horizontal scroll handles the rest
  const visible = sources.slice(0, 6)

  return (
    <div className="source-cards">
      <div className="source-cards__list">
        {visible.map((s) => (
          <a
            key={s.index}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-card"
          >
            <img
              src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=32`}
              alt=""
              className="source-card__favicon"
              loading="lazy"
            />
            <div className="source-card__text">
              <span className="source-card__title">{s.title}</span>
              <span className="source-card__domain">{s.domain}</span>
            </div>
            <span className="source-card__index">{s.index}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
