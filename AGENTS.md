# food-market-api: agent rules

## What this is
Task 1 of a product engineering bootcamp: a public REST API for a food delivery market, plus one small consumer page that calls the deployed API. The API is the product.

## Out of scope (do not build)
Authentication, admin panel, landing page, any UI beyond the single consumer page, anything not asked for in the current prompt.

## Stack
Next.js (App Router, route handlers) with TypeScript, Prisma, PostgreSQL, Zod, @faker-js/faker. Use the latest stable versions and follow the docs for the versions actually installed. It will be deployed as a long-running Node server, not serverless.

## Resources
restaurants, menu_items, customers, orders, order_items.
- A restaurant has many menu items.
- A customer has many orders.
- An order belongs to one customer and one restaurant, and has many order items.
- An order item belongs to one order and one menu item, and stores the quantity and the unit price at the time of ordering.

## API rules (every endpoint)
- All paths start with /api/v1/. Resources are plural nouns in kebab-case. The HTTP method is the verb.
- IDs are generated UUIDs. Never sequential integers.
- Money is an integer in minor units (kobo) with a currency column beside it. Never decimals or floats.
- Success envelope: { "data": ..., "meta": ... }. List meta: { total, limit, nextCursor, hasMore }.
- Error envelope: { "error": { "code", "message", "details"? } } with an honest status code. Never 200 with an error in the body.
- Every list endpoint supports cursor pagination (limit default 20, max 100, anything above the max is clamped), filtering on at least two fields, and ?sort=&order=.
- Bad query input (negative or non-numeric limit, unknown sort field, invalid cursor, malformed ID) returns 400. A well-formed ID that does not exist returns 404. A body that fails validation returns 422 naming each field. Rate limit exceeded returns 429 with Retry-After. Unexpected failures return 500 with no internals leaked.
- All request bodies and query strings are validated with Zod schemas kept in src/lib/validation/.
- Every tunable number (pagination default and max, rate limit count and window) lives in src/config.ts, never in a handler.

## How you work
1. For each prompt, write a short plan and wait for my approval before changing files.
2. Build only what the prompt asks.
3. Verify by actually running it and show me the real output. Never claim something works without running it.
4. Commit in small steps with clear messages. No co-author or attribution trailers.
5. Never read, write or print secrets. I type values into .env myself. Keep .env out of git and .env.example current.
6. Append every real error you hit to BUILD_LOG.md (symptom, cause, fix). Never invent problems.
7. Append every design choice and the alternative rejected to DECISIONS.md.
8. Save evidence (terminal output, screenshots) under evidence/.
9. If a prompt conflicts with these rules or looks wrong, stop and ask.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
