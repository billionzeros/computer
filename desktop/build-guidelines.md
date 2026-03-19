# Build Guidelines: Premium, Non-Technical First

## Why this exists
Our current MVP works, but it does not yet feel effortless. This guide is the quality bar for building a product that feels premium, clear, and trustworthy for non-technical people.

## Product principles (non-negotiable)
1. Clarity over power: If a feature is powerful but confusing, simplify the surface.
2. Confidence over cleverness: Every screen should reduce anxiety and answer “What happens next?”
3. One obvious next step: Avoid dead ends and decision overload.
4. Human language only: No engineering jargon in user-facing text.
5. Fast perceived progress: Always show meaningful feedback and momentum.
6. Safe by default: Prevent mistakes before they happen.

## UX quality standards

### 1) First-run experience
- Users should understand the product value in less than 10 seconds.
- First screen must answer:
  - What this product does.
  - What to type/click first.
  - What result they can expect.
- Provide 3-5 high-quality starter actions relevant to real outcomes.

### 2) Information architecture
- Keep navigation shallow and predictable.
- Group by user intent, not technical system boundaries.
- Every page should have:
  - A clear title.
  - A one-line purpose.
  - A primary action.

### 3) Interaction design
- Primary action is visually dominant and singular.
- Use progressive disclosure for advanced options.
- Keep forms short and chunked; do not ask for optional details upfront.
- Confirm destructive actions with plain-language consequences.

### 4) Feedback and status
- Every user action needs immediate response.
- Use visible loading states (skeletons/spinners + status text).
- Long tasks must show:
  - Current step.
  - Estimated remaining time (if possible).
  - What user can do while waiting.
- Errors should include what happened, why (if known), and one recovery action.

### 5) Accessibility and readability
- Minimum body text size: 16px.
- Maintain high contrast in all key controls and text.
- Touch/click targets >= 44x44 px.
- Support keyboard navigation and clear focus states.
- Avoid walls of text; use short lines and meaningful spacing.

### 6) Performance targets
- Time to first meaningful paint: under 2s on typical broadband.
- Input latency should feel instant (<100ms for common actions).
- Never block the entire UI when one region is loading.

## Premium copywriting standards

### Tone
- Calm, capable, and concise.
- Friendly, never casual to the point of ambiguity.
- Avoid hype words (“magic”, “revolutionary”).

### Style rules
- Write at ~8th-grade readability.
- Use specific verbs: “Connect account”, “Run task”, “Review result”.
- Avoid internal terms like “agent runtime”, “context window”, “token usage” unless strictly needed.
- Replace blame language (“You did something wrong”) with supportive language (“We couldn’t complete this step”).

### Copy templates
- Empty state:
  - What this area is for.
  - Why it matters.
  - Exactly what to do next.
- Error state:
  - Plain title.
  - One-sentence explanation.
  - One primary recovery button.
- Success state:
  - What completed.
  - What changed.
  - Suggested next action.

## Visual design standards
- Use a restrained visual system: fewer styles, better hierarchy.
- Prefer strong typography and spacing over decorative noise.
- Keep icon usage consistent and purposeful.
- Build trust with polished micro-details:
  - Clean alignment.
  - Consistent corner radii.
  - Balanced spacing rhythm.
  - Smooth, subtle motion.

## “Claude-like seamlessness” checklist
Before shipping any flow, verify:
- Start-to-finish journey has no confusing branch points.
- Each step has one dominant action.
- Language is understandable by a non-technical first-time user.
- User always knows system status and next step.
- Errors are recoverable in one click or one clear instruction.
- Visual polish is consistent across the full path, not just one screen.

## Definition of done for every feature
A feature is not done unless:
1. Happy path tested by a non-technical person.
2. Empty/loading/error states are fully designed and implemented.
3. All user-facing copy passes clarity and tone checks.
4. Keyboard and screen-size checks pass (desktop + laptop minimum).
5. No obvious jitter, layout jump, or inconsistent spacing remains.

## Team operating rules
- Design the user journey first, then implement screens.
- Review copy and UX together in PRs, not as a post-step.
- Reject “works but rough” if user trust/readability is compromised.
- Ship fewer features with high polish instead of many features with friction.

## PR checklist (paste into PR description)
- [ ] This change improves clarity for non-technical users.
- [ ] Primary action is obvious on each touched screen.
- [ ] Loading/empty/error/success states are covered.
- [ ] Copy uses plain language and avoids internal jargon.
- [ ] Visual hierarchy and spacing are consistent.
- [ ] End-to-end flow feels smooth without manual explanation.
