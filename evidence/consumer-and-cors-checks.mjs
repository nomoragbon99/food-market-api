/**
 * Verifies CORS, the deploy configuration and every data path the /consumer
 * page uses, against a production build (`npm run build` + `npm start`).
 *
 * Honest scope: there is no browser automation in this environment, so this
 * does not click the page. It checks that /consumer is served and contains its
 * controls, and it issues the exact requests the page's fetchPage() issues for
 * each of its four states, from a non-localhost absolute origin with an Origin
 * header, so the CORS path is exercised the way a browser would exercise it.
 */
import { readFileSync } from "node:fs";

// Pass the origin as an argument, or set NEXT_PUBLIC_API_BASE_URL. It must be
// absolute and not localhost, since the point is to exercise a cross-origin call.
const ORIGIN = process.argv[2] ?? process.env.NEXT_PUBLIC_API_BASE_URL;
if (!ORIGIN) {
  console.error("Usage: node evidence/consumer-and-cors-checks.mjs <origin>");
  console.error("  e.g. node evidence/consumer-and-cors-checks.mjs http://192.0.2.10:3000");
  process.exit(1);
}
const BROWSER_ORIGIN = "https://some-other-site.example";

const line = (title) => console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
const mark = (pass) => (pass ? "OK " : "FAIL");

/** Mirrors the page's own query building. */
function pageUrl({ city = "", cuisine = "", sort = "createdAt", order = "desc", cursor = null }) {
  const params = new URLSearchParams({ sort, order, limit: "10" });
  if (city) params.set("city", city);
  if (cuisine) params.set("cuisine", cuisine);
  if (cursor) params.set("cursor", cursor);
  return `${ORIGIN}/api/v1/restaurants?${params}`;
}

const browserFetch = (url, init = {}) =>
  fetch(url, { ...init, headers: { Origin: BROWSER_ORIGIN, ...(init.headers ?? {}) } });

line("1. Deploy configuration");

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
console.log(`  build script : ${pkg.scripts.build}`);
console.log(`  start script : ${pkg.scripts.start}`);
console.log(`  engines.node : ${pkg.engines?.node}`);
console.log(`  [${mark(pkg.scripts.build === "prisma generate && next build")}] build runs prisma generate then next build`);
console.log(`  [${mark(pkg.scripts.start === "next start")}] start runs next start (Next reads Railway's PORT)`);
console.log(`  [${mark(Boolean(pkg.engines?.node))}] Node version declared`);

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
console.log(`  [${mark(envExample.includes("NEXT_PUBLIC_API_BASE_URL"))}] .env.example documents NEXT_PUBLIC_API_BASE_URL`);
console.log(`  [${mark(envExample.includes("DATABASE_URL"))}] .env.example documents DATABASE_URL`);

line("2. CORS");

const preflight = await browserFetch(`${ORIGIN}/api/v1/restaurants`, {
  method: "OPTIONS",
  headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
});
console.log(`\nOPTIONS /api/v1/restaurants (preflight)`);
console.log(`  status: ${preflight.status}`);
for (const header of [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "access-control-max-age",
]) {
  console.log(`  ${header}: ${preflight.headers.get(header)}`);
}
const methods = preflight.headers.get("access-control-allow-methods") ?? "";
console.log(
  `  [${mark(preflight.status === 204 && ["GET", "POST", "PATCH", "DELETE", "OPTIONS"].every((m) => methods.includes(m)))}] preflight answered, all four verbs plus OPTIONS allowed`,
);

for (const [label, url] of [
  ["a 200", pageUrl({})],
  ["a 400", `${ORIGIN}/api/v1/restaurants?limit=-1`],
  ["a 404", `${ORIGIN}/api/v1/restaurants/00000000-0000-4000-8000-000000000000`],
]) {
  const response = await browserFetch(url);
  const allow = response.headers.get("access-control-allow-origin");
  console.log(`  [${mark(allow === "*")}] ${label} (${response.status}) carries Access-Control-Allow-Origin: ${allow}`);
}

line("3. The four states of /consumer");

const page = await fetch(`${ORIGIN}/consumer`);
const html = await page.text();
console.log(`\nGET /consumer -> ${page.status}, ${html.length} bytes of HTML`);
for (const [label, needle] of [
  ["city filter", 'id="city"'],
  ["cuisine filter", 'id="cuisine"'],
  ["sort control", 'id="sort"'],
  ["direction control", 'id="order"'],
  ["absolute API base URL baked in", ORIGIN],
  ["no localhost reference", "localhost"],
]) {
  const present = html.includes(needle);
  const pass = label === "no localhost reference" ? !present : present;
  console.log(`  [${mark(pass)}] ${label}`);
}

