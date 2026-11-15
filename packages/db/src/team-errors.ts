import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { withTransactionRetry } from "./transaction-retry.js";

export type TeamErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "limit"
  | "last_owner"
  | "closed";

/** A refusal the API shows as-is; nothing in it names a person who has no right to be named. */
export class TeamError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

export function serializable<T>(
  prisma: PrismaClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return withTransactionRetry(() =>
    prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
  );
}
