## Responsive Design

### Breakpoints
Use mobile-first (min-width) breakpoints:
- sm: 640px (large phones, landscape)
- md: 768px (tablets)
- lg: 1024px (small laptops)
- xl: 1280px (desktops)
- 2xl: 1536px (large screens)

### Approach
- Start with the mobile layout, add complexity at larger breakpoints
- Use `min-width` media queries, never `max-width` (mobile-first)
- Test at breakpoint boundaries and between them

### Layout Patterns
- **Stack → Row**: vertical stack on mobile, horizontal row on desktop (`flex-direction: column` → `row`)
- **Sidebar collapse**: sidebar becomes drawer/sheet on mobile
- **Grid reflow**: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` for auto-responsive grids
- **Container queries**: use `@container` for component-level responsiveness instead of viewport

### Fluid Sizing
- Use `clamp()` for fluid typography: `font-size: clamp(1rem, 0.5rem + 1.5vw, 1.5rem)`
- Use `min()` / `max()` for fluid spacing and widths
- Avoid fixed pixel widths on containers — use `max-width` with percentage fallback

### Touch Targets
- Minimum 44×44px for interactive elements on mobile
- Add padding, not just visual size — the tap area matters
- Space touch targets at least 8px apart

### Images & Media
- Always set `max-width: 100%; height: auto` on images
- Use `<picture>` with `srcset` for responsive images
- Lazy-load below-fold images: `loading="lazy"`
- Use `aspect-ratio` to prevent layout shift

### Hide/Show
- Prefer rearranging over hiding — hidden content is lost context
- When hiding: `hidden` attribute + media query, not `display: none` inline
- Keep navigation accessible on all sizes (burger menu, bottom nav, etc.)
