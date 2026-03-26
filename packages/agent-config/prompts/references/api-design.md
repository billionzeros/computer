## API Design

### REST Conventions
- Resources are nouns, plural: `/users`, `/posts`, `/comments`
- HTTP methods map to actions: GET (read), POST (create), PUT/PATCH (update), DELETE (remove)
- Nest for relationships: `/users/:id/posts` (posts belonging to a user)
- Use query params for filtering/sorting: `/posts?status=published&sort=-createdAt`
- Return 201 for creation, 204 for deletion, 200 for everything else (success)

### Response Format
```json
{
  "data": { ... },
  "meta": { "total": 100, "page": 1, "perPage": 20 }
}
```
- Always wrap in `{ data }` for extensibility (add `meta`, `links` later)
- Use consistent field naming: camelCase for JSON
- Include `id` and timestamps (`createdAt`, `updatedAt`) on all resources

### Error Responses
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": [{ "field": "email", "message": "This field is required" }]
  }
}
```
- Use HTTP status codes correctly: 400 (bad input), 401 (not authenticated), 403 (not authorized), 404 (not found), 409 (conflict), 422 (validation), 500 (server error)
- Include machine-readable error code + human-readable message
- Validation errors: return all field errors at once, not one at a time

### Authentication
- Use Bearer tokens in Authorization header: `Authorization: Bearer <token>`
- JWT for stateless auth, session tokens for stateful
- Short-lived access tokens (15min) + long-lived refresh tokens
- Never put tokens in URL query parameters

### Validation
- Validate at the API boundary — before touching the database
- Use schema validation (zod, joi, yup): define once, validate automatically
- Sanitize strings: trim whitespace, normalize email, escape HTML
- Validate types, ranges, lengths, formats, and required fields

### Pagination
- Offset-based: `?page=2&perPage=20` (simple, supports jumping to page)
- Cursor-based: `?cursor=abc123&limit=20` (better for real-time data, no skipping)
- Always return total count and pagination metadata
- Default page size: 20, max: 100

### Versioning
- URL prefix: `/api/v1/users` (simple, explicit)
- Version when breaking changes are needed, not preemptively
- Support previous version for a deprecation period with clear migration docs

### Rate Limiting
- Return `429 Too Many Requests` with `Retry-After` header
- Include rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Different limits for authenticated vs anonymous requests
