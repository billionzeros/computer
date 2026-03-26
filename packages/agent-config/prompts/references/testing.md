## Testing

### Test Structure
- Organize by feature, not by type: `src/features/auth/__tests__/login.test.ts`
- Name tests descriptively: `it("redirects to dashboard after successful login")`
- Follow Arrange-Act-Assert pattern
- One assertion per concept (can have multiple `expect` calls if they test the same thing)

### Unit Tests
- Test pure logic: utilities, transformations, validators, hooks
- Mock external dependencies (API calls, browser APIs), not internal modules
- Use factories for test data: `createUser({ role: "admin" })` instead of inline objects
- Test edge cases: empty input, null, boundary values, error paths

### Component Tests (React Testing Library)
- Query by role, label, or text — not by class/id: `getByRole("button", { name: "Submit" })`
- Test behavior, not implementation: click button → verify result, don't check state
- Use `userEvent` over `fireEvent` for realistic interactions
- Async: `await waitFor(() => expect(...))` or `findByText`
- Don't test styling — test that the right elements render with the right content

### E2E Tests (Playwright)
- Test critical user flows: signup, login, core feature, checkout
- Use page objects to encapsulate page interactions
- Locators: `page.getByRole()`, `page.getByLabel()`, `page.getByText()`
- Wait for network/state, don't use arbitrary timeouts
- Run against a real (or realistic staging) backend

### Playwright Patterns
```typescript
// Page object
class LoginPage {
  constructor(private page: Page) {}
  async login(email: string, password: string) {
    await this.page.getByLabel("Email").fill(email)
    await this.page.getByLabel("Password").fill(password)
    await this.page.getByRole("button", { name: "Sign in" }).click()
  }
}

// Test
test("user can log in", async ({ page }) => {
  const loginPage = new LoginPage(page)
  await page.goto("/login")
  await loginPage.login("user@test.com", "password")
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
})
```

### What to Test
- Happy paths for all features
- Error states (network failure, validation errors, unauthorized)
- Edge cases (empty lists, long text, special characters)
- Accessibility (keyboard nav, screen reader labels)

### What NOT to Test
- Implementation details (internal state, private methods)
- Third-party library behavior
- Pixel-perfect styling (use visual regression tools instead)
- Every possible input combination (focus on boundaries)
