## Code Quality

### Naming
- Components: PascalCase (`UserProfile`, `DataTable`)
- Functions/variables: camelCase (`getUserById`, `isLoading`)
- Constants: UPPER_SNAKE for true constants (`MAX_RETRIES`), camelCase for config objects
- Files: kebab-case for utilities (`date-utils.ts`), PascalCase for components (`UserProfile.tsx`)
- Booleans: prefix with is/has/can/should (`isActive`, `hasPermission`, `canEdit`)

### File Structure
- One component per file, named same as the component
- Co-locate related files: component + test + styles + types in same directory
- Index files for public API only — don't barrel-export everything
- Keep files under 300 lines — split if larger

### TypeScript
- Prefer `interface` for object shapes, `type` for unions/intersections
- Use strict mode (`strict: true` in tsconfig)
- Avoid `any` — use `unknown` and narrow, or generic constraints
- Infer return types for internal functions, annotate exports
- Use discriminated unions for state: `{ status: "loading" } | { status: "success"; data: T } | { status: "error"; error: Error }`

### Error Handling
- Throw errors at boundaries (API calls, user input), handle where you can recover
- Use typed errors: `class NotFoundError extends Error { ... }`
- Never silently swallow errors — at minimum log them
- Return error states from async operations, don't just catch-and-ignore
- Use `Result` pattern for operations that can fail: `{ ok: true, data } | { ok: false, error }`

### Functions
- Single responsibility — if you need "and" to describe it, split it
- Max 3 parameters — use an options object for more
- Pure functions where possible — same input always gives same output
- Early returns for guard clauses — reduce nesting

### Imports
- Group: external deps → internal packages → relative imports (with blank lines between)
- Use path aliases (`@/components/`, `@/lib/`) instead of deep relative paths
- Import types with `import type { ... }` to avoid runtime overhead

### Performance
- Memoize expensive computations: `useMemo`, `useCallback` (only when measured need)
- Virtualize long lists (>50 items): `@tanstack/react-virtual`
- Lazy load routes and heavy components: `React.lazy()` + `Suspense`
- Debounce search/filter inputs (300ms default)
- Avoid re-renders: stable references, proper key props, memo where measured
