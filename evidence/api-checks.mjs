/**
 * Drives every case in the verification list against a running server and
 * prints real request/response output.
 *
 * Usage: node evidence/api-checks.mjs [baseUrl]
 * Default base URL: http://127.0.0.1:3000
 */
import { Client } from "pg";
import "dotenv/config";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

/**
 * A direct connection, used only to read back the ordering Postgres itself
 * produces, so the pagination check does not grade the API against a
 * JavaScript re-implementation of SQL collation.
 */
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/** A distinct client IP per case, so one case's requests cannot rate-limit the next. */
let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1) % 250}`;

async function call(method, path, { body, ip = nextIp() } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "x-forwarded-for": ip,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

const show = (value) => JSON.stringify(value);

function heading(title) {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}

async function expectStatus(label, method, path, expected, options) {
  const res = await call(method, path, options);
  const mark = res.status === expected ? "OK " : "FAIL";
  console.log(`\n[${mark}] ${method} ${path}`);
  console.log(`  expected ${expected}, got ${res.status}`);
  if (label) console.log(`  ${label}`);
  console.log(`  body: ${show(res.body)}`);
  return res;
}

heading("1. Query and id handling");

const clamped = await call("GET", "/api/v1/restaurants?limit=5000");
console.log(`\n[${clamped.body.meta.limit === 100 ? "OK " : "FAIL"}] GET /api/v1/restaurants?limit=5000`);
console.log(`  meta.limit is ${clamped.body.meta.limit} (max from src/config.ts), rows returned: ${clamped.body.data.length}`);
console.log(`  meta: ${show(clamped.body.meta)}`);

await expectStatus("negative limit", "GET", "/api/v1/restaurants?limit=-1", 400);
await expectStatus("non-numeric limit", "GET", "/api/v1/restaurants?limit=abc", 400);
await expectStatus("unknown sort field", "GET", "/api/v1/restaurants?sort=banana", 400);
await expectStatus("malformed cursor", "GET", "/api/v1/restaurants?cursor=not-a-real-cursor", 400);
await expectStatus("unknown query parameter", "GET", "/api/v1/restaurants?citi=Lagos", 400);
await expectStatus("malformed id", "GET", "/api/v1/restaurants/not-a-uuid", 400);
await expectStatus(
  "well-formed id that does not exist",
  "GET",
  "/api/v1/restaurants/00000000-0000-4000-8000-000000000000",
  404,
);

heading("2. A cursor replayed under a different sort");

const firstPage = await call("GET", "/api/v1/restaurants?sort=name&order=asc&limit=5");
const cursorForName = firstPage.body.meta.nextCursor;
await expectStatus(
  "cursor issued for sort=name used with sort=rating",
  "GET",
  `/api/v1/restaurants?sort=rating&order=asc&limit=5&cursor=${encodeURIComponent(cursorForName)}`,
  400,
);

heading("3. Body validation and status transitions");

await expectStatus("POST missing customerId and items", "POST", "/api/v1/orders", 422, {
  body: { restaurantId: "00000000-0000-4000-8000-000000000000" },
});

// Build a valid order from real seeded rows.
const someRestaurant = (await call("GET", "/api/v1/restaurants?limit=1&isOpen=true")).body.data[0];
const someCustomer = (await call("GET", "/api/v1/customers?limit=1")).body.data[0];
const menu = (
  await call("GET", `/api/v1/restaurants/${someRestaurant.id}/menu?limit=3&isAvailable=true`)
).body.data;
const otherRestaurantItem = (
  await call("GET", `/api/v1/menu-items?limit=50&isAvailable=true`)
).body.data.find((item) => item.restaurantId !== someRestaurant.id);

await expectStatus("same menu item twice in one order", "POST", "/api/v1/orders", 422, {
  body: {
    customerId: someCustomer.id,
    restaurantId: someRestaurant.id,
    items: [
      { menuItemId: menu[0].id, quantity: 1 },
      { menuItemId: menu[0].id, quantity: 2 },
    ],
  },
});

await expectStatus("menu item from another restaurant", "POST", "/api/v1/orders", 422, {
  body: {
    customerId: someCustomer.id,
    restaurantId: someRestaurant.id,
    items: [{ menuItemId: otherRestaurantItem.id, quantity: 1 }],
  },
});

await expectStatus("empty items array", "POST", "/api/v1/orders", 422, {
  body: { customerId: someCustomer.id, restaurantId: someRestaurant.id, items: [] },
});

const createdOrder = await call("POST", "/api/v1/orders", {
  body: {
    customerId: someCustomer.id,
    restaurantId: someRestaurant.id,
    note: "Extra pepper, no onions.",
    items: menu.slice(0, 2).map((item, index) => ({ menuItemId: item.id, quantity: index + 1 })),
  },
});
const expectedTotal = menu
  .slice(0, 2)
  .reduce((sum, item, index) => sum + item.priceMinor * (index + 1), 0);
console.log(`\n[${createdOrder.status === 201 ? "OK " : "FAIL"}] POST /api/v1/orders (valid)`);
console.log(`  status ${createdOrder.status}, Location: ${createdOrder.headers.get("location")}`);
console.log(`  totalMinor ${createdOrder.body.data.totalMinor}, expected ${expectedTotal}`);
console.log(`  snapshots: ${show(createdOrder.body.data.items.map((i) => ({ nameSnapshot: i.nameSnapshot, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity })))}`);

const orderId = createdOrder.body.data.id;

await expectStatus("PATCH with a field that is not status or note", "PATCH", `/api/v1/orders/${orderId}`, 422, {
  body: { totalMinor: 1 },
});

await expectStatus("forbidden move: pending -> delivered", "PATCH", `/api/v1/orders/${orderId}`, 409, {
  body: { status: "delivered" },
});

const confirmed = await call("PATCH", `/api/v1/orders/${orderId}`, { body: { status: "confirmed" } });
console.log(`\n[${confirmed.status === 200 ? "OK " : "FAIL"}] PATCH pending -> confirmed: ${confirmed.status}, status now ${confirmed.body.data?.status}`);

await expectStatus("forbidden move: confirmed -> pending", "PATCH", `/api/v1/orders/${orderId}`, 409, {
  body: { status: "pending" },
});

const cancelled = await call("PATCH", `/api/v1/orders/${orderId}`, { body: { status: "cancelled" } });
console.log(`[${cancelled.status === 200 ? "OK " : "FAIL"}] PATCH confirmed -> cancelled: ${cancelled.status}, status now ${cancelled.body.data?.status}`);

await expectStatus("terminal state cannot move", "PATCH", `/api/v1/orders/${orderId}`, 409, {
  body: { status: "preparing" },
});

const deleted = await call("DELETE", `/api/v1/orders/${orderId}`);
console.log(`\n[${deleted.status === 204 ? "OK " : "FAIL"}] DELETE /api/v1/orders/${orderId}: ${deleted.status} (no body: ${show(deleted.body)})`);
await expectStatus("DELETE an order that is already gone", "DELETE", `/api/v1/orders/${orderId}`, 404);

heading("4. Paginating every page of /restaurants under two sorts");

/**
 * The authoritative order for a sort, straight from Postgres.
 *
 * Comparing sort values in JavaScript is wrong for text columns: Postgres
 * collation weighs letters ahead of punctuation, so it orders
 * "Bauch, Lebsack..." before "Bauch - Orn...", while a JS `<=` comparison
 * calls that an inversion. The keyset cursor uses the same collation as
 * ORDER BY, so the database's own sequence is the thing to check against.
 */
async function expectedIdOrder(sort, order) {
  const columns = { name: "name", createdAt: "created_at", rating: "rating" };
  const column = columns[sort];
  const direction = order === "asc" ? "ASC" : "DESC";
  const { rows } = await db.query(
    `select id from restaurants order by ${column} ${direction}, id ${direction}`,
  );
  return rows.map((row) => row.id);
}

async function walkAllPages(sort, order) {
  const seen = [];
  const sortValues = [];
  let cursor = null;
  let pages = 0;
  let lastMeta = null;
  const ip = nextIp();

  do {
    const query = new URLSearchParams({ sort, order, limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const page = await call("GET", `/api/v1/restaurants?${query}`, { ip });
    if (page.status !== 200) throw new Error(`page ${pages + 1} returned ${page.status}: ${show(page.body)}`);
    for (const row of page.body.data) {
      seen.push(row.id);
      sortValues.push(row[sort]);
    }
    cursor = page.body.meta.nextCursor;
    lastMeta = page.body.meta;
    pages += 1;
  } while (cursor);

  const unique = new Set(seen);
  const expected = await expectedIdOrder(sort, order);
  const firstMismatch = seen.findIndex((id, index) => id !== expected[index]);
  const ordered = firstMismatch === -1 && seen.length === expected.length;

  console.log(`\nsort=${sort}&order=${order}`);
  console.log(`  pages followed: ${pages}`);
  console.log(`  rows collected: ${seen.length}, unique ids: ${unique.size}`);
  console.log(`  meta.total on last page: ${lastMeta.total}`);
  console.log(
    `  ordering matches "ORDER BY ${sort} ${order}, id ${order}" from the database: ${ordered}` +
      (ordered ? "" : ` (first mismatch at row ${firstMismatch})`),
  );
  console.log(`  sort values, first and last: ${show(sortValues[0])} ... ${show(sortValues.at(-1))}`);
  console.log(`  final nextCursor: ${lastMeta.nextCursor} / hasMore: ${lastMeta.hasMore}`);
  const verdict =
    seen.length === 200 && unique.size === 200 && ordered && lastMeta.nextCursor === null;
  console.log(`  [${verdict ? "OK " : "FAIL"}] 200 unique ids, correct order, nextCursor null at the end`);
  return seen;
}

const byName = await walkAllPages("name", "asc");
const byCreated = await walkAllPages("createdAt", "desc");
console.log(`\nsame 200 restaurants under both sorts: ${new Set([...byName, ...byCreated]).size === 200}`);

heading("5. Filter + sort + pagination in one request");

const combined = await call(
  "GET",
  "/api/v1/menu-items?category=main&isAvailable=true&minPrice=100000&sort=priceMinor&order=asc&limit=3",
);
console.log(`\nGET /api/v1/menu-items?category=main&isAvailable=true&minPrice=100000&sort=priceMinor&order=asc&limit=3`);
console.log(`  status ${combined.status}`);
console.log(`  meta: ${show(combined.body.meta)}`);
for (const item of combined.body.data) {
  console.log(`  ${item.priceMinor.toString().padStart(8)}  ${item.category.padEnd(6)} available=${item.isAvailable}  ${item.name}`);
}
const page2 = await call(
  "GET",
  `/api/v1/menu-items?category=main&isAvailable=true&minPrice=100000&sort=priceMinor&order=asc&limit=3&cursor=${encodeURIComponent(combined.body.meta.nextCursor)}`,
);
console.log(`  next page first row priceMinor: ${page2.body.data[0].priceMinor} (>= last row above: ${page2.body.data[0].priceMinor >= combined.body.data.at(-1).priceMinor})`);

heading("6. Rate limit");

const burstIp = "198.51.100.77";
let allowed = 0;
let limited = null;
for (let i = 0; i < 130; i += 1) {
  const res = await call("GET", "/api/v1/restaurants?limit=1", { ip: burstIp });
  if (res.status === 200) {
    allowed += 1;
  } else {
    limited = res;
    break;
  }
}
console.log(`\nrequests accepted before the limit tripped: ${allowed}`);
console.log(`[${limited?.status === 429 ? "OK " : "FAIL"}] status ${limited?.status}`);
console.log(`  Retry-After header: ${limited?.headers.get("retry-after")}`);
console.log(`  body: ${show(limited?.body)}`);

const otherIp = await call("GET", "/api/v1/restaurants?limit=1", { ip: "198.51.100.78" });
console.log(`  a different IP is unaffected: ${otherIp.status}`);

console.log("\nAll checks complete.");

await db.end();
