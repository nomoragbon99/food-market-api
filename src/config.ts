/**
 * Every tunable number in the project lives here. Handlers, scripts and seeds
 * import from this file; none of them define a literal of their own.
 */

/** Pagination applied to every list endpoint. */
export const PAGINATION = {
  /** Used when the request omits `limit`. */
  defaultLimit: 20,
  /** Any requested `limit` above this is clamped down to it, not rejected. */
  maxLimit: 100,
} as const;

/** Fixed-window rate limiting. */
export const RATE_LIMIT = {
  /** Requests allowed per window, per client. */
  max: 100,
  /** Window length in seconds. Also the value sent in `Retry-After`. */
  windowSeconds: 60,
} as const;

/** The currency every money column is denominated in. ISO 4217. */
export const DEFAULT_CURRENCY = "NGN";

/**
 * Seed configuration. The seed is deterministic: the same FAKER_SEED and
 * REFERENCE_DATE produce byte-identical rows, including identical UUIDs,
 * so running it twice is a no-op rather than a duplication.
 */
export const SEED = {
  /** Fixed PRNG seed for @faker-js/faker. */
  fakerSeed: 20260101,
  /**
   * Fixed "now" for the generated data. Never `new Date()`, or ids and dates
   * would change between runs.
   */
  referenceDate: new Date("2026-01-01T00:00:00.000Z"),
  /** Orders are spread across this many days before the reference date. */
  orderWindowDays: 90,

  restaurantCount: 200,
  menuItemsPerRestaurant: { min: 6, max: 12 },
  customerCount: 300,
  orderCount: 600,
  itemsPerOrder: { min: 1, max: 4 },

  /**
   * Rows per batched write. The seed runs against a remote database, so writes
   * go out in multi-row batches inside chunked transactions rather than one
   * round trip per row.
   */
  batchSize: 500,
} as const;
