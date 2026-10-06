/**
 * Does the rate limit survive a forged x-forwarded-for header?
 *
 * The limiter keys on the first address in x-forwarded-for. That field is
 * client-supplied, so the question is whether the hosting proxy replaces it
 * (safe) or appends to it (evadable, because the attacker's value stays first).
 *
 * Usage: node evidence/spoof-test.mjs <baseUrl>
 */
import { request } from "../scripts/http.mjs";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const URL_ = `${BASE}/api/v1/restaurants?limit=1`;

const show = (label, response, body) => {
  console.log(`  ${label}`);
  console.log(`    status      : ${response.status}`);
  console.log(`    Retry-After : ${response.headers.get("retry-after") ?? "(none)"}`);
  if (body) console.log(`    body        : ${body}`);
};

console.log(`Target: ${URL_}\n`);

console.log("STEP 1 — exhaust the limit with ordinary requests (no forged header)");
let accepted = 0;
let tripped = null;
for (let i = 0; i < 140; i += 1) {
  const response = await request(URL_);
  if (response.status === 200) accepted += 1;
  else {
    tripped = response;
    break;
  }
}
if (!tripped) {
  console.log(`  never tripped after 140 requests — stopping, the limit is not working`);
  process.exit(1);
}
console.log(`  accepted ${accepted} requests, then tripped`);
show("first rejection:", tripped, await tripped.text());

console.log("\nSTEP 2 — repeat with made-up x-forwarded-for values");
const forged = [
  "1.2.3.4",
  "203.0.113.99",
  "8.8.8.8, 1.1.1.1",
  "not-even-an-ip",
];
let evaded = 0;
for (const value of forged) {
  const response = await request(URL_, { headers: { "x-forwarded-for": value } });
  const body = response.status === 200 ? "(200 — request served)" : await response.text();
  show(`x-forwarded-for: ${value}`, response, body);
  if (response.status === 200) evaded += 1;
}

console.log(`\nRESULT`);
if (evaded > 0) {
  console.log(`  EVADABLE — ${evaded} of ${forged.length} forged headers were served a 200.`);
  console.log(`  The proxy appends to x-forwarded-for, so the client-supplied value stays first`);
  console.log(`  and the limiter buckets by whatever the caller claims.`);
} else {
  console.log(`  NOT EVADABLE — all ${forged.length} forged headers still got 429.`);
  console.log(`  The proxy overwrites x-forwarded-for with the real client address, so the`);
  console.log(`  value the limiter reads is not under the caller's control.`);
}
