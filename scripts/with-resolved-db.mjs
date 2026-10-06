/**
 * Runs a command with DATABASE_URL's hostname replaced by its resolved IP.
 *
 * Why: Prisma's native engine resolves DNS itself rather than going through the
 * OS resolver. On a machine where UDP port 53 is blocked (corporate network,
 * some VPNs), Node connects fine but the engine reports P1001 against a host
 * that is demonstrably reachable. Resolving the name here, where the OS
 * resolver is used, sidesteps that. See BUILD_LOG.md entry 8.
 *
 * The rewritten URL is passed through the child process environment and is
 * never printed. Usage:
 *   node scripts/with-resolved-db.mjs npx prisma migrate deploy
 */
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import "dotenv/config";

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const url = new URL(raw);
const { address } = await lookup(url.hostname, { family: 4 });
console.error(`Resolved ${url.hostname} -> ${address} (credentials not printed)`);
url.hostname = address;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("No command given.");
  process.exit(1);
}

// A shell is unavoidable here: on Windows npx and tsx are .cmd shims, which
// Node refuses to spawn directly. But DEP0190 only fires when an args array is
// combined with `shell: true`, so the command is assembled into one string and
// passed with no args array. Arguments containing whitespace are quoted.
const quote = (part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part);
const commandLine = [command, ...args].map(quote).join(" ");

const child = spawn(commandLine, {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: url.toString() },
});
child.on("exit", (code) => process.exit(code ?? 1));
