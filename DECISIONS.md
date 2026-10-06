# Decisions

Every design choice, with the alternative rejected. Newest at the bottom.

## 1. UUID primary keys, not sequential integers

**Chosen:** every resource's `id` is a generated UUID (v4), exposed as-is in URLs and JSON.

**Rejected:** auto-incrementing integer primary keys (`serial` / `bigserial`).

**Why:** sequential IDs are guessable, so a public API leaks both row counts and the ability to
enumerate other people's orders by walking `/orders/1`, `/orders/2`. UUIDs also let a client
generate an ID before the row exists, which keeps order creation idempotent later. The cost is a
wider key and non-sequential index inserts, which is irrelevant at this scale.

## 2. Money as an integer in minor units, not a decimal

**Chosen:** all money is an `Int` column named `*Minor`, holding kobo, with a `currency` column
(ISO 4217, default `NGN`) beside it. `priceMinor`, `deliveryFeeMinor`, `unitPriceMinor`,
`totalMinor`.

**Rejected:** `Decimal(10,2)` in Postgres, or a float, holding naira.

**Why:** integers are exact and sum without rounding rules, and JSON has no decimal type, so a
`Decimal` has to cross the wire as either a string (awkward) or a float (lossy). Floats are simply
wrong for money: `0.1 + 0.2` does not equal `0.3`. Carrying `currency` next to every amount means
no amount is ever ambiguous. The cost is that clients must divide by 100 to display, which is a
one-line formatter.

## 3. Cursor pagination, not offset pagination

**Chosen:** every list endpoint paginates with an opaque `cursor`, and list `meta` returns
`{ total, limit, nextCursor, hasMore }`.

**Rejected:** `?page=` / `?offset=` with `LIMIT ... OFFSET ...`.

**Why:** `OFFSET` makes the database count and discard every skipped row, so deep pages get slower
the further you go, and rows inserted while a client is paging shift the window, which both
duplicates and skips records. A cursor anchored on the sort key plus `id` is a seek, so page 500
costs the same as page 1 and the window is stable. The cost is that clients cannot jump to an
arbitrary page number, which a feed-style consumer page does not need.

## 4. Unit price stored on the order item, not looked up from the menu item

**Chosen:** `order_items.unitPriceMinor` (plus `currency` and `nameSnapshot`) is copied from the
menu item when the order is created, and never re-read afterwards.

**Rejected:** storing only `menuItemId` on the order item and joining to `menu_items.priceMinor`
whenever an order is read.

**Why:** an order is a historical record of a transaction, not a live view of the menu. If the
price were looked up, raising a dish's price would silently rewrite what every past customer
appears to have paid, order totals would stop matching the sum of their lines, and deleting a menu
item would destroy the order's contents. Snapshotting is the standard ledger approach and makes
`orders.totalMinor` verifiable against its own lines. The cost is duplicated data that must be
captured correctly once, at create time.

## 5. The thirteen indexes, and nothing more

**Chosen:** an index on every foreign key column, plus composite indexes on the columns the list
endpoints will actually filter and sort on: `(city, cuisine)`, `(created_at, id)` and `(rating, id)`
on restaurants; `(restaurant_id, is_available, price_minor)`, `(category, price_minor)` and
`(created_at, id)` on menu items; `(city)` and `(created_at, id)` on customers;
`(customer_id, placed_at)`, `(restaurant_id, placed_at)`, `(status, placed_at)` and
`(placed_at, id)` on orders; `(menu_item_id)` on order items. Each cursor-paginated sort key is
paired with `id` so the seek is unambiguous. `order_items.order_id` needs no index of its own: the
unique `(order_id, menu_item_id)` index already serves it as a leftmost prefix.

**Rejected:** indexing every column, which is the easy habit. Specifically rejected:
`restaurants.is_open` and every `currency` column (two or three distinct values, so Postgres will
scan regardless); `orders.total_minor` as a sort key (offered by the API but rare, and
`(status, placed_at)` covers the common path); every `name`, `description` and `note` column (no
text search is in scope); every `updated_at` (not a documented sort field).

**Why:** each index is a write cost on every insert and update, and a planner choice that has to be
justified. The ones kept map one-to-one to a documented filter, a documented sort, or a foreign key.
`order_items.menu_item_id` is not optional: `ON DELETE RESTRICT` makes Postgres check referencing
rows on every menu-item delete, which is a sequential scan without it.

