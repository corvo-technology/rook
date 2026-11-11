import { randomBytes } from "node:crypto";
import { signupPolicyFromEnv } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { startShortNavigation } from "./missions.js";
import { runAsSystem } from "./row-security.js";

export interface SignupPolicyEnv {
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

/** Prisma unique-constraint violation; anything else must still throw. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/**
 * Provision a personal workspace. Signup never grants deployment administration. The person has no
 * workspace yet, so there is no tenant to scope the writes to: they run as the system.
 */
export function bootstrapUserSpace(
  prisma: PrismaClient,
  user: { id: string },
  env: SignupPolicyEnv,
): Promise<{ spaceId: string }> {
  return runAsSystem("bootstrap user space", () => createUserSpace(prisma, user, env));
}

async function createUserSpace(
  prisma: PrismaClient,
  user: { id: string },
  env: SignupPolicyEnv,
): Promise<{ spaceId: string }> {
  // Concurrent bootstraps for the same user (e.g. overlapping first phone
  // inbounds) race on every unique key below; each step either wins or
  // joins the winner's state instead of failing.
  const slug = `user-${user.id.slice(0, 12)}`;
  let orgId = newId();
  try {
    await prisma.organization.create({
      data: { id: orgId, name: "Personal", slug, createdAt: new Date() },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
  }
  await prisma.member
    .create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  let spaceCreated = true;
  await prisma.space
    .create({
      data: {
        id: orgId,
        organizationId: orgId,
        name: "Personal",
        isDefault: true,
        createdByUserId: user.id,
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      spaceCreated = false;
    });
  await prisma.spaceMember
    .create({
      data: {
        id: newId(),
        spaceId: orgId,
        organizationId: orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  // Only an account's first space starts short; a space that was already there keeps what it had.
  if (spaceCreated) await startShortNavigation(prisma, { spaceId: orgId, userId: user.id });
  const policy = signupPolicyFromEnv(env);
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ownerUserId: null,
      signupsEnabled: policy.enabled,
      signupAllowlist: policy.allowlist.join(","),
      signupPolicyInitialized: true,
    },
    update: {},
  });
  const hasMemory = await prisma.memoryDocument.findFirst({
    where: { spaceId: orgId, userId: user.id, scope: "user", path: "MEMORY.md" },
  });
  if (!hasMemory) {
    await prisma.memoryDocument
      .create({
        data: {
          spaceId: orgId,
          userId: user.id,
          scope: "user",
          path: "MEMORY.md",
          content: "# Space memory\n\nPreferences and context kept within this space live here.\n",
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  }
  await prisma.notificationPreference
    .create({
      data: {
        spaceId: orgId,
        userId: user.id,
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  return { spaceId: orgId };
}
