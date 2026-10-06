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
