## Typography

### Font Stack
- Sans-serif system stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Monospace: `"JetBrains Mono", "Fira Code", ui-monospace, monospace`
- Load custom fonts with `font-display: swap` to avoid FOIT

### Size Scale
Use a modular scale. Recommended base 16px with ratio ~1.25:
- xs: 12px / sm: 14px / base: 16px / lg: 18px / xl: 20px / 2xl: 24px / 3xl: 30px / 4xl: 36px

### Line Height
- Body text: 1.5–1.6 (comfortable reading)
- Headings: 1.1–1.3 (tighter for large text)
- UI labels/buttons: 1.0–1.25 (compact)

### Font Weight
- Regular: 400 (body) / Medium: 500 (emphasis, labels) / Semibold: 600 (headings, buttons) / Bold: 700 (strong headings)
- Avoid light (300) weights at small sizes — poor readability on low-DPI screens

### Heading Hierarchy
- h1: 30–36px, semibold — page titles only, one per page
- h2: 24px, semibold — section headings
- h3: 20px, medium — subsection headings
- h4: 16–18px, medium — group labels
- Maintain clear visual steps between levels

### Prose
- Max line width: 65–75 characters (`max-width: 65ch`)
- Paragraph spacing: 1em–1.5em between blocks
- Use `text-wrap: balance` for headings, `text-wrap: pretty` for body (where supported)

### Truncation
- Single line: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- Multi-line: `-webkit-line-clamp` with `display: -webkit-box`
- Always provide full text via `title` attribute or tooltip on truncated content
