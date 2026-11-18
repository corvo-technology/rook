import type { TransactionalEmailProvider } from "@corvo/adapter-kit";
import type { PartnerAlertDigest, PrismaClient } from "@corvo/db";
import { claimConnectorDownAlerts, dispatchPartnerAlerts, runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { configuredEmailProvider } from "./email.js";
import { partnerAlertEmail } from "./partner-alert-email.js";

/**
 * The periodic job that tells partners' people about what happened: notes the customers whose
 * connector is down, then writes the inbox entries and sends one email per person for the batch.
 * Without an email provider only the inbox is written.
 */
export function createPartnerAlertDispatcher(deps: {
  prisma: PrismaClient;
  email?: TransactionalEmailProvider | undefined;
  webOrigin: string;
  now?: () => Date;
}) {
  const { email } = deps;
  return () =>
    runAsSystem("partner alerts", async () => {
      const now = deps.now?.() ?? new Date();
      await claimConnectorDownAlerts(deps.prisma, now).catch((error) =>
        getLogger().error("partner connector alerts", error),
      );
      return dispatchPartnerAlerts(deps.prisma, {
        now: () => now,
        ...(email
          ? {
              send: async (digest) => email.send(await partnerAlertEmail(deps.webOrigin, digest)),
            }
          : {}),
      });
    });
}

/** The same dispatcher for a process that reads its email settings from the environment. */
export function createPartnerAlertDispatcherFromEnv(
  prisma: PrismaClient,
  env: Record<string, string | undefined>,
) {
  const value = (key: string) => env[key]?.trim() || undefined;
  return createPartnerAlertDispatcher({
    prisma,
    webOrigin: value("WEB_ORIGIN") ?? "http://127.0.0.1:5173",
    email: configuredEmailProvider({
      emailProvider: value("EMAIL_PROVIDER"),
      emailApiKey: value("EMAIL_API_KEY"),
      emailApiUrl: value("EMAIL_API_URL"),
      emailFrom: value("EMAIL_FROM"),
      smtpUrl: value("SMTP_URL"),
    }),
  });
}
