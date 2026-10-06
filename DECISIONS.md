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
