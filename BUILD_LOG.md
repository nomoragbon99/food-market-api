# Build log

Real errors hit while building, with symptom, cause and fix. Newest at the bottom.

## 1. create-next-app refused to scaffold into this folder

**Symptom:**

```
Could not create a project called "Consumable API" because of npm naming restrictions:
    * name can only contain URL-friendly characters
    * name can no longer contain capital letters
```

**Cause:** `create-next-app .` derives the `package.json` name from the directory name. The working
directory is `Consumable API`, which has a capital letter and a space, so it is not a legal npm
package name.

**Fix:** scaffolded into a temporary directory named `food-market-api` (a legal package name) and
copied the generated files into the project root, leaving the existing git history in place. The
committed `package.json` therefore reads `"name": "food-market-api"` regardless of the folder name.

## 2. `npm install` aborted during scaffolding with EALLOWSCRIPTS

**Symptom:**

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs. Add the entries to the
npm error "allowScripts" field in package.json, or to .npmrc, instead.
Aborting installation.
  npm install has failed.
```

**Cause:** npm 11.16.0 rejects the `--allow-scripts` flag that this version of `create-next-app`
passes to its internal `npm install`.

**Fix:** re-ran the scaffolder with `--skip-install`, then installed dependencies with a plain
`npm install`, which succeeds.

**Still open:** npm now warns that some packages' install scripts are not covered by `allowScripts`,
including `prisma` (preinstall) and `@prisma/engines` (postinstall). Nothing in this design-only step
needs them, but the Prisma query engine binary will have to be approved before the first
`prisma generate`, via `npm approve-scripts prisma @prisma/engines` or an `allowScripts` entry in
`package.json`.

## 3. `npm i -D prisma` installed an 8.0.0 release candidate

**Symptom:** `package.json` ended up with `"prisma": "^8.0.0-rc.20"` as the CLI while
`@prisma/client` resolved to `^7.10.0` — a major-version mismatch between CLI and client.

**Cause:** Prisma's `latest` dist-tag currently points at a prerelease:

```
"next": "8.0.0-rc.10",
"prev": "7.10.0",
"latest": "8.0.0-rc.20",
```

AGENTS.md asks for the latest *stable* version, which here is the `prev` tag, not `latest`.

**Fix:** `npm i -D prisma@7`, pinning the CLI to `^7.10.0` so it matches `@prisma/client`.

## 4. The scaffolder wrote its own AGENTS.md over ours

**Symptom:** `create-next-app` generates `AGENTS.md` (a `nextjs-agent-rules` block) and an
agent-specific pointer file that is just `@AGENTS.md`. Copying the scaffold output into the project root would have replaced the
project's own AGENTS.md.

**Cause:** Next.js 16 ships agent guidance by default, and `next dev` re-adds the block if it is
removed.

**Fix:** held our AGENTS.md aside before the copy, excluded the generated one, then appended the
generated `<!-- BEGIN:nextjs-agent-rules -->` block *below* our rules. Verified with
`diff <(head -39 AGENTS.md) <backup>` that our 39 lines are byte-identical and that the only change
to the file is 10 appended lines. The generated agent-specific pointer file (`@AGENTS.md`) was kept as-is,
since it just points at our file.

## 5. Prisma 7.10 configures the datasource and seed differently than planned

**Symptom:** none yet — caught before writing any setup, by scaffolding a throwaway
`prisma init --datasource-provider postgresql` in a temp directory and reading what the installed
7.10.0 CLI actually produces. Five differences from the plan, all now followed:

1. The config file is **`prisma7.config.ts`**, not `prisma.config.ts`. (7.x uses the versioned name;
   `prisma.config.ts` is the Prisma 8 name.)
2. The **datasource URL lives in the config file**, not in `schema.prisma`. The generated
   `datasource db` block contains only `provider`, with no `url` field at all.
3. **`.env` is not loaded automatically.** The generated `.env` says so in a comment: you must add
   `import "dotenv/config"` to the config file, or run the CLI with Bun. Added `dotenv` as a
   devDependency and that import at the top of `prisma7.config.ts`.
4. The **seed command is `migrations.seed` in the config file**, not `"prisma": { "seed": ... }` in
   `package.json`.
5. The generated client **requires a driver adapter**: `prismaNamespace.ts` describes connecting
   "through a driver adapter" as "the common case in Prisma 7", and the only alternative is an
   Accelerate URL. Added `@prisma/adapter-pg` and `pg` (plus `@types/pg`) and wired `PrismaPg` into
   the client singleton.

The generator is `prisma-client` (not the Prisma 6 `prisma-client-js`) and requires an explicit
`output`, set to `src/generated/prisma`.

## 6. Install scripts approved for the Prisma packages only

Following on from the open item in entry 2:

```
$ npm approve-scripts prisma @prisma/engines
Approved @prisma/engines:
  added @prisma/engines@7.10.0
