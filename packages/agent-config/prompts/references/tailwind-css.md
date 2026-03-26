## Tailwind CSS

### Utility-First Approach
- Style directly in markup: `<div className="flex items-center gap-4 p-6 rounded-lg bg-card">`
- Extract components (React/Vue), not CSS classes — reuse via composition
- Only create `@apply` abstractions for truly global base styles

### Layout
- Flexbox: `flex`, `flex-col`, `items-center`, `justify-between`, `gap-4`
- Grid: `grid`, `grid-cols-3`, `gap-6`, `col-span-2`
- Auto-responsive grid: `grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))]`
- Container: `container mx-auto px-4` (centered, padded)
- Stack pattern: `flex flex-col gap-4` (vertical), `flex gap-4` (horizontal)

### Spacing & Sizing
- Padding/margin: `p-4` (16px), `px-6` (24px horizontal), `mt-8` (32px top)
- Width/height: `w-full`, `h-screen`, `min-h-0`, `max-w-md`
- Size shorthand: `size-10` = `w-10 h-10`

### Colors
- Semantic: `bg-background`, `text-foreground`, `border-border`, `bg-muted`
- State: `hover:bg-accent`, `focus-visible:ring-ring`, `disabled:opacity-50`
- Use opacity modifier: `bg-primary/10` for transparent variants

### Responsive
- Mobile-first prefixes: `sm:`, `md:`, `lg:`, `xl:`, `2xl:`
- Example: `flex-col md:flex-row` (stack on mobile, row on desktop)
- Hide/show: `hidden md:block`, `md:hidden`

### Dark Mode
- Class strategy: `dark:bg-gray-900`, `dark:text-white`
- Prefer CSS variable approach (shadcn): define tokens that swap in `.dark`

### Interactive States
- Hover: `hover:bg-accent hover:text-accent-foreground`
- Focus: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
- Active: `active:scale-95`
- Disabled: `disabled:pointer-events-none disabled:opacity-50`
- Group hover: `group` on parent, `group-hover:opacity-100` on child

### Animation
- Transitions: `transition-colors`, `transition-all duration-200`
- Animate: `animate-spin`, `animate-pulse`, `animate-in fade-in`
- Respect reduced motion: `motion-reduce:transition-none`

### Common Patterns
- Visually hidden: `sr-only` (screen reader only)
- Truncate: `truncate` (single line) or `line-clamp-2` (multi-line)
- Divide: `divide-y divide-border` (borders between children)
- Ring: `ring-2 ring-ring ring-offset-2` (focus indicator)
