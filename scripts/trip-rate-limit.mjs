/**
 * Trips the API's rate limit, then reports what the next request gets back.
 *
 * Usage:
 *   node scripts/trip-rate-limit.mjs <url> [--forwarded-for <address>]
 *
 * Example:
 *   node scripts/trip-rate-limit.mjs https://food-market-api-production.up.railway.app
 *
 * It fires 110 requests in parallel — more than the configured limit of 100 per
 * 60s — and then makes one final request and prints its status, its Retry-After
 * header and its body.
 */
import { RATE_LIMIT } from "../src/config.ts";
import { request } from "./http.mjs";

const BURST = 110;

const args = process.argv.slice(2);
const base = args[0];
const forwardedForIndex = args.indexOf("--forwarded-for");
const forwardedFor = forwardedForIndex === -1 ? null : args[forwardedForIndex + 1];

if (!base) {
  console.error("Usage: node scripts/trip-rate-limit.mjs <url> [--forwarded-for <address>]");
  process.exit(1);
}

const url = base.includes("/api/") ? base : `${base.replace(/\/$/, "")}/api/v1/restaurants?limit=1`;
const headers = forwardedFor ? { "x-forwarded-for": forwardedFor } : {};

console.log(`Target : ${url}`);
console.log(`Limit  : ${RATE_LIMIT.max} requests per ${RATE_LIMIT.windowSeconds}s (from src/config.ts)`);
if (forwardedFor) console.log(`Sending x-forwarded-for: ${forwardedFor}`);
console.log(`Firing ${BURST} requests in parallel...\n`);

const started = Date.now();
const responses = await Promise.all(
  Array.from({ length: BURST }, () => request(url, { headers }).catch((error) => ({ status: `ERROR ${error.message}` }))),
);

const tally = new Map();
for (const response of responses) tally.set(response.status, (tally.get(response.status) ?? 0) + 1);

console.log(`${BURST} requests completed in ${((Date.now() - started) / 1000).toFixed(2)}s`);
for (const [status, count] of [...tally].sort()) console.log(`  ${status}: ${count}`);

console.log(`\nOne more request:`);
const final = await request(url, { headers });
console.log(`  status      : ${final.status}`);
console.log(`  Retry-After : ${final.headers.get("retry-after") ?? "(none)"}`);
console.log(`  body        : ${await final.text()}`);