Approved prisma:
  added prisma@7.10.0
```

This writes a pinned `allowScripts` block to `package.json`:

```json
"allowScripts": {
  "@prisma/engines@7.10.0": true,
  "prisma@7.10.0": true
}
```

`unrs-resolver` (a transitive dependency of the ESLint resolver) was deliberately **not** approved;
npm still warns about it and nothing we run needs it. After `npm install`, `prisma validate` and
`prisma generate` both succeed.

## 7. DATABASE_URL points at Railway's internal host, unreachable from this machine

**Symptom:**

```
$ npx prisma migrate dev --name init_food_market --create-only
Datasource "db": PostgreSQL database "railway", schema "public" at "postgres.railway.internal:5432"

Error: P1001: Can't reach database server at `postgres.railway.internal:5432`
```

`nslookup postgres.railway.internal` also times out.

**Cause:** `postgres.railway.internal` is Railway's **private network** hostname. It only resolves
from inside a service deployed in the same Railway project, not from a developer machine. Railway
exposes two variables: `DATABASE_URL` (private) and `DATABASE_PUBLIC_URL` (the TCP proxy, a
`*.proxy.rlwy.net` host on a high port).

**Fix:** not applied by me — `.env` is the user's to edit. Reported and stopped there.

## 8. P1001 from Prisma against a database that is provably reachable

**Symptom:** with the public Railway proxy address in `.env`, every Prisma CLI command failed:

```
$ npx prisma migrate deploy
Datasource "db": PostgreSQL database "railway", schema "public" at "<db-host>.proxy.rlwy.net:<port>"

Error: P1001: Can't reach database server at `<db-host>.proxy.rlwy.net:<port>`
```

Yet the same host, port and credentials connected fine from Node:

```
PG CONNECT OK
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu
db= railway user= postgres
```

A raw TCP connect to `<db-host>.proxy.rlwy.net:<port>` also succeeded, while `nslookup` timed out for
*every* hostname on this machine, including ones that then connected.

**Cause:** not the database, and not the agent sandbox (the failure persisted with sandboxing
disabled). UDP port 53 is blocked on this machine, so direct DNS queries time out. Node resolves
through the Windows resolver and works; Prisma's native engine (a Rust binary) performs its own DNS
resolution and gets nothing, which it reports as the generic "can't reach database server".

**Fix:** `scripts/with-resolved-db.mjs` resolves `DATABASE_URL`'s hostname with
`dns.lookup` — i.e. through the OS resolver — substitutes the IP into the URL in memory, and spawns
the real command with that URL in its environment. The URL is never printed. All Prisma commands
are run through it:

```
$ node scripts/with-resolved-db.mjs npx prisma migrate deploy
Resolved <db-host>.proxy.rlwy.net -> <resolved-ip> (credentials not printed)
...
All migrations have been successfully applied.
```

This is a local-environment workaround, not a project requirement: on a machine with working DNS,
`npx prisma migrate deploy` can be run directly.

## 9. `node --experimental-strip-types` cannot load the generated Prisma client

**Symptom:**

```
$ node --experimental-strip-types prisma/seed.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'C:\Users\HP\Documents\Consumable API\src\generated\prisma\enums'
imported from C:\Users\HP\Documents\Consumable API\src\generated\prisma\client.ts
```

**Cause:** the Prisma 7 `prisma-client` generator emits TypeScript that imports siblings with an
explicit `.ts` extension (`./enums.ts`). Node's type stripping does not resolve those specifiers the
way the TypeScript compiler does, so the import fails at `./enums`.

**Fix:** added `tsx` as a devDependency and set the seed command in `prisma7.config.ts` to
`tsx prisma/seed.ts`. The plan had flagged this as the fallback if native stripping failed.
`esbuild` (tsx's dependency) has an unapproved install script; it was deliberately left unapproved
and tsx works regardless.

## 10. Seed and evidence output

Both seed runs and the constraint checks are saved under `evidence/`. Nothing to fix — recorded
because the numbers are the proof:

- `evidence/seed-run-1.txt`, `evidence/seed-run-2.txt`: identical row counts (200 / 1792 / 300 /
  600 / 1487), 6.98s and 7.63s. The second run inserts nothing, because every generated UUID already
  exists and `skipDuplicates` drops the conflicting rows.
- `evidence/constraint-and-integrity-checks.txt`: three rejected inserts (two SQLSTATE 23514 check
  violations, one 23503 foreign key violation) and the integrity queries, all returning 0.

## 11. Windows .cmd shims cannot be spawned without a shell

**Symptom:** removing `shell: true` from `scripts/with-resolved-db.mjs` to silence the Node
`DEP0190` deprecation warning replaced the warning with a crash:

```
node:internal/child_process:440
    throw new ErrnoException(err, 'spawn');
