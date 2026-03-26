## Component Patterns

### Composition
- Prefer composition over configuration — use children/slots instead of prop overload
- Keep components single-responsibility: a `Card` renders a card, not card + modal + tooltip
- Use compound components for related pieces: `<Select>`, `<Select.Trigger>`, `<Select.Content>`

### Common UI Patterns

**Card**: Container with optional header, body, footer. Use `flex-col` layout. Keep padding consistent (16–24px). Add hover state only if interactive.

**Modal/Dialog**: Overlay + centered panel. Always trap focus inside. Close on Escape and overlay click. Animate in/out (scale + fade). Use `<dialog>` element or radix Dialog.

**Form**: Label above input (not placeholder-as-label). Group related fields. Show validation errors inline below field. Disable submit until valid. Use `<form>` with proper `onSubmit`.

**Navigation**: Horizontal nav for desktop, collapsible for mobile. Highlight active item. Use `<nav>` landmark. Keep to 5–7 top-level items max.

**List/Table**: Virtualize long lists (>100 items). Add empty state. Support loading skeleton. Tables: sticky header, horizontal scroll on mobile, right-align numbers.

**Toast/Notification**: Auto-dismiss (5s default). Stack from bottom-right. Include dismiss button. Use `role="status"` for info, `role="alert"` for errors.

### State Management
- Loading: skeleton/spinner, disable interactions
- Empty: helpful message + CTA ("No items yet. Create one?")
- Error: inline message, retry action, don't clear user input
- Success: brief confirmation, auto-transition to next state

### Component API Design
- Use `className` prop for style overrides (merge with `cn()`)
- Forward `ref` for DOM access
- Spread remaining props onto root element (`...rest`)
- Use `variants` (via cva/class-variance-authority) for visual variations
- Keep required props minimal — good defaults over configuration