**An honest caveat:** at the seeded volume — 200 restaurants, 1,792 menu items, 600 orders — Postgres
will often choose a sequential scan over these indexes, because reading a small table end to end is
genuinely cheaper than an index lookup plus heap fetches. Most of these indexes are not earning
their keep today. They are here for two reasons that do not depend on table size: the foreign-key
delete checks above, and growth, since adding an index to a large, busy table later is a far more
disruptive operation than creating it with the schema.

## 6. Check constraints in the migration SQL, not only in application code

**Chosen:** `price_minor > 0`, `unit_price_minor > 0`, `quantity >= 1`, `total_minor >= 0`,
`delivery_fee_minor >= 0` and `rating BETWEEN 0 AND 50` are `CHECK` constraints, hand-written into
the migration SQL because the Prisma schema language cannot express them.

**Rejected:** enforcing these rules only in the Zod schemas at the API boundary.

**Why:** Zod validates one path into the data — the HTTP handler. The database is reachable by the
seed script, by a migration, by `psql`, and by whatever runs next year. A constraint in the schema
is the only rule that holds for all of them, and it converts a class of silent data corruption into
a loud, immediate error with a constraint name attached. Zod still validates at the boundary,
because a 422 naming the offending field is a better response than a 500 from a database error; the
two are layers, not alternatives. The cost is that the rules live in two places and must agree.

## 7. A deterministic, idempotent seed

**Chosen:** `faker.seed(SEED.fakerSeed)` and `faker.setDefaultRefDate(SEED.referenceDate)` from
`src/config.ts`, with every UUID produced by `faker.string.uuid()` and every timestamp derived from
the reference date. Rows are inserted with `createMany({ skipDuplicates: true })` in batches of 500.

**Rejected, three alternatives:**

- *Letting the database generate ids* (`@default(uuid())`) and timestamps (`now()`). This is what
  the schema does for API traffic, but in the seed it would make every run produce different rows,
  so there would be no way to insert the same data twice.
- *Truncating the tables at the start of every run.* Simple and idempotent, but destructive: it
  would silently delete anything else in the database, which is a bad default for a script pointed
  at a remote host by a connection string.
- *`upsert` per row.* Correct, but one round trip per row — roughly 4,400 of them against a database
  in another country. Measured alternative: the batched version completes in about 7 seconds.

**Why:** determinism is what makes the second run a no-op. Because the ids are a pure function of
the seed, every row the second run tries to insert already exists, so `skipDuplicates` drops it:
the counts come back identical (200 / 1,792 / 300 / 600 / 1,487) rather than doubling, and nothing
has to be deleted to achieve that. The trade-off is that the seed will not *update* a row whose
generated content changed; changing the generator means dropping the rows or bumping the seed.

## 8. Customers and orders are publicly readable

**Chosen:** `GET /api/v1/customers`, `/api/v1/orders` and their nested routes are open, returning
names, emails, phone numbers and order histories with no authentication.

**Rejected:** putting those four resources behind auth, or omitting them from the API.

**Why, stated plainly:** only because the brief explicitly excludes authentication and the data is
synthetic — every customer is `@faker-js/faker` output, and every email is `@example.com`. This is
not a defensible design for real customer data. A real deployment would require authentication on
every customer and order route, scope each customer to their own orders, and keep email and phone
out of list responses entirely. Recording it here so the exclusion is a visible decision rather
than an oversight, and so the first real user account is a blocker, not a surprise.

## 9. In-memory rate limiting, with its limits stated

**Chosen:** a fixed-window counter in a `Map` in the server process, keyed on the client address —
the first entry of `x-forwarded-for` when a proxy is in front, falling back to `x-real-ip`. The
count and window come from `RATE_LIMIT` in `src/config.ts`. Exceeding it returns 429 with
`Retry-After`. Expired windows are deleted on every call, so the map cannot grow without bound.

**Rejected:** Redis (or any shared store) for the counters, and a token bucket instead of a fixed
window.

**Why, and what is wrong with it:** the brief is a single long-running Node server, which is the
one deployment shape where an in-process counter is coherent. Three honest limitations:

1. **It resets on restart.** A deploy or a crash clears every counter, so a client that was being
   throttled gets a fresh allowance immediately.
2. **It only works on one instance.** Two instances behind a load balancer each permit the full
   quota, so the effective limit is the configured one multiplied by the instance count. Nothing
   here detects that, and it fails open rather than closed.
3. **A fixed window allows bursts at the boundary** — up to twice the limit across two adjacent
   windows, by spending the allowance at the end of one and the start of the next.

What would replace it: a shared store with an atomic counter — Redis `INCR` plus `EXPIRE`, or a
sliding-window log — keyed the same way, so every instance consults one source of truth and the
counters survive a restart. The address-based key should also be revisited: it throttles everyone
behind one NAT together, which an authenticated API would avoid by keying on the account instead.

