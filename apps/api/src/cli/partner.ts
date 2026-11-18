// `pnpm partner create|rotate|disable|enable|apply-template|webhook|retention ... <slug> ...`: manages the SaaS partners that send
// their customers to Rook. Run on the server, as the runtime login, with DATABASE_URL set.
import { readFile } from "node:fs/promises";
import { resolveEncryptionKey } from "@corvo/core";
import { partnerWebhookSecret } from "@corvo/core/node/partner-key";
import {
  createDb,
  createPartner,
  findUserIdByEmail,
  rotatePartnerKey,
  rotatePartnerWebhookSecret,
  runAsSystem,
  setPartnerEnabled,
  setPartnerScribeRetentionDays,
  setPartnerTemplateBySlug,
  setPartnerWebhookUrl,
} from "@corvo/db";
import { runPartnerCommand } from "./partner-command.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { prisma, pool } = createDb(databaseUrl);
try {
  const output = await runAsSystem("partner administration", () =>
    runPartnerCommand(process.argv.slice(2), {
      createPartner: (input) => createPartner(prisma, input),
      rotatePartnerKey: (slug) => rotatePartnerKey(prisma, slug),
      setPartnerEnabled: (slug, enabled) => setPartnerEnabled(prisma, slug, enabled),
      findUserIdByEmail: (email) => findUserIdByEmail(prisma, email),
      readFile: (path) => readFile(path, "utf8"),
      setTemplate: (slug, template) => setPartnerTemplateBySlug(prisma, slug, template),
      setWebhookUrl: (slug, url) => setPartnerWebhookUrl(prisma, slug, url),
      findPartner: (slug) => prisma.partner.findUnique({ where: { slug } }),
      rotateWebhookSecret: (slug) => rotatePartnerWebhookSecret(prisma, slug),
      webhookSecret: (partner) =>
        partnerWebhookSecret(
          resolveEncryptionKey(process.env),
          partner.id,
          partner.webhookSecretVersion,
        ),
      setScribeRetentionDays: (slug, days) => setPartnerScribeRetentionDays(prisma, slug, days),
    }),
  );
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await pool.end();
}
