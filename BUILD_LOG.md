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
