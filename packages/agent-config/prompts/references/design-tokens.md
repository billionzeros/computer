## Design Tokens

Use CSS custom properties (variables) as the single source of truth for all visual values. Never hardcode colors, spacing, or sizing.

### Colors
- Define a neutral scale (50–950) and brand/accent scales
- Use semantic aliases: `--color-bg`, `--color-fg`, `--color-muted`, `--color-accent`
- Support dark mode by swapping token values, not component styles
- Keep contrast ratios WCAG AA minimum (4.5:1 text, 3:1 large text/UI)

### Spacing
- Use a consistent scale: 0, 1px, 2px, 4px, 6px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px
- Map to named tokens: `--space-xs` (4px), `--space-sm` (8px), `--space-md` (16px), `--space-lg` (24px), `--space-xl` (32px)
- Use consistent spacing within components (padding) and between components (gap)

### Border Radius
- Small: 4px (inputs, badges) / Medium: 8px (cards, dialogs) / Large: 12–16px (modals, sheets)
- Use `--radius` base token, derive others: `calc(var(--radius) - 2px)`

### Shadows
- Elevation levels: sm (subtle lift), md (dropdown/card), lg (modal/dialog), xl (popover)
- Shadows should use semi-transparent black, not gray — works on any background

### Z-Index
- Layer system: base (0), dropdown (50), sticky (100), overlay (200), modal (300), popover (400), toast (500)
- Never use arbitrary z-index values — always reference the scale
