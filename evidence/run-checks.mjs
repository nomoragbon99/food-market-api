/**
 * Proves the database rejects bad rows and that the seeded data is consistent.
 *
 * Uses the pg driver directly so the output is the real PostgreSQL error, with
 * its SQLSTATE and constraint name, rather than a Prisma-wrapped message.
 * Every attempted insert runs inside a transaction that is rolled back.
 */
import { Client } from "pg";
import "dotenv/config";

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

async function expectRejection(label, sql, params) {
  await client.query("BEGIN");
  try {
    await client.query(sql, params);
    await client.query("ROLLBACK");
    console.log(`${label}\n  !! NOT REJECTED - the insert succeeded, which is a bug\n`);
    return false;
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(`${label}`);
    console.log(`  rejected: SQLSTATE ${error.code} ${error.message}`);
    if (error.constraint) console.log(`  constraint: ${error.constraint}`);
    console.log();
    return true;
  }
}

const client_ = client;
await client_.connect();

const { rows: refs } = await client.query(`
  select r.id as restaurant_id,
         (select id from menu_items where restaurant_id = r.id limit 1) as menu_item_id,
         (select id from orders where restaurant_id = r.id limit 1) as order_id,
         (select id from customers limit 1) as customer_id
  from restaurants r
  where exists (select 1 from orders where restaurant_id = r.id)
  limit 1
`);
const ref = refs[0];

console.log("=== Inserts that must be rejected ===\n");

await expectRejection(
  "1. menu item with price_minor = 0",
  `insert into menu_items (id, restaurant_id, name, category, price_minor, currency, is_available, created_at, updated_at)
   values (gen_random_uuid(), $1, 'Free Lunch', 'main', 0, 'NGN', true, now(), now())`,
  [ref.restaurant_id],
);

await expectRejection(
  "2. order item with quantity = 0",
  `insert into order_items (id, order_id, menu_item_id, quantity, unit_price_minor, currency, name_snapshot, created_at, updated_at)
   values (gen_random_uuid(), $1, $2, 0, 150000, 'NGN', 'Nothing At All', now(), now())`,
  [ref.order_id, ref.menu_item_id],
);

await expectRejection(
  "3. order pointing at a customer that does not exist",
  `insert into orders (id, customer_id, restaurant_id, status, total_minor, currency, placed_at, created_at, updated_at)
   values (gen_random_uuid(), '00000000-0000-4000-8000-000000000000', $1, 'pending', 150000, 'NGN', now(), now(), now())`,
  [ref.restaurant_id],
);

console.log("=== Data integrity ===\n");

const { rows: totals } = await client.query(`
  select count(*)::int as mismatched_orders
  from orders o
  where o.total_minor <> (
    select coalesce(sum(oi.quantity * oi.unit_price_minor), 0)
    from order_items oi
    where oi.order_id = o.id
  )
`);
console.log(`orders whose total_minor differs from the sum of their items: ${totals[0].mismatched_orders}`);

const { rows: crossRestaurant } = await client.query(`
  select count(*)::int as cross_restaurant_items
  from order_items oi
  join orders o on o.id = oi.order_id
  join menu_items mi on mi.id = oi.menu_item_id
  where mi.restaurant_id <> o.restaurant_id
`);
console.log(`order items whose menu item belongs to another restaurant: ${crossRestaurant[0].cross_restaurant_items}`);

const { rows: snapshots } = await client.query(`
  select count(*)::int as drifted
  from order_items oi
  join menu_items mi on mi.id = oi.menu_item_id
  where oi.unit_price_minor <> mi.price_minor or oi.name_snapshot <> mi.name
`);
console.log(`order items whose snapshot differs from the live menu item: ${snapshots[0].drifted} (0 only because no price has changed since seeding)`);

const { rows: statuses } = await client.query(
  `select status, count(*)::int as n from orders group by status order by status`,
);
console.log(`order statuses present: ${statuses.map((s) => `${s.status}=${s.n}`).join(", ")}`);

const { rows: window_ } = await client.query(`
  select to_char(min(placed_at),'YYYY-MM-DD') as earliest, to_char(max(placed_at),'YYYY-MM-DD') as latest,
         count(distinct placed_at::date)::int as distinct_days
  from orders
`);
console.log(`placed_at spread: ${window_[0].earliest} to ${window_[0].latest} across ${window_[0].distinct_days} distinct days`);

const { rows: dupes } = await client.query(`
  select count(*)::int as duplicate_lines from (
    select order_id, menu_item_id from order_items group by order_id, menu_item_id having count(*) > 1
  ) d
`);
console.log(`menu items appearing twice in one order: ${dupes[0].duplicate_lines}`);

await client.end();
