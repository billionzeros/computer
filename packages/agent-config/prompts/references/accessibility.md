## Accessibility

### Semantic HTML
- Use correct elements: `<button>` for actions, `<a>` for navigation, `<input>` for data entry
- Use landmarks: `<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>`
- Use heading hierarchy (h1→h6) in order — don't skip levels
- Use `<ul>`/`<ol>` for lists, `<table>` for tabular data

### Keyboard Navigation
- All interactive elements must be keyboard accessible (Tab, Enter, Space, Escape, Arrow keys)
- Visible focus indicator: `outline: 2px solid var(--color-ring); outline-offset: 2px`
- Never remove focus outline without replacing it
- Tab order should follow visual order — avoid positive `tabindex`
- Trap focus in modals/dialogs; restore focus on close

### ARIA
- Prefer semantic HTML over ARIA — only add ARIA when HTML isn't enough
- `aria-label` for icon-only buttons: `<button aria-label="Close"><XIcon /></button>`
- `aria-expanded` for toggles (accordion, dropdown)
- `aria-live="polite"` for dynamic content updates (toast, search results)
- `role="alert"` for error messages that need immediate attention
- `aria-hidden="true"` on decorative icons/images

### Color & Contrast
- Text contrast: 4.5:1 minimum (AA), 7:1 preferred (AAA)
- UI components: 3:1 against adjacent colors
- Never convey information by color alone — add icons, text, or patterns
- Test with simulated color blindness (protanopia, deuteranopia)

### Forms
- Every input needs a visible `<label>` (linked via `htmlFor`/`id`)
- Group related fields with `<fieldset>` + `<legend>`
- Error messages: link to field via `aria-describedby`, use `aria-invalid="true"`
- Mark required fields: `aria-required="true"` + visual indicator

### Motion
- Respect `prefers-reduced-motion`: disable or reduce animations
- Keep animations under 300ms for UI transitions
- No auto-playing video/animation without user control
