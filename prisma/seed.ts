/**
 * Deterministic seed.
 *
 * Every value, including every UUID, is derived from SEED.fakerSeed and
 * SEED.referenceDate in src/config.ts. Nothing calls `new Date()` or an
 * unseeded random, so two runs produce byte-identical rows. Inserts use
 * `createMany({ skipDuplicates: true })` in batches, so the second run is a
 * no-op rather than a duplication, and a full run against a remote database
 * takes seconds rather than one round trip per row.
 */
import { faker } from "@faker-js/faker";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { DEFAULT_CURRENCY, SEED } from "../src/config.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORDER_STATUSES = ["pending", "confirmed", "preparing", "delivered", "cancelled"] as const;
const CUISINES = [
  "nigerian",
  "chinese",
  "italian",
  "indian",
  "lebanese",
  "fast-food",
  "grill",
  "vegan",
];
const CITIES = ["Lagos", "Abuja", "Port Harcourt", "Ibadan", "Kano", "Enugu", "Benin City"];
const CATEGORIES = ["main", "side", "drink", "dessert", "soup", "grill"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Splits rows into batches so each insert is one round trip for many rows. */
function batches<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** A date offset a deterministic number of days before the reference date. */
function daysBeforeReference(days: number, msWithinDay: number): Date {
  return new Date(SEED.referenceDate.getTime() - days * DAY_MS + msWithinDay);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type RestaurantRow = {
  id: string;
  name: string;
  slug: string;
  cuisine: string;
  city: string;
  addressLine: string;
  isOpen: boolean;
  rating: number;
  deliveryFeeMinor: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
};

type MenuItemRow = {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  category: string;
  priceMinor: number;
  currency: string;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type CustomerRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  createdAt: Date;
  updatedAt: Date;
};

type OrderRow = {
  id: string;
  customerId: string;
  restaurantId: string;
  status: (typeof ORDER_STATUSES)[number];
  totalMinor: number;
  currency: string;
  note: string | null;
  placedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type OrderItemRow = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  unitPriceMinor: number;
  currency: string;
  nameSnapshot: string;
  createdAt: Date;
  updatedAt: Date;
};

function build() {
  // A fixed seed and a fixed reference date: identical output on every run.
  faker.seed(SEED.fakerSeed);
  faker.setDefaultRefDate(SEED.referenceDate);

  const restaurants: RestaurantRow[] = [];
  const menuItems: MenuItemRow[] = [];
  /** Menu items grouped by restaurant, so an order only ever picks from its own. */
  const menuByRestaurant = new Map<string, MenuItemRow[]>();

  for (let i = 0; i < SEED.restaurantCount; i += 1) {
    const id = faker.string.uuid();
    const name = `${faker.company.name()} ${faker.helpers.arrayElement(["Kitchen", "Grill", "Place", "Bistro", "Spot"])}`;
    const createdAt = daysBeforeReference(
      faker.number.int({ min: SEED.orderWindowDays, max: 365 }),
      faker.number.int({ min: 0, max: DAY_MS - 1 }),
    );

    restaurants.push({
      id,
      name,
      // The index suffix guarantees uniqueness even if two generated names collide.
      slug: `${slugify(name)}-${i + 1}`,
      cuisine: faker.helpers.arrayElement(CUISINES),
      city: faker.helpers.arrayElement(CITIES),
      addressLine: faker.location.streetAddress(),
      isOpen: faker.datatype.boolean({ probability: 0.8 }),
      rating: faker.number.int({ min: 0, max: 50 }),
      deliveryFeeMinor: faker.number.int({ min: 0, max: 250 }) * 100,
      currency: DEFAULT_CURRENCY,
      createdAt,
      updatedAt: createdAt,
    });

    const menu: MenuItemRow[] = [];
    const itemCount = faker.number.int(SEED.menuItemsPerRestaurant);
    for (let j = 0; j < itemCount; j += 1) {
      const itemCreatedAt = daysBeforeReference(
        faker.number.int({ min: SEED.orderWindowDays, max: 300 }),
        faker.number.int({ min: 0, max: DAY_MS - 1 }),
      );
      const row: MenuItemRow = {
        id: faker.string.uuid(),
        restaurantId: id,
        name: `${faker.food.dish()} ${j + 1}`,
        description: faker.food.description().slice(0, 500),
        category: faker.helpers.arrayElement(CATEGORIES),
        // Always > 0, matching the CHECK constraint. 500 to 15,000 naira.
        priceMinor: faker.number.int({ min: 500, max: 15_000 }) * 100,
        currency: DEFAULT_CURRENCY,
        isAvailable: faker.datatype.boolean({ probability: 0.9 }),
        createdAt: itemCreatedAt,
        updatedAt: itemCreatedAt,
      };
      menu.push(row);
      menuItems.push(row);
    }
    menuByRestaurant.set(id, menu);
  }

  const customers: CustomerRow[] = [];
  for (let i = 0; i < SEED.customerCount; i += 1) {
    const fullName = faker.person.fullName();
    const createdAt = daysBeforeReference(
      faker.number.int({ min: SEED.orderWindowDays, max: 400 }),
      faker.number.int({ min: 0, max: DAY_MS - 1 }),
    );
    customers.push({
      id: faker.string.uuid(),
      fullName,
      // The index keeps emails unique without relying on name uniqueness.
      email: `${slugify(fullName)}.${i + 1}@example.com`,
      phone: `+234${faker.string.numeric(10)}`,
      city: faker.helpers.arrayElement(CITIES),
      createdAt,
      updatedAt: createdAt,
    });
  }

  const orders: OrderRow[] = [];
  const orderItems: OrderItemRow[] = [];

  for (let i = 0; i < SEED.orderCount; i += 1) {
    const orderId = faker.string.uuid();
    const restaurant = faker.helpers.arrayElement(restaurants);
    const customer = faker.helpers.arrayElement(customers);
    const menu = menuByRestaurant.get(restaurant.id) ?? [];
    const placedAt = daysBeforeReference(
      faker.number.int({ min: 0, max: SEED.orderWindowDays - 1 }),
      faker.number.int({ min: 0, max: DAY_MS - 1 }),
    );

    // `arrayElements` samples without replacement, so no menu item can appear
    // twice in one order, which the (order_id, menu_item_id) unique would reject.
    const chosen = faker.helpers.arrayElements(
      menu,
      faker.number.int({
        min: SEED.itemsPerOrder.min,
        max: Math.min(SEED.itemsPerOrder.max, menu.length),
      }),
    );

    let totalMinor = 0;
    for (const item of chosen) {
      const quantity = faker.number.int({ min: 1, max: 3 });
      totalMinor += quantity * item.priceMinor;
      orderItems.push({
        id: faker.string.uuid(),
        orderId,
        menuItemId: item.id,
        quantity,
        // Price and name are copied from the menu item at ordering time.
        unitPriceMinor: item.priceMinor,
        currency: item.currency,
        nameSnapshot: item.name,
        createdAt: placedAt,
        updatedAt: placedAt,
      });
    }

    orders.push({
      id: orderId,
      customerId: customer.id,
      restaurantId: restaurant.id,
      // The first five orders take one status each, so all five always appear;
      // the rest are drawn at random from the same set.
      status: i < ORDER_STATUSES.length
        ? ORDER_STATUSES[i]!
        : faker.helpers.arrayElement(ORDER_STATUSES),
      totalMinor,
      currency: DEFAULT_CURRENCY,
      note: faker.datatype.boolean({ probability: 0.3 })
        ? faker.lorem.sentence().slice(0, 500)
        : null,
      placedAt,
      createdAt: placedAt,
      updatedAt: placedAt,
    });
  }

  return { restaurants, menuItems, customers, orders, orderItems };
}

async function main() {
  const startedAt = Date.now();
  const data = build();

  // Parents before children. Each batch is one multi-row INSERT;
  // skipDuplicates makes a repeat run a no-op instead of a failure.
  for (const batch of batches(data.restaurants, SEED.batchSize)) {
    await prisma.restaurant.createMany({ data: batch, skipDuplicates: true });
  }
  for (const batch of batches(data.menuItems, SEED.batchSize)) {
    await prisma.menuItem.createMany({ data: batch, skipDuplicates: true });
  }
  for (const batch of batches(data.customers, SEED.batchSize)) {
    await prisma.customer.createMany({ data: batch, skipDuplicates: true });
  }
  for (const batch of batches(data.orders, SEED.batchSize)) {
    await prisma.order.createMany({ data: batch, skipDuplicates: true });
  }
  for (const batch of batches(data.orderItems, SEED.batchSize)) {
    await prisma.orderItem.createMany({ data: batch, skipDuplicates: true });
  }

  const counts = {
    restaurants: await prisma.restaurant.count(),
    menu_items: await prisma.menuItem.count(),
    customers: await prisma.customer.count(),
    orders: await prisma.order.count(),
    order_items: await prisma.orderItem.count(),
  };
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(2);

  console.log(`Seed finished in ${seconds}s`);
  console.log("Row counts:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(12)} ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
