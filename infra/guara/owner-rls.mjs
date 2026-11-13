// Row-level security for a database whose only login is the table owner.
//
// PostgreSQL skips RLS for a table's owner unless the table is FORCEd. Managed Postgres
// that gives the app just an owner login (no CREATEROLE, so no corvo_app runtime login)
// can still enforce the tenant policies, which name no role: `force` turns FORCE ROW LEVEL
// SECURITY on for every table that has RLS enabled. `relax` turns it off so migrations,
// which run as the same owner, can change data across tenants. start.sh runs relax, the
// migrations, then force.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "force" && mode !== "relax") throw new Error("usage: owner-rls.mjs force|relax");
const url = process.env.DATABASE_MIGRATION_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL is required");

const requireFromDb = createRequire(
  fileURLToPath(new URL("../../packages/db/package.json", import.meta.url)),
);
const { Client } = requireFromDb("pg");
const client = new Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT format('%I.%I', n.nspname, c.relname) AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND c.relforcerowsecurity = $1
        AND pg_has_role(current_user, c.relowner, 'USAGE')`,
    [mode === "relax"],
  );
  for (const { name } of rows) {
    await client.query(`ALTER TABLE ${name} ${mode === "force" ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`);
  }
  process.stdout.write(`Row-level security ${mode === "force" ? "forced" : "relaxed"} on ${rows.length} table(s).\n`);
} finally {
  await client.end();
}