## 10. CORS open to every origin

**Chosen:** every `/api/v1` response carries `Access-Control-Allow-Origin: *`, allows GET, POST,
PATCH and DELETE, and answers the OPTIONS preflight from the shared wrapper. `Location` and
`Retry-After` are exposed so browser clients can follow a create and back off on a 429. The headers
go on error responses too, including the 429 and the 500.

**Rejected:** an allowlist of origins, which is the usual default.

**Why:** the brief is a *public* API — the point is that a browser app on any other site can call
it. An allowlist would mean a deploy every time someone new wants to try it, and would make the
published documentation untrue for most readers. The reason a wildcard is safe here specifically is
that there is nothing to ride on: no cookies, no `Authorization`, no sessions, and
`Access-Control-Allow-Credentials` is never sent, so a malicious page gets exactly what `curl`
gets. The day authentication is added, this must change in the same commit: a wildcard origin plus
credentials is the classic CSRF-by-CORS mistake, and browsers refuse that combination precisely
because it is dangerous.

Putting the headers on errors matters more than it looks: without them a browser reports a failed
preflight or an opaque network error, and the client cannot tell a 429 from the server being down.

## 11. The Railway database is both the production and the development database

**Chosen:** one Railway PostgreSQL instance, already migrated and seeded, serves the deployed API
and local development alike. `npx prisma migrate deploy` and `npx prisma db seed` were run against
it from a developer machine.

**Rejected:** a local Postgres (or a container) for development with Railway reserved for
production, and a separate staging database.

**Why:** at this stage it removes a whole class of "works on my machine" problems — one schema, one
dataset, and the deployed API demonstrably serving the same rows seen locally. It also means the
deployed service needs no seeding step of its own.

**The trade-off, stated plainly:** there is no safety margin. A mistaken `prisma migrate reset`, a
destructive migration, or a seed change run from a laptop hits production directly, with no staging
copy to catch it and no backup discipline in place. Local experiments contend with production for
the same connection pool. This is acceptable only because the data is synthetic and the project is
a bootcamp task; the moment any real order exists, the next step is a second database — Railway
environments make this straightforward — with `DATABASE_URL` pointing at the development one
locally and migrations promoted to production deliberately rather than as a side effect of running
a command in the wrong terminal.

## 12. Header spoofing against the live host: tested, not assumed

The rate limiter keys on the first address in `x-forwarded-for`. That header is client-supplied, so
whether it can be forged depends entirely on what the hosting proxy does with it: a proxy that
*appends* leaves the attacker's value first and the limiter is trivially evaded; a proxy that
*overwrites* makes the value trustworthy.

**Tested on the live deployment** (`evidence/rate-limit-spoof.txt`): exhausted the limit with
ordinary requests, then repeated with four forged values.

```
STEP 1 — accepted 100 requests, then 429 (Retry-After: 24)
STEP 2 — x-forwarded-for: 1.2.3.4           -> 429
         x-forwarded-for: 203.0.113.99      -> 429
         x-forwarded-for: 8.8.8.8, 1.1.1.1  -> 429
         x-forwarded-for: not-even-an-ip    -> 429

RESULT: NOT EVADABLE
```

**Not evadable on Railway.** Railway's edge overwrites `x-forwarded-for` with the address it
observed, so the value the limiter reads is not under the caller's control. No code change was
needed, and the planned fallback — keying on the last address instead of the first — was not
applied, because it would have been a change with no effect here and would break the header's
normal meaning behind a correctly-appending proxy.

**What this result does and does not mean.** It is a property of *Railway's edge*, not of this
code. The same binary is evadable the moment it runs anywhere that appends rather than overwrites,
or is exposed directly to the internet with no proxy at all — in which case `x-forwarded-for` is
pure client input and the limiter can be bypassed with one header. Three things follow:

1. The deployment target is now load-bearing for a security property. Moving hosts means re-running
   `evidence/spoof-test.mjs` before trusting the limit again.
2. The honest fix, if this ever needs to hold independently of the host, is to make the trusted
   source explicit — a configured number of trusted proxy hops, counted from the right-hand end of
   the header, rather than blind faith in position zero.
3. None of this changes the limitations in decision 9: the counters still reset on restart and
   still only work on a single instance.

An earlier draft of this entry would have claimed the limiter was safe because the test passed.
It passed because of where it is deployed. That is worth writing down precisely, because it is the
kind of result that silently stops being true.