```

**Cause:** on Windows `npx` and `tsx` are `.cmd` shims. Node refuses to execute a `.cmd` file
without a shell (a deliberate change after CVE-2024-27980), so `spawn("npx.cmd", args)` fails.

**Fix:** keep the shell, drop the args array. `DEP0190` fires only when an args *array* is combined
with `shell: true`, so the command and its arguments are assembled into a single quoted string and
passed as the sole argument. The warning is gone and the shim runs.

## 12. The pagination check disagreed with Postgres about text ordering

**Symptom:** walking every page of `/api/v1/restaurants?sort=name&order=asc` returned 200 unique
ids with `nextCursor: null` at the end, but the evidence script reported `ordering correct: false`.
Fourteen apparent inversions, all of this shape:

```
"Bauch, Lebsack-O'Connell and Hoppe Spot" > "Bauch - Orn Kitchen"
"Corwin, Hauck and Zboncak Bistro"        > "Corwin - Kemmer Bistro"
```

**Cause:** the API was right and the check was wrong. Postgres's collation weighs letters ahead of
punctuation, so it compares `BauchLebsack` against `BauchOrn` and puts the comma-form first.
JavaScript's `>` compares code points, where `,` (U+002C) sorts before `-` (U+002D), so it called
that an inversion. `Intl.Collator` disagreed with Postgres too, in the same 14 places.

**Fix:** the check no longer re-implements SQL ordering in JavaScript. It reads the authoritative
sequence straight from the database — `select id from restaurants order by <col> <dir>, id <dir>` —
and compares the walked id sequence to it position by position. Both sorts now match exactly. The
keyset cursor was never affected: its `>` / `<` comparisons run inside Postgres under the same
collation as the `ORDER BY`.

## 13. The evidence script hung after printing all its output

**Symptom:** `node evidence/api-checks.mjs` printed "All checks complete." and then never exited;
the run was eventually moved to the background after 600s.

**Cause:** the direct `pg` client opened for entry 12's ordering check was never closed, and an open
connection keeps Node's event loop alive.

**Fix:** `await db.end()` at the end of the script. It now exits 0.

## 14. ESLint rejected the consumer page's data-loading effect

**Symptom:** `npm run lint` failed on the new page, while `next build` passed:

```
src/app/consumer/page.tsx
  112:10  error  Calling setState synchronously within an effect can trigger cascading renders
  > 112 |     void load(null);
        |          ^^^^ Avoid calling setState() directly within an effect   react-hooks/set-state-in-effect
```

**Cause:** the effect called a `useCallback` that set `loading` and `error` synchronously before
awaiting anything, so the mount render immediately queued another render.

**Fix:** split the two concerns. `fetchPage()` moved outside the component and returns a result
instead of setting state. The filter-driven load is an effect whose state updates happen inside a
nested async function (with an `AbortController`, so superseded requests are dropped rather than
reported as errors), and "Next page" became a plain event handler, where setting state directly is
fine. Lint and build both pass, and no rule was suppressed.

## 15. Node's fetch could not reach the Railway deployment, while curl could

**Symptom:** every request to the live URL from Node failed:

```
ERROR UND_ERR_CONNECT_TIMEOUT
```

while the same URL answered fine from curl (`http_code=200`), a raw TCP connect to port 443
succeeded, and DNS resolved correctly.

**Cause:** not the deployment. Node's `fetch` is backed by undici, whose connect path times out
against Railway's edge on this machine; the built-in `https` module reaches the same host in 634ms.
`dns.setDefaultResultOrder("ipv4first")` did not help, so it is not simply an IPv6 preference.

**Fix:** `scripts/http.mjs`, a small fetch-shaped client over `node:https` supporting the subset the
evidence scripts use — method, headers, string body, and a response with `status`, `headers.get()`,
`text()` and `json()`. `evidence/api-checks.mjs` imports it as `fetch`, so the same script runs
against both a local server and the live deployment. The live run then passed 25/25.

**Known cosmetic issue:** `scripts/trip-rate-limit.mjs` imports `src/config.ts` to print the
configured limit, which makes Node emit a `MODULE_TYPELESS_PACKAGE_JSON` warning. Adding
`"type": "module"` to `package.json` would silence it but risks the Next.js build, and duplicating
the limit as a literal would break the rule that every tunable number lives in `src/config.ts`.
Left as-is deliberately.
