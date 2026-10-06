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
