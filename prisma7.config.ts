// Prisma 7 configuration.
//
// Two things that differ from Prisma 6 and are easy to get wrong:
//  - the datasource URL lives here, not in a `url` field in schema.prisma;
//  - Prisma does NOT load .env by itself, hence the dotenv import below.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `npx prisma db seed` runs this. tsx, not node --experimental-strip-types:
    // see BUILD_LOG.md entry 9.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
