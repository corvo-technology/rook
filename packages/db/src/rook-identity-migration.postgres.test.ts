import { readFileSync } from "node:fs";
import { CHIEF_AGENT, chiefInstructions } from "@corvo/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../prisma/migrations/20261225000000_rook_identity/migration.sql", import.meta.url),
  "utf8",
);

const OLD_EN_DESCRIPTION =
  "Your first point of contact. Tell it what you need and it gets the right agent on it.";
const OLD_PT_DESCRIPTION = "Seu primeiro contato. Diga o que precisa e ele aciona o agente certo.";

/** The instructions the Chief was made with before Rook: today's text with the old name back. */
function oldInstructions(locale: "en" | "pt-BR", channel?: string): string {
  return chiefInstructions(locale, channel)
    .replace(
      "You are Rook, the owner's right hand: their main assistant",
      "You are the Chief: the owner's main assistant",
    )
    .replace('("I am Rook, organizer of X")', '("I am the Chief, organizer of X")')
    .replace(
      "Você é o Rook, o braço direito do dono: o assistente principal",
      "Você é o Chefe: o assistente principal do dono",
    )
    .replace('("Sou o Rook, organizador de X")', '("Sou o Chefe, organizador de X")');
}

describe("the Rook identity migration (text)", () => {
  it("only updates data: no schema change", () => {
    expect(sql).not.toMatch(/\b(alter|drop|rename|delete|insert|create)\b/i);
    expect(sql).toContain('UPDATE "bots"');
  });

  it("writes the same defaults the code creates a new Chief with", () => {
    for (const text of [
      CHIEF_AGENT.name.en,
      CHIEF_AGENT.title.en,
      CHIEF_AGENT.title["pt-BR"],
      CHIEF_AGENT.description.en,
      CHIEF_AGENT.description["pt-BR"],
    ]) {
      expect(sql).toContain(`'${text.replaceAll("'", "''")}'`);
    }
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("the Rook identity migration (PostgreSQL)", () => {
  const schema = `rook_identity_${String(Date.now()).slice(-8)}`;
  let pool: pg.Pool;

  /** One connection pinned to a scratch schema, so no real table is touched. */
  const withSchema = async <T>(run: (client: pg.PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      return await run(client);
    } finally {
      client.release();
    }
  };

  type Row = {
    id: string;
    name: string;
    title: string;
    description: string;
    instructions: string;
    spawnKey: string | null;
  };
  const insert = (client: pg.PoolClient, row: Row) =>
    client.query(
      `INSERT INTO bots (id, "spaceId", name, title, description, instructions, "spawnKey") VALUES ($1, $1, $2, $3, $4, $5, $6)`,
      [row.id, row.name, row.title, row.description, row.instructions, row.spawnKey],
    );
  const read = async (client: pg.PoolClient, id: string) =>
    (
      await client.query<Row>(
        `SELECT id, name, title, description, instructions, "spawnKey" FROM bots WHERE id = $1`,
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await withSchema((client) =>
      client.query(
        `CREATE TABLE bots (id text PRIMARY KEY, "spaceId" text NOT NULL, name text NOT NULL, title text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', instructions text NOT NULL DEFAULT '', "spawnKey" text)`,
      ),
    );
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool?.end();
  });

  it("renames a default Chief in each language and gives it the new title and description", async () => {
    await withSchema(async (client) => {
      await insert(client, {
        id: "en",
        name: "Chief",
        title: "",
        description: OLD_EN_DESCRIPTION,
        instructions: oldInstructions("en", "telegram"),
        spawnKey: "onboarding:first",
      });
      await insert(client, {
        id: "pt",
        name: "Chefe",
        title: "",
        description: OLD_PT_DESCRIPTION,
        instructions: oldInstructions("pt-BR"),
        spawnKey: "onboarding:first",
      });
      await insert(client, {
        id: "legacy",
        name: "Chief",
        title: "",
        description: "",
        instructions: "",
        spawnKey: null,
      });
      await client.query(sql);
      const en = await read(client, "en");
      expect(en).toMatchObject({
        name: "Rook",
        title: CHIEF_AGENT.title.en,
        description: CHIEF_AGENT.description.en,
        instructions: chiefInstructions("en", "telegram"),
      });
      const pt = await read(client, "pt");
      expect(pt).toMatchObject({
        name: "Rook",
        title: CHIEF_AGENT.title["pt-BR"],
        description: CHIEF_AGENT.description["pt-BR"],
        instructions: chiefInstructions("pt-BR"),
      });
      expect(await read(client, "legacy")).toMatchObject({ name: "Rook", title: "Right hand" });
    });
  });

  it("never touches an agent the owner renamed, rewrote or never was the Chief", async () => {
    await withSchema(async (client) => {
      const renamed: Row = {
        id: "renamed",
        name: "Ana",
        title: "Boss",
        description: "Mine",
        instructions: oldInstructions("en"),
        spawnKey: "onboarding:first",
      };
      const rewritten: Row = {
        id: "rewritten",
        name: "Chief",
        title: "",
        description: "My own words",
        instructions: "Be brief.",
        spawnKey: "onboarding:first",
      };
      const other: Row = {
        id: "other",
        name: "Chief",
        title: "",
        description: OLD_EN_DESCRIPTION,
        instructions: oldInstructions("en"),
        spawnKey: "agent-catalog:translator",
      };
      for (const row of [renamed, rewritten, other]) await insert(client, row);
      await client.query(sql);
      expect(await read(client, "renamed")).toEqual(renamed);
      expect(await read(client, "other")).toEqual(other);
      // Still the default name, so it follows; its own description and instructions stay.
      expect(await read(client, "rewritten")).toEqual({
        ...rewritten,
        name: "Rook",
        title: "Right hand",
      });
    });
  });

  it("follows a default description even when the owner renamed the agent, and repeats cleanly", async () => {
    await withSchema(async (client) => {
      await insert(client, {
        id: "named",
        name: "Ana",
        title: "",
        description: OLD_EN_DESCRIPTION,
        instructions: "",
        spawnKey: "onboarding:first",
      });
      await client.query(sql);
      const once = await read(client, "named");
      expect(once).toMatchObject({
        name: "Ana",
        title: "",
        description: CHIEF_AGENT.description.en,
      });
      await client.query(sql);
      expect(await read(client, "named")).toEqual(once);
    });
  });
});