console.log(`\nSTATE: data — the page's first request with no filters`);
const dataState = await browserFetch(pageUrl({}));
const dataBody = await dataState.json();
console.log(`  ${dataState.status}, rows: ${dataBody.data.length}, meta: ${JSON.stringify(dataBody.meta)}`);
console.log(`  first row: ${dataBody.data[0].name} (${dataBody.data[0].city}, ${dataBody.data[0].cuisine})`);
console.log(`  [${mark(dataState.status === 200 && dataBody.data.length === 10)}] renders the data state`);

console.log(`\nSTATE: data — city filter`);
const filtered = await browserFetch(pageUrl({ city: "Lagos" }));
const filteredBody = await filtered.json();
const allLagos = filteredBody.data.every((row) => row.city === "Lagos");
console.log(`  city=Lagos -> ${filtered.status}, total ${filteredBody.meta.total}, every row in Lagos: ${allLagos}`);
console.log(`  [${mark(allLagos && filteredBody.meta.total < dataBody.meta.total)}] filter narrows the list`);

console.log(`\nSTATE: data — city + cuisine filter together`);
const twoFilters = await browserFetch(pageUrl({ city: "Lagos", cuisine: "nigerian" }));
const twoBody = await twoFilters.json();
console.log(`  city=Lagos&cuisine=nigerian -> ${twoFilters.status}, total ${twoBody.meta.total}`);
console.log(`  [${mark(twoBody.meta.total <= filteredBody.meta.total)}] second filter narrows further`);

console.log(`\nSTATE: data — sort control`);
for (const [sort, order] of [["name", "asc"], ["rating", "desc"], ["deliveryFeeMinor", "asc"]]) {
  const sorted = await browserFetch(pageUrl({ sort, order }));
  const body = await sorted.json();
  const values = body.data.map((row) => row[sort]);
  console.log(`  sort=${sort}&order=${order} -> ${sorted.status}, first three: ${JSON.stringify(values.slice(0, 3))}`);
}

console.log(`\nSTATE: data — "Next page" follows nextCursor`);
const first = await browserFetch(pageUrl({ sort: "name", order: "asc" }));
const firstBody = await first.json();
const second = await browserFetch(pageUrl({ sort: "name", order: "asc", cursor: firstBody.meta.nextCursor }));
const secondBody = await second.json();
const overlap = firstBody.data.filter((row) => secondBody.data.some((other) => other.id === row.id));
console.log(`  page 1: ${firstBody.data.length} rows, hasMore ${firstBody.meta.hasMore}`);
console.log(`  page 2: ${secondBody.data.length} rows, hasMore ${secondBody.meta.hasMore}`);
console.log(`  overlap between pages: ${overlap.length}`);
console.log(`  page 1 last: ${firstBody.data.at(-1).name}`);
console.log(`  page 2 first: ${secondBody.data[0].name}`);
console.log(`  [${mark(overlap.length === 0 && secondBody.data.length === 10)}] next page appends 10 new rows, no repeats`);

console.log(`\nSTATE: empty — filters that match nothing`);
const empty = await browserFetch(pageUrl({ city: "Atlantis" }));
const emptyBody = await empty.json();
console.log(`  city=Atlantis -> ${empty.status}, rows: ${emptyBody.data.length}, meta: ${JSON.stringify(emptyBody.meta)}`);
console.log(`  [${mark(empty.status === 200 && emptyBody.data.length === 0 && emptyBody.meta.total === 0)}] empty state: 200 with an empty array, not an error`);

console.log(`\nSTATE: error — a failing request`);
const badRequest = await browserFetch(`${ORIGIN}/api/v1/restaurants?limit=-1`);
const badBody = await badRequest.json();
console.log(`  ${badRequest.status} ${JSON.stringify(badBody)}`);
console.log(`  [${mark(badRequest.status === 400 && badBody.error.code === "BAD_REQUEST")}] error state gets a code and message to show`);

console.log(`\nSTATE: error — 429 with its retry time`);
let limited = null;
let accepted = 0;
for (let i = 0; i < 130; i += 1) {
  const response = await browserFetch(pageUrl({}), { headers: { "x-forwarded-for": "198.51.100.200" } });
  if (response.status === 200) accepted += 1;
  else {
    limited = response;
    break;
  }
}
const limitedBody = await limited.json();
const retryAfter = limited.headers.get("retry-after");
console.log(`  accepted ${accepted} requests, then ${limited.status}`);
console.log(`  Retry-After: ${retryAfter}`);
console.log(`  Access-Control-Allow-Origin on the 429: ${limited.headers.get("access-control-allow-origin")}`);
console.log(`  body: ${JSON.stringify(limitedBody)}`);
console.log(`  [${mark(limited.status === 429 && Number(retryAfter) > 0 && limited.headers.get("access-control-allow-origin") === "*")}] page can show "try again in ${retryAfter} seconds"`);

line("4. Root page");

const root = await fetch(`${ORIGIN}/`);
const rootHtml = await root.text();
console.log(`\nGET / -> ${root.status}`);
console.log(`  [${mark(rootHtml.includes("README") && rootHtml.includes("/consumer"))}] one-line pointer to the README and /consumer`);

console.log("\nAll checks complete.");
