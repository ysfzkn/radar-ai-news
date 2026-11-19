// Posts the demo stories to a LOCAL dev server. Usage: npm run seed [-- http://localhost:8787]
// Reads INGEST_TOKEN from admin/.dev.vars and never prints it. Refuses non-local targets.
import { readFileSync } from "node:fs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOUR = 3600_000;
const root = new URL("../", import.meta.url);

function readVars(file) {
  const vars = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const target = new URL("/api/ingest", process.argv[2] ?? "http://localhost:8787");
if (!LOCAL_HOSTS.has(target.hostname) || !["http:", "https:"].includes(target.protocol)) {
  fail(`Refusing to seed ${target.host}: demo data only goes to localhost, 127.0.0.1 or [::1].`);
}

let token;
try {
  token = readVars(new URL(".dev.vars", root)).INGEST_TOKEN;
} catch {
  fail("Could not read admin/.dev.vars. Copy .dev.vars.example to .dev.vars first.");
}
if (!token) fail("INGEST_TOKEN is not set in admin/.dev.vars.");

const demo = JSON.parse(readFileSync(new URL("fixtures/demo-stories.json", root), "utf8"));
const now = Date.now();
const stories = demo.stories.map(({ age_hours, ...story }) => ({
  ...story,
  created_at: new Date(now - age_hours * HOUR).toISOString(),
}));

let res;
try {
  res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ version: demo.version, stories }),
    redirect: "manual",
  });
} catch {
  fail(`Could not reach ${target.origin}. Is "npm run dev" running?`);
}
console.log(`${res.status} ${await res.text()}`);
if (!res.ok) process.exit(1);
